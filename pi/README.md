# pi extensions

Extensions for [Pi](https://docs.pi.dev/latest/extensions) 1.5.2, loaded as one package. `pi.extensions` in
`package.json` lists the entry points; remove a line to disable one.

## Install

```bash
pi/install.sh            # npm ci, link into ~/.pi/agent/extensions, add missing keybindings
pi/install.sh --remove   # remove the link
pi -e ./pi               # try without installing
```

Run `/reload` in Pi after source changes. `install.sh` binds `app.thinking.cycle` to `shift+right` (only if unset)
so `tool-control` can use `shift+tab`.

## Extensions

| Extension | Provides |
| --- | --- |
| `alias` | `/exit`, `/clear` (new session) |
| `stash` | `ctrl+s` stash/swap the editor draft |
| `thinking-cycle-backward` | `shift+left` cycles thinking level backward |
| `thinking-style` | Colored thinking indicator, `Thought` label |
| `agent-stats` | `/agent-stats` turn/tool timing report; reasoning-token footer status |
| `status-line` | Configurable footer (`statusline.json`); `/statusline [reload]` |
| `context-usage` | Context usage bar in the editor border |
| `copy-command` | `/copy-command` copies a shell block from replies |
| `openai-accounts` | `/login openai:<label>`, `/account` switches labeled OpenAI logins |
| `fast` | `/fast [on\|off]` OpenAI priority tier |
| `usage` | `/usage [provider]` quota reports |
| `tool-styling` | Compact renderers for built-in tools |
| `tool-control` | `/safe`, `/yolo`, `shift+tab`; `/tools` viewer |
| `readmd`, `system-prompt`, `loaded-skills` | Inspection viewers |
| `pager` | Optional full-screen pager for the viewers |
| `prompt-suggestions` | `/suggestions [on\|off]`, Tab inserts the suggested follow-up |
| `question` | `question` tool for choices or written answers; `/reanswer` |
| `ssh` | `/ssh user@host[:/path]`, `/ssh off`, `--ssh`; seven deferred `*_remote` tools |

## Configuration

Files live in `~/.pi/agent/` (`PI_CODING_AGENT_DIR` is respected); run `/reload` after editing.

- `statusline.json` — footer rows; see `statusline.example.json`. A trusted project's `.pi/statusline.json`
  replaces it.
- `prompt-suggestions.json` — `enabled`, `provider`, `model`, `ollamaUrl` (env: `PI_SUGGESTIONS_*`).
- `openai-accounts.json` — `labels` array (default `["work"]`).

SSH search needs `rg` and `fd` on the remote host. The interactive SSH auth modal needs the optional `node-pty`
dependency.

## Development

Requires Node.js 22.18+.

```bash
cd pi && npm ci && npm run check
```
