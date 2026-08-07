// Build-time guard for the two things this package pins by hand: the runtime
// dependency list mirrored into ./package.json, and the code-mode host release
// prefetched by codex-conversion.nix. Upstream bumps either without changing
// anything Nix would notice on its own, so assert both against the tarball.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [targetDir, hostRelease, hostAssetName, hostAssetSha256] = process.argv.slice(2);

const fail = (message) => {
  console.error("pi-codex-conversion: " + message);
  process.exit(1);
};

const dependencies = (path) => {
  const deps = JSON.parse(readFileSync(path, "utf8")).dependencies ?? {};
  return Object.entries(deps)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, range]) => name + "@" + range)
    .join(", ");
};

const upstreamDeps = dependencies("upstream-package.json");
const vendoredDeps = dependencies("package.json");
if (upstreamDeps !== vendoredDeps) {
  fail(
    "vendored runtime dependencies are stale; regenerate package.json and package-lock.json" +
      "\n  upstream: " + upstreamDeps +
      "\n  vendored: " + vendoredDeps,
  );
}

const hostAssets = await import(
  pathToFileURL(resolve("dist/tools/code-mode/host-assets.js")).href
);

if (hostAssets.HOST_RELEASE !== hostRelease) {
  fail("code-mode host release moved to " + hostAssets.HOST_RELEASE);
}

const asset = hostAssets.HOST_ASSETS[targetDir];
if (!asset) {
  fail("upstream has no code-mode host asset for " + targetDir);
}
if (asset[0] !== hostAssetName) {
  fail("code-mode host asset for " + targetDir + " renamed to " + asset[0]);
}
if (asset[1] !== hostAssetSha256) {
  fail("code-mode host asset for " + targetDir + " now hashes to " + asset[1]);
}
