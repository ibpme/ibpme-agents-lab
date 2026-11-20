import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import toolControl from "../extensions/tool-control/index.ts";
import ssh from "../extensions/ssh/index.ts";
import { shq } from "../extensions/ssh/transport.ts";

test("SSH routes tools through their selected destination and keeps user shell commands local", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-v2-ssh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const local = join(root, "local");
  const remote = join(root, "remote ' dollar $");
  const bin = join(root, "bin");
  await Promise.all([local, remote, bin].map((path) => mkdir(path)));
  const originalPath = process.env.PATH;
  t.after(() => { process.env.PATH = originalPath; });
  process.env.PATH = bin + ":" + originalPath;
  const log = join(root, "ssh.log");
  await writeFile(join(bin, "ssh"), [
    "#!/bin/sh",
    "printf '%s\\n' \"$*\" >> " + shq(log),
    "case \"$*\" in",
    '  *unreachable*) exit 255;;',
    '  *ControlMaster=yes*) exit 0;;',
    '  *"-O exit"*) exit 0;;',
    'esac',
    'while [ "$1" != "--" ]; do shift; done',
    'shift 2',
    'if [ "$1" = "true" ]; then exit 0; fi',
    'if [ -e ' + shq(join(root, "dropped")) + ' ]; then echo "Control socket missing" >&2; exit 255; fi',
    "exec sh -c \"$1\"",
  ].join("\n"), { mode: 0o700 });
  await writeFile(join(bin, "rg"), [
    "#!/bin/sh",
    "test \"$PWD\" = " + shq(remote) + " || exit 2",
    'printf "%s\\n" ' + shq(JSON.stringify({ type: "match", data: {
      path: { text: "./only-remote.txt" }, line_number: 1, lines: { text: "remote match\n" },
    } })),
  ].join("\n"), { mode: 0o700 });
  await writeFile(join(bin, "fd"), [
    "#!/bin/sh",
    "test \"$PWD\" = " + shq(remote) + " || exit 2",
    'printf "%s\\0" "only-remote.txt"',
  ].join("\n"), { mode: 0o700 });

  const filename = "a ' $HOME `literal`.txt";
  await writeFile(join(local, filename), "local contents");
  await writeFile(join(remote, filename), "remote contents");
  await writeFile(join(remote, "only-remote.txt"), "remote match");
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  async function start(extensionFactories, target) {
    const settingsManager = SettingsManager.inMemory();
    const agentDir = join(root, "agent");
    const resourceLoader = new DefaultResourceLoader({
      cwd: local, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true, extensionFactories,
    });
    await resourceLoader.reload();
    if (target !== undefined) resourceLoader.getExtensions().runtime.flagValues.set("ssh", target);
    const { session } = await createAgentSession({
      cwd: local, agentDir, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(local),
      modelRuntime: runtime,
    });
    await session.bindExtensions({ mode: "rpc" });
    return session;
  }
  function call(session, name, input) {
    const definition = session.getToolDefinition(name);
    assert.ok(definition, name);
    return definition.execute("fixture", input, undefined, undefined, { cwd: local, mode: "rpc", ui: {} });
  }

  const target = "fixture:" + remote;
  const interactive = await start([toolControl, ssh]);
  try {
    assert.deepEqual(interactive.getActiveToolNames().filter((name) => name.endsWith("_remote")), []);
    assert.equal(interactive.getToolDefinition("read_remote").exposure, "deferred");
    assert.equal(interactive.getToolDefinition("write_remote").annotations.readOnlyHint, false);
    await assert.rejects(call(interactive, "read_remote", { path: filename }), /disconnected/);
    await interactive.prompt("/ssh " + target);
    const first = await call(interactive, "read_remote", { path: filename });
    assert.match(first.content[0].text, /remote contents/);
    assert.equal(first.details.sshDestination, target);
    assert.match((await call(interactive, "read", { path: filename })).content[0].text, /local contents/);
    assert.match((await call(interactive, "grep_remote", { pattern: "remote match" })).content[0].text, /only-remote.txt:1:remote match/);
    assert.match((await call(interactive, "find_remote", { pattern: "*.txt" })).content[0].text, /only-remote.txt/);
    assert.match((await call(interactive, "ls_remote", {})).content[0].text, /only-remote.txt/);
    assert.match((await call(interactive, "bash_remote", { command: "pwd" })).content[0].text, /remote ' dollar/);
    await call(interactive, "write_remote", { path: filename, content: "first\nsecond\n" });
    await call(interactive, "edit_remote", { path: filename, edits: [{ oldText: "second", newText: "edited" }] });
    assert.equal(await readFile(join(remote, filename), "utf8"), "first\nedited\n");
    assert.equal(await readFile(join(local, filename), "utf8"), "local contents");
    await interactive.prompt("/ssh unreachable");
    assert.equal((await call(interactive, "ls_remote", {})).details.sshDestination, target);
    await interactive.prompt("/ssh off");
    assert.equal(first.details.sshDestination, target);
    await assert.rejects(call(interactive, "read_remote", { path: filename }), /disconnected/);
  } finally {
    await interactive.dispose();
  }

  for (const order of [[ssh, toolControl], [toolControl, ssh]]) {
    const cli = await start(order, target);
    try {
      assert.equal(cli.getToolDefinition("grep").exposure, "deferred");
      assert.match((await call(cli, "grep", { pattern: "remote match" })).content[0].text, /only-remote.txt/);
      assert.equal((await call(cli, "read", { path: filename })).details.sshDestination, target);
      for (const excludeFromContext of [true, false]) {
        assert.equal((await cli.executeBash("pwd", undefined, { excludeFromContext })).output.trim(), local);
      }
    } finally {
      await cli.dispose();
    }
  }

  const offline = await start([toolControl, ssh], "unreachable");
  try {
    await assert.rejects(call(offline, "read", { path: filename }), /SSH connection failed/);
    assert.equal((await offline.executeBash("pwd")).output.trim(), local);
  } finally {
    await offline.dispose();
  }

  const dropped = await start([ssh], target);
  try {
    await writeFile(join(root, "dropped"), "");
    assert.equal((await call(dropped, "grep", { pattern: "remote match" })).isError, true);
    await assert.rejects(call(dropped, "read", { path: filename }), /SSH connection lost/);
  } finally {
    await dropped.dispose();
  }
  assert.match(await readFile(log, "utf8"), /-O exit/);
});
