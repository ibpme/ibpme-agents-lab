import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import toolSetExtension from "../tool-set/index.ts";
import { getRequiredToolSet } from "../tool-set/service.ts";
import extension from "./index.ts";

test("SSH tools stay deferred when disconnected and never fall back to local I/O", async (t) => {
  const h = extensionTestHost(["read", "write", "edit", "bash", "change_mode", "codemode", "tool_search"]);
  toolSetExtension(h.pi);
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  assert.equal(h.tools.get("read_remote")!.exposure, "deferred");
  await h.emit("session_start");
  const policy = getRequiredToolSet();
  policy.setMode("safe");
  for (const [name, params, blocked] of [
    ["read_remote", { path: "/tmp/fixture" }, false],
    ["write_remote", { path: "/tmp/fixture", content: "test" }, true],
    ["edit_remote", { path: "/tmp/fixture", oldText: "a", newText: "b" }, true],
    ["bash_remote", { command: "true" }, true],
    ["grep_remote", { pattern: "test" }, false],
    ["ls_remote", {}, false],
    ["find_remote", { pattern: "*" }, false],
  ] as const) {
    const tool = h.tools.get(name)!;
    assert.equal(tool.exposure, "deferred", name);
    assert.equal(tool.annotations?.readOnlyHint, !blocked, name);
    assert.equal(policy.isBlockedInSafe(name), blocked, name);
    await assert.rejects(() => tool.execute(name, params, undefined, undefined, h.ctx as any), /Not connected/);
  }
  assert.equal(h.loadoutWrites(), 0);
});

test("SSH resume and tree navigation report the live disconnected state", async (t) => {
  const h = extensionTestHost(["change_mode", "codemode", "tool_search", "read_remote"]);
  toolSetExtension(h.pi);
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  const notices = () => h.messages.filter((message) => message.customType === "ssh-connection-context");
  assert.match(String(notices().at(-1)?.content), /disconnected/i);
  const before = notices().length;
  await h.emit("session_tree");
  assert.equal(notices().length, before + 1);
  assert.match(String(notices().at(-1)?.content), /disconnected/i);
  assert.ok(h.pi.getActiveTools().includes("read_remote"));
  assert.equal(h.loadoutWrites(), 0);
});

test("connecting, switching hosts, and disconnecting append targets without changing tools", async (t) => {
  const { SshConnection } = await import("./transport.ts");
  // Explicit paths avoid remote cwd discovery; only closing would launch ssh.
  t.mock.method(SshConnection.prototype, "close", async () => {});
  const h = extensionTestHost(["read", "write", "read_remote", "change_mode", "codemode", "tool_search"]);
  toolSetExtension(h.pi);
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  await h.emit("session_start");
  const original = h.pi.getActiveTools();
  const ssh = h.commands.get("ssh")!;
  await ssh.handler("alice@first:/work", h.ctx);
  assert.match(String(h.messages.at(-1)?.content), /alice@first:\/work/);
  assert.match(String(h.messages.at(-1)?.content), /Unqualified tools still operate locally/);
  getRequiredToolSet().setMode("safe");
  await ssh.handler("bob@second:/project", h.ctx);
  assert.match(String(h.messages.at(-1)?.content), /bob@second:\/project/);
  assert.equal(getRequiredToolSet().getMode(), "safe");
  await ssh.handler("off", h.ctx);
  assert.match(String(h.messages.at(-1)?.content), /disconnected/i);
  const tool = h.tools.get("read_remote")!;
  await assert.rejects(() => tool.execute("read", { path: "/fixture" }, undefined, undefined, h.ctx as any), /Not connected/);
  assert.deepEqual(h.pi.getActiveTools(), original);
  assert.equal(h.loadoutWrites(), 0);
});
