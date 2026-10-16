import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Announce live state at model-run/turn boundaries, never for intermediate idle changes. */
export function registerStateNotice(pi: ExtensionAPI, customType: string, getContent: () => string): void {
  function pending(messages: readonly AgentMessage[]) {
    const content = getContent();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "custom" || message.customType !== customType) continue;
      if (message.content === content) return;
      break;
    }
    return { customType, content, display: true };
  }

  pi.on("before_agent_start", (_event, ctx) => {
    const message = pending(ctx.sessionManager.buildSessionProjection().messages);
    return message ? { message } : undefined;
  });

  pi.on("turn_end", (event) => {
    // Boundary drafts preserve assistant/tool-result ordering and do not force a continuation.
    // Inspect projected history rather than a remembered flag: branching, reload, context
    // edits and compaction can remove a notice without changing the live state.
    const message = pending(event.context.contextMessages);
    return message ? { entries: [{ type: "custom_message", ...message }] } : undefined;
  });
}
