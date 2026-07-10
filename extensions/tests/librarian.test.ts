import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRepo, safeCheckoutPath } from "../librarian.ts";

test("librarian parses supported repository shorthands", () => {
  assert.deepEqual(parseRepo("owner/repo"), {
    host: "github.com",
    org: "owner",
    repo: "repo",
    originUrl: "https://github.com/owner/repo.git",
  });
  assert.deepEqual(parseRepo("gitlab.example/group/subgroup/repo.git"), {
    host: "gitlab.example",
    org: "group/subgroup",
    repo: "repo",
    originUrl: "https://gitlab.example/group/subgroup/repo.git",
  });
  assert.deepEqual(parseRepo("https://git.example.com:8443/group/repo"), {
    host: "git.example.com:8443",
    org: "group",
    repo: "repo",
    originUrl: "https://git.example.com:8443/group/repo.git",
  });
  assert.deepEqual(parseRepo("ssh://git@git.example.com:2222/group/repo"), {
    host: "git.example.com:2222",
    org: "group",
    repo: "repo",
    originUrl: "ssh://git@git.example.com:2222/group/repo.git",
  });
});

test("librarian rejects symlinks inside the cache path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "librarian-test-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "librarian-outside-"));
  try {
    await fs.symlink(outside, path.join(root, "github.com"));
    await assert.rejects(
      safeCheckoutPath(root, parseRepo("owner/repo")),
      /symlink is not allowed/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("librarian rejects cache path traversal", () => {
  assert.throws(() => parseRepo("owner/../../../../tmp/repo"), /unsafe repository path component/);
  assert.throws(() => parseRepo("../owner/repo"), /unsafe host component/);
});
