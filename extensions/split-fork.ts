import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";

const GHOSTTY_SPLIT_SCRIPT = `on run argv
	set targetCwd to item 1 of argv
	set startupInput to item 2 of argv
	tell application "Ghostty"
		set cfg to new surface configuration
		set initial working directory of cfg to targetCwd
		set initial input of cfg to startupInput
		if (count of windows) > 0 then
			try
				set frontWindow to front window
				set targetTerminal to focused terminal of selected tab of frontWindow
				split targetTerminal direction right with configuration cfg
			on error
				new window with configuration cfg
			end try
		else
			new window with configuration cfg
		end if
		activate
	end tell
end run`;

type PaneBackend = "herdr" | "tmux" | "ghostty";

interface ForkPane {
	backend: PaneBackend;
	id: string;
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

function buildPiStartupCommand(sessionFile: string | undefined, prompt: string): string {
	const commandParts = [...getPiInvocationParts()];

	if (sessionFile) {
		commandParts.push("--session", sessionFile);
	}

	if (prompt.length > 0) {
		commandParts.push("--", prompt);
	}

	return commandParts.map(shellQuote).join(" ");
}

function buildPiStartupInput(sessionFile: string | undefined, prompt: string): string {
	return `${buildPiStartupCommand(sessionFile, prompt)}\n`;
}

async function createForkedSession(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		return undefined;
	}

	const sessionDir = path.dirname(sessionFile);
	const branchEntries = ctx.sessionManager.getBranch();
	const currentHeader = ctx.sessionManager.getHeader();

	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const newSessionId = randomUUID();
	const newSessionFile = path.join(sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);

	const newHeader = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: newSessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};

	const lines = [JSON.stringify(newHeader), ...branchEntries.map((entry) => JSON.stringify(entry))].join("\n") + "\n";

	await fs.mkdir(sessionDir, { recursive: true });
	await fs.writeFile(newSessionFile, lines, "utf8");

	return newSessionFile;
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

function tmuxAvailable(): boolean {
	try {
		if (!process.env.TMUX) return false;
		execFileSync("tmux", ["display-message", "-p", "ok"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
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

function createHerdrRightSplit(cwd: string): ForkPane {
	const output = execFileSync("herdr", [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		cwd,
	], { encoding: "utf8" });
	const response = JSON.parse(output);
	const pane = response?.result?.pane?.pane_id ?? findPaneId(response?.result?.pane);
	if (typeof pane !== "string" || !pane.trim()) throw new Error(`Unexpected herdr pane split response: ${output}`);
	return { backend: "herdr", id: pane };
}

function createTmuxRightSplit(cwd: string): ForkPane {
	const args = ["split-window", "-h"];
	if (process.env.TMUX_PANE) args.push("-t", process.env.TMUX_PANE);
	args.push("-c", cwd, "-P", "-F", "#{pane_id}");
	const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
	if (!pane.startsWith("%")) throw new Error(`Unexpected tmux pane id: ${pane}`);
	return { backend: "tmux", id: pane };
}

function createRightSplit(cwd: string): ForkPane {
	if (herdrAvailable()) return createHerdrRightSplit(cwd);
	if (tmuxAvailable()) return createTmuxRightSplit(cwd);
	throw new Error("No Herdr or tmux split backend available.");
}

function sendCommand(pane: ForkPane, command: string): void {
	if (pane.backend === "herdr") {
		execFileSync("herdr", ["pane", "run", pane.id, command], { encoding: "utf8" });
		return;
	}
	execFileSync("tmux", ["send-keys", "-t", pane.id, "-l", command], { encoding: "utf8" });
	execFileSync("tmux", ["send-keys", "-t", pane.id, "Enter"], { encoding: "utf8" });
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("split-fork", {
		description: "Fork this session into a new pi process in a right-hand Herdr, tmux, or Ghostty split. Usage: /split-fork [optional prompt]",
		handler: async (args, ctx) => {
			const wasBusy = !ctx.isIdle();
			const prompt = args.trim();
			const forkedSessionFile = await createForkedSession(ctx);
			const startupCommand = buildPiStartupCommand(forkedSessionFile, prompt);
			const startupInput = buildPiStartupInput(forkedSessionFile, prompt);

			try {
				let backend: PaneBackend;
				try {
					const pane = createRightSplit(ctx.cwd);
					sendCommand(pane, startupCommand);
					backend = pane.backend;
				} catch (splitError) {
					if (process.platform !== "darwin") throw splitError;
					const result = await pi.exec("osascript", ["-e", GHOSTTY_SPLIT_SCRIPT, "--", ctx.cwd, startupInput]);
					if (result.code !== 0) {
						const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown osascript error";
						throw new Error(reason);
					}
					backend = "ghostty";
				}

				if (forkedSessionFile) {
					const fileName = path.basename(forkedSessionFile);
					const suffix = prompt ? " and sent prompt" : "";
					ctx.ui.notify(`Forked to ${fileName} in a new ${backend} split${suffix}.`, "info");
					if (wasBusy) {
						ctx.ui.notify("Forked from current committed state (in-flight turn continues in original session).", "info");
					}
				} else {
					ctx.ui.notify(`Opened a new ${backend} split (no persisted session to fork).`, "warning");
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to open split: ${reason}`, "error");
				if (forkedSessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
				}
			}
		},
	});
}
