// Better OpenAI integration.
// Derived in part from mattleong/pi-better-openai (MIT). See THIRD_PARTY_NOTICES.md.
import { readFileSync } from "node:fs";
import { BorderedLoader, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Container, Image, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getCredentials } from "./lib/better-openai/auth.ts";
import { readRawConfig, resolveConfig, updateConfig, writeRawConfig, type ResolvedConfig } from "./lib/better-openai/config.ts";
import { FastController, modelKey, supportsFast } from "./lib/better-openai/fast.ts";
import { maskIdentifier, sanitizeError } from "./lib/better-openai/format.ts";
import { generateImage, IMAGE_ACTIONS } from "./lib/better-openai/image.ts";
import { availableCredits, consumeResetCredit, fetchResetCredits, formatCredits, type ResetCreditList } from "./lib/better-openai/reset-credits.ts";
import { showSettings } from "./lib/better-openai/settings.ts";
import { compactUsage, detailedUsage, fetchUsage, type UsageSnapshot } from "./lib/better-openai/usage.ts";

const STATUS_ENTRY = "better-openai:status";
const IMAGE_ENTRY = "better-openai:image";
const asBoolean = (v: string) => v === "true";
const parseSetting = (id: string, value: string): unknown => id.endsWith("Ms") ? Number(value) : ["true", "false"].includes(value) ? asBoolean(value) : value;

export default function betterOpenAI(pi: ExtensionAPI): void {
 const fast = new FastController();
 let cfg: ResolvedConfig | undefined;
 let usage: UsageSnapshot | undefined;
 let usageUpdatedAt: number | undefined;
 let usageError: string | undefined;
 let timer: ReturnType<typeof setInterval> | undefined;
 let usageInFlight = false;
 let queuedUsage: { ctx: ExtensionContext; force: boolean; notify: boolean; generation: number } | undefined;
 let usageLastFetchAt: number | undefined;
 let sessionSignal: AbortSignal | undefined;
 let sessionAbort: (() => void) | undefined;
 let generation = 0;
 const requests = new Set<AbortController>();
 const imageToolEnabled = process.env.PI_BETTER_OPENAI_IMAGE_TOOL === "1";

 const config = (ctx: ExtensionContext) => cfg ?? (cfg = resolveConfig(ctx));
 const eligible = (ctx: ExtensionContext, c = config(ctx)) => !!ctx.model && ["openai", "openai-codex"].includes(ctx.model.provider) && (!c.usage.showOnlyOnSubscriptionModels || ctx.modelRegistry.isUsingOAuth(ctx.model));
 function abortRequests() { for (const request of requests) request.abort(); requests.clear(); }
 function requestSignal(timeoutMs: number, outer?: AbortSignal): { controller: AbortController; signal: AbortSignal } { const controller = new AbortController(); requests.add(controller); const signals = [controller.signal, AbortSignal.timeout(timeoutMs)]; if (outer) signals.push(outer); return { controller, signal: AbortSignal.any(signals) }; }
 function statusLines(ctx: ExtensionContext): string[] { const c = config(ctx); const lines: string[] = []; if (fast.active && supportsFast(ctx, c)) lines.push("  Fast mode: on"); if (c.usage.enabled && eligible(ctx, c)) lines.push(`  ${usage ? compactUsage(usage, c.usage.showResetTimes) : usageError ? `Usage unavailable: ${usageError}` : "OpenAI usage: loading…"}${usageError && usage ? " | stale" : ""}`); return lines; }
 function appendStatus(ctx: ExtensionContext) { const lines = statusLines(ctx); if (lines.length > 0) pi.appendEntry(STATUS_ENTRY, { lines }); }
 function persistFast(ctx: ExtensionContext) { const c = config(ctx); if (!c.persistState) return; const raw = readRawConfig(c.configPath); writeRawConfig(c.configPath, { ...raw, desiredActive: fast.desired, active: fast.active }); cfg = resolveConfig(ctx); }
 async function refreshUsage(ctx: ExtensionContext, force = false, notify = false, expectedGeneration = generation) { let c: ResolvedConfig; try { c = config(ctx); if (!c.usage.enabled || !eligible(ctx, c) || expectedGeneration !== generation) { if (notify) ctx.ui.notify(!c.usage.enabled ? "OpenAI usage is disabled." : "Current model is not an eligible OpenAI subscription model.", "warning"); return; } } catch (error) { if (error instanceof Error && error.message.includes("extension ctx is stale")) stop(); return; } if (usageInFlight) { const queued = queuedUsage?.generation === expectedGeneration ? queuedUsage : undefined; queuedUsage = { ctx, generation: expectedGeneration, force: force || !!queued?.force, notify: notify || !!queued?.notify }; return; } if (!force && usageLastFetchAt && Date.now() - usageLastFetchAt < c.usage.refreshIntervalMs) return; usageInFlight = true; usageLastFetchAt = Date.now(); let request: ReturnType<typeof requestSignal> | undefined; try { request = requestSignal(12_000, ctx.signal); const next = await fetchUsage(ctx, request.signal); if (expectedGeneration !== generation) return; usage = next; usageUpdatedAt = Date.now(); usageError = undefined; if (notify) ctx.ui.notify(detailedUsage(next), "info"); } catch (error) { if (request?.signal.aborted || expectedGeneration !== generation) return; if (error instanceof Error && error.message.includes("extension ctx is stale")) { stop(); return; } usageError = sanitizeError(error); if (notify) ctx.ui.notify(usage ? `${detailedUsage(usage)}\n\nStale: ${usageError}` : usageError, "warning"); } finally { if (request) requests.delete(request.controller); usageInFlight = false; const queued = queuedUsage; queuedUsage = undefined; if (queued && queued.generation === generation) void refreshUsage(queued.ctx, queued.force, queued.notify, queued.generation); } }
 function stop() { generation++; if (timer) clearInterval(timer); timer = undefined; if (sessionSignal && sessionAbort) sessionSignal.removeEventListener("abort", sessionAbort); sessionSignal = undefined; sessionAbort = undefined; queuedUsage = undefined; usageLastFetchAt = undefined; abortRequests(); }
 function start(ctx: ExtensionContext) { stop(); const current = generation; const c = config(ctx); if (!c.usage.enabled) return current; sessionSignal = ctx.signal; sessionAbort = () => { if (current === generation) stop(); }; if (sessionSignal?.aborted) { stop(); return; } sessionSignal?.addEventListener("abort", sessionAbort, { once: true }); timer = setInterval(() => void refreshUsage(ctx, false, false, current), c.usage.refreshIntervalMs); timer.unref?.(); return current; }

 pi.registerFlag("fast", { description: "Start with OpenAI fast mode enabled", type: "boolean", default: false });
 pi.registerCommand("fast", { description: "Toggle OpenAI fast mode", handler: async (args, ctx) => { if (args.trim()) { ctx.ui.notify("Usage: /fast", "error"); return; } const c = config(ctx); fast.toggle(ctx, c); persistFast(ctx); ctx.ui.notify(fast.active ? `Fast mode enabled for ${modelKey(ctx)}.` : fast.desired ? `Fast mode requested but inactive for unsupported ${modelKey(ctx)}.` : "Fast mode disabled.", fast.desired && !fast.active ? "warning" : "info"); } });
 pi.registerCommand("openai-usage", { description: "Show OpenAI usage or manage reset credits", getArgumentCompletions: prefix => ["resets", "reset"].filter(x => x.startsWith(prefix)).map(value => ({ value, label: value })), handler: async (args, ctx) => { const action = args.trim().toLowerCase(); try {
  if (!action) { await refreshUsage(ctx, true, false); const request = requestSignal(12_000); try { const list = await fetchResetCredits(ctx, request.signal); if (usage) usage.resetCredits = list.availableCount; const earliest = availableCredits(list)[0]?.expiresAt; ctx.ui.notify(`${usage ? detailedUsage(usage) : `Usage unavailable: ${usageError ?? "unknown"}`}${earliest ? `\nEarliest credit expiration: ${new Date(earliest).toLocaleString()}` : ""}`, usage ? "info" : "warning"); } finally { requests.delete(request.controller); } return; }
  if (action === "resets") { const request = requestSignal(12_000); try { ctx.ui.notify(formatCredits(await fetchResetCredits(ctx, request.signal)), "info"); } finally { requests.delete(request.controller); } return; }
  if (action === "reset") { await refreshUsage(ctx, true); const request = requestSignal(12_000); let list: ResetCreditList; try { list = await fetchResetCredits(ctx, request.signal); } finally { requests.delete(request.controller); } const credit = availableCredits(list)[0]; if (!credit) { ctx.ui.notify("No available saved reset credit.", "warning"); return; } const confirmed = await ctx.ui.confirm("Consume saved reset credit?", `${usage ? detailedUsage(usage) : "Current usage unavailable."}\n\nCredit: ${credit.title ?? credit.id}\nExpires: ${credit.expiresAt ? new Date(credit.expiresAt).toLocaleString() : "unknown"}`); if (!confirmed) { ctx.ui.notify("Reset cancelled.", "info"); return; } const consume = requestSignal(15_000); try { const outcome = await consumeResetCredit(ctx, credit.id, undefined, consume.signal); const messages: Record<string, string> = { reset: "Rate limit reset successfully.", nothing_to_reset: "No reset was applied: nothing currently needs resetting.", already_redeemed: "That credit was already redeemed.", no_credit: "No reset credit was available." }; ctx.ui.notify(messages[outcome.result] ?? `Backend returned unknown reset result: ${sanitizeError(outcome.result)}`, outcome.result === "reset" ? "info" : "warning"); if (outcome.result === "reset") await refreshUsage(ctx, true); } finally { requests.delete(consume.controller); } return; }
  ctx.ui.notify("Usage: /openai-usage [resets|reset]", "error");
 } catch (error) { ctx.ui.notify(sanitizeError(error), "error"); } } });
 pi.registerCommand("openai-image", { description: "Generate an image through OpenAI Codex authentication", handler: async (args, ctx) => { const prompt = args.trim(); if (!prompt) { ctx.ui.notify("Usage: /openai-image <prompt>", "error"); return; } const request = requestSignal(config(ctx).image.timeoutMs + 1000); try { let result: Awaited<ReturnType<typeof generateImage>> | undefined; if (ctx.mode === "tui") { result = await ctx.ui.custom((tui, theme, _keys, done) => { const loader = new BorderedLoader(tui, theme, "Generating OpenAI image… (Esc to cancel)"); loader.onAbort = () => { request.controller.abort(); done(undefined); }; void generateImage(prompt, ctx, config(ctx), request.signal).then(done).catch(error => done({ error } as any)); return loader; }); if (result && "error" in result) throw (result as any).error; } else { ctx.ui.notify("Generating OpenAI image…", "info"); result = await generateImage(prompt, ctx, config(ctx), request.signal); } if (!result) { ctx.ui.notify("Image generation cancelled.", "info"); return; } pi.appendEntry(IMAGE_ENTRY, result.savedPath ? { savedPath: result.savedPath, mimeType: result.mimeType, prompt, model: result.model } : { data: result.data, mimeType: result.mimeType, prompt, model: result.model }); ctx.ui.notify(result.savedPath ? `Image saved: ${result.savedPath}` : "Image generated (not saved).", "info"); } catch (error) { ctx.ui.notify(request.signal.aborted ? "Image request cancelled or timed out." : sanitizeError(error), "error"); } finally { requests.delete(request.controller); } } });
 if (imageToolEnabled) pi.registerTool({
  name: "openai_image",
  label: "OpenAI image",
  description: "Generate or edit images through OpenAI Codex subscription auth using the hosted image_generation tool. Supports up to five project-local reference/edit images.",
  promptSnippet: "Generate or edit raster images via OpenAI Codex subscription auth.",
  promptGuidelines: [
   "Use openai_image when the user asks to generate or edit a raster image, photo, illustration, mockup, texture, sprite, or bitmap asset.",
   "Pass the user's image prompt verbatim unless the user explicitly asks you to refine it.",
   "Use openai_image with images for project-local reference images or edit targets.",
  ],
  parameters: Type.Object({
   prompt: Type.String({ description: "Image generation/editing prompt. Pass the user's wording verbatim unless explicitly asked to refine it." }),
   action: Type.Optional(StringEnum(IMAGE_ACTIONS, { description: "Generate, edit/reference supplied images, or let the model decide." })),
   images: Type.Optional(Type.Array(Type.String(), { maxItems: 5, description: "Project-local image paths to use as edit targets or references." })),
   model: Type.Optional(Type.String({ description: "OpenAI Codex model override." })),
   outputFormat: Type.Optional(StringEnum(["png", "jpeg", "webp"] as const)),
   save: Type.Optional(StringEnum(["project", "global", "custom", "none"] as const)),
   saveDir: Type.Optional(Type.String({ description: "Save directory when save=custom." })),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
   const model = params.model?.trim() || (ctx.model?.provider === "openai-codex" ? ctx.model.id : config(ctx).image.defaultModel);
   onUpdate?.({ content: [{ type: "text", text: `Requesting OpenAI image_generation via openai-codex/${model}...` }] });
   const result = await generateImage(params.prompt, ctx, config(ctx), signal, params);
   const text = [`Generated image using OpenAI image_generation via openai-codex/${result.model}.`, `Action: ${result.action}.`, `Prompt: ${result.prompt}`, ...(result.savedPath ? [`Saved: ${result.savedPath}`] : [])].join("\n");
   return { content: [{ type: "text", text }, { type: "image", data: result.data, mimeType: result.mimeType }], details: result };
  },
 });
 pi.registerEntryRenderer(IMAGE_ENTRY, (entry, _options, theme) => { const d = entry.data as { savedPath?: string; data?: string; mimeType: string; prompt: string; model: string }; const c = new Container(); const box = new Box(1, 1, line => theme.bg("customMessageBg", line)); box.addChild(new Text(theme.fg("accent", theme.bold("[openai-image]")) + `\n${d.prompt}\n${theme.fg("dim", `${d.model}${d.savedPath ? ` · ${d.savedPath}` : ""}`)}`, 0, 0)); try { const data = d.data ?? (d.savedPath ? readFileSync(d.savedPath).toString("base64") : undefined); if (data) box.addChild(new Image(data, d.mimeType, { fallbackColor: line => theme.fg("dim", line) }, { maxWidthCells: 80, maxHeightCells: 24, filename: d.savedPath })); } catch {} c.addChild(box); return c; });
 pi.registerCommand("openai-settings", { description: "Configure Better OpenAI", handler: async (_args, ctx) => { const auth = await getCredentials(ctx); const c = config(ctx); await showSettings(ctx, c, (id, value) => { updateConfig(c.configPath, id, parseSetting(id, value)); cfg = resolveConfig(ctx); fast.desired = cfg.desiredActive; fast.apply(ctx, cfg); persistFast(ctx); if (id.startsWith("usage.")) start(ctx); }, `Config: ${c.configPath}\nModel: ${modelKey(ctx)} · Auth: ${auth?.source ?? "missing"} · Account: ${maskIdentifier(auth?.accountId)}${c.projectTrusted ? "" : "\nProject config ignored: project is untrusted"}`); } });
 pi.registerEntryRenderer(STATUS_ENTRY, (entry, _options, theme) => { const lines = (entry.data as { lines?: string[] }).lines ?? []; return new Text(`${theme.fg("accent", "[OpenAI]")}\n${theme.fg("dim", lines.join("\n"))}`, 0, 0); });
 pi.on("session_start", async (_event, ctx) => { cfg = resolveConfig(ctx); fast.initialize(ctx, cfg, pi.getFlag("fast") === true); persistFast(ctx); const current = start(ctx); if (current !== undefined) await refreshUsage(ctx, true, false, current); appendStatus(ctx); });
 pi.on("model_select", (_event, ctx) => { const before = fast.active; fast.apply(ctx, config(ctx)); if (before !== fast.active) persistFast(ctx); void refreshUsage(ctx, true); });
 pi.on("turn_end", (_event, ctx) => void refreshUsage(ctx));
 pi.on("before_provider_request", (event, ctx) => fast.inject(event.payload, ctx, config(ctx)));
 pi.on("session_shutdown", () => { stop(); cfg = undefined; usage = undefined; usageError = undefined; });
}
