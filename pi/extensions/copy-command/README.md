# Copy command

Run `/copy-command` to open a simple list built with Pi's `SelectList`, `Text`, and `Container` primitives, showing commands from the newest assistant reply containing shell blocks.

- **↑ / ↓** select a command; **Enter** copies it.
- **h / ←** browses older replies; **l / →** browses newer replies.
- **Esc / Ctrl+C** cancels.

Reply navigation stops at the oldest/newest reply and remembers the selected command in each reply. RPC sessions use Pi's selection dialog with **Older reply / Newer reply** menu entries instead of keyboard shortcuts.

No preview pane or custom scrolling implementation. Multiline blocks show their first line and a line count; choosing one copies the entire block. Each shell fence is one copyable block. Commands are never executed.

`/copy-command 2` copies block 2 from the newest reply containing commands directly. Non-interactive sessions require a block number. History follows the current session branch.

Supported fences: `bash`, `sh`, `shell`, `zsh`, and `console`. Cleanup removes outer blank lines, shared indentation, and trailing whitespace per line. Internal indentation and line breaks remain. This is formatting cleanup, not a shell parser: whitespace in quoted multiline data or heredocs can be meaningful. Console prompts and output are not stripped.

Clipboard writing uses `pbcopy` on macOS, `clip.exe` on Windows, or `wl-copy`, `xclip`, then `xsel` on Linux. Linux needs a reachable desktop clipboard. On SSH, clipboard utilities access the host running Pi, not necessarily your local desktop.
