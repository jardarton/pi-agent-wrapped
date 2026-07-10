import test from "node:test";
import assert from "node:assert/strict";
import { camofoxFetch } from "../camofox-browser.ts";

test("Camofox requests await API keys before building authorization", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CAMOFOX_API_KEY;
  process.env.CAMOFOX_API_KEY = "secret-key";
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-key");
      return new Response("ok");
    };
    assert.equal(await (await camofoxFetch("/screenshot")).text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CAMOFOX_API_KEY;
    else process.env.CAMOFOX_API_KEY = originalKey;
  }
});

test("Camofox requests propagate caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (_input, init) => {
      assert.ok(init?.signal);
      if (init.signal.aborted) throw init.signal.reason;
      return new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
      );
    };
    const pending = camofoxFetch("/health", {}, controller.signal);
    controller.abort();
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
