import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

export function documentViewport(
  tui: TUI,
  theme: Theme,
  done: () => void,
  body: Component,
  title: string,
  footer: (first: number, last: number, total: number) => string,
  vimKeys = false,
): Component {
  let offset = 0;
  let pageSize = 1;
  let maxOffset = 0;
  let pendingG = false;

  return {
    capturesViewportInput: true,
    render(width) {
      if (width < 1) return [];
      const lines = body.render(width);
      const rows = tui.terminal.rows;
      pageSize = Math.max(1, rows - 8);
      maxOffset = Math.max(0, lines.length - pageSize);
      offset = Math.min(offset, maxOffset);

      const visible = lines.slice(offset, offset + pageSize);
      if (rows > 1) visible.unshift(theme.fg("accent", theme.bold(title)));
      if (rows > 2) visible.push(theme.fg("dim", footer(offset + 1, offset + pageSize, lines.length)));
      return visible.map((line) => truncateToWidth(line, width, ""));
    },
    invalidate() { body.invalidate(); },
    handleInput(data) {
      const goToStart = vimKeys && data === "g" && pendingG;
      pendingG = vimKeys && data === "g" && !pendingG;

      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
        done();
        return;
      }
      if (matchesKey(data, "up") || (vimKeys && data === "k")) offset--;
      else if (matchesKey(data, "down") || (vimKeys && data === "j")) offset++;
      else if (matchesKey(data, "pageUp")) offset -= pageSize;
      else if (matchesKey(data, "pageDown")) offset += pageSize;
      else if (matchesKey(data, "home") || goToStart) offset = 0;
      else if (matchesKey(data, "end") || (vimKeys && data === "G")) offset = maxOffset;
      else return;

      offset = Math.max(0, Math.min(offset, maxOffset));
      tui.requestRender();
    },
  };
}
