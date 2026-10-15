# agents-registry

Machine-local discovery and live snapshots for Pi and Claude agents.
Requires Node.js 22.18+ and npm on Linux or macOS.

From the repository root:

```bash
cd agent-hub
npm ci
npm run build
npm run cli:install --workspace @agent-hub/registry
```

With `~/.local/bin` on `PATH`:

```bash
agents-registry start --background --tmux-socket /absolute/path/to/tmux/socket
agents-registry status
agents-registry stop
```

Installation only creates a CLI symlink; it does not start the registry or install
an OS service. Supply tmux sockets explicitly; repeat the flag for multiple servers.

See the **[registry guide](../docs/registry.md)** for configuration, uninstall,
architecture, Claude/Pi publishers, schemas, and verification, or the
[documentation index](../docs/README.md) for related components.
