# agent-hub

Observe and message live Pi and Claude coding agents on one machine.

| Component | Purpose | Guide |
|---|---|---|
| `service/` | Unified registry + supervisor lifecycle and configuration | [Service](service/README.md) |
| `registry/` | Discover agents and write live snapshots | [Registry](docs/registry.md) |
| `mcp/` | Discover, message and spawn agents through MCP | [MCP server](docs/mcp.md) |
| `spawner/` | Supervise background Pi TUIs and headless tasks | [Spawner](spawner/README.md) |
| `pi/` | `/agents` browser, listener, and registry publisher | [Setup](docs/setup.md#install-the-pi-extensions) |
| `viewer/` | Standalone terminal browser and tmux popup launcher | [Setup](viewer/README.md) |

## Quick start

Requires Node.js 22.18+ and npm 10+ on Linux or macOS. The browser and
Pi tmux popups additionally require Bun 1.3+ on PATH. From the repository root:

```bash
cd agent-hub
npm ci
npm run build
npm run cli:install --workspace @agent-hub/service
```

With `~/.local/bin` on `PATH`, launch explicitly:

```bash
agent-hub start --background
agent-hub status
agent-hub stop
```

Nothing starts automatically; OS-managed services are not installed. The unified
service uses the current tmux server/session, or creates a dedicated one outside
tmux. The registry watches that server automatically. Repeat `--tmux-socket` to
watch additional servers; the first selects the spawning server.

See **[docs/](docs/README.md)** for installation, Pi setup, protocols, security,
architecture, and development checks.

## Workspace development

`agent-hub/` is a private npm workspace with one root lockfile. Install
dependencies here, not separately in each component. Package names consistently
use the `@agent-hub/` scope; the standalone viewer lives in `viewer/` and runs
as `agents-viewer`.

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
