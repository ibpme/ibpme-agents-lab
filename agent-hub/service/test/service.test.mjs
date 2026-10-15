import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { resolveConfig } from '../dist/config.js';
import { startService } from '../dist/service.js';
import { request } from '../dist/client.js';
import { request as registryRequest } from '@agent-hub/registry/client';

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hub-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ directory: join(root, 'hub'), registryDirectory: join(root, 'registry'), spawnerDirectory: join(root, 'spawner'), registryOnly: true, ...extra });
  return { root, config };
}

test('configuration file, environment defaults, and explicit overrides', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'config.json'), JSON.stringify({ intervalMs: 1234, registryOnly: true, tmuxServers: ['/tmp/a', '/tmp/a'] }));
  const config = resolveConfig({ directory: root, activityTtlMs: 3000 }, { XDG_STATE_HOME: root, AGENTS_REGISTRY_DIR: join(root, 'custom') });
  assert.equal(config.intervalMs, 1234);
  assert.equal(config.registryDirectory, join(root, 'custom'));
  assert.equal(config.activityTtlMs, 3000);
  assert.equal(config.registryOnly, true);
  assert.deepEqual(config.tmuxServers, ['/tmp/a']);
  for (const value of [{ intervalMs: 0 }, { registryOnly: 'yes' }, { tmuxServers: ['relative'] }, { unknown: true }, []]) {
    await writeFile(join(root, 'config.json'), JSON.stringify(value));
    assert.throws(() => resolveConfig({ directory: root }));
  }
});

test('registry-only lifecycle, duplicate ownership, private control and legacy stop', async t => {
  const { config } = await fixture(t);
  const service = await startService(config);
  t.after(() => service.stop());
  const status = await request(config.directory, 'status');
  assert.equal(status.ok, true);
  assert.equal(status.registry.state, 'running');
  assert.equal(status.supervisor, 'disabled');
  assert.equal((await stat(join(config.directory, 'hub.sock'))).mode & 0o777, 0o600);
  await assert.rejects(startService(config));
  assert.equal((await request(config.directory, 'status')).ok, true);
  await registryRequest(config.registryDirectory, { version: 1, type: 'stop' });
  await service.closed;
  await assert.rejects(request(config.directory, 'status'));
  assert.equal(JSON.parse(await readFile(join(config.registryDirectory, 'registry-health.json'))).state, 'stopped');
});

test('unified lifecycle tracks the selected tmux server and preserves task artifacts', async t => {
  const { root, config } = await fixture(t, { registryOnly: false });
  const bin = join(root, 'bin');
  await mkdir(bin);
  const log = join(root, 'tmux.log');
  await writeFile(join(bin, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o700 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  t.after(() => { process.env.PATH = oldPath; if (oldTmux === undefined) delete process.env.TMUX; else process.env.TMUX = oldTmux; });
  const service = await startService(config);
  t.after(() => service.stop());
  const status = await request(config.directory, 'status');
  assert.equal(status.supervisor, 'running');
  assert.equal(status.tmux.tmuxSocket, join(config.spawnerDirectory, 'tmux.sock'));
  assert.match(await readFile(log, 'utf8'), /list-panes/);
  await writeFile(join(config.spawnerDirectory, 'tasks', 'preserved'), 'durable');
  assert.equal((await request(config.directory, 'stop')).ok, true);
  await service.closed;
  assert.equal(await readFile(join(config.spawnerDirectory, 'tasks', 'preserved'), 'utf8'), 'durable');
  await assert.rejects(stat(join(config.spawnerDirectory, 'supervisor.lock')));
});

test('supervisor startup failure rolls registry and control ownership back', async t => {
  const { root, config } = await fixture(t, { registryOnly: false });
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  config.tmuxServers = [join(root, 'tmux.sock')];
  config.tmuxSession = 'test';
  await mkdir(config.spawnerDirectory);
  await writeFile(join(config.spawnerDirectory, 'supervisor.lock'), '{}');
  await assert.rejects(startService(config));
  await assert.rejects(stat(join(config.registryDirectory, 'writer.lock')));
  await assert.rejects(stat(join(config.directory, 'hub.lock')));
  await assert.rejects(request(config.directory, 'status'));
  await writeFile(join(config.spawnerDirectory, 'supervisor.lock'), JSON.stringify({ pid: 2147483647, startedAt: 1 }));
  const recovered = await startService({ ...config, recoverLock: true });
  t.after(() => recovered.stop());
  assert.equal((await request(config.directory, 'status')).supervisor, 'running');
  await recovered.stop();
});

async function cli(args, env = process.env) {
  const child = spawn(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname, ...args], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, stderr);
  return stdout;
}

test('compiled CLI background start/status/stop and restart', async t => {
  const { root, config } = await fixture(t);
  await mkdir(config.directory);
  await writeFile(join(config.directory, 'config.json'), JSON.stringify({ registryDirectory: config.registryDirectory, spawnerDirectory: config.spawnerDirectory, registryOnly: true }));
  const args = ['--directory', config.directory];
  t.after(async () => { try { await request(config.directory, 'stop'); } catch {} });
  for (let i = 0; i < 2; i++) {
    await cli(['start', '--background', ...args]);
    const status = JSON.parse(await cli(['status', ...args]));
    assert.equal(status.registry.state, 'running');
    await cli(['start', '--background', ...args]);
    await cli(['stop', ...args]);
  }
});
