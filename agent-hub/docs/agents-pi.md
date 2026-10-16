# `/agents`: live registry browser

[Documentation index](README.md) · [Agent hub](../README.md)

Shell examples run from the repository root unless they include a `cd`.

Browse Pi and Claude agents recorded by the standalone
[`agents-registry` daemon](registry.md). The extension reads
`agents.jsonl` and `registry-health.json`; it does not discover agents, publish
status, start the daemon, or launch agents.

## Setup

Install the package with `pi install <path-to>/agent-hub/pi`, then `/reload` existing Pi
sessions. Start the registry explicitly from the repository root:

```bash
cd agent-hub
npm ci
npm run build
cd registry
node dist/cli.js start --background
```

To map tmux panes, start the daemon with the server socket explicitly configured:

```bash
node dist/cli.js start --background --tmux-socket /absolute/path/to/tmux/socket
```

The daemon does not automatically use `TMUX`. Stop an existing daemon before
changing its configuration. Multiple `--tmux-socket` arguments are supported.

Browser and publisher resolve the same directory: `AGENTS_REGISTRY_DIR`, then
`$XDG_STATE_HOME/agents-registry`, then `~/.local/state/agents-registry`.
The independent `registry-publisher.ts` extension reports Pi session, model,
context-window fill, and activity metadata. Without it, Pi processes still appear but have unknown activity
and limited metadata. Claude activity comes from the daemon's Claude CLI queries.

For a one-off browser without the package:

```bash
pi -e ./agent-hub/pi/extensions/agents/index.ts
```

## Standalone browser and tmux popups

Inside tmux, `/agents` launches the standalone browser in a 90% tmux popup instead
of Pi's overlay. Install its dependencies with
`cd agent-hub && npm ci && npm run build` and ensure Bun is on Pi/tmux's PATH.
Outside tmux, `/agents` retains its native overlay.

The browser can also launch independently from any shell or a tmux keybinding;
see [agents-viewer setup](../viewer/README.md). It preserves the original
pane/socket/client for actions and closes after attaching. Standalone transcripts
use persisted files only, not the invoking Pi process's in-memory branch. Popup
colors use the terminal ANSI palette rather than Pi's active theme.

## Controls

| Key | Action |
|---|---|
| Up/Down or `j`/`k`, PageUp/PageDown, Home/End | Navigate; scroll in details or transcript |
| Right Arrow | Open a compact live transcript of the selected session |
| Left Arrow | Return from the transcript |
| End (in transcript) | Jump to the latest messages and resume auto-follow |
| Enter | Attach to an eligible interactive pane; otherwise show details |
| `i` | Show metadata, including for attachable agents |
| `V` | Move the existing pane into a top/bottom split |
| `H` or Shift+Enter | Move the existing pane into a left/right split |
| Ctrl+X | Confirm killing the entire selected pane with `y`/`n` |
| `/` | Filter the list by name, harness, state, model, cwd, or group; Enter keeps it, Escape clears it |
| Tab / Shift+Tab | Jump to the next/previous group |
| `r` | Refresh |
| Escape, Ctrl+C, or `q` | Cancel confirmation, return from transcript/details, clear an active filter, or close |

The browser refreshes every two seconds. Inside tmux it opens in a 90% popup.
The native Pi overlay outside tmux fills the terminal with a one-cell margin,
including on large displays. The current
session is pinned first, followed by **Interactive (tmux)** and **Non-tmux** groups.
The Non-tmux group also includes every non-interactive, background, or unknown-mode
agent, even when it has a mapped tmux pane. Only interactive agents with mapped
panes belong to Interactive (tmux); the pinned current session is the exception.
Within each group, sessions sort by **waiting → busy → idle → unknown**, then name.
Rows show an animated activity glyph (spinner for busy, pulsing diamond for
waiting, dot for idle), a harness badge, model, shortened cwd, what a waiting agent
needs, context-window fill (`◑ 52%`: green below 50%, yellow below 80%, red above),
listener status, and uptime. Previews and details add a `ctx ▰▰▰▰▱▱▱▱ 52% 104K/200K`
gauge. A spark marks agents whose activity changed in the
last few seconds; the header counts agents per state next to a live/stale registry pill.
Transcripts render assistant replies and summaries as Markdown (headings, emphasis,
lists, quotes, tables, code blocks), tool calls inline as `tool(args)` with a
per-kind glyph (`$` shell, `≡` read, `✎` edit, `⌕` search, `↯` web, `◈` agents) and
`⎿` results with red failures, and a live `Working…`/`Waiting for input` trailer
while the agent is active. Messages that arrive while scrolling is paused are
announced. Above the transcript, token metrics are compacted to K/M units
(`↑ 12K in ↓ 820 out ⟳ 40K cache read ✎ 0 cache write · $0.0412`), followed by
prompt/reply/tool/failure counts and a cache-hit meter. Successful pane
actions show a short confirmation. All styling uses theme colors.
PID and tmux pane numbers are hidden in the list and remain available in details.
Selection follows harness + PID + numeric process start
time, independent of pane moves. Details show process identity, observation time,
activity and source, listener advertisement status, session, working directory,
model, and tmux server/location.
Registry strings are sanitized before terminal rendering.

## Listener indicators

Each row includes a listener badge, derived **directly from the registry
snapshot's `messaging` field**. There is no MCP dependency or socket probe:

| Badge | Meaning |
|---|---|
| `[listening]` | A recent listener endpoint is advertised in a usable registry observation |
| `[listener off]` | No endpoint is advertised; this is not proof that no socket exists |
| `[listener stale]` | An endpoint is recorded, but its advertisement, agent observation, or registry health is stale |

Details show `listener: advertised (not probed)`, `off (not advertised)`, or
`stale advertisement (not probed)`. Socket paths are never displayed or dialed.
The badge updates with the normal two-second browser refresh, including while
viewing details. Listener advertisements older than 20 seconds (the registry's
default endpoint TTL) are conservatively marked stale, even if a daemon is
configured with a longer TTL. Reports more than five seconds in the future are
also stale. The existing 30-second agent/registry freshness checks still apply.
A fresh advertisement is not a guarantee of socket reachability.

## Session preview

Right Arrow replaces the list with a read-only, live-updating transcript. It opens
at the latest messages and follows new records every two seconds. Scrolling up
pauses auto-follow; End or scrolling back to the bottom resumes it. Left Arrow
or Escape returns without losing the selected list row. Enter/attach and `i`
metadata retain their existing behavior; pane-action keys do not act from the
transcript.

The preview shows user and assistant text, tool names with compact inputs/results,
and error markers. Thinking and internal records are hidden; images/documents
are placeholders. Tools are limited to five logical lines/600 characters, then
at most six wrapped display lines. Text is sanitized against terminal escape
sequences. Compact output is not a redaction mechanism: prompts and tool excerpts
can still contain sensitive data.

Pi reads the registry's session file without opening or migrating it through
SessionManager. The most recently persisted branch is reconstructed through
`id`/`parentId`, including summary markers and its pre-compaction history. For
the invoking Pi process, the actual in-memory branch is used instead, including
in-memory sessions and navigation that has not yet produced another file entry.
Other Pi sessions cannot expose unpersisted leaf changes or token-level streaming.

Claude uses the recorded session file when available; otherwise it resolves a
unique top-level `<session-id>.jsonl` under `~/.claude/{projects,project}/*`.
Ambiguous matches are refused. Like the standalone
prototype, Claude displays records in file
order, associates tool results with tool calls (not user prompts), and excludes
nested subagent files.

The header summarizes observed input/output/cache tokens and recorded dollar
costs. Pi totals include recorded assistant, nested-tool, compaction, branch-summary,
and other usage entries across branches. Claude response usage is deduplicated
by message ID (record UUID when absent), with revised counters replacing earlier
ones. Claude cost is only the latest logged cumulative snapshot, may lag, and is
never estimated. Missing values show `unavailable`; incomplete totals are marked
partial. Reasoning tokens are already included in output and are not added again.

File reads consume appended bytes only, retain split JSONL/UTF-8 records until a
newline, and reset on observed truncation or file replacement. Malformed lines
are skipped with a warning. An in-place rewrite that regrows past the prior
read offset between polls is not detected; logs are assumed append-only. History
is retained in memory while the preview is open. Unavailable or unreadable files
show an inspectable error; `r` retries. Late reads cannot replace a different
preview or update the browser after it closes. Stale/exited agents remain
readable when their session file is still available.

## Freshness and actions

The browser distinguishes:

- **fresh**: running writer and recent successful process discovery;
- **degraded**: recent observations with discovery errors or invalid snapshot lines;
- **stale**: stopped/starting writer, missing successful process discovery, or writer/
  process-discovery timestamps older than 30 seconds or excessively in the future;
- **unavailable**: missing/unreadable files or invalid health data.

Invalid lines are skipped independently, with a warning. An empty snapshot is
only an empty registry observation, not evidence of a healthy writer. Stale rows
remain inspectable but cannot authorize pane actions. Individual observations older
than 30 seconds are also read-only. Keep the daemon's scan interval comfortably
below this threshold (default: five seconds).

Pane actions require an interactive agent with a mapped pane on the invoking
Pi's tmux server. Agents on other servers, headless agents, and unmapped agents
remain inspectable. Both server and pane identify the current-pane marker.

Every action reopens registry health and checks the selected lifetime is still
listed. It then takes fresh UTC `ps` and tmux pane snapshots, checks PID/start
time and pane ancestry, and verifies the invoking pane exists before changing
tmux. Exited, reused, or moved processes are rejected. Registry health and snapshot
files are individually atomic, not a transactional pair; action-time verification
is therefore still necessary.

In the popup, attach switches the explicitly captured invoking client and closes
the browser after success. If that client is no longer in the invoking session,
the action is refused. The native implementation without an explicit client uses
the most recently active client in the invoking session. Neither starts a nested
attachment nor redirects an unrelated session's client.
Split moves the entire existing pane; it does not clone or restart the agent.
Kill terminates all processes in the pane. The invoking pane cannot be moved or
killed; attaching to it is a verified no-op.

## Deliberately excluded

The browser has no job-store dependency, job history/results, job ownership,
job/process deduplication, cancel/acknowledge/background controls, or spawning.

Claude model names and context fill reach the registry through its separate
[opt-in status-line publisher](registry.md#optional-claude-status-line-model-publisher);
this extension only reads registry snapshots.

## Implementation and checks

The thin Pi extension at `agent-hub/pi/extensions/agents/` contains:

- `index.ts`: command registration and runtime configuration.
- `native.ts`: Pi overlay adapter, theme injection, and in-memory session access.

Shared implementation and tests live in `agent-hub/viewer/`:
- `reader.ts`: canonical snapshot schema validation and health classification.
- `browser.ts`: modal state, refresh, navigation, confirmations, action dispatch.
- `view.ts` / `theme.ts`: list/details, responsive framing, action eligibility, theme contract.
- `session.ts`: read-only incremental Pi/Claude transcripts and usage accounting.
- `tmux-actions.ts`: numeric identity/ancestry checks and pane operations.

Snapshot types and schema come from `agent-hub/registry`; the reader has no dependency
on its build output or daemon installation. Ajv is installed with the shared agents-viewer package.

```bash
(cd agent-hub && npm run check)
```

Tests cover file-backed reader states, invalid data, selection, responsive rendering,
late async results, stale-action refusal, confirmations, identity checks, and pane
operations against an isolated real tmux server when available.
