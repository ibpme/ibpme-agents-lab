import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable, Editor, getKeybindings, matchesKey, SelectList, truncateToWidth, visibleWidth, wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { displayLine, displayText } from "./model.ts";
import { renderQuestionPanel, showQuestionPanel, type QuestionHeading } from "./tui-panel.ts";

type QuestionUI = ExtensionContext["ui"];
export type PickerRow = { label: string; description?: string; gapBefore?: boolean };

interface PickerOptions {
  numbered: number;
  signal?: AbortSignal;
  instruction?: string;
  inlineDetails?: boolean;
  initial?: number;
  previous?: number;
  next?: { label: string; index: () => number | undefined };
  cancelHint?: string;
  activate?: (index: number) => boolean;
  written?: {
    index: number;
    value(): string | undefined;
    change(text?: string): void;
  };
}

export async function selectQuestionRow(
  ui: QuestionUI, title: string, rows: PickerRow[], signal?: AbortSignal,
): Promise<number | undefined> {
  if (signal?.aborted) return undefined;
  const labels = rows.map(({ label, description, gapBefore }, index) =>
    `${gapBefore ? "\n" : ""}${index + 1}. ${label}${description ? ` — ${displayLine(description)}` : ""}`);
  const choice = await ui.select(title, labels, { signal });
  const index = choice === undefined ? -1 : labels.findIndex((label) => label.trimStart() === choice.trimStart());
  return index < 0 || signal?.aborted ? undefined : index;
}

export async function pickChoice(
  ui: QuestionUI,
  heading: QuestionHeading,
  items: () => PickerRow[],
  {
    numbered, signal, instruction, inlineDetails, initial = 0, previous, next, cancelHint = "Esc cancel", activate, written,
  }: PickerOptions,
): Promise<number | undefined> {
  return showQuestionPanel<number>(ui, heading, signal, (tui, theme, finish) => {
    let list: SelectList;
    let rows: PickerRow[];
    let selected = initial;
    let digits = "";
    let editor: Editor | undefined;
    let invalidText = false;
    let focused = false;
    const visibleRows: PickerRow[] = [];
    const listTheme = {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("muted", text),
    };

    function rowLabel({ label, description }: PickerRow, index: number): string {
      const prefix = index < numbered ? `${String(index + 1).padStart(String(numbered).length)}. ` : "";
      const summary = inlineDetails && description ? ` — ${displayLine(description)}` : "";
      return prefix + label + summary;
    }

    function focusRow(index: number) {
      selected = index;
      list.setSelectedIndex(index);
    }

    function closeEditor() {
      editor = undefined;
      invalidText = false;
      updateList();
    }

    function openEditor() {
      if (!written) return;
      selected = written.index;
      editor = new Editor(tui, { selectList: listTheme, borderColor: (text) => theme.fg("border", text) }, { paddingX: 2 });
      editor.focused = focused;
      editor.setText(displayText(written.value() ?? ""));
      const original = editor.getText();
      editor.onSubmit = (text) => {
        if (!displayLine(text)) {
          invalidText = true;
          return;
        }
        if (text !== original) written.change(text);
        closeEditor();
      };
      updateList();
    }

    function select(index: number) {
      if (written && index === written.index) openEditor();
      else if (!activate || activate(index)) finish(index);
      else updateList();
    }

    function updateList() {
      rows = items();
      selected = Math.min(selected, rows.length - 1);
      const gapRows = rows.some(({ gapBefore }) => gapBefore) ? 1 : 0;
      list = new SelectList(
        rows.map((row, index) => ({ label: rowLabel(row, index), value: String(index) })),
        Math.max(1, Math.min(10, tui.terminal.rows - (editor ? 17 : 12) - gapRows)),
        listTheme,
        {
          truncatePrimary: ({ text, maxWidth, item }) => {
            visibleRows.push(rows[Number(item.value)]);
            return truncateToWidth(text, maxWidth, "");
          },
        },
      );
      list.setSelectedIndex(selected);
      list.onSelectionChange = ({ value }) => { selected = Number(value); };
      list.onSelect = ({ value }) => select(Number(value));
      list.onCancel = () => finish();
    }

    function numberIndex() {
      const position = Number(digits);
      return position >= 1 && position <= numbered ? position - 1 : undefined;
    }

    function handleKey(data: string) {
      if (editor) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) closeEditor();
        else {
          invalidText = false;
          editor.handleInput(data);
        }
        return;
      }
      const key = decodeKittyPrintable(data) ?? data;
      if (numbered && /^\d+$/.test(key)) {
        digits = numbered > 9 ? digits + key : key;
        const index = numberIndex();
        if (index !== undefined) {
          focusRow(index);
          if (numbered <= 9) select(index);
        }
        if (numbered <= 9) digits = "";
        return;
      }
      if (digits && matchesKey(data, "backspace")) {
        digits = digits.slice(0, -1);
        const index = numberIndex();
        if (index !== undefined) focusRow(index);
        return;
      }
      const invalidNumber = digits && numberIndex() === undefined;
      digits = "";
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) finish();
      else if (previous !== undefined && matchesKey(data, "shift+tab")) select(previous);
      else if (matchesKey(data, "tab")) {
        const index = next?.index();
        if (index !== undefined) select(index);
      } else if (written && key === "w") openEditor();
      else if (written && selected === written.index && matchesKey(data, "delete")) {
        written.change();
        updateList();
      } else if (invalidNumber && (getKeybindings().matches(data, "tui.select.confirm") || matchesKey(data, "space"))) {
        return;
      } else if (activate && matchesKey(data, "space")) {
        if (selected < numbered) select(selected);
      } else list.handleInput(data);
    }

    updateList();
    return {
      capturesViewportInput: true,
      get focused() { return focused; },
      set focused(value) {
        focused = value;
        if (editor) editor.focused = value;
      },
      render(width) {
        if (width < 1) return [];
        const inset = width > 4 ? "  " : "";
        const row = rows[selected];
        const description = !editor && row?.description && (!inlineDetails || visibleWidth(rowLabel(row, selected)) > width - 4)
          ? ["", ...wrapTextWithAnsi(row.description, width - inset.length).map((line) => inset + theme.fg("muted", line))]
          : [];
        const editorRows = editor ? [
          "",
          theme.fg("accent", truncateToWidth("Written answer", width)),
          ...(width > 2 ? editor.render(width) : []),
          ...(invalidText ? [theme.fg("warning", truncateToWidth("Enter a non-blank answer", width))] : []),
        ] : [];
        const numberStatus = digits
          ? [theme.fg(numberIndex() === undefined ? "warning" : "muted",
              truncateToWidth(numberIndex() === undefined ? `No item ${digits}` : `Number ${digits}`, width))]
          : [];
        const onWritten = written && selected === written.index;
        const hasWritten = !!written?.value();
        const enterHint = onWritten ? (hasWritten ? "Enter edit" : "Enter write")
          : activate && selected < numbered ? "Space toggle" : "Enter select";
        const hints = editor ? ["Enter save", "Shift+Enter new line", "Esc discard edit"] : [
          ...(numbered > 9 ? ["Number then Enter"] : numbered > 0 ? [`${numbered === 1 ? "1" : `1–${numbered}`} ${activate ? "toggle" : "select"}`] : []),
          "↑↓ move",
          enterHint,
          ...(written && !onWritten ? ["w write/edit"] : []),
          ...(onWritten && hasWritten ? ["Delete remove"] : []),
          ...(previous !== undefined ? ["Shift+Tab previous"] : []),
          ...(next?.index() !== undefined ? [next.label] : []),
          cancelHint,
        ];
        visibleRows.length = 0;
        const listRows = list.render(width).flatMap((line, index) => {
          const text = truncateToWidth(line, width);
          return visibleRows[index]?.gapBefore ? ["", text] : [text];
        });
        return renderQuestionPanel(theme, width, heading, [
          ...(instruction ? [theme.fg("muted", truncateToWidth(instruction, width))] : []),
          ...listRows,
          ...description,
          ...editorRows,
          ...numberStatus,
        ], hints);
      },
      handleInput(data) {
        handleKey(data);
        tui.requestRender();
      },
      invalidate() {
        list.invalidate();
        editor?.invalidate();
      },
    };
  });
}
