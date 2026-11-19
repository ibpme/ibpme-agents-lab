import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, SelectList, truncateToWidth, wrapTextWithAnsi, type SelectItem } from "@earendil-works/pi-tui";
import { renderQuestionPanel, showQuestionPanel, type QuestionHeading } from "./tui-panel.ts";

interface PickerOptions {
  signal?: AbortSignal;
  previous?: number;
  next?: () => number | undefined;
  checklist?: {
    optionCount: number;
    activate(index: number): boolean;
  };
}

export async function pickChoice(
  ui: ExtensionContext["ui"],
  heading: QuestionHeading,
  items: () => SelectItem[],
  { signal, checklist, previous, next }: PickerOptions,
): Promise<number | undefined> {
  return showQuestionPanel<number>(ui, heading, signal, (tui, theme, finish) => {
    let list: SelectList;
    let rows: SelectItem[];
    let selected = 0;
    const listTheme = {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("muted", text),
    };

    function select(index: number) {
      if (!checklist || checklist.activate(index)) finish(index);
      else updateList();
    }
    function updateList() {
      rows = items();
      selected = Math.min(selected, rows.length - 1);
      list = new SelectList(
        rows.map(({ label }, index) => ({ label, value: String(index) })),
        Math.max(1, Math.min(10, tui.terminal.rows - 12)),
        listTheme,
      );
      list.setSelectedIndex(selected);
      list.onSelectionChange = ({ value }) => { selected = Number(value); };
      list.onSelect = ({ value }) => select(Number(value));
      list.onCancel = () => finish();
    }

    updateList();
    return {
      capturesViewportInput: true,
      render(width) {
        if (width < 1) return [];
        const inset = width > 4 ? "  " : "";
        const detail = rows[selected]?.description;
        const description = detail
          ? ["", ...wrapTextWithAnsi(detail, width - inset.length).map((line) => inset + theme.fg("muted", line))]
          : [];
        const instruction = checklist ? "Choose one or more" : "Choose one";
        return renderQuestionPanel(theme, width, heading, [
          theme.fg("muted", truncateToWidth(instruction, width)),
          ...list.render(width),
          ...description,
        ], [
          ...(checklist ? ["Space toggle"] : []),
          "Enter select",
          ...(previous !== undefined ? ["Shift+Tab previous"] : []),
          ...(next?.() !== undefined ? ["Tab continue"] : []),
          "Esc cancel",
        ]);
      },
      handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) finish();
        else if (previous !== undefined && matchesKey(data, "shift+tab")) select(previous);
        else if (matchesKey(data, "tab")) {
          const index = next?.();
          if (index !== undefined) select(index);
        } else if (checklist && matchesKey(data, "space")) {
          if (selected < checklist.optionCount) select(selected);
        } else list.handleInput(data);
        tui.requestRender();
      },
      invalidate: () => list.invalidate(),
    };
  });
}
