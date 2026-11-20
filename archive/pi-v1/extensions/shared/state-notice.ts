import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Announce live state at model-run/turn boundaries, never for intermediate idle changes. */
export function registerStateNotice(
  pi: ExtensionAPI, customType: string, getContent: () => string, isDefault: () => boolean,
): void {
  function pending(messages: readonly AgentMessage[], ctx: ExtensionContext) {
    const content = getContent();
    const notice = { customType, content, display: true };
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "custom" || message.customType !== customType) continue;
      return message.content === content ? undefined : notice;
    }
    // Defaults are implicit only until this state has ever been announced. Search all
    // entries so compaction or branching cannot hide a required return-to-default notice.
    if (isDefault() && !ctx.sessionManager.getEntries().some((entry) =>
      entry.type === "custom_message" && entry.customType === customType)) return;
    return notice;
  }

  pi.on("before_agent_start", (_event, ctx) => {
    const message = pending(ctx.sessionManager.buildSessionProjection().messages, ctx);
    return message ? { message } : undefined;
  });

  pi.on("turn_end", (event, ctx) => {
    // Boundary drafts preserve assistant/tool-result ordering and do not force a continuation.
    // Inspect projected history rather than a remembered flag: branching, reload, context
    // edits and compaction can remove a notice without changing the live state.
    const message = pending(event.context.contextMessages, ctx);
    return message ? { entries: [{ type: "custom_message", ...message }] } : undefined;
  });
}
