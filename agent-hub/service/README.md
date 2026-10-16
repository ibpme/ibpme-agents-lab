# agent-hub service

The `agent-hub` command. Its `start` runs one explicitly started, same-user process
hosting the registry and spawn supervisor.
Their agent and task models, transports, and persistence remain separate. Registry
snapshots are rebuilt from live observations; durable task artifacts survive
process exit and service restarts.

## Install and run

Requires Node.js 22.18+, npm 10+, and tmux (unless using `--registry-only`).
Run from `agent-hub/`:

```sh
npm ci
npm run cli:install
agent-hub start --background
agent-hub status
agent-hub stop
```

Without `--background`, start runs in the foreground. SIGINT/SIGTERM stop both
modules gracefully. Nothing installs OS startup configuration or Pi extensions.
Install the [Pi listener and publisher](../docs/setup.md) for parent completion
delivery. The other subcommands (`view`, `publish`, `route`, `claude`) are listed
by `agent-hub help` and described in [setup](../docs/setup.md).

Inside tmux, spawning uses the current server/session. Outside tmux, a dedicated
server/session is created. The registry automatically watches the selected socket.
Repeat `--tmux-socket /absolute/path` for additional discovery servers; the first
selects the spawning server. `--tmux-session NAME` selects the spawning session.
Stopping leaves tmux and child agents running. Restarting reconciles persisted
tasks and pending completion delivery, without re-running initial prompts.

## Shared configuration

All state lives in one directory: `$AGENT_HUB_DIR`, then
`$XDG_STATE_HOME/agent-hub`, then `~/.local/state/agent-hub`.
`--directory PATH` overrides it. An optional `config.json` there configures startup:

```json
{
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
The corresponding CLI flags are `--interval`, `--activity-ttl`, repeated `--tmux-socket`, `--tmux-session`, `--pi`,
and `--registry-only`. `--recover-lock` explicitly permits stale supervisor-lock
recovery after verifying that its recorded process lifetime is no longer alive;
it is deliberately not a persistent configuration key. Registry and hub writer
leases can take 30 seconds to expire after a hard crash.

```text
~/.local/state/agent-hub/
├── hub.sock, hub.lock/   control transport and ownership lease
├── config.json           optional startup defaults
├── daemon.log            background output
├── registry/             registry snapshots, health and socket
└── spawner/              supervisor socket, lock and task artifacts
```

If you start the hub with `--directory`, set `AGENT_HUB_DIR` to the same path for
separately started Pi, MCP, and viewer processes. Spawned children inherit it
automatically. Status reports the effective configuration, selected tmux
server/session, and registry health. Changes require stop/start; no hot reload.
Logs and completed task artifacts currently have no automatic retention policy.

## Ownership

Concurrent ownership of the same state directory is refused rather than silently
adopted. An already-running background hub is reported without launching another
writer. A registry `stop` request sent to the hub-owned registry stops the whole hub.

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

## Optional spawn model routing

Pass `--routing-config /absolute/path/to/routing.json` to `agent-hub start`
(or add `routingConfigPath` to the service configuration file). The supervisor
uses Jev System One to select a configured Pi provider/model/effort profile,
with optional profile system instructions and a default fallback. Routing is
opt-in and overrides caller model selection when enabled. Export
`TYPESAFE_API_KEY` in the service's environment before starting it.

See [routing configuration and the prompt-based test script](../docs/routing.md).
Relative file-config paths resolve against the state directory; CLI
paths resolve against the current working directory. Restart the service and
reconnect MCP sessions after changing routing policy.
