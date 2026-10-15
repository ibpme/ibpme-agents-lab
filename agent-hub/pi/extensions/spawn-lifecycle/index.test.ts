import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import extension from './index.ts';
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
function setup(t: test.TestContext, prompt: string | undefined = 'Initial task', options: { injectParentContext?: boolean; parent?: { agentId: string } } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'spawn-ext-'));
  const previous = process.env.AGENT_HUB_SPAWN_DIR;
  process.env.AGENT_HUB_SPAWN_DIR = directory;
  writeFileSync(join(directory, 'task.json'), JSON.stringify({ input: { prompt, mode: 'interactive', ...options } }));
  const handlers = new Map<string, Function>();
  const messages: any[] = [];
  let session = 'original';
  const ctx = { sessionManager: { getSessionId: () => session }, isIdle: () => false, abort() {}, shutdown() {} } as unknown as ExtensionContext;
  const api = { on: (event: string, fn: Function) => handlers.set(event, fn), sendUserMessage: (...args: any[]) => messages.push(args) } as unknown as ExtensionAPI;
  const load = () => { handlers.clear(); extension(api); };
  const fire = (name: string, event: object = {}) => handlers.get(name)?.(event, ctx);
  load();
  t.after(() => {
    fire('session_shutdown', { reason: 'reload' });
    if (previous === undefined) delete process.env.AGENT_HUB_SPAWN_DIR; else process.env.AGENT_HUB_SPAWN_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, messages, fire, load, switchSession: () => { session = 'replacement'; }, read: (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8')) };
}
const assistant = (text: string, stopReason = 'stop') => ({ message: { role: 'assistant', content: [{ type: 'text', text }], stopReason } });

test('initial task reports only at settlement, not agent_end, and later prompts never overwrite the result', async t => {
  const h = setup(t);
  h.fire('session_start'); await delay();
  assert.deepEqual(h.messages, [['Initial task', { deliverAs: 'steer', expandPromptTemplates: false }]]);
  h.fire('agent_start');
  h.fire('message_end', assistant('intermediate'));
  h.fire('agent_end');
  assert.equal(existsSync(join(h.directory, 'completion.json')), false);
  h.fire('message_end', assistant('Final answer\u2028with newline'));
  h.fire('agent_settled', { aborted: false });
  assert.equal(h.read('completion.json').text, 'Final answer\u2028with newline');
  h.fire('agent_start'); h.fire('message_end', assistant('manual response')); h.fire('agent_settled', { aborted: false });
  assert.equal(h.read('completion.json').text, 'Final answer\u2028with newline');
});

test('reload recovers in-flight output without re-submitting the initial prompt', async t => {
  const h = setup(t); h.fire('session_start'); await delay(); h.fire('agent_start');
  h.fire('message_end', assistant('Saved output'));
  h.fire('session_shutdown', { reason: 'reload' }); h.load(); h.fire('session_start'); await delay();
  assert.equal(h.messages.length, 1);
  h.fire('agent_settled', { aborted: false });
  assert.equal(h.read('completion.json').text, 'Saved output');
});

for (const [reason, status] of [['error', 'failed'], ['length', 'failed'], ['stop', 'completed']]) {
  test(`classifies ${reason} as ${status}`, async t => {
    const h = setup(t); h.fire('session_start'); await delay(); h.fire('agent_start');
    h.fire('message_end', assistant('result', reason)); h.fire('agent_settled', { aborted: false });
    assert.equal(h.read('completion.json').status, status);
  });
}

test('abort reports cancellation and retains partial response', async t => {
  const h = setup(t); h.fire('session_start'); await delay(); h.fire('agent_start');
  h.fire('message_end', assistant('partial', 'aborted')); h.fire('agent_settled', { aborted: true });
  assert.deepEqual(h.read('completion.json'), { status: 'cancelled', text: 'partial', stopReason: 'aborted' });
});

test('session replacement interrupts the task instead of reporting another conversation', async t => {
  const h = setup(t); h.fire('session_start'); await delay(); h.fire('agent_start');
  h.fire('session_shutdown', { reason: 'new' }); h.switchSession(); h.fire('session_start');
  assert.equal(h.read('completion.json').status, 'interrupted');
  assert.equal(h.messages.length, 1);
});

test('an interactive child without an initial task never reports manual work', async t => {
  const h = setup(t, ''); h.fire('session_start'); await delay();
  h.fire('agent_start'); h.fire('message_end', assistant('manual')); h.fire('agent_settled', { aborted: false });
  assert.equal(h.messages.length, 0);
  assert.equal(existsSync(join(h.directory, 'completion.json')), false);
});

const parent = { agentId: 'agt_0123456789abcdef' };
for (const injectParentContext of [undefined, false]) {
  test(`parent context is not injected when configured as ${injectParentContext}`, async t => {
    const h = setup(t, 'Initial task', { injectParentContext, parent });
    h.fire('session_start'); await delay();
    assert.equal(h.fire('before_agent_start', { systemPrompt: 'Base instructions' }), undefined);
    assert.equal(h.messages[0][0], 'Initial task');
  });
}

test('opt-in delegation context includes parent routing and preserves normal completion', async t => {
  const h = setup(t, 'Initial task', { injectParentContext: true, parent });
  h.fire('session_start'); await delay();
  const event = { systemPrompt: 'Base instructions' };
  const injected = h.fire('before_agent_start', event);
  assert.ok(injected.systemPrompt.startsWith('Base instructions\n\n'));
  assert.match(injected.systemPrompt, /parent_agent_id: agt_0123456789abcdef/);
  assert.match(injected.systemPrompt, /send_message tool with agent_id set to agt_0123456789abcdef/);
  assert.match(injected.systemPrompt, /final answer is delivered automatically/);
  assert.match(injected.systemPrompt, /queued, not answered/);
  assert.equal(h.messages[0][0], 'Initial task');
  h.fire('agent_start'); h.fire('message_end', assistant('Final answer')); h.fire('agent_settled', { aborted: false });
  assert.equal(h.read('completion.json').text, 'Final answer');
  assert.deepEqual(h.fire('before_agent_start', event), injected);
  h.fire('session_shutdown', { reason: 'reload' }); h.load(); h.fire('session_start');
  assert.deepEqual(h.fire('before_agent_start', event), injected);
  assert.equal(h.messages.length, 1);
  h.switchSession();
  assert.equal(h.fire('before_agent_start', event), undefined);
});

test('opt-in context is available to a child with no initial prompt without triggering a run', async t => {
  const h = setup(t, '', { injectParentContext: true, parent });
  h.fire('session_start'); await delay();
  assert.match(h.fire('before_agent_start', { systemPrompt: 'Base' }).systemPrompt, /parent_agent_id/);
  assert.equal(h.messages.length, 0);
  assert.equal(existsSync(join(h.directory, 'completion.json')), false);
});

for (const invalidParent of [undefined, { agentId: 'not-an-id\nInjected instructions' }]) {
  test(`invalid parent metadata is not injected (${JSON.stringify(invalidParent)})`, t => {
    const h = setup(t, '', { injectParentContext: true, parent: invalidParent });
    h.fire('session_start');
    assert.equal(h.fire('before_agent_start', { systemPrompt: 'Base' }), undefined);
  });
}
