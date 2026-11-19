import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";
import { Markdown } from "@earendil-works/pi-tui";
import { showDocument, type OpenDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";

const openLocal: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const body = new Markdown(document.content, 0, 0, getMarkdownTheme());
    return documentViewport(tui, theme, done, body, document.title, () => "↑↓ scroll · Esc close");
  });
};

export default function readmdExtension(pi: ExtensionAPI) {
  pi.registerCommand("readmd", {
    description: "View the last assistant response as rendered Markdown",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const branch = ctx.sessionManager.getBranch();
      for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;

        const content = contentText(entry.message.content).trim();
        if (!content) continue;

        await showDocument(pi.events, ctx, { title: "Last Assistant Response", content, format: "markdown" }, openLocal);
        return;
      }
      ctx.ui.notify("No assistant response found", "warning");
    },
  });
}
