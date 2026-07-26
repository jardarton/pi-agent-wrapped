import test from "node:test";
import assert from "node:assert/strict";
import camofoxBrowser, {
  camofoxFetch,
  compactAccessibilitySnapshot,
  scopeAccessibilitySnapshot,
} from "../camofox-browser.ts";

const snapshot = `- banner:
  - heading "Header"
- main:
  - heading "Listing"
  - region "Mer som dette":
    - article:
      - link "Gaming PC" [e31]:
        - /url: /470392218
      - paragraph: 15 999 kr
    - article:
      - link "Workstation" [e32]:
        - /url: /470392219
- contentinfo:
  - paragraph: Footer`;

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

test("Camofox dynamically loads optional tools", async () => {
  const tools = new Map<string, any>();
  const handlers = new Map<string, () => void>();
  let active = ["read", "camofox_click", "camofox_console"];
  const pi = {
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    on(event: string, handler: () => void) { handlers.set(event, handler); },
    getAllTools: () => [...tools.values()],
    getActiveTools: () => active,
    setActiveTools(names: string[]) { active = names; },
  };

  camofoxBrowser(pi as any);
  handlers.get("session_start")?.();

  assert.deepEqual(
    active,
    ["read", "camofox_create_tab", "camofox_list_tabs", "camofox_snapshot", "search_camofox_tools"],
  );

  const result = await tools.get("search_camofox_tools").execute(
    "call-1",
    { query: "fill and click a form" },
  );
  assert.ok(active.includes("camofox_click"));
  assert.ok(active.includes("camofox_type"));
  assert.equal(active.includes("camofox_console_clear"), false);
  assert.equal(active.includes("camofox_go_forward"), false);
  assert.match(result.content[0].text, /Loaded Camofox tools/);
});

test("Camofox scopes accessibility snapshots by semantic region, ref, and depth", () => {
  const region = scopeAccessibilitySnapshot(snapshot, {
    role: "region",
    name: "mer som dette",
    exact: true,
  });
  assert.match(region!, /Gaming PC/);
  assert.match(region!, /Workstation/);
  assert.doesNotMatch(region!, /Header|Footer/);

  const ref = scopeAccessibilitySnapshot(snapshot, { ref: "e31" });
  assert.match(ref!, /Gaming PC/);
  assert.match(ref!, /\/470392218/);
  assert.doesNotMatch(ref!, /Workstation/);

  const shallow = scopeAccessibilitySnapshot(
    snapshot,
    { role: "region", name: "Mer som dette", exact: true },
    1,
  );
  assert.match(shallow!, /article/);
  assert.doesNotMatch(shallow!, /Gaming PC|Workstation/);

  assert.throws(
    () => scopeAccessibilitySnapshot(snapshot, { role: "article" }),
    /ambiguous \(2 matches\)/,
  );
  const secondArticle = scopeAccessibilitySnapshot(snapshot, {
    role: "article",
    occurrence: 1,
  });
  assert.match(secondArticle!, /Workstation/);
  assert.doesNotMatch(secondArticle!, /Gaming PC/);
});

test("Camofox rejects a scoped subtree cut by source pagination", () => {
  const paginated = `- main:
  - region "Results":
    - article:
      - link "First" [e1]
[... truncated at char 100 of 200. Call snapshot with offset=100 to see more. Pagination links below. ...]
- navigation "Pagination":
  - link "Next" [e9]`;
  assert.throws(
    () => scopeAccessibilitySnapshot(paginated, {
      role: "region",
      name: "Results",
      exact: true,
    }),
    /crosses a Camofox pagination boundary/,
  );
});

test("Camofox compacts selected roles with refs, text, and URLs", () => {
  const region = scopeAccessibilitySnapshot(snapshot, {
    role: "region",
    name: "Mer som dette",
    exact: true,
  });
  const items = compactAccessibilitySnapshot(region!, ["article", "link"]);
  assert.equal(items.length, 4);
  assert.deepEqual(items[1], {
    role: "link",
    name: "Gaming PC",
    ref: "e31",
    url: "/470392218",
  });
  assert.match(String(items[0].text), /Gaming PC · 15 999 kr/);
  assert.equal(items[0].url, "/470392218");
});

test("camofox_snapshot returns only a requested semantic subtree", async () => {
  const originalFetch = globalThis.fetch;
  const tools = new Map<string, any>();
  const pi = {
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    on() {},
    getAllTools: () => [...tools.values()],
    getActiveTools: () => [],
    setActiveTools() {},
  };
  camofoxBrowser(pi as any);

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      url: "https://example.com/listing",
      snapshot,
      refsCount: 2,
      truncated: false,
      totalChars: snapshot.length,
      hasMore: false,
      nextOffset: null,
    }), { headers: { "content-type": "application/json" } });

    const result = await tools.get("camofox_snapshot").execute(
      "call-1",
      {
        tabId: "tab-1",
        scope: { role: "region", name: "Mer som dette", exact: true },
      },
      undefined,
      undefined,
      { sessionManager: { getSessionId: () => "session-1" } },
    );

    assert.match(result.content[0].text, /Gaming PC/);
    assert.doesNotMatch(result.content[0].text, /Header|Footer/);
    assert.equal(result.details.refsCount, 2);
    assert.ok(result.details.totalChars < result.details.sourceTotalChars);
    await assert.rejects(
      tools.get("camofox_snapshot").execute(
        "call-2",
        { tabId: "tab-1", maxDepth: 2 },
        undefined,
        undefined,
        { sessionManager: { getSessionId: () => "session-1" } },
      ),
      /maxDepth requires a snapshot scope/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("camofox_snapshot searches source pages and reports scoped pagination metadata", async () => {
  const originalFetch = globalThis.fetch;
  const tools = new Map<string, any>();
  const requests: string[] = [];
  const pi = {
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    on() {},
    getAllTools: () => [...tools.values()],
    getActiveTools: () => [],
    setActiveTools() {},
  };
  camofoxBrowser(pi as any);

  try {
    const fullSnapshot = `${"x".repeat(99)}\n${snapshot}`;
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const firstPage = url.endsWith("offset=0");
      return new Response(JSON.stringify({
        url: "https://example.com/listing",
        snapshot: firstPage
          ? `${fullSnapshot.slice(0, 100)}\n[... truncated at char 100 of ${fullSnapshot.length}. Call snapshot with offset=100 to see more. Pagination links below. ...]\n`
          : `${fullSnapshot.slice(100)}\n`,
        refsCount: 2,
        truncated: true,
        totalChars: fullSnapshot.length,
        hasMore: firstPage,
        nextOffset: firstPage ? 100 : null,
      }), { headers: { "content-type": "application/json" } });
    };

    const result = await tools.get("camofox_snapshot").execute(
      "call-1",
      {
        tabId: "tab-1",
        scope: { role: "region", name: "Mer som dette", exact: true },
      },
      undefined,
      undefined,
      { sessionManager: { getSessionId: () => "session-1" } },
    );

    assert.equal(requests.length, 2);
    assert.match(requests[0], /offset=0$/);
    assert.match(requests[1], /offset=100$/);
    assert.match(result.content[0].text, /Gaming PC/);
    assert.match(result.content[0].text, /Workstation/);
    assert.doesNotMatch(result.content[0].text, /Header|Footer/);
    assert.equal(result.details.truncated, false);
    assert.equal(result.details.hasMore, false);
    assert.equal(result.details.nextOffset, null);
    assert.equal(result.details.sourceTruncated, true);
    assert.equal(result.details.sourceOffset, 0);
    assert.equal(result.details.sourcePages, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
