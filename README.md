# ibpme-agents-lab

Agent skills, Pi extensions, and an agent hub.

| Path | Contents |
| --- | --- |
| [`skills/`](skills) | `brainstorm`, `commit`, `context7-mcp`, `prompt-sharpen`, `to-full-markdown` |
| [`pi/`](pi/README.md) | Pi extension package (`pi/install.sh`) |
| [`agent-hub/`](agent-hub/README.md) | Agents registry, MCP server, and its Pi extensions |
| `archive/` | Retired code and docs, kept for reference |

## Install skills

```bash
npx skills add ibpme/ibpme-agents-lab            # interactive
npx skills add ibpme/ibpme-agents-lab --skill commit -g
```
