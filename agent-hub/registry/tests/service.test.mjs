import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { renderService } from '../scripts/service.mjs';

const options = {
  node: '/opt/Node Runtime/node', cli: '/repo/agent hub/dist/cli.js',
  directory: '/tmp/registry', path: '/opt/bin:/usr/bin:/bin', home: '/home/test',
  args: ['--tmux-socket', '/tmp/tmux/default'],
};

test('systemd supervises the foreground writer and delays crash recovery past the lease', () => {
  const unit = renderService({ ...options, platform: 'linux' });
  assert.match(unit, /ExecStart="\/opt\/Node Runtime\/node" "\/repo\/agent hub\/dist\/cli.js" "start" "--foreground"/);
  assert.match(unit, /"--tmux-socket" "\/tmp\/tmux\/default"/);
  assert.match(unit, /Restart=on-failure\nRestartSec=35/);
  assert.match(unit, /WantedBy=default.target/);
  assert.doesNotMatch(unit, /--background/);
});

test('systemd escapes specifiers, variables, quotes, and backslashes', () => {
  const unit = renderService({ ...options, platform: 'linux', node: '/opt/100%/$node/"x"/\\node', path: '/opt/100%/$bin' });
  assert.ok(unit.includes('"/opt/100%%/$$node/\\"x\\"/\\\\node"'));
  assert.ok(unit.includes('Environment="PATH=/opt/100%%/$bin"'));
});

test('launchd uses escaped XML, private log paths, and foreground supervision', () => {
  const plist = renderService({ ...options, platform: 'darwin', cli: '/repo/a&b<"x">/cli.js' });
  assert.ok(plist.includes('/repo/a&amp;b&lt;&quot;x&quot;&gt;/cli.js'));
  assert.match(plist, /<key>SuccessfulExit<\/key><false\/>/);
  assert.match(plist, /<key>ThrottleInterval<\/key><integer>35<\/integer>/);
  assert.match(plist, /<key>Umask<\/key><integer>63<\/integer>/);
  assert.match(plist, /\/tmp\/registry\/service.stderr.log/);
  assert.doesNotMatch(plist, /--background/);
});

test('configuration rejects control characters and unsupported platforms', () => {
  assert.throws(() => renderService({ ...options, platform: 'linux', path: '/bin\nExecStart=bad' }), /Control characters/);
  assert.throws(() => renderService({ ...options, platform: 'win32' }), /Only Linux/);
});

test('Linux install/reinstall/uninstall use only the user manager and preserve state', { skip: process.platform !== 'linux' || process.getuid?.() === 0 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'registry-service-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const config = join(dir, 'config');
  const state = join(dir, 'state');
  const log = join(dir, 'commands');
  await mkdir(bin);
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, XDG_CONFIG_HOME: config, COMMAND_LOG: log };
  const script = resolve('scripts/service.mjs');
  const run = (...args) => execFileSync(process.execPath, [script, ...args, '--directory', state], { env, encoding: 'utf8' });
  run('install', '--dry-run');
  await assert.rejects(readFile(log), { code: 'ENOENT' });
  run('install');
  const file = join(config, 'systemd/user/agents-registry.service');
  assert.match(await readFile(file, 'utf8'), /Managed by agents-registry/);
  await writeFile(join(state, 'keep'), 'preserved');
  run('install');
  run('uninstall');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal(await readFile(join(state, 'keep'), 'utf8'), 'preserved');
  const commands = await readFile(log, 'utf8');
  assert.match(commands, /--user enable --now agents-registry.service/);
  assert.match(commands, /--user disable --now agents-registry.service/);
  assert.ok(commands.trim().split('\n').every(line => line.startsWith('--user ')));
  await writeFile(file, 'user-owned configuration');
  assert.throws(() => run('install'), /Refusing to modify unmanaged file/);
  assert.equal(await readFile(file, 'utf8'), 'user-owned configuration');
});
