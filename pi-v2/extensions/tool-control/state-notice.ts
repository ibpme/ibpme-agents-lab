import type { CustomMessageEntryDraft, ExtensionAPI, ExtensionContext, SessionContext } from "@earendil-works/pi-coding-agent";
import type { Mode } from "./policy.ts";

const noticeType = "tool-control-mode-context";
const noticeTypes = new Set([noticeType, "tool-set-mode-context"]);

const noticeText: Record<Mode, string> = {
  safe: "Execution policy: SAFE. Write, edit, shell execution, tools marked as mutating, and MCP tools without a read-only annotation are blocked. Use read-only tools.",
  yolo: "Execution policy: YOLO. SAFE restrictions are lifted. Other tool permissions still apply.",
};

export function registerModeNotice(pi: ExtensionAPI, getMode: () => Mode): void {
  function pending(messages: SessionContext["messages"], ctx: ExtensionContext): CustomMessageEntryDraft | undefined {
    const mode = getMode();
    const notice = { type: "custom_message", customType: noticeType, content: noticeText[mode], display: true } as const;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "custom" || !noticeTypes.has(message.customType)) continue;
      return typeof message.content === "string" && message.content.startsWith(`Execution policy: ${mode.toUpperCase()}.`)
        ? undefined : notice;
    }
    // Announce a return to the default even if branching or compaction removed the preceding notice.
    if (mode === "yolo" && !ctx.sessionManager.getEntries().some((entry) =>
      entry.type === "custom_message" && noticeTypes.has(entry.customType))) return;
    return notice;
  }

  pi.on("before_agent_start", (_event, ctx) => {
    const notice = pending(ctx.sessionManager.buildSessionProjection().messages, ctx);
    return notice ? { message: notice } : undefined;
  });

  pi.on("turn_end", (event, ctx) => {
    const notice = pending(event.context.contextMessages, ctx);
    return notice ? { entries: [...event.entries, notice] } : undefined;
  });
}
