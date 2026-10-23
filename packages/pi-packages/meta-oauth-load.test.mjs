import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("installed Meta OAuth extension loads through Pi and registers its provider", async () => {
  const { loadExtensions } = await import(
    pathToFileURL(join(process.env.PI_PACKAGE_DIR, "dist/core/extensions/loader.js"))
  );
  const extensionPath = join(process.env.META_OAUTH_PACKAGE_DIR, "extensions/meta.ts");
  const result = await loadExtensions([extensionPath], process.cwd());

  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  const registrations = result.runtime.pendingProviderRegistrations;
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "meta");
  assert.equal(typeof registrations[0].config.oauth.login, "function");
  assert.ok(registrations[0].config.models.length > 0);
});
