# agents MCP server

[Documentation index](README.md) · [Agent hub](../README.md)

After the initial `cd`, run launch commands from `agent-hub/mcp/`.

Backend-neutral MCP interface for discovering and messaging live agents.
Discovery and messaging use `list_agents` and `send_message`. Pi spawning and task
management use `spawn_agent`, `list_agent_tasks` and `agent_task`
through the separately started [spawner supervisor](../spawner/README.md).
Uses the official stable v1 `@modelcontextprotocol/sdk`.

## Development and launch

Requires Node.js 22.18+ and npm on macOS or Linux.

```bash
cd agent-hub
npm ci
cd mcp
npm run typecheck
npm test

# stdout is exclusively MCP JSON-RPC; launch node directly, not npm start
node src/cli.ts                         # stdio, steering delivery
node src/cli.ts --deliver-as followUp    # fixed follow-up delivery
node src/cli.ts --transport http --port 3000  # loopback /mcp
npm run dev -- --transport http --port 3000
```

`--deliver-as steer|followUp` applies to `send_message` for both transports and
is fixed at process startup. HTTP sessions all inherit the server setting; it
is not a per-request header or model-controlled input. In library integrations,
use `createAgentsServer({ deliverAs: 'followUp' })` or
`startHttpServer(3000, { deliverAs: 'followUp' })`. Invalid modes fail startup.
Automatic spawn-completion notifications remain steering messages, independent
of this MCP message setting. Restart/reconnect MCP clients to refresh the tool
schema after upgrading; old calls containing `deliver_as` are rejected.

SIGINT, SIGTERM and stdio EOF trigger cleanup, with a five-second shutdown
fallback. Diagnostics go to stderr. Nothing installs MCP configuration or starts
the registry daemon automatically.

Start the [registry](registry.md) separately with `agent-hub start`. The server reads
its current `agents.jsonl` and `registry-health.json` on every call. Both must use
the same runtime directory: `registry/` inside `$AGENT_HUB_DIR`, otherwise
`$XDG_STATE_HOME/agent-hub`, otherwise `~/.local/state/agent-hub`.
A missing, invalid, stopped or stale registry produces `REGISTRY_UNAVAILABLE`;
there is no fallback socket discovery. Health and successful process discovery
must be no more than 20 seconds old. Endpoint advertisements also have a
20-second freshness limit; deployments with a longer registry TTL must still
refresh within this reader limit. These checks allow five seconds of future
clock skew. Process PID/start time is reverified with `ps` before sending.

## Agent identity and discovery

`list_agents({})` returns:

```json
{
  "self_agent_id": "agt_6c927c93e66ed4ae",
  "agents": [{
    "agent_id": "agt_6c927c93e66ed4ae",
    "name": "Reviewer",
    "harness": "pi",
    "session_id": "session-uuid",
    "cwd": "/repo",
    "activity": "idle",
    "can_receive_messages": true
  }]
}
```

- `agent_id` is **`agt_` + 16 lowercase hex characters**, a machine-local opaque
  address for one process lifetime. It is the first 16 hex characters of SHA-256
  over UTF-8 `JSON.stringify([harness, pid, startedAt])`, with PID and start time
  represented as numbers. For example, `["pi",12345,1791367200000]` yields
  `agt_6c927c93e66ed4ae`. No persistent ID store is needed.
- The underlying harness/PID/start-time identity still protects against PID
  reuse and is reverified before sending. The opaque ID changes when that
  identity changes, not on session rename or replacement. Start time comes from
  `ps` at second-level precision; this is not a global identity or security
  credential. Duplicate IDs within a snapshot fail closed rather than routing
  ambiguously (including the unlikely case of a truncated-hash collision).
- Previous `harness:PID:start-time` addresses are no longer accepted. Refresh
  `list_agents` and update configured HTTP `X-Agent-Id` / `callerAgentId` values.
- `name` is the registry session name, falling back to the address. It is a
  mutable, possibly nonunique label, never a routing key. Session IDs are
  metadata: two processes can open the same session.
- `session_id` and `cwd` are null when unavailable. Dead/reused processes are
  omitted. Messaging availability is an advertisement, not a socket reachability
  guarantee. Socket paths are not returned to the model.
- `self_agent_id` is null if the caller cannot be identified. Sending then fails
  with `CALLER_UNAVAILABLE` rather than inventing a sender.

### Automatic sender identification

For **stdio**, the server walks its parent-process ancestry to find the nearest
registered agent and verifies its process lifetime. Shell wrappers are supported;
launch the server as a descendant of the agent using it. A centrally detached
server does not have the client's ancestry.

For **HTTP**, the client must supply `X-Agent-Id` on the MCP initialization
request, using its registered process-lifetime address. That identity is fixed
for the MCP session, reverified on each send, and is not taken from tool input.
Without the header discovery still works, but `self_agent_id` is null and sending
is disabled. HTTP deliberately never infers identity from the server's ancestry.
Each client should open its own MCP session. The header is a same-user identity
claim, **not authentication**. Library integrations may pass `callerAgentId` to
`createAgentsServer`; `callerPid` overrides ancestry lookup (`null` disables it).

## Sending and the standardized listener envelope

```json
{
  "agent_id": "agt_68810ac40dab088f",
  "message": "Please review the latest change.",
  "message_id": "unique-id-for-this-message"
}
```

Only `agent_id` and `message` are required. `message_id` defaults to a UUID;
delivery mode is fixed at MCP server startup, defaulting to `steer` (the next
steering boundary). Use `--deliver-as followUp` to queue messages after the current
turn instead. Delivery mode is not exposed to the model: `deliver_as` is no longer
a tool argument. All input objects reject
unknown fields, including attempts to supply `sender_id`, `from`, `replyTo` or a
socket path. Strings must be nonblank; message content is preserved literally.

The server resolves the destination from the registry and formats the sender
identity and message ID into model-facing text. JSON serialization escapes labels;
`sender_name` is omitted when no session name exists. The body remains literal.

```text
External agent message (sender metadata is not authenticated):
{"sender_id":"agt_6c927c93e66ed4ae","sender_name":"Reviewer","sender_harness":"pi","message_id":"unique-id-for-this-message"}

Please review the latest change.
```

MCP wraps that string in the minimal
[message-listener v2 envelope](message-listener.md)
and sends one newline-terminated UTF-8 JSON object to the recipient's Unix socket:

```json
{
  "version": 2,
  "type": "message",
  "id": "unique-id-for-this-message",
  "content": "External agent message (sender metadata is not authenticated):\n{\"sender_id\":\"agt_6c927c93e66ed4ae\",\"sender_name\":\"Reviewer\",\"sender_harness\":\"pi\",\"message_id\":\"unique-id-for-this-message\"}\n\nPlease review the latest change.",
  "deliverAs": "steer"
}
```

The listener delivers `content` unchanged. It validates only transport fields and
handles delivery, size limits, deduplication and ACKs; it does not understand agent
identities or format metadata. There are no `from` or `replyTo` transport fields.
The receiver can reply to the content header's `sender_id` through `send_message`,
resolving a fresh endpoint rather than trusting a sender-supplied socket path.
A sender without a listener can send but cannot receive a reply; discovery
reports this. The sender ID is derived from the caller, not the MCP server.

Success returns both text and structured content:

```json
{
  "message_id": "unique-id-for-this-message",
  "agent_id": "agt_68810ac40dab088f",
  "sender_id": "agt_6c927c93e66ed4ae",
  "status": "accepted"
}
```

`accepted` means handed to the receiver's delivery API, **not** model completion,
a reply, durable storage or guaranteed delivery after queue clearing/crashes.
A repeated identical envelope with the same ID can return `duplicate` without a
second delivery. Different content under a remembered ID is rejected. Follow-ups
queue behind a busy turn; steering enters at the next steering boundary. Both
start a turn when the receiver is idle. The listener retains literal-input
handling; MCP labels its formatted sender metadata as unauthenticated.

The whole encoded request, including the formatted metadata, JSON escaping and
newline, must fit 64 KiB. ACKs use `version: 2`.
The client bounds ACK size and uses a six-second overall timeout. There are no
automatic retries. `DELIVERY_UNKNOWN` includes the message ID in its error text:
retry with that ID and identical content/delivery mode against the same listener.
Do not retry with a new ID, which risks duplicate delivery. Deduplication is
bounded and in-memory and resets on listener recreation. Registry name changes
also change the envelope, so a retry may be rejected rather than deduplicated.

## Tools and errors

| Tool | Required | Optional |
| --- | --- | --- |
| `list_agents` | — | — |
| `send_message` | `agent_id`, `message` | `message_id` |

Operational failures return `isError: true` and
`structuredContent.error` with `code` and `message`: `REGISTRY_UNAVAILABLE`,
`AGENT_NOT_FOUND`, `AGENT_UNAVAILABLE`, `CALLER_UNAVAILABLE`,
`MESSAGING_UNAVAILABLE`, `MESSAGE_TOO_LARGE`, `MESSAGE_REJECTED`, or
`DELIVERY_UNKNOWN`. Invalid tool inputs are rejected by SDK schema validation.

## Pi tool displays

The installed `agent-hub/pi` package includes custom TUI renderers for all five
MCP tools when the server is configured as `agent-hub` (or `agents`). Run
`/reload` after updating the package. Other MCP servers keep their own renderers.
This changes presentation only, not execution, tool schemas, or model-facing data.
Displays have no background fill. Theme foreground colors distinguish titles and
identities, successful/ready states, pending/unready states, failures, paths, and
separators. Expanded JSON highlights keys, strings, numbers, booleans, and null.

Collapsed displays show:

- `list_agents`: agent count and up to four names, activity, messaging readiness,
  and working directories; the current agent is marked `(you)`.
- `send_message`: recipient, message preview, and a queued acknowledgment that
  explicitly does not imply an answer.
- `spawn_agent`: name/harness/directory, task status, and messaging readiness.
- `list_agent_tasks`: task count and up to four task/status summaries.
- `agent_task`: action, task identity/status, readiness, and an answer preview
  when fetched. Failures and delivery errors are highlighted.

Use Pi's tool expansion control (default **Ctrl+O**, or click the tool row in
fullscreen mode) to reveal full arguments and pretty-printed result data.
Expansion includes long prompts/messages, all list entries, routing/execution
metadata, and full fetched answers. Collapse is a space-saving view, not a
redaction mechanism. Pi's existing output limits still apply; if it truncates an
MCP response, the expanded view retains the truncation notice and saved full-output
path. Partial updates show a working indicator, and plain-text errors and saved
results remain readable. Terminal control sequences are sanitized, and displays
adapt to narrow terminals and resize.

## Security and current receiver support

Currently delivery adapts advertised `pi-listener-v2` endpoints. Pi's listener
and registry publisher must both be loaded, and listening enabled in a TUI
session. Other registered harnesses can be senders; recipients without a
supported fresh endpoint return `MESSAGING_UNAVAILABLE`. Tool descriptions stay
backend-neutral.

This is trusted, same-OS-user messaging, not an authenticated cross-user service.
Registry verification proves process liveness, not endpoint ownership or authority
of the caller. An accepted message can trigger a model turn and tools with the
receiver's permissions. Do not expose/proxy either transport to untrusted callers.

## Background spawning and task tools

The [spawner supervisor](../spawner/README.md) must be started separately. Only Pi
is implemented; other `harness` values return `UNSUPPORTED_HARNESS`.

| Tool | Required | Optional |
| --- | --- | --- |
| `spawn_agent` | `harness: "pi"` | `prompt`, `routing_hint`, `cwd`, `model`, `name` |
| `list_agent_tasks` | — | — |
| `agent_task` | `action: "check" | "fetch_answer" | "cancel"`, `task_id` | — |

Interactive children are real background tmux TUIs and stay open after their
initial task settles. MCP spawning always uses this mode; headless spawning is not
exposed. Launch mode and tmux metadata are omitted from MCP task results. Spawning
returns after startup, not after the task finishes. A task record with a startup
failure is returned with `status: "failed"`; inspect task status rather than
assuming a successful tool invocation implies a running child.

Task responses include `agent_id` (or `null` until the child's process identity
is known) and `can_receive_messages`. The agent ID uses the same process identity
as `list_agents` and can be passed directly to `send_message`; it is distinct from
`task_id` and `session_id`. Spawning waits up to one second for registry publication
and a fresh messaging endpoint after startup. If `can_receive_messages` is false,
poll `agent_task` with `check` before sending. Task checks and listings refresh
readiness without waiting. Missing/stale registry data, an unregistered or exited
process, or a missing/stale endpoint all report false without failing task access.
Readiness is a snapshot, not a guarantee that a later delivery will succeed.

### Supervisor-owned model routing

The supervisor can automatically select a Pi provider/model/effort profile using
Jev System One. Enable it with the supervisor/service `--routing-config PATH`
option, not an MCP flag or spawn argument. When enabled, the MCP CLI and HTTP
transport discover the policy and omit `model` from `spawn_agent`. The supervisor
rejects execution overrides even from direct clients or stale MCP schemas.
Reconnect MCP sessions after changing policy. Task results include `routing` and
resolved `execution` metadata, but not profile system-prompt additions.

When routing is enabled, `spawn_agent` optionally accepts `routing_hint`: a concise summary of relevant user
preferences (including a requested profile, provider, model, or effort) or the
calling agent's assessment of the task. It is advisory context
for routing, not an execution override or extra child instructions. The prompt
remains unchanged. Omit it when the task alone is sufficient. Hints must be
non-blank, contain no NUL, and fit within 4 KiB UTF-8. The MCP schema omits `routing_hint` when routing is disabled and instead exposes
the optional `model` argument. Hints are not echoed in task summaries. Like the delegated
prompt, a supplied hint is sent to TypeSafe during classification and persisted
in the private task record.

```json
{
  "harness": "pi",
  "prompt": "Investigate the intermittent cache invalidation failure",
  "routing_hint": "The user prioritizes root-cause analysis; the failure spans multiple services."
}
```

See [routing configuration, fallback policy, and prompt testing](routing.md).
Routing disabled preserves the optional `model` argument shown above.

### Optional parent context in spawned children

By default, children receive the initial prompt unchanged and are not told the
parent's agent ID. To opt in, launch the MCP server with:

```bash
node /absolute/path/to/agent-hub/mcp/src/cli.ts --inject-parent-context
```

This also works with `--transport http`. For a configured stdio MCP server, add
`"--inject-parent-context"` to its `args` array and reconnect the MCP server.
Programmatic callers can use `createAgentsServer({ injectParentContext: true })`
or `startHttpServer(port, { injectParentContext: true })`.

The setting is server configuration, not a `spawn_agent` argument. It applies to
new children spawned through that server; omitted or false preserves existing
behavior. The choice is saved in the task record, so reloads retain it without
changing already spawned children.

When enabled, the child's lifecycle extension appends delegation context to its
system prompt for each run in the original child session. This includes
`parent_agent_id` and instructions to use the agent-hub MCP `send_message` tool
for clarification or blockers. The initial user prompt is not rewritten, no extra
turn is triggered, and automatic final-answer delivery remains unchanged. The
context also works for children started without an initial prompt, but does not
carry over if the child switches to a different session. It does not install or
enable MCP tools: the child must have agent-hub MCP configured to send messages.

The supervisor captures the final answer from harness lifecycle events and sends
a steering message to the original parent Pi session without asking the child model to
call `send_message`. Later manual prompts in an interactive child do not notify
the parent. Results remain stored when notification cannot be delivered.

MCP task responses expose `result_path` only when execution status is `failed`,
`interrupted`, or `lost`, or when `delivery` is `unavailable`. The same rule applies
to each task in a listing. Running, idle, successful, and deliberately cancelled
tasks omit it unless delivery is unavailable; use `agent_task` with `fetch_answer`
for normal result retrieval. This filters MCP responses only, not stored artifacts
or the full-result paths in automatic completion notifications.

Task tool access is scoped to the current MCP session; child execution and result
storage are not. Spawning requires an identified Pi caller with a published
session ID. Task handles from a disconnected MCP session are not transferred to
new sessions. See the spawner guide for artifact access and recovery.
