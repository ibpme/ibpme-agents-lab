---
name: show-dont-tell
description: Explain visually using the harness’s rendering capabilities and available tools, such as diagrams, artifacts, or inline UI, keeping visuals concise and detailed prose separate. Use when the user requests a visual explanation or when a visual would make an explanation clearer and more concise than text alone.
---

# Show, don't tell

Use visuals to make the explanation easier to understand. Keep detailed prose separate from the visual.

1. Identify the idea or outcome the user needs to understand. Use a visual when it makes that understanding clearer and more concise than text alone.
2. Choose an effective visual supported by the harness: a diagram for flow or relationships, a rendered mockup for appearance or layout, or a static comparison for differences. Escalate to interactive UI when interaction helps explain the idea, such as exploring changing state or cause and effect.
3. Check [Harness compatibility](#harness-compatibility), then present a rendered visual rather than source code. Confirm limitations across native rendering and tools before falling back: briefly disclose the limitation and use a supported visual, or, if none is useful, ask the user for an alternative.

Keep the visual proportional to the question and the user's requested format. Label illustrative content and distinguish expected results from observed results.

## Styling reference

A book-like layout is one option, not a required template:

> Introductory explanation
>
> [Visual guide with short labels]
>
> _Figure caption highlighting what to notice._
>
> Further explanation, if useful

The visual’s structure carries the idea; detailed prose stays outside it. Adapt the layout and depth to the explanation rather than filling every slot.

## Harness compatibility

Use the current harness’s native rendering capabilities and tool descriptions to choose how to render and present visuals. Discover rendering tools exposed through MCP or other tool integrations when native rendering does not cover the needed format.

When running in Pi, read [harness/pi.md](harness/pi.md).
