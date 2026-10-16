import { stripVTControlCharacters } from "node:util";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Markdown, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { hubTitle } from "../contracts/presentation.ts";
import { messageForeground } from "./message-colors.ts";

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
  const sender = stripVTControlCharacters((parsed.metadata.sender_name || parsed.metadata.sender_id)!)
    .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ");
  const bodyText = stripVTControlCharacters(parsed.body)
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/g, " ");
  const body = new Markdown(bodyText, 0, 0, getMarkdownTheme());
  let foreground = messageForeground(theme);
  return {
    invalidate() { body.invalidate(); foreground = messageForeground(theme); },
    render(width) {
      if (width <= 0) return [];
      const pad = Math.min(Math.max(0, outputPad), Math.floor((width - 1) / 2));
      const available = width - pad * 2;
      const indent = " ".repeat(pad);
      const lines = [truncateToWidth(hubTitle(theme, "Agent message", sender), available)];
      const bodyLines = body.render(available);
      lines.push(...(expanded ? bodyLines : bodyLines.slice(0, 4)));
      if (expanded) {
        lines.push(theme.fg("accent", "Metadata"));
        const metadata = new Text(Object.entries(parsed.metadata).map(([key, value]) =>
          theme.fg("muted", `${key}: `) + theme.fg(key === "sender_harness" ? "success" : "accent", JSON.stringify(value))
        ).join("\n"), 0, 0);
        lines.push(...metadata.render(available));
      } else {
        const hint = bodyLines.length > 4 ? "Expand for full message and metadata" : "Expand for sender and message details";
        lines.push(theme.fg("muted", truncateToWidth(`  ${hint}`, available)));
      }
      return lines.map(line => {
        const content = indent + truncateToWidth(line, available);
        return theme.bg("customMessageBg", foreground(content + " ".repeat(width - visibleWidth(content))));
      });
    },
  };
};
