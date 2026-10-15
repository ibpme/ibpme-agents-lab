# agent-hub

[Documentation index](README.md) · [Agent hub](../README.md)

Setup examples start at the repository root. Run workspace development commands
from `agent-hub/`.

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
(cd agent-hub && npm ci && npm run build)
pi install /absolute/path/to/ibpme-agents-lab/agent-hub/pi
```

`pi.extensions` in `pi/package.json` lists `agents`, `message-listener` and `registry-publisher`. The extensions
import declared `@agent-hub/registry` and `@agent-hub/browser` APIs, so install from a
checkout of this repository, not a copy of `pi/` alone. Use `pi remove` to uninstall.

Inside tmux, `/agents` opens a standalone popup. Ensure Bun is on the PATH
inherited by Pi/tmux. See the
[standalone browser guide](../agents-browser/README.md) for shell usage and a tmux
keybinding. Run `npm run cli:install` from `agent-hub/agents-browser/` to install
`~/.local/bin/agents-browser`; `npm run cli:uninstall` removes this checkout's link.
Outside tmux, `/agents` keeps the native Pi overlay.

## Develop

```bash
cd agent-hub
npm ci
npm run check

# After building prerequisites, target one component:
npm test --workspace @agent-hub/mcp
npm run typecheck --workspace @agent-hub/pi
```

See [workspace conventions](workspace.md) for package APIs and build ordering.
