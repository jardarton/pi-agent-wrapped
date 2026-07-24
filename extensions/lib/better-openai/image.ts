// Derived in part from mattleong/pi-better-openai (MIT). See THIRD_PARTY_NOTICES.md.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig, ImageFormat, ImageSaveMode } from "./config.ts";
import { getCredentials } from "./auth.ts";
import { sanitizeError } from "./format.ts";

export const IMAGE_URL = "https://chatgpt.com/backend-api/codex/responses";
export const IMAGE_ACTIONS = ["auto", "generate", "edit"] as const;
export type ImageAction = (typeof IMAGE_ACTIONS)[number];
export interface ImageOptions { action?: ImageAction; images?: string[]; model?: string; outputFormat?: ImageFormat; save?: ImageSaveMode; saveDir?: string }
type ImageInput = { path: string; data: string; mimeType: string };
const MAX_IMAGE_INPUTS = 5, MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024, MAX_TOTAL_IMAGE_INPUT_BYTES = 50 * 1024 * 1024;
const agentDir = () => process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const mimeType = (format: string) => format === "jpg" || format === "jpeg" ? "image/jpeg" : `image/${format}`;
const displayPath = (path: string) => path.startsWith(`${homedir()}${sep}`) ? `~/${path.slice(homedir().length + 1)}` : path;
const inside = (root: string, child: string) => resolve(child).startsWith(`${resolve(root)}${sep}`);
function detectedFormat(data: Buffer): string | undefined {
 if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
 if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
 if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) return "gif";
 if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
}

async function readImageInputs(paths: string[] | undefined, cwd: string): Promise<ImageInput[]> {
 const workspace = resolve(cwd), realWorkspace = await realpath(workspace).catch(() => workspace), seen = new Set<string>();
 const validated: ImageInput[] = []; let total = 0;
 for (const raw of paths ?? []) {
  const value = raw.trim(); if (!value) continue;
  const path = isAbsolute(value) ? resolve(value) : resolve(workspace, value);
  const real = await realpath(path).catch(() => undefined);
  if (!inside(workspace, path) || !real || !inside(realWorkspace, real)) throw new Error(`Image input must be a file inside the current workspace: ${displayPath(path)}`);
  if (seen.has(real)) continue;
  const info = await stat(real).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`Image input must be a file inside the current workspace: ${displayPath(path)}`);
  if (info.size > MAX_IMAGE_INPUT_BYTES) throw new Error(`Image input is too large (max 20 MB): ${displayPath(path)}`);
  const data = await readFile(real); const format = detectedFormat(data);
  if (!format) throw new Error(`Image input is not a readable PNG, JPEG, WebP, or GIF image: ${displayPath(path)}`);
  if (validated.length >= MAX_IMAGE_INPUTS) throw new Error(`Too many image inputs (max ${MAX_IMAGE_INPUTS}).`);
  total += info.size; if (total > MAX_TOTAL_IMAGE_INPUT_BYTES) throw new Error("Image inputs are too large in total (max 50 MB).");
  seen.add(real); validated.push({ path: real, mimeType: mimeType(format), data: data.toString("base64") });
 }
 return validated;
}

export function buildImageRequest(prompt: string, model: string, outputFormat: string, images: ImageInput[] = [], action: ImageAction = "auto") {
 const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
 for (const image of images) content.push({ type: "input_image", detail: "auto", image_url: `data:${image.mimeType};base64,${image.data}` });
 const tool: Record<string, unknown> = { type: "image_generation", output_format: outputFormat }; if (action !== "auto") tool.action = action;
 return { model, instructions: "", input: [{ role: "user", content }], tools: [tool], tool_choice: { type: "image_generation" }, parallel_tool_calls: false, store: false, stream: true, include: [], client_metadata: { "x-codex-installation-id": "pi-better-openai" } };
}
function imageFromEvent(v: unknown): { id: string; data: string; mimeType: string } | undefined { if (!record(v)) return; const item = record(v.item) ? v.item : v; if (item.type !== "image_generation_call" || (item.status !== undefined && item.status !== "completed")) return; const raw = typeof item.result === "string" ? item.result : typeof item.b64_json === "string" ? item.b64_json : undefined; if (!raw) return; const m = raw.match(/^data:([^;,]+);base64,(.*)$/s); return { id: typeof item.id === "string" ? item.id : randomUUID(), data: m ? m[2] : raw, mimeType: m ? m[1] : "image/png" }; }
export async function parseImageSse(response: Response, signal?: AbortSignal) { if (!response.body) throw new Error("No image response body."); const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ""; try { while (true) { if (signal?.aborted) throw new Error("Image request cancelled."); const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let boundary = /\r?\n\r?\n/.exec(buffer); while (boundary) { const part = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length); const payload = part.split(/\r?\n/).filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n"); if (payload && payload !== "[DONE]") { let event: unknown; try { event = JSON.parse(payload); } catch { event = undefined; } const image = imageFromEvent(event); if (image) { await reader.cancel().catch(() => undefined); return image; } if (record(event) && event.type === "response.failed") { const error = record(event.response) && record(event.response.error) ? event.response.error : record(event.error) ? event.error : undefined; throw new Error(sanitizeError(typeof error?.message === "string" ? error.message : event.message ?? "Image generation failed.")); } if (record(event) && event.type === "error") throw new Error(sanitizeError(typeof event.message === "string" ? event.message : "Image generation failed.")); } boundary = /\r?\n\r?\n/.exec(buffer); } } } finally { reader.releaseLock(); } throw new Error("No completed image was returned."); }
const extension = (format: string) => format === "jpeg" ? "jpg" : format;
function outputDirectory(mode: ImageSaveMode, saveDir: string | undefined, cfg: ResolvedConfig, ctx: ExtensionContext): string | undefined { if (mode === "none") return; if (mode === "project") return join(ctx.cwd, ".pi", "generated-images"); if (mode === "global") return join(agentDir(), "generated-images"); const custom = saveDir?.trim() || cfg.image.customDirectory || process.env.PI_IMAGE_SAVE_DIR?.trim(); if (!custom) throw new Error("save=custom requires saveDir or PI_IMAGE_SAVE_DIR."); const expanded = custom.replace(/^~(?=\/)/, homedir()); return isAbsolute(expanded) ? resolve(expanded) : resolve(ctx.cwd, expanded); }
export async function generateImage(prompt: string, ctx: ExtensionContext, cfg: ResolvedConfig, outerSignal?: AbortSignal, options: ImageOptions = {}) { if (!cfg.image.enabled) throw new Error("OpenAI image generation is disabled."); const timeout = AbortSignal.timeout(cfg.image.timeoutMs), signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout; const auth = await getCredentials(ctx); if (!auth) throw new Error("Missing openai-codex OAuth credentials. Run /login openai-codex."); const modelOption = options.model?.trim(); const model = modelOption ? (modelOption.includes("/") ? modelOption.split("/").pop()! : modelOption) : ctx.model?.provider === "openai-codex" ? ctx.model.id : cfg.image.defaultModel; const outputFormat = options.outputFormat ?? cfg.image.outputFormat, action = options.action ?? "auto", save = options.save ?? cfg.image.defaultSave; const images = await readImageInputs(options.images, ctx.cwd); const response = await fetch(IMAGE_URL, { method: "POST", headers: { authorization: `Bearer ${auth.accessToken}`, "chatgpt-account-id": auth.accountId, "OpenAI-Beta": "responses=experimental", accept: "text/event-stream", "content-type": "application/json", originator: "codex_cli_rs", "User-Agent": "codex_cli_rs/0.0.0 (pi-better-openai)" }, body: JSON.stringify(buildImageRequest(prompt, model, outputFormat, images, action)), signal }); if (!response.ok) throw new Error(`OpenAI image request failed (${response.status}${response.statusText ? ` ${sanitizeError(response.statusText)}` : ""}).`); const image = await parseImageSse(response, signal); const dir = outputDirectory(save, options.saveDir, cfg, ctx); let savedPath: string | undefined; if (dir) { await mkdir(dir, { recursive: true }); savedPath = join(dir, `openai-image-${new Date().toISOString().replace(/[:.]/g, "-")}-${image.id.replace(/[^\w-]/g, "_")}.${extension(outputFormat)}`); await writeFile(savedPath, Buffer.from(image.data, "base64")); } return { ...image, status: "completed", prompt, model, action, outputFormat, savedPath }; }
export async function readSavedImage(path: string) { return (await readFile(path)).toString("base64"); }
export const _imageTest = { MAX_IMAGE_INPUTS, MAX_IMAGE_INPUT_BYTES, MAX_TOTAL_IMAGE_INPUT_BYTES };
