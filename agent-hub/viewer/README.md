# Standalone agents-viewer

Browse the same live registry and persisted Pi/Claude transcripts as `/agents`,
without starting Pi. The daemon must already be running; this browser never starts
it. Registry freshness, identity verification, pane protection, and confirmations
are shared with the native browser.

## Setup

Requires Node.js 22.18+, npm 10+, Bun 1.3+, and tmux 3.2+ for popups.
The browser consumes the registry package APIs and schemas; a running Pi process
is not required for standalone use. From the repository root:

```bash
cd agent-hub
npm ci
npm run build
npm run cli:install --workspace @agent-hub/viewer
```

The installer creates `~/.local/bin/agents-viewer` as an absolute symlink to this
checkout's launcher and makes it executable. Re-running it is safe; existing files
or symlinks belonging to another checkout are never overwritten. Keep the repository
available; this is a source launcher, not a relocatable binary. Ensure Bun and `~/.local/bin`
are on the PATH inherited by tmux (restart/update the server environment if needed).

```bash
agents-viewer                    # 90% tmux popup; direct TUI outside tmux
agents-viewer --direct           # use this terminal, including inside tmux
agents-viewer --directory /path/to/registry
agents-viewer --help
```

To uninstall, run `npm run cli:uninstall` from `agent-hub/viewer/`.
It removes only this checkout's link, preserving the source and registry state.
Neither install nor uninstall starts the browser or daemon.

The default registry directory is `registry/` inside `$AGENT_HUB_DIR`, then
`$XDG_STATE_HOME/agent-hub`, then `~/.local/state/agent-hub`.

## Tmux keybinding

Add to `~/.tmux.conf`, replacing the executable with an absolute path if it is
not on your tmux server's PATH:

```tmux
bind-key a run-shell -b 'agents-viewer --socket "#{socket_path}" --pane "#{pane_id}" --client "#{client_name}"'
```

Reload the tmux config, then use **prefix + a** from any shell or agent. The
launcher calls `tmux display-popup -E -w 90% -h 90%` and passes the invoking socket,
pane, and client into the standalone process. The popup is not treated as an
ordinary pane. Split moves target the original pane; attach switches only the
invoking client and closes the browser after success. A missing/moved client
cannot silently redirect another client. Kill/split cannot target the origin pane.

`/agents` also opens this popup when Pi runs inside tmux. Outside tmux, `/agents`
retains its native Pi overlay. Popup launch failures are reported rather than
silently switching UI modes.

## Controls and limitations

See [browser controls](../docs/agents-pi.md#controls). List navigation, live
transcript previews, metadata, refresh, split, attach, and kill confirmations are
shared, as are `/` filtering and Tab group jumps. Escape/Ctrl+C/`q` backs out of
previews/details/filters or closes the list. The UI refreshes every two seconds, animates
activity glyphs only while an agent is busy or waiting, and restores terminal state on
exit/signals.

Standalone colors use the terminal's 16-color ANSI palette, plus a subtle 256-color
selected-row highlight when `TERM`/`COLORTERM` advertise it. Harness badges use Pi purple
and Claude orange (truecolor, 256-color, or magenta/yellow fallback, matching Pi's color
mode in the native overlay); `NO_COLOR` disables styling.
Pi's active theme and in-memory session branch are not available in this separate
process. All transcripts come from persisted files. Outside tmux the standalone
browser is read-only for pane actions.

## Checks

```bash
cd agent-hub
npm run build
npm run check --workspace @agent-hub/viewer
```

## Code organization

This directory owns the shared renderer (`browser.ts`, `view.ts`, `theme.ts`),
registry reader (`reader.ts`), transcript reader (`session.ts`) and its Markdown/metrics
rendering (`transcript.ts`), verified pane
actions (`tmux-actions.ts`), CLI, and popup launcher. Shared code has no dependency
on the Pi coding-agent package or extension directory.

The Pi extension at `../pi/extensions/agents/` contains only command registration
and a native-overlay adapter. It injects Pi's theme and in-memory branch when
using the native fallback; both entry points use the same browser implementation.

Tests here cover the shared renderer, readers, action guards, popup launch, and
real isolated tmux pane operations. Pi-specific command/overlay tests remain in
the Pi package.
