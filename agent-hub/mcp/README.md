# agents MCP server

Backend-neutral MCP tools for listing and messaging live agents:
`list_agents` and `send_message`. Requires Node.js 22+ and npm.

From this directory:

```bash
npm ci
npm run build
node dist/cli.js                              # stdio
# Or: node dist/cli.js --transport http --port 3000
```

Start the [registry](../registry/README.md) separately and use the same runtime
directory. Stdout is exclusively MCP JSON-RPC; diagnostics go to stderr.
Messaging is trusted, same-OS-user only—not an authenticated cross-user service.

See the **[MCP guide](../docs/mcp.md)** for identity, sender identification,
protocol, errors, security, and development checks.
