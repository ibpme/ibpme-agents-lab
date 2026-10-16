import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function skillFromRead(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool !== "read") return undefined;
  if (typeof args.path !== "string") return undefined;
  const path = args.path.replace(/\\/g, "/");
  return /(?:^|\/)([^/]+)\/SKILL\.md$/i.exec(path)?.[1]
    ?? /(?:^|\/)skills\/([^/]+)\.md$/i.exec(path)?.[1];
}

/** Replay only the active branch, including nested reads made through codemode. */
export function loadedSkillPaths(entries: readonly SessionEntry[]): Map<string, string> {
  const skills = new Map<string, string>();
  const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  const add = (tool: string, args: Record<string, unknown>) => {
    const name = skillFromRead(tool, args);
    if (name) skills.set(name, args.path as string);
  };
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") calls.set(block.id, block);
      }
    } else if (message.role === "toolResult") {
      if (!message.isError) {
        const call = calls.get(message.toolCallId);
        if (call) add(call.name, call.arguments);
      }
      for (const call of message.nestedCalls?.calls ?? []) {
        if (call.status === "ok" && call.arguments) add(call.name, call.arguments);
      }
    } else if (message.role === "user") {
      const text = typeof message.content === "string" ? message.content
        : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      // /skill:name expands to this wrapper rather than calling the read tool.
      const match = /^<skill name="([^"]+)" location="([^"]+)">\n/.exec(text);
      if (match) skills.set(match[1], match[2]);
    }
  }
  return skills;
}

export function loadedSkills(entries: readonly SessionEntry[]): Set<string> {
  return new Set(loadedSkillPaths(entries).keys());
}
