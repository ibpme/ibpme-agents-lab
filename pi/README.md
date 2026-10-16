# pi extensions

pi extensions, one directory each under `extensions/`, loaded as a single package.

## Install

```bash
pi/install.sh            # link this package into ~/.pi/agent/extensions/ibpme-pi-extensions
pi/install.sh --remove   # remove the link
```

The package loads as one unit: `pi.extensions` in `package.json` lists the entry points, so delete a line to
disable an extension. Run `/reload` in pi after changes.

`install.sh` also adds the entries from `keybindings.json` to `~/.pi/agent/keybindings.json` when they are missing
(existing entries are never changed). `tool-set` registers `shift+tab`, which pi reserves for
`app.thinking.cycle`, so that action is moved to `shift+right`; without it the tool-set shortcut is skipped.

## Extensions

| Extension | Purpose | Depends on |
|---|---|---|
| `alias` | Command aliases | - |
| `thinking-style` | Thinking display style | - |
| `question` | Structured questions with re-answer | - |
| `thinking-cycle-backward` | Cycle thinking level backward | shared: shortcut-config |
| `stash` | Stash the editor draft | shared: shortcut-config |
| `permission-gate` | Confirm risky tool calls | shared: tool-guard |
| `protected-paths` | Block writes to protected paths | shared: tool-guard |
| `system-prompt` | View the system prompt | shared: pager |
| `usage` | Provider account quota viewer | shared: pager |
| `readmd` | Render the last reply as paged markdown (with Mermaid) | shared: pager, message-text, mermaid |
| `prompt-suggestions` | Next-prompt suggestions in the editor | shared: shortcut-config, message-text |
| `tool-set` | Execution permissions and tool viewer | shared: pager, tool-guard, tool-status; contracts: status-keys |
| `stylish-tools` | Styled tool rendering and operation overrides | - |
| `ssh` | Run tools against SSH remotes | `tool-set`, `stylish-tools`; contracts: status-keys |
| `reasoning-tokens` | Live reasoning token counter | contracts: events |
| `loaded-skills` | Loaded-skills indicator | contracts: status-keys |
| `tool-call-stats` | Tool-call statistics | shared: pager; contracts: events |
| `status-line` | Footer status line | shared: tool-status; contracts: status-keys, events |

Runtime links beyond imports: `ssh` uses the `tool-set` service and `stylish-tools` operations override through
process-wide `Symbol.for` keys, and `status-line` shows status entries published by `tool-set`, `ssh` and
`loaded-skills` and events from `reasoning-tokens`. Those extensions still work if others are removed.

`extensions/shared/` holds helpers used by two or more extensions; `extensions/contracts/` holds constants and
event payloads shared across extensions. Both are stateless (pi gives each extension its own module instance)
and are not entry points. A helper used by one extension stays in that extension's directory. Extensions never
import another extension's `index.ts`.

## Development

```bash
cd pi
npm ci
npm run check      # typecheck + tests + real-loader test
```

Pi loads TypeScript through jiti in its own Node.js runtime, so there is no build step and no runtime of our
own to install. Relative imports carry an explicit `.ts` extension. The scripts need Node.js 22.18+ and npm 10+.

## Configuration

Extensions create their own config under `~/.pi/agent/` when needed; nothing is installed for them.
`prompt-suggestions` reads `~/.pi/agent/prompt-suggestions.json` (written when you toggle suggestions) with keys
`enabled`, `provider`, `model` and `ollamaUrl`. Missing keys fall back to built-in defaults, and
`PI_SUGGESTIONS_PROVIDER`, `PI_SUGGESTIONS_MODEL` and `PI_SUGGESTIONS_OLLAMA_URL` override the file.

## Tools and execution permissions

Requires Pi 1.3.0 or newer for native restoration of tools loaded during a session.

- `/safe`, `/yolo` (`/auto`), and `shift+tab` change **execution permissions**, not the active tool list.
  SAFE blocks local write/edit/shell tools (including PowerShell), SSH mutation/shell tools, and MCP tools
  without `readOnlyHint: true`. The guard also applies to nested calls from codemode and other tools.
  Other extension tools retain their existing policy unless explicitly registered as blocked.
- `change_mode` remains declared in both modes and requests user confirmation before leaving SAFE.
  It is model-only: scripts cannot use it to open approval dialogs. Without a UI, escalation is denied.
- Permission enforcement, the status badge, and mode persistence update immediately. Model notices
  are coalesced: idle toggles append nothing until a run starts, when only the final state is announced
  if it differs from the latest notice in the current projected context. A round trip to the already
  announced mode adds no notice. Mid-run changes are announced at the turn boundary without forcing
  another model response. Notices remain visible in the TUI (`display: true`).
  Fresh sessions omit notices for the implicit defaults (YOLO and SSH disconnected). SAFE or an
  enabled SSH connection is still announced before the first model request. After a state has been
  announced, returning to its default still produces a corrective notice, even if earlier notices
  were removed from context by compaction or branching.
  New sessions default to YOLO, preserving the previous default. Explicit choices are saved in session
  metadata and restored on resume/reload. Permissions are live session-wide control: `/tree` does not
  rewind them or reset SAFE to YOLO. Notices missing from the destination branch or compacted context
  are restored at the next run/turn boundary; already-present notices are not repeated.
- Local `ls`, `grep`, and `find`, and all seven SSH `_remote` tools, are registered with **deferred**
  exposure. Codemode can call them without adding declarations; `tool_search` can load them for direct
  calls. Once loaded, tools may remain declared across turns and resume. Permission switches do not
  unload them. Startup adds registered `codemode`, `tool_search`, and `change_mode` entry points to the
  restored loadout without removing other tools. Explicit Pi tool exclusions still govern registration.
- `/ssh user@host[:/path]` connects the deferred remote tools; unqualified tools remain local.
  `/ssh off` disconnects without changing tool exposure or declarations. Disconnected remote tools
  remain discoverable, but execution fails rather than falling back to local I/O. Connections are not
  persisted; reconnect after resume. Connection/target notices use the same run/turn-boundary
  coalescing as permission notices, while connection changes and user-facing status update immediately.
- `--ssh user@host[:/path]` is distinct: it redirects the unqualified tools to that remote for the
  session. Their exposure and execution permissions are unchanged.
- `/tools` shows reachability separately from permission, for example `deferred · blocked (SAFE)`.

SAFE is a harness execution policy, not an operating-system sandbox. MCP read-only annotations are
server assertions, not verified guarantees; trusted extensions can perform I/O outside nested tool calls.

Questionnaire re-answer messages are intentionally not coalesced: they carry revised user answers and
start a new model run immediately, rather than reporting an intermediate configuration state. Usage
statistics and saved permission metadata do not enter model context and need no notice coalescing.
