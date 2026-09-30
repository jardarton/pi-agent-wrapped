import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const packageDir = process.env.FFF_PACKAGE_DIR;
assert.ok(packageDir, "FFF_PACKAGE_DIR must point to the installed FFF package");
const require = createRequire(join(packageDir, "package.json"));
const ffiPath = require.resolve("ffi-rs");

// Open real sockets before libc detection, as another Pi extension can do.
// Intercept getReport so an unpatched loader fails deterministically instead
// of depending on whether the build machine's reverse DNS happens to be slow.
for (const initial of [false, true]) {
  test(`libc detection excludes diagnostic networking and restores ${initial}`, {
    skip: process.platform !== "linux",
  }, async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const accepted = once(server, "connection");
    const client = createConnection(server.address().port, "127.0.0.1");
    const connected = once(client, "connect");
    const [peer] = await accepted;
    await connected;
    const originalReport = process.report.getReport;
    const originalExclude = process.report.excludeNetwork;
    let calls = 0;
    try {
      process.report.excludeNetwork = initial;
      process.report.getReport = (...args) => {
        calls++;
        assert.equal(process.report.excludeNetwork, true,
          "libc detection must not perform diagnostic DNS lookups");
        return originalReport.apply(process.report, args);
      };
      delete require.cache[ffiPath];
      require(ffiPath);
      assert.equal(calls, 1, "the libc check must still execute");
      assert.equal(process.report.excludeNetwork, initial);
    } finally {
      process.report.getReport = originalReport;
      process.report.excludeNetwork = originalExclude;
      client.destroy();
      peer.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test("libc detection restores diagnostic networking if getReport throws", {
  skip: process.platform !== "linux",
}, () => {
  const originalReport = process.report.getReport;
  const originalExclude = process.report.excludeNetwork;
  try {
    process.report.excludeNetwork = false;
    process.report.getReport = () => {
      assert.equal(process.report.excludeNetwork, true);
      throw new Error("fixture report failure");
    };
    delete require.cache[ffiPath];
    assert.throws(() => require(ffiPath), /fixture report failure/);
    assert.equal(process.report.excludeNetwork, false);
  } finally {
    process.report.getReport = originalReport;
    process.report.excludeNetwork = originalExclude;
    delete require.cache[ffiPath];
  }
});

test("the native FFF SDK still scans and searches files", async () => {
  const root = await mkdtemp(join(tmpdir(), "fff-native-startup-"));
  let finder;
  try {
    await writeFile(join(root, "startup-fixture.txt"), "native startup regression\n");
    const { FileFinder } = await import(pathToFileURL(
      join(packageDir, "node_modules/@ff-labs/fff-node/dist/index.js"),
    ).href);
    const created = FileFinder.create({
      basePath: root,
      aiMode: true,
      disableWatch: true,
      disableMmapCache: true,
    });
    assert.equal(created.ok, true, created.error);
    finder = created.value;
    const scan = await finder.waitForScan(5_000);
    assert.equal(scan.ok && scan.value, true);
    const result = finder.fileSearch("startup-fixture", { pageSize: 10 });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.value.items.some(item => item.relativePath === "startup-fixture.txt"));
  } finally {
    finder?.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
