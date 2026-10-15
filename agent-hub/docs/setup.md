# agent-hub

[Documentation index](README.md) · [Agent hub](../README.md)

Setup examples start at the repository root. Run the development commands
independently from `agent-hub/`.

Tooling for observing and messaging live coding agents on one machine.

| Directory | Purpose |
|---|---|
| `registry/` | `agents-registry`: background daemon writing live agent snapshots (`agents.jsonl`) |
| `mcp/` | `agents-mcp`: MCP server (stdio and Streamable HTTP) for listing and messaging agents |
| `pi/` | pi package: `/agents` browser, `message-listener` and `registry-publisher` extensions |

Nothing here starts or installs itself. See the [registry](registry.md) and
[MCP](mcp.md) guides for their setup instructions.

## Install the pi extensions

```bash
cd agent-hub/pi && bun install     # dependencies (ajv, pi types)
pi install /absolute/path/to/ibpme-agents-lab/agent-hub/pi
```

`pi.extensions` in `pi/package.json` lists `agents`, `message-listener` and `registry-publisher`. The extensions
import types and discovery code from `../registry`, so install from a checkout of this repository, not a copy of
`pi/` alone. Use `pi remove` to uninstall.

## Develop

```bash
cd registry && npm install && npm test
cd mcp && npm install && npm test
cd pi && bun install && bun run check
```
