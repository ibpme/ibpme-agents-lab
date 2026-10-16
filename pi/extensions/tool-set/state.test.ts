import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { createToolSet } from "./state.ts";

function host() {
  const active = ["read", "write", "edit", "bash", "mcp__server__update"];
  const tools = [{ name: "mcp__server__update" }, { name: "mcp__server__read", annotations: { readOnlyHint: true } }] as ToolInfo[];
  let writes = 0;
  const pi = {
    getActiveTools: () => [...active], getAllTools: () => tools,
    setActiveTools: () => { writes++; },
  } as unknown as ExtensionAPI;
  return { pi, active, writes: () => writes };
}

test("permission toggles never rewrite the host loadout", () => {
  const h = host();
  const tools = createToolSet(h.pi);
  tools.setMode("safe");
  tools.setMode("yolo");
  tools.toggleMode();
  assert.equal(h.writes(), 0);
  assert.deepEqual(h.pi.getActiveTools(), ["read", "write", "edit", "bash", "mcp__server__update"]);
});

for (const [name, blocked] of [
  ["read", false], ["grep", false], ["ls", false], ["find", false],
  ["write", true], ["edit", true], ["bash", true], ["powershell", true],
  ["mcp__server__update", true], ["mcp__server__read", false], ["mcp__missing__tool", true],
] as const) {
  test(`SAFE ${blocked ? "blocks" : "allows"} ${name}`, () => {
    assert.equal(createToolSet(host().pi).isBlockedInSafe(name), blocked);
  });
}

test("permission listeners fire once per transition and can unsubscribe", () => {
  const tools = createToolSet(host().pi);
  const modes: string[] = [];
  const unsubscribe = tools.onChange(() => modes.push(tools.getMode()));
  tools.setMode("safe");
  tools.setMode("safe");
  tools.toggleMode();
  unsubscribe();
  tools.setMode("safe");
  assert.deepEqual(modes, ["safe", "yolo"]);
});

test("extra blocked tools belong to one permission instance", () => {
  const first = createToolSet(host().pi);
  const second = createToolSet(host().pi);
  first.addBlockedTools(["bash_remote"]);
  assert.equal(first.isBlockedInSafe("bash_remote"), true);
  assert.equal(second.isBlockedInSafe("bash_remote"), false);
});
