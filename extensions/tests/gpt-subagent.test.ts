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

function mockExtension(override?: (args: string[], options: any) => any) {
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
		async exec(command: string, args: string[], options: any) {
			calls.push({ command, args });
			assert.ok(options.timeout > 0 && options.timeout <= 5_000);
			const overridden = override?.(args, options);
			if (overridden !== undefined) return overridden;
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
			modelRegistry: {
				find: (provider: string, id: string) => provider === "openai-codex"
					&& Object.values(GPT_SUBAGENT_MODELS).includes(id as any) ? { provider, id } : undefined,
			},
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
	assert.deepEqual([...commands.keys()], ["luna", "sol", "astra"]);
	assert.deepEqual(GPT_SUBAGENT_MODELS, {
		luna: "gpt-5.6-luna",
		sol: "gpt-5.6-sol",
		astra: "gpt-6-astra",
	});
});

const launchEnv = { HERDR_ENV: "1", PI_LAUNCHER_BIN: "/test/wrapper" };

test("Astra launches GPT-6 through the tool and slash command with higher-tier guidance", async () => {
	await withEnv(launchEnv, async () => {
		const { tools, commands, calls } = mockExtension();
		const tool = tools.get("agent");
		const { ctx } = mockContext();
		const result = await tool.execute("id", { model: "astra", task: "Review the architecture" }, undefined, undefined, ctx);
		assert.equal(result.details.modelRef, "openai-codex/gpt-6-astra");
		assert.match(calls[1].args[3], /openai-codex\/gpt-6-astra/);
		await commands.get("astra").handler("", ctx);
		assert.match(calls[4].args[3], /openai-codex\/gpt-6-astra/);
		assert.equal(commands.has("terra"), false);
		assert.match(tool.parameters.properties.model.description, /GPT-6.*highest-tier.*higher-cost/);
		assert.ok(tool.promptGuidelines.some((line: string) => /reserve Astra/.test(line)));
		assert.match(commands.get("astra").description, /highest tier \/ higher cost/);
	});
});

test("requires every tier on the current provider before splitting", async () => {
	await withEnv(launchEnv, async () => {
		for (const missing of Object.values(GPT_SUBAGENT_MODELS)) {
			const { tools, calls } = mockExtension();
			const { ctx } = mockContext();
			ctx.modelRegistry.find = (provider, id) => id === missing ? undefined : { provider, id };
			await assert.rejects(tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, ctx),
				new RegExp(`missing required models: ${missing}`));
			assert.equal(calls.length, 0);
		}
		const { tools, calls } = mockExtension();
		const { ctx } = mockContext();
		ctx.model.provider = "anthropic";
		await assert.rejects(tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, ctx), /provider anthropic is missing/);
		assert.equal(calls.length, 0);
	});
});

test("blank tool tasks fail without creating panes", async () => {
	await withEnv(launchEnv, async () => {
		const { tools, calls } = mockExtension();
		for (const task of ["", " \n\t "]) {
			await assert.rejects(tools.get("agent").execute("id", { model: "luna", task }, undefined, undefined, mockContext().ctx), /must not be blank/);
		}
		assert.equal(calls.length, 0);
	});
});

test("killed commands never count as success and owned panes are closed", async () => {
	await withEnv(launchEnv, async () => {
		for (const stage of ["split", "run", "get"]) {
			const { tools, calls } = mockExtension((args) => args[1] === stage ? { code: 0, killed: true, stdout: "", stderr: "" } : undefined);
			await assert.rejects(tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, mockContext().ctx), /was terminated/);
			assert.equal(calls.some(({ args }) => args[1] === "close"), stage !== "split");
		}
	});
});

test("abort during readiness cannot report success; cleanup uses a fresh signal", async () => {
	await withEnv(launchEnv, async () => {
		const controller = new AbortController();
		const { tools, calls } = mockExtension((args, options) => {
			if (args[1] === "get") controller.abort();
			if (args[1] === "close") assert.equal(options.signal.aborted, false);
		});
		await assert.rejects(tools.get("agent").execute("id", { model: "luna", task: "Review" }, controller.signal, undefined, mockContext().ctx), /cancelled/);
		assert.equal(calls.at(-1)?.args[1], "close");
	});
});

test("stalled readiness and cleanup are bounded even if exec ignores abort", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	await withEnv(launchEnv, async () => {
		const { tools, calls } = mockExtension((args) => ["get", "close"].includes(args[1]) ? new Promise(() => {}) : undefined);
		const result = tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, mockContext().ctx);
		const rejected = assert.rejects(result, /agent get timed out/);
		for (let n = 0; n < 30; n++) await Promise.resolve();
		assert.equal(calls.at(-1)?.args[1], "get");
		t.mock.timers.tick(5_000);
		for (let n = 0; n < 30; n++) await Promise.resolve();
		assert.equal(calls.at(-1)?.args[1], "close");
		t.mock.timers.tick(5_000);
		await rejected;
	});
});

test("overall deadline bounds polling and diagnostic collection", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	await withEnv(launchEnv, async () => {
		const { tools, calls } = mockExtension((args) => {
			if (args[1] === "get") {
				t.mock.timers.setTime(Date.now() + 30_000);
				return { code: 0, stdout: "", stderr: "" };
			}
			if (args[1] === "read") return new Promise(() => {});
		});
		const result = tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, mockContext().ctx);
		const rejected = assert.rejects(result, /did not become ready/);
		// The abortable polling sleep uses node:timers/promises, not global timers.
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		// Allow the zero-duration polling sleep to finish without advancing mocks.
		await import("node:timers/promises").then(({ setTimeout }) => setTimeout(10));
		assert.equal(calls.at(-1)?.args[1], "read");
		t.mock.timers.tick(5_000);
		await rejected;
		assert.equal(calls.at(-1)?.args[1], "close");
	});
});

test("cleanup failure preserves the launch error", async () => {
	await withEnv(launchEnv, async () => {
		const { tools } = mockExtension((args) => {
			if (args[1] === "run") return { code: 1, stdout: "", stderr: "launch failed" };
			if (args[1] === "close") throw new Error("cleanup failed");
		});
		await assert.rejects(tools.get("agent").execute("id", { model: "luna", task: "Review" }, undefined, undefined, mockContext().ctx), /launch failed/);
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
				{ model: "astra", task: "Inspect the repository" },
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
				{ model: "astra", task: "Inspect the repository" },
				undefined,
				undefined,
				ctx,
			),
			/requires PI_LAUNCHER_BIN/,
		);
		assert.equal(calls.length, 0);
	});
});
