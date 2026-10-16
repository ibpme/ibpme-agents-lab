# Agent spawner

A same-user supervisor for background Pi children, run inside the
[agent-hub service](../service/README.md). Interactive children are **real Pi TUIs
in detached tmux windows**, not RPC clients or terminal emulations. Headless
children use RPC with a detached pipe owner. Both run the same harness-side
lifecycle extension; the model never has to call `send_message` to report
completion.

## Optional model routing

Use `agent-hub start --routing-config /absolute/path/to/routing.json` (or
`routingConfigPath` in the hub's `config.json`) to enable supervisor-owned
Jev System One profile routing. Profiles choose Pi provider/model/effort and can
append system instructions. Routing is authoritative when enabled and falls
back to a configured default when classification fails. No configuration means
existing behavior is unchanged.

See [routing configuration and prompt testing](../docs/routing.md) and the
[example configuration](examples/routing.json). Test without spawning an agent:

```bash
agent-hub route test --config /path/to/routing.json --prompt 'Your delegated task'
agent-hub route validate --config /path/to/routing.json
```

## Start

Requires Node.js 22.18+, Pi 1.1+ (`agent_settled` support), and tmux for interactive
children. Install from this repository checkout (see [setup](../docs/setup.md));
the supervisor explicitly loads the `@agent-hub/pi/spawn-lifecycle` package export.
It is not a globally installed extension.

```sh
# Inside tmux: use the current server and session.
# Outside tmux: create or reuse a dedicated server and session.
agent-hub start --background

# Override either or both defaults.
agent-hub start --background --tmux-socket /absolute/path/to/tmux.sock --tmux-session agents
```

Nothing starts automatically. `--pi /path/to/pi` overrides the executable;
otherwise `pi` is found using the hub's PATH. The child inherits normal Pi
configuration, credentials, tools and trust behavior. This does **not**
automatically approve project configuration or bypass prompts.

The hub infers the socket from `$TMUX` and detects the current session using
`$TMUX_PANE` when available. Outside tmux, it creates or reuses a server at
`<state-directory>/spawner/tmux.sock` with session `agent-hub`. `--tmux-socket` and
`--tmux-session` override their respective defaults; a different socket defaults
to session `agent-hub` rather than inheriting a session from the original server.
Missing sessions are created detached. Stopping the hub leaves the tmux
server/session and children running. Attach with
`tmux -S <socket> attach-session -t <session>`.

The programmatic supervisor API still supports headless-only operation without
tmux options; automatic tmux setup is performed only by the hub.

The registry and parent Pi listener must also be running for automatic completion
delivery. Install/reload the updated listener: it must support `expectedSessionId`.
See [setup](../docs/setup.md) and [registry](../docs/registry.md).

### Runtime locations

The supervisor and MCP clients use `spawner/` inside `$AGENT_HUB_DIR`, otherwise
`$XDG_STATE_HOME/agent-hub`, otherwise `~/.local/state/agent-hub`. When the hub
runs with `--directory PATH`, set `AGENT_HUB_DIR` to that same path in MCP clients. Unix socket paths must be at most 100 bytes.

Each `tasks/task_<uuid>/` directory contains:

- `task.json`: task input, original parent identity/session, execution and delivery state;
- `ready.json`: Pi PID and delegated session ID;
- `lifecycle.json`: extension state, recoverable across `/reload`;
- `completion.json`: full final text, stop reason, outcome, and any error;
- `cancel.json`: optional cancellation request;
- `sessions/`: persistent Pi session files;
- `launch.sh`: interactive launch command, or `stderr.log` for headless startup diagnostics.

Directories/files are created private to the OS user. Treat all artifacts as
sensitive: prompts and responses may contain credentials or proprietary code.
There is no automatic retention cleanup; remove completed artifacts yourself only
when their child is no longer in use.

## MCP tools

The existing tools now use this supervisor:

```json
{"name":"spawn_agent","arguments":{"harness":"pi","cwd":"/repo","prompt":"Review the current changes","name":"Reviewer"}}
```

`spawn_agent` creates a background TUI. `prompt` is optional: without it the TUI is
idle and manual work never produces an initial-task completion notification.
`spawn_agent_task` requires a prompt and creates a headless child instead.
Both accept optional `model` and `name`; only `harness: "pi"` is implemented.
The working directory defaults to the MCP server's working directory.

A successful startup returns, for example:

```json
{
  "task_id": "task_00000000-0000-0000-0000-000000000000",
  "status": "running",
  "mode": "interactive",
  "harness": "pi",
  "process_state": "available",
  "delivery": "none",
  "tmux": {"socket":"/path/to/tmux.sock","pane":"%3"},
  "session_id":"task_00000000-0000-0000-0000-000000000000",
  "result_path":"/state/agent-hub/spawner/tasks/task_.../completion.json"
}
```

The response waits for readiness, not model completion. Startup has a 15-second
handshake deadline. Very fast tasks may already be completed in the response.
A created task that fails startup is returned with `status: "failed"`; it is not
represented as a running agent. Transport errors can leave the outcome ambiguous:
list tasks before blindly retrying a spawn.

Attach to the configured tmux session normally, then select the returned pane:

```sh
tmux -S /path/to/tmux.sock attach-session -t agents
# From another shell, focus the returned window/pane:
tmux -S /path/to/tmux.sock select-window -t %3
tmux -S /path/to/tmux.sock select-pane -t %3
```

`list_agent_tasks({})` lists children created in the **current MCP session**.
`agent_task({"action":"check"|"fetch_answer"|"cancel","task_id":"..."})`
inspects a task, returns the full completion, or requests cooperative cancellation.
Cancellation aborts the initial work, not the TUI. Completed tasks cannot cancel
later manually entered prompts. There is no force-kill tool.

Task handles are scoped to the MCP connection. Children, artifacts, and automatic
notifications outlive that connection, but a new MCP connection does not inherit
old task handles. Results remain accessible at their artifact paths.

## Completion semantics

1. The extension submits the initial prompt literally, with prompt-template
   expansion disabled and `deliverAs: "steer"`, after session startup.
2. It records finalized assistant messages from `message_end`.
3. It waits for `agent_settled`, not `agent_end`. Retries, compaction recovery,
   steering and queued follow-ups are included before settlement.
4. It writes `completion.json` atomically and marks reporting done.
5. The supervisor persists the completion and exact notification before delivery.
6. It injects a steering message through the original parent's listener. No child MCP
   tool call is involved.

An interactive TUI stays open. Later manual prompts **do not** report to the parent.
Intervention before settlement becomes part of the initial task. Escape/cancel
reports `cancelled`; errors and output-length truncation report `failed`. Session
replacement before settlement reports `interrupted`. A process disappearing
without a report becomes `lost`. `completed` means execution settled normally,
not that the supervisor verified the substantive quality of the answer.

The extension submits an initial prompt at most once across reloads. There is no
claim of transactional, exactly-once prompting across a process crash at the
submission boundary; interrupted work is not silently re-run.

## Delivery and recovery

Parent delivery requires a verified, registered **Pi parent with a session ID**.
The supervisor checks registry health, process lifetime, and the original session,
then includes `expectedSessionId` for the listener to check immediately before
injection. It never intentionally routes to a replacement conversation.

Notifications contain a bounded excerpt and the full result path. Child output is
labelled external content. Delivery retries use a stable completion ID and exactly
the same payload. `delivery: "accepted"` means listener acceptance, not durable
model processing. Listener deduplication is bounded/in-memory; this is **not an
exactly-once guarantee**. Parent crashes or queue clearing can still lose an
accepted message. Results remain durable regardless of delivery.

Unavailable delivery remains recorded and retries while the supervisor runs.
There is no TTL/backoff policy yet (default reconciliation interval: two seconds).
Full result retrieval over the local supervisor socket is bounded to 4 MiB; larger
results can be read from the artifact path.

SIGINT/SIGTERM stop the supervisor without killing interactive children or detached
headless runners. Restarting it reconciles existing mailboxes and pending delivery.
After an unclean supervisor exit, use `--recover-lock` to remove a stale lock only
if its recorded process lifetime is no longer alive. Never run concurrent recovery
commands. A live supervisor's lock is refused.

## Boundaries and development

This is trusted same-OS-user orchestration, not a sandbox or cross-user service.
The supervisor socket's caller/parent fields are not an authentication boundary.
Do not expose it to untrusted clients. Children execute with your normal Pi
permissions; allowlisting workspaces and recursion budgets are future policy work.
A supervisor limits available/starting child processes to 32.

```sh
cd agent-hub/spawner
npm run build
npm run typecheck
npm test
```

Tests cover actual isolated tmux windows with a fake harness, detached headless
execution, settlement/reload lifecycle, process loss, cancellation, result
persistence, parent identity/session checks, and automatic MCP-to-parent delivery.
Tests do not call a model provider.
