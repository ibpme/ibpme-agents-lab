# pi extensions

pi extensions, one directory each under `extensions/`, loaded as a single package.

## Install

```bash
pi/install.sh            # link this package into ~/.pi/agent/extensions/ibpme-agents-lab
pi/install.sh --remove   # remove the link
```

The package loads as one unit: `pi.extensions` in `package.json` lists the entry points, so delete a line to
disable an extension. Run `/reload` in pi after changes.

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
| `tool-set` | Tool sets and modes | shared: pager, tool-guard, tool-status; contracts: status-keys |
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
bun install
bun run check      # typecheck + tests + real-loader test
```

Pi loads TypeScript through jiti, so there is no build step. Relative imports carry an explicit `.ts` extension.

## Configuration

Extensions create their own config under `~/.pi/agent/` when needed; nothing is installed for them.
`prompt-suggestions` reads `~/.pi/agent/prompt-suggestions.json` (written when you toggle suggestions) with keys
`enabled`, `provider`, `model` and `ollamaUrl`. Missing keys fall back to built-in defaults, and
`PI_SUGGESTIONS_PROVIDER`, `PI_SUGGESTIONS_MODEL` and `PI_SUGGESTIONS_OLLAMA_URL` override the file.
