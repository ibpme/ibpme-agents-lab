import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { toolStatus } from "./viewer-model.ts";

for (const [exposure, declared, expected] of [
  ["direct", true, /active.*blocked.*SAFE/i],
  ["deferred", true, /loaded.*deferred.*blocked.*SAFE/i],
  ["deferred", false, /deferred.*blocked.*SAFE/i],
  ["codemode", false, /codemode.*blocked.*SAFE/i],
] as const) {
  test(`viewer preserves ${exposure} reachability while showing SAFE denial (declared=${declared})`, () => {
    const status = toolStatus({ name: "write_remote", exposure } as ToolInfo,
      new Set(declared ? ["write_remote"] : []), { getMode: () => "safe", isBlockedInSafe: () => true });
    assert.match(status.label, expected);
    assert.equal(status.color, "warning");
  });
}

test("compact summaries use readable argument names, types and optional markers", async () => {
  const { argumentSummary, shortDescription, toolDetails } = await import("./viewer-model.ts");
  const tool = {
    name: "example", description: "Run an example. Longer instructions stay in details.", exposure: "deferred",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input text" },
        limit: { type: "integer", description: "Maximum results" },
      }, required: ["input"],
    },
    promptGuidelines: ["Use sparingly", "Keep inputs short"],
  } as unknown as ToolInfo;
  assert.equal(argumentSummary(tool), "input: string · limit?: integer");
  assert.equal(shortDescription(tool.description), "Run an example.");
  const details = toolDetails(tool, "Example snippet").join("\n");
  assert.match(details, /Longer instructions stay in details/);
  assert.match(details, /input: string \(required\) — Input text/);
  assert.match(details, /limit: integer \(optional\) — Maximum results/);
  assert.match(details, /Prompt snippet\nExample snippet/);
  assert.match(details, /Prompt guidelines\n• Use sparingly\n• Keep inputs short/);
  assert.match(details, /Exposure: deferred/);
  assert.doesNotMatch(details, /"properties"|"type"|[{}]/);
  assert.match(toolDetails(tool, undefined, []).join("\n"), /Prompt snippet\nNot provided.\nPrompt guidelines\nNone./);
});

test("argument types support enums, unions, arrays, references and empty schemas", async () => {
  const { argumentType, argumentSummary } = await import("./viewer-model.ts");
  assert.equal(argumentType({ enum: ["safe", "yolo"] }), '\"safe\" | \"yolo\"');
  assert.equal(argumentType({ type: "array", items: { type: "string" } }), "Array<string>");
  assert.equal(argumentType({ anyOf: [{ type: "string" }, { type: "null" }] }), "string | null");
  assert.equal(argumentType({ $ref: "#/$defs/Config" }), "Config");
  assert.equal(argumentType({}), "any");
  assert.equal(argumentSummary({ parameters: {} } as ToolInfo), "No arguments");
});
