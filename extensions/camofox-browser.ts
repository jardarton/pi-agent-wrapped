import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { Type } from "typebox";

const MACROS = [
  "@google_search",
  "@youtube_search",
  "@amazon_search",
  "@reddit_search",
  "@reddit_subreddit",
  "@wikipedia_search",
  "@twitter_search",
  "@yelp_search",
  "@spotify_search",
  "@netflix_search",
  "@linkedin_search",
  "@instagram_search",
  "@tiktok_search",
  "@twitch_search",
] as const;

const baseUrl = () =>
  (
    process.env.CAMOFOX_URL ||
    process.env.CAMOFOX_BROWSER_URL ||
    "http://localhost:9377"
  ).replace(/\/+$/, "");
async function apiKey() {
  if (process.env.CAMOFOX_API_KEY) return process.env.CAMOFOX_API_KEY;
  if (!process.env.CAMOFOX_API_KEY_FILE) return "";

  return (await fs.readFile(process.env.CAMOFOX_API_KEY_FILE, "utf8")).trim();
}
const fallbackUserId = `pi-camofox-${randomUUID()}`;
const DEFAULT_TIMEOUT_MS = 30_000;
const executionSignal = new AsyncLocalStorage<AbortSignal | undefined>();

type ToolCtx = Parameters<
  Parameters<ExtensionAPI["registerTool"]>[0]["execute"]
>[4];
type AnyParams = Record<string, any>;

function currentSessionId(ctx: ToolCtx) {
  return ctx.sessionManager?.getSessionId?.();
}

function userId(ctx: ToolCtx, explicit?: string) {
  return (
    explicit ||
    process.env.CAMOFOX_USER_ID ||
    currentSessionId(ctx) ||
    fallbackUserId
  );
}

function sessionKey(ctx: ToolCtx) {
  return process.env.CAMOFOX_SESSION_KEY || currentSessionId(ctx) || "default";
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    details: data,
  };
}

function timeoutMs() {
  const configured = Number(process.env.CAMOFOX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function camofoxFetch(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";
  const key = await apiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const signals = [signal, init.signal].filter(
    (candidate): candidate is AbortSignal => candidate != null,
  );
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
    signal: requestSignal(
      signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    ),
  });
  return res;
}

async function request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
  const res = await camofoxFetch(path, init, signal ?? executionSignal.getStore());
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function readNetscapeCookies(path: string, domainSuffix?: string) {
  const raw = await fs.readFile(path, "utf8");
  return raw.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))
    )
      return [];
    const httpOnly = trimmed.startsWith("#HttpOnly_");
    const clean = httpOnly ? trimmed.slice("#HttpOnly_".length) : trimmed;
    const [
      domain,
      _includeSubdomains,
      pathValue,
      secure,
      expires,
      name,
      value,
    ] = clean.split("\t");
    if (!domain || !pathValue || !name || value == null) return [];
    if (domainSuffix && !domain.endsWith(domainSuffix)) return [];
    return [
      {
        domain,
        path: pathValue,
        name,
        value,
        httpOnly,
        secure: secure === "TRUE",
        expires: Number(expires) || undefined,
      },
    ];
  });
}

export default function camofoxBrowser(pi: ExtensionAPI) {
  pi.registerCommand("camofox", {
    description: "Camofox browser API status",
    handler: async (_args, ctx) => {
      try {
        ctx.ui.notify(
          `Camofox ${baseUrl()}: ${JSON.stringify(await request("/health"))}`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(
          `Camofox unreachable at ${baseUrl()}: ${(err as Error).message}`,
          "error",
        );
      }
    },
  });

  const reg = (
    name: string,
    description: string,
    parameters: any,
    fn: (p: AnyParams, ctx: ToolCtx, signal?: AbortSignal) => Promise<any>,
  ) =>
    pi.registerTool({
      name,
      label: name,
      description,
      parameters,
      execute: async (_id, params, signal, _update, ctx) =>
        executionSignal.run(signal, () => fn(params as AnyParams, ctx, signal)),
    });

  const Tab = Type.Object({
    tabId: Type.String({ description: "Camofox tab id" }),
  });

  reg(
    "camofox_create_tab",
    "Create a new Camofox anti-detection browser tab. Prefer for web browsing.",
    Type.Object({ url: Type.String() }),
    async (p, ctx, signal) =>
      textResult(
        await request("/tabs", {
          method: "POST",
          body: JSON.stringify({
            ...p,
            userId: userId(ctx),
            sessionKey: sessionKey(ctx),
          }),
        }, signal),
      ),
  );
  reg(
    "camofox_snapshot",
    "Get accessibility snapshot with eN element refs and pagination metadata.",
    Type.Object({ tabId: Type.String(), offset: Type.Optional(Type.Number()) }),
    async (p, ctx, signal) => {
      const r: any = await request(
        `/tabs/${encodeURIComponent(p.tabId)}/snapshot?userId=${encodeURIComponent(userId(ctx))}&offset=${Number.isFinite(p.offset) ? p.offset : 0}`,
        undefined,
        signal,
      );
      return {
        content: [
          {
            type: "text",
            text: [
              `url: ${r.url || ""}`,
              `refsCount: ${r.refsCount ?? 0}`,
              `truncated: ${!!r.truncated}`,
              `totalChars: ${r.totalChars ?? 0}`,
              `hasMore: ${!!r.hasMore}`,
              `nextOffset: ${r.nextOffset ?? "null"}`,
              "",
              r.snapshot || "",
            ].join("\n"),
          },
        ],
        details: r,
      };
    },
  );
  reg(
    "camofox_click",
    "Click by snapshot ref or CSS selector.",
    Type.Intersect([
      Tab,
      Type.Object({
        ref: Type.Optional(Type.String()),
        selector: Type.Optional(Type.String()),
      }),
    ]),
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/click`, {
          method: "POST",
          body: JSON.stringify({
            ref: p.ref,
            selector: p.selector,
            userId: userId(ctx),
          }),
        }),
      ),
  );
  reg(
    "camofox_type",
    "Type text into an element by ref or selector; optionally press Enter.",
    Type.Intersect([
      Tab,
      Type.Object({
        text: Type.String(),
        ref: Type.Optional(Type.String()),
        selector: Type.Optional(Type.String()),
        pressEnter: Type.Optional(Type.Boolean()),
      }),
    ]),
    async (p, ctx) => {
      const uid = userId(ctx);
      const r = await request(`/tabs/${encodeURIComponent(p.tabId)}/type`, {
        method: "POST",
        body: JSON.stringify({
          text: p.text,
          ref: p.ref,
          selector: p.selector,
          userId: uid,
        }),
      });
      if (p.pressEnter)
        await request(`/tabs/${encodeURIComponent(p.tabId)}/press`, {
          method: "POST",
          body: JSON.stringify({ key: "Enter", userId: uid }),
        });
      return textResult(r);
    },
  );
  reg(
    "camofox_navigate",
    "Navigate a tab to a URL or search macro.",
    Type.Intersect([
      Tab,
      Type.Object({
        url: Type.Optional(Type.String()),
        macro: Type.Optional(Type.Union(MACROS.map((m) => Type.Literal(m)))),
        query: Type.Optional(Type.String()),
      }),
    ]),
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/navigate`, {
          method: "POST",
          body: JSON.stringify({
            url: p.url,
            macro: p.macro,
            query: p.query,
            userId: userId(ctx),
          }),
        }),
      ),
  );
  for (const [name, route, desc] of [
    ["camofox_go_back", "back", "Go back"],
    ["camofox_go_forward", "forward", "Go forward"],
    ["camofox_refresh", "refresh", "Refresh page"],
  ] as const)
    reg(name, desc, Tab, async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/${route}`, {
          method: "POST",
          body: JSON.stringify({ userId: userId(ctx) }),
        }),
      ),
    );
  reg(
    "camofox_scroll",
    "Scroll the page.",
    Type.Intersect([
      Tab,
      Type.Object({
        direction: Type.Union([
          Type.Literal("up"),
          Type.Literal("down"),
          Type.Literal("left"),
          Type.Literal("right"),
        ]),
        amount: Type.Optional(Type.Number()),
      }),
    ]),
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/scroll`, {
          method: "POST",
          body: JSON.stringify({
            direction: p.direction,
            amount: p.amount,
            userId: userId(ctx),
          }),
        }),
      ),
  );
  reg("camofox_screenshot", "Take a PNG screenshot.", Tab, async (p, ctx, signal) => {
    const res = await camofoxFetch(
      `/tabs/${encodeURIComponent(p.tabId)}/screenshot?userId=${encodeURIComponent(userId(ctx))}`,
      {},
      signal,
    );
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(await res.arrayBuffer()).toString("base64"),
          mimeType: "image/png",
        },
      ],
      details: {},
    };
  });
  reg("camofox_close_tab", "Close a tab.", Tab, async (p, ctx) =>
    textResult(
      await request(
        `/tabs/${encodeURIComponent(p.tabId)}?userId=${encodeURIComponent(userId(ctx))}`,
        { method: "DELETE" },
      ),
    ),
  );
  reg(
    "camofox_list_tabs",
    "List Camofox tabs for this Pi session.",
    Type.Object({}),
    async (_p, ctx) =>
      textResult(
        await request(`/tabs?userId=${encodeURIComponent(userId(ctx))}`),
      ),
  );
  reg(
    "camofox_console",
    "Get captured console messages.",
    Type.Intersect([
      Tab,
      Type.Object({
        type: Type.Optional(
          Type.Union([
            Type.Literal("log"),
            Type.Literal("warning"),
            Type.Literal("error"),
            Type.Literal("info"),
            Type.Literal("debug"),
          ]),
        ),
        limit: Type.Optional(Type.Number()),
      }),
    ]),
    async (p, ctx) => {
      const q = new URLSearchParams({ userId: userId(ctx) });
      if (p.type) q.set("type", p.type);
      if (p.limit) q.set("limit", String(p.limit));
      return textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/console?${q}`),
      );
    },
  );
  reg(
    "camofox_errors",
    "Get captured uncaught page errors.",
    Type.Intersect([Tab, Type.Object({ limit: Type.Optional(Type.Number()) })]),
    async (p, ctx) => {
      const q = new URLSearchParams({ userId: userId(ctx) });
      if (p.limit) q.set("limit", String(p.limit));
      return textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/errors?${q}`),
      );
    },
  );
  reg(
    "camofox_console_clear",
    "Clear captured console messages and errors.",
    Tab,
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/console/clear`, {
          method: "POST",
          body: JSON.stringify({ userId: userId(ctx) }),
        }),
      ),
  );
  reg(
    "camofox_trace_start",
    "Start Playwright trace recording.",
    Type.Intersect([
      Tab,
      Type.Object({
        screenshots: Type.Optional(Type.Boolean()),
        snapshots: Type.Optional(Type.Boolean()),
      }),
    ]),
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/trace/start`, {
          method: "POST",
          body: JSON.stringify({
            userId: userId(ctx),
            screenshots: p.screenshots ?? true,
            snapshots: p.snapshots ?? true,
          }),
        }),
      ),
  );
  reg(
    "camofox_trace_stop",
    "Stop Playwright trace recording.",
    Type.Intersect([
      Tab,
      Type.Object({ outputPath: Type.Optional(Type.String()) }),
    ]),
    async (p, ctx) =>
      textResult(
        await request(`/tabs/${encodeURIComponent(p.tabId)}/trace/stop`, {
          method: "POST",
          body: JSON.stringify({ userId: userId(ctx), path: p.outputPath }),
        }),
      ),
  );
  reg(
    "camofox_import_cookies",
    "Import Netscape cookies.txt into this Camofox user session.",
    Type.Object({
      cookiesPath: Type.String(),
      domainSuffix: Type.Optional(Type.String()),
    }),
    async (p, ctx) => {
      const cookies = await readNetscapeCookies(p.cookiesPath, p.domainSuffix);
      const uid = userId(ctx);
      const r = await request(`/sessions/${encodeURIComponent(uid)}/cookies`, {
        method: "POST",
        body: JSON.stringify({ cookies }),
      });
      return textResult({ imported: cookies.length, userId: uid, result: r });
    },
  );
}
