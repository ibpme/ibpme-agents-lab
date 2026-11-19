import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { displayLine } from "./model.ts";

type QuestionUI = ExtensionContext["ui"];
type Panel = Component & { dispose?(): void };

export type QuestionHeading = { prompt: string; progress?: string };

export async function showQuestionPanel<T>(
  ui: QuestionUI,
  heading: QuestionHeading,
  signal: AbortSignal | undefined,
  create: (tui: TUI, theme: Theme, finish: (result?: T) => void) => Panel,
): Promise<T | undefined> {
  if (signal?.aborted) return undefined;
  return ui.custom<T | undefined>((tui, theme, _keys, done) => {
    function dispose() {
      signal?.removeEventListener("abort", abort);
    }
    function finish(result?: T) {
      dispose();
      done(result);
    }
    function abort() {
      finish();
    }

    const component = create(tui, theme, finish);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    component.dispose = dispose;
    return component;
  }, { blocked: { kind: "question", message: displayLine(heading.prompt) } });
}

export function renderQuestionPanel(
  theme: Theme, width: number, { progress, prompt }: QuestionHeading, body: string[], hints: string[],
): string[] {
  if (width < 1) return [];
  const border = theme.fg("border", "─".repeat(width));
  return [
    border,
    ...(progress ? wrapTextWithAnsi(progress, width).map((line) => theme.fg("text", line)) : []),
    ...wrapTextWithAnsi(prompt, width).map((line) => theme.fg("mdLink", theme.bold(line))),
    "",
    ...body,
    "",
    ...wrapTextWithAnsi(hints.join(" · "), width).map((line) => theme.fg("dim", line)),
    border,
  ];
}

interface InputOptions {
  previous?: boolean;
  next?: boolean;
  initial?: string;
  signal?: AbortSignal;
  cancelHint?: string;
}

export function inputQuestion(
  ui: QuestionUI, heading: QuestionHeading, { previous, next, initial, signal, cancelHint = "Esc cancel" }: InputOptions,
): Promise<{ text: string; back?: true } | undefined> {
  return showQuestionPanel(ui, heading, signal, (tui, theme, finish) => {
    const input = new Input({ placeholder: "Type your answer", placeholderStyle: (text) => theme.fg("dim", text) });
    input.setValue(initial ?? "");
    let invalid = false;
    input.onSubmit = (text) => {
      if (displayLine(text)) finish({ text });
      else invalid = true;
    };

    return {
      get focused() { return input.focused; },
      set focused(value) { input.focused = value; },
      render(width) {
        if (width < 2) return [];
        return renderQuestionPanel(theme, width, heading, [
          ...input.render(width),
          ...(invalid ? [theme.fg("warning", truncateToWidth("Enter a non-blank answer", width))] : []),
        ], [
          next ? "Enter / Tab continue" : "Enter confirm",
          previous ? "Shift+Tab / Esc previous" : cancelHint,
        ]);
      },
      handleInput(data) {
        if (previous && (matchesKey(data, "shift+tab") || matchesKey(data, "escape"))) {
          finish({ text: input.getValue(), back: true });
        } else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          finish();
        } else if (next && matchesKey(data, "tab")) {
          input.onSubmit?.(input.getValue());
        } else {
          invalid = false;
          input.handleInput(data);
        }
        tui.requestRender();
      },
      invalidate: () => input.invalidate(),
    };
  });
}
