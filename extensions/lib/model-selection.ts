import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type ModelConfig = {
	provider: string;
	id: string;
	reserveTokens?: number;
};

const DEFAULT_CHEAP_MODEL = "openai-codex/gpt-5.4-mini";
const DEFAULT_CHEAP_FALLBACK_MODELS = [
	"github-copilot/gpt-5.4-mini",
	"anthropic/claude-haiku-4-5",
	"openai-codex/gpt-5.4",
	"github-copilot/gpt-5.4",
	"openai-codex/gpt-5.5",
	"github-copilot/gpt-5.5",
].join(",");

function parseModelRef(value: string): ModelConfig | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const separator = trimmed.includes("/") ? "/" : trimmed.includes(":") ? ":" : null;
	if (!separator) return null;

	const [provider, ...rest] = trimmed.split(separator);
	const id = rest.join(separator);
	if (!provider || !id) return null;

	return { provider, id };
}

function normalizeModelArg(raw: string): string {
	return raw.includes(":") ? raw : `${raw}:medium`;
}

function splitList(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function cheapModelCandidates(primaryEnv?: string, fallbackEnv?: string): string[] {
	const primary =
		process.env[primaryEnv ?? ""] ??
		process.env.PI_CHEAP_MODEL ??
		DEFAULT_CHEAP_MODEL;
	const fallbacks = splitList(
		process.env[fallbackEnv ?? ""] ??
		process.env.PI_CHEAP_FALLBACK_MODELS ??
		DEFAULT_CHEAP_FALLBACK_MODELS,
	);
	return [...new Set([primary, ...fallbacks])];
}

export function cheapModelArgs(primaryEnv?: string, fallbackEnv?: string): string[] {
	return cheapModelCandidates(primaryEnv, fallbackEnv).map(normalizeModelArg);
}

export async function resolveCheapModel(
	ctx: ExtensionContext,
	options?: {
		primaryEnv?: string;
		fallbackEnv?: string;
		reserveTokens?: number;
	},
): Promise<
	| {
			config: ModelConfig;
			model: any;
			apiKey: string;
			headers?: Record<string, string>;
		}
	| { error: string }
> {
	for (const ref of cheapModelCandidates(options?.primaryEnv, options?.fallbackEnv)) {
		const config = parseModelRef(ref);
		if (!config) continue;

		const model = ctx.modelRegistry.find(config.provider, config.id);
		if (!model) continue;

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) continue;

		return {
			config: {
				...config,
				reserveTokens: options?.reserveTokens,
			},
			model,
			apiKey: auth.apiKey,
			headers: auth.headers,
		};
	}

	const candidates = cheapModelCandidates(options?.primaryEnv, options?.fallbackEnv).join(", ");
	return { error: `No available cheap model from: ${candidates}` };
}
