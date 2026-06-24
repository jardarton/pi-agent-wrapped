/**
 * Cheap Model Extension
 *
 * Overrides Pi's default /tree summarizer and session compaction so they can use
 * a configured cheap model instead of the active chat model.
 *
 * Configure both with:
 *   PI_CHEAP_MODEL=openai-codex/gpt-5.4-mini
 *   PI_CHEAP_FALLBACK_MODELS=github-copilot/gpt-5.4-mini,anthropic/claude-haiku-4-5
 *
 * Optional per-feature overrides:
 *   PI_TREE_SUMMARY_MODEL=...
 *   PI_TREE_SUMMARY_FALLBACK_MODELS=...
 *   PI_COMPACTION_MODEL=...
 *   PI_COMPACTION_FALLBACK_MODELS=...
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compact, generateBranchSummary } from "@earendil-works/pi-coding-agent";
import { resolveCheapModel } from "./lib/model-selection";

export default function (pi: ExtensionAPI) {
	pi.on("session_before_tree", async (event, ctx) => {
		const { preparation, signal } = event;
		if (!preparation.userWantsSummary || preparation.entriesToSummarize.length === 0) return;

		const selected = await resolveCheapModel(ctx, {
			primaryEnv: "PI_TREE_SUMMARY_MODEL",
			fallbackEnv: "PI_TREE_SUMMARY_FALLBACK_MODELS",
			reserveTokens: 16384,
		});
		if ("error" in selected) {
			ctx.ui.notify(`${selected.error}; using default tree summarizer.`, "info");
			return;
		}

		const { config, model, apiKey, headers } = selected;
		ctx.ui.notify(
			`Summarizing abandoned /tree branch with ${config.provider}/${config.id} (${preparation.entriesToSummarize.length} entries)...`,
			"info",
		);

		try {
			const result = await generateBranchSummary(preparation.entriesToSummarize, {
				model,
				apiKey,
				headers,
				signal,
				reserveTokens: config.reserveTokens ?? 16384,
			});

			if (result.aborted) return { cancel: true };
			if (result.error) {
				ctx.ui.notify(`Tree summary failed: ${result.error}; using default summarizer.`, "warning");
				return;
			}

			return {
				summary: {
					summary: result.summary || "No summary generated",
					details: {
						readFiles: result.readFiles ?? [],
						modifiedFiles: result.modifiedFiles ?? [],
					},
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Tree summary extension failed: ${message}; using default summarizer.`, "warning");
			return;
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, customInstructions, signal } = event;
		const selected = await resolveCheapModel(ctx, {
			primaryEnv: "PI_COMPACTION_MODEL",
			fallbackEnv: "PI_COMPACTION_FALLBACK_MODELS",
		});
		if ("error" in selected) {
			ctx.ui.notify(`${selected.error}; using default compaction model.`, "info");
			return;
		}

		const { config, model, apiKey, headers } = selected;
		ctx.ui.notify(`Compacting session with ${config.provider}/${config.id}...`, "info");

		try {
			const result = await compact(preparation, model, apiKey, headers, customInstructions, signal);
			return { compaction: result };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Cheap-model compaction failed: ${message}; using default compaction model.`, "warning");
			return;
		}
	});
}
