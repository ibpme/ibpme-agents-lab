# Unified agent-hub service

One explicitly started, same-user process hosts the registry and spawn supervisor.
Their agent and task models, transports, and persistence remain separate. Registry
snapshots are rebuilt from live observations; durable task artifacts survive
process exit and service restarts.

## Install and run

Requires Node.js 22.18+, npm 10+, and tmux (unless using `--registry-only`).
Run from `agent-hub/`:

```sh
npm ci
npm run build
npm run cli:install --workspace @agent-hub/service
agent-hub start --background
agent-hub status
agent-hub stop
```

Without `--background`, start runs in the foreground. SIGINT/SIGTERM stop both
modules gracefully. Nothing installs OS startup configuration or Pi extensions.
Install the [Pi listener and publisher](../docs/setup.md) for parent completion
delivery. The existing MCP tools and viewer need no protocol changes.

Inside tmux, spawning uses the current server/session. Outside tmux, a dedicated
server/session is created. The registry automatically watches the selected socket.
Repeat `--tmux-socket /absolute/path` for additional discovery servers; the first
selects the spawning server. `--tmux-session NAME` selects the spawning session.
Stopping leaves tmux and child agents running. Restarting reconciles persisted
tasks and pending completion delivery, without re-running initial prompts.

## Shared configuration

The control directory defaults to `$AGENT_HUB_DIR`, then
`$XDG_STATE_HOME/agent-hub`, then `~/.local/state/agent-hub`.
`--directory PATH` overrides it. An optional `config.json` there configures startup:

```json
{
  "registryDirectory": "/absolute/path/to/registry",
  "spawnerDirectory": "/absolute/path/to/spawner",
  "intervalMs": 5000,
  "activityTtlMs": 20000,
  "tmuxServers": ["/absolute/path/to/tmux.sock"],
  "tmuxSession": "agents",
  "pi": "/absolute/path/to/pi",
  "registryOnly": false
}
```

All keys are optional. CLI flags override file values. Unknown keys and invalid
values fail startup. Interval/TTL values must be integers from 100 to 2147483647.
The corresponding CLI flags are `--registry-directory`, `--spawner-directory`,
`--interval`, `--activity-ttl`, repeated `--tmux-socket`, `--tmux-session`, `--pi`,
and `--registry-only`. `--recover-lock` explicitly permits stale supervisor-lock
recovery after verifying that its recorded process lifetime is no longer alive;
it is deliberately not a persistent configuration key. Registry and hub writer
leases can take 30 seconds to expire after a hard crash.

**Existing data paths remain the defaults:** registry uses `$AGENTS_REGISTRY_DIR`
or the XDG `agents-registry` directory; supervisor uses `$AGENTS_SPAWNER_DIR` or
the XDG `agents-spawner` directory. Setting `--directory` changes only hub control
state, not those data locations. The private control directory contains
`hub.sock`, `hub.lock/`, and, for background launches, `daemon.log`.

If you override data directories in hub configuration, configure your separately
started Pi, MCP, and viewer processes with matching `AGENTS_REGISTRY_DIR` and
`AGENTS_SPAWNER_DIR`. Spawned children automatically inherit the configured
registry directory. Status reports the effective configuration, selected tmux
server/session, and registry health. Changes require stop/start; no hot reload.
Logs and completed task artifacts currently have no automatic retention policy.

## Migration and ownership

Stop any independently running `agents-registry` and `agent-spawn` instances before
starting the hub against their directories. No data migration is required. Existing
CLI commands remain available for standalone/development use, but concurrent
ownership of the same data directories is refused rather than silently adopted.
An already-running background hub is reported without launching another writer.
A legacy `agents-registry stop` against the hub-owned registry stops the whole hub.

Registry-only mode disables spawning and does not require tmux setup. The registry
can still discover manually launched Pi and Claude processes. It only scans tmux
servers explicitly configured in this mode.

Startup failure rolls back modules already started. Shutdown drains the supervisor
before stopping registry discovery/routing. Both modules share a process failure
boundary, but retain independent ownership locks and persistence. The service is
trusted same-OS-user orchestration, not a sandbox or a cross-user API. Do not expose
its sockets to untrusted clients.

Uninstall just this checkout's CLI link with:

```sh
npm run cli:uninstall --workspace @agent-hub/service
```

This does not stop a running service or delete state.
