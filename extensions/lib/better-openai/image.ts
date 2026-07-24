// Derived in part from mattleong/pi-better-openai (MIT). See THIRD_PARTY_NOTICES.md.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig, ImageFormat, ImageSaveMode } from "./config.ts";
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
function imageAccountId(token: string): string {
 const payload = token.split(".")[1];
 if (!payload) throw new Error("OpenAI Codex auth token is not a JWT. Run /login for openai-codex again.");
 try {
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const auth = record(claims) ? claims["https://api.openai.com/auth"] : undefined;
  if (record(auth) && typeof auth.chatgpt_account_id === "string" && auth.chatgpt_account_id) return auth.chatgpt_account_id;
 } catch {}
 throw new Error("OpenAI Codex auth token does not contain chatgpt_account_id. Run /login for openai-codex again.");
}
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

export function buildImageRequest(prompt: string, model: string, outputFormat: string, images: ImageInput[] = [], action: ImageAction = "auto", sessionId?: string) {
 const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
 for (const image of images) content.push({ type: "input_image", detail: "auto", image_url: `data:${image.mimeType};base64,${image.data}` });
 // The Codex backend infers generate vs. edit from the presence of input images.
 // Sending the older image_generation action field can make current routing models reject the request.
 void action;
 return { model, store: false, stream: true, prompt_cache_key: sessionId || "pi-better-openai", instructions: "You are generating bitmap image assets. For this request, call the image_generation tool exactly once. Do not answer with only text unless image generation is unavailable.", input: [{ role: "user", content }], tools: [{ type: "image_generation", output_format: outputFormat }], tool_choice: "auto", parallel_tool_calls: false, text: { verbosity: "low" } };
}
function imageFromEvent(v: unknown): { id: string; data: string; mimeType: string } | undefined { if (!record(v)) return; const item = record(v.item) ? v.item : v; if (item.type !== "image_generation_call") return; const raw = typeof item.result === "string" ? item.result : typeof item.b64_json === "string" ? item.b64_json : undefined; if (!raw) return; const m = raw.match(/^data:([^;,]+);base64,(.*)$/s); return { id: typeof item.id === "string" ? item.id : randomUUID(), data: m ? m[2] : raw, mimeType: m ? m[1] : "image/png" }; }
export async function parseImageSse(response: Response, signal?: AbortSignal) {
 if (!response.body) throw new Error("No image response body.");
 const reader = response.body.getReader(), decoder = new TextDecoder();
 let buffer = "", lastEvent: unknown;
 const parsePart = (part: string) => {
  const payload = part.split(/\r?\n/).filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n");
  if (!payload || payload === "[DONE]") return;
  let event: unknown; try { event = JSON.parse(payload); } catch { return; }
  lastEvent = event;
  const image = imageFromEvent(event); if (image) return image;
  if (record(event) && (event.type === "response.failed" || event.type === "error")) {
   const responseError = record(event.response) && record(event.response.error) ? event.response.error : undefined;
   const error = responseError ?? (record(event.error) ? event.error : undefined);
   throw new Error(sanitizeError(typeof error?.message === "string" ? error.message : event.message ?? "Image generation failed.", 600));
  }
 };
 try {
  while (true) {
   if (signal?.aborted) throw new Error("Image request cancelled.");
   const chunk = await reader.read(); if (chunk.done) break;
   buffer += decoder.decode(chunk.value, { stream: true });
   let boundary = /\r?\n\r?\n/.exec(buffer);
   while (boundary) {
    const image = parsePart(buffer.slice(0, boundary.index));
    buffer = buffer.slice(boundary.index + boundary[0].length);
    if (image) { await reader.cancel().catch(() => undefined); return image; }
    boundary = /\r?\n\r?\n/.exec(buffer);
   }
  }
  buffer += decoder.decode();
  const image = parsePart(buffer); if (image) return image;
 } finally { reader.releaseLock(); }
 let detail = "";
 if (record(lastEvent)) {
  const terminal = record(lastEvent.response) ? lastEvent.response : lastEvent;
  const useful = { type: lastEvent.type, status: terminal.status, error: terminal.error, incomplete_details: terminal.incomplete_details, output: terminal.output };
  detail = sanitizeError(JSON.stringify(useful), 800);
 }
 throw new Error(`No completed image was returned${detail ? `; final OpenAI event: ${detail}` : "."}`);
}
export async function imageHttpError(response: Response): Promise<Error> {
 let detail = "";
 try {
  const body = (await response.text()).trim();
  if (body) {
   let parsed: unknown; try { parsed = JSON.parse(body); } catch { parsed = body; }
   if (record(parsed)) {
    const error = record(parsed.error) ? parsed.error : parsed;
    detail = typeof error.message === "string" ? error.message : typeof error.code === "string" ? error.code : JSON.stringify(parsed);
   } else detail = String(parsed);
  }
 } catch {}
 const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
 return new Error(`OpenAI image request failed (${sanitizeError(status, 120)})${detail ? `: ${sanitizeError(detail, 600)}` : "."}`);
}
const extension = (format: string) => format === "jpeg" ? "jpg" : format;
function outputDirectory(mode: ImageSaveMode, saveDir: string | undefined, cfg: ResolvedConfig, ctx: ExtensionContext): string | undefined { if (mode === "none") return; if (mode === "project") return join(ctx.cwd, ".pi", "generated-images"); if (mode === "global") return join(agentDir(), "generated-images"); const custom = saveDir?.trim() || cfg.image.customDirectory || process.env.PI_IMAGE_SAVE_DIR?.trim(); if (!custom) throw new Error("save=custom requires saveDir or PI_IMAGE_SAVE_DIR."); const expanded = custom.replace(/^~(?=\/)/, homedir()); return isAbsolute(expanded) ? resolve(expanded) : resolve(ctx.cwd, expanded); }
export async function generateImage(prompt: string, ctx: ExtensionContext, cfg: ResolvedConfig, outerSignal?: AbortSignal, options: ImageOptions = {}) { if (!cfg.image.enabled) throw new Error("OpenAI image generation is disabled."); const timeout = AbortSignal.timeout(cfg.image.timeoutMs), signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout; const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex"); if (!token) throw new Error("Missing openai-codex OAuth credentials. Run /login openai-codex."); const accountId = imageAccountId(token); const modelOption = options.model?.trim(); const model = modelOption ? (modelOption.includes("/") ? modelOption.split("/").pop()! : modelOption) : cfg.image.defaultModel; const outputFormat = options.outputFormat ?? cfg.image.outputFormat, action = options.action ?? "auto", save = options.save ?? cfg.image.defaultSave; const images = await readImageInputs(options.images, ctx.cwd); const sessionId = ctx.sessionManager.getSessionId(); const response = await fetch(IMAGE_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi", "OpenAI-Beta": "responses=experimental", accept: "text/event-stream", "content-type": "application/json" }, body: JSON.stringify(buildImageRequest(prompt, model, outputFormat, images, action, sessionId)), signal }); if (!response.ok) throw await imageHttpError(response); const image = await parseImageSse(response, signal); const dir = outputDirectory(save, options.saveDir, cfg, ctx); let savedPath: string | undefined; if (dir) { await mkdir(dir, { recursive: true }); savedPath = join(dir, `openai-image-${new Date().toISOString().replace(/[:.]/g, "-")}-${image.id.replace(/[^\w-]/g, "_")}.${extension(outputFormat)}`); await writeFile(savedPath, Buffer.from(image.data, "base64")); } return { ...image, status: "completed", prompt, model, action, outputFormat, savedPath }; }
export async function readSavedImage(path: string) { return (await readFile(path)).toString("base64"); }
export const _imageTest = { MAX_IMAGE_INPUTS, MAX_IMAGE_INPUT_BYTES, MAX_TOTAL_IMAGE_INPUT_BYTES };
