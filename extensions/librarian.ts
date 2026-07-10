import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

const DEFAULT_UPDATE_INTERVAL = 300;
const DEFAULT_HOST = "github.com";

const LibrarianParams = Type.Object({
	repo: Type.String({ description: "Repository URL or shorthand (owner/repo, host/org/repo, https://..., git@...)." }),
	forceUpdate: Type.Optional(Type.Boolean({ description: "Always fetch and attempt a fast-forward update." })),
	updateInterval: Type.Optional(Type.Number({ description: "Minimum seconds between fetches. Default: 300." })),
});

interface ParsedRepo {
	host: string;
	org: string;
	repo: string;
	originUrl: string;
}

interface CheckoutDetails extends ParsedRepo {
	path: string;
	cloned: boolean;
	updated: boolean;
	cloneState: "cloned" | "existing";
	update: "fetched" | "skipped";
	fastForward: "fast-forwarded" | "not-attempted" | "skipped-non-ff" | "skipped-dirty" | "skipped-no-upstream";
}

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_AUTHORITY = /^[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?$/;

function validateComponents(host: string, parts: string[]) {
	if (!SAFE_AUTHORITY.test(host)) throw new Error(`unsafe host component: ${host || "<empty>"}`);
	const port = host.includes(":") ? Number(host.slice(host.lastIndexOf(":") + 1)) : null;
	if (port !== null && (port < 1 || port > 65535)) throw new Error(`unsafe host component: ${host}`);
	for (const [label, component] of parts.map((part) => ["repository path", part] as const)) {
		if (!SAFE_COMPONENT.test(component) || component === "." || component === "..") {
			throw new Error(`unsafe ${label} component: ${component || "<empty>"}`);
		}
	}
}

export async function safeCheckoutPath(root: string, parsed: ParsedRepo) {
	await fs.mkdir(root, { recursive: true });
	const resolvedRoot = await fs.realpath(root);
	let current = resolvedRoot;
	for (const component of [parsed.host, ...parsed.org.split("/"), parsed.repo]) {
		current = path.join(current, component);
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`symlink is not allowed in checkout path: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return current;
}

function trimRepoInput(input: string): string {
	return input.trim();
}

export function parseRepo(rawInput: string): ParsedRepo {
	let input = trimRepoInput(rawInput);
	input = input.split("?")[0] ?? input;
	input = input.split("#")[0] ?? input;

	let host = "";
	let repoPath = "";
	let sshOrigin = "";

	if (/^git@[^:]+:.+/.test(input)) {
		host = input.slice(4).split(":")[0] ?? "";
		repoPath = input.slice(input.indexOf(":") + 1);
		sshOrigin = input;
	} else if (input.startsWith("ssh://")) {
		const rest = input.slice("ssh://".length);
		host = (rest.split("/")[0] ?? "").replace(/^.*@/, "");
		repoPath = rest.slice(rest.indexOf("/") + 1);
		sshOrigin = input;
	} else if (input.startsWith("http://") || input.startsWith("https://")) {
		const url = new URL(input);
		host = url.host;
		repoPath = url.pathname.replace(/^\/+/, "");
	} else if (input.includes("/")) {
		const first = input.split("/")[0] ?? "";
		if (first.includes(".") || first === "localhost") {
			host = first;
			repoPath = input.slice(first.length + 1);
		} else {
			host = process.env.LIBRARIAN_DEFAULT_HOST || DEFAULT_HOST;
			repoPath = input;
		}
	} else {
		throw new Error(`unsupported repository format: ${input}`);
	}

	host = host.replace(/^.*@/, "");
	repoPath = repoPath.replace(/^\/+/, "").replace(/\/+$/, "");
	let parts = repoPath.split("/").filter(Boolean);

	if (parts.length >= 3 && ["tree", "blob", "pull", "issues", "commit", "actions", "releases", "compare", "wiki"].includes(parts[2] ?? "")) {
		parts = parts.slice(0, 2);
	}

	if (parts.length < 2) {
		throw new Error(`repository path must contain at least org/repo: ${repoPath}`);
	}

	parts[parts.length - 1] = (parts[parts.length - 1] ?? "").replace(/\.git$/, "");
	validateComponents(host, parts);
	const repo = parts[parts.length - 1] ?? "";
	const org = parts.slice(0, -1).join("/");
	if (!host || !org || !repo) throw new Error(`failed to parse repository: ${input}`);
	const originUrl = sshOrigin
		? `${sshOrigin.replace(/\/+$/, "").replace(/\.git$/, "")}.git`
		: `https://${host}/${org}/${repo}.git`;
	return { host, org, repo, originUrl };
}

function cacheRoot(): string {
	return process.env.LIBRARIAN_CACHE_ROOT || path.join(os.homedir(), ".cache", "checkouts");
}

function runGit(args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile("git", args, { cwd, signal }, (error, stdout, stderr) => {
			if (error) {
				const message = stderr?.trim() || stdout?.trim() || error.message;
				reject(new Error(message));
				return;
			}
			resolve(stdout.trim());
		});
		child.stdin?.end();
	});
}

async function readNumber(file: string): Promise<number | null> {
	try {
		const text = await fs.readFile(file, "utf8");
		return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
	} catch {
		return null;
	}
}

export default function librarianExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "librarian",
		label: "Librarian",
		description:
			"Checkout and refresh a remote git repository in ~/.cache/checkouts/<host>/<org>/<repo>. " +
			"Returns structured details including path, cloned, updated, host, org, and repo.",
		parameters: LibrarianParams,

		async execute(_id, params, signal) {
			try {
				const parsed = parseRepo(params.repo);
				const root = cacheRoot();
				const checkoutPath = await safeCheckoutPath(root, parsed);
				const originUrl = parsed.originUrl;
				const updateInterval = params.updateInterval ?? Number(process.env.LIBRARIAN_UPDATE_INTERVAL || DEFAULT_UPDATE_INTERVAL);
				if (!Number.isFinite(updateInterval) || updateInterval < 0) throw new Error("updateInterval must be a non-negative number");

				await fs.mkdir(path.dirname(checkoutPath), { recursive: true });

				let cloned = false;
				if (!existsSync(path.join(checkoutPath, ".git"))) {
					await runGit(["clone", "--filter=blob:none", originUrl, checkoutPath], undefined, signal);
					cloned = true;
				}

				if (!existsSync(path.join(checkoutPath, ".git"))) {
					throw new Error(`checkout path is not a git repository: ${checkoutPath}`);
				}

				try {
					await runGit(["remote", "get-url", "origin"], checkoutPath, signal);
				} catch {
					await runGit(["remote", "add", "origin", originUrl], checkoutPath, signal);
				}
				const currentOrigin = await runGit(["remote", "get-url", "origin"], checkoutPath, signal);
				if (currentOrigin !== originUrl) await runGit(["remote", "set-url", "origin", originUrl], checkoutPath, signal);

				const lastFetchFile = path.join(checkoutPath, ".git", "librarian-last-fetch");
				const now = Math.floor(Date.now() / 1000);
				const lastFetch = await readNumber(lastFetchFile);
				const needsUpdate = Boolean(params.forceUpdate) || lastFetch === null || now - lastFetch >= updateInterval;

				let updated = false;
				let update: CheckoutDetails["update"] = "skipped";
				let fastForward: CheckoutDetails["fastForward"] = "not-attempted";

				if (needsUpdate) {
					await runGit(["fetch", "--prune", "--tags", "origin"], checkoutPath, signal);
					await fs.writeFile(lastFetchFile, String(now));
					updated = true;
					update = "fetched";

					const branch = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], checkoutPath, signal).catch(() => "");
					const upstream = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], checkoutPath, signal).catch(() => "");
					const dirty = await runGit(["status", "--porcelain", "--untracked-files=no"], checkoutPath, signal);

					if (branch && upstream && !dirty) {
						try {
							await runGit(["merge", "--ff-only", upstream], checkoutPath, signal);
							fastForward = "fast-forwarded";
						} catch {
							fastForward = "skipped-non-ff";
						}
					} else if (dirty) {
						fastForward = "skipped-dirty";
					} else {
						fastForward = "skipped-no-upstream";
					}
				}

				const details: CheckoutDetails = {
					...parsed,
					path: checkoutPath,
					cloned,
					updated,
					cloneState: cloned ? "cloned" : "existing",
					update,
					fastForward,
				};

				return {
					content: [{ type: "text", text: checkoutPath }],
					details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message },
				};
			}
		},
	});
}
