import test from "node:test";
import assert from "node:assert/strict";
import { FastController } from "../lib/better-openai/fast.ts";
const cfg: any = { supportedModels: [{ provider: "openai-codex", id: "gpt-6-sol" }], persistState: true, desiredActive: false };
test("fast mode only injects priority for supported models", () => { const fast = new FastController(); const ctx: any = { model: { provider: "openai-codex", id: "gpt-6-sol" } }; fast.desired = true; fast.apply(ctx, cfg); assert.deepEqual(fast.inject({ model: "x" }, ctx, cfg), { model: "x", service_tier: "priority" }); ctx.model.id = "unsupported"; fast.apply(ctx, cfg); assert.equal(fast.active, false); assert.equal(fast.inject({ model: "x" }, ctx, cfg), undefined); ctx.model.id = "gpt-6-sol"; fast.apply(ctx, cfg); assert.equal(fast.active, true); });
