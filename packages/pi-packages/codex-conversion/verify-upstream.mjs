// Build-time guard for the code-mode host release prefetched by
// codex-conversion.nix. Assert the pin against the compiled pidex source.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [targetDir, hostRelease, hostAssetName, hostAssetSha256] = process.argv.slice(2);

const fail = (message) => {
  console.error("pi-codex-conversion: " + message);
  process.exit(1);
};

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
