# agent-hub

[Documentation index](README.md) · [Agent hub](../README.md)

Setup examples start at the repository root. Run the development commands
independently from `agent-hub/`.

Tooling for observing and messaging live coding agents on one machine.

| Directory | Purpose |
|---|---|
| `registry/` | `agents-registry`: background daemon writing live agent snapshots (`agents.jsonl`) |
| `mcp/` | `agents-mcp`: MCP server (stdio and Streamable HTTP) for listing and messaging agents |
| `spawner/` | explicitly launched supervisor for background Pi TUIs and headless tasks |
| `pi/` | pi package: `/agents` browser, `message-listener` and `registry-publisher` extensions |
| `agents-browser/` | standalone TUI and tmux popup launcher |

Nothing here starts or installs itself. See the [registry](registry.md) and
[MCP](mcp.md) guides for their setup instructions.

## Install the pi extensions

```bash
(cd agent-hub/agents-browser && bun install) # shared browser dependencies
(cd agent-hub/pi && bun install)             # Pi dependencies and types
pi install /absolute/path/to/ibpme-agents-lab/agent-hub/pi
```

`pi.extensions` in `pi/package.json` lists `agents`, `message-listener` and `registry-publisher`. The extensions
import shared code from `../registry` and `../agents-browser`, so install from a
checkout of this repository, not a copy of `pi/` alone. Use `pi remove` to uninstall.

Inside tmux, `/agents` opens a standalone popup. Ensure Bun is on the PATH
inherited by Pi/tmux. See the
[standalone browser guide](../agents-browser/README.md) for shell usage and a tmux
keybinding. Run `bun run cli:install` from `agent-hub/agents-browser/` to install
`~/.local/bin/agents-browser`; `bun run cli:uninstall` removes this checkout's link.
Outside tmux, `/agents` keeps the native Pi overlay.

## Develop

```bash
cd registry && npm install && npm test
cd spawner && npm install && npm test
cd mcp && npm install && npm test
cd pi && bun install && bun run check
cd agents-browser && bun install && bun run check
```
