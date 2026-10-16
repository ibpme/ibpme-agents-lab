import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const AGENT_MESSAGE_TYPE = "agent-hub-message";

interface AgentMessage {
  body: string;
  metadata: Record<string, string>;
}

function decodeXml(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => entities[name]!);
}

export function parseAgentMessage(content: string): AgentMessage | undefined {
  const match = /^<agent_message((?: [a-z_]+="[^"<>]*")+)>\n([\s\S]*)\n<\/agent_message>$/.exec(content);
  if (!match || /[<>]/.test(match[2]!)) return;
  const metadata: Record<string, string> = Object.create(null);
  const allowed = new Set(["sender_id", "sender_name", "sender_harness", "message_id"]);
  for (const attribute of match[1]!.matchAll(/ ([a-z_]+)="([^"<>]*)"/g)) {
    const key = attribute[1]!;
    if (!allowed.has(key) || key in metadata) return;
    metadata[key] = decodeXml(attribute[2]!);
  }
  if (!metadata.sender_id || !metadata.sender_harness || !metadata.message_id) return;
  return { metadata, body: decodeXml(match[2]!) };
}

export const renderAgentMessage: MessageRenderer = (message, { expanded, outputPad }, theme) => {
  if (typeof message.content !== "string") return;
  const parsed = parseAgentMessage(message.content);
  if (!parsed) return;
  const sender = (parsed.metadata.sender_name || parsed.metadata.sender_id)!
    .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ");
  const body = new Container();
  body.addChild(new Markdown(parsed.body, 0, 0, getMarkdownTheme()));
  if (expanded) {
    body.addChild(new Text(Object.entries(parsed.metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n"), 0, 0));
  }
  return {
    invalidate() { body.invalidate(); },
    render(width) {
      if (width <= 0) return [];
      const pad = Math.min(Math.max(0, outputPad), Math.max(0, Math.floor((width - 4) / 2)));
      const available = width - pad * 2;
      const indent = " ".repeat(pad);
      const title = `Agent message · ${sender}`;
      if (available < 4) return [theme.fg("accent", truncateToWidth(title, width))];
      const header = truncateToWidth(`╭─ ${title} `, available);
      const lines = [theme.fg("accent", indent + header + "─".repeat(available - visibleWidth(header)))];
      for (const line of body.render(available - 2)) {
        lines.push(indent + theme.fg("accent", "│ ") + truncateToWidth(line, available - 2));
      }
      lines.push(theme.fg("accent", indent + "╰" + "─".repeat(available - 1)));
      return lines;
    },
  };
};
