import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentTools } from './tools.js';
import type { MessagingOptions } from './messaging.js';

export function createAgentsServer(options: MessagingOptions = {}): McpServer {
  const server = new McpServer({ name: 'agents', version: '0.1.0' }, {
    instructions: 'Use list_agents to discover agent IDs and send_message to communicate. Pi spawn tools use a separately started agents-spawner supervisor. Task access belongs to this MCP session, but children and persisted results outlive its connection. Interactive children remain open in tmux after the initial task completes.',
  });
  registerAgentTools(server, options);
  return server;
}
