import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { getPiInvocationParts } from "./lib/launcher.ts";

const REASONING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const STATUSES = new Set(["exact", "best-effort", "needs-analysis"]);

type Model = { provider: string; model: string; reasoning: (typeof REASONING)[number] };
type MatcherConfig = { version: 1; jobRoot: string; default: Model; allowed: Model[] };

const MatchParams = Type.Object({
	task: Type.String({ description: "Complete task and evidence packet; the child cannot see this conversation." }),
	function: Type.String({ description: "Function or small related-unit boundary." }),
	evidence: Type.Array(Type.String({ description: "Absolute or repository-relative evidence path." })),
	initialCandidate: Type.Optional(Type.String({ description: "Existing repository-relative candidate to copy into the job, when available." })),
	scratchCommand: Type.Array(Type.String(), { description: "Repository scratch command argv. Supports {candidate}, {attemptDir}, and {jobDir}." }),
	attempts: Type.Integer({ minimum: 1, description: "Prompt-enforced attempt limit." }),
	softSeconds: Type.Integer({ minimum: 1, description: "Child finalization deadline in seconds." }),
	hardSeconds: Type.Integer({ minimum: 2, description: "Runner-enforced wall-clock limit in seconds." }),
	allowInlineAssembly: Type.Boolean(),
	provider: Type.Optional(Type.String({ description: "Configured provider; omit to use the profile default." })),
	model: Type.Optional(Type.String({ description: "Configured model; omit to use the profile default." })),
	reasoning: Type.Optional(Type.Union(REASONING.map((value) => Type.Literal(value)))),
});

const CompleteParams = Type.Object({
	status: Type.Union([Type.Literal("exact"), Type.Literal("best-effort"), Type.Literal("needs-analysis")]),
	claimedExact: Type.Boolean(),
	matchedBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
	totalBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
	attempts: Type.Integer({ minimum: 0 }),
	firstMismatch: Type.Union([Type.String(), Type.Null()]),
	candidatePath: Type.Union([Type.String(), Type.Null()]),
	artifactPaths: Type.Array(Type.String()),
});

function nonempty(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
	return value.trim();
}

function parseConfig(): MatcherConfig {
	let raw: unknown;
	try { raw = JSON.parse(nonempty(process.env.PI_DECOMP_MATCHER_CONFIG, "PI_DECOMP_MATCHER_CONFIG")); }
	catch (error) { throw new Error(`Decomp matcher is not configured: ${error instanceof Error ? error.message : String(error)}`); }
	if (!raw || typeof raw !== "object") throw new Error("PI_DECOMP_MATCHER_CONFIG must be an object");
	const value = raw as Record<string, unknown>;
	const model = (item: unknown, name: string): Model => {
		if (!item || typeof item !== "object") throw new Error(`${name} must be an object`);
		const v = item as Record<string, unknown>;
		const reasoning = nonempty(v.reasoning, `${name}.reasoning`);
		if (!(REASONING as readonly string[]).includes(reasoning)) throw new Error(`${name}.reasoning is invalid`);
		return { provider: nonempty(v.provider, `${name}.provider`), model: nonempty(v.model, `${name}.model`), reasoning: reasoning as Model["reasoning"] };
	};
	if (value.version !== 1 || !Array.isArray(value.allowed)) throw new Error("PI_DECOMP_MATCHER_CONFIG must have version 1 and allowed models");
	const allowed = value.allowed.map((item, index) => model(item, `allowed[${index}]`));
	const defaultModel = model(value.default, "default");
	if (!allowed.some((item) => sameModel(item, defaultModel))) throw new Error("default model must be allowlisted");
	return { version: 1, jobRoot: path.resolve(nonempty(value.jobRoot, "jobRoot")), default: defaultModel, allowed };
}

function sameModel(a: Model, b: Model): boolean { return a.provider === b.provider && a.model === b.model && a.reasoning === b.reasoning; }
function under(root: string, candidate: string, name: string): string {
	const resolved = path.resolve(candidate);
	const relative = path.relative(root, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${name} must remain under ${root}`);
	return resolved;
}
function command(values: string[], replacement: Record<string, string>): string[] {
	if (!values.length || values.some((value) => !value.trim())) throw new Error("scratchCommand must be a non-empty argv array");
	return values.map((value) => value.replace(/\{(candidate|attemptDir|jobDir)\}/g, (_all, key) => replacement[key]));
}
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function git(root: string, excluded: string) {
	const invoke = (args: string[]) => {
		const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
		return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
	};
	const relative = path.relative(root, excluded);
	const exclude = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? [`:(exclude,top)${relative}`, `:(exclude,top)${relative}/**`] : [];
	return { revision: invoke(["rev-parse", "HEAD"]), status: invoke(["status", "--short", "--untracked-files=normal", "--", ".", ...exclude]), diff: invoke(["diff", "--binary", "HEAD", "--", ".", ...exclude]) };
}
async function atomic(file: string, value: unknown) { const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }

async function runChild(launcher: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, stdoutPath: string, stderrPath: string, timeoutMs: number, signal?: AbortSignal) {
	const stdout = createWriteStream(stdoutPath); const stderr = createWriteStream(stderrPath);
	const stdoutClosed = once(stdout, "close"); const stderrClosed = once(stderr, "close");
	const child = spawn(launcher, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
	child.stdout.pipe(stdout); child.stderr.pipe(stderr);
	let timedOut = false; let cancelled = false; let forceTimer: NodeJS.Timeout | undefined;
	const stop = (reason: "timeout" | "cancel") => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		if (reason === "timeout") timedOut = true; else cancelled = true;
		try { process.kill(-child.pid!, "SIGTERM"); } catch {}
		forceTimer ??= setTimeout(() => { if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, 2000);
		forceTimer.unref();
	};
	const timer = setTimeout(() => stop("timeout"), timeoutMs);
	const abort = () => stop("cancel"); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
	let outcome: { exitCode: number | null; signal: NodeJS.Signals | null };
	try {
		outcome = await Promise.race([
			once(child, "exit").then(([exitCode, exitSignal]) => ({ exitCode: exitCode as number | null, signal: exitSignal as NodeJS.Signals | null })),
			once(child, "error").then(([error]) => { throw error; }),
		]);
	} finally {
		clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); signal?.removeEventListener("abort", abort); await Promise.all([stdoutClosed, stderrClosed]);
	}
	const { exitCode, signal: exitSignal } = outcome;
	return { exitCode, signal: exitSignal, timedOut, cancelled };
}

function childPrompt(manifest: any): string {
	return `You are a bounded decompilation matching worker. Work only on this job.
Function: ${manifest.function}
Task and evidence packet:\n${manifest.task}
Evidence paths:\n${manifest.evidence.map((item: string) => `- ${item}`).join("\n") || "- none"}
Repository root: ${manifest.repositoryRoot}
Job directory: ${manifest.jobDirectory}
Best candidate: ${manifest.paths.bestCandidate}
Scratch command argv: ${JSON.stringify(manifest.scratchCommand)}
Baseline attempt zero (this does not consume the attempt budget):
${manifest.baseline ? JSON.stringify(manifest.baseline, null, 2) : "No initial candidate was provided, so no baseline was run."}

Create a fresh directory below ${manifest.paths.attemptsDirectory} for each scratch attempt. Replace {candidate}, {attemptDir}, and {jobDir} in the command. Do not edit maintained source, configuration, symbols, or shared generated state. Never promote source or run a full build. Inline assembly is ${manifest.allowInlineAssembly ? "allowed only when narrowly scoped" : "forbidden"}. Stop after ${manifest.attempts} attempts and begin finalization by ${manifest.softSeconds} seconds; the runner kills you at ${manifest.hardSeconds} seconds.

Keep the best candidate in the job directory. Before normal exit, call decomp_matcher_complete exactly once with your compact result. It atomically records the completion. Exact requires an exact local scratch result; otherwise report best-effort or needs-analysis.`;
}

async function validateCompletion(file: string, job: string, attempts: number) {
	const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
	if (typeof value.status !== "string" || !STATUSES.has(value.status) || typeof value.claimedExact !== "boolean" || (value.status === "exact") !== value.claimedExact) throw new Error("invalid completion status");
	if (!Number.isInteger(value.attempts) || (value.attempts as number) < 0 || (value.attempts as number) > attempts) throw new Error("invalid completion attempts");
	for (const key of ["matchedBytes", "totalBytes"]) if (value[key] !== null && (!Number.isInteger(value[key]) || (value[key] as number) < 0)) throw new Error(`invalid completion ${key}`);
	if (value.firstMismatch !== null && typeof value.firstMismatch !== "string") throw new Error("invalid completion firstMismatch");
	if (!Array.isArray(value.artifactPaths)) throw new Error("invalid completion artifactPaths");
	const nullable = (item: unknown, name: string) => item === null ? null : under(job, nonempty(item, name), name);
	return { ...value, candidatePath: nullable(value.candidatePath, "candidatePath"), artifactPaths: value.artifactPaths.map((item, index) => under(job, nonempty(item, `artifactPaths[${index}]`), `artifactPaths[${index}]`)) };
}

function validateCompletionEvent(events: string) {
	const parsed = events.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
		try { return JSON.parse(line) as Record<string, unknown>; }
		catch (error) { throw new Error(`invalid child JSON event on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
	});
	const starts = parsed.filter((event) => event.type === "tool_execution_start" && event.toolName === "decomp_matcher_complete");
	const ends = parsed.filter((event) => event.type === "tool_execution_end" && event.toolName === "decomp_matcher_complete");
	if (starts.length !== 1 || ends.length !== 1 || starts[0].toolCallId !== ends[0].toolCallId || ends[0].isError !== false) throw new Error("child completion tool must execute successfully exactly once");
}

async function dispatch(params: any, ctx: ExtensionContext, signal?: AbortSignal) {
	const config = parseConfig(); const selected: Model = { provider: params.provider ?? config.default.provider, model: params.model ?? config.default.model, reasoning: params.reasoning ?? config.default.reasoning };
	if (!config.allowed.some((item) => sameModel(item, selected))) throw new Error("Requested provider/model/reasoning is not in the configured decomp matcher allowlist");
	if (params.softSeconds >= params.hardSeconds) throw new Error("softSeconds must be less than hardSeconds");
	const launcher = getPiInvocationParts()[0];
	const root = await realpath(ctx.cwd); const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const job = path.join(config.jobRoot, `${stamp}-${randomBytes(5).toString("hex")}`); const attemptsDirectory = path.join(job, "attempts"); const paths = { manifest: path.join(job, "manifest.json"), completion: path.join(job, "completion.json"), result: path.join(job, "runner-result.json"), bestCandidate: path.join(job, "best-candidate.c"), baselineCandidate: path.join(job, "baseline-candidate.c"), attemptsDirectory, baselineDirectory: path.join(attemptsDirectory, "000-baseline"), sessionDirectory: path.join(job, "session"), events: path.join(job, "child-events.jsonl"), stderr: path.join(job, "child.stderr.log") };
	await Promise.all([mkdir(paths.attemptsDirectory, { recursive: true }), mkdir(paths.sessionDirectory, { recursive: true })]);
	const before = git(root, job);
	let baseline: any = null;
	if (params.initialCandidate) {
		const source = under(root, path.resolve(root, params.initialCandidate), "initialCandidate"); const candidate = await readFile(source);
		await Promise.all([writeFile(paths.baselineCandidate, candidate), writeFile(paths.bestCandidate, candidate), mkdir(paths.baselineDirectory, { recursive: true })]);
		const argv = command(params.scratchCommand, { candidate: paths.baselineCandidate, attemptDir: paths.baselineDirectory, jobDir: job }); const baselineStarted = Date.now();
		const checked = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", timeout: params.hardSeconds * 1000 });
		const stdout = checked.stdout ?? ""; const stderr = checked.stderr ?? ""; const stdoutPath = path.join(paths.baselineDirectory, "stdout.log"); const stderrPath = path.join(paths.baselineDirectory, "stderr.log");
		await Promise.all([writeFile(stdoutPath, stdout), writeFile(stderrPath, stderr)]);
		baseline = { attempt: 0, candidatePath: paths.baselineCandidate, candidateSha256: sha256(candidate), command: argv, exitCode: checked.status, signal: checked.signal, stdout, stderr, error: checked.error?.message ?? null, elapsedMs: Date.now() - baselineStarted, artifactDirectory: paths.baselineDirectory, stdoutPath, stderrPath };
	}
	const manifest = { version: 1, jobDirectory: job, repositoryRoot: root, function: nonempty(params.function, "function"), task: nonempty(params.task, "task"), evidence: params.evidence.map((item: string) => path.resolve(root, item)), scratchCommand: params.scratchCommand, attempts: params.attempts, softSeconds: params.softSeconds, hardSeconds: params.hardSeconds, allowInlineAssembly: params.allowInlineAssembly, requested: selected, paths, before, baseline };
	await atomic(paths.manifest, manifest);
	const started = Date.now();
	const processResult = await runChild(launcher, ["--mode", "json", "--session-dir", paths.sessionDirectory, "--provider", selected.provider, "--model", selected.model, "--thinking", selected.reasoning, childPrompt(manifest)], root, { ...process.env, PI_DECOMP_MATCHER_MANIFEST: paths.manifest, PI_DECOMP_MATCHER_CONFIG: process.env.PI_DECOMP_MATCHER_CONFIG! }, paths.events, paths.stderr, params.hardSeconds * 1000, signal);
	let completion: any = null; let completionError: string | null = null;
	try { if (processResult.exitCode !== 0 || processResult.signal || processResult.timedOut || processResult.cancelled) throw new Error("child did not exit normally"); validateCompletionEvent(await readFile(paths.events, "utf8")); completion = await validateCompletion(paths.completion, job, params.attempts); } catch (error) { completionError = error instanceof Error ? error.message : String(error); }
	let recheck: any = null;
	if (completion?.candidatePath) { const attemptDir = path.join(paths.attemptsDirectory, "authoritative-recheck"); await mkdir(attemptDir); const argv = command(params.scratchCommand, { candidate: completion.candidatePath, attemptDir, jobDir: job }); const checked = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", timeout: params.hardSeconds * 1000 }); recheck = { command: argv, exitCode: checked.status, signal: checked.signal, stdout: checked.stdout ?? "", stderr: checked.stderr ?? "", error: checked.error?.message ?? null, artifactDirectory: attemptDir }; }
	const after = git(root, job); const result = { version: 1, jobDirectory: job, resolved: selected, baseline, process: { ...processResult, elapsedMs: Date.now() - started }, completion, completionError, recheck, repository: { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) }, session: paths.sessionDirectory };
	await atomic(paths.result, result); if (!completion) { const warning = result.repository.changed ? "; WARNING: repository state changed outside the matcher job" : ""; throw new Error(`${completionError}${warning}; retained job: ${job}`); } return result;
}

export default function decompMatcherExtension(pi: ExtensionAPI): void {
	const childManifest = process.env.PI_DECOMP_MATCHER_MANIFEST;
	if (childManifest) {
		pi.registerTool({ name: "decomp_matcher_complete", label: "Decomp Matcher Complete", description: "Terminate this matcher job with its compact, audited summary.", parameters: CompleteParams, async execute(_id, params, _signal, _update, ctx) {
			try { const manifest = JSON.parse(await readFile(childManifest, "utf8")); const job = nonempty(manifest.jobDirectory, "manifest.jobDirectory"); const completion = under(job, nonempty(manifest.paths?.completion, "manifest.paths.completion"), "completion path"); await validateCompletionValue(params, job, manifest.attempts); await atomic(completion, params); ctx.shutdown(); return { content: [{ type: "text", text: "Matcher completion recorded." }], details: params }; }
			catch (error) { throw new Error(`Cannot complete matcher job: ${error instanceof Error ? error.message : String(error)}`); }
		} });
		return;
	}
	let active = false;
	pi.registerTool({ name: "decomp_match", label: "Decomp Match", description: "Delegate a bounded compile-edit-diff loop to one configured matcher child. The parent must review and rerun the authoritative scratch check before promotion.", promptSnippet: "Use decomp_match only for a bounded decompilation matching loop with a complete task packet and scratch argv.", executionMode: "sequential", parameters: MatchParams, async execute(_id, params, signal, _update, ctx) {
		if (active) throw new Error("A decomp matcher job is already active; version one does not queue or run concurrently."); active = true; try { const result = await dispatch(params, ctx, signal); const c = result.completion; const repository = result.repository.changed ? "WARNING: repository state changed outside the matcher job; inspect the recorded diff before continuing." : "Repository state outside the matcher job is unchanged."; return { content: [{ type: "text", text: `Matcher ${c.status}: ${c.matchedBytes ?? "?"}/${c.totalBytes ?? "?"} bytes, ${c.attempts} attempts. Candidate: ${c.candidatePath ?? "none"}\nRecheck exit: ${result.recheck?.exitCode ?? "not run"}; ${repository}\nJob: ${result.jobDirectory}; session: ${result.session}` }], details: result }; } finally { active = false; }
	} });
}

async function validateCompletionValue(value: Record<string, unknown>, job: string, attempts: number) {
	const temporary = path.join(job, `.completion-validation-${randomBytes(4).toString("hex")}.json`); await atomic(temporary, value); try { await validateCompletion(temporary, job, attempts); } finally { try { await import("node:fs/promises").then((fs) => fs.unlink(temporary)); } catch {} }
}
