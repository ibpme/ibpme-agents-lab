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
| Done; renderer coverage pending | `stylish-tools` → `tool-styling` | Uses native `registerToolRenderer()` for `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. Keeps compact previews, expanded output, edit diffs, warnings, and native result durations. Drops execution wrappers, routing overrides, SSH coupling, and timers. Expanded text no longer stops at forty lines. |
| Implemented for review | `readmd`, `system-prompt`, `loaded-skills`, `pager` | The three commands each provide a local TUI viewer. When enabled, `pager` offers a replacement through Pi's event bus at command invocation. RPC uses the native text dialog. `readmd` renders Mermaid blocks as code, and `system-prompt` shows Pi's effective prompt with a separate `append` view. |
| Done | `copy-command` | Selects shell blocks from the active branch with per-reply selection memory and numbered selection. Uses Pi's Markdown tokenizer and native clipboard in TUI, and shows the selected block in the RPC client. |

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
   - [ ] Add focused `tool-styling` coverage for renderer selection/delegation, collapsed and expanded output, diffs, errors, and native duration handling.
2. **Session inspection and viewers.**
   - [x] Migrate `system-prompt`, `readmd`, and `loaded-skills` with independent viewers and optional pager presentation.
   - [x] Migrate `copy-command` with whitespace-preserving extraction, TUI navigation, and RPC selection and delivery.
3. **Provider features and interactive input.**
   - [ ] Review `fast`, `openai-accounts`, and `usage` against Pi's model registry and provider hooks. Preserve useful auth, cancellation, and redaction coverage; publish badges as statuses where appropriate.
   - [ ] Review `question` and `prompt-suggestions`. Use supported dialogs and editor primitives; do not port the private tree renderer patch.
4. **Execution and policy.**
   - [ ] Review `tool-set` and `ssh` together so tool availability and routing ownership are explicit. Keep `tool-styling` independent and avoid restoring the process-global operations override.
   - [ ] Address SSH path quoting and local-versus-remote search before porting. Remote tools must not silently run locally; historical output should retain the destination used at execution time.
   - [ ] Preserve preceding entries when migrating code that adds session notices; the legacy notice helper replaces earlier proposals.
5. **Telemetry.**
   - [ ] Review `tool-call-stats` and `reasoning-tokens` once producer ownership is clear. Use native tool durations and IDs; distinguish unknown from zero, nested calls from top-level calls, and summed duration from wall-clock time. Keep telemetry out of the shared working message unless ownership is agreed.

## Validation status

- `npm run check` passes after the context-border merge and `copy-command` migration. The new tests cover shell block extraction, TUI navigation and copying, and RPC delivery. A Pi RPC smoke check confirmed package discovery and numbered delivery with whitespace intact.
- All seven tool renderers were smoke-checked through Pi's tool-row component. Package discovery/reload checks passed; automated renderer-specific coverage is still pending.
- The viewer tests cover all three pager-backed commands across pager enable, disable, and session reload. A Pi terminal smoke check verified opening, scrolling, and closing the system prompt pager and opening the loaded-skills report.
- Run `cd pi-v2 && npm run check` before marking the baseline green. For a visual check, run `pi -e ./pi-v2` with duplicate legacy extensions disabled, then use `/reload` after changes.
