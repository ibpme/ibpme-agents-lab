# Brainstorm evaluations

Manual checks. Run each case in a fresh session; linked follow-ups stay in the
same session. Inspect replies, document changes, and tool calls.

| Input / setup | Pass |
| --- | --- |
| `Audit skills/brainstorm/SKILL.md.` Separately: `Explain the phrase "brainstorm a migration".` | Neither starts brainstorming or creates notes. |
| `/brainstorm a team reading group`. Separately: `Let's brainstorm a team reading group.` | Both start dialogue and establish a record. |
| `Let's brainstorm a migration plan.` | Clarifies source/destination before detailed planning. |
| Brainstorm a reading group; meeting day unspecified. | May propose a labeled assumption without blocking on the day. |
| Unrelated content occupies `notes/reading-group.md`; brainstorm a reading group. | Reads and confirms identity before editing; preserves content and chooses another filename if unrelated. |
| `Continue the brainstorm in notes/team-learning.md.` Seed decisions and questions. | Reads first, preserves decisions, resumes open threads without redundant identity confirmation. |
| No document matches the requested path or local notes. | Avoids an unbounded filesystem search. |
| Agent proposes weekly meetings; reply `What about monthly?`, then `Choose monthly for better attendance.` | Neither option is initially confirmed; later records monthly and its rationale as agreed. |
| Writes/artifacts unavailable, or write denied. | Continues inline, reports unsaved status, retries only after circumstances change. |
| Reply `Thanks`, then add a constraint. | No update for acknowledgment; records the constraint. |
| Inline mode: discuss several threads, then pause. | Concise interim updates; full snapshot at pause. |
| Brainstorm a personal reflection routine from stated preferences. | Contributes without unnecessary research. |
| Plan depends on a current framework capability. Repeat without research tools. | With tools: researches relevant docs and cites claims, separating inference. Without: marks the claim unverified and continues. |
| Reach a promising direction, then explicitly request finalization. | Keeps the record in progress until that request. |
