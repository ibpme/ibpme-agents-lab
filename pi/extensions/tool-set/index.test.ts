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

test("fresh sessions omit default notices even after unannounced idle round trips", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.emit("before_agent_start");
  await h.emit("turn_end");
  assert.equal(h.messages.length, 0);
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.commands.get("yolo")!.handler("", h.ctx);
  await h.emit("before_agent_start");
  assert.equal(h.messages.length, 0);
});

test("YOLO is still announced after a previously announced SAFE state leaves projected context", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.emit("before_agent_start");
  await h.commands.get("yolo")!.handler("", h.ctx);
  h.messages.length = 0;
  await h.emit("before_agent_start");
  assert.equal(h.messages.length, 1);
  assert.match(String(h.messages[0].content), /Execution policy: YOLO/);
});

test("idle permission changes persist immediately but announce only the final state at run start", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  assert.equal(h.messages.length, 0);
  const original = h.pi.getActiveTools();
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.commands.get("yolo")!.handler("", h.ctx);
  await h.commands.get("safe")!.handler("", h.ctx);
  assert.equal(getRequiredToolSet().getMode(), "safe");
  assert.equal(h.entries.length, 3);
  assert.equal(h.messages.length, 0);
  await h.emit("before_agent_start");
  assert.equal(h.messages.length, 1);
  assert.match(String(h.messages[0].content), /SAFE/);
  assert.match(String(h.messages[0].content), /change_mode/);
  assert.equal(h.messages[0].display, true);
  assert.equal(h.handlers.has("context"), false);
  assert.deepEqual(h.pi.getActiveTools(), original);
  assert.equal(h.loadoutWrites(), 0);
});

test("returning to the already announced mode does not add a notice", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.emit("before_agent_start");
  assert.equal(h.messages.length, 1);
  await h.commands.get("yolo")!.handler("", h.ctx);
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.emit("before_agent_start", { messageType: "custom" });
  assert.equal(h.messages.length, 1);
});

test("mid-run changes announce at the turn boundary without requesting continuation", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.emit("before_agent_start");
  await h.commands.get("safe")!.handler("", h.ctx);
  assert.equal(h.messages.length, 0);
  const results = await h.emit("turn_end");
  assert.equal(h.messages.length, 1);
  assert.match(String(h.messages.at(-1)?.content), /SAFE/);
  assert.ok(results.every((result) => !result?.continue));
  await h.emit("turn_end");
  assert.equal(h.messages.length, 1);
  await h.commands.get("yolo")!.handler("", h.ctx);
  await h.emit("turn_end");
  assert.equal(h.messages.length, 2);
  assert.match(String(h.messages.at(-1)?.content), /Execution policy: YOLO/);
});

test("tree navigation and compacted-away notices are refreshed only at the next run", async (t) => {
  const h = setup();
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  await h.commands.get("safe")!.handler("", h.ctx);
  await h.emit("before_agent_start");
  h.messages.length = 0;
  await h.emit("session_tree");
  await h.emit("session_compact");
  assert.equal(getRequiredToolSet().getMode(), "safe");
  assert.equal(h.messages.length, 0);
  await h.emit("before_agent_start");
  assert.equal(h.messages.length, 1);
  assert.match(String(h.messages[0].content), /SAFE/);
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
