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

type SnapshotScope = {
  ref?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  occurrence?: number;
};

const CAMOFOX_LOADER_TOOL = "search_camofox_tools";
const CAMOFOX_EAGER_TOOLS = new Set([
  "camofox_create_tab",
  "camofox_list_tabs",
  "camofox_snapshot",
]);
const CAMOFOX_TOOL_KEYWORDS: Record<string, string> = {
  camofox_click: "interact activate press select link button",
  camofox_type: "interact input fill enter keyboard form",
  camofox_navigate: "url search macro visit open",
  camofox_go_back: "history previous navigation",
  camofox_go_forward: "history next navigation",
  camofox_refresh: "reload navigation",
  camofox_scroll: "page move up down left right",
  camofox_screenshot: "image visual capture png",
  camofox_close_tab: "delete remove tab",
  camofox_console: "debug logs messages javascript",
  camofox_errors: "debug failures exceptions page",
  camofox_console_clear: "debug reset logs errors",
  camofox_trace_start: "debug playwright recording begin",
  camofox_trace_stop: "debug playwright recording finish save",
  camofox_import_cookies: "authentication login session netscape cookies",
};
const CAMOFOX_LAZY_TOOLS = new Set(Object.keys(CAMOFOX_TOOL_KEYWORDS));

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

function decodeSnapshotName(raw: string | undefined) {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function snapshotLine(line: string) {
  const match = line.match(/^(\s*)-\s+([a-zA-Z][\w-]*)(?:\s+"((?:\\.|[^"])*)")?/);
  if (!match) return undefined;
  return {
    indent: match[1].length,
    role: match[2].toLowerCase(),
    name: decodeSnapshotName(match[3]),
  };
}

function validateSnapshotScope(scope: SnapshotScope | undefined) {
  if (!scope) return undefined;
  const targets = [scope.ref, scope.role].filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (targets.length !== 1) {
    throw new Error("snapshot scope requires exactly one of ref or role");
  }
  if (
    (scope.name !== undefined ||
      scope.exact !== undefined ||
      scope.occurrence !== undefined) &&
    !scope.role
  ) {
    throw new Error(
      "snapshot scope name, exact, and occurrence are only valid with role",
    );
  }
  return scope;
}

function matchingSnapshotLines(
  snapshot: string,
  scope: SnapshotScope,
) {
  const lines = snapshot.split("\n");
  if ("ref" in scope && scope.ref) {
    const escaped = scope.ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const refPattern = new RegExp(`\\[${escaped}\\](?=[:\\s]|$)`);
    return {
      lines,
      matches: lines.flatMap((line, index) =>
        refPattern.test(line) ? [index] : []),
    };
  }

  const role = scope.role?.trim().toLowerCase();
  const expectedName = scope.name?.trim().toLowerCase();
  const exact = scope.exact ?? false;
  return {
    lines,
    matches: lines.flatMap((line, index) => {
      const parsed = snapshotLine(line);
      if (!parsed || parsed.role !== role) return [];
      if (expectedName === undefined) return [index];
      const actualName = parsed.name?.trim().toLowerCase() ?? "";
      const matchesName = exact
        ? actualName === expectedName
        : actualName.includes(expectedName);
      return matchesName ? [index] : [];
    }),
  };
}

export function scopeAccessibilitySnapshot(
  snapshot: string,
  scope: SnapshotScope,
  maxDepth?: number,
) {
  const { lines, matches } = matchingSnapshotLines(snapshot, scope);
  if (scope.occurrence === undefined && matches.length > 1) {
    throw new Error(
      `snapshot scope is ambiguous (${matches.length} matches); provide occurrence`,
    );
  }
  const occurrence = scope.occurrence ?? 0;
  const start = matches[occurrence];
  if (start === undefined) return undefined;

  const root = snapshotLine(lines[start]);
  if (!root) return undefined;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim().length > 0 && (line.match(/^\s*/)?.[0].length ?? 0) <= root.indent) break;
    end++;
  }
  if (/^\[\.\.\. truncated at char \d+ of \d+\./.test(lines[end]?.trim() ?? "")) {
    throw new Error(
      "snapshot scope crosses a Camofox pagination boundary and cannot be returned safely",
    );
  }

  const subtree = lines.slice(start, end);
  if (maxDepth === undefined) return subtree.join("\n");
  const indentationLevels = [
    ...new Set(
      subtree
        .filter((line) => line.trim().length > 0)
        .map((line) => line.match(/^\s*/)?.[0].length ?? 0),
    ),
  ].sort((a, b) => a - b);
  return subtree
    .filter((line) => {
      if (line.trim().length === 0) return true;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      return indentationLevels.indexOf(indent) <= maxDepth;
    })
    .join("\n");
}

function snapshotNodeEnd(lines: string[], start: number, indent: number) {
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
    end++;
  }
  return end;
}

export function compactAccessibilitySnapshot(
  snapshot: string,
  roles?: string[],
  includeText = true,
  includeUrls = true,
) {
  const lines = snapshot.split("\n");
  const roleFilter = roles?.length
    ? new Set(roles.map((role) => role.trim().toLowerCase()))
    : undefined;
  return lines.flatMap((line, index) => {
    const node = snapshotLine(line);
    if (!node || (roleFilter && !roleFilter.has(node.role))) return [];
    const subtree = lines.slice(index, snapshotNodeEnd(lines, index, node.indent));
    const ref = line.match(/\[(e\d+)\]/)?.[1];
    const item: Record<string, unknown> = { role: node.role };
    if (node.name) item.name = node.name;
    if (ref) item.ref = ref;
    if (includeUrls) {
      const urls = [...new Set(subtree.flatMap((child) => {
        const match = child.match(/^\s*-\s+\/url:\s*(.+?)\s*$/);
        return match ? [match[1]] : [];
      }))];
      if (urls.length === 1) item.url = urls[0];
      else if (urls.length > 1) item.urls = urls;
    }
    if (includeText) {
      const text = [...new Set(subtree.flatMap((child) => {
        const parsed = snapshotLine(child);
        if (parsed?.name) return [parsed.name];
        const match = child.match(/^\s*-\s+(?!\/url:)[\w-]+:\s*(.+?)\s*$/);
        return match ? [match[1]] : [];
      }))].join(" · ");
      if (text && text !== node.name) item.text = text;
    }
    return [item];
  });
}

function snapshotSourceChunk(
  snapshot: string,
  offset: number,
  response: AnyParams,
) {
  if (!response.truncated) return snapshot;
  if (!response.hasMore) {
    const remaining = Math.max(0, Number(response.totalChars) - offset);
    if (!Number.isFinite(remaining) || snapshot.length < remaining) {
      throw new Error("Camofox returned an invalid final snapshot page");
    }
    return snapshot.slice(0, remaining);
  }
  const marker = snapshot.match(
    /\n\[\.\.\. truncated at char (\d+) of (\d+)\.[^\n]*\]\n/,
  );
  if (!marker || Number(marker[1]) !== response.nextOffset) {
    throw new Error("Camofox snapshot pagination marker did not match nextOffset");
  }
  return snapshot.slice(0, marker.index);
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
    "Get an accessibility snapshot with eN element refs. Optionally scope it to a ref or semantic role/name subtree and limit its depth to reduce tokens.",
    Type.Object({
      tabId: Type.String({ description: "Camofox tab id" }),
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Character offset for a paginated source snapshot",
        }),
      ),
      scope: Type.Optional(
        Type.Object(
          {
            ref: Type.Optional(
              Type.String({
                description: "Existing eN snapshot ref whose subtree to return",
              }),
            ),
            role: Type.Optional(
              Type.String({
                description: "Accessibility role whose subtree to return",
              }),
            ),
            name: Type.Optional(
              Type.String({
                description: "Accessible name to match when role is used",
              }),
            ),
            exact: Type.Optional(
              Type.Boolean({
                description:
                  "Match the complete accessible name instead of a case-insensitive substring",
              }),
            ),
            occurrence: Type.Optional(
              Type.Integer({
                minimum: 0,
                description:
                  "Zero-based match to return when multiple elements have the same role and name",
              }),
            ),
          },
          {
            description:
              "Scope target; provide exactly one of ref or role",
          },
        ),
      ),
      maxDepth: Type.Optional(Type.Integer({
        minimum: 0,
        maximum: 20,
        description: "Maximum accessibility-tree depth beneath the scoped root",
      })),
      compact: Type.Optional(Type.Boolean({
        description: "Return structured matching items instead of snapshot YAML",
      })),
      roles: Type.Optional(Type.Array(Type.String(), {
        description: "Accessibility roles to include in compact output",
        minItems: 1,
      })),
      includeText: Type.Optional(Type.Boolean({
        description: "Include descendant text in compact items (default true)",
      })),
      includeUrls: Type.Optional(Type.Boolean({
        description: "Include descendant URLs in compact items (default true)",
      })),
    }),
    async (p, ctx, signal) => {
      const requestedScope = validateSnapshotScope(p.scope);
      if (p.maxDepth !== undefined && !requestedScope) {
        throw new Error("maxDepth requires a snapshot scope");
      }
      if (
        (p.roles !== undefined ||
          p.includeText !== undefined ||
          p.includeUrls !== undefined) &&
        !p.compact
      ) {
        throw new Error("roles, includeText, and includeUrls require compact=true");
      }
      const uid = userId(ctx);
      const requestedOffset = Number.isInteger(p.offset) && p.offset >= 0
        ? p.offset
        : 0;
      let sourceOffset = requestedOffset;
      let r: any;
      let sourceSnapshot = "";
      let snapshot: string | undefined;
      const seenOffsets = new Set<number>();
      const sourceChunks: string[] = [];
      let sourceTruncated = false;
      while (true) {
        if (seenOffsets.has(sourceOffset)) {
          throw new Error("Camofox snapshot pagination returned a repeated offset");
        }
        seenOffsets.add(sourceOffset);
        r = await request(
          `/tabs/${encodeURIComponent(p.tabId)}/snapshot?userId=${encodeURIComponent(uid)}&offset=${sourceOffset}`,
          undefined,
          signal,
        );
        sourceSnapshot = typeof r.snapshot === "string" ? r.snapshot : "";
        sourceTruncated ||= !!r.truncated;
        if (!requestedScope) {
          snapshot = sourceSnapshot;
          break;
        }
        sourceChunks.push(snapshotSourceChunk(sourceSnapshot, sourceOffset, r));
        if (!r.hasMore) {
          sourceSnapshot = sourceChunks.join("");
          snapshot = scopeAccessibilitySnapshot(
            sourceSnapshot,
            requestedScope,
            p.maxDepth,
          );
          break;
        }
        if (!Number.isFinite(r.nextOffset) || r.nextOffset < 0) {
          throw new Error("Camofox snapshot pagination omitted a valid nextOffset");
        }
        sourceOffset = r.nextOffset;
      }
      if (requestedScope && snapshot === undefined) {
        throw new Error("snapshot scope was not found");
      }
      const refsCount = requestedScope
        ? new Set([...snapshot!.matchAll(/\[(e\d+)\]/g)].map((match) => match[1])).size
        : (r.refsCount ?? 0);
      const compactItems = p.compact
        ? compactAccessibilitySnapshot(
            snapshot ?? "",
            p.roles,
            p.includeText ?? true,
            p.includeUrls ?? true,
          )
        : undefined;
      const renderedSnapshot = compactItems
        ? JSON.stringify({ scope: requestedScope, items: compactItems }, null, 2)
        : (snapshot || "");
      const outputRefsCount = compactItems
        ? new Set(compactItems.flatMap((item) =>
            typeof item.ref === "string" ? [item.ref] : [],
          )).size
        : refsCount;
      const details = requestedScope
        ? {
            ...r,
            snapshot,
            refsCount: outputRefsCount,
            truncated: false,
            totalChars: renderedSnapshot.length,
            hasMore: false,
            nextOffset: null,
            sourceTotalChars: r.totalChars ?? sourceSnapshot.length,
            sourceTruncated,
            sourceHasMore: false,
            sourceNextOffset: null,
            sourceOffset: requestedOffset,
            sourcePages: seenOffsets.size,
            requestedScope,
            maxDepth: p.maxDepth,
            compactItems,
          }
        : compactItems
          ? {
              ...r,
              refsCount: outputRefsCount,
              totalChars: renderedSnapshot.length,
              compactItems,
            }
          : r;
      return {
        content: [
          {
            type: "text",
            text: [
              `url: ${r.url || ""}`,
              ...(requestedScope ? [`scope: ${JSON.stringify(requestedScope)}`] : []),
              `refsCount: ${outputRefsCount}`,
              `truncated: ${requestedScope ? false : !!r.truncated}`,
              `totalChars: ${p.compact || requestedScope ? renderedSnapshot.length : (r.totalChars ?? 0)}`,
              ...(requestedScope ? [`sourceTotalChars: ${r.totalChars ?? sourceSnapshot.length}`] : []),
              `hasMore: ${requestedScope ? false : !!r.hasMore}`,
              `nextOffset: ${requestedScope ? "null" : (r.nextOffset ?? "null")}`,
              "",
              renderedSnapshot,
            ].join("\n"),
          },
        ],
        details,
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

  pi.registerTool({
    name: CAMOFOX_LOADER_TOOL,
    label: "Search Camofox Tools",
    description:
      "Search for and enable additional Camofox browser tools, such as interaction, navigation, screenshots, debugging, tracing, and cookie import.",
    promptSnippet:
      "Use search_camofox_tools to enable additional browser operations when the active Camofox tools cannot perform the next step.",
    parameters: Type.Object({
      query: Type.String({ description: "Browser capability or operation to find" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, params) {
      const terms = params.query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 1 && !["and", "browser", "camofox", "for", "the", "tool", "tools", "with"].includes(term));
      const matches = pi.getAllTools()
        .filter((tool) => CAMOFOX_LAZY_TOOLS.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          score: terms.reduce((score, term) => {
            const haystack = `${tool.name} ${tool.description} ${CAMOFOX_TOOL_KEYWORDS[tool.name] ?? ""}`.toLowerCase();
            const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
            return score + (words.some((word) => word.startsWith(term) || term.startsWith(word)) ? 1 : 0);
          }, 0),
        }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, params.limit ?? 5)
        .map((match) => match.name);

      if (matches.length === 0) {
        return textResult(`No Camofox tools found for: ${params.query}`);
      }

      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);
      return textResult(
        added.length > 0
          ? `Loaded Camofox tools: ${added.join(", ")}`
          : `Matching Camofox tools already active: ${matches.join(", ")}`,
      );
    },
  });

  pi.on("session_start", () => {
    const active = pi.getActiveTools().filter((name) => !CAMOFOX_LAZY_TOOLS.has(name));
    pi.setActiveTools([...new Set([...active, ...CAMOFOX_EAGER_TOOLS, CAMOFOX_LOADER_TOOL])]);
  });
}
