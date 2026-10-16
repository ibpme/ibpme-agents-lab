import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { resolveConfig } from '../src/config.ts';
import { createSpawnerClient } from '@agent-hub/spawner';
import { startService } from '../src/service.ts';
import { request } from '../src/client.ts';
import { listProcesses } from '@agent-hub/registry/processes';
import { request as registryRequest } from '@agent-hub/registry/client';

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hub-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ directory: join(root, 'hub'), registryOnly: true, ...extra });
  return { root, config };
}

test('configuration file, environment defaults, and explicit overrides', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'config.json'), JSON.stringify({ intervalMs: 1234, registryOnly: true, routingConfigPath: 'routing.json', tmuxServers: ['/tmp/a', '/tmp/a'] }));
  const config = resolveConfig({ directory: root, activityTtlMs: 3000 }, { XDG_STATE_HOME: join(root, 'unused') });
  assert.equal(config.intervalMs, 1234);
  assert.equal(config.routingConfigPath, join(root, 'routing.json'));
  assert.equal(config.registryDirectory, join(root, 'registry'));
  assert.equal(config.spawnerDirectory, join(root, 'spawner'));
  assert.equal(resolveConfig({}, { AGENT_HUB_DIR: join(root, 'env') }).directory, join(root, 'env'));
  assert.equal(resolveConfig({}, { XDG_STATE_HOME: join(root, 'xdg') }).spawnerDirectory, join(root, 'xdg', 'agent-hub', 'spawner'));
  assert.equal(config.activityTtlMs, 3000);
  assert.equal(config.registryOnly, true);
  assert.deepEqual(config.tmuxServers, ['/tmp/a']);
  for (const value of [{ intervalMs: 0 }, { registryOnly: 'yes' }, { tmuxServers: ['relative'] }, { registryDirectory: '/tmp/r' }, { unknown: true }, []]) {
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
  config.routingConfigPath = join(root, 'routing.json');
  await writeFile(config.routingConfigPath, JSON.stringify({ routing: { enabled: true, default_profile: 'general', profiles: [{ id: 'general', harness: 'pi', provider: 'test', model: 'test-model', effort: 'medium', description: 'General tasks' }] } }));
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
  assert.equal(status.config.routingConfigPath, config.routingConfigPath);
  assert.equal((await createSpawnerClient(config.spawnerDirectory).request({ action: 'capabilities', owner: 'test' })).routing_enabled, true);
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
  await mkdir(config.spawnerDirectory, { recursive: true });
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

async function run(args, { env = process.env, input } = {}) {
  const child = spawn(process.execPath, [new URL('../src/cli.ts', import.meta.url).pathname, ...args], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { code, stdout, stderr };
}

async function cli(args, options) {
  const { code, stdout, stderr } = await run(args, options);
  assert.equal(code, 0, stderr);
  return stdout;
}

test('compiled CLI background start/status/stop and restart', async t => {
  const { root, config } = await fixture(t);
  await mkdir(config.directory);
  await writeFile(join(config.directory, 'config.json'), JSON.stringify({ registryOnly: true }));
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

test('publish sends one stdin message to the hub-owned registry', async t => {
  const { config } = await fixture(t);
  const args = ['--directory', config.directory];
  t.after(async () => { try { await request(config.directory, 'stop'); } catch {} });
  await cli(['start', '--background', '--registry-only', ...args]);
  const info = (await listProcesses()).get(process.pid);
  const message = { version: 1, type: 'publish', harness: 'pi', source: 'pi', process: { pid: info.pid, startedAt: info.startedAt }, reportedAt: Date.now(), patch: { activity: { state: 'idle' }, session: { name: 'Integration', cwd: '/repo' } } };
  await cli(['publish', ...args], { input: JSON.stringify(message) });
  const rows = (await readFile(join(config.registryDirectory, 'agents.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.find(row => row.process.pid === process.pid).session.name, 'Integration');
  assert.equal((await run(['publish', ...args], { input: '{"version":1,"type":"stop"}' })).code, 1);
  await cli(['stop', ...args]);
});

test('commands dispatch, print help, and reject unknown commands and removed options', async t => {
  const { root } = await fixture(t);
  assert.match(await cli(['help']), /view.*\n.*publish/s);
  assert.match(await cli(['help', 'route']), /agent-hub route validate/);
  assert.match(await cli(['claude', '--help']), /--statusline/);
  for (const args of [['bogus'], ['help', 'bogus'], ['start', '--registry-directory', root], ['route', 'bogus'], ['claude', 'install', '--bogus'], ['publish', '--bogus']]) {
    assert.equal((await run(args)).code, 1, args.join(' '));
  }
  const settings = join(root, 'settings.json');
  await writeFile(settings, '{}\n');
  await cli(['claude', 'install', '--hooks', '--settings', settings]);
  assert.ok(JSON.parse(await readFile(settings, 'utf8')).hooks.SessionStart);
  await cli(['claude', 'uninstall', '--hooks', '--settings', settings]);
  assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), {});
});
