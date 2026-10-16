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
npm run build
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

`agent-hub` links to this checkout, so `cli:install` never needs re-running.
Source edits take effect as follows:

| Edited | Takes effect |
|---|---|
| `service/`, `registry/`, `spawner/`, `mcp/` | after `npm run build` |
| `viewer/` | next `agent-hub view` or `/agents` |
| `pi/` extensions | after `/reload` in pi |
| `registry/publishers/claude/` | next hook or status-line call |

The viewer, pi extensions and Claude publishers import the registry's built
`dist/`, so registry changes reach them only after a build. After building,
restart a running hub (`agent-hub stop && agent-hub start --background`) and
reconnect MCP clients. After `git pull`, run `npm ci` if dependencies changed,
then `npm run build`.

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
npm run build       # compiled packages, in dependency order
npm run typecheck   # builds prerequisites, then checks every package and tests
npm test            # builds prerequisites, then runs boundary and package tests
npm run check       # typecheck and tests
```

After the root build, target individual packages with, for example,
`npm test --workspace @agent-hub/mcp`. See [workspace conventions](docs/workspace.md)
for exports, dependency boundaries, and runtime-specific TypeScript settings.
