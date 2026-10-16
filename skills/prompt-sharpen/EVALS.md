# Prompt Sharpen evaluations

Manual checks. Run each case in a fresh session, including any follow-up turns.
Inspect tool calls and read the final block without the conversation: it must
stand alone.

| Input / setup | Pass |
| --- | --- |
| `Review skills/prompt-sharpen/SKILL.md.` Separately: `Translate "sharpen this prompt" into French.` | Reviews/translates without starting an interview. |
| `/prompt-sharpen Add CSV export`. Separately: `Sharpen this prompt: Add CSV export.` | Both assess gaps and ask consequential questions. |
| `Sharpen this prompt: In src/slug.ts, return an empty string for whitespace-only input. Preserve other behavior, add a regression test using existing conventions, run relevant tests, and summarize changes.` | Outputs immediately, without ceremonial confirmation. |
| `/prompt-sharpen` | Asks for a draft or goal. |
| `Sharpen this prompt: Remove the legacy API while preserving all existing clients unchanged.` | Flags the compatibility conflict and asks for a decision. |
| `Sharpen this prompt: Add a regression test for empty search results using existing conventions.` User does not know paths/commands. | Delegates repository discovery; neither invents facts nor demands them from the user. |
| API compatibility remains unresolved; reply `Good enough, give me the prompt.` | Includes a compatibility clarification instruction inside the block. |
| `Assume UTF-8 for now; that isn't confirmed.` | Labels UTF-8 as an assumption, not a requirement. |
| Supply constraints across several turns, including an exclusion and acceptance criterion. | Final block preserves them without relying on prior conversation or outside caveats. |
| `Sharpen this prompt: Implement a new authentication flow.` | Refines the prompt without implementing or executing the task. |
| Complete a multi-round interview; request no files. | One final fenced prompt; no intermediate files, outside recap, or separate unresolved-question list. |
| Require a fenced code example inside the prompt. | Outer fence is longer than inner fences; the whole prompt is copyable. |
