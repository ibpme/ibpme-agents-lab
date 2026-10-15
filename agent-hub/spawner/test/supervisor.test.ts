import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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
async function setup(t: test.TestContext, tmux = false) {
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
