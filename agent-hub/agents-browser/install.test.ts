import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { installCli } from "./install.ts";

async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "browser cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cli = join(home, "checkout with spaces/agents-browser");
  await mkdir(dirname(cli), { recursive: true });
  await writeFile(cli, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o644 });
  return { home, cli, link: join(home, ".local/bin/agents-browser") };
}

test("installer creates an executable link, forwards arguments, and supports reinstall", async t => {
  const { home, cli, link } = await fixture(t);
  await chmod(cli, 0o644);
  installCli("install", { home, cli });
  assert.ok((await lstat(link)).isSymbolicLink());
  assert.equal(await readlink(link), cli);
  assert.equal((await stat(cli)).mode & 0o111, 0o111);
  assert.equal(execFileSync(link, ["--directory", "/tmp/registry with spaces"], { encoding: "utf8" }), "--directory\n/tmp/registry with spaces\n");
  installCli("install", { home, cli });
  assert.equal(await readlink(link), cli);
});

test("uninstall is idempotent and preserves checkout and registry state", async t => {
  const { home, cli, link } = await fixture(t);
  const state = join(home, ".local/state/agents-registry");
  await mkdir(state, { recursive: true });
  await writeFile(join(state, "agents.jsonl"), "preserved");
  installCli("install", { home, cli });
  installCli("uninstall", { home, cli });
  installCli("uninstall", { home, cli });
  await assert.rejects(lstat(link), { code: "ENOENT" });
  assert.ok(await stat(cli));
  assert.equal(await readFile(join(state, "agents.jsonl"), "utf8"), "preserved");
});

test("installer refuses files, directories, and unrelated dangling symlinks", async t => {
  const { home, cli, link } = await fixture(t);
  await mkdir(dirname(link), { recursive: true });
  for (const create of [() => writeFile(link, "keep"), () => mkdir(link), () => symlink("/missing/unrelated-cli", link)]) {
    await create();
    for (const action of ["install", "uninstall"]) assert.throws(() => installCli(action, { home, cli }), /Refusing to modify/);
    assert.ok(await lstat(link));
    await rm(link, { recursive: true });
  }
});

test("missing launcher cannot install but its own dangling link can be removed", async t => {
  const { home, cli, link } = await fixture(t);
  await rm(cli);
  assert.throws(() => installCli("install", { home, cli }), { code: "ENOENT" });
  await assert.rejects(lstat(dirname(link)), { code: "ENOENT" });
  await mkdir(dirname(link), { recursive: true });
  await symlink(cli, link);
  installCli("uninstall", { home, cli });
  await assert.rejects(lstat(link), { code: "ENOENT" });
});

test("installed real launcher resolves checkout through the symlink", async t => {
  const { home, link } = await fixture(t);
  installCli("install", { home });
  assert.match(execFileSync(link, ["--help"], { encoding: "utf8" }), /Usage: agents-browser/);
});

test("installer command supports help and rejects invalid actions", () => {
  const installer = fileURLToPath(new URL("./install.ts", import.meta.url));
  assert.match(execFileSync("bun", ["run", installer, "--help"], { encoding: "utf8" }), /install\|uninstall/);
  assert.throws(() => installCli("start"), /Usage:/);
  assert.throws(() => execFileSync("bun", ["run", installer, "start"], { stdio: "pipe" }));
});
