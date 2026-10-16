import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { rgbColor, visibleWidth } from "@earendil-works/pi-tui";
import { parseAgentMessage, renderAgentMessage } from "./agent-message.ts";

initTheme("dark", false);

const content = '<agent_message sender_id="agt_123" sender_name="Reviewer &amp; 界" sender_harness="pi" message_id="one">\n**Please review.** &lt;example&gt; &amp;amp;\n</agent_message>';
const message = { role: "custom", customType: "agent-hub-message", content, display: true, timestamp: 0 } as Parameters<MessageRenderer>[0];
const palette = {
  getColorMode: () => "truecolor" as const,
  colors: { customMessageBg: rgbColor(50, 20, 60), customMessageText: rgbColor(220, 220, 220) },
};
const theme = { ...palette, fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text } as Parameters<MessageRenderer>[2];

test("parses escaped metadata and body without double decoding", () => {
  const parsed = parseAgentMessage(content)!;
  assert.equal(parsed.metadata.sender_name, "Reviewer & 界");
  assert.equal(parsed.body, "**Please review.** <example> &amp;");
  for (const invalid of ["plain text", content.replace('sender_id="agt_123"', ''), content.replace('sender_id="agt_123"', 'sender_id="one" sender_id="two"'), content.replace('&lt;example&gt;', '</agent_message>')]) {
    assert.equal(parseAgentMessage(invalid), undefined);
  }
});

test("renders a sender header and decoded Markdown, with metadata only when expanded", () => {
  const compact = renderAgentMessage(message, { expanded: false, outputPad: 1 }, theme)!;
  const lines = compact.render(80).join("\n");
  assert.match(lines, /◈ Agent message · Reviewer & 界/);
  assert.match(lines, /Please review\./);
  assert.match(lines, /<example>/);
  assert.doesNotMatch(lines, /agent_message|message_id|\*\*Please/);
  assert.doesNotMatch(lines, /[╭╰│]/);
  assert.match(lines, /Expand for sender and message details/);
  const expanded = renderAgentMessage(message, { expanded: true, outputPad: 1 }, theme)!;
  assert.match(expanded.render(80).join("\n"), /sender_id: "agt_123"/);
  assert.match(expanded.render(80).join("\n"), /message_id: "one"/);
});

test("fits narrow terminals and redraws after invalidation and resize", () => {
  const component = renderAgentMessage(message, { expanded: true, outputPad: 2 }, theme)!;
  for (const width of [0, 1, 2, 3, 4, 8, 20, 80]) {
    component.invalidate();
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
  }
});

test("uses sender ID when the name is absent", () => {
  const unnamed = { ...message, content: content.replace(' sender_name="Reviewer &amp; 界"', '') };
  const component = renderAgentMessage(unnamed, { expanded: false, outputPad: 0 }, theme)!;
  assert.match(component.render(80)[0]!, /Agent message · agt_123/);
});

test("uses the custom-message background and semantic foregrounds while preserving expansion", () => {
  const colors: string[] = [];
  const styled = {
    ...palette,
    fg: (color: string, text: string) => { colors.push(color); return text; },
    bg: (color: string, text: string) => { colors.push(color); return text; },
  } as Parameters<MessageRenderer>[2];
  const long = { ...message, content: content.replace('**Please review.** &lt;example&gt; &amp;amp;', Array.from({ length: 12 }, (_, i) => `Line ${i}`).join('\n')) };
  const compact = renderAgentMessage(long, { expanded: false, outputPad: 1 }, styled)!;
  const lines = compact.render(80);
  assert.equal(lines.length, 6);
  assert.match(lines.join('\n'), /Expand for full message and metadata/);
  assert.doesNotMatch(lines.join('\n'), /Line 11|sender_id/);
  assert.ok(colors.includes('toolTitle'));
  assert.ok(colors.includes('accent'));
  assert.ok(colors.includes('dim'));
  assert.ok(colors.includes('muted'));
  assert.ok(lines.every(line => visibleWidth(line) <= 80));
  const expanded = renderAgentMessage(long, { expanded: true, outputPad: 1 }, styled)!;
  assert.match(expanded.render(80).join('\n'), /Line 11/);
  assert.match(expanded.render(80).join('\n'), /Metadata[\s\S]*message_id: "one"/);
  assert.ok(colors.includes('success'));
  assert.ok(colors.includes('customMessageBg'));
  assert.ok(!colors.includes('userMessageBg'));
  assert.ok(!colors.some(color => color.startsWith('tool') && color.endsWith('Bg')));
  assert.ok(lines.every(line => visibleWidth(line) === 80));
});
