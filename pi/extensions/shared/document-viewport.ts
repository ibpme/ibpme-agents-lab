import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

export function documentViewport(
  tui: TUI,
  theme: Theme,
  done: () => void,
  body: Component,
  title: string,
  footer: (first: number, last: number, total: number) => string,
  { vimKeys = false, frame = false }: { vimKeys?: boolean; frame?: boolean } = {},
): Component {
  let offset = 0;
  let pageSize = 1;
  let maxOffset = 0;
  let pendingG = false;

  return {
    capturesViewportInput: true,
    render(width) {
      if (width < 1) return [];
      const rows = tui.terminal.rows;
      const framed = frame && width >= 5 && rows >= 5;
      const contentWidth = framed ? width - 4 : width;
      const lines = body.render(contentWidth);
      pageSize = Math.max(1, rows - 8 - (framed ? 2 : 0));
      maxOffset = Math.max(0, lines.length - pageSize);
      offset = Math.min(offset, maxOffset);

      const visible = lines.slice(offset, offset + pageSize);
      if (rows > 1) visible.unshift(theme.fg("accent", theme.bold(title)));
      if (rows > 2) visible.push(theme.fg("dim", footer(offset + 1, offset + pageSize, lines.length)));
      if (!framed) return visible.map((line) => truncateToWidth(line, width, ""));

      const rule = "─".repeat(width - 2);
      const side = theme.fg("border", "│");
      return [
        theme.fg("border", `┌${rule}┐`),
        ...visible.map((line) => `${side} ${truncateToWidth(line, contentWidth, "", true)} ${side}`),
        theme.fg("border", `└${rule}┘`),
      ];
    },
    invalidate() { body.invalidate(); },
    handleInput(data) {
      const goToStart = vimKeys && data === "g" && pendingG;
      pendingG = vimKeys && data === "g" && !pendingG;

      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
        done();
        return;
      }
      const halfPage = Math.max(1, Math.floor(pageSize / 2));
      if (matchesKey(data, "up") || data === "h" || (vimKeys && data === "k")) offset--;
      else if (matchesKey(data, "down") || data === "l" || (vimKeys && data === "j")) offset++;
      else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) offset -= halfPage;
      else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) offset += halfPage;
      else if (matchesKey(data, "home") || goToStart) offset = 0;
      else if (matchesKey(data, "end") || (vimKeys && data === "G")) offset = maxOffset;
      else return;

      offset = Math.max(0, Math.min(offset, maxOffset));
      tui.requestRender();
    },
  };
}
