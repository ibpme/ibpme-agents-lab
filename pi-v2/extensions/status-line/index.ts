import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadLayout } from "./config.ts";
import { createDefaultSegments } from "./default-segments/index.ts";
import { defaultLayout, renderLayout, type StatusLayout } from "./layout.ts";

export default function statusLine(pi: ExtensionAPI): void {
  let enabled = true;
  let installGeneration = 0;
  let invalidateUsage: (() => void) | undefined;
  let requestRender: (() => void) | undefined;

  async function install(ctx: ExtensionContext): Promise<boolean> {
    if (ctx.mode !== "tui") return false;
    const generation = ++installGeneration;
    let layout: StatusLayout = defaultLayout;
    const paths = [join(getAgentDir(), "statusline.json")];
    if (ctx.isProjectTrusted()) paths.push(join(ctx.cwd, ".pi", "statusline.json"));
    try {
      layout = await loadLayout(paths);
    } catch (error) {
      if (generation !== installGeneration) return false;
      ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}; using default status layout`, "warning");
    }
    if (generation !== installGeneration) return false;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const segments = createDefaultSegments(ctx, pi, theme, footerData);
      const repaint = () => tui.requestRender();
      requestRender = repaint;
      invalidateUsage = segments.invalidate;
      const unsubscribe = footerData.onBranchChange(repaint);
      return {
        render: (width) => renderLayout(layout, footerData.getExtensionStatuses(), segments.render, width),
        invalidate() {},
        dispose() {
          unsubscribe();
          if (requestRender === repaint) requestRender = undefined;
          if (invalidateUsage === segments.invalidate) invalidateUsage = undefined;
        },
      };
    });
    return true;
  }

  function uninstall(ctx: ExtensionContext): void {
    installGeneration++;
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter(undefined);
    requestRender = undefined;
    invalidateUsage = undefined;
  }

  const refresh = (): void => { invalidateUsage?.(); requestRender?.(); };
  pi.on("session_start", async (_event, ctx) => { if (enabled) await install(ctx); });
  pi.on("session_shutdown", (_event, ctx) => uninstall(ctx));
  pi.on("message_end", refresh);
  pi.on("session_tree", refresh);
  pi.on("session_compact", refresh);
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("turn_end", refresh);

  pi.registerCommand("statusline", {
    description: "Toggle the modular footer, or reload its layout with /statusline reload",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const action = args.trim();
      if (action && action !== "reload") {
        ctx.ui.notify("Usage: /statusline [reload]", "warning");
        return;
      }
      if (action === "reload") {
        enabled = true;
        if (await install(ctx)) ctx.ui.notify("Status layout reloaded", "info");
      } else {
        enabled = !enabled;
        if (enabled) {
          if (!(await install(ctx))) return;
        } else {
          uninstall(ctx);
        }
        ctx.ui.notify(enabled ? "Modular footer enabled" : "Default footer restored", "info");
      }
    },
  });
}
