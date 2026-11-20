# Pi v2 migration plan

Migrate the useful behavior from `../pi/` in small, independently loadable extensions. This file tracks what landed, what changed, and what remains. See [README.md](README.md) for usage and [NOTE.md](NOTE.md) for host limitations and design rationale.

## Scope and approach

- Target Pi 1.5.2. Leave the original `pi/` package and installed user configuration untouched.
- For each extension, decide what to keep, what Pi already provides, and what to drop. Prefer public Pi primitives over execution wrappers, private UI patches, polling, or global registries.
- Keep presentation, execution, and policy separate. Use native `setStatus()` for movable footer text; keep editor widgets independent of footer layout. Gate terminal UI changes on TUI mode, not `ctx.hasUI` alone.
- Keep explicit manifest entry points, strict TypeScript, and native Node tests. Verify real package discovery and reload; use a temporary agent directory for tests, not personal settings.
- Update this plan when work lands or is parked: record the behavior change, commit or branch if available, and the latest validation or blocker.

## Landed on `feat/pi-v2-extensions`

| Status | Extension or milestone | What changed |
| --- | --- | --- |
| Done | Package scaffold | Audited all 20 original extensions; added an explicit package manifest, Pi 1.5.2 development pins, strict typechecking, and real loader/reload coverage. The original package stayed untouched. |
| Done | `alias` | `/exit` requests native graceful shutdown; `/clear` awaits native session creation and leaves cancellation and errors to Pi. |
| Done | `stash` | Literal `ctrl+s` preserves and swaps exact drafts. Restoration waits for interactive agent settlement and never overwrites a newer draft. Session changes clear in-memory state. |
| Done | `thinking-cycle-backward` | Literal `shift+left` cycles the current model's supported thinking levels backward and reports the effective level. Neither shortcut reads legacy remapping settings. |
| Done | `thinking-style` | Pi animates the colored thinking pulse. The extension restores native working state at lifecycle boundaries, uses the fixed collapsed label `Thought`, and styles only expanded assistant-thinking Markdown. No inferred per-block durations. |
| Done | `status-line` | Replaced fixed rows with JSON composition and selectable old-style `default-segments/`. Supports left/right layout, explicit statuses, an opt-in `status:*` wildcard, and empty layouts. `/statusline` toggles the footer; `/statusline reload` reloads config. Latest-response tokens and selected-branch cost remain distinct. |
| Done | `context-usage` | Shows a four-cell bracketed bar with partial blocks, percentage, and token counts in the top-right editor border. It works independently of footer configuration. |
| Done | `stylish-tools` → `tool-styling` | Uses native `registerToolRenderer()` for `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. Keeps compact previews, expanded output, edit diffs, warnings, and native result durations. Drops execution wrappers, routing overrides, SSH coupling, and timers. Expanded text no longer stops at forty lines. |
| Implemented for review | `readmd`, `system-prompt`, `loaded-skills`, `pager` | The three commands each provide a local TUI viewer. When enabled, `pager` offers a replacement through Pi's event bus at command invocation. RPC uses the native text dialog. `readmd` renders Mermaid blocks as code, and `system-prompt` shows Pi's effective prompt with a separate `append` view. |
| Done | `copy-command` | Selects shell blocks from the active branch with per-reply selection memory and numbered selection. Uses Pi's Markdown tokenizer and native clipboard in TUI, and shows the selected block in the RPC client. |
| Done | `openai-accounts`, `fast`, `usage` | Keeps separate labeled OAuth logins, the session-wide priority toggle, and cancellable quota reports in the v2 pager. Native OpenAI reports link to the dashboard. Codex quotas use their own login. |
| Implemented for review | `prompt-suggestions` | Shows an optional follow-up below the editor and inserts it through native Tab completion. Keeps provider configuration and shortcut remapping. Bounds requests to recent conversation text and cancels stale work. |
| Implemented for review | `question` | Uses numbered radio choices and checkboxes in the terminal, with descriptions below the focused option. Multi-select answers can include multiline text edited inside the checklist. Preserves answers when stepping back and supports review before submission in TUI and RPC. |
| Implemented for review | `/reanswer` | Shows numbered questionnaires newest first and accepts a number directly. Reuses the review with the latest branch-local answers and branches after the full original tool batch. |
| Implemented for review | `tool-set` → `tool-control` | Keeps the read-only `/tools` viewer and session-wide SAFE/YOLO policy with one native guard for direct and nested calls. Reads legacy saved modes and owns its permission notices. Uses registered tool annotations for independently loaded mutating tools. |
| Implemented for review | `reasoning-tokens` → `agent-stats` | Publishes the selected branch's reported reasoning-token count as `status:reasoning-stats`, with stream updates when available. Preserves zero and refreshes on branch changes. |

### Checkpoints

- `15a968f` — initial package, native extensions, and modular footer.
- `c3abc24` — context usage moved to a native above-editor widget; all 75 tests passed at this checkpoint.
- `44cf21d` — right-aligned the context widget using a width-aware renderer factory.
- `ad8e26d` — added native tool-styling renderers. Latest pushed migration checkpoint on `origin/feat/pi-v2-extensions`.
- `9048382` — added the bracketed editor-border bar and updated context usage tests.

### Parked or deferred

- **`protected-paths`:** out of scope for v2; do not reimplement it. The original extension remains untouched.
- **Centralized widget layout:** deferred until there is a concrete multiline or interactive need. `statusline.json` controls footer rows only.
- **Historical thinking duration:** deferred until Pi supports per-block rendering and there is persisted per-block timing. The current global label and transcript timestamp gaps cannot give an accurate duration.

## Remaining work

Suggested order, not a requirement to port every extension unchanged:

1. **Complete presentation coverage.**
   - [x] Update context usage tests to render the editor border and cover the bar fill, width fallbacks, and editor ownership.
2. **Session inspection and viewers.**
   - [x] Migrate `system-prompt`, `readmd`, and `loaded-skills` with independent viewers and optional pager presentation.
   - [x] Migrate `copy-command` with whitespace-preserving extraction, TUI navigation, and RPC selection and delivery.
3. **Provider features and interactive input.**
   - [x] Migrate `fast`, `openai-accounts`, and `usage` using Pi's model registry and provider hooks.
   - [x] Migrate `prompt-suggestions` using the native widget and autocomplete hooks.
   - [x] Migrate `question` using supported dialogs and a cancellable TUI checklist.
   - [x] Migrate `/reanswer` with branch-local revisions, complete tool batches, and native tree navigation.
4. **Execution and policy.**
   - [x] Migrate `tool-set` to `tool-control` with its own permission notices. Append turn-end notices to the entries already proposed by earlier handlers.
   - [x] Implement and verify the SSH migration below.
5. **Telemetry.**
   - [x] Migrate `reasoning-tokens` into `agent-stats` as a footer producer using Pi's native usage.
   - [ ] Review `tool-call-stats`. Use native tool durations and IDs and distinguish unknown from zero, nested calls from top-level calls, and summed duration from wall-clock time. Keep telemetry out of the shared working message unless ownership is agreed.

## SSH migration

### 1. Port `/ssh` and the remote tools

- Preserve `/ssh user@host[:/path]`, SSH config host completion, and `/ssh off`. Keep the seven `_remote` tools deferred and discoverable through `tool_search` and codemode in both connection states. With `/ssh`, unqualified tools and user `!`/`!!` commands continue to run locally. Disconnected remote calls return an error asking the user to reconnect.
- Reuse the private OpenSSH control master and directory verification. Use non-interactive key or agent authentication for this stage. Switch the connection only after the new target is ready, invalidate superseded connection attempts, and close owned resources on disconnect, reload, session replacement, or quit. `/tree` keeps the current connection and session files store no live connection state. A lost master requires an explicit reconnect. Tool invocations must use the owned socket even if it disappears during execution.
- Resolve relative paths against the verified remote directory and keep absolute remote paths literal. Resolve `~` against the remote home if supported by the tool. Check native factory path handling before reusing it because Pi's `read` factory also probes the local filesystem for filename variants. Use POSIX shell quoting for arguments, pass file contents over stdin, and propagate cancellation and timeouts to SSH subprocesses.
- Reuse native tool schemas and operations where their behavior fits. Give `grep_remote` a remote `rg` implementation because Pi's native grep always starts `rg` locally. Run `find_remote` on the host as well and bound search output. Start with `rg` and `fd` installed on the remote for native search behavior. Report a missing executable with a tool-specific error. Preserve search limits, line numbers, and the distinction between zero matches and a failed search.
- Publish `readOnlyHint: true` for `read_remote`, `grep_remote`, `find_remote`, and `ls_remote`, and `false` for `write_remote`, `edit_remote`, and `bash_remote`. `tool-control` applies the same policy to direct calls and codemode and reports reachability and permissions in `/tools`.
- Publish `status:ssh` from SSH using the existing footer layout. Keep declarations and permissions in `/tools`; the SSH badge shows the connected host and directory. Coalesce connection notices at run and turn boundaries alongside permission notices, including after branching or compaction. Capture the destination when a tool starts and persist it with its result, including errors where the destination is known. Use that metadata in the transcript so switching hosts or resuming can never relabel earlier results. Keep `tool-styling` optional and independent of the active connection.

### 2. Connect at startup with `--ssh`

- Connect through the same path as `/ssh user@host[:/path]` during initial startup. Only the seven deferred `_remote` tools use the connection. Unqualified tools and user `!` and `!!` commands execute locally. Users can switch hosts, disconnect, or retry with `/ssh`. Reload and session replacement close the connection.

### 3. Restore interactive authentication and verify end to end

- Port the existing TUI-only authentication modal so OpenSSH can prompt for a password, passphrase, MFA, or host-key approval. Load the PTY and terminal emulator only when needed. Keep host-key verification, cancellation, timeout, echo handling, and cleanup on reload. Document installation for the native dependencies. RPC and headless use OpenSSH batch authentication and known hosts.
- Run `npm run check` and a real Pi TUI/RPC smoke check with a temporary agent directory. Use different local and remote fixtures to prove which backend handled each call. Cover quoted paths, remote-only matches, direct and nested SAFE enforcement, tool discovery and restored exposure, failed host switches, startup failure, connection loss, and replayed destinations. Use a local disposable SSH server to verify both authentication paths, master cleanup, and the absence of a fresh connection after the owned master is gone.

## Validation status

- `npm run check` passes after the context-border merge and `copy-command` migration. The new tests cover shell block extraction, TUI navigation and copying, and RPC delivery. A Pi RPC smoke check confirmed package discovery and numbered delivery with whitespace intact.
- Provider migration tests cover OAuth isolation, priority requests, quota credential checks, and viewer cancellation. A Pi RPC smoke check discovered the three commands and reported a labeled account from a synthetic login.
- All seven tool renderers were smoke-checked through Pi's tool-row component. Package discovery and reload checks passed. Renderer-specific tests were deferred.
- The viewer tests cover all three pager-backed commands across pager enable, disable, and session reload. A Pi terminal smoke check verified opening, scrolling, and closing the system prompt pager and opening the loaded-skills report.
- Prompt suggestion tests cover draft and branch changes, timeout, output validation, and configuration. A Pi terminal smoke check with a synthetic Ollama response verified Tab insertion, undo, and reload alongside the context border.
- Question tool tests cover native dialogs, checklist interaction, review, and cancellation. Pi terminal and RPC smoke checks used a synthetic provider to submit a questionnaire.
- Reanswer tests cover numbered selection, repeated and legacy revisions, unchanged and cancelled edits, and compaction. Pi terminal and RPC smoke checks exercised numbered revisions and written checklist answers alongside sibling tool results.
- Tool control tests cover restored tool exposure, direct and nested SAFE checks, MCP annotations, approval, `/tools` rendering, reload, and composition with earlier turn-end notices. A terminal smoke check exercised `/tools`, the footer, Shift+Tab, and `/reload`.
- SSH tests use a temporary agent directory and distinct local and remote fixtures behind a fake OpenSSH executable. They cover the seven tools, literal paths, both extension load orders, startup connections, local tools and user shell commands, `/ssh off`, reload, destination metadata, and connection failures.
- A Pi CLI RPC smoke check verified package discovery and local shell routing with `--ssh` active. A real OpenSSH password test verified that the modal leaves the private master running after the PTY closes.
- A Pi session with a synthetic stream verified reasoning counts during updates, completion, and abort, and after branch navigation and reload. The test also covers missing counts, explicit zero, and compacted history.
- Run `cd pi-v2 && npm run check` before marking the baseline green. For a visual check, run `pi -e ./pi-v2` with duplicate legacy extensions disabled, then use `/reload` after changes.
