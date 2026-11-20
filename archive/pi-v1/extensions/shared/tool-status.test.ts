import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, Theme, ToolInfo } from "@earendil-works/pi-coding-agent";
import { toolStatuses } from "./tool-status.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string, style: unknown) => `[${JSON.stringify(style)}]${text}[/]`,
} as unknown as Theme;

function tool(name: string, exposure = "direct", source = "local"): ToolInfo {
  return { name, exposure, sourceInfo: { source } } as ToolInfo;
}
function status(tools: ToolInfo[], active: string[]) {
  return toolStatuses({ getAllTools: () => tools, getActiveTools: () => active, getCommands: () => [] } as unknown as ExtensionAPI, theme);
}

test("only lists non-builtin reachable tools, including deferred and codemode", () => {
  const result = status([
    tool("read", "direct", "builtin"), tool("custom"), tool("lazy", "deferred"),
    tool("scripted", "codemode"), tool("hidden", "hidden"), tool("inactive"),
  ], ["read", "custom", "hidden"]);
  assert.doesNotMatch(result.tools, /read|hidden|inactive/);
  for (const name of ["custom", "lazy", "scripted"]) assert.ok(result.tools.includes(name));
  const colors = [...result.tools.matchAll(/\[({.*?})\]/g)].map((match) => match[1]);
  assert.equal(new Set(colors).size, 2);
  assert.notEqual(colors[0], colors[1]);
  assert.equal(colors[1], colors[2]);
  assert.equal(colors[1], JSON.stringify({ fg: "muted" }));
});

test("MCP exposure groups share local tool colors and exclude hidden tools", () => {
  const result = status([
    tool("custom"), tool("lazy", "deferred"), tool("scripted", "codemode"),
    tool("mcp__mixed__direct"), tool("mcp__mixed__lazy", "deferred"),
    tool("mcp__scripts__run", "codemode"), tool("mcp__hidden__run", "hidden"),
  ], ["custom", "mcp__mixed__direct"]);
  assert.doesNotMatch(result.mcp, /hidden/);
  const colors = [...result.tools.matchAll(/\[({.*?})\]/g)].map((match) => match[1]);
  for (const color of colors) assert.ok(result.mcp.includes(color));
  assert.equal(result.mcp.match(/mixed \(1\)/g)?.length, 2);
  assert.match(result.mcp, /scripts \(1\)/);
});

test("builtin replacements from stylish-tools stay excluded regardless of exposure", () => {
  const names = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const replacements = names.map((name, index) => tool(name, ["direct", "deferred", "codemode"][index % 3], "local"));
  const result = status([...replacements, tool("read_remote", "deferred"), tool("question")], [...names, "question"]);
  for (const name of names) assert.doesNotMatch(result.tools, new RegExp(`\\]${name}\\[/\\]`));
  assert.doesNotMatch(result.tools, /read_remote/);
  assert.match(result.tools, /question/);
  assert.doesNotMatch(result.tools, /\+\d+/);
});

test("excludes all standard remote tools without excluding other custom tools", () => {
  const remote = ["read", "bash", "edit", "write", "grep", "find", "ls"].map((name) => `${name}_remote`);
  const result = status([
    ...remote.map((name, index) => tool(name, ["direct", "deferred", "codemode"][index % 3])),
    tool("custom_remote", "codemode"),
  ], remote);
  for (const name of remote) assert.ok(!result.tools.includes(name));
  assert.match(result.tools, /custom_remote/);
  assert.doesNotMatch(result.tools, /\+\d+/);
});
