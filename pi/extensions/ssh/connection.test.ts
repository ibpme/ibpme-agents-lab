import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { connectSsh } from "./connection.ts";
import { SshConnection } from "./transport.ts";

// Exercise the process seam without requiring a server, credentials, or network access.
test("owned SSH connections", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ssh-test-"));
  const log = join(directory, "calls");
  const originalPath = process.env.PATH;
  const originalLog = process.env.SSH_TEST_LOG;
  process.env.PATH = `${directory}:${originalPath}`;
  process.env.SSH_TEST_LOG = log;
  writeFileSync(join(directory, "ssh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$SSH_TEST_LOG"
case "$*" in
  *BatchMode=yes*ControlMaster=yes*password-host*) exit 255 ;;
  *'-O exit'*) exit 0 ;;
  *'missing-directory'*) exit 1 ;;
  *'pwd'*) printf '/resolved/project\\n' ;;
esac
`, { mode: 0o700 });
  const calls = () => readFileSync(log, "utf8").trim().split("\n");
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.SSH_TEST_LOG;
    else process.env.SSH_TEST_LOG = originalLog;
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("explicit paths authenticate, resolve the directory, and use a private socket", async () => {
    const first = await connectSsh("key-host:/project");
    const second = await connectSsh("key-host:/project");
    try {
      assert.equal(first.remoteCwd, "/resolved/project");
      const masters = calls().filter((call) => call.includes("ControlMaster=yes"));
      const paths = masters.map((call) => call.match(/-S (\S+)/)![1]);
      assert.notEqual(paths[0], paths[1]);
      assert.ok(calls().some((call) => call.includes("cd -- '/project' && pwd")));
      const tools = calls().filter((call) => call.includes("ProxyCommand=false"));
      assert.ok(tools.length >= 4);
      assert.ok(tools.every((call) => call.includes("BatchMode=yes") && call.includes("ControlMaster=no")));
      await first.close();
      assert.equal(existsSync(dirname(paths[0])), false);
      assert.equal(existsSync(dirname(paths[1])), true);
      const before = calls().length;
      await first.close();
      assert.equal(calls().length, before);
      await assert.rejects(() => first.exec("true"), /closed/);
    } finally {
      await first.close();
      await second.close();
    }
  });

  await t.test("password authentication delegates only the bootstrap to the user", async () => {
    let prompts = 0;
    const connection = await connectSsh("password-host", async (args) => {
      prompts++;
      assert.ok(args.includes("BatchMode=no"));
      assert.ok(args.includes("StrictHostKeyChecking=ask"));
      assert.ok(args.includes("-f") && args.includes("-N"));
    });
    try {
      assert.equal(prompts, 1);
      assert.equal(connection.remoteCwd, "/resolved/project");
      await connection.exec("true");
      assert.equal(prompts, 1);
    } finally {
      await connection.close();
    }
  });

  await t.test("headless authentication failure and cancellation clean up their sockets", async () => {
    await assert.rejects(() => connectSsh("password-host:/project"), /interactive Pi terminal/);
    await assert.rejects(() => connectSsh("password-host:/project", async () => {
      throw new Error("cancelled");
    }), /cancelled/);
    const masters = calls().filter((call) => call.includes("ControlMaster=yes"));
    for (const master of masters) {
      assert.equal(existsSync(dirname(master.match(/-S (\S+)/)![1])), false);
    }
  });

  await t.test("directory verification failure closes the authenticated master", async () => {
    await assert.rejects(() => connectSsh("key-host:/missing-directory"), /Remote command failed/);
    assert.match(calls().at(-1)!, /-O exit/);
  });

  await t.test("unopened connections cannot launch tool processes", async () => {
    const before = calls().length;
    const connection = new SshConnection("key-host", "/project");
    await assert.rejects(() => connection.exec("true"), /not connected/);
    await connection.close();
    assert.equal(calls().length, before);
  });
});
