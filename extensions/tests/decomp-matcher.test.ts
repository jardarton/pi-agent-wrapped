import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import decompMatcherExtension from "../decomp-matcher.ts";

const ENV = ["PI_DECOMP_MATCHER_CONFIG", "PI_DECOMP_MATCHER_MANIFEST", "PI_LAUNCHER_BIN"] as const;
async function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, fn: () => Promise<void>) {
	const old = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	try { await fn(); } finally { for (const key of ENV) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]; }
}

test("runs an allowlisted matcher child, validates its completion event, and rechecks the candidate", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "decomp-matcher-"));
	await writeFile(path.join(root, "candidate.c"), "int f(void) { return 1; }\n");
	const scratch = path.join(root, "scratch.mjs");
	await writeFile(scratch, `#!${process.execPath}\nimport { mkdir, readFile, writeFile } from 'node:fs/promises'; await mkdir(process.argv[3], {recursive:true}); if (!(await readFile(process.argv[2],'utf8')).includes('return 1')) process.exit(1); await writeFile(process.argv[3]+'/ok','ok');\n`);
	await chmod(scratch, 0o755);
	spawnSync("git", ["init", "-q", root]); spawnSync("git", ["-C", root, "config", "user.email", "x@example.invalid"]); spawnSync("git", ["-C", root, "config", "user.name", "x"]); spawnSync("git", ["-C", root, "add", "."]); spawnSync("git", ["-C", root, "commit", "-qm", "fixture"]);
	const launcher = path.join(root, "fake-pi.mjs");
	await writeFile(launcher, `#!${process.execPath}\nimport { copyFile, readFile, rename, writeFile } from 'node:fs/promises'; const m=JSON.parse(await readFile(process.env.PI_DECOMP_MATCHER_MANIFEST,'utf8')); if(JSON.stringify(process.argv.slice(2,6))!==JSON.stringify(['--mode','json','--session-dir',m.paths.sessionDirectory])) process.exit(2); console.log(JSON.stringify({type:'tool_execution_start',toolName:'decomp_matcher_complete',toolCallId:'complete'})); await copyFile(m.paths.bestCandidate,m.paths.bestCandidate+'.copy'); await writeFile(m.paths.completion+'.tmp',JSON.stringify({status:'exact',claimedExact:true,matchedBytes:4,totalBytes:4,attempts:1,firstMismatch:null,candidatePath:m.paths.bestCandidate,artifactPaths:[m.paths.bestCandidate+'.copy']})); await rename(m.paths.completion+'.tmp',m.paths.completion); if(m.task==='mutate') await writeFile(m.repositoryRoot+'/unexpected.txt','changed'); console.log(JSON.stringify({type:'tool_execution_end',toolName:'decomp_matcher_complete',toolCallId:'complete',isError:false}));\n`);
	await chmod(launcher, 0o755);
	await withEnv({ PI_LAUNCHER_BIN: launcher, PI_DECOMP_MATCHER_CONFIG: JSON.stringify({ version: 1, jobRoot: path.join(root, ".jobs"), default: { provider: "fixture", model: "model", reasoning: "low" }, allowed: [{ provider: "fixture", model: "model", reasoning: "low" }] }) }, async () => {
		const tools = new Map<string, any>(); decompMatcherExtension({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any);
		assert.deepEqual([...tools.keys()], ["decomp_match"]);
		const result = await tools.get("decomp_match").execute("call", { task: "match", function: "f", evidence: [], initialCandidate: "candidate.c", scratchCommand: [scratch, "{candidate}", "{attemptDir}"], attempts: 2, softSeconds: 1, hardSeconds: 5, allowInlineAssembly: false }, undefined, undefined, { cwd: root });
		assert.equal(result.details.completion.status, "exact"); assert.equal(result.details.recheck.exitCode, 0);
		assert.equal(result.details.session, JSON.parse(await readFile(path.join(result.details.jobDirectory, "manifest.json"), "utf8")).paths.sessionDirectory);
		assert.match(result.content[0].text, /Repository state .* unchanged/);

		await writeFile(launcher, `#!${process.execPath}\nimport { copyFile, readFile, rename, writeFile } from 'node:fs/promises'; const m=JSON.parse(await readFile(process.env.PI_DECOMP_MATCHER_MANIFEST,'utf8')); await copyFile(m.paths.bestCandidate,m.paths.bestCandidate+'.copy'); await writeFile(m.paths.completion+'.tmp',JSON.stringify({status:'exact',claimedExact:true,matchedBytes:4,totalBytes:4,attempts:1,firstMismatch:null,candidatePath:m.paths.bestCandidate,artifactPaths:[]})); await rename(m.paths.completion+'.tmp',m.paths.completion); console.log(JSON.stringify({message:'decomp_matcher_complete'}));\n`);
		await assert.rejects(tools.get("decomp_match").execute("call", { task: "spoof", function: "f", evidence: [], initialCandidate: "candidate.c", scratchCommand: [scratch, "{candidate}", "{attemptDir}"], attempts: 2, softSeconds: 1, hardSeconds: 5, allowInlineAssembly: false }, undefined, undefined, { cwd: root }), /completion tool must execute successfully exactly once/);

		await writeFile(launcher, `#!${process.execPath}\nimport { copyFile, readFile, rename, writeFile } from 'node:fs/promises'; const m=JSON.parse(await readFile(process.env.PI_DECOMP_MATCHER_MANIFEST,'utf8')); console.log(JSON.stringify({type:'tool_execution_start',toolName:'decomp_matcher_complete',toolCallId:'complete'})); await copyFile(m.paths.bestCandidate,m.paths.bestCandidate+'.copy'); await writeFile(m.paths.completion+'.tmp',JSON.stringify({status:'exact',claimedExact:true,matchedBytes:4,totalBytes:4,attempts:1,firstMismatch:null,candidatePath:m.paths.bestCandidate,artifactPaths:[]})); await rename(m.paths.completion+'.tmp',m.paths.completion); await writeFile(m.repositoryRoot+'/candidate.c','int f(void) { return 22; }\\n'); console.log(JSON.stringify({type:'tool_execution_end',toolName:'decomp_matcher_complete',toolCallId:'complete',isError:false}));\n`);
		const changed = await tools.get("decomp_match").execute("call", { task: "mutate", function: "f", evidence: [], initialCandidate: "candidate.c", scratchCommand: [scratch, "{candidate}", "{attemptDir}"], attempts: 2, softSeconds: 1, hardSeconds: 5, allowInlineAssembly: false }, undefined, undefined, { cwd: root });
		assert.equal(changed.details.repository.changed, true); assert.match(changed.content[0].text, /WARNING: repository state changed/);

		await writeFile(launcher, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000);\n`);
		const controller = new AbortController(); const started = Date.now();
		const cancelled = tools.get("decomp_match").execute("call", { task: "cancel", function: "f", evidence: [], initialCandidate: "candidate.c", scratchCommand: [scratch, "{candidate}", "{attemptDir}"], attempts: 2, softSeconds: 1, hardSeconds: 30, allowInlineAssembly: false }, controller.signal, undefined, { cwd: root });
		setTimeout(() => controller.abort(), 200);
		await assert.rejects(cancelled, /child did not exit normally/); assert.ok(Date.now() - started < 5000);
	});
});

test("child mode exposes only the terminating completion tool", async () => {
	await withEnv({ PI_DECOMP_MATCHER_MANIFEST: "/tmp/manifest.json" }, async () => {
		const tools = new Map<string, any>(); decompMatcherExtension({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any);
		assert.deepEqual([...tools.keys()], ["decomp_matcher_complete"]);
	});
});
