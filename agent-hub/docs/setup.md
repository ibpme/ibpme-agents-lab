# Setup

[Documentation index](README.md) · [Agent hub](../README.md)

Tooling for observing and messaging live coding agents on one machine. One
command, `agent-hub`, runs and manages everything except the MCP server.

| Directory | Purpose |
|---|---|
| `service/` | the `agent-hub` command; hosts the registry and spawn supervisor |
| `registry/` | daemon writing live agent snapshots (`agents.jsonl`) |
| `spawner/` | supervisor for background Pi TUIs and headless tasks |
| `viewer/` | terminal browser and tmux popup, run by `agent-hub view` |
| `pi/` | pi package: `/agents` browser, `message-listener` and `registry-publisher` extensions |
| `mcp/` | `agents-mcp`: MCP server (stdio and Streamable HTTP), set up separately |

Nothing here starts itself or installs OS services.

## Install the command

Requires Node.js 22.18+ and npm 10+ on Linux or macOS, and tmux for spawning
and popups. From the repository root:

```bash
cd agent-hub
npm ci
npm run build
npm run cli:install
```

`cli:install` creates `~/.local/bin/agent-hub` as a symlink to this checkout's
built CLI. Keep the checkout available and `~/.local/bin` on `PATH`. Re-running it
is safe; files or links belonging to another checkout are never overwritten.
`npm run cli:uninstall` removes only this checkout's link and keeps all state.

```bash
agent-hub help
agent-hub start --background
agent-hub status
agent-hub view
agent-hub stop
```

| Command | Purpose |
|---|---|
| `start`, `status`, `stop` | run the registry and spawn supervisor ([service](../service/README.md)) |
| `view` | browse live agents and transcripts ([viewer](../viewer/README.md)) |
| `publish` | send one registry publisher message from stdin ([registry](registry.md)) |
| `route validate`, `route test` | check model routing configuration ([routing](routing.md)) |
| `claude install`, `claude uninstall` | opt-in Claude Code hooks and status-line publisher ([registry](registry.md)) |

All state lives in `$AGENT_HUB_DIR`, otherwise `$XDG_STATE_HOME/agent-hub`,
otherwise `~/.local/state/agent-hub`. Processes started separately (Pi, MCP
clients, Claude hooks) must see the same `AGENT_HUB_DIR` when you override it.

## Install the pi extensions

```bash
pi install /absolute/path/to/ibpme-agents-lab/agent-hub/pi
```

`pi.extensions` in `pi/package.json` lists `agents`, `message-listener` and `registry-publisher`. The extensions
import declared `@agent-hub/registry` and `@agent-hub/viewer` APIs, so install from a
built checkout of this repository, not a copy of `pi/` alone. Use `pi remove` to uninstall.

Inside tmux, `/agents` opens the `agent-hub view` popup. Outside tmux, `/agents` keeps the native Pi overlay. See the
[viewer guide](../viewer/README.md) for a tmux keybinding.

## Install the MCP server

See the [MCP guide](mcp.md).

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
