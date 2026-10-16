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
// The private mailbox provides task state and optional delegation context.
export default function spawnLifecycle(pi: ExtensionAPI): void {
  const directory = process.env.AGENT_HUB_SPAWN_DIR;
  if (!directory || !isAbsolute(directory)) return;
  const task = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8')) as {
    execution?: { append_system_prompt?: string };
    input: { prompt?: string; mode: string; injectParentContext?: boolean; parent?: { agentId?: string } };
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
  let active = false;
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
    active = true;
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
    if (poll) clearInterval(poll);
    poll = setInterval(() => {
      if (state.phase !== 'done' && existsSync(join(directory, 'cancel.json'))) {
        if (ctx.isIdle()) finish('cancelled'); else ctx.abort();
      }
    }, 250);
    poll.unref();
  });
  // Wait until MCP startup initializes its readiness checks; early prompts can change the
  // tool list mid-run and invalidate Anthropic thinking signatures on continuation.
  pi.on('resources_discover', (_event, ctx) => {
    if (!active || !task.input.prompt || state.phase !== 'pending' || initial !== undefined) return;
    if (ctx.sessionManager.getSessionId() !== state.sessionId) return;
    // Resource discovery follows all session_start handlers, so MCP's readiness hook is initialized.
    initial = setTimeout(() => {
      initial = undefined;
      if (!active || state.phase !== 'pending') return;
      if (existsSync(join(directory, 'cancel.json'))) { finish('cancelled'); return; }
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
  });
  const promptAdditions: string[] = [];
  if (task.execution?.append_system_prompt?.trim()) promptAdditions.push(task.execution.append_system_prompt);
  if (task.input.injectParentContext === true && /^agt_[0-9a-f]{16}$/.test(task.input.parent?.agentId ?? '')) {
    const parentAgentId = task.input.parent!.agentId!;
    promptAdditions.push(`## Delegation context\nparent_agent_id: ${parentAgentId}\nYou were spawned by this parent agent. If you need clarification or must report a blocker, use the agent-hub MCP send_message tool with agent_id set to ${parentAgentId} and message set to your question or update. Discover the tool through the available MCP tool discovery mechanism if it is not directly exposed. If the tool is unavailable or delivery fails, explain the limitation rather than claiming the parent was notified. A successful send means queued, not answered; do not assume a reply. Your initial task's final answer is delivered automatically to the parent, so do not send a duplicate completion message.`);
  }
  if (promptAdditions.length) {
    pi.on('before_agent_start', (event, ctx) => {
      if (!state.sessionId || ctx.sessionManager.getSessionId() !== state.sessionId) return;
      return { systemPrompt: [event.systemPrompt, ...promptAdditions].join('\n\n') };
    });
  }
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
    active = false;
    if (initial !== undefined) clearTimeout(initial);
    initial = undefined;
    if (idleCheck) clearTimeout(idleCheck);
    if (poll) clearInterval(poll);
    if (event.reason !== 'reload' && state.phase !== 'done' && task.input.prompt) {
      finish('interrupted', `Child session ended (${event.reason}) before delegated task completion`);
    }
  });
}
