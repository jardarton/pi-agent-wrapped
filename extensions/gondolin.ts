import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DEFAULT_MAX_BYTES,
	type FindOperations,
	formatSize,
	type GrepToolDetails,
	type GrepToolInput,
	type LsOperations,
	type ReadOperations,
	truncateHead,
	truncateLine,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import {
	ensureGondolinVm,
	getGondolinShellPath,
	getGondolinStatus,
	getGuestWorkspace,
	getLocalWorkspace,
	isGondolinEnabled,
	setGondolinEnabled,
	stopGondolinVm,
	toGuestPath,
	toggleGondolinEnabled,
} from "./lib/gondolin";

const DEFAULT_GREP_LIMIT = 100;

type TextToolResult<TDetails> = {
	content: Array<{ type: "text"; text: string }>;
	details: TDetails | undefined;
};

function createGondolinReadOps(): ReadOperations {
	return {
		readFile: async (filePath) => (await ensureGondolinVm()).fs.readFile(toGuestPath(filePath)),
		access: async (filePath) => {
			await (await ensureGondolinVm()).fs.access(toGuestPath(filePath));
		},
		detectImageMimeType: async (filePath) => {
			const ext = path.posix.extname(toGuestPath(filePath)).toLowerCase();
			if (ext === ".png") return "image/png";
			if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
			if (ext === ".gif") return "image/gif";
			if (ext === ".webp") return "image/webp";
			return null;
		},
	};
}

function createGondolinWriteOps(): WriteOperations {
	return {
		writeFile: async (filePath, content) => {
			await (await ensureGondolinVm()).fs.writeFile(toGuestPath(filePath), content, { encoding: "utf8" });
		},
		mkdir: async (dirPath) => {
			await (await ensureGondolinVm()).fs.mkdir(toGuestPath(dirPath), { recursive: true });
		},
	};
}

function createGondolinLsOps(): LsOperations {
	return {
		exists: async (filePath) => {
			try {
				await (await ensureGondolinVm()).fs.access(toGuestPath(filePath));
				return true;
			} catch {
				return false;
			}
		},
		stat: async (filePath) => (await ensureGondolinVm()).fs.stat(toGuestPath(filePath)),
		readdir: async (dirPath) => (await ensureGondolinVm()).fs.listDir(toGuestPath(dirPath)),
	};
}

async function walkGuestFiles(
	root: string,
	visit: (guestPath: string, relativePath: string) => Promise<boolean>,
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) throw new Error("Operation aborted");
	const vm = await ensureGondolinVm();
	const stat = await vm.fs.stat(root, { signal });
	if (!stat.isDirectory()) return visit(root, path.posix.basename(root));

	const walkDirectory = async (dir: string, relativeDir: string): Promise<boolean> => {
		if (signal?.aborted) throw new Error("Operation aborted");
		const entries = await vm.fs.listDir(dir, { signal });
		for (const entry of entries) {
			if (entry === ".git" || entry === "node_modules") continue;
			const guestPath = path.posix.join(dir, entry);
			const relativePath = relativeDir ? path.posix.join(relativeDir, entry) : entry;
			let entryStat: Awaited<ReturnType<typeof vm.fs.stat>>;
			try {
				entryStat = await vm.fs.stat(guestPath, { signal });
			} catch {
				continue;
			}
			if (entryStat.isDirectory()) {
				if (!(await walkDirectory(guestPath, relativePath))) return false;
			} else if (!(await visit(guestPath, relativePath))) {
				return false;
			}
		}
		return true;
	};

	return walkDirectory(root, "");
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
	const normalizedPattern = relativePath.split(path.sep).join(path.posix.sep);
	const normalizedGlob = pattern.split(path.sep).join(path.posix.sep);
	if (normalizedGlob.includes("/")) {
		return (
			path.posix.matchesGlob(normalizedPattern, normalizedGlob) ||
			path.posix.matchesGlob(normalizedPattern, `**/${normalizedGlob}`)
		);
	}
	return path.posix.matchesGlob(path.posix.basename(normalizedPattern), normalizedGlob);
}

function createGondolinFindOps(): FindOperations {
	return {
		exists: async (filePath) => {
			try {
				await (await ensureGondolinVm()).fs.access(toGuestPath(filePath));
				return true;
			} catch {
				return false;
			}
		},
		glob: async (pattern, cwd, options) => {
			const root = toGuestPath(cwd);
			const results: string[] = [];
			await walkGuestFiles(root, async (guestPath, relativePath) => {
				if (results.length >= options.limit) return false;
				if (matchesToolGlob(relativePath, pattern)) results.push(guestPath);
				return results.length < options.limit;
			});
			return results;
		},
	};
}

function createLineMatcher(pattern: string, literal: boolean | undefined, ignoreCase: boolean | undefined) {
	if (literal) {
		const needle = ignoreCase ? pattern.toLowerCase() : pattern;
		return (line: string) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
	}
	const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
	return (line: string) => regex.test(line);
}

function appendGrepBlock(params: {
	outputLines: string[];
	lines: string[];
	relativePath: string;
	lineIndex: number;
	contextLines: number;
}): boolean {
	let linesTruncated = false;
	const start = params.contextLines > 0 ? Math.max(0, params.lineIndex - params.contextLines) : params.lineIndex;
	const end =
		params.contextLines > 0
			? Math.min(params.lines.length - 1, params.lineIndex + params.contextLines)
			: params.lineIndex;

	for (let index = start; index <= end; index++) {
		const rawLine = params.lines[index] ?? "";
		const { text, wasTruncated } = truncateLine(rawLine.replace(/\r/g, ""));
		if (wasTruncated) linesTruncated = true;
		const separator = index === params.lineIndex ? ":" : "-";
		params.outputLines.push(`${params.relativePath}${separator}${index + 1}${separator} ${text}`);
	}
	return linesTruncated;
}

async function executeGondolinGrep(params: GrepToolInput, signal?: AbortSignal): Promise<TextToolResult<GrepToolDetails>> {
	const vm = await ensureGondolinVm();
	const root = toGuestPath(params.path ?? ".");
	const rootStat = await vm.fs.stat(root, { signal });
	const rootIsDirectory = rootStat.isDirectory();
	const matcher = createLineMatcher(params.pattern, params.literal, params.ignoreCase);
	const contextLines = params.context && params.context > 0 ? params.context : 0;
	const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
	const outputLines: string[] = [];
	const details: GrepToolDetails = {};
	let matchCount = 0;
	let matchLimitReached = false;
	let linesTruncated = false;

	await walkGuestFiles(
		root,
		async (guestPath, relativePath) => {
			if (matchCount >= effectiveLimit) return false;
			if (params.glob && !matchesToolGlob(relativePath, params.glob)) return true;
			let content: string;
			try {
				content = await vm.fs.readFile(guestPath, { encoding: "utf8", signal });
			} catch {
				return true;
			}
			const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
			const displayPath = rootIsDirectory ? relativePath : path.posix.basename(guestPath);
			for (let index = 0; index < lines.length; index++) {
				if (signal?.aborted) throw new Error("Operation aborted");
				if (!matcher(lines[index] ?? "")) continue;
				matchCount++;
				if (appendGrepBlock({ outputLines, lines, relativePath: displayPath, lineIndex: index, contextLines })) {
					linesTruncated = true;
				}
				if (matchCount >= effectiveLimit) {
					matchLimitReached = true;
					return false;
				}
			}
			return true;
		},
		signal,
	);

	if (matchCount === 0) return { content: [{ type: "text", text: "No matches found" }], details: undefined };

	const rawOutput = outputLines.join("\n");
	const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
	const notices: string[] = [];
	let output = truncation.content;

	if (matchLimitReached) {
		details.matchLimitReached = effectiveLimit;
		notices.push(`${effectiveLimit} matches limit reached`);
	}
	if (linesTruncated) {
		details.linesTruncated = true;
		notices.push("long lines truncated");
	}
	if (truncation.truncated) {
		details.truncation = truncation;
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
	}
	if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

	return {
		content: [{ type: "text", text: output }],
		details: Object.keys(details).length > 0 ? details : undefined,
	};
}

function sanitizeEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> | undefined {
	if (!env) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") result[key] = value;
	}
	return result;
}

function createGondolinBashOps(): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			if (signal?.aborted) throw new Error("aborted");
			const vm = await ensureGondolinVm();
			const guestCwd = toGuestPath(cwd);
			const controller = new AbortController();
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			let timedOut = false;
			const timer =
				timeout && timeout > 0
					? setTimeout(() => {
							timedOut = true;
							controller.abort();
						}, timeout * 1000)
					: undefined;

			try {
				const proc = vm.exec([getGondolinShellPath(), "-lc", command], {
					cwd: guestCwd,
					env: sanitizeEnv(env),
					signal: controller.signal,
					stdout: "pipe",
					stderr: "pipe",
				});
				for await (const chunk of proc.output()) onData(chunk.data);
				const result = await proc;
				return { exitCode: result.exitCode };
			} catch (error) {
				if (signal?.aborted) throw new Error("aborted");
				if (timedOut) throw new Error(`timeout:${timeout}`);
				throw error;
			} finally {
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	const localCwd = getLocalWorkspace();
	const guestCwd = getGuestWorkspace();
	const localRead = createReadTool(localCwd);
	const localWrite = createWriteTool(localCwd);
	const localBash = createBashTool(localCwd);
	const localGrep = createGrepTool(localCwd);
	const localFind = createFindTool(localCwd);
	const localLs = createLsTool(localCwd);

	pi.on("session_start", async (_event, ctx) => {
		if (isGondolinEnabled()) await ensureGondolinVm(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await stopGondolinVm(ctx);
	});

	pi.registerCommand("gondolin", {
		description: "Toggle Gondolin routing for built-in tools and ! commands",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "" || action === "status") {
				const status = getGondolinStatus();
				ctx.ui.notify(
					[
						`Gondolin: ${status.enabled ? "ON" : "OFF"}`,
						`Host workspace: ${status.localWorkspace}`,
						`Guest workspace: ${status.guestWorkspace}`,
						`VM: ${status.vmId ?? "not running"}`,
						`Shell: ${status.shellPath}`,
					].join("\n"),
					"info",
				);
				return;
			}
			if (action === "on") {
				await setGondolinEnabled(true, ctx);
				ctx.ui.notify(`Gondolin routing enabled -> ${guestCwd}`, "info");
				return;
			}
			if (action === "off") {
				await setGondolinEnabled(false, ctx);
				ctx.ui.notify("Gondolin routing disabled -> host tools", "info");
				return;
			}
			if (action === "toggle") {
				const enabled = await toggleGondolinEnabled(ctx);
				ctx.ui.notify(enabled ? `Gondolin routing enabled -> ${guestCwd}` : "Gondolin routing disabled -> host tools", "info");
				return;
			}
			throw new Error("Usage: /gondolin [status|on|off|toggle]");
		},
	});

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localRead.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			const tool = createReadTool(guestCwd, { operations: createGondolinReadOps() });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localWrite.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			const tool = createWriteTool(guestCwd, { operations: createGondolinWriteOps() });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localBash.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			const tool = createBashTool(guestCwd, { operations: createGondolinBashOps() });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localLs,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localLs.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			const tool = createLsTool(guestCwd, { operations: createGondolinLsOps() });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localFind,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localFind.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			const tool = createFindTool(guestCwd, { operations: createGondolinFindOps() });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localGrep,
		async execute(id, params, signal, onUpdate, ctx) {
			if (!isGondolinEnabled()) return localGrep.execute(id, params, signal, onUpdate, ctx);
			await ensureGondolinVm(ctx);
			return executeGondolinGrep(params, signal);
		},
	});

	pi.on("user_bash", async (_event, ctx) => {
		if (!isGondolinEnabled()) return;
		await ensureGondolinVm(ctx);
		return { operations: createGondolinBashOps() };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isGondolinEnabled()) return;
		await ensureGondolinVm(ctx);
		const guestNote = [
			`Built-in read/write/edit/bash/ls/find/grep tools and ! commands run inside Gondolin.`,
			`Inside Gondolin, the host workspace ${localCwd} is mounted at ${guestCwd}.`,
			`Host-side pi-fff tools (fffind, ffgrep, fff-multi-grep) must use relative paths or host paths under ${localCwd}, not ${guestCwd}.`,
		].join("\n");
		const systemPrompt = event.systemPrompt.includes(guestNote)
			? event.systemPrompt
			: `${event.systemPrompt}\n\n${guestNote}`;
		return { systemPrompt };
	});
}
