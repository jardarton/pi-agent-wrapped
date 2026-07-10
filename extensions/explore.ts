import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPiInvocationParts } from "./lib/launcher";
import { cheapModelArgs } from "./lib/model-selection";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DONE_EXTENSION = join(MODULE_DIR, "explore-helper", "done.ts");
const ABORT_KEY = Symbol.for("pi-explore/abort-controller");

const previousAbort = (globalThis as any)[ABORT_KEY] as AbortController | undefined;
if (previousAbort) previousAbort.abort();
(globalThis as any)[ABORT_KEY] = new AbortController();

const ExploreParams = Type.Object({
  task: Type.String({ description: "Read-only codebase exploration task" }),
});

type ExploreParams = Static<typeof ExploreParams>;

interface ExploreRun {
  id: string;
  task: string;
  backend: PaneBackend;
  pane: string;
  sessionFile: string;
  scriptFile: string;
  startTime: number;
}

type PaneBackend = "tmux" | "herdr";

interface ExplorePane {
  backend: PaneBackend;
  id: string;
}

const SCOUT_PROMPT = `You are Explore, a read-only scout subagent.

Your job:
- Investigate the user's task in the current codebase.
- Use only read-only inspection.
- Start with fast map-making commands when useful: rg, find, ls, git status.
- Then do targeted file reads; avoid wandering through huge files or directories.
- Do not edit, write, delete, install, run servers, or make network calls.
- Report concrete findings with file paths and relevant symbols.
- Keep the report concise but complete enough for the parent agent to act.
- If something is uncertain, say what you checked and what remains unknown.

When finished:
1. Send a final assistant message containing your report.
2. Call explore_done.`;

function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function tmuxAvailable(): boolean {
  try {
    if (!process.env.TMUX) return false;
    execFileSync("tmux", ["display-message", "-p", "ok"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function herdrAvailable(): boolean {
  try {
    if (process.env.HERDR_ENV !== "1") return false;
    execFileSync("herdr", ["pane", "current", "--current"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function paneAvailable(): boolean {
  return herdrAvailable() || tmuxAvailable();
}

function findPaneId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = record.pane_id ?? record.id;
  if (typeof direct === "string" && direct.trim()) return direct;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findPaneId(item);
        if (found) return found;
      }
    } else {
      const found = findPaneId(child);
      if (found) return found;
    }
  }
  return null;
}

function createTmuxRightSplit(cwd: string): ExplorePane {
  const args = ["split-window", "-h", "-d"];
  if (process.env.TMUX_PANE) args.push("-t", process.env.TMUX_PANE);
  args.push("-c", cwd, "-P", "-F", "#{pane_id}");
  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) throw new Error(`Unexpected tmux pane id: ${pane}`);
  try {
    execFileSync("tmux", ["select-pane", "-t", pane, "-T", "Explore"], { stdio: "ignore" });
  } catch {}
  return { backend: "tmux", id: pane };
}

function createHerdrRightSplit(cwd: string): ExplorePane {
  const output = execFileSync("herdr", [
    "pane",
    "split",
    "--current",
    "--direction",
    "right",
    "--cwd",
    cwd,
    "--no-focus",
  ], { encoding: "utf8" });
  const response = JSON.parse(output);
  const pane = response?.result?.pane?.pane_id ?? findPaneId(response?.result?.pane);
  if (typeof pane !== "string" || !pane.trim()) throw new Error(`Unexpected herdr pane split response: ${output}`);
  try {
    execFileSync("herdr", ["pane", "rename", pane, "Explore"], { stdio: "ignore" });
  } catch {}
  return { backend: "herdr", id: pane };
}

function createRightSplit(cwd: string): ExplorePane {
  if (herdrAvailable()) return createHerdrRightSplit(cwd);
  if (tmuxAvailable()) return createTmuxRightSplit(cwd);
  throw new Error("Explore requires running pi inside Herdr or tmux.");
}

function sendCommand(pane: ExplorePane, command: string): void {
  if (pane.backend === "herdr") {
    execFileSync("herdr", ["pane", "run", pane.id, command], { encoding: "utf8" });
    return;
  }
  execFileSync("tmux", ["send-keys", "-t", pane.id, "-l", command], { encoding: "utf8" });
  execFileSync("tmux", ["send-keys", "-t", pane.id, "Enter"], { encoding: "utf8" });
}

function readScreen(pane: ExplorePane, lines = 5): string {
  if (pane.backend === "herdr") {
    return execFileSync("herdr", ["pane", "read", pane.id, "--source", "recent-unwrapped", "--lines", String(lines)], {
      encoding: "utf8",
    });
  }
  return execFileSync("tmux", ["capture-pane", "-p", "-t", pane.id, "-S", `-${lines}`], { encoding: "utf8" });
}

function closePane(pane: ExplorePane): void {
  try {
    if (pane.backend === "herdr") execFileSync("herdr", ["pane", "close", pane.id], { stdio: "ignore" });
    else execFileSync("tmux", ["kill-pane", "-t", pane.id], { stdio: "ignore" });
  } catch {}
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function safeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function makeSessionFile(cwd: string, id: string): string {
  const dir = join(getAgentDir(), "sessions", safeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23) + "Z";
  return join(dir, `${stamp}-explore-${id}.jsonl`);
}

function artifactDir(ctx: ExtensionContext): string {
  const sessionDir = ctx.sessionManager.getSessionDir();
  const sessionId = ctx.sessionManager.getSessionId();
  const dir = join(sessionDir, "artifacts", sessionId, "explore");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function modelArgs(): string[] {
  return cheapModelArgs("PI_EXPLORE_MODEL", "PI_EXPLORE_FALLBACK_MODELS");
}

function agentCommand(): string {
  return process.env.PI_EXPLORE_COMMAND ?? getPiInvocationParts().map(shellEscape).join(" ");
}

function buildTask(task: string): string {
  return `${SCOUT_PROMPT}\n\nTask:\n${task}`;
}

function findLastAssistantMessage(sessionFile: string): string | null {
  if (!existsSync(sessionFile)) return null;
  const lines = readFileSync(sessionFile, "utf8").split("\n").filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
      const text = (entry.message.content ?? [])
        .filter((block: any) => block?.type === "text" && typeof block.text === "string")
        .map((block: any) => block.text)
        .join("\n")
        .trim();
      if (text) return text;
    } catch {}
  }
  return null;
}

function formatElapsed(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function pollForExit(run: ExploreRun, signal: AbortSignal): Promise<number> {
  const pane = { backend: run.backend, id: run.pane };
  for (;;) {
    if (signal.aborted) throw new Error("Explore watcher aborted");

    const exitFile = `${run.sessionFile}.exit`;
    if (existsSync(exitFile)) {
      rmSync(exitFile, { force: true });
      return 0;
    }

    try {
      const match = readScreen(pane, 5).match(/__EXPLORE_DONE_(\d+)__/);
      if (match) return Number.parseInt(match[1], 10);
    } catch {
      // Pane may have been closed manually. Give .exit one last chance, then fail.
      if (existsSync(exitFile)) {
        rmSync(exitFile, { force: true });
        return 0;
      }
      return 1;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Explore watcher aborted"));
      }, { once: true });
    });
  }
}

async function startExplore(task: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<ExploreRun> {
  if (!task.trim()) throw new Error("Explore task is required.");
  if (!paneAvailable()) throw new Error("Explore requires running pi inside Herdr or tmux.");

  const id = Math.random().toString(16).slice(2, 10);
  const cwd = ctx.cwd;
  const sessionFile = makeSessionFile(cwd, id);
  const dir = artifactDir(ctx);
  const taskFile = join(dir, `task-${id}.md`);
  const scriptFile = join(dir, `launch-${id}.sh`);
  writeFileSync(taskFile, buildTask(task), "utf8");

  const pane = createRightSplit(cwd);
  const models = modelArgs().map(shellEscape).join(" ");
  const piCommand = `PI_EXPLORE_SESSION=${shellEscape(sessionFile)} PI_EXPLORE_AUTO_EXIT=1 ${agentCommand()} --session ${shellEscape(sessionFile)} -e ${shellEscape(DONE_EXTENSION)} --model "$model" --tools ${shellEscape("read,bash,explore_done")} ${shellEscape(`@${taskFile}`)}`;
  writeFileSync(scriptFile, `#!/bin/bash\ncd ${shellEscape(cwd)} || exit 1\nstatus=1\nfor model in ${models}; do\n  echo "Explore trying model: $model"\n  ${piCommand}\n  status=$?\n  if [ "$status" -eq 0 ]; then\n    break\n  fi\n  echo "Explore model failed: $model (exit $status)"\ndone\necho '__EXPLORE_DONE_'$status'__'\nexit "$status"\n`, { mode: 0o755 });
  sendCommand(pane, `bash ${shellEscape(scriptFile)}`);

  const run: ExploreRun = { id, task, backend: pane.backend, pane: pane.id, sessionFile, scriptFile, startTime: Date.now() };
  const abort = (globalThis as any)[ABORT_KEY] as AbortController;

  pollForExit(run, abort.signal)
    .then((exitCode) => {
      const summary = findLastAssistantMessage(sessionFile) ??
        (exitCode === 0 ? "Explore exited without output." : `Explore failed with exit code ${exitCode}.`);
      closePane(pane);
      const elapsed = formatElapsed(run.startTime);
      const heading = exitCode === 0
        ? `Explore completed (${elapsed}).`
        : `Explore failed (exit code ${exitCode}, ${elapsed}).`;
      pi.sendMessage({
        customType: "explore_result",
        content: `${heading}\n\n${summary}\n\nSession: ${sessionFile}\nResume: ${agentCommand()} --session ${sessionFile}`,
        display: true,
        details: { id, task, backend: run.backend, exitCode, elapsed, sessionFile, scriptFile },
      }, { triggerTurn: true, deliverAs: "steer" });
    })
    .catch((error) => {
      closePane(pane);
      pi.sendMessage({
        customType: "explore_result",
        content: `Explore error: ${error instanceof Error ? error.message : String(error)}\n\nSession: ${sessionFile}`,
        display: true,
        details: { id, task, backend: run.backend, error: error instanceof Error ? error.message : String(error), sessionFile, scriptFile },
      }, { triggerTurn: true, deliverAs: "steer" });
    });

  return run;
}

export default function exploreExtension(pi: ExtensionAPI) {
  if (!paneAvailable()) return;

  pi.registerTool({
    name: "explore",
    label: "Explore",
    description:
      "Launch a read-only scout subagent in a Herdr or tmux right split to explore the current codebase. Returns immediately; findings are delivered automatically when complete.",
    promptSnippet:
      "Use explore for read-only codebase reconnaissance. It launches a Herdr/tmux scout and returns findings automatically; do not poll for results.",
    parameters: ExploreParams,
    async execute(_toolCallId, params: ExploreParams, _signal, _onUpdate, ctx) {
      try {
        const run = await startExplore(params.task, ctx, pi);
        return {
          content: [{ type: "text", text: `Explore started. Results will be delivered automatically. Session: ${run.sessionFile}` }],
          details: { id: run.id, task: params.task, backend: run.backend, sessionFile: run.sessionFile, scriptFile: run.scriptFile, status: "started" },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: message }], details: { error: message } };
      }
    },
    renderCall(args, theme) {
      const task = typeof args.task === "string" ? args.task : "";
      const preview = task.split("\n").find((line) => line.trim()) ?? "";
      return new Text(`${theme.fg("toolTitle", theme.bold("Explore"))}\n${theme.fg("dim", preview.slice(0, 120))}`, 0, 0);
    },
    renderResult(result, _opts, theme) {
      const details = result.details as any;
      const text = details?.status === "started" ? "Explore — started" : (result.content[0] as any)?.text ?? "";
      return new Text(theme.fg(details?.error ? "error" : "accent", text), 0, 0);
    },
  });

  pi.registerCommand("explore", {
    description: "Launch a read-only scout: /explore <task>",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /explore <task>", "warning");
        return;
      }
      try {
        const run = await startExplore(task, ctx, pi);
        ctx.ui.notify(`Explore started: ${run.sessionFile}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
