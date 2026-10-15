import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentTools } from './tools.js';
import type { MessagingOptions } from './messaging.js';

export function createAgentsServer(options: MessagingOptions = {}): McpServer {
  const server = new McpServer({ name: 'agents', version: '0.1.0' }, {
    instructions: 'Use list_agents to discover agents and send_message to communicate. Spawned task access is scoped to this MCP session; agents and results persist after disconnect.',
  });
  registerAgentTools(server, options);
  return server;
}
