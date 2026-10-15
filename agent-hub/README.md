# agent-hub

Observe and message live Pi and Claude coding agents on one machine.

| Component | Purpose | Guide |
|---|---|---|
| `registry/` | Discover agents and write live snapshots | [Registry](docs/registry.md) |
| `mcp/` | List and message agents through MCP | [MCP server](docs/mcp.md) |
| `pi/` | `/agents` browser, listener, and registry publisher | [Setup](docs/setup.md#install-the-pi-extensions) |

## Quick start

Requires Node.js 22+ and npm on Linux or macOS. From the repository root:

```bash
cd agent-hub/registry
npm ci
npm run build
npm run cli:install
```

With `~/.local/bin` on `PATH`, launch explicitly:

```bash
agents-registry start --background --tmux-socket /absolute/path/to/tmux/socket
agents-registry status
agents-registry stop
```

Nothing starts automatically; OS-managed services are not supported yet. Tmux
socket paths must be supplied explicitly. Repeat `--tmux-socket` for multiple servers.

See **[docs/](docs/README.md)** for installation, Pi setup, protocols, security,
architecture, and development checks.
