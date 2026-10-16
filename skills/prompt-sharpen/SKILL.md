---
name: prompt-sharpen
description: Use /prompt-sharpen or an explicit request to sharpen a prompt, not a mention or quotation. Produces one self-contained prompt for a fresh coding-agent session.
---

# Prompt Sharpen

Refine the user's task into a prompt. Leave task execution to the receiving agent.

## Process

1. Get the draft or goal; ask if missing.
2. Check goal, scope, constraints, context, acceptance criteria, and output.
   If clear enough, produce the prompt immediately.
3. Clarify only gaps that materially affect the task:
   - **User decisions:** ask about priorities, requirements, and trade-offs.
   - **Discoverable facts:** instruct the receiving agent to inspect the
     repository for paths, conventions, and commands; invent none.
   - **Minor details:** delegate reversible choices or label working assumptions.
4. Ask a few focused questions per round. Use a question tool for concrete
   choices and open questions for nuance. Flag contradictions and explain the
   trade-off rather than silently choosing an interpretation.
5. Briefly reflect settled points. Stop when consequential decisions are resolved
   or the user says it is good enough.

## Output

Return one refined prompt in a fenced code block, with no commentary outside it.
Use an outer fence longer than any nested fences.

- Write direct imperative instructions, proportionate to the task.
- Include known specifics, relevant context, requirements, exclusions, and
  acceptance criteria. The prompt must stand alone in a fresh session.
- Keep consequential uncertainty inside the block: label assumptions, identify
  decisions to clarify before affected work, or give discovery instructions.
  Preserve unresolved conflicts rather than inventing agreement.
- Create intermediate drafts or files only on request.

## Evaluation

When reviewing or changing behavior, use [EVALS.md](EVALS.md).
