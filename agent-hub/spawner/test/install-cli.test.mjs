import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { installCli } from '../scripts/install-cli.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'spawner cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cli = join(home, 'checkout with spaces/dist/cli.js');
  await mkdir(dirname(cli), { recursive: true });
  await writeFile(cli, '#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join(" "));\n', { mode: 0o644 });
  return { home, cli, link: join(home, '.local/bin/agent-spawn') };
}

test('installs an executable symlink, forwards arguments, and supports reinstall', async t => {
  const { home, cli, link } = await fixture(t);
  await chmod(cli, 0o644);
  installCli('install', { home, cli });
  assert.ok((await lstat(link)).isSymbolicLink());
  assert.equal(await readlink(link), cli);
  assert.equal((await stat(cli)).mode & 0o111, 0o111);
  assert.equal(execFileSync(link, ['start', '--tmux-socket', '/tmp/tmux/default'], { encoding: 'utf8' }).trim(), 'start --tmux-socket /tmp/tmux/default');
  installCli('install', { home, cli });
  assert.equal(await readlink(link), cli);
});

test('uninstall is idempotent and preserves the CLI and spawner state', async t => {
  const { home, cli, link } = await fixture(t);
  const state = join(home, '.local/state/agents-spawner');
  await mkdir(state, { recursive: true });
  await writeFile(join(state, 'task.json'), 'preserved');
  installCli('install', { home, cli });
  installCli('uninstall', { home, cli });
  installCli('uninstall', { home, cli });
  await assert.rejects(lstat(link), { code: 'ENOENT' });
  assert.ok(await stat(cli));
  assert.equal(await readFile(join(state, 'task.json'), 'utf8'), 'preserved');
});

test('refuses to replace or remove files, directories, and unrelated dangling symlinks', async t => {
  const { home, cli, link } = await fixture(t);
  await mkdir(dirname(link), { recursive: true });
  for (const create of [() => writeFile(link, 'keep'), () => mkdir(link), () => symlink('/missing/unrelated-cli', link)]) {
    await create();
    for (const action of ['install', 'uninstall']) {
      assert.throws(() => installCli(action, { home, cli }), /Refusing to modify/);
    }
    assert.ok(await lstat(link));
    await rm(link, { recursive: true });
  }
});

test('requires a build for install but can remove its own dangling link', async t => {
  const { home, cli, link } = await fixture(t);
  await rm(cli);
  assert.throws(() => installCli('install', { home, cli }), /npm ci && npm run build/);
  await assert.rejects(lstat(dirname(link)), { code: 'ENOENT' });
  await mkdir(dirname(link), { recursive: true });
  await symlink(cli, link);
  installCli('uninstall', { home, cli });
  await assert.rejects(lstat(link), { code: 'ENOENT' });
});

test('installed real CLI resolves checkout modules through the symlink', async t => {
  const { home, link } = await fixture(t);
  installCli('install', { home, cli: resolve('dist/cli.js') });
  assert.match(execFileSync(link, ['--help'], { encoding: 'utf8' }), /Usage: agent-spawn/);
});

test('rejects invalid actions', () => {
  assert.throws(() => installCli('start'), /Usage:/);
});
