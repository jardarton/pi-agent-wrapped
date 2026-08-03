import assert from "node:assert/strict";
import test from "node:test";
import gptSubagentExtension, { GPT_SUBAGENT_MODELS } from "../gpt-subagent.ts";

const ENV_NAMES = ["HERDR_ENV", "PI_LAUNCHER_BIN", "PI_PROVIDER"] as const;

async function withEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string>>, fn: () => Promise<void>): Promise<void> {
	const saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
	for (const name of ENV_NAMES) {
		const value = values[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	try {
		await fn();
	} finally {
		for (const name of ENV_NAMES) {
			const value = saved[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

function mockExtension() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args });
			if (args[0] === "pane" && args[1] === "split") {
				return {
					code: 0,
					stdout: JSON.stringify({ result: { pane: { pane_id: "w1:p9" } } }),
					stderr: "",
				};
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	} as any;
	gptSubagentExtension(pi);
	return { tools, commands, calls };
}

function mockContext() {
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		ctx: {
			cwd: "/work/project",
			model: { provider: "openai-codex" },
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		},
		notifications,
	};
}

test("registers one GPT subagent tool and model slash commands", () => {
	const { tools, commands } = mockExtension();
	assert.deepEqual([...tools.keys()], ["agent"]);
	assert.deepEqual([...commands.keys()], ["luna", "terra", "sol"]);
	assert.deepEqual(GPT_SUBAGENT_MODELS, {
		luna: "gpt-5.6-luna",
		terra: "gpt-5.6-terra",
		sol: "gpt-5.6-sol",
	});
});

test("tool launches the exact active wrapper in a background Herdr pane", async () => {
	await withEnv(
		{
			HERDR_ENV: "1",
			PI_LAUNCHER_BIN: "/nix/store/example-pi/bin/p",
		},
		async () => {
			const { tools, calls } = mockExtension();
			const { ctx } = mockContext();
			const result = await tools.get("agent").execute(
				"call-1",
				{ model: "luna", task: "Review Bob's change" },
				undefined,
				undefined,
				ctx,
			);

			assert.deepEqual(calls[0], {
				command: "herdr",
				args: [
					"pane",
					"split",
					"--current",
					"--direction",
					"right",
					"--cwd",
					"/work/project",
					"--no-focus",
				],
			});
			assert.deepEqual(calls[1], {
				command: "herdr",
				args: [
					"pane",
					"run",
					"w1:p9",
					"'/nix/store/example-pi/bin/p' '--model' 'openai-codex/gpt-5.6-luna' '--' 'Review Bob'\"'\"'s change'",
				],
			});
			assert.deepEqual(calls[2], {
				command: "herdr",
				args: ["agent", "get", "w1:p9"],
			});
			assert.equal(result.details.pane, "w1:p9");
			assert.equal(result.details.modelRef, "openai-codex/gpt-5.6-luna");
		},
	);
});

test("option-like tasks are passed after an option terminator", async () => {
	await withEnv(
		{
			HERDR_ENV: "1",
			PI_LAUNCHER_BIN: "/nix/store/example-pi/bin/p",
		},
		async () => {
			const { commands, calls } = mockExtension();
			const { ctx } = mockContext();
			await commands.get("luna").handler("--help", ctx);

			assert.equal(
				calls[1].args[3],
				"'/nix/store/example-pi/bin/p' '--model' 'openai-codex/gpt-5.6-luna' '--' '--help'",
			);
		},
	);
});

test("slash command launches its model and permits an empty task", async () => {
	await withEnv(
		{
			HERDR_ENV: "1",
			PI_LAUNCHER_BIN: "/nix/store/example-pi/bin/p",
		},
		async () => {
			const { commands, calls } = mockExtension();
			const { ctx, notifications } = mockContext();
			await commands.get("sol").handler("", ctx);

			assert.equal(
				calls[1].args[3],
				"'/nix/store/example-pi/bin/p' '--model' 'openai-codex/gpt-5.6-sol'",
			);
			assert.deepEqual(notifications, [{ message: "Launched sol in Herdr pane w1:p9.", level: "info" }]);
		},
	);
});

test("tool fails before creating a pane outside Herdr or without the active launcher", async () => {
	await withEnv({ PI_LAUNCHER_BIN: "/nix/store/example-pi/bin/p" }, async () => {
		const { tools, calls } = mockExtension();
		const { ctx } = mockContext();
		await assert.rejects(
			tools.get("agent").execute(
				"call-1",
				{ model: "terra", task: "Inspect the repository" },
				undefined,
				undefined,
				ctx,
			),
			/requires Pi to be running inside Herdr/,
		);
		assert.equal(calls.length, 0);
	});

	await withEnv({ HERDR_ENV: "1" }, async () => {
		const { tools, calls } = mockExtension();
		const { ctx } = mockContext();
		await assert.rejects(
			tools.get("agent").execute(
				"call-2",
				{ model: "terra", task: "Inspect the repository" },
				undefined,
				undefined,
				ctx,
			),
			/requires PI_LAUNCHER_BIN/,
		);
		assert.equal(calls.length, 0);
	});
});
