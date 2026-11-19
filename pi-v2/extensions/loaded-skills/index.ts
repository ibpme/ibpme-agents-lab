import type { ExtensionAPI, ExtensionContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { showDocument, type OpenDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";
import { skillLabel, skillReport } from "./report.ts";
import { loadedSkillPaths, skillInvocation } from "./state.ts";

const STATUS_KEY = "loaded-skills";

const openLocal: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const body = new Text(document.content, 0, 0);
    return documentViewport(tui, theme, done, body, document.title, () => "↑↓ scroll · Esc close");
  });
};

export default function loadedSkillsExtension(pi: ExtensionAPI) {
  function update(ctx: ExtensionContext, pending?: SessionMessageEntry["message"]) {
    if (ctx.mode !== "tui") return;
    const names = [...loadedSkillPaths(ctx.sessionManager.getBranch(), pending).keys()].map(skillLabel);
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "skills: ") + ctx.ui.theme.fg("muted", names.join(", ") || "none"));
  }

  pi.registerCommand("loaded-skills", {
    description: "Show loaded skills and approximate token counts",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const content = await skillReport(loadedSkillPaths(ctx.sessionManager.getBranch()), ctx.cwd);
      await showDocument(pi.events, ctx, { title: "Loaded Skills", content, format: "text" }, openLocal);
    },
  });

  pi.on("session_start", (_event, ctx) => update(ctx));
  pi.on("session_tree", (_event, ctx) => update(ctx));
  pi.on("session_compact", (_event, ctx) => update(ctx));
  pi.on("message_end", ({ message }, ctx) => {
    if (message.role === "toolResult" ? message.toolName === "read" || message.nestedCalls : skillInvocation(message)) {
      // Pi persists this message after dispatching message_end.
      update(ctx, message);
    }
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
