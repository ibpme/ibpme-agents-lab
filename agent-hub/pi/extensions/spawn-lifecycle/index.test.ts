import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import extension from './index.ts';
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
function setup(t: test.TestContext, prompt: string | undefined = 'Initial task') {
  const directory = mkdtempSync(join(tmpdir(), 'spawn-ext-'));
  const previous = process.env.AGENT_HUB_SPAWN_DIR;
  process.env.AGENT_HUB_SPAWN_DIR = directory;
  writeFileSync(join(directory, 'task.json'), JSON.stringify({ input: { prompt, mode: 'interactive' } }));
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
  assert.deepEqual(h.messages, [['Initial task', { deliverAs: 'followUp', expandPromptTemplates: false }]]);
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
