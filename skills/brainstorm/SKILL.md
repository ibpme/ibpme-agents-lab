---
name: brainstorm
description: Use /brainstorm or an explicit request to brainstorm a topic, not a mention or quotation. Develops ideas through dialogue and maintains a living document.
---

# Brainstorm

Develop the topic through critical, bidirectional dialogue. Keep a durable record
of the evolving thinking; finalize only when the user asks.

## Start or resume

1. Reflect the topic and intent in one sentence.
2. Choose a Markdown record and tell the user where it lives:
   - **Filesystem:** use the requested path or `./notes/<topic-slug>.md`.
   - **No suitable filesystem:** maintain one artifact if supported.
   - **Persistence unavailable, denied, or failing:** continue inline and state
     that it is not saved externally. Retry only when circumstances change.
3. Check the requested path and likely matches in local notes or artifacts;
   expand the search only with a user-supplied lead. Read a match before editing.
   Resume directly if the user identified it; otherwise confirm its identity.
   Preserve unrelated content and use another filename for collisions.
4. If no match exists, create a sparse record using the template, making parent
   directories as needed. On return or after a context gap, re-read the record
   before continuing.

## Dialogue

- Ask about uncertainty that materially changes direction, scope, or decisions.
  For reversible details, propose labeled working assumptions.
- Ask a few high-value questions per round. Use question tools for concrete
  choices and open questions for exploration.
- Contribute ideas, alternatives, and recommendations. Challenge weak assumptions
  and explain trade-offs rather than merely agreeing or interviewing.
- Alternate breadth and depth as useful; briefly signal major shifts. Synthesize
  what changed and suggest the next thread.
- Update the record after substantive information, changed decisions, or resolved
  questions—not acknowledgments.

## Record

Distinguish **confirmed decisions**, **tentative proposals**, **working
assumptions**, and **supported findings**. Promote proposals to decisions only
after user agreement. Preserve disagreements and open questions.

Update relevant sections in place rather than appending a transcript. For files
or artifacts, summarize meaningful changes in chat. Inline, show concise updates
and provide a full snapshot on request or at checkpoints such as pausing or
switching major threads.

```markdown
# <Topic>

_In progress — updated <date/time>_

## Intent
<Goal>

## Current thinking
<Current direction; label proposals and assumptions>

## Open questions
- [ ] <Question or disagreement>

## Options & trade-offs
<Alternatives, pros/cons, tentative preferences>

## Confirmed decisions
<User-agreed choices and reasoning>

## Research & sources
<Findings with source titles and links attached to claims>

## Next steps
<Actions or threads to explore>
```

Adapt sections to the topic and omit irrelevant ones. Export other formats only
on request and when supported; retain the Markdown source.

## Research

Research when external facts, current behavior, or prior art could materially
change the active discussion. Use available, relevant tools and keep the inquiry
focused. Cite supported claims in the record; distinguish findings from reasoning
and inference. If needed tools are unavailable, state the limitation, leave the
claim unverified, and continue.

## Evaluation

When reviewing or changing behavior, use [EVALS.md](EVALS.md).
