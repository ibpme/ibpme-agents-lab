import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { PAGER_LOOKUP, type OfferPager, type OpenDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";

const openPager: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const body = document.format === "markdown"
      ? new Markdown(document.content, 0, 0, getMarkdownTheme())
      : new Text(document.content, 0, 0);

    return documentViewport(tui, theme, done, body, document.title, (first, last, total) => {
      const position = `Lines ${total === 0 ? "0" : `${first}–${Math.min(last, total)}`} of ${total}`;
      return [position, document.detail, "↑↓ / jk scroll · PgUp/PgDn · gg/G · Esc/q close"]
        .filter(Boolean)
        .join(" · ");
    }, true);
  });
};

export default function pagerExtension(pi: ExtensionAPI) {
  pi.events.on(PAGER_LOOKUP, (offer) => {
    if (typeof offer === "function") (offer as OfferPager)(openPager);
  });
}
