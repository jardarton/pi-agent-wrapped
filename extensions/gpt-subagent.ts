import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { setTimeout as delay } from "node:timers/promises";
import { getPiInvocationParts } from "./lib/launcher.ts";

export const GPT_SUBAGENT_MODELS = {
	luna: "gpt-5.6-luna",
	sol: "gpt-5.6-sol",
	astra: "gpt-6-astra",
} as const;

export type GptSubagentModel = keyof typeof GPT_SUBAGENT_MODELS;

const MODEL_NAMES = Object.keys(GPT_SUBAGENT_MODELS) as GptSubagentModel[];
const LAUNCH_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 5_000;

const GptSubagentParams = Type.Object({
	model: StringEnum(MODEL_NAMES, {
		description: "Choose luna (GPT-5.6, lightweight tasks), sol (GPT-5.6, demanding coding/review), or astra (GPT-6, highest-tier and higher-cost option for the hardest tasks).",
	}),
	task: Type.String({
		minLength: 1,
		pattern: "\\S",
		description: "Complete task prompt; the subagent cannot see the parent conversation",
	}),
});

interface GptSubagentDetails {
	model: GptSubagentModel;
	modelRef: string;
	pane: string;
	task?: string;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parsePaneId(output: string): string {
	let response: unknown;
	try {
		response = JSON.parse(output);
	} catch {
		throw new Error(`Herdr returned invalid JSON while creating the subagent pane: ${output.trim() || "(empty output)"}`);
	}

	const pane = (response as any)?.result?.pane?.pane_id;
	if (typeof pane !== "string" || !pane.trim()) {
		throw new Error(`Herdr did not return a pane id: ${output.trim() || "(empty output)"}`);
	}
	return pane;
}

function providerFor(ctx: ExtensionContext): string {
	const provider = ctx.model?.provider ?? process.env.PI_PROVIDER;
	if (!provider?.trim()) {
		throw new Error("GPT subagent requires a current provider to qualify the selected model.");
	}
	const name = provider.trim();
	const missing = Object.values(GPT_SUBAGENT_MODELS).filter((id) => !ctx.modelRegistry.find(name, id));
	if (missing.length) {
		throw new Error(`GPT subagent provider ${name} is missing required models: ${missing.join(", ")}.`);
	}
	return name;
}

// Bound the caller's wait as well as requesting termination of the CLI. Cleanup
// gets its own budget and must not inherit an already-aborted launch signal.
async function runHerdr(pi: ExtensionAPI, args: string[], timeout: number, signal?: AbortSignal) {
	if (signal?.aborted) throw new Error("GPT subagent launch was cancelled.");
	if (timeout <= 0) throw new Error("GPT subagent launch timed out.");
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const interrupted = new Promise<never>((_resolve, reject) => {
		onAbort = () => {
			controller.abort();
			reject(new Error("GPT subagent launch was cancelled."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(`Herdr ${args.slice(0, 2).join(" ")} timed out.`));
		}, timeout);
	});
	try {
		const result = await Promise.race([
			pi.exec("herdr", args, { signal: controller.signal, timeout }),
			interrupted,
		]);
		if (signal?.aborted) throw new Error("GPT subagent launch was cancelled.");
		if (result.killed) throw new Error(`Herdr ${args.slice(0, 2).join(" ")} was terminated.`);
		return result;
	} finally {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
	}
}

export async function launchGptSubagent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	model: GptSubagentModel,
	task?: string,
	signal?: AbortSignal,
): Promise<GptSubagentDetails> {
	if (process.env.HERDR_ENV !== "1") {
		throw new Error("GPT subagent requires Pi to be running inside Herdr (HERDR_ENV=1).");
	}

	const [launcher] = getPiInvocationParts();
	const modelRef = `${providerFor(ctx)}/${GPT_SUBAGENT_MODELS[model]}`;
	const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
	const remaining = () => Math.min(COMMAND_TIMEOUT_MS, deadline - Date.now());
	const split = await runHerdr(pi, [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		ctx.cwd,
		"--no-focus",
	], remaining(), signal);
	if (split.code !== 0) {
		throw new Error(split.stderr.trim() || split.stdout.trim() || `Herdr pane split failed with exit code ${split.code}.`);
	}

	const pane = parsePaneId(split.stdout);
	try {
		const command = [launcher, "--model", modelRef];
		const trimmedTask = task?.trim();
		if (trimmedTask) command.push("--", trimmedTask);

		const started = await runHerdr(pi, ["pane", "run", pane, command.map(shellQuote).join(" ")], remaining(), signal);
		if (started.code !== 0) {
			throw new Error(started.stderr.trim() || started.stdout.trim() || `Herdr failed to launch Pi with exit code ${started.code}.`);
		}

		while (Date.now() < deadline) {
			if (signal?.aborted) throw new Error("GPT subagent launch was cancelled.");
			const detected = await runHerdr(pi, ["agent", "get", pane], remaining(), signal);
			if (detected.code === 0 && Date.now() < deadline) {
				return {
					model,
					modelRef,
					pane,
					task: trimmedTask,
				};
			}
			await delay(Math.max(0, Math.min(200, deadline - Date.now())), undefined, { signal });
		}

		const screen = await runHerdr(pi, ["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "20"], COMMAND_TIMEOUT_MS, signal)
			.catch(() => undefined);
		const diagnostic = screen?.stdout.trim();
		throw new Error(`Pi subagent did not become ready in Herdr pane ${pane}.${diagnostic ? `\n\n${diagnostic}` : ""}`);
	} catch (error) {
		await runHerdr(pi, ["pane", "close", pane], COMMAND_TIMEOUT_MS).catch(() => undefined);
		throw error;
	}
}

export default function gptSubagentExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "agent",
		label: "Agent",
		description:
			"Open a new background Herdr pane containing an independent GPT subagent. Choose Luna, Sol, or Astra and provide the complete task because the subagent cannot see this conversation. Astra is GPT-6, a higher-tier, higher-cost choice.",
		promptSnippet: "Launch an independent GPT subagent in a new Herdr pane",
		promptGuidelines: [
			"Use agent when the user asks to delegate work to a GPT subagent or requests a second opinion from GPT.",
			"Choose Luna for lightweight, bounded tasks; Sol for demanding coding and review; reserve Astra (GPT-6) for the hardest reasoning, architecture, or high-stakes review tasks, or when the user explicitly requests it.",
			"The agent task must contain all context the child needs because it cannot see the parent conversation.",
		],
		parameters: GptSubagentParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!params.task.trim()) throw new Error("GPT subagent task must not be blank.");
			const result = await launchGptSubagent(pi, ctx, params.model, params.task, signal);
			return {
				content: [
					{
						type: "text",
						text: `Launched ${result.model} subagent (${result.modelRef}) in Herdr pane ${result.pane}.`,
					},
				],
				details: result,
			};
		},
		renderCall(args, theme) {
			const model = typeof args.model === "string" ? args.model : "...";
			const task = typeof args.task === "string" ? args.task.trim() : "";
			const preview = task.split("\n").find((line) => line.trim()) ?? "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Agent"))} ${theme.fg("accent", model)}\n${theme.fg("dim", preview.slice(0, 120))}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as GptSubagentDetails | undefined;
			const text = details
				? `${details.model} launched in ${details.pane}`
				: (result.content[0]?.type === "text" ? result.content[0].text : "GPT subagent launch failed");
			return new Text(theme.fg(details ? "success" : "error", text), 0, 0);
		},
	});

	for (const model of MODEL_NAMES) {
		pi.registerCommand(model, {
			description: `Launch ${model} (${GPT_SUBAGENT_MODELS[model]}${model === "astra" ? ", highest tier / higher cost" : ""}) in a new Herdr pane: /${model} [task]`,
			handler: async (args, ctx) => {
				try {
					const result = await launchGptSubagent(pi, ctx, model, args);
					const suffix = result.task ? " and sent its task" : "";
					ctx.ui.notify(`Launched ${model} in Herdr pane ${result.pane}${suffix}.`, "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
			},
		});
	}
}
