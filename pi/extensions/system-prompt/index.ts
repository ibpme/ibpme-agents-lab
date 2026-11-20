import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { showDocument, type OpenDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";

const openLocal: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const body = new Markdown(document.content, 0, 0, getMarkdownTheme());
    return documentViewport(tui, theme, done, body, document.title, () => `${document.detail} · ↑↓ scroll · Esc close`);
  });
};

export default function systemPromptExtension(pi: ExtensionAPI) {
  pi.registerCommand("system-prompt", {
    description: "View the current system prompt or the configured append prompt",
    getArgumentCompletions: (prefix) => "append".startsWith(prefix) ? [{ value: "append", label: "append" }] : null,
    handler: async (args, ctx) => {
      if (!ctx.hasUI && ctx.mode !== "print") return;
      const append = args.trim() === "append";
      const content = append ? ctx.getSystemPromptOptions().appendSystemPrompt : ctx.getSystemPrompt();
      if (!content) {
        ctx.ui.notify(append ? "No append system prompt is currently set" : "No system prompt is available", "info");
        return;
      }

      await showDocument(pi.events, ctx, {
        title: append ? "Append System Prompt" : "System Prompt",
        content,
        format: "markdown",
        detail: `~${Math.ceil(Array.from(content).length / 4).toLocaleString("en-US")} tokens`,
      }, openLocal);
    },
  });
}
