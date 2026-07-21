import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { access, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";

const QUERY_FILE = fileURLToPath(
  new URL("./lib/nix-options-query.nix", import.meta.url),
);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const NixOptionsParameters = Type.Object({
  action: StringEnum(["configurations", "search", "inspect"] as const, {
    description:
      "List configurations, search evaluated option names, or inspect one exact option.",
  }),
  flake: Type.Optional(
    Type.String({
      description:
        "Flake directory or flake reference. Defaults to the nearest parent containing flake.nix.",
    }),
  ),
  configuration: Type.Optional(
    Type.String({
      description:
        "Configuration name or full output path, such as padden or nixosConfigurations.padden. May be omitted when the flake exposes exactly one known configuration.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Case-insensitive option-name terms for search. All terms must match.",
    }),
  ),
  option: Type.Optional(
    Type.String({
      description:
        "Exact dot-separated option name for inspect, such as services.openssh.enable.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum search results.",
      minimum: 1,
      maximum: MAX_LIMIT,
    }),
  ),
});

export type NixOptionsInput = Static<typeof NixOptionsParameters>;

function looksLikeFlakeReference(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

async function directoryFor(value: string, cwd: string): Promise<string> {
  const resolved = path.resolve(cwd, value.replace(/^@/, ""));
  const info = await stat(resolved);
  return info.isDirectory() ? resolved : path.dirname(resolved);
}

export async function findFlakeDirectory(start: string): Promise<string> {
  let current = path.resolve(start);
  if (!(await stat(current)).isDirectory()) current = path.dirname(current);

  while (true) {
    try {
      await access(path.join(current, "flake.nix"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`No flake.nix found at or above ${start}`);
      }
      current = parent;
    }
  }
}

export async function resolveFlakeReference(
  requested: string | undefined,
  cwd: string,
): Promise<string> {
  if (requested && looksLikeFlakeReference(requested)) return requested;

  const start = requested ? await directoryFor(requested, cwd) : cwd;
  return `path:${await findFlakeDirectory(start)}`;
}

function validateInput(params: NixOptionsInput): void {
  if (params.action === "search" && !params.query?.trim()) {
    throw new Error("nix_options search requires query");
  }
  if (params.action === "inspect" && !params.option?.trim()) {
    throw new Error("nix_options inspect requires option");
  }
}

export default function nixOptions(pi: ExtensionAPI) {
  pi.registerTool({
    name: "nix_options",
    label: "Nix Options",
    description:
      "Discover configurations and search or inspect their evaluated NixOS, Home Manager, nix-darwin, or nix-on-droid option metadata. Works with flakes whose configuration outputs expose .options. Search matches option names and returns type, description, declaration paths, and definition locations; inspect requires an exact option name. Does not evaluate final option values. Search output is limited to 50 results.",
    promptSnippet:
      "Discover and inspect evaluated Nix module options from flake configurations",
    promptGuidelines: [
      "Use nix_options instead of source-text search when you need to discover whether an option exists or inspect its evaluated metadata in a flake configuration.",
    ],
    parameters: NixOptionsParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      validateInput(params);
      const flakeRef = await resolveFlakeReference(params.flake, ctx.cwd);
      const args = [
        "--option",
        "experimental-features",
        "nix-command flakes",
        "--eval",
        "--strict",
        "--json",
        QUERY_FILE,
        "--argstr",
        "flakeRef",
        flakeRef,
        "--argstr",
        "action",
        params.action,
        "--argstr",
        "localPath",
        flakeRef.startsWith("path:") ? flakeRef.slice("path:".length) : "",
        "--argstr",
        "configuration",
        params.configuration ?? "",
        "--argstr",
        "query",
        params.query?.trim() ?? "",
        "--argstr",
        "option",
        params.option?.trim() ?? "",
        "--argstr",
        "limit",
        String(params.limit ?? DEFAULT_LIMIT),
      ];
      const result = await pi.exec("nix-instantiate", args, {
        cwd: ctx.cwd,
        signal,
        timeout: 120_000,
      });

      if (result.code !== 0) {
        const diagnostic = result.stderr.trim() || result.stdout.trim();
        throw new Error(
          diagnostic || `Nix evaluation failed with exit code ${result.code}`,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(
          `nix_options received invalid JSON from the Nix evaluator: ${(error as Error).message}`,
        );
      }

      const output = JSON.stringify(data, null, 2);
      const truncation = truncateHead(output, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });
      let text = truncation.content;
      if (truncation.truncated) {
        const temporaryDirectory = await mkdtemp(
          path.join(os.tmpdir(), "pi-nix-options-"),
        );
        const outputPath = path.join(temporaryDirectory, "result.json");
        await writeFile(outputPath, output);
        text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${outputPath}]`;
      }

      return {
        content: [{ type: "text", text }],
        details: data,
      };
    },
  });
}
