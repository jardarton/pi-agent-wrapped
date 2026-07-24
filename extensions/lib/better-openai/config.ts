// Derived in part from mattleong/pi-better-openai (MIT). See THIRD_PARTY_NOTICES.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CONFIG_BASENAME = "pi-better-openai.json";
export const IMAGE_SAVE_MODES = ["project", "global", "custom", "none"] as const;
export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export type ImageSaveMode = (typeof IMAGE_SAVE_MODES)[number];
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export type SupportedModel = { provider: string; id: string };
export type RawConfig = Record<string, unknown>;
export interface ResolvedConfig {
 configPath: string; projectConfigPath: string; globalConfigPath: string; projectTrusted: boolean;
 persistState: boolean; desiredActive: boolean; active: boolean; supportedModels: SupportedModel[];
 usage: { enabled: boolean; refreshIntervalMs: number; showOnlyOnSubscriptionModels: boolean; showResetTimes: boolean };
 image: { enabled: boolean; defaultModel: string; defaultSave: ImageSaveMode; outputFormat: ImageFormat; timeoutMs: number; customDirectory?: string };
}
export const DEFAULT_SUPPORTED_MODELS = ["openai-codex/gpt-5.6-terra", "openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-sol"];
export const DEFAULT_CONFIG = {
 persistState: true, desiredActive: false, active: false, supportedModels: DEFAULT_SUPPORTED_MODELS,
 usage: { enabled: true, refreshIntervalMs: 60_000, showOnlyOnSubscriptionModels: true, showResetTimes: true },
 image: { enabled: true, defaultModel: "gpt-5.5", defaultSave: "project", outputFormat: "png", timeoutMs: 180_000 },
} as const;
const record = (v: unknown): v is RawConfig => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => typeof v === "boolean" ? v : fallback;
const clamp = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function agentDir(): string { return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"); }
export function configPaths(cwd: string) { return { project: join(cwd, CONFIG_DIR_NAME, "extensions", CONFIG_BASENAME), global: join(agentDir(), "extensions", CONFIG_BASENAME) }; }
export function readRawConfig(path: string): RawConfig { try { const v: unknown = JSON.parse(readFileSync(path, "utf8")); return record(v) ? v : {}; } catch { return {}; } }
export function writeRawConfig(path: string, value: RawConfig): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8"); }
export function parseModel(value: string): SupportedModel | undefined { const i = value.indexOf("/"); if (i < 1 || i === value.length - 1) return; const provider = value.slice(0, i).trim(), id = value.slice(i + 1).trim(); return provider && id ? { provider, id } : undefined; }
function parsed(path: string): RawConfig { return existsSync(path) ? readRawConfig(path) : {}; }
function validModels(v: unknown): SupportedModel[] | undefined { if (!Array.isArray(v)) return; return v.filter((x): x is string => typeof x === "string").map(parseModel).filter((x): x is SupportedModel => !!x); }
export function resolveConfig(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">): ResolvedConfig {
 const paths = configPaths(ctx.cwd || process.cwd()); const trusted = ctx.isProjectTrusted();
 const global = parsed(paths.global); const project = trusted ? parsed(paths.project) : {};
 const gu = record(global.usage) ? global.usage : {}, pu = record(project.usage) ? project.usage : {};
 const gi = record(global.image) ? global.image : {}, pi = record(project.image) ? project.image : {};
 const merged = { ...global, ...project }; const usage = { ...gu, ...pu }, image = { ...gi, ...pi };
 const save = IMAGE_SAVE_MODES.includes(image.defaultSave as ImageSaveMode) ? image.defaultSave as ImageSaveMode : DEFAULT_CONFIG.image.defaultSave;
 const format = IMAGE_FORMATS.includes(image.outputFormat as ImageFormat) ? image.outputFormat as ImageFormat : DEFAULT_CONFIG.image.outputFormat;
 return {
  configPath: trusted && existsSync(paths.project) ? paths.project : paths.global, projectConfigPath: paths.project, globalConfigPath: paths.global, projectTrusted: trusted,
  persistState: bool(merged.persistState, DEFAULT_CONFIG.persistState), desiredActive: bool(merged.desiredActive, bool(merged.active, false)), active: bool(merged.active, false),
  supportedModels: validModels(merged.supportedModels) ?? DEFAULT_SUPPORTED_MODELS.map(parseModel).filter((x): x is SupportedModel => !!x),
  usage: { enabled: bool(usage.enabled, true), refreshIntervalMs: clamp(usage.refreshIntervalMs, 60_000, 15_000, 600_000), showOnlyOnSubscriptionModels: bool(usage.showOnlyOnSubscriptionModels, true), showResetTimes: bool(usage.showResetTimes, true) },
  image: { enabled: bool(image.enabled, true), defaultModel: typeof image.defaultModel === "string" && image.defaultModel.trim() ? image.defaultModel.trim() : DEFAULT_CONFIG.image.defaultModel, defaultSave: save, outputFormat: format, timeoutMs: clamp(image.timeoutMs, 180_000, 30_000, 300_000), customDirectory: typeof image.customDirectory === "string" ? image.customDirectory : undefined },
 };
}
export function updateConfig(path: string, dottedKey: string, value: unknown): void { const raw = readRawConfig(path); const [section, key] = dottedKey.split("."); if (!key) raw[section] = value; else { const old = record(raw[section]) ? raw[section] as RawConfig : {}; raw[section] = { ...old, [key]: value }; } writeRawConfig(path, raw); }
