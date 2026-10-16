# Message listener

[Documentation index](README.md) · [Agent hub](../README.md)

Shell examples run from the repository root. Extension-local source paths are
relative to `agent-hub/pi/extensions/message-listener/`.

Local, same-user messaging into an interactive Pi session. The extension starts
on `session_start` in **TUI mode only**, never when its factory is merely loaded.
RPC, JSON and print modes do not open a listener.

```text
/listen             toggle
/listen on          enable (idempotent)
/listen off         close socket and withdraw registration
/listen status      show the current socket path
```

The footer shows `● listening`, `○ listener off`, or `! listener error` through
Pi's extension-status API. This works in the default footer and in custom footers without
taking over another extension's UI. The toggle lasts for
this extension runtime; `/reload` and a new process return to enabled. Session
replacement closes the old socket and creates a new one if enabled. Disabling
stops new receipts; it does not cancel messages already handed to Pi.

## Protocol: pi-listener-v2

Use a Unix-domain socket, **one UTF-8 JSON object followed by a newline per
connection**. The listener writes one newline-terminated ACK and closes. Requests
including the newline are limited to 64 KiB. Unknown fields are rejected.

```json
{
  "version": 2,
  "type": "message",
  "id": "a-unique-message-id",
  "content": "Please review the latest change.",
  "deliverAs": "steer"
}
```

- Required: `version`, `type`, `id`, and nonblank string `content`.
- `id` is a nonblank string of at most 256 characters. Use a UUID for the message
  ID; IDs share one namespace on each listener instance.
- `content` is opaque text at the socket transport layer. The extension recognizes
  agent-hub's `<agent_message>` wrapper for custom TUI rendering, but delivers the
  original string unchanged to model context. It does not authenticate metadata.
- `from` and `replyTo` are not transport fields and are rejected. The listener
  does not connect to a reply endpoint or automatically forward model responses.
- `deliverAs` is `steer` or `followUp`, defaulting to `steer`. Both start a turn
  when Pi is idle. While busy, steering is delivered at Pi's next steering
  boundary; follow-ups wait for queued follow-up delivery. Pi's queue settings
  determine whether queued messages are consumed individually or together.

Slash commands, skill expansion, and prompt-template expansion are disabled for
socket input; `/listen off` sent as content is literal text, not a local command.
Only a complete agent-hub XML wrapper selects custom rendering; other text,
including malformed wrappers, remains ordinary user input.

### ACKs and retries

```json
{"version":2,"type":"ack","id":"a-unique-message-id","ok":true,"status":"accepted"}
```

`accepted` means validation succeeded and the extension handed the message to
Pi's delivery API. It does **not** guarantee model completion, a reply, durable
storage, or eventual delivery after an abort, queue clear, reload, or crash.

Resending the same normalized envelope with the same ID returns
`status: "duplicate"` without a second delivery. Changing the payload with a
recently accepted ID returns a negative ACK. Deduplication remembers the last
1,024 accepted IDs in memory, and resets when the socket is recreated. This is
bounded retry protection, not exactly-once delivery. A timeout is ambiguous;
retry with the same ID against the same socket, not a new ID.

```json
{"version":2,"type":"ack","id":null,"ok":false,"error":"Invalid JSON"}
```

Rejected requests use `ok: false` and `error`. `id` is available after envelope
validation, otherwise `null`. Clients should set their own connection/response
timeout. The server permits at most 32 active connections and gives each request
five seconds to finish. Connection limits do not bound Pi's downstream message
queue: trusted senders must pace traffic and avoid flooding the agent.

## Socket discovery and security

A fresh private `pi-listen-*` directory under the OS temporary directory contains
`in.sock`. The directory is `0700`, the socket `0600`. Graceful disable, shutdown,
and reload close connections and remove the directory. Hard crashes can leave an
unreachable temporary socket behind; later instances use a new directory rather
than deleting or reusing an unknown path. If the resulting Unix socket path
exceeds 100 bytes, use a shorter `TMPDIR` before launching Pi.

Programs running as your OS user are trusted. Socket permissions are not a
sandbox or authentication for sender metadata. An accepted message can start a
model turn and cause tools to run with Pi's permissions. Do not expose/proxy the
socket to untrusted clients. No TCP listener or token authentication is included.

## Registry integration

With `registry-publisher` loaded and the explicitly started agent-hub registry
running, the process snapshot gains:

```json
{
  "messaging": {
    "transport": "unix",
    "path": "/private/temp/pi-listen-example/in.sock",
    "protocol": "pi-listener-v2",
    "reportedAt": 1791367205000
  }
}
```

The listener and publisher communicate through stateless event contracts in
`../contracts/listener.ts`, not imports of one another's entry points. A startup
query makes registration independent of extension startup order. Listener
changes publish immediately; the existing five-second heartbeat restores
registration after daemon restarts. Turning off publishes `messaging: null`;
publisher shutdown also attempts a bounded explicit clear. Missing/rejected
registry requests never prevent local listening. The daemon is not auto-started.

Advertisement expiry, freshness and reader obligations are described in the
[registry guide](registry.md#optional-pi-messaging-endpoint).

To load only the listener and publisher from the repository root:

```bash
pi -e ./agent-hub/pi/extensions/message-listener/index.ts \
   -e ./agent-hub/pi/extensions/registry-publisher/index.ts
```

### Send a message

Use `/listen status` or a fresh registry snapshot to get the path:

```bash
SOCKET=/absolute/path/to/in.sock node --input-type=module <<'JS'
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
const socket = createConnection(process.env.SOCKET);
socket.setTimeout(6000, () => socket.destroy(new Error('ACK timeout')));
socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
socket.on('data', chunk => process.stdout.write(chunk));
socket.on('connect', () => socket.end(JSON.stringify({
  version: 2, type: 'message', id: randomUUID(),
  content: 'Summarize your current progress.',
  deliverAs: 'steer',
}) + '\n'));
JS
```

## Agents MCP integration

The [`agents-mcp` server](mcp.md) routes `send_message` to this listener
using the envelope and ACK protocol above. It formats sender identity and the message ID
into an XML wrapper in the opaque `content` string. The extension displays recognized
messages with a `◈ Agent message · <sender name or ID>` header styled like
agent-hub tool calls. Incoming messages use the theme's dedicated `customMessageBg`
background, distinct from user messages; MCP tool calls remain background-free.
Titles, sender identities, separators, and metadata labels/values use distinct theme
foreground colors. Foregrounds are checked against the message background and
adjusted toward black or white when needed for at least 4.5:1 contrast, preserving
readable colors. This also covers Markdown syntax colors, default text, ANSI resets,
and 256-color output; faint styling is removed on the card. The decoded Markdown
body previews up to four display lines; expansion reveals the full body and sender
and message metadata. There is no separate border. The original XML remains in
model context, and custom messages retain
steering/follow-up delivery and trigger a turn when idle. See the MCP guide for
addressing and error codes.

## Session-targeted supervisor delivery

The optional v2 envelope field `expectedSessionId` restricts delivery to that Pi
session. The listener checks it immediately before calling the delivery API and
rejects a mismatched session rather than injecting into another conversation.
The spawner uses this for completion notifications. Existing ordinary messages
omit it and retain their previous behavior. The field participates in the message
fingerprint, so changing it under a remembered message ID is rejected.
This guard does not make accepted queued messages durable across later crashes or
session replacement.
