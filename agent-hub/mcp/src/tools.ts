import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMessaging, MessagingError } from './messaging.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createSpawnerClient } from '@agent-hub/spawner';
import type { MessagingOptions } from './messaging.js';

const nonBlank = z.string().min(1).regex(/\S/, 'Must contain a non-whitespace character');
const spawnFields = {
  harness: nonBlank.describe('Agent harness, currently pi.'),
  cwd: nonBlank.optional().describe('Working directory; defaults to the MCP server working directory.'),
  model: nonBlank.max(256).optional().describe('Optional Pi model selector.'),
  name: nonBlank.max(256).optional().describe('Optional agent name.'),
};

export const sendMessageSchema = z.strictObject({
  agent_id: nonBlank.max(256).describe('Recipient agent_id from spawn_agent or list_agents; names are labels, not addresses.'),
  message_id: nonBlank.max(256).optional().describe('Optional unique message ID. Reuse with identical payload for retry after an ambiguous failure.'),
  message: nonBlank.describe('Message to deliver to the agent.'),
});
export const spawnAgentSchema = z.strictObject({
  ...spawnFields,
  prompt: nonBlank.optional().describe('Optional initial task.'),
});
export const listAgentTasksSchema = z.strictObject({});
export const agentTaskSchema = z.strictObject({
  action: z.enum(['check', 'fetch_answer', 'cancel']).describe('Inspect status, fetch the answer, or request cancellation.'),
  task_id: nonBlank.describe('Task ID returned by spawn_agent in this MCP session.'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SpawnAgentInput = z.infer<typeof spawnAgentSchema>;
export type ListAgentTasksInput = z.infer<typeof listAgentTasksSchema>;
export type AgentTaskInput = z.infer<typeof agentTaskSchema>;

function taskResult(output: Record<string, unknown>): Record<string, unknown> {
  const { mode: _mode, tmux: _tmux, result_path: resultPath, ...result } = output;
  const failed = ['failed', 'interrupted', 'lost'].includes(String(output.status)) || output.delivery === 'unavailable';
  if (failed && typeof resultPath === 'string') result.result_path = resultPath;
  if (Array.isArray(result.tasks)) {
    result.tasks = result.tasks.map(task => taskResult(task));
  }
  return result;
}

export function registerAgentTools(server: McpServer, options: MessagingOptions = {}): void {
  if (options.injectParentContext !== undefined && typeof options.injectParentContext !== 'boolean') throw new Error('injectParentContext must be a boolean');
  const messaging = createMessaging(options);
  const spawner = createSpawnerClient(options.spawnerDirectory);
  const owner = randomUUID();
  async function taskOutput(output: Record<string, unknown>, waitForMessaging = false): Promise<Record<string, unknown>> {
    const tasks = Array.isArray(output.tasks) ? output.tasks as Record<string, unknown>[] : [output];
    const ids = tasks.filter(task => task.process_state === 'available' && typeof task.agent_id === 'string').map(task => task.agent_id as string);
    const deadline = Date.now() + (waitForMessaging ? 1000 : 0);
    let ready = new Set<string>();
    if (ids.length) {
      do {
        ready = await messaging.messagingReadiness(ids);
        if (ids.every(id => ready.has(id)) || Date.now() >= deadline) break;
        await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
      } while (true);
    }
    const enriched = tasks.map(task => ({ ...task, agent_id: task.agent_id ?? null, can_receive_messages: task.process_state === 'available' && typeof task.agent_id === 'string' && ready.has(task.agent_id) }));
    return Array.isArray(output.tasks) ? { ...output, tasks: enriched } : enriched[0]!;
  }
  async function spawn(input: SpawnAgentInput) {
    if (input.harness !== 'pi') throw new MessagingError('UNSUPPORTED_HARNESS', 'Only harness pi is implemented.');
    const parent = await messaging.caller();
    const output = await spawner.request({ action: 'spawn', owner, input: {
      harness: 'pi', mode: 'interactive', cwd: resolve(input.cwd ?? process.cwd()), parent,
      ...(options.injectParentContext === true ? { injectParentContext: true } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.name ? { name: input.name } : {}),
    } });
    return taskOutput(output, true);
  }
  async function result(operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
    try {
      const output = taskResult(await operation());
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      const output = { error: { code: error instanceof MessagingError ? error.code : 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Operation failed' } };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    }
  }
  server.registerTool('list_agents', {
    title: 'List live agents',
    description: 'List live agents and messaging availability. Address messages by agent_id, not name. self_agent_id identifies you when available.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(() => messaging.listAgents()));
  server.registerTool('send_message', {
    title: 'Send a message to an agent',
    description: 'Message an agent by agent_id. Sender identity is included but not authenticated. Success means queued, not answered.',
    inputSchema: sendMessageSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => result(() => messaging.sendMessage(input)));

  server.registerTool('spawn_agent', {
    title: 'Spawn an agent',
    description: 'Start an agent (the supervisor may automatically select its model and effort) and return task_id, agent_id, and can_receive_messages. If messaging is not ready, poll agent_task before sending. The initial task runs asynchronously and notifies you when it finishes.',
    inputSchema: options.routingEnabled ? spawnAgentSchema.omit({ model: true }) : spawnAgentSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => result(() => spawn(input)));

  server.registerTool('list_agent_tasks', {
    title: 'List agent tasks',
    description: 'List agent tasks created in this MCP session.',
    inputSchema: listAgentTasksSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(async () => taskOutput(await spawner.request({ action: 'list', owner }))));

  server.registerTool('agent_task', {
    title: 'Manage an agent task',
    description: 'Check status, fetch the initial task answer, or cancel current work for an agent task in this MCP session. Cancellation does not close the agent.',
    inputSchema: agentTaskSchema,
    // A single tool includes cancellation, so annotations must cover the mutating action.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async input => result(async () => taskOutput(await spawner.request({ action: input.action, taskId: input.task_id, owner }))));
}
