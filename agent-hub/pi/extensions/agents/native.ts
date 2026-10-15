import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OverlayOptions } from "@earendil-works/pi-tui";
import { createBrowser, type BrowserDependencies } from "@agent-hub/viewer/browser";

export function overlayOptions(terminal: { columns: number; rows: number }): OverlayOptions {
  return {
    anchor: "center", margin: 1,
    get width() { return Math.max(1, terminal.columns - 2); },
    get maxHeight() { return Math.max(1, terminal.rows - 2); },
  };
}

export async function openBrowser(ctx: ExtensionCommandContext, deps: BrowserDependencies): Promise<void> {
  let browser: ReturnType<typeof createBrowser> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let terminal = { columns: 80, rows: 24 };
  try {
    await ctx.ui.custom<void>((tui, theme, _keys, done) => {
      terminal = tui.terminal;
      browser = createBrowser({ ...deps, currentPi: deps.currentPi ?? (() => ({ records: ctx.sessionManager.getEntries(), branch: ctx.sessionManager.getBranch() })) }, terminal, theme, () => tui.requestRender(), () => done());
      void browser.refresh();
      timer = setInterval(() => { void browser?.refresh(); }, 2000);
      timer.unref();
      return browser;
    }, { overlay: true, overlayOptions: () => overlayOptions(terminal) });
  } finally { if (timer) clearInterval(timer); browser?.dispose(); }
}
