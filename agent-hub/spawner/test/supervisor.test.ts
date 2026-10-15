import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { SupervisorOptions } from '../src/supervisor.ts';
import { parseRoutingConfig } from '../dist/routing.js';
import { startSupervisor } from '../dist/supervisor.js';
import { atomic, execute, processStart } from '../dist/io.js';
import { createSpawnerClient } from '../dist/client.js';
import type { Task, SpawnInput } from '../src/types.ts';
const fake = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url));
const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
async function until(operation: () => Promise<any>, check: (value: any) => boolean) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = await operation(); if (check(value)) return value; await wait(); }
  throw new Error('Timed out waiting for task state');
}
async function setup(t: test.TestContext, tmux = false, overrides: Partial<SupervisorOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'spawner-'));
  const tmuxSocket = join(directory, 'tmux.sock');
  if (tmux) await execute('tmux', ['-S', tmuxSocket, '-f', '/dev/null', 'new-session', '-d', '-s', 'test']);
  const notifications: Task[] = [];
  let reject = false;
  const options = {
    directory, pi: fake, tmuxSocket, tmuxSession: 'test', pollInterval: 30, startupTimeout: 1000,
    notify: async (task: Task) => {
      assert.deepEqual(JSON.parse(await readFile(join(task.directory, 'task.json'), 'utf8')).completion, task.completion);
      if (reject) throw new Error('Parent temporarily unavailable');
      notifications.push(structuredClone(task));
    },
    ...overrides,
  };
  let runtime = await startSupervisor(options);
  const client = createSpawnerClient(directory);
  const parent = { agentId: 'agt_0000000000000000', pid: process.pid, startedAt: (await processStart(process.pid))!, sessionId: 'parent-session' };
  const spawn = (prompt?: string, mode: 'headless' | 'interactive' = tmux ? 'interactive' : 'headless') => client.request({
    action: 'spawn', owner: 'owner', input: { harness: 'pi', mode, cwd: directory, parent, ...(prompt ? { prompt } : {}) },
  });
  const check = (id: string) => client.request({ action: 'check', owner: 'owner', taskId: id });
  t.after(async () => {
    await runtime.close();
    if (tmux) await execute('tmux', ['-S', tmuxSocket, 'kill-server']).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, spawn, check, client, notifications, tmuxSocket, parent,
    rejectDelivery: (value: boolean) => { reject = value; },
    restart: async () => { await runtime.close(); runtime = await startSupervisor(options); },
  };
}

test('real tmux child stays attachable after completion, manual input does not notify again', async t => {
  const h = await setup(t, true);
  const spawned = await h.spawn('review');
  const id = spawned.task_id as string;
  const done = await until(() => h.check(id), value => value.delivery === 'accepted');
  assert.equal(done.status, 'completed');
  const pane = (done.tmux as any).pane;
  const { stdout } = await execute('tmux', ['-S', h.tmuxSocket, 'display-message', '-p', '-t', pane, '#{pane_dead}']);
  assert.equal(stdout.trim(), '0');
  await execute('tmux', ['-S', h.tmuxSocket, 'send-keys', '-t', pane, 'manual prompt', 'Enter']);
  await until(async () => readFile(join(h.directory, 'tasks', id, 'manual.json'), 'utf8').catch(() => ''), value => value.includes('manual prompt'));
  assert.equal(h.notifications.length, 1);
  const fetched = await h.client.request({ action: 'fetch_answer', owner: 'owner', taskId: id });
  assert.equal((fetched.answer as any).text, 'Final answer');
  await assert.rejects(h.client.request({ action: 'check', owner: 'other-owner', taskId: id }), /not found/);
});

test('completion and exact notification survive supervisor restart and retry', async t => {
  const h = await setup(t);
  h.rejectDelivery(true);
  const spawned = await h.spawn('large');
  const id = spawned.task_id as string;
  await until(() => h.check(id), value => value.delivery === 'unavailable');
  const persisted = JSON.parse(await readFile(join(h.directory, 'tasks', id, 'task.json'), 'utf8'));
  assert.ok(persisted.notification.length < 10000);
  assert.equal(persisted.completion.text.length, 70000);
  h.rejectDelivery(false);
  await h.restart();
  await until(() => h.check(id), value => value.delivery === 'accepted');
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0]!.notification, persisted.notification);
});

test('headless runner remains alive when supervisor restarts during execution', async t => {
  const h = await setup(t);
  const spawned = await h.spawn('slow');
  await h.restart();
  const result = await until(() => h.check(spawned.task_id as string), value => value.delivery === 'accepted');
  assert.equal(result.status, 'completed');
});

test('cancel interrupts initial task but leaves the interactive process open', async t => {
  const h = await setup(t, true);
  const spawned = await h.spawn('wait');
  await h.client.request({ action: 'cancel', owner: 'owner', taskId: spawned.task_id as string });
  const result = await until(() => h.check(spawned.task_id as string), value => value.status === 'cancelled');
  assert.equal(result.process_state, 'available');
});

test('unexpected child exit becomes lost, not a task waiting forever', async t => {
  const h = await setup(t);
  const spawned = await h.spawn('crash');
  const result = await until(() => h.check(spawned.task_id as string), value => value.status === 'lost');
  assert.equal(result.process_state, 'exited');
});

test('no-prompt interactive session is idle and never schedules completion delivery', async t => {
  const h = await setup(t, true);
  const spawned = await h.spawn();
  assert.equal(spawned.status, 'idle');
  assert.equal(spawned.delivery, 'none');
  assert.equal(h.notifications.length, 0);
});

test('rejects a second supervisor and invalid spawn requests without launching', async t => {
  const h = await setup(t);
  await assert.rejects(startSupervisor({ directory: h.directory }), /EEXIST/);
  await assert.rejects(h.client.request({ action: 'spawn', owner: 'owner', input: { harness: 'claude' } as unknown as SpawnInput }), /Only Pi/);
  await assert.rejects(h.client.request({ action: 'spawn', owner: 'owner', input: { harness: 'pi', mode: 'headless', cwd: h.directory, parent: h.parent } }), /require a prompt/);
  await assert.rejects(h.client.request({ action: 'spawn', owner: 'owner', input: { harness: 'pi', mode: 'interactive', cwd: h.directory, parent: h.parent, injectParentContext: 'true' } as unknown as SpawnInput }), /injectParentContext must be a boolean/);
});

test('missing Pi executable reports a failed startup rather than hanging', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'spawner-fail-'));
  const runtime = await startSupervisor({ directory, pi: '/does/not/exist', startupTimeout: 500, pollInterval: 20, notify: async () => {} });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const result = await runtime.handle({ action: 'spawn', owner: 'owner', input: { harness: 'pi', mode: 'headless', cwd: directory, prompt: 'test', parent: { agentId: 'agt_0000000000000000', pid: process.pid, startedAt: (await processStart(process.pid))!, sessionId: 'parent' } } });
  assert.equal(result.status, 'failed');
});

test('explicit lock recovery refuses a live owner and can recover a dead owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'spawner-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await atomic(join(directory, 'supervisor.lock'), { pid: process.pid, startedAt: await processStart(process.pid) });
  await assert.rejects(startSupervisor({ directory, recoverLock: true }), /live process/);
  await atomic(join(directory, 'supervisor.lock'), { pid: 2147483647, startedAt: 0 });
  const runtime = await startSupervisor({ directory, recoverLock: true });
  await runtime.close();
});

function routingConfig() {
  return parseRoutingConfig({ routing: { enabled: true, default_profile: 'general', profiles: [
    { id: 'general', harness: 'pi', provider: 'provider-a', model: 'general-model', effort: 'medium', description: 'General work', append_system_prompt: 'Default profile instructions' },
    { id: 'deep', harness: 'pi', provider: 'provider-b', model: 'deep-model', effort: 'high', description: 'Deep work', append_system_prompt: 'Deep profile instructions' },
  ] } });
}

for (const tmux of [false, true]) {
  test(`supervisor persists authoritative routing and launches exact profile settings (tmux=${tmux})`, async t => {
    let classifications = 0;
    const config = routingConfig();
    const h = await setup(t, tmux, { routingConfig: config, routingDependencies: { classify: async () => { classifications++; return 'deep'; }, validateProfile: async () => undefined } });
    assert.equal((await h.client.request({ action: 'capabilities', owner: 'owner' })).routing_enabled, true);
    for (const override of [{ model: 'caller-choice' }, { provider: 'caller-choice' }, { effort: 'low' }, { profile: 'general' }, { execution: { model: 'caller-choice' } }, { append_system_prompt: 'caller instructions' }]) {
      await assert.rejects(h.client.request({ action: 'spawn', owner: 'owner', input: { harness: 'pi', mode: tmux ? 'interactive' : 'headless', cwd: h.directory, parent: h.parent, prompt: 'task', ...override } as SpawnInput }), /overrides are forbidden|Unknown spawn input/);
    }
    assert.equal(classifications, 0);
    const task = await h.spawn('slow');
    assert.equal(classifications, 1);
    assert.equal((task.routing as any).profile, 'deep');
    assert.deepEqual(task.execution, { harness: 'pi', provider: 'provider-b', model: 'deep-model', effort: 'high' });
    assert.doesNotMatch(JSON.stringify(task), /Deep profile instructions/);
    const directory = join(h.directory, 'tasks', task.task_id as string);
    const persisted = JSON.parse(await readFile(join(directory, 'task.json'), 'utf8'));
    assert.equal(persisted.execution.append_system_prompt, 'Deep profile instructions');
    assert.equal(persisted.input.model, undefined);
    const args = JSON.parse(await readFile(join(directory, 'launch-args.json'), 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 6), ['--provider', 'provider-b', '--model', 'deep-model', '--thinking', 'high']);
    config.routing.profiles[1]!.model = 'changed-after-spawn';
    await h.restart();
    const checked = await h.check(task.task_id as string);
    assert.equal((checked.execution as any).model, 'deep-model');
    assert.equal(classifications, 1);
  });
}

test('classification time is separate from the startup handshake deadline', async t => {
  const h = await setup(t, false, { startupTimeout: 150, routingConfig: routingConfig(), routingDependencies: {
    classify: async () => { await wait(250); return 'general'; }, validateProfile: async () => undefined,
  } });
  const task = await h.spawn('slow');
  assert.equal(task.status, 'running');
  assert.ok((task.routing as any).duration_ms >= 250);
});

test('supervisor uses full default fallback profile and never launches an unavailable default', async t => {
  let unavailable = false;
  const h = await setup(t, false, { routingConfig: routingConfig(), routingDependencies: {
    classify: async () => { throw new Error('classifier failed'); }, validateProfile: async () => unavailable ? 'unknown_chat_model' : undefined,
  } });
  const task = await h.spawn('slow');
  assert.equal((task.routing as any).source, 'fallback');
  assert.equal((task.execution as any).model, 'general-model');
  const persisted = JSON.parse(await readFile(join(h.directory, 'tasks', task.task_id as string, 'task.json'), 'utf8'));
  assert.equal(persisted.execution.append_system_prompt, 'Default profile instructions');
  unavailable = true;
  const failed = await h.spawn('task');
  assert.equal(failed.status, 'failed');
  const directory = join(h.directory, 'tasks', failed.task_id as string);
  await assert.rejects(readFile(join(directory, 'launch-args.json')), { code: 'ENOENT' });
  assert.match(JSON.parse(await readFile(join(directory, 'completion.json'), 'utf8')).error, /Default routing profile general unavailable/);
});

test('shutdown cancels in-flight classification without launching a child', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'route-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let classified!: () => void;
  const started = new Promise<void>(resolve => { classified = resolve; });
  const runtime = await startSupervisor({ directory, pi: fake, routingConfig: routingConfig(), routingDependencies: {
    classify: async () => { classified(); return new Promise(() => {}); }, validateProfile: async () => undefined,
  } });
  const pending = runtime.handle({ action: 'spawn', owner: 'owner', input: { harness: 'pi', mode: 'headless', cwd: directory, prompt: 'task', parent: { agentId: 'agt_0000000000000000', pid: process.pid, startedAt: (await processStart(process.pid))!, sessionId: 'parent' } } });
  await started;
  await runtime.close();
  const result = await pending;
  assert.equal(result.status, 'failed');
  await assert.rejects(readFile(join(directory, 'tasks', result.task_id as string, 'launch-args.json')), { code: 'ENOENT' });
});

test('cancelling a task during classification does not launch or retry it', async t => {
  let classified!: () => void;
  const started = new Promise<void>(resolve => { classified = resolve; });
  const h = await setup(t, false, { routingConfig: routingConfig(), routingDependencies: {
    classify: async () => { classified(); return new Promise(() => {}); }, validateProfile: async () => undefined,
  } });
  const spawning = h.spawn('task');
  await started;
  const listing = await h.client.request({ action: 'list', owner: 'owner' });
  const id = (listing.tasks as any[])[0].task_id;
  await h.client.request({ action: 'cancel', owner: 'owner', taskId: id });
  assert.equal((await spawning).status, 'cancelled');
  await assert.rejects(readFile(join(h.directory, 'tasks', id, 'launch-args.json')), { code: 'ENOENT' });
});
