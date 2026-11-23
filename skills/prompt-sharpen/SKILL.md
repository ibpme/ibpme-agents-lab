---
name: prompt-sharpen
description: Use on an explicit request to sharpen a prompt/task or when user calls /prompt-sharpen. Produce a refined/sharpened prompt to guide an agent in executing the task.
---

# Process and Guidelines

1. Understand the Task: Grasp the main objective, goals, requirements, constraints, and expected output; ask if missing.
2. Minimal Changes: If the task is already clear and complete, return it with only light edits. If it is missing goal, scope, constraints, or acceptance criteria, add only what is missing and keep the user's wording and structure. Do not rewrite a working prompt for style.
3. Reasoning Before Conclusions: Encourage reasoning steps before any conclusions are reached. ATTENTION! If the user provides examples where the reasoning happens afterward, REVERSE the order! NEVER START EXAMPLES WITH CONCLUSIONS!
    - Reasoning Order: Call out reasoning portions of the prompt and conclusion parts (specific fields by name). For each, determine the ORDER in which this is done, and whether it needs to be reversed.
    - Conclusion, classifications, or results should ALWAYS appear last.
4. Examples: Include high-quality examples if helpful, using placeholders [in brackets] for complex elements.
   - What kinds of examples may need to be included, how many, and whether they are complex enough to benefit from placeholders.
5. Clarity and Conciseness: Use clear, specific language. Avoid unnecessary instructions or bland statements.
6. Formatting: Use markdown features for readability. DO NOT USE ``` CODE BLOCKS UNLESS SPECIFICALLY REQUESTED.
7. Preserve User Content: If the input task or prompt includes extensive guidelines or examples, preserve them entirely, or as closely as possible. If they are vague, consider breaking down into sub-steps. Keep any details, guidelines, examples, variables, or placeholders provided by the user.
8. Output Format: Explicitly state the most appropriate output format, in detail. This should include length and syntax (e.g. short sentence, paragraph, JSON, etc.)
    - For tasks outputting well-defined or structured data (classification, JSON, etc.) bias toward outputting a JSON.
    - JSON should never be wrapped in code blocks (```) unless explicitly requested.

# Clarification

If additional user clarification is needed use the following guidelines

1. Clarify gaps that affect the task:
   - User decisions: ask about priorities, requirements, and trade-offs.
   - Discoverable facts: use your available tools to inspect the repository for paths, conventions, and commands. Look for unknowns or outdated information; invent none.
2. Ask a few focused questions if needed. Use a question tool for concrete
   choices and open questions for nuance. Flag contradictions and explain the
   trade-off rather than silently choosing an interpretation.
3. Briefly reflect settled points. Stop when consequential decisions are resolved
   or the user says it is good enough.

# Explicit Editing
Read [Explicit Editing Guidelines](./explicit-edit.md) when the user explicitly requests a prompt edit or change. Usually when a complete prompt is already done but user asks for a change.

# Output

The final prompt you output should adhere to the following structure below. Do not include any additional commentary, only output the completed prompt. SPECIFICALLY, do not include any additional messages at the start or end of the prompt. (e.g. no "---") except when [Explicit Editing](#explicit-editing)

[Concise instruction describing the task - this should be the first line in the prompt, no section header]

[Additional details as needed.]

[Optional sections with headings or bullet points for detailed steps.]

# Steps [optional]

[optional: a detailed breakdown of the steps necessary to accomplish the task]

# Output Format

[Specifically call out how the output should be formatted, be it response length, structure e.g. JSON, markdown, etc]

# Examples [optional]

[Optional: 1-3 well-defined examples with placeholders if necessary. Clearly mark where examples start and end, and what the input and output are. Use placeholders as necessary.]
[If the examples are shorter than what a realistic example is expected to be, make a reference with () explaining how real examples should be longer / shorter / different. AND USE PLACEHOLDERS! ]

# Notes [optional]

[optional: edge cases, details, and an area to call or repeat out specific important considerations]
