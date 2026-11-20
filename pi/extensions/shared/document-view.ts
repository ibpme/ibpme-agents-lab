import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export const PAGER_LOOKUP = "ibpme:pager:resolve:v1";

export interface ViewerDocument {
  title: string;
  content: string;
  format: "markdown" | "text";
  detail?: string;
  createBody?: (tui: TUI, theme: Theme) => Component;
}

export type OpenDocument = (ctx: ExtensionCommandContext, document: ViewerDocument) => Promise<void>;
export type OfferPager = (open: OpenDocument) => void;

export async function showDocument(
  events: ExtensionAPI["events"],
  ctx: ExtensionCommandContext,
  document: ViewerDocument,
  openLocal: OpenDocument,
): Promise<void> {
  if (ctx.mode === "print") {
    console.log(`\n=== ${document.title} ===\n\n${document.content}\n`);
    return;
  }
  if (ctx.mode === "rpc") {
    const title = document.detail ? `${document.title} · ${document.detail}` : document.title;
    await ctx.ui.editor(title, document.content);
    return;
  }
  if (ctx.mode !== "tui") return;

  let openPager: OpenDocument | undefined;
  const offer: OfferPager = (open) => { openPager ??= open; };
  // Pi dispatches listeners synchronously. Only the lookup runs on the event bus.
  events.emit(PAGER_LOOKUP, offer);
  await (openPager ?? openLocal)(ctx, document);
}
