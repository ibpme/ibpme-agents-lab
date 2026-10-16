import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import extension from "./index.ts";
import { getRequiredToolSet } from "./service.ts";

function setup() {
  const h = extensionTestHost(["read", "write", "edit", "bash", "grep", "mcp__server__loaded", "change_mode", "codemode", "tool_search"]);
  extension(h.pi);
  return h;
}

test("startup and permission switches preserve restored tools and append mode notices", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  const original = h.pi.getActiveTools();
  const before = [...h.messages];
  await h.commands.get("safe")!.handler("", h.ctx);
  assert.equal(getRequiredToolSet().getMode(), "safe");
  assert.deepEqual(h.pi.getActiveTools(), original);
  assert.equal(h.loadoutWrites(), 0);
  assert.deepEqual(h.messages.slice(0, before.length), before);
  assert.match(String(h.messages.at(-1)?.content), /SAFE/);
  assert.match(String(h.messages.at(-1)?.content), /change_mode/);
  assert.equal(h.handlers.has("context"), false);
  await h.commands.get("yolo")!.handler("", h.ctx);
  assert.match(String(h.messages.at(-1)?.content), /YOLO/);
  assert.equal(h.loadoutWrites(), 0);
});

test("resume restores permission state and tree navigation does not escalate", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.commands.get("safe")!.handler("", h.ctx);
  assert.ok(h.entries.some((entry) => (entry.data as { mode?: string })?.mode === "safe"));
  await h.emit("session_tree");
  assert.equal(getRequiredToolSet().getMode(), "safe");
  await h.emit("session_shutdown");
  h.handlers.clear();
  extension(h.pi);
  await h.emit("session_start");
  assert.equal(getRequiredToolSet().getMode(), "safe");
  h.entries.length = 0;
  await h.emit("session_start");
  assert.equal(getRequiredToolSet().getMode(), "yolo");
});

for (const parentToolCallId of [undefined, "codemode-1"]) {
  test(`SAFE guards ${parentToolCallId ? "nested" : "direct"} calls without blocking discovery`, async (t) => {
    const h = setup();
    t.after(() => h.emit("session_shutdown"));
    await h.emit("session_start");
    await h.commands.get("safe")!.handler("", h.ctx);
    for (const toolName of ["write", "edit", "bash", "powershell", "mcp__unknown__update"]) {
      const results = await h.emit("tool_call", { toolName, input: {}, parentToolCallId });
      assert.ok(results.some((result) => result?.block === true), toolName);
    }
    for (const toolName of ["read", "grep", "find", "ls", "codemode", "tool_search"]) {
      const results = await h.emit("tool_call", { toolName, input: {}, parentToolCallId });
      assert.ok(results.every((result) => !result?.block), toolName);
    }
    await h.commands.get("yolo")!.handler("", h.ctx);
    assert.ok((await h.emit("tool_call", { toolName: "write", input: {}, parentToolCallId })).every((r) => !r?.block));
  });
}

test("change_mode is always declared, requires approval, and never changes the loadout", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  const tool = h.tools.get("change_mode")!;
  assert.equal(tool.exposure, "model-only");
  await h.commands.get("safe")!.handler("", h.ctx);
  const run = () => tool.execute("request", { mode: "yolo" }, undefined, undefined, h.ctx as any);
  await run();
  assert.equal(getRequiredToolSet().getMode(), "safe");
  h.ctx.ui.confirm = async () => true;
  await run();
  assert.equal(getRequiredToolSet().getMode(), "yolo");
  assert.equal(h.loadoutWrites(), 0);
});

test("startup adds discovery entry points without replacing restored declarations", async (t) => {
  const h = extensionTestHost(["read", "mcp__server__loaded", "change_mode"]);
  for (const name of ["codemode", "tool_search"]) {
    h.tools.set(name, { name, label: name, description: "Discovery", exposure: "model-only", parameters: {}, execute: async () => ({ content: [], details: undefined }) });
  }
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  assert.deepEqual(h.pi.getActiveTools(), ["read", "mcp__server__loaded", "change_mode", "codemode", "tool_search"]);
  assert.equal(h.loadoutWrites(), 1);
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.emit("session_tree");
  assert.equal(h.loadoutWrites(), 1);
});

test("resuming an older loadout makes approval reachable without restoring mutations", async (t) => {
  const h = extensionTestHost(["read", "codemode", "tool_search"]);
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  assert.deepEqual(h.pi.getActiveTools(), ["read", "codemode", "tool_search", "change_mode"]);
  await h.commands.get("safe")!.handler("", h.ctx);
  assert.equal(h.loadoutWrites(), 1);
});
