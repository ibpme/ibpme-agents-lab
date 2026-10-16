import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseAgentMessage, renderAgentMessage } from "./agent-message.ts";

initTheme("dark", false);

const content = '<agent_message sender_id="agt_123" sender_name="Reviewer &amp; 界" sender_harness="pi" message_id="one">\n**Please review.** &lt;example&gt; &amp;amp;\n</agent_message>';
const message = { role: "custom", customType: "agent-hub-message", content, display: true, timestamp: 0 } as Parameters<MessageRenderer>[0];
const theme = { fg: (_color: string, text: string) => text } as Parameters<MessageRenderer>[2];

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
  assert.match(lines, /╭─ Agent message · Reviewer & 界/);
  assert.match(lines, /Please review\./);
  assert.match(lines, /<example>/);
  assert.doesNotMatch(lines, /agent_message|message_id|\*\*Please/);
  assert.match(lines, /╰─/);
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
