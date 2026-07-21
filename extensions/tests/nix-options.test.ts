import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nixOptions, {
  findFlakeDirectory,
  resolveFlakeReference,
} from "../nix-options.ts";

test("Nix option lookup finds the nearest parent flake", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-nix-options-"));
  const nested = path.join(root, "a", "b");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }");

  assert.equal(await findFlakeDirectory(nested), root);
  assert.equal(await resolveFlakeReference(undefined, nested), `path:${root}`);
  assert.equal(
    await resolveFlakeReference("github:NixOS/nixpkgs", nested),
    "github:NixOS/nixpkgs",
  );
});

test("Nix option tool invokes the packaged query with structured arguments", async () => {
  let tool: any;
  let invocation: { command: string; args: string[] } | undefined;
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    async exec(command: string, args: string[]) {
      invocation = { command, args };
      return {
        code: 0,
        stdout: JSON.stringify({ configuration: "nixosConfigurations.test", results: [] }),
        stderr: "",
      };
    },
  };

  nixOptions(pi as any);
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-nix-options-tool-"));
  await writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }");
  const result = await tool.execute(
    "call-1",
    {
      action: "search",
      configuration: "test",
      query: "services ssh",
      limit: 5,
    },
    undefined,
    undefined,
    { cwd: root },
  );

  assert.equal(invocation?.command, "nix-instantiate");
  assert.ok(invocation?.args.includes(`path:${root}`));
  assert.ok(invocation?.args.includes("services ssh"));
  assert.equal(result.details.configuration, "nixosConfigurations.test");
});

test("Nix option tool rejects incomplete actions before evaluation", async () => {
  let tool: any;
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    async exec() {
      assert.fail("nix-instantiate should not run");
    },
  };

  nixOptions(pi as any);
  await assert.rejects(
    tool.execute("call-1", { action: "inspect" }, undefined, undefined, {
      cwd: process.cwd(),
    }),
    /requires option/,
  );
});
