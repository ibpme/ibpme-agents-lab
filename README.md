# ibpme-agents-lab

A collection of reusable agent skills and pi extensions.

## Skills

- **brainstorm** — Develop ideas through structured dialogue.
- **commit** — Create conventional Git commits.
- **context7-mcp** — Fetch current library and framework documentation.
- **indonesian-language-guidelines** — Apply Indonesian writing and localization guidelines.
- **prompt-sharpen** — Refine prompts for coding agents.
- **to-full-markdown** — Convert documents to detail-preserving Markdown.

## Pi extensions

See [pi/README.md](pi/README.md) for the extension collection (installed with `pi/install.sh`).

## Agent hub

See [agent-hub/README.md](agent-hub/README.md) for the agents registry, MCP server and the pi extensions
that use them (installed with `pi install`).

## Install skills

Install interactively:

```bash
npx skills add ibpme/ibpme-agents-lab
```

To install a specific skill, append `--skill <name>`. Add `-g` for global installation.
