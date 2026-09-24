import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import idleTimer from "../idle-timer.ts";

test("idle timer appears after settle, advances, and stops during work and shutdown", () => {
	const handlers = new Map<string, (event: unknown, ctx: any) => void>();
	const widgets: Array<unknown> = [];
	const ctx = {
		mode: "tui",
		cwd: process.cwd(),
		ui: { setWidget: (_key: string, value: unknown) => widgets.push(value), notify: () => {} },
	};
	idleTimer({ on: (event: string, handler: any) => { handlers.set(event, handler); } } as any);
	const emit = (event: string) => handlers.get(event)?.({}, ctx);
	const originalNow = Date.now;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let tick: (() => void) | undefined;
	let cleared = 0;
	try {
		Date.now = () => 1000;
		globalThis.setInterval = ((fn: () => void) => { tick = fn; return 1; }) as typeof setInterval;
		globalThis.clearInterval = (() => { cleared++; }) as typeof clearInterval;
		emit("session_start");
		assert.equal(widgets.at(-1), undefined);
		emit("agent_settled");
		const render = () => (widgets.at(-1) as (tui: unknown, theme: any) => any)(null, { fg: (_color: string, text: string) => text }).render(80)[0];
		assert.equal(render(), "Idle 0m");
		Date.now = () => 61_000;
		tick?.();
		assert.equal(render(), "Idle 1m");
		emit("agent_start");
		assert.equal(widgets.at(-1), undefined);
		assert.equal(cleared, 1);
		emit("agent_settled");
		emit("session_shutdown");
		assert.equal(widgets.at(-1), undefined);
		assert.equal(cleared, 2);
	} finally {
		Date.now = originalNow;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("configured command fires once per idle period and is disabled without configuration", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-idle-hook-"));
	const file = join(dir, "fired");
	const savedCommand = process.env.PI_IDLE_HOOK_COMMAND;
	const savedMinutes = process.env.PI_IDLE_HOOK_MINUTES;
	const originalNow = Date.now;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let tick: (() => void) | undefined;
	const handlers = new Map<string, (event: unknown, ctx: any) => void>();
	const ctx = { mode: "tui", cwd: dir, ui: { setWidget: () => {}, notify: () => {} } };
	const emit = (event: string) => handlers.get(event)?.({}, ctx);
	try {
		process.env.PI_IDLE_HOOK_MINUTES = "1";
		process.env.PI_IDLE_HOOK_COMMAND = "printf x >> fired";
		Date.now = () => 0;
		globalThis.setInterval = ((fn: () => void) => { tick = fn; return 1; }) as typeof setInterval;
		globalThis.clearInterval = (() => {}) as typeof clearInterval;
		idleTimer({ on: (event: string, handler: any) => { handlers.set(event, handler); } } as any);
		emit("session_start");
		emit("agent_settled");
		assert.equal(existsSync(file), false);
		Date.now = () => 60_000;
		tick?.();
		for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(readFileSync(file, "utf8"), "x");
		tick?.();
		assert.equal(readFileSync(file, "utf8"), "x");
		emit("agent_start");
		emit("session_shutdown");
	} finally {
		Date.now = originalNow;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		if (savedCommand === undefined) delete process.env.PI_IDLE_HOOK_COMMAND;
		else process.env.PI_IDLE_HOOK_COMMAND = savedCommand;
		if (savedMinutes === undefined) delete process.env.PI_IDLE_HOOK_MINUTES;
		else process.env.PI_IDLE_HOOK_MINUTES = savedMinutes;
		rmSync(dir, { recursive: true, force: true });
	}
});
