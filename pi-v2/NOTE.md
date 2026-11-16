# Timing and transcript UI constraints

Notes for future thinking-duration and tool-call statistics migrations. Verified
against Pi 1.5.2; recheck upstream APIs before implementing these features.

## Native transcript rendering stays native

- Keep Pi's thinking blocks. Do not replace transcript rendering or monkey-patch
  private UI components just to add durations.
- `ctx.ui.setHiddenThinkingLabel(text)` is global: it updates existing rendered
  assistant components and the streaming component, not a specific message or
  thinking block. There is no message/block ID argument.
- A label such as `Thought for 1m23s` would therefore incorrectly relabel older
  blocks with the latest duration.
- `registerMarkdownTransformer()` affects expanded thinking Markdown. Collapsed
  labels bypass that transformation, so it cannot provide per-block labels.
- Current behavior: `thinking-style` sets the fixed global label `Thought` on
  TUI session start. No thinking-duration counter is implemented.
- Revisit historical per-block labels only if Pi exposes a supported per-block
  labeling/rendering primitive. Accurate historical thinking timing also needs
  persisted per-block timing metadata.

## What timestamps actually measure

| Data | Meaning | Limitation |
| --- | --- | --- |
| Session entry `timestamp` | Entry timestamp as an ISO string | Not a timestamp for each content block |
| Assistant message `timestamp` | Request start, Unix milliseconds | Not the start of each thinking block |
| Assistant message `durationMs` | Whole response duration measured with a monotonic clock | Optional; not thinking-only time |
| Tool-result message `timestamp` | Result creation, Unix milliseconds | Not tool execution start |
| Tool-result message `durationMs` | Tool execution duration measured with a monotonic clock | Optional, including absence on legacy results |
| Thinking content block | Thinking content and optional provider metadata | No native per-block timestamp or duration |

An assistant message can contain multiple thinking, text, and tool-call blocks.
Thinking blocks are not separate session entries. Adjacent entry timestamp gaps
can include request setup, network delay, reasoning, text generation, tool work,
and other waiting. Do not present those gaps as precise thinking or tool-execution
time. Whole-response duration could be labeled as response duration, not
`Thought for ...`.

## Future tool-call statistics

- Prefer native timing over adding a second timing framework:
  `tool_execution_end.durationMs` records how long `execute()` took. It can be
  absent when the tool did not run. Persisted tool-result `durationMs` can support
  historical statistics when available.
- Preserve unavailable timing as unknown, not zero. Do not reconstruct exact
  durations from adjacent transcript entries.
- Correlate start/end events and results by `toolCallId`, not tool name or entry
  adjacency. Consider `parentToolCallId` for nested calls; define whether totals
  include nested execution to avoid double-counting.
- Distinguish summed execution durations from wall-clock elapsed time: overlapping
  calls and nested executions can make these totals differ.
- If thinking-only timing is later needed, observe `thinking_start` /
  `thinking_end` and use a monotonic clock such as `performance.now()`. This
  measures observed streaming time, not necessarily the provider's full internal
  reasoning time. Computing a final duration needs timestamps, not `setInterval()`.
- Handle errors, aborts, missing end events, session changes, and reloads explicitly.
  Persist extension-owned measurements only if historical display requires them,
  using supported session metadata APIs rather than modifying model content.

## Shared UI ownership

- `ctx.ui.setWorkingIndicator()` controls working-indicator frames;
  `ctx.ui.setWorkingMessage()` controls its text. Both are shared surfaces, not
  extension-specific slots. Calling either without arguments restores Pi's
  default, not another extension's previous customization.
- Current `thinking-style` owns both while reasoning: colored pulse frames and
  plain `Thinking` text; it resets both when thinking ends and on lifecycle safety
  boundaries. Pi owns animation and visibility.
- Tool-call statistics must not independently overwrite the same working message
  without an explicit ownership decision. Prefer an independent status/widget or
  agree on composition when migrating, rather than introducing a global registry.
- Custom indicator frames are rendered verbatim. Thinking-style colors its frames
  through `theme.getThinkingBorderColor(pi.getThinkingLevel())`; message coloring
  remains native.
- UI customization is TUI-only. Do not emit plain output to RPC stdout or assume
  `ctx.hasUI` means the mode is the interactive terminal.

## Sources to recheck

- Installed `docs/extensions.md` and `docs/keybindings.md`.
- `@earendil-works/pi-coding-agent`: extension event/context types, session entry
  types, and interactive-mode hidden-label setter.
- `@earendil-works/pi-ai`: assistant message, thinking content, and tool-result
  message types.

## Footer composition decision

The v2 compositor now has selectable `default-segments/` and published
`status:<key>` selectors; it no longer injects Pi-default rows. Each default
segment module owns its formatting and theme colors. Current usage segments
preserve the old footer's latest-assistant tokens and selected-branch assistant
cost semantics; these must not be mistaken for full-session or tool-call totals.
The independent `context-usage` extension's above-editor widget version is
checkpointed in `c3abc24`. The current preview instead subclasses `CustomEditor`
to place context usage in the top-right editor border. It inherits native input
handling and uses the protected top-border hook, with embedded native working
status on the left. It skips installation when another custom editor already owns
the editor. Footer toggles and `statusline.json` do not control this presentation.
Tests for this preview are intentionally deferred pending visual approval.

Rich-widget layout/registration is deferred. `statusline.json` currently controls
footer rows only; do not introduce a custom widget registry for single-line
status text. Native editor widgets remain independent. Revisit centralized widget
placement only when a real multiline or interactive use case requires it.
