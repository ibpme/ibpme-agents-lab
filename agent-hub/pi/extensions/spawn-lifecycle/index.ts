import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

interface State {
  sessionId?: string;
  phase: 'pending' | 'running' | 'done';
  started?: boolean;
  text?: string;
  stopReason?: string;
  error?: string;
}
// The directory is a private, supervisor-created durable mailbox, not model input.
export default function spawnLifecycle(pi: ExtensionAPI): void {
  const directory = process.env.AGENT_HUB_SPAWN_DIR;
  if (!directory || !isAbsolute(directory)) return;
  const task = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8')) as {
    input: { prompt?: string; mode: string };
  };
  function readState(): State {
    const path = join(directory!, 'lifecycle.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { phase: 'pending' };
  }
  function write(name: string, value: unknown): void {
    const path = join(directory!, name);
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, path);
  }
  let state = readState();
  let context: ExtensionContext | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let initial: ReturnType<typeof setTimeout> | undefined;
  let idleCheck: ReturnType<typeof setTimeout> | undefined;
  function persist() { write('lifecycle.json', state); }
  function finish(status: 'completed' | 'failed' | 'cancelled' | 'interrupted', error?: string): void {
    if (state.phase === 'done') return;
    // The completion artifact is authoritative across extension reloads and daemon restarts.
    write('completion.json', { status, text: state.text ?? '', stopReason: state.stopReason, error: error ?? state.error });
    state.phase = 'done';
    persist();
    if (task.input.mode === 'headless') context?.shutdown();
  }
  pi.on('session_start', (_event, ctx) => {
    context = ctx;
    state = readState();
    if (existsSync(join(directory, 'completion.json'))) state.phase = 'done';
    const sessionId = ctx.sessionManager.getSessionId();
    if (state.sessionId && state.sessionId !== sessionId && state.phase !== 'done') {
      finish('interrupted', 'Child changed session before the delegated task settled');
    }
    state.sessionId ??= sessionId;
    persist();
    write('ready.json', { pid: process.pid, sessionId: state.sessionId });
    if (!task.input.prompt) { state.phase = 'done'; persist(); return; }
    if (state.phase === 'pending') {
      // Defer until startup dispatch finishes; do not re-submit on /reload.
      initial = setTimeout(() => {
        state.phase = 'running';
        persist();
        try {
          pi.sendUserMessage(task.input.prompt!, { deliverAs: 'steer', expandPromptTemplates: false });
          idleCheck = setTimeout(() => {
            if (state.phase === 'running' && !state.started && ctx.isIdle()) finish('failed', 'Initial prompt was handled without starting an agent run');
          }, 5000);
          idleCheck.unref();
        } catch (error) { finish('failed', error instanceof Error ? error.message : String(error)); }
      }, 0);
    }
    if (poll) clearInterval(poll);
    poll = setInterval(() => {
      if (state.phase !== 'done' && existsSync(join(directory, 'cancel.json'))) {
        if (ctx.isIdle()) finish('cancelled'); else ctx.abort();
      }
    }, 250);
    poll.unref();
  });
  pi.on('agent_start', () => {
    if (state.phase === 'running') { state.started = true; persist(); }
  });
  pi.on('message_end', event => {
    if (state.phase !== 'running' || event.message.role !== 'assistant') return;
    const message = event.message;
    state.text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    state.stopReason = message.stopReason;
    state.error = message.errorMessage;
    persist();
  });
  pi.on('agent_settled', event => {
    if (state.phase !== 'running') return;
    const cancelled = event.aborted || existsSync(join(directory, 'cancel.json'));
    const failed = state.stopReason === 'error' || state.stopReason === 'length' || !state.started;
    finish(cancelled ? 'cancelled' : failed ? 'failed' : 'completed');
  });
  pi.on('session_shutdown', event => {
    if (initial) clearTimeout(initial);
    if (idleCheck) clearTimeout(idleCheck);
    if (poll) clearInterval(poll);
    if (event.reason !== 'reload' && state.phase !== 'done' && task.input.prompt) {
      finish('interrupted', `Child session ended (${event.reason}) before delegated task completion`);
    }
  });
}
