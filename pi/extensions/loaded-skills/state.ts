import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";

type Message = SessionMessageEntry["message"];

export function skillInvocation(message: Message): { name: string; path: string } | undefined {
  if (message.role !== "user") return undefined;
  const match = /^<skill name="([^"\r\n]+)" location="([^"\r\n]+)">\n/.exec(contentText(message.content));
  if (match) return { name: match[1], path: match[2] };
}

export function loadedSkillPaths(entries: readonly SessionEntry[], pending?: Message): Map<string, string> {
  const skills = new Map<string, string>();
  const readPaths = new Map<string, string>();

  function addRead(path: string) {
    const normalized = path.replace(/\\/g, "/");
    const name = /(?:^|\/)([^/]+)\/SKILL\.md$/i.exec(normalized)?.[1]
      ?? /(?:^|\/)skills\/([^/]+)\.md$/i.exec(normalized)?.[1];
    if (name) skills.set(name, path);
  }

  function observe(message: Message) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall" && block.name === "read" && typeof block.arguments.path === "string") {
          readPaths.set(block.id, block.arguments.path);
        }
      }
    } else if (message.role === "toolResult") {
      const path = readPaths.get(message.toolCallId);
      if (!message.isError && path) addRead(path);
      readPaths.delete(message.toolCallId);

      for (const call of message.nestedCalls?.calls ?? []) {
        if (call.status === "ok" && call.name === "read" && typeof call.arguments?.path === "string") {
          addRead(call.arguments.path);
        }
      }
    } else {
      const invocation = skillInvocation(message);
      if (invocation) skills.set(invocation.name, invocation.path);
    }
  }

  for (const entry of entries) {
    if (entry.type === "message") observe(entry.message);
  }
  if (pending) observe(pending);
  return skills;
}
