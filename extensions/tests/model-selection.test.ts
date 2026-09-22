import assert from "node:assert/strict";
import test from "node:test";
import { cheapModelArgs, resolveCheapModel } from "../lib/model-selection.ts";

const CHEAP_MODEL_ENV = [
	"PI_CHEAP_MODEL",
	"PI_CHEAP_FALLBACK_MODELS",
	"PI_TEST_MODEL",
	"PI_TEST_FALLBACK_MODELS",
] as const;

async function withoutCheapModelEnv<T>(fn: () => Promise<T>): Promise<T> {
	const saved = Object.fromEntries(CHEAP_MODEL_ENV.map((name) => [name, process.env[name]]));
	for (const name of CHEAP_MODEL_ENV) delete process.env[name];
	try {
		return await fn();
	} finally {
		for (const name of CHEAP_MODEL_ENV) {
			const value = saved[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test("default cheap model is Terra at low reasoning", async () => {
	await withoutCheapModelEnv(async () => {
		const args = cheapModelArgs();
		assert.equal(args[0], "openai-codex/gpt-6-luna:low");
		assert.ok(args.every((arg) => arg.endsWith(":low")));

		const ctx = {
			modelRegistry: {
				find: (provider: string, id: string) => ({ provider, id }),
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }),
			},
		} as any;
		const selected = await resolveCheapModel(ctx);
		assert.ok(!("error" in selected));
		assert.deepEqual(selected.config, {
			provider: "openai-codex",
			id: "gpt-6-luna",
			thinkingLevel: "low",
			reserveTokens: undefined,
		});
	});
});
