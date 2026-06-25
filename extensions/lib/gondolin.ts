import path from "node:path";
import { constants } from "node:fs";
import { RealFSProvider, VM } from "@earendil-works/gondolin";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const localWorkspace = process.cwd();
const DEFAULT_GUEST_WORKSPACE = "/workspace";
const STATUS_KEY = "gondolin";

type TextWorkspace = {
	readText: (absolutePath: string) => Promise<string>;
	writeText: (absolutePath: string, content: string) => Promise<void>;
	deleteFile: (absolutePath: string) => Promise<void>;
	exists: (absolutePath: string) => Promise<boolean>;
	checkWriteAccess: (absolutePath: string) => Promise<void>;
};

let enabled = parseEnabled(process.env.PI_GONDOLIN_ENABLED ?? process.env.PI_GONDOLIN);
let guestWorkspace = normalizeGuestWorkspace(process.env.PI_GONDOLIN_GUEST_MOUNT_PATH);
let vm: VM | undefined;
let vmStarting: Promise<VM> | undefined;
let shellPath = "/bin/sh";

function parseEnabled(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeGuestWorkspace(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) return DEFAULT_GUEST_WORKSPACE;
	const normalized = path.posix.resolve("/", trimmed);
	return normalized === "/" ? DEFAULT_GUEST_WORKSPACE : normalized;
}

function stripAtPrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function toPosix(value: string): string {
	return value.split(path.sep).join(path.posix.sep);
}

function isInsideHostPath(root: string, value: string): boolean {
	const relativePath = path.relative(root, value);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function hostPathToGuest(hostPath: string): string {
	const relativePath = path.relative(localWorkspace, hostPath);
	if (!isInsideHostPath(localWorkspace, hostPath)) return toPosix(hostPath);
	return relativePath ? path.posix.join(guestWorkspace, toPosix(relativePath)) : guestWorkspace;
}

export function getLocalWorkspace(): string {
	return localWorkspace;
}

export function getGuestWorkspace(): string {
	return guestWorkspace;
}

export function isGondolinEnabled(): boolean {
	return enabled;
}

export function getGondolinShellPath(): string {
	return shellPath;
}

export function toGuestPath(inputPath: string): string {
	const trimmed = stripAtPrefix(inputPath.trim());
	if (!trimmed) return guestWorkspace;
	if (path.isAbsolute(trimmed)) {
		if (isInsideHostPath(localWorkspace, trimmed)) return hostPathToGuest(trimmed);
		return path.posix.resolve("/", toPosix(trimmed));
	}
	return path.posix.resolve(guestWorkspace, toPosix(trimmed));
}

function setUiStatus(ctx: ExtensionContext | undefined, text: string | undefined, tone: "accent" | "muted" = "accent") {
	if (!ctx?.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, text ? ctx.ui.theme.fg(tone, text) : undefined);
}

async function startVm(ctx?: ExtensionContext): Promise<VM> {
	setUiStatus(ctx, `Gondolin: starting ${guestWorkspace}`);
	const imagePath = process.env.GONDOLIN_IMAGE_PATH?.trim();
	const created = await VM.create({
		sessionLabel: `pi ${path.basename(localWorkspace)}`,
		sandbox: imagePath ? { imagePath } : undefined,
		vfs: {
			mounts: {
				[guestWorkspace]: new RealFSProvider(localWorkspace),
			},
		},
	});
	const bashProbe = await created.exec(["/bin/sh", "-lc", "command -v bash || true"]);
	shellPath = bashProbe.stdout.trim() || "/bin/sh";
	vm = created;
	setUiStatus(ctx, `Gondolin: ${created.id.slice(0, 8)} (${guestWorkspace})`);
	if (ctx?.hasUI) {
		ctx.ui.notify(`Gondolin VM ready. ${localWorkspace} is mounted at ${guestWorkspace}.`, "info");
	}
	return created;
}

export async function ensureGondolinVm(ctx?: ExtensionContext): Promise<VM> {
	if (!enabled) throw new Error("Gondolin is disabled.");
	if (vm) return vm;
	if (!vmStarting) {
		vmStarting = startVm(ctx).finally(() => {
			vmStarting = undefined;
		});
	}
	return vmStarting;
}

export async function stopGondolinVm(ctx?: ExtensionContext): Promise<void> {
	const activeVm = vmStarting ? await vmStarting.catch(() => undefined) : vm;
	vm = undefined;
	vmStarting = undefined;
	if (!activeVm) {
		setUiStatus(ctx, undefined);
		return;
	}
	setUiStatus(ctx, "Gondolin: stopping", "muted");
	try {
		await activeVm.close();
	} finally {
		setUiStatus(ctx, undefined);
	}
}

export async function setGondolinEnabled(nextEnabled: boolean, ctx?: ExtensionContext): Promise<boolean> {
	if (enabled === nextEnabled) {
		if (!enabled) setUiStatus(ctx, undefined);
		return enabled;
	}
	enabled = nextEnabled;
	if (enabled) {
		await ensureGondolinVm(ctx);
	} else {
		await stopGondolinVm(ctx);
	}
	return enabled;
}

export async function toggleGondolinEnabled(ctx?: ExtensionContext): Promise<boolean> {
	return setGondolinEnabled(!enabled, ctx);
}

export function getGondolinStatus() {
	return {
		enabled,
		localWorkspace,
		guestWorkspace,
		vmId: vm?.id,
		shellPath,
	};
}

export async function createGondolinTextWorkspace(): Promise<TextWorkspace> {
	const activeVm = await ensureGondolinVm();
	return {
		readText: (absolutePath) => activeVm.fs.readFile(hostPathToGuest(absolutePath), { encoding: "utf-8" }),
		writeText: (absolutePath, content) => activeVm.fs.writeFile(hostPathToGuest(absolutePath), content, { encoding: "utf-8" }),
		deleteFile: (absolutePath) => activeVm.fs.deleteFile(hostPathToGuest(absolutePath)),
		exists: async (absolutePath) => {
			try {
				await activeVm.fs.access(hostPathToGuest(absolutePath));
				return true;
			} catch {
				return false;
			}
		},
		checkWriteAccess: (absolutePath) =>
			activeVm.fs.access(hostPathToGuest(absolutePath), { mode: constants.R_OK | constants.W_OK }),
	};
}
