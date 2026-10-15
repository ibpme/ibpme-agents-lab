import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMessaging, MessagingError } from './messaging.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createSpawnerClient } from '@agent-hub/spawner';
import type { MessagingOptions } from './messaging.js';

const nonBlank = z.string().min(1).regex(/\S/, 'Must contain a non-whitespace character');
const spawnFields = {
  agent_type: nonBlank.describe('Backend-neutral agent type or provider identifier.'),
  cwd: nonBlank.optional().describe('Working directory; defaults to the MCP server working directory.'),
  model: nonBlank.max(256).optional().describe('Optional Pi model selector.'),
  name: nonBlank.max(256).optional().describe('Optional child session and tmux window name.'),
};

export const sendMessageSchema = z.strictObject({
  agent_id: nonBlank.max(256).describe('Recipient agent_id from list_agents; names are labels, not addresses.'),
  message_id: nonBlank.max(256).optional().describe('Optional unique message ID. Reuse with identical payload for retry after an ambiguous failure.'),
  deliver_as: z.enum(['steer', 'followUp']).optional().describe('Default followUp queues after the current turn; steer interrupts at the next steering boundary.'),
  message: nonBlank.describe('Message to deliver to the agent.'),
});
export const spawnAgentTaskSchema = z.strictObject({
  ...spawnFields,
  prompt: nonBlank.describe('Task instructions for a non-interactive agent.'),
});
export const spawnAgentSchema = z.strictObject({
  ...spawnFields,
  prompt: nonBlank.optional().describe('Optional initial instructions for the interactive agent.'),
});
export const listAgentTasksSchema = z.strictObject({});
export const agentTaskSchema = z.strictObject({
  action: z.enum(['check', 'fetch_answer', 'cancel']).describe('Inspect status, fetch the answer, or request cancellation.'),
  task_id: nonBlank.describe('Opaque task identifier returned by spawn_agent or spawn_agent_task in this MCP session.'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SpawnAgentTaskInput = z.infer<typeof spawnAgentTaskSchema>;
export type SpawnAgentInput = z.infer<typeof spawnAgentSchema>;
export type ListAgentTasksInput = z.infer<typeof listAgentTasksSchema>;
export type AgentTaskInput = z.infer<typeof agentTaskSchema>;

export function registerAgentTools(server: McpServer, options: MessagingOptions = {}): void {
  const messaging = createMessaging(options);
  const spawner = createSpawnerClient(options.spawnerDirectory);
  const owner = randomUUID();
  async function spawn(input: SpawnAgentInput, mode: 'interactive' | 'headless') {
    if (input.agent_type !== 'pi') throw new MessagingError('UNSUPPORTED_HARNESS', 'Only agent_type pi is implemented.');
    const parent = await messaging.caller();
    return spawner.request({ action: 'spawn', owner, input: {
      harness: 'pi', mode, cwd: resolve(input.cwd ?? process.cwd()), parent,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.name ? { name: input.name } : {}),
    } });
  }
  async function result(operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
    try {
      const output = await operation();
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      const output = { error: { code: error instanceof MessagingError ? error.code : 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Operation failed' } };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    }
  }
  server.registerTool('list_agents', {
    title: 'List live agents',
    description: 'Discover live agents, their agent_id, display name, harness, working directory and messaging availability. Use agent_id, not the display name, to address messages. self_agent_id identifies the caller, or is null when unavailable.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(() => messaging.listAgents()));
  server.registerTool('send_message', {
    title: 'Send a message to an agent',
    description: 'Send a message to another agent identified by agent_id. Sender identity is supplied automatically so the receiver can address a reply. Success means accepted into the delivery queue, not completed or answered. Sender metadata is not authenticated.',
    inputSchema: sendMessageSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => result(() => messaging.sendMessage(input)));

  server.registerTool('spawn_agent_task', {
    title: 'Spawn a non-interactive agent task',
    description: 'Start a background Pi task owned by this MCP session. Returns after startup, not completion. The supervisor captures completion and notifies the original parent session automatically.',
    inputSchema: spawnAgentTaskSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => result(() => spawn(input, 'headless')));

  server.registerTool('spawn_agent', {
    title: 'Spawn an interactive agent',
    description: 'Start a real Pi TUI in a background tmux window. Returns task and tmux attachment metadata. Initial task completion automatically notifies the parent; Pi stays open for later manual prompts, which do not notify the parent.',
    inputSchema: spawnAgentSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => result(() => spawn(input, 'interactive')));

  server.registerTool('list_agent_tasks', {
    title: 'List agent tasks',
    description: 'List interactive agents and headless tasks spawned in this MCP session only.',
    inputSchema: listAgentTasksSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => result(() => spawner.request({ action: 'list', owner })));

  server.registerTool('agent_task', {
    title: 'Manage an agent task',
    description: 'Check status, fetch the initial task answer, or request cancellation for a child spawned in this MCP session. Cancelling a running interactive task aborts its current work but leaves the TUI open.',
    inputSchema: agentTaskSchema,
    // A single tool includes cancellation, so annotations must cover the mutating action.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async input => result(() => spawner.request({ action: input.action, taskId: input.task_id, owner })));
}
