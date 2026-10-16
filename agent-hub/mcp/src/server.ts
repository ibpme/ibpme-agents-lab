import { createSpawnerClient } from '@agent-hub/spawner';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentTools } from './tools.ts';
import type { MessagingOptions } from './messaging.ts';

export function createAgentsServer(options: MessagingOptions = {}): McpServer {
  const server = new McpServer({ name: 'agents', version: '0.1.0' }, {
    instructions: 'Use list_agents to discover agents and send_message to communicate. Spawned task access is scoped to this MCP session; agents and results persist after disconnect.',
  });
  registerAgentTools(server, options);
  return server;
}

// Resolve the supervisor policy before publishing tool schemas. The supervisor
// remains authoritative if it restarts with a different policy mid-session.
export async function createConfiguredAgentsServer(options: MessagingOptions = {}): Promise<McpServer> {
  let routingEnabled = false;
  try {
    const policy = await createSpawnerClient(options.spawnerDirectory).request({ action: 'capabilities', owner: 'mcp-policy' }, 1000);
    routingEnabled = policy.routing_enabled === true;
  } catch {
    // Discovery and messaging remain usable without a running supervisor.
  }
  return createAgentsServer({ ...options, routingEnabled });
}
