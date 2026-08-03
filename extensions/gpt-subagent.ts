import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getPiInvocationParts } from "./lib/launcher.ts";

export const GPT_SUBAGENT_MODELS = {
	luna: "gpt-5.6-luna",
	terra: "gpt-5.6-terra",
	sol: "gpt-5.6-sol",
} as const;

export type GptSubagentModel = keyof typeof GPT_SUBAGENT_MODELS;

const MODEL_NAMES = Object.keys(GPT_SUBAGENT_MODELS) as GptSubagentModel[];

const GptSubagentParams = Type.Object({
	model: StringEnum(MODEL_NAMES, {
		description: "GPT model tier for the subagent",
	}),
	task: Type.String({
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
	return provider.trim();
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
	const split = await pi.exec("herdr", [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		ctx.cwd,
		"--no-focus",
	], { signal });
	if (split.code !== 0) {
		throw new Error(split.stderr.trim() || split.stdout.trim() || `Herdr pane split failed with exit code ${split.code}.`);
	}

	const pane = parsePaneId(split.stdout);
	try {
		const command = [launcher, "--model", modelRef];
		const trimmedTask = task?.trim();
		if (trimmedTask) command.push("--", trimmedTask);

		const started = await pi.exec("herdr", ["pane", "run", pane, command.map(shellQuote).join(" ")], { signal });
		if (started.code !== 0) {
			throw new Error(started.stderr.trim() || started.stdout.trim() || `Herdr failed to launch Pi with exit code ${started.code}.`);
		}

		for (let attempt = 0; attempt < 150; attempt++) {
			if (signal?.aborted) throw new Error("GPT subagent launch was cancelled.");
			const detected = await pi.exec("herdr", ["agent", "get", pane], { signal });
			if (detected.code === 0) {
				return {
					model,
					modelRef,
					pane,
					task: trimmedTask,
				};
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		const screen = await pi.exec("herdr", ["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "20"]);
		const diagnostic = screen.stdout.trim();
		throw new Error(`Pi subagent did not become ready in Herdr pane ${pane}.${diagnostic ? `\n\n${diagnostic}` : ""}`);
	} catch (error) {
		await pi.exec("herdr", ["pane", "close", pane]);
		throw error;
	}
}

export default function gptSubagentExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "agent",
		label: "Agent",
		description:
			"Open a new background Herdr pane containing an independent GPT subagent. Choose Luna, Terra, or Sol and provide the complete task because the subagent cannot see this conversation.",
		promptSnippet: "Launch an independent GPT subagent in a new Herdr pane",
		promptGuidelines: [
			"Use agent when the user asks to delegate work to a GPT subagent or requests a second opinion from GPT.",
			"The agent task must contain all context the child needs because it cannot see the parent conversation.",
		],
		parameters: GptSubagentParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
			description: `Launch a ${model} GPT subagent in a new Herdr pane: /${model} [task]`,
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
