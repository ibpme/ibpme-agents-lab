import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function stashExtension(pi: ExtensionAPI): void {
  let stash: string | undefined;
  let submitted = false;

  function toggle(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    const draft = ctx.ui.getEditorText();
    if (stash !== undefined) {
      const saved = stash;
      stash = draft.length ? draft : undefined;
      ctx.ui.setEditorText(saved);
      ctx.ui.notify(stash === undefined ? "Prompt restored" : "Prompt restored; current draft stashed", "info");
    } else if (draft.length) {
      stash = draft;
      ctx.ui.setEditorText("");
      ctx.ui.notify("Prompt stashed; submit another prompt or use the stash shortcut to restore", "info");
    } else {
      ctx.ui.notify("No prompt to stash", "info");
    }
    submitted = false;
  }

  pi.registerShortcut("ctrl+s", {
    description: "Stash or restore the current prompt draft",
    handler: toggle,
  });

  pi.on("input", (event, ctx) => {
    if (ctx.mode === "tui" && event.source === "interactive" && stash !== undefined) submitted = true;
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode !== "tui" || !submitted || stash === undefined) return;
    submitted = false;
    // Never overwrite a draft the user started while the intervening prompt ran.
    if (ctx.ui.getEditorText().length) return;
    ctx.ui.setEditorText(stash);
    stash = undefined;
  });
  function reset(): void {
    stash = undefined;
    submitted = false;
  }
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
}
