# agent-hub

Observe and message live Pi and Claude coding agents on one machine.

| Component | Purpose | Guide |
|---|---|---|
| `service/` | The `agent-hub` command: lifecycle, viewer, publishing, routing and Claude setup | [Service](service/README.md) |
| `registry/` | Discover agents and write live snapshots | [Registry](docs/registry.md) |
| `mcp/` | Discover, message and spawn agents through MCP | [MCP server](docs/mcp.md) |
| `spawner/` | Supervise background Pi TUIs and headless tasks | [Spawner](spawner/README.md) |
| `pi/` | `/agents` browser, listener, and registry publisher | [Setup](docs/setup.md#install-the-pi-extensions) |
| `viewer/` | Terminal browser and tmux popup (`agent-hub view`) | [Viewer](viewer/README.md) |

## Quick start

Requires Node.js 22.18+ and npm 10+ on Linux or macOS. From the repository root:

```bash
cd agent-hub
npm ci
npm run cli:install
```

With `~/.local/bin` on `PATH`, launch explicitly:

```bash
agent-hub help
agent-hub start --background
agent-hub status
agent-hub view
agent-hub stop
```

All state lives in `AGENT_HUB_DIR` (default `~/.local/state/agent-hub`). The MCP
server is set up separately; see the [MCP guide](docs/mcp.md).

Nothing starts automatically; OS-managed services are not installed. The unified
service uses the current tmux server/session, or creates a dedicated one outside
tmux. The registry watches that server automatically. Repeat `--tmux-socket` to
watch additional servers; the first selects the spawning server.

## Picking up changes

`agent-hub` links to this checkout and Node runs its TypeScript source directly,
so there is no build step and `cli:install` never needs re-running. Edits apply
to the next command, `agent-hub view`, hook or status-line call. Long-running
processes keep the code they started with: restart the hub
(`agent-hub stop && agent-hub start --background`), `/reload` pi, and reconnect
MCP clients. After `git pull`, run `npm ci` if dependencies changed.

See **[docs/](docs/README.md)** for installation, Pi setup, protocols, security,
architecture, and development checks.

## Workspace development

`agent-hub/` is a private npm workspace with one root lockfile. Install
dependencies here, not separately in each component. Package names consistently
use the `@agent-hub/` scope. `agent-hub` (in `service/`) and `agents-mcp` (in
`mcp/`) are the only commands.

```bash
cd agent-hub
npm ci
npm run typecheck   # checks every package and its tests
npm test            # boundary and package tests
npm run check       # typecheck and tests
```

Target individual packages with, for example,
`npm test --workspace @agent-hub/mcp`. See [workspace conventions](docs/workspace.md)
for exports, dependency boundaries, and runtime-specific TypeScript settings.
