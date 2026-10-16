# Agent hub documentation

[Agent hub overview and quick start](../README.md)

| Guide | Contents |
|---|---|
| [Setup and development](setup.md) | The `agent-hub` command, component overview, Pi package installation, development commands |
| [Workspace conventions](workspace.md) | Package APIs, dependency boundaries, runtime profiles, and root checks |
| [Service](../service/README.md) | Shared lifecycle, configuration, state directory, tmux defaults, and registry-only mode |
| [Registry](registry.md) | Launch, tmux discovery, state, architecture, publishers, schemas, reader interface |
| [Agent spawner](spawner.md) | Background Pi TUIs, completion capture and automatic parent delivery |
| [MCP server](mcp.md) | Launch, agent identity, sender identification, tools, message envelope, errors, security |
| [Pi agent browser](agents-pi.md) | Setup, controls, listener indicators, transcript preview, freshness, pane actions, checks |
| [Pi message listener](message-listener.md) | Controls, v2 protocol, ACKs, retries, socket security, registry and MCP integration |

Registry, MCP, and Pi consumers must use the same `AGENT_HUB_DIR`. Nothing
installs or starts automatically, and OS-managed services are not supported yet.
