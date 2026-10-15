# Standalone agents-browser

Browse the same live registry and persisted Pi/Claude transcripts as `/agents`,
without starting Pi. The daemon must already be running; this browser never starts
it. Registry freshness, identity verification, pane protection, and confirmations
are shared with the native browser.

## Setup

Requires Bun, tmux 3.2+ for popups, and the adjacent `registry/` source and schemas.
Pi and its dependencies are not required for standalone use. From the repository root:

```bash
cd agent-hub/agents-browser
bun install
bun run cli:install
```

The installer creates `~/.local/bin/agents-browser` as an absolute symlink to this
checkout's launcher and makes it executable. Re-running it is safe; existing files
or symlinks belonging to another checkout are never overwritten. Keep the repository
available; this is a source launcher, not a relocatable binary. Ensure Bun and `~/.local/bin`
are on the PATH inherited by tmux (restart/update the server environment if needed).

```bash
agents-browser                    # 90% tmux popup; direct TUI outside tmux
agents-browser --direct           # use this terminal, including inside tmux
agents-browser --directory /path/to/registry
agents-browser --help
```

To uninstall, run `bun run cli:uninstall` from `agent-hub/agents-browser/`.
It removes only this checkout's link, preserving the source and registry state.
Neither install nor uninstall starts the browser or daemon.

The default registry directory is `AGENTS_REGISTRY_DIR`, then
`$XDG_STATE_HOME/agents-registry`, then `~/.local/state/agents-registry`.

## Tmux keybinding

Add to `~/.tmux.conf`, replacing the executable with an absolute path if it is
not on your tmux server's PATH:

```tmux
bind-key a run-shell -b 'agents-browser --socket "#{socket_path}" --pane "#{pane_id}" --client "#{client_name}"'
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
shared. Escape/Ctrl+C/`q` backs out of previews/details or closes the list. The UI
refreshes every two seconds and restores terminal state on exit/signals.

Standalone colors use the terminal's ANSI palette; `NO_COLOR` disables styling.
Pi's active theme and in-memory session branch are not available in this separate
process. All transcripts come from persisted files. Outside tmux the standalone
browser is read-only for pane actions.

## Checks

```bash
cd agent-hub/agents-browser
bun run check
```

## Code organization

This directory owns the shared renderer (`browser.ts`, `view.ts`, `theme.ts`),
registry reader (`reader.ts`), transcript reader (`session.ts`), verified pane
actions (`tmux-actions.ts`), CLI, and popup launcher. Shared code has no dependency
on the Pi coding-agent package or extension directory.

The Pi extension at `../pi/extensions/agents/` contains only command registration
and a native-overlay adapter. It injects Pi's theme and in-memory branch when
using the native fallback; both entry points use the same browser implementation.

Tests here cover the shared renderer, readers, action guards, popup launch, and
real isolated tmux pane operations. Pi-specific command/overlay tests remain in
the Pi package.
