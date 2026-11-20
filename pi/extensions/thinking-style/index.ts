import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function thinkingStyle(pi: ExtensionAPI): void {
  let thinking = false;

  function startThinking(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || thinking) return;
    const color = ctx.ui.theme.getThinkingBorderColor(pi.getThinkingLevel());
    ctx.ui.setWorkingIndicator({ frames: ["·", "•", "●", "•"].map(color), intervalMs: 120 });
    ctx.ui.setWorkingMessage("Thinking");
    thinking = true;
  }

  function resetIndicator(ctx: ExtensionContext): void {
    if (!thinking) return;
    thinking = false;
    if (ctx.mode === "tui") {
      ctx.ui.setWorkingIndicator();
      ctx.ui.setWorkingMessage();
    }
  }

  pi.on("message_update", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    switch (event.assistantMessageEvent.type) {
      case "thinking_start":
      case "thinking_delta":
        startThinking(ctx);
        break;
      case "thinking_end":
      case "text_start":
      case "text_delta":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
      case "done":
      case "error":
        resetIndicator(ctx);
        break;
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "assistant") resetIndicator(ctx);
  });
  pi.on("session_start", (_event, ctx) => {
    resetIndicator(ctx);
    if (ctx.mode === "tui") ctx.ui.setHiddenThinkingLabel("Thought");
  });
  pi.on("turn_start", (_event, ctx) => resetIndicator(ctx));
  pi.on("turn_end", (_event, ctx) => resetIndicator(ctx));
  pi.on("agent_settled", (_event, ctx) => resetIndicator(ctx));
  pi.on("session_shutdown", (_event, ctx) => resetIndicator(ctx));

  pi.registerMarkdownTransformer((markdown) => markdown
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n"), { messageTypes: ["assistant-thinking"] });
}
