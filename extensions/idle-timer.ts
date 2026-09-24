import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const widgetKey = "idle-timer";

// Opt in with PI_IDLE_HOOK_MINUTES=5 and PI_IDLE_HOOK_COMMAND='your command'.
// The command runs once per idle period, in Pi's current working directory.
function hookConfig(): { minutes: number; command: string } | undefined {
	const command = process.env.PI_IDLE_HOOK_COMMAND?.trim();
	const rawMinutes = process.env.PI_IDLE_HOOK_MINUTES;
	if (!command || !rawMinutes || !/^\d+$/.test(rawMinutes)) return undefined;
	const minutes = Number(rawMinutes);
	return Number.isSafeInteger(minutes) && minutes > 0 ? { minutes, command } : undefined;
}

/** Show elapsed time only after the agent has fully settled, not between turns. */
export default function idleTimer(pi: ExtensionAPI) {
	let interval: ReturnType<typeof setInterval> | undefined;
	let settledAt: number | undefined;
	let shownMinute = -1;
	let fired = false;
	let hook: ReturnType<typeof hookConfig>;

	function stop(ctx: ExtensionContext) {
		if (interval !== undefined) clearInterval(interval);
		interval = undefined;
		settledAt = undefined;
		shownMinute = -1;
		fired = false;
		if (ctx.mode === "tui") ctx.ui.setWidget(widgetKey, undefined);
	}

	function update(ctx: ExtensionContext) {
		if (settledAt === undefined || ctx.mode !== "tui") return;
		const minutes = Math.max(0, Math.floor((Date.now() - settledAt) / 60_000));
		if (!fired && hook && minutes >= hook.minutes) {
			fired = true;
			const child = spawn(hook.command, { cwd: ctx.cwd, shell: true, stdio: "ignore" });
			child.on("error", (error) => ctx.ui.notify(`Idle hook failed: ${error.message}`, "error"));
			child.on("exit", (code) => {
				if (code !== 0) ctx.ui.notify(`Idle hook exited with code ${code}`, "error");
			});
		}
		if (minutes === shownMinute) return;
		shownMinute = minutes;
		ctx.ui.setWidget(widgetKey, (_tui, theme) => ({
			render: (width) => [truncateToWidth(theme.fg("dim", `Idle ${minutes}m`), width, "")],
			invalidate() {},
		}));
	}

	pi.on("session_start", (_event, ctx) => {
		stop(ctx);
		hook = hookConfig();
	});
	pi.on("agent_start", (_event, ctx) => stop(ctx));
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		stop(ctx);
		settledAt = Date.now();
		update(ctx);
		interval = setInterval(() => update(ctx), 1000);
	});
	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
