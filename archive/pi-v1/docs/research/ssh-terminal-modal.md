# SSH authentication in a Pi terminal modal

## Conclusion

A terminal inside a Pi modal is feasible. Pi supplies the overlay, focus, input,
rendering, and disposal hooks, but the inspected public exports do not supply an
embedded process terminal or PTY. A true terminal modal therefore requires a PTY
and a terminal-state renderer in addition to Pi's overlay. This is different from
opening an OS terminal window, and does not require suspending Pi's UI. [1][2][3]

This note records the original feasibility investigation. The subsequent
implementation is in `pi/extensions/ssh/auth-terminal.ts` and `auth.ts`, using
`node-pty` and `@xterm/headless`. Its real-OpenSSH integration test verifies
password echo suppression and master survival after modal PTY disposal.

The investigation inspected installed Pi 1.4.0 documentation/examples and this
project's Pi 1.3.0 dependency declarations/source. Both expose the relevant
overlay interface.

## Supported building blocks

- `ctx.ui.custom(factory, { overlay: true, overlayOptions })` supplies a focused
  overlay. Options include width, maximum height, centered anchoring, and margins.
  Components implement `render(width)`, `handleInput(data)`, and `invalidate()`;
  extension-created components may implement `dispose()`. [1][2]
- Pi's official DOOM overlay demonstrates asynchronous updates, keyboard handling,
  redraw requests, and resource cleanup without stopping Pi's renderer. It is not
  itself a terminal emulator. [3]
- `node-pty` launches a process with a pseudoterminal and exposes `onData`,
  `onExit`, `write`, `resize`, and `kill`. It supports macOS, Linux, and Windows,
  but is a native dependency with platform/build requirements. PTY portability
  does not imply that our OpenSSH control-socket transport supports Windows. [4]
- `@xterm/headless` runs a terminal emulator in Node.js. Its declarations expose
  terminal buffers, cell access, resizing, and data ingestion. A Pi renderer
  would still need to map the emulator's visible cells and cursor to Pi lines;
  it is not a ready-made Pi component. [5][6]

## Recommended structure

```text
Pi focused overlay
    keyboard -> input normalization -> PTY -> OpenSSH
    screen   <- safe cell renderer  <- terminal emulator <- PTY output
```

1. Preserve the current non-interactive authentication attempt.
2. When interaction is needed, open a centered authentication-only overlay.
3. Spawn OpenSSH directly with an argument array in a PTY, not via a shell.
   Reuse the private control-socket bootstrap flags from the current transport.
4. Feed PTY output to the emulator and request Pi redraws. Render only bounded
   visible cells and approved styling, not raw child escape sequences.
5. Forward normalized user input to the PTY. Do not use Pi's editor as a password
   field. OpenSSH/PTY termios should control password echo.
6. On successful bootstrap exit, verify that the master survives disposal of the
   authentication PTY, verify a command through its socket, then activate tools.
7. Cancel, timeout, disposal, and session shutdown must kill the bootstrap,
   close any owned master created by a race, and dispose emulator/listeners.

The current `AuthenticateInteractively` callback in `extensions/ssh/auth.ts`
provides a natural seam: replace its terminal-handoff implementation without
rewriting remote file or bash operations. Existing lifecycle concerns, especially
CLI startup failure and orphaned-master lifetime, still require separate fixes.

## Correctness and security requirements

- A plain pipe is insufficient: OpenSSH normally reads interactive credentials
  from a controlling terminal. A PTY provides that terminal. [4][7]
- Never forward raw child control sequences to Pi's outer terminal. Pi components
  render bounded lines, so cursor movement, screen clearing, and other terminal
  effects must be interpreted inside the embedded screen. [1][6]
- Normalize Kitty/extended keyboard input and bracketed paste for the child's
  terminal protocol. Pi exposes keyboard parsing helpers; forwarding every raw
  event unchanged is not a sufficient design. [1][2]
- Resize both the PTY and emulator to the modal's inner dimensions; preserve
  correct cursor placement and wide-character handling. [1][4][6]
- Keep host-key checking enabled and display the complete fingerprint. Do not
  infer successful authentication by matching prompt text.
- Do not log keystrokes, record input in session entries, or send it to the model.
  Unlike the current inherited-terminal approach, the PTY bridge necessarily
  handles password keystrokes transiently inside the Pi process. No claim that
  Pi never handles credential bytes would be accurate for this design.
- A modal is a UX feature, not isolation from other trusted extensions or other
  code running as the same OS user. `node-pty` explicitly runs children with the
  parent's permissions. [4]

## Required validation before adoption

Use a real local test SSH server and an interactive Pi session to exercise:
password success/retry/failure; key passphrases; host-key acceptance and changed
keys; keyboard-interactive MFA; Unicode passwords; paste; backspace; resize;
Ctrl-C/Escape; timeout; reload/shutdown; and master survival after PTY disposal.
Also verify missing sockets cannot cause fresh tool-side authentication, input
never reaches the normal editor, and no credentials appear in saved transcripts.

A small authentication-only modal is recommended before attempting a general
shell terminal (vim, tmux, mouse protocols, full scrollback, etc.).

## Sources

1. Pi Terminal UI documentation: installed `docs/tui.md` under
   `/Users/budi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/`;
   upstream: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md>.
2. Inspected project declarations: `pi/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
   (`ExtensionUIContext.custom`), `pi/node_modules/@earendil-works/pi-tui/dist/tui.d.ts`,
   and `pi/node_modules/@earendil-works/pi-tui/dist/index.d.ts`.
3. Official installed examples: `examples/extensions/doom-overlay/index.ts` and
   `doom-component.ts` under the same Pi 1.4.0 package;
   <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/doom-overlay>.
4. node-pty official README and declarations:
   <https://github.com/microsoft/node-pty>;
   <https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts>.
5. xterm.js official README, Node.js Support:
   <https://github.com/xtermjs/xterm.js#nodejs-support>.
6. xterm.js headless declarations:
   <https://github.com/xtermjs/xterm.js/blob/master/typings/xterm-headless.d.ts>.
7. OpenSSH manual, SSH_ASKPASS / terminal password entry:
   <https://man.openbsd.org/ssh>.
