# agents MCP server

Backend-neutral MCP tools for discovering and messaging live agents
(`list_agents`, `send_message`) and managing Pi tasks (`spawn_agent`,
`list_agent_tasks`, `agent_task`). Requires Node.js 22.18+ and npm on macOS or Linux.

## Build and start the background service

Use a local checkout; no npm publishing, global CLI installation, or symlink
installation is required. From the repository root:

```bash
cd agent-hub
npm ci
npm run build
npm run cli:install
agent-hub start --background
agent-hub status
```

The [agent-hub service](../service/README.md) starts the registry and spawn
supervisor. Spawning requires tmux and Pi on the service's PATH (or configure
`--pi /absolute/path/to/pi`). For discovery and messaging without spawning,
start with `--registry-only` instead:

```bash
agent-hub start --background --registry-only
```

Nothing here installs OS startup
configuration; start the service again after a reboot.

The MCP client launches its own stdio server process, not the background service.
Keep the checkout in place and use its absolute path in client configuration.
Replace `/absolute/path/to/ibpme-agents-lab` below with your checkout location.
Launch `node` directly, not `npm start`: stdout is exclusively MCP JSON-RPC,
while diagnostics go to stderr. If Node is unavailable on the client's PATH,
use the absolute Node executable path from `command -v node`.

## Set up in Pi

For Pi versions with built-in MCP support, register the server at user scope:

```bash
pi mcp add agent-hub -- node /absolute/path/to/ibpme-agents-lab/agent-hub/mcp/dist/cli.js
pi mcp list
```

Add `--local` before the server name to register it only for the current project.
Alternatively, merge this entry into `~/.pi/agent/mcp.json` (user scope) or
`.pi/mcp.json` (project scope):

```json
{
  "mcpServers": {
    "agent-hub": {
      "command": "node",
      "args": [
        "/absolute/path/to/ibpme-agents-lab/agent-hub/mcp/dist/cli.js"
      ]
    }
  }
}
```

Project configuration requires Pi's project trust approval. Run `/reload` in an
existing session, then use `/mcp` to inspect or reconnect the server. Pi's default
MCP tool exposure is through codemode; a connected server's tools need not appear
as directly declared tools.

To let Pi receive messages and publish its session metadata, also install this
repository's Pi package:

```bash
pi install /absolute/path/to/ibpme-agents-lab/agent-hub/pi
```

Run `/reload` afterward. The package includes the message listener, registry
publisher, and `/agents` browser; configuring MCP alone does not install them.
See the [Pi setup guide](../docs/setup.md#install-the-pi-extensions) for details
and the browser's optional Bun requirement. The underlying Pi version must also
meet its own runtime requirements.

### Automatic spawn model routing

The supervisor/service can own model selection through `--routing-config PATH`.
When enabled, MCP discovers that policy and removes caller `model` selection;
task results report the selected profile and execution settings. An optional
`routing_hint` spawn argument provides advisory routing context (user preferences or
your task assessment) without changing the child prompt. Routing is
opt-in and configured separately from this MCP server. See
[routing setup and the prompt-based dry-run script](../docs/routing.md).

### Optional delegation context

Spawned children are not told the parent's agent ID by default. To enable parent
routing context and `send_message` guidance, add `"--inject-parent-context"` after
the CLI path in the MCP entry's `args` array, then reconnect the server:

```json
"args": [
  "/absolute/path/to/ibpme-agents-lab/agent-hub/mcp/dist/cli.js",
  "--inject-parent-context"
]
```

This is server configuration, not a tool argument, and affects only newly spawned
children. Omit the flag to retain current behavior. It does not register MCP tools
in the child or change automatic final-answer delivery. See the
[parent context documentation](../docs/mcp.md#optional-parent-context-in-spawned-children).

## Set up in Claude Code

Register the local stdio server at user scope:

```bash
claude mcp add --transport stdio --scope user agent-hub -- node /absolute/path/to/ibpme-agents-lab/agent-hub/mcp/dist/cli.js
claude mcp list
```

Use `--scope project` instead to write a shared project `.mcp.json`, or
`--scope local` for a private entry scoped to the current project. Absolute
checkout paths are machine-specific; adjust them before sharing project config.
Claude Code may request approval for project-scoped servers.

Start a new Claude Code session after registration and use `/mcp` to check the
connection and available tools. MCP registration exposes the tools; it does not
make Claude a Pi message-listener endpoint. Check `can_receive_messages` in
`list_agents` before choosing a message recipient.

## Shared runtime directories and verification

The service, MCP clients, and Pi extensions must use the same state directory:
`$AGENT_HUB_DIR`, otherwise `$XDG_STATE_HOME/agent-hub`, otherwise
`~/.local/state/agent-hub`. The registry lives in its `registry/` and the
spawner in its `spawner/` subdirectory.

Defaults work when all processes run as the same OS user with the same
environment. If the service uses custom data directories, set the corresponding
environment variables in each MCP entry's `env` object and in the Pi process
environment too. Setting the service's `--directory` changes only its control
state, not these registry/spawner data directories.

After connecting, ask the client to call `list_agents`. A successful MCP
connection alone does not prove the background service is running.
`REGISTRY_UNAVAILABLE` means the registry is missing, stopped, stale, or using a
different directory. An empty agent list can be valid. Sending requires a
registered caller; the stdio server identifies it through process ancestry, so
let each client launch its own server rather than detaching a shared one.

## Manual launch, updates, and shutdown

From `agent-hub/`:

```bash
node mcp/dist/cli.js                              # stdio
node mcp/dist/cli.js --deliver-as followUp         # fixed follow-up delivery
node mcp/dist/cli.js --transport http --port 3000  # loopback /mcp
```

Delivery mode is fixed at startup with `--deliver-as steer|followUp` (default
`steer`) for stdio and HTTP. `send_message` does not accept a delivery-mode argument.

After updating the checkout, run `npm ci` and `npm run build` from `agent-hub/`,
then reconnect/restart MCP clients. Restart the background service as well when
updating its code:

```bash
agent-hub stop
agent-hub start --background
```

Disconnecting an MCP client stops its stdio server, not the background service.
Messaging is trusted, same-OS-user only—not an authenticated cross-user service.

See the **[MCP guide](../docs/mcp.md)** for identity, sender identification,
protocol, errors, security, and development checks.
