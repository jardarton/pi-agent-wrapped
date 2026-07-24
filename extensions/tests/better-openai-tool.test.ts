import test from "node:test";
import assert from "node:assert/strict";
import betterOpenAI from "../better-openai.ts";

function mockPi() {
 const tools: any[] = [];
 const pi: any = {
  registerTool: (tool: any) => tools.push(tool),
  registerFlag() {}, registerCommand() {}, registerEntryRenderer() {}, on() {},
 };
 return { pi, tools };
}

test("openai_image is not registered by default", () => {
 const old = process.env.PI_BETTER_OPENAI_IMAGE_TOOL;
 delete process.env.PI_BETTER_OPENAI_IMAGE_TOOL;
 try { const { pi, tools } = mockPi(); betterOpenAI(pi); assert.equal(tools.length, 0); }
 finally { if (old === undefined) delete process.env.PI_BETTER_OPENAI_IMAGE_TOOL; else process.env.PI_BETTER_OPENAI_IMAGE_TOOL = old; }
});

test("openai_image is separately enabled and accepts reference paths", () => {
 const old = process.env.PI_BETTER_OPENAI_IMAGE_TOOL;
 process.env.PI_BETTER_OPENAI_IMAGE_TOOL = "1";
 try {
  const { pi, tools } = mockPi(); betterOpenAI(pi);
  assert.equal(tools.length, 1); assert.equal(tools[0].name, "openai_image");
  const schema = tools[0].parameters;
  assert.equal(schema.properties.images.maxItems, 5);
  assert.deepEqual(schema.properties.action.enum, ["auto", "generate", "edit"]);
 } finally { if (old === undefined) delete process.env.PI_BETTER_OPENAI_IMAGE_TOOL; else process.env.PI_BETTER_OPENAI_IMAGE_TOOL = old; }
});
