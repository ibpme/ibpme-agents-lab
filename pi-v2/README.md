# Pi extensions, v2

Incremental reimplementation of `../pi`, targeting Pi 1.5.2 for development.
The original package remains unchanged. Only migrated extensions belong in this package.

## Try it without installing

From the repository root:

```bash
pi -e ./pi-v2
```

This uses Pi's native package manifest and TypeScript loader. No build step or
runtime dependency installation is needed for these extensions. Disable the old
`alias`, `stash`, `thinking-cycle-backward`, `thinking-style`, `status-line`,
`readmd`, `system-prompt`, `loaded-skills`, `copy-command`, and `stylish-tools`
extensions before loading their v2 replacements. `tool-styling` replaces
`stylish-tools`. Duplicate commands receive invocation suffixes such as
`/clear:1` and `/clear:2`; duplicate shortcuts conflict.

For persistent use, after disabling the original versions of these extensions:

```bash
pi install /absolute/path/to/ibpme-agents-lab/pi-v2
```

Use `/reload` after source changes. This package does not install symlinks,
modify keybindings, or change existing settings automatically.

## Current commands

| Command | Behavior | Pi primitive |
| --- | --- | --- |
| `/exit` | Request graceful shutdown; Pi owns timing and cleanup | `ctx.shutdown()` |
| `/clear` | Start a new session, preserving the previous saved session | `ctx.newSession()` |

Both commands ignore arguments, matching the original extension. `/clear`
awaits the session operation, respects cancellation, and performs no work on the
old context after replacement. It is not a transcript-deletion command.
Errors are left to Pi's command handling; no extra confirmation or notification
policy is added here. Shutdown timing and headless behavior are owned by Pi.

These are convenience commands, not a general-purpose command-alias engine.
They call documented primitives instead of sending `/new` or `/quit` as user
messages or trying to transform slash commands through the `input` event.

## Session viewers

| Command | Content |
| --- | --- |
| `/readmd` | Renders the latest assistant response with text on the active branch as Markdown. Mermaid blocks appear as fenced code. |
| `/system-prompt` | Shows the effective system prompt and an approximate token count. Use `/system-prompt append` for the configured append prompt alone. |
| `/loaded-skills` | Lists skill files observed on the active branch and estimates their current file token counts. The `loaded-skills` status lists their names. |

The package loads `pager` by default. It supplies these three viewers with a
border, a line counter, and `j`/`k`, `gg`, and `G` navigation. Each command has its own
scrollable viewer when `pager` is disabled. Disable `extensions/pager/index.ts`
with `pi config` and reload, or add `"-extensions/pager/index.ts"` to the
installed package's `extensions` filter. The next command invocation uses the
viewer selected after reload. In RPC, the commands use Pi's text editor dialog
to present the content and discard edits. In print and JSON modes they return
without opening a viewer.

## Copy shell blocks

`/copy-command` starts at the newest assistant reply with a shell block on the
active session branch. Use `↑`/`↓` to select a block, `h`/`←` and `l`/`→` to
browse replies, and `Enter` to copy. `Esc` or `Ctrl+C` cancels. The picker
remembers your selection in each reply. Use `/copy-command 2` to select the
second block in the newest reply with commands directly.

Each closed `bash`, `sh`, `shell`, `zsh`, or `console` fence is one block. The
picker previews the first non-blank line and copies the full Markdown code body,
including indentation, blank lines, and trailing spaces inside the fence.
`console` blocks include any prompts and output from the original block.

In the terminal, Pi writes to the clipboard, including terminal clipboard
forwarding where supported. In RPC, **Older reply** and **Newer reply** are
selection entries, and the chosen block opens in the client's text dialog for
manual copying. The picker works independently of `pager`.

## Shortcuts

| Extension | Shortcut | Behavior |
| --- | --- | --- |
| `stash` | `ctrl+s` | Stash, restore, or swap the editor draft |
| `thinking-cycle-backward` | `shift+left` | Select the previous supported thinking level, wrapping to the highest |

### Stash

Stash preserves exact editor text, including whitespace, Unicode, and multiple
lines. If a draft is already stashed, the shortcut restores it and stashes any
current nonempty draft in its place. An empty editor with no saved draft is a no-op.

After submitting an intervening interactive prompt, stash automatically restores
when `agent_settled` fires, but only if the editor is still empty. If you started
another draft, that draft is never overwritten and the saved draft remains
available through the shortcut. RPC and extension-injected input do not arm
automatic restoration. Slash commands that bypass Pi's `input` event do not arm
it either. Stash is TUI-only and in-memory: session replacement and `/reload`
clear it. It adds no footer indicator, session metadata, or model messages.

### Backward thinking cycle

The extension asks Pi's `getSupportedThinkingLevels()` for the current model's
levels on every invocation; no provider-specific level list is maintained here.
It uses `pi.setThinkingLevel()` and reports the effective level returned by Pi,
so Pi remains responsible for clamping, persistence, and thinking-level events.
A missing or non-reasoning model leaves the level unchanged. Forward cycling
remains Pi's built-in `app.thinking.cycle` action; this package does not remap it.

### Shortcut registration

Both extensions register literal keys directly with `pi.registerShortcut()`.
They do not read or write `keybindings.json`. The old extension-owned settings
`extensions.stash.toggle` and `extensions.thinking.cycleBackward` are no longer
supported; they cannot remap or disable these shortcuts. Disable the extension
through Pi's package resource selection if needed.

Pi handles shortcut conflicts. The retained `ctrl+s` shortcut overlaps Pi's
picker-specific save/sort bindings. This package does not change those bindings
or register a separate named action for remapping.

## Thinking style

`thinking-style` customizes Pi's native working indicator while retaining the
original thinking-block Markdown styling:

- Thinking streams use `["·", "•", "●", "•"]` frames at 120 ms through
  `ctx.ui.setWorkingIndicator()`, colored with the theme's thinking-level border
  color. The text `Thinking` is passed unstyled to `ctx.ui.setWorkingMessage()`
  so Pi retains control of message coloring. Repeated thinking deltas do not restart it.
- Thinking completion, text generation, and tool-call generation restore Pi's
  default indicator and working message by calling both setters without arguments.
- Assistant completion, turn boundaries, agent settlement (including abort),
  and session teardown also restore the default if the thinking pulse is active.
- Pi owns animation, rendering, and working-row visibility. There are no custom
  timers, widgets, or editor replacements.
- On session start, collapsed thinking blocks are globally labeled `Thought` via
  `ctx.ui.setHiddenThinkingLabel("Thought")`. The fixed label has no timing or animation.
- `registerMarkdownTransformer()` is explicitly scoped to `assistant-thinking`.
  Each line is prefixed as a Markdown blockquote, including blank lines; normal
  assistant responses and user messages are unaffected. This is display-only.

Indicator customization is TUI-only; RPC, JSON, and print modes do not access UI
methods. Another extension that changes working-indicator frames or working-message
text (such as the original agent statistics extension) would compete for the same
Pi-owned surface; disable one of the conflicting extensions.

## Tool styling

`extensions/tool-styling/` replaces the old `stylish-tools` presentation without
replacing any tool implementation. It uses Pi 1.5.2's `registerToolRenderer()` for
exactly `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`; other tool names
continue through Pi's renderer chain. These seven names deliberately use this
extension's renderers instead of their stock rendering.

- Compact call labels, paths, skill-read labels, and relevant arguments.
- Collapsed previews: read 3 lines, write 10, grep 15, find/ls 20; bash shows its
  last 5 lines. Hidden-line counts include the user's native expand-key hint.
- Expanded output uses the old colored dot/gutter style and shows all returned
  text, wrapping to the available width. Completed edit diffs remain visible
  without expanding, with added/removed line counts.
- Streaming results show `running`; final results show `done` or `failed`.
  Durations come only from native `context.durationMs`. Missing durations are
  omitted, not estimated or shown as zero. No timers or shared working-message
  ownership are introduced.
- Errors, native truncation/limit warnings, and saved full-output paths remain
  visible. Read images remain Pi-owned; styling adds an image summary rather
  than decoding or replacing image data. Self-shell rendering respects `outputPad`.

The extension does not register tools, activate deferred tools, change schemas,
rewrite results, execute commands, read files for previews, or route operations.
Native execution retains shell settings, cancellation, streaming, and truncation.
There is no operations-override registry or SSH dependency. Remote names such as
`read_remote` are not styled automatically; SSH execution and policy migration
remain separate work. If another extension replaces execution under one of the
seven names, this extension does not undo that replacement—disable the original
`stylish-tools` before trying this version.

No new tool-styling tests are included in this visual pass. The existing package
loader/reload tests and TypeScript checking validate registration and loading;
renderer-specific coverage remains follow-up work.

## Modular status footer

`status-line` owns only the footer. It renders the rows selected in
`statusline.json`; there are no forced Pi-default rows and no widget placement.

### Default segments

Built-in content is grouped under `extensions/status-line/default-segments/`.
Each module owns its formatting and theme colors, following the original status
line rather than rebuilding Pi's native footer:

| Module | Selectors | Behavior |
| --- | --- | --- |
| `location.ts` | `cwd`, `git`, `session` | Bold accent cwd with home abbreviation; dim `on ` plus green `⎇ branch`; dim bullet plus muted session name |
| `usage.ts` | `tokens`, `cost` | Latest assistant's input/output/cache counts; accumulated assistant cost on the selected branch, with the original OAuth subscription marker |
| `model.ts` | `model`, `thinking` | Bold accent `provider/model` and theme-colored thinking level |

There is no `default-rows.ts` or `default-color.ts`. Change a module to change
its presentation; change the JSON layout to move, select, or omit its segments.

Usage retains the old footer's semantics: tokens are for the latest assistant
response, not cumulative; cost covers assistant messages on the selected branch,
not all session entries or tool/compaction usage. The snapshot is lazy and cached
between redraws. Omitting `tokens` and `cost` avoids scanning history entirely.
Session, leaf, and lifecycle changes invalidate the snapshot. No timing or live
reasoning tracking is introduced; see `NOTE.md` for future telemetry constraints.

### Independent status producers

Other extensions publish movable, colored text through Pi's existing primitive:

```ts
ctx.ui.setStatus("tool-stats", "12 calls · 3.2s");
ctx.ui.setStatus("ssh", ctx.ui.theme.fg("success", "production"));
ctx.ui.setStatus("ssh", undefined);
```

The footer selects `status:<key>` without importing the producer or requiring
custom registration. Status updates use Pi's native redraw mechanism. Producer
colors remain intact, and disabling the footer does not clear producer statuses.

### Context usage

`extensions/context-usage/index.ts` displays context usage in the **top-right
editor border**. It extends Pi's `CustomEditor` through
`ctx.ui.setEditorComponent()` and the protected `renderTopBorder()` hook.
The left side displays Pi's native working status. The extension inherits Pi's
input handling, shortcuts, autocomplete, and scrolling. The border works with
either the modular or native footer.

The label uses a four-cell bracketed bar with partial blocks, a rounded
percentage, and compact used/capacity tokens. For example, `[    ] 0% 0/272k`
becomes `[█▊  ] 45% 122k/272k`. Colors are `success` normally,
`warning` above 40%, and `error` above 70%. Unknown values display `?`
instead of claiming zero utilization. It refreshes on session/response/turn,
compaction, tree, and model events; there is no timer. The border styles raw cached
usage with the current theme during rendering. At narrow widths, it drops the bar,
then token counts, then the entire context label to leave room for native status
and the hidden-line cue. Shutdown restores the default editor only if this
extension still owns the editor factory. If another custom editor is already
installed, the extension warns and skips installation. The display is TUI-only.

### Configure placement

Create either file yourself; the extension never writes configuration:

- Global: `<agent-dir>/statusline.json`, normally `~/.pi/agent/statusline.json`.
  `PI_CODING_AGENT_DIR` is respected.
- Project: `<cwd>/.pi/statusline.json`, read only for trusted projects. It replaces
  the whole global layout; there is no partial merge.

```json
{
  "footer": [
    {
      "left": ["cwd", "git", "status:ssh", "session"],
      "right": ["status:prompt-suggestions"]
    },
    {
      "left": ["tokens", "status:agent-stats", "cost"],
      "right": ["model", "thinking", "status:openai-fast"],
      "separator": " · ",
      "rightSeparator": " • "
    },
    { "left": ["status:*"], "separator": " · " }
  ],
  "hidden": []
}
```

The bundled default composition and `statusline.example.json` additionally
place optional mode, reasoning, tools, skills, and MCP statuses. These are just
producer keys: missing producers render nothing. Tool inventory generation and
live reasoning statistics are not migrated as part of this footer.

- Every row is configurable. `{"footer": []}` produces an empty footer.
- A status-only layout displays only statuses; built-in rows are not prepended.
- `status:*` includes remaining unplaced, non-hidden statuses, sorted by key.
  Explicit selectors take precedence regardless of row order. Only one wildcard
  is allowed, and it is never inserted implicitly into a custom layout.
- `hidden` contains exact status keys without the `status:` prefix. It applies
  to published statuses, not the built-in selectors; omit a built-in to hide it.
- `left` and `right` order their segments. `separator` defaults to one space;
  `rightSeparator` optionally overrides it on the right. Missing/empty segments
  and empty rows disappear without dangling separators.
- Right-hand content is right-aligned and prioritized during overflow. Rows are
  clipped, not wrapped, using ANSI-aware and wide-Unicode-aware display widths.
- Unknown selectors/options, duplicate selectors, and invalid JSON warn and fall
  back to the bundled old-style composition. Missing config uses that composition.
- Rich-widget layout is deferred. `aboveEditor` and `belowEditor` no longer
  support content; empty legacy arrays are accepted and ignored for compatibility.

**Updating from the earlier v2 draft:** remove the editor-region keys and explicitly
select the built-ins you want. A previous file containing only `status:*` will
now intentionally show only published statuses. Copy the bundled example to your
chosen config path to use the old-style composition. Existing files are not
rewritten automatically.

| Command | Behavior |
| --- | --- |
| `/statusline` | Toggle the compositor; disabling restores Pi's native footer |
| `/statusline reload` | Reload configuration and enable the compositor |

Only one footer owner should be enabled. This extension owns its custom footer and
Git subscription, but never changes widgets, working messages, indicators,
producer statuses, or model content. There are no private UI patches, process-wide
registries, or polling timers.

## Layout

```text
pi-v2/
├── package.json                 # Explicit list of extension entry points
├── package-lock.json            # Reproducible development dependencies
├── tsconfig.json                # Strict checking; no emitted JavaScript
├── extensions/
│   ├── alias/index.ts
│   ├── context-usage/index.ts
│   ├── copy-command/
│   ├── loaded-skills/
│   ├── pager/index.ts
│   ├── readmd/index.ts
│   ├── shared/                    # Pager lookup and document viewport
│   ├── stash/index.ts
│   ├── status-line/               # Layout/config, default-segments/, lifecycle
│   ├── system-prompt/index.ts
│   ├── thinking-cycle-backward/index.ts
│   ├── thinking-style/index.ts
│   └── tool-styling/              # Renderer registration, per-tool views, formatting
└── tests/
    ├── alias.test.mjs            # Real package discovery/reload + alias commands
    ├── context-usage.test.mjs
    ├── copy-command.test.mjs
    ├── stash.test.mjs
    ├── status-line.test.mjs
    ├── thinking-cycle-backward.test.mjs
    ├── thinking-style.test.mjs
    ├── viewers.test.mjs          # Viewer selection across a real Pi session reload
    └── extension-fixture.mjs     # Shortcut/event registration recorder
```

### Organization principles

- **One directory per capability.** Start with `index.ts`; split implementation
  files only when there is meaningful complexity to hide. Keep each extension
  independently loadable where possible.
- **Pi is the host, not something to wrap.** Use native commands, lifecycle
  events, session entries, tool operations, and UI primitives directly. Do not
  introduce an extension base class, custom loader, or parallel lifecycle.
- **Explicit discovery.** `pi.extensions` names entry points, so tests and future
  helpers cannot accidentally become extensions. Pi settings can filter which
  package resources load; disabling an extension need not edit the manifest.
- **Locality before sharing.** Keep implementation inside its owning extension.
  Add a shared module only for an actual repeated need; do not copy the old
  `shared/` or `contracts/` directories wholesale.
- **No hidden cross-extension state.** Avoid process-global service registries
  and imports of another extension's entry point. Revisit cooperation explicitly
  when migrating capabilities that genuinely need it, using Pi primitives where
  suitable rather than assuming module instances are shared.
- **Host packages stay host-provided.** Declare Pi imports as peers and pin copies
  only for development. Add runtime dependencies only when an extension actually
  needs them. The migrated extensions have none.
- **Test observable behavior.** Integration tests discover and reload this package
  through `DefaultResourceLoader`. Behavior tests exercise registered commands,
  shortcuts, and lifecycle handlers with minimal contexts. They do not simulate
  Pi's session persistence or shutdown internals; those remain host responsibilities.

## Migration plan

See [plan.md](plan.md) for completed migrations, behavior changes, commit and
branch checkpoints, deferred work, and the remaining checklist.

## Development

Requires Node.js 22.18+ and npm.

```bash
cd pi-v2
npm ci
npm run check
```

`check` runs TypeScript checking and native Node tests covering package discovery
and reload, alias commands, stash restoration/swap/lifecycle behavior, supported
thinking levels, direct shortcut registration, thinking-indicator lifecycle, and
Markdown styling, selectable old-style footer segments, configurable status placement,
context-border rendering and cleanup, shell block selection and RPC delivery,
and footer lifecycle/cleanup. Loader tests use temporary agent directories,
not personal settings, and make no model requests. Test files use JavaScript so
Node can run them without a transpilation tool or custom test runner. Extension
source uses erasable TypeScript syntax so direct test imports work on Node 22.18+
and Node 26 without the removed `--experimental-transform-types` flag.

## References

- [Extension documentation](https://docs.pi.dev/latest/extensions)
- [Package documentation](https://docs.pi.dev/latest/packages)
- The installed Pi 1.5.2 `docs/extensions.md`, `docs/packages.md`, and
  `examples/extensions/shutdown-command.ts` were also consulted for the scaffold.
