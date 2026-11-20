import assert from "node:assert/strict";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import toolControl from "../extensions/tool-control/index.ts";
import ssh from "../extensions/ssh/index.ts";
import { shq, SshConnection } from "../extensions/ssh/transport.ts";

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
  const refuseExit = join(root, "refuse-exit");
  const shortWrite = join(root, "short-write");
  await writeFile(join(bin, "ssh"), [
    "#!/bin/sh",
    "printf '%s\\n' \"$*\" >> " + shq(log),
    "case \"$*\" in",
    '  *unreachable*) exit 255;;',
    '  *ControlMaster=yes*) exit 0;;',
    '  *"-O exit"*) test ! -e ' + shq(refuseExit) + ' && exit 0; exit 255;;',
    '  *"-O check"*) test -e ' + shq(refuseExit) + ' && exit 0; exit 255;;',
    'esac',
    'while [ "$1" != "--" ]; do shift; done',
    'shift 2',
    'if [ "$1" = "true" ]; then exit 0; fi',
    'if [ -e ' + shq(join(root, "dropped")) + ' ]; then echo "Control socket missing" >&2; exit 255; fi',
    'if [ -e ' + shq(shortWrite) + ' ]; then',
    '  case "$1" in *"mktemp"*) head -c 2 | sh -c "$1"; exit $?;; esac',
    'fi',
    "exec sh -c \"$1\"",
  ].join("\n"), { mode: 0o700 });
  const rgRow = (type, line_number, value) => JSON.stringify({
    type, data: { path: { text: "./only-remote.txt" }, line_number, lines: { text: value + "\n" } },
  });
  const splitRow = rgRow("match", 2, "pâté");
  await writeFile(join(bin, "rg"), [
    "#!/bin/sh",
    "test \"$PWD\" = " + shq(remote) + " || exit 2",
    'case "$*" in *stop-early*)',
    '  printf "%s" ' + shq(splitRow.slice(0, 20)),
    '  sleep 0.05',
    '  printf "stderr is not JSON\\n" >&2',
    '  printf "%s\\n" ' + [splitRow.slice(20), rgRow("match", 3, "another match"), rgRow("context", 4, "last context")].map(shq).join(" "),
    '  exec sleep 10;;',
    'esac',
    'printf "%s\\n" ' + shq(rgRow("match", 1, "remote match")),
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
  async function start(extensionFactories, target, additionalExtensionPaths) {
    const settingsManager = SettingsManager.inMemory();
    const agentDir = join(root, "agent");
    const resourceLoader = new DefaultResourceLoader({
      cwd: local, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true,
      extensionFactories, additionalExtensionPaths,
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
    return definition.execute("fixture", input, undefined, undefined, {
      cwd: local, mode: "rpc", ui: {}, sessionManager: session.sessionManager,
    });
  }

  const target = "fixture:" + remote;
  const interactive = await start([toolControl], undefined, [fileURLToPath(new URL("../extensions/ssh/index.ts", import.meta.url))]);
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
    await t.test("grep stops after the global limit and trailing context", { timeout: 3000 }, async () => {
      const result = await call(interactive, "grep_remote", { pattern: "stop-early", limit: 1, context: 2 });
      assert.equal(result.details.matchLimitReached, 1);
      assert.match(result.content[0].text, /only-remote.txt:2:pâté\nonly-remote.txt-3-another match\nonly-remote.txt-4-last context/);
    });
    assert.match((await call(interactive, "find_remote", { pattern: "*.txt" })).content[0].text, /only-remote.txt/);
    assert.match((await call(interactive, "ls_remote", {})).content[0].text, /only-remote.txt/);
    assert.match((await call(interactive, "bash_remote", { command: "pwd" })).content[0].text, /remote ' dollar/);
    await call(interactive, "write_remote", { path: filename, content: "first\nsecond\n" });
    await call(interactive, "edit_remote", { path: filename, edits: [{ oldText: "second", newText: "edited" }] });
    assert.equal(await readFile(join(remote, filename), "utf8"), "first\nedited\n");
    assert.equal(await readFile(join(local, filename), "utf8"), "local contents");
    await t.test("short writes leave the original intact and successful writes preserve mode and symlinks", async () => {
      const targetFile = join(remote, filename);
      await chmod(targetFile, 0o751);
      const link = join(remote, "alias");
      await symlink(filename, link);
      await writeFile(shortWrite, "");
      try {
        const failed = await call(interactive, "write_remote", { path: link, content: "réplacement" });
        assert.equal(failed.isError, true);
        assert.match(failed.content[0].text, /Incomplete SSH write: received 2 bytes/);
        assert.equal(await readFile(targetFile, "utf8"), "first\nedited\n");
        assert.ok(!(await readdir(remote)).some((name) => name.startsWith(".pi-ssh.")));
      } finally {
        await rm(shortWrite);
      }
      const result = await call(interactive, "write_remote", { path: link, content: "réplacement" });
      assert.equal(result.isError, undefined);
      assert.ok((await lstat(link)).isSymbolicLink());
      assert.equal(await readFile(targetFile, "utf8"), "réplacement");
      assert.equal((await stat(targetFile)).mode & 0o777, 0o751);
    });
    await t.test("concurrent edits through remote aliases serialize the full mutation", async () => {
      const targetFile = join(remote, filename);
      await writeFile(targetFile, "first\nsecond\n");
      const results = await Promise.all([
        call(interactive, "edit_remote", { path: "./alias", edits: [{ oldText: "first", newText: "one" }] }),
        call(interactive, "edit_remote", { path: targetFile, edits: [{ oldText: "second", newText: "two" }] }),
      ]);
      assert.ok(results.every(({ isError }) => !isError), JSON.stringify(results));
      assert.equal(await readFile(targetFile, "utf8"), "one\ntwo\n");
    });
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
      assert.match((await call(cli, "grep_remote", { pattern: "remote match" })).content[0].text, /only-remote.txt/);
      assert.equal((await call(cli, "read_remote", { path: filename })).details.sshDestination, target);
      assert.equal((await call(cli, "read", { path: filename })).content[0].text, "local contents");
      assert.equal((await call(cli, "bash", { command: "pwd" })).content[0].text.trim(), local);
      assert.equal(cli.getAllTools().find(({ name }) => name === "read").sourceInfo.source, "builtin");
      assert.doesNotMatch((await call(cli, "ls", {})).content[0].text, /only-remote\.txt/);
      for (const excludeFromContext of [true, false]) {
        assert.equal((await cli.executeBash("pwd", undefined, { excludeFromContext })).output.trim(), local);
      }
      await cli.prompt("/ssh off");
      await assert.rejects(call(cli, "read_remote", { path: filename }), /disconnected/);
      await cli.prompt("/ssh " + target);
      assert.equal((await call(cli, "read_remote", { path: filename })).details.sshDestination, target);
      await cli.reload();
      await assert.rejects(call(cli, "read_remote", { path: filename }), /disconnected/);
    } finally {
      await cli.dispose();
    }
  }

  const offline = await start([toolControl, ssh], "unreachable");
  try {
    await assert.rejects(call(offline, "read_remote", { path: filename }), /disconnected/);
    assert.equal((await call(offline, "read", { path: filename })).content[0].text, "local contents");
    assert.equal((await offline.executeBash("pwd")).output.trim(), local);
  } finally {
    await offline.dispose();
  }

  const dropped = await start([ssh], target);
  try {
    await writeFile(join(root, "dropped"), "");
    assert.equal((await call(dropped, "grep_remote", { pattern: "remote match" })).isError, true);
    await assert.rejects(call(dropped, "read_remote", { path: filename }), /disconnected/);
    assert.equal((await call(dropped, "read", { path: filename })).content[0].text, "local contents");
  } finally {
    await dropped.dispose();
  }
  await t.test("failed teardown retains a live control handle for retry", async () => {
    await rm(join(root, "dropped"));
    const connection = new SshConnection("fixture", remote);
    await connection.open();
    const socket = (await readFile(log, "utf8")).match(/-S (\S+\/s)/g).at(-1).slice(3);
    const directory = socket.slice(0, -2);
    try {
      await writeFile(refuseExit, "");
      await assert.rejects(connection.close(), /Could not stop SSH master/);
      await access(directory);
    } finally {
      await rm(refuseExit, { force: true });
      await connection.close();
    }
    await assert.rejects(access(directory), { code: "ENOENT" });
  });
  assert.match(await readFile(log, "utf8"), /-O exit/);
});
