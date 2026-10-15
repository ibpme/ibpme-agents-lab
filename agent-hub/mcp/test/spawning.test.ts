import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAgentsServer, createConfiguredAgentsServer } from '../src/server.js';
import { startSupervisor } from '@agent-hub/spawner/supervisor';
import { listProcesses } from '@agent-hub/registry/processes';
import { startListener } from '@agent-hub/pi/listener';

for (const injectParentContext of [undefined, false, true]) {
test(`MCP spawns and delivers automatically (injectParentContext=${injectParentContext})`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-spawn-'));
  const execute = promisify(execFile);
  const tmuxSocket = join(directory, 'tmux.sock');
  await execute('tmux', ['-S', tmuxSocket, '-f', '/dev/null', 'new-session', '-d', '-s', 'test']);
  const received: any[] = [];
  const listener = await startListener(message => received.push(message));
  const startedAt = (await listProcesses()).get(process.pid)!.startedAt;
  const id = `agt_${createHash('sha256').update(JSON.stringify(['pi', process.pid, startedAt])).digest('hex').slice(0, 16)}`;
  await writeFile(join(directory, 'registry-health.json'), JSON.stringify({ version: 1, state: 'running', updatedAt: Date.now(), lastSuccessfulProcessDiscoveryAt: Date.now() }));
  await writeFile(join(directory, 'agents.jsonl'), JSON.stringify({ schemaVersion: 1, harness: 'pi', observedAt: Date.now(), process: { pid: process.pid, startedAt }, session: { id: 'original', mode: 'interactive' }, activity: { state: 'idle' }, messaging: { transport: 'unix', protocol: 'pi-listener-v2', path: listener.path, reportedAt: Date.now() } }) + '\n');
  const routingConfig = injectParentContext === true ? { routing: { enabled: true, default_profile: 'general', classifier: { model: 'jev-latest', timeout_ms: 3000 }, profiles: [{ id: 'general', harness: 'pi' as const, provider: 'test', model: 'routed-model', effort: 'medium' as const, description: 'General tasks', append_system_prompt: 'Private profile instructions' }] } } : undefined;
  const supervisor = await startSupervisor({ directory, routingConfig, routingDependencies: { classify: async () => 'general', validateProfile: async () => undefined }, registryDirectory: directory, pi: fileURLToPath(new URL('../../spawner/test/fake-pi.mjs', import.meta.url)), pollInterval: 20, tmuxSocket, tmuxSession: 'test' });
  const server = await createConfiguredAgentsServer({ registryDirectory: directory, spawnerDirectory: directory, callerAgentId: id, injectParentContext });
  const client = new Client({ name: 'spawn-test', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); await supervisor.close(); await listener.close(); await execute('tmux', ['-S', tmuxSocket, 'kill-server']).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const schema = (await client.listTools()).tools.find(tool => tool.name === 'spawn_agent')!.inputSchema;
  assert.equal(schema.properties?.model === undefined, !!routingConfig);
  if (routingConfig) {
    const rejected = await client.callTool({ name: 'spawn_agent', arguments: { harness: 'pi', model: 'caller-model', prompt: 'task' } });
    assert.equal(rejected.isError, true);
  }
  const spawned = await client.callTool({ name: 'spawn_agent', arguments: { harness: 'pi', cwd: directory, prompt: 'slow' } });
  assert.equal(spawned.isError, undefined);
  const task = spawned.structuredContent as any;
  assert.equal(task.status, 'running');
  const persisted = JSON.parse(await readFile(join(directory, 'tasks', task.task_id, 'task.json'), 'utf8'));
  assert.equal(persisted.input.mode, 'interactive');
  if (routingConfig) {
    assert.equal(task.execution.model, 'routed-model');
    assert.equal(task.routing.profile, 'general');
    assert.equal(persisted.execution.append_system_prompt, 'Private profile instructions');
    assert.doesNotMatch(JSON.stringify(spawned), /Private profile instructions/);
  }
  assert.equal(persisted.input.injectParentContext, injectParentContext === true ? true : undefined);
  assert.equal(persisted.input.parent.agentId, id);
  assert.ok(persisted.pane);
  assert.equal(task.mode, undefined);
  assert.equal(task.tmux, undefined);
  assert.match(task.agent_id, /^agt_[0-9a-f]{16}$/);
  assert.equal(task.agent_id, `agt_${createHash('sha256').update(JSON.stringify(['pi', persisted.pid, persisted.startedAt])).digest('hex').slice(0, 16)}`);
  assert.equal(task.can_receive_messages, false);
  const deadline = Date.now() + 5000;
  while (!received.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(received.length, 1);
  assert.equal(received[0].expectedSessionId, 'original');
  assert.match(received[0].content, /Final answer/);
  const fetched = await client.callTool({ name: 'agent_task', arguments: { task_id: task.task_id, action: 'fetch_answer' } });
  assert.equal((fetched.structuredContent as any).answer.text, 'Final answer');
  const listed = await client.callTool({ name: 'list_agent_tasks', arguments: {} });
  const checked = await client.callTool({ name: 'agent_task', arguments: { task_id: task.task_id, action: 'check' } });
  const cancelled = await client.callTool({ name: 'agent_task', arguments: { task_id: task.task_id, action: 'cancel' } });
  for (const response of [spawned, fetched, listed, checked, cancelled]) {
    assert.doesNotMatch(JSON.stringify(response), /"mode"|"tmux"|"result_path"|interactive|headless/);
  }
  assert.equal((listed.structuredContent as any).tasks[0].task_id, task.task_id);
  const { stdout } = await execute('tmux', ['-S', tmuxSocket, 'display-message', '-p', '-t', persisted.pane, '#{pane_dead}']);
  assert.equal(stdout.trim(), '0');
});

}

test('MCP exposes result paths only for execution or delivery failures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let output: Record<string, unknown> = {};
  const socket = createServer(connection => {
    connection.on('error', () => {});
    connection.once('data', () => connection.end(JSON.stringify({ ok: true, data: output }) + '\n'));
  });
  await new Promise<void>(resolve => socket.listen(join(directory, 'spawner.sock'), resolve));
  t.after(() => new Promise<void>(resolve => socket.close(() => resolve())));
  const server = createAgentsServer({ spawnerDirectory: directory });
  const client = new Client({ name: 'path-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const resultPath = join(directory, 'completion.json');
  const cases = [
    ...['starting', 'running', 'idle', 'completed', 'cancelled'].map(status => ({ status, delivery: 'none', exposed: false })),
    ...['failed', 'interrupted', 'lost'].map(status => ({ status, delivery: 'none', exposed: true })),
    { status: 'completed', delivery: 'unavailable', exposed: true },
    { status: 'completed', delivery: 'pending', exposed: false },
    { status: 'completed', delivery: 'accepted', exposed: false },
  ];
  for (const item of cases) {
    const task = { task_id: 'task_example', status: item.status, delivery: item.delivery, mode: 'interactive', tmux: {}, result_path: resultPath };
    for (const action of ['check', 'fetch_answer', 'cancel']) {
      output = task;
      const response = await client.callTool({ name: 'agent_task', arguments: { task_id: task.task_id, action } });
      assert.equal(response.isError, undefined);
      const result = response.structuredContent as Record<string, unknown>;
      assert.equal(result.result_path, item.exposed ? resultPath : undefined, `${item.status}/${item.delivery}/${action}`);
      assert.equal(result.mode, undefined);
      assert.equal(result.tmux, undefined);
      assert.deepEqual(JSON.parse((response.content as any)[0].text), result);
    }
  }
  output = { tasks: cases.map(item => ({ task_id: 'task_example', status: item.status, delivery: item.delivery, result_path: resultPath })) };
  const response = await client.callTool({ name: 'list_agent_tasks', arguments: {} });
  const tasks = (response.structuredContent as any).tasks;
  assert.deepEqual(tasks.map((task: any) => task.result_path), cases.map(item => item.exposed ? resultPath : undefined));
});

test('spawn IDs support messaging after delayed registration and readiness refreshes safely', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-ready-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const processes = await listProcesses();
  const identity = (pid: number) => `agt_${createHash('sha256').update(JSON.stringify(['pi', pid, processes.get(pid)!.startedAt])).digest('hex').slice(0, 16)}`;
  const received: any[] = [];
  const listener = await startListener(message => received.push(message));
  const row = (pid: number, session: string) => ({ schemaVersion: 1, harness: 'pi', observedAt: Date.now(), process: { pid, startedAt: processes.get(pid)!.startedAt }, session: { id: session, mode: 'interactive' }, activity: { state: 'idle' }, messaging: { transport: 'unix', protocol: 'pi-listener-v2', path: listener.path, reportedAt: Date.now() } });
  const parent = row(process.pid, 'parent');
  const recipient = row(child.pid!, 'child');
  const health = () => writeFile(join(directory, 'registry-health.json'), JSON.stringify({ version: 1, state: 'running', updatedAt: Date.now(), lastSuccessfulProcessDiscoveryAt: Date.now() }));
  const publish = (rows: unknown[]) => writeFile(join(directory, 'agents.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await health();
  await publish([parent]);
  let task: Record<string, unknown> = { task_id: 'task_ready', agent_id: identity(child.pid!), status: 'idle', process_state: 'available', session_id: 'child' };
  let registration: Promise<void> | undefined;
  let delayedRegistration = true;
  const socket = createServer(connection => {
    connection.on('error', () => {});
    connection.once('data', data => {
      const request = JSON.parse(data.toString());
      if (request.action === 'spawn' && delayedRegistration) {
        registration = new Promise<void>(resolve => setTimeout(resolve, 150)).then(() => publish([parent, recipient]));
      }
      connection.end(JSON.stringify({ ok: true, data: request.action === 'list' ? { tasks: [task] } : task }) + '\n');
    });
  });
  await new Promise<void>(resolve => socket.listen(join(directory, 'spawner.sock'), resolve));
  const server = createAgentsServer({ registryDirectory: directory, spawnerDirectory: directory, callerAgentId: identity(process.pid) });
  const client = new Client({ name: 'readiness-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => {
    await registration;
    await client.close(); await server.close(); await listener.close();
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill(); await exited;
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, undefined);
    assert.deepEqual(JSON.parse((response.content as any)[0].text), response.structuredContent);
    return response.structuredContent as any;
  };
  const spawned = await call('spawn_agent', { harness: 'pi' });
  assert.equal(spawned.agent_id, identity(child.pid!));
  assert.equal(spawned.can_receive_messages, true);
  const listing = await call('list_agents');
  assert.equal(listing.agents.find((agent: any) => agent.session_id === 'child').agent_id, spawned.agent_id);
  assert.equal((await call('send_message', { agent_id: spawned.agent_id, message: 'Follow up' })).status, 'accepted');
  assert.equal(received.length, 1);

  const check = () => call('agent_task', { task_id: task.task_id, action: 'check' });
  const listedTask = async () => (await call('list_agent_tasks')).tasks[0];
  assert.equal((await listedTask()).can_receive_messages, true);
  delayedRegistration = false;
  await publish([parent]);
  const unregistered = await call('spawn_agent', { harness: 'pi' });
  assert.equal(unregistered.agent_id, spawned.agent_id);
  assert.equal(unregistered.can_receive_messages, false);
  await publish([parent, recipient]);
  assert.equal((await check()).can_receive_messages, true);
  await publish([parent, { ...recipient, messaging: { ...recipient.messaging, reportedAt: Date.now() - 30000 } }]);
  assert.equal((await check()).can_receive_messages, false);
  await publish([parent, { ...recipient, process: { ...recipient.process, startedAt: recipient.process.startedAt - 1000 } }]);
  assert.equal((await check()).can_receive_messages, false);
  task = { ...task, agent_id: `agt_${createHash('sha256').update(JSON.stringify(['pi', child.pid!, recipient.process.startedAt - 1000])).digest('hex').slice(0, 16)}` };
  assert.equal((await check()).can_receive_messages, false);
  task = { ...task, agent_id: identity(child.pid!), process_state: 'exited' };
  await publish([parent, recipient]);
  assert.equal((await check()).can_receive_messages, false);
  task = { ...task, agent_id: null, process_state: 'starting' };
  assert.equal((await check()).agent_id, null);
  assert.equal((await listedTask()).can_receive_messages, false);
  task = { ...task, agent_id: spawned.agent_id, process_state: 'available' };
  await writeFile(join(directory, 'registry-health.json'), '{}');
  assert.equal((await check()).can_receive_messages, false);
  assert.equal((await listedTask()).can_receive_messages, false);
});
