import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pickChoice, selectQuestionRow, type PickerRow } from "./choice-picker.ts";
import { displayLine, displayText, type Answer, type AnswerValue, type Question } from "./model.ts";
import { inputQuestion, type QuestionHeading } from "./tui-panel.ts";

type QuestionContext = Pick<ExtensionContext, "mode" | "ui">;
type StepResult = { values: AnswerValue[]; back?: true };
type Navigation = { previous?: boolean; next?: boolean; review?: boolean };

const PREVIOUS_QUESTION = "Previous question";

function dialogTitle({ progress, prompt }: QuestionHeading): string {
  return progress ? `${progress}\n${prompt}` : prompt;
}

function selectedOption(question: Question, index: number): AnswerValue {
  const option = question.options[index];
  return { label: option.label, value: option.value, wasCustom: false, index: index + 1 };
}

async function writeAnswer(
  ctx: QuestionContext, heading: QuestionHeading, signal?: AbortSignal, initial?: string,
): Promise<AnswerValue | undefined> {
  if (ctx.mode === "tui") {
    const answer = await inputQuestion(ctx.ui, heading, { signal, initial, cancelHint: "Esc back to choices" });
    return answer ? writtenValue(answer.text) : undefined;
  }

  const title = initial ? `${dialogTitle(heading)}\nCurrent written answer: ${displayLine(initial)}` : dialogTitle(heading);
  let prompt = title;
  while (!signal?.aborted) {
    const answer = await ctx.ui.input(prompt, initial ? "Type your replacement answer" : "Type your answer", { signal });
    if (answer === undefined || signal?.aborted) return undefined;
    const value = writtenValue(answer);
    if (value) return value;
    prompt = `${title}\nEnter a non-blank answer or cancel to go back.`;
  }
  return undefined;
}

function writtenValue(answer: string): AnswerValue | undefined {
  if (!displayLine(answer)) return undefined;
  const text = answer.trim();
  return { value: text, label: text, wasCustom: true };
}

function optionRows(question: Question): PickerRow[] {
  return question.options.map(({ label, description }) => ({
    label: displayLine(label),
    description: description && displayText(description),
  }));
}

async function askSingle(
  ctx: QuestionContext, question: Question, heading: QuestionHeading, previous: AnswerValue[], navigation: Navigation,
  signal?: AbortSignal,
): Promise<StepResult | undefined> {
  const current = previous[0];
  if (ctx.mode === "tui" && !question.options.length) {
    const answer = await inputQuestion(ctx.ui, heading, {
      ...navigation, initial: current?.value, signal, cancelHint: navigation.review ? "Esc back to review" : undefined,
    });
    if (!answer) return undefined;
    const value = writtenValue(answer.text);
    return { values: value ? [value] : [], back: answer.back };
  }
  if (!question.options.length && !current) {
    const prompt = navigation.previous
      ? `${heading.prompt}\nCancel this input to return to the previous question.` : heading.prompt;
    const answer = await writeAnswer(ctx, { ...heading, prompt }, signal);
    if (answer) return { values: [answer] };
    if (navigation.previous && !signal?.aborted) return { back: true, values: previous };
    return undefined;
  }

  const rows = optionRows(question);
  const write = rows.length;
  const currentIndex = current?.wasCustom ? write
    : question.options.findIndex(({ value }) => value === current?.value);
  if (ctx.mode === "tui") {
    rows.forEach((row, index) => { row.label = `${currentIndex === index ? "◉" : "○"} ${row.label}`; });
  }
  rows.push({
    label: current?.wasCustom ? (ctx.mode === "tui" ? "◉ Edit written answer" : "Edit written answer") : "Write an answer",
    description: ctx.mode === "tui" && current?.wasCustom ? displayLine(current.label) : undefined,
  });
  const keep = current && (ctx.mode === "rpc" || current.wasCustom || currentIndex === -1)
    ? rows.push({ label: "Keep current answer", description: displayLine(current.label) }) - 1 : undefined;
  const back = navigation.previous ? rows.push({ label: PREVIOUS_QUESTION }) - 1 : undefined;

  while (!signal?.aborted) {
    const index = ctx.mode === "tui"
      ? await pickChoice(ctx.ui, heading, () => rows, {
        signal, numbered: write, instruction: "Choose one", initial: Math.max(0, currentIndex), previous: back,
        cancelHint: navigation.review ? "Esc back to review" : undefined,
        next: current && navigation.next ? { label: "Tab continue", index: () => keep ?? currentIndex } : undefined,
      })
      : await selectQuestionRow(ctx.ui, dialogTitle(heading), rows, signal);
    if (index === undefined) return undefined;
    if (index === back) return { back: true, values: previous };
    if (index === keep) return { values: previous };
    if (index < write) return { values: [selectedOption(question, index)] };

    const answer = await writeAnswer(ctx, heading, signal, current?.wasCustom ? current.value : undefined);
    if (answer) return { values: [answer] };
  }
  return undefined;
}

async function askMultiple(
  ctx: QuestionContext, question: Question, heading: QuestionHeading, previous: AnswerValue[], navigation: Navigation,
  signal?: AbortSignal,
): Promise<StepResult | undefined> {
  const options = optionRows(question);
  const selected = new Set(previous.filter((choice) => !choice.wasCustom).map((choice) => choice.value));
  let custom = previous.find((choice) => choice.wasCustom);
  const isTui = ctx.mode === "tui";

  const write = options.length;
  const firstChecked = question.options.findIndex(({ value }) => selected.has(value));
  const initial = firstChecked >= 0 ? firstChecked : custom ? write : 0;
  const done = write + 1;
  const back = navigation.previous ? done + 1 : undefined;
  const remove = (back ?? done) + 1;
  function hasAnswer(): boolean {
    return selected.size > 0 || !!custom;
  }
  function rows(): PickerRow[] {
    const items: PickerRow[] = options.map((row, index) => ({
      ...row,
      label: `[${selected.has(question.options[index].value) ? "x" : " "}] ${row.label}`,
    }));
    const continueLabel = !isTui ? "Done" : navigation.review ? "Save and return to review" : "Continue";
    items.push({
      label: custom && isTui ? `[x] Written answer — ${displayLine(custom.label)}` : custom ? "Edit written answer" : "Write an answer",
      description: custom && !isTui ? displayLine(custom.label) : undefined,
    }, {
      label: hasAnswer() ? continueLabel : `${continueLabel} · select or write an answer`,
      gapBefore: true,
    });
    if (back !== undefined) items.push({ label: PREVIOUS_QUESTION });
    if (custom && !isTui) items.push({ label: "Remove written answer" });
    return items;
  }

  function activate(index: number): boolean {
    if (index < write) {
      const { value } = question.options[index];
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      return false;
    }
    return index !== done || hasAnswer();
  }

  while (!signal?.aborted) {
    let index: number | undefined;
    if (isTui) {
      index = await pickChoice(ctx.ui, heading, rows, {
        signal, numbered: write, instruction: "Choose one or more", initial, previous: back, activate,
        cancelHint: navigation.review ? "Esc back to review" : undefined,
        next: { label: navigation.review ? "Tab save" : "Tab continue", index: () => hasAnswer() ? done : undefined },
        written: {
          index: write,
          value: () => custom?.value,
          change: (text) => { custom = text === undefined ? undefined : writtenValue(text); },
        },
      });
    } else {
      do {
        index = await selectQuestionRow(ctx.ui, `${dialogTitle(heading)}\nSelect one or more answers.`, rows(), signal);
      } while (index !== undefined && !activate(index));
    }
    if (index === undefined || signal?.aborted) return undefined;
    if (index === done || index === back) {
      const values = question.options.flatMap(({ value }, index) =>
        selected.has(value) ? [selectedOption(question, index)] : []);
      if (custom) values.push(custom);
      return index === back ? { back: true, values } : { values };
    }
    if (index === remove) {
      custom = undefined;
      continue;
    }
    const answer = await writeAnswer(ctx, heading, signal, custom?.value);
    if (answer) custom = answer;
  }
  return undefined;
}

export async function runQuestionnaire(
  ctx: QuestionContext, questions: Question[],
  { signal, initialAnswers }: { signal?: AbortSignal; initialAnswers?: Answer[] } = {},
): Promise<Answer[] | undefined> {
  const answers = initialAnswers?.slice() ?? [];
  const isRevision = initialAnswers !== undefined;

  async function ask(index: number, navigation: Navigation): Promise<StepResult | undefined> {
    const question = questions[index];
    const heading = {
      prompt: displayText(question.prompt),
      progress: questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : undefined,
    };
    const existing = answers[index]?.values ?? [];
    const collect = question.multiSelect && question.options.length ? askMultiple : askSingle;
    const step = await collect(ctx, question, heading, existing, navigation, signal);
    if (step) answers[index] = { id: question.id, values: step.values };
    return step;
  }

  if (!answers.length) {
    for (let index = 0; index < questions.length;) {
      const step = await ask(index, { previous: index > 0, next: questions.length > 1 });
      if (!step) return undefined;
      index += step.back ? -1 : 1;
    }
  }
  if (questions.length === 1 && !isRevision) return answers;

  let focusedQuestion = 0;
  const title = isRevision ? "Review and edit previous answers" : "Review your answers";
  while (!signal?.aborted) {
    const rows: PickerRow[] = questions.map((question, index) => ({
      label: displayLine(question.prompt),
      description: answers[index].values.map(({ label }) => displayLine(label)).join(", "),
    }));
    rows.push({
      label: isRevision ? "Continue with revised answers" : "Submit answers",
      description: isRevision ? "Branches the conversation. Workspace files stay as they are." : undefined,
      gapBefore: true,
    });
    const edit = ctx.mode === "tui"
      ? await pickChoice(ctx.ui, { prompt: title }, () => rows, {
        signal, numbered: questions.length, instruction: "Select a question to edit", inlineDetails: true,
        initial: focusedQuestion, next: { label: isRevision ? "Tab apply revision" : "Tab submit", index: () => questions.length },
      })
      : await selectQuestionRow(ctx.ui, title, rows, signal);
    if (edit === undefined) return undefined;
    if (edit === questions.length) return answers;
    focusedQuestion = edit;
    await ask(edit, { review: true });
  }
  return undefined;
}
