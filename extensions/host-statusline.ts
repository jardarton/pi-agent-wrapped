import os from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home?: string): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

export default function (pi: ExtensionAPI) {
	let currentCtx: ExtensionContext | undefined;
	let currentThinkingLevel: string | undefined;
	const host = os.hostname();

	function install(ctx: ExtensionContext) {
		currentCtx = ctx;
		const latestThinkingEntry = [...(ctx.sessionManager.getBranch() as any[])]
			.reverse()
			.find((entry) => entry.type === "thinking_level_change");
		if (latestThinkingEntry?.thinkingLevel) currentThinkingLevel = latestThinkingEntry.thinkingLevel;
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((_tui, theme, footerData: ReadonlyFooterDataProvider) => ({
			render(width: number) {
				const ctx = currentCtx;
				if (!ctx) return [];

				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;
				let latestCacheHitRate: number | undefined;

				for (const entry of ctx.sessionManager.getEntries() as any[]) {
					if (entry.type === "message" && entry.message.role === "assistant" && entry.message.usage) {
						const usage = entry.message.usage;
						totalInput += usage.input || 0;
						totalOutput += usage.output || 0;
						totalCacheRead += usage.cacheRead || 0;
						totalCacheWrite += usage.cacheWrite || 0;
						totalCost += usage.cost?.total || 0;
						const latestPromptTokens = (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
						latestCacheHitRate = latestPromptTokens > 0 ? ((usage.cacheRead || 0) / latestPromptTokens) * 100 : undefined;
					}
				}

				let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
				const branch = footerData.getGitBranch();
				if (branch) pwd = `${pwd} (${branch})`;
				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) pwd = `${pwd} • ${sessionName}`;

				const hostText = theme.fg("dim", host);
				const hostWidth = visibleWidth(hostText);
				const gap = hostWidth > 0 ? 2 : 0;
				const pwdWidth = Math.max(0, width - hostWidth - gap);
				const pwdLineLeft = truncateToWidth(theme.fg("dim", pwd), pwdWidth, theme.fg("dim", "..."));
				const padding = " ".repeat(Math.max(0, width - visibleWidth(pwdLineLeft) - hostWidth));
				const pwdLine = pwdLineLeft + padding + hostText;

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
				if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
					statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
				}
				const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
				if (totalCost || usingSubscription) statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);

				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercentValue = contextUsage?.percent ?? 0;
				const contextPercent = contextUsage?.percent !== null && contextUsage?.percent !== undefined ? contextPercentValue.toFixed(1) : "?";
				const contextDisplay = contextPercent === "?" ? `?/${formatTokens(contextWindow)}` : `${contextPercent}%/${formatTokens(contextWindow)}`;
				statsParts.push(contextPercentValue > 90 ? theme.fg("error", contextDisplay) : contextPercentValue > 70 ? theme.fg("warning", contextDisplay) : contextDisplay);

				let statsLeft = statsParts.join(" ");
				let statsLeftWidth = visibleWidth(statsLeft);
				if (statsLeftWidth > width) {
					statsLeft = truncateToWidth(statsLeft, width, "...");
					statsLeftWidth = visibleWidth(statsLeft);
				}

				const modelName = ctx.model?.id || "no-model";
				let rightSide = ctx.model ? `(${ctx.model.provider}) ${modelName}` : modelName;
				if (ctx.model?.reasoning) {
					const thinkingLevel = currentThinkingLevel || "off";
					rightSide += thinkingLevel === "off" ? " • thinking off" : ` • ${thinkingLevel}`;
				}
				const availableForRight = Math.max(0, width - statsLeftWidth - 2);
				if (visibleWidth(rightSide) > availableForRight) rightSide = truncateToWidth(rightSide, availableForRight, "");
				const statsLine = statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(rightSide))) + rightSide;

				const lines = [pwdLine, theme.fg("dim", statsLeft) + theme.fg("dim", statsLine.slice(statsLeft.length))];
				const extensionStatuses = footerData.getExtensionStatuses();
				if (extensionStatuses.size > 0) {
					const statusLine = Array.from(extensionStatuses.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => sanitizeStatusText(text)).join(" ");
					lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
				}
				return lines;
			},
		}));
	}

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("model_select", (_event, ctx) => install(ctx));
	pi.on("thinking_level_select", (event, ctx) => {
		currentThinkingLevel = event.level;
		install(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
		currentCtx = undefined;
	});
}
