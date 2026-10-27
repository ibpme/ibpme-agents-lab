---
name: show-dont-tell
description: Explain visually using the harness’s rendering capabilities and available tools, such as diagrams, artifacts, or inline UI, keeping visuals concise and detailed prose separate. Use when the user requests a visual explanation or when a visual would make an explanation clearer and more concise than text alone.
---

# Show, don't tell

Use visuals to make the explanation easier to understand. Keep detailed prose separate from the visual.

1. Identify the idea or outcome the user needs to understand. Use a visual when it makes that understanding clearer and more concise than text alone.
2. Choose the simplest effective visual supported by the harness: a diagram for flow or relationships, a rendered mockup for appearance or layout, or a static comparison for differences. Escalate to interactive UI only when interaction helps explain the idea, such as exploring changing state or cause and effect.
3. Check [Harness compatibility](#harness-compatibility), then create and present the visual. Confirm the relevant capability is unavailable before warning the user or falling back; the absence of a dedicated rendering tool does not establish that a format is unsupported. If the preferred format cannot render, briefly tell the user what the environment cannot support and use the simplest supported visual alternative. If no useful visual can render, explain the limitation and ask whether the user wants a concise text explanation instead. Treat source code as an implementation detail, not as a rendered visual.
4. Integrate the visual like a figure in a book: introduce the idea in prose, present the visual, add a short caption explaining what to notice, then continue the explanation as needed. Keep labels and annotations short; use the visual’s structure to communicate rather than embedding paragraphs inside it. Scale the surrounding prose to the depth the user needs. Label illustrative content and distinguish expected results from observed results.

Keep the visual proportional to the question and the user's requested format.

## Harness compatibility

Use the current harness’s native rendering capabilities and tool descriptions to choose how to render and present visuals. Discover rendering tools exposed through MCP or other tool integrations when native rendering does not cover the needed format.

When running in Pi, read [references/pi.md](references/pi.md) for native Mermaid rendering guidance.
