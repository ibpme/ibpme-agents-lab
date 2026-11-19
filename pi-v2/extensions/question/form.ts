import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";
import { displayLine, displayText, type Answer, type AnswerValue, type Question } from "./model.ts";
import { pickChoice } from "./choice-picker.ts";
import { inputQuestion, type QuestionHeading } from "./tui-panel.ts";

type QuestionContext = Pick<ExtensionContext, "mode" | "ui">;
type StepResult = { values: AnswerValue[]; back?: true };
type Navigation = { previous: boolean; next: boolean };

const PREVIOUS_QUESTION = "Previous question";

function dialogTitle({ progress, prompt }: QuestionHeading): string {
  return progress ? `${progress}\n${prompt}` : prompt;
}

function selectedOption(question: Question, index: number): AnswerValue {
  const option = question.options[index];
  return { label: option.label, value: option.value, wasCustom: false, index: index + 1 };
}

async function selectRow(
  ui: QuestionContext["ui"], title: string, rows: SelectItem[], signal?: AbortSignal,
): Promise<number | undefined> {
  if (signal?.aborted) return undefined;
  const labels = rows.map(({ label, description }, index) =>
    `${index + 1}. ${label}${description ? ` — ${displayLine(description)}` : ""}`);
  const choice = await ui.select(title, labels, { signal });
  const index = choice === undefined ? -1 : labels.indexOf(choice);
  return index < 0 || signal?.aborted ? undefined : index;
}

async function writeAnswer(
  ctx: QuestionContext, heading: QuestionHeading, signal?: AbortSignal,
): Promise<AnswerValue | undefined> {
  if (ctx.mode === "tui") {
    const answer = await inputQuestion(ctx.ui, heading, { signal });
    return answer ? writtenValue(answer.text) : undefined;
  }

  const title = dialogTitle(heading);
  let prompt = title;
  while (!signal?.aborted) {
    const answer = await ctx.ui.input(prompt, "Type your answer", { signal });
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

function optionRows(question: Question): SelectItem[] {
  return question.options.map(({ label, description }, index) => ({
    value: String(index),
    label: displayLine(label),
    description: description && displayText(description),
  }));
}

async function askSingle(
  ctx: QuestionContext, question: Question, heading: QuestionHeading, previous: AnswerValue[], navigation: Navigation,
  signal?: AbortSignal,
): Promise<StepResult | undefined> {
  if (ctx.mode === "tui" && !question.options.length) {
    const answer = await inputQuestion(ctx.ui, heading, { ...navigation, initial: previous[0]?.value, signal });
    if (!answer) return undefined;
    const value = writtenValue(answer.text);
    return { values: value ? [value] : [], back: answer.back };
  }

  const rows = optionRows(question);
  const write = rows.length;
  rows.push({ value: String(write), label: "Write an answer" });
  if (previous.length) rows.unshift({
    value: "keep", label: "Keep current answer", description: displayLine(previous[0].label),
  });
  if (navigation.previous) rows.push({ value: "back", label: PREVIOUS_QUESTION });

  if (!question.options.length && !previous.length) {
    const prompt = navigation.previous
      ? `${heading.prompt}\nCancel this input to return to the previous question.` : heading.prompt;
    const answer = await writeAnswer(ctx, { ...heading, prompt }, signal);
    if (answer) return { values: [answer] };
    if (navigation.previous && !signal?.aborted) return { back: true, values: previous };
    return undefined;
  }

  while (!signal?.aborted) {
    const index = ctx.mode === "tui"
      ? await pickChoice(ctx.ui, heading, () => rows.map((row) => {
        const option = question.options[Number(row.value)];
        if (!option) return row;
        const wasSelected = previous.some((choice) => !choice.wasCustom && choice.value === option.value);
        return { ...row, label: `${wasSelected ? "◉" : "○"} ${row.label}` };
      }), {
        signal,
        previous: navigation.previous ? rows.length - 1 : undefined,
        next: navigation.next && previous.length ? () => 0 : undefined,
      })
      : await selectRow(ctx.ui, dialogTitle(heading), rows, signal);
    if (index === undefined) return undefined;
    const { value } = rows[index];
    if (value === "keep") return { values: previous };
    if (value === "back") return { back: true, values: previous };
    if (Number(value) !== write) return { values: [selectedOption(question, Number(value))] };

    const answer = await writeAnswer(ctx, heading, signal);
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

  const write = options.length;
  const done = write + 1;
  const back = done + 1;
  function rows(): SelectItem[] {
    const items = options.map((row, index) => ({
      ...row,
      label: `[${selected.has(question.options[index].value) ? "x" : " "}] ${row.label}`,
    }));
    items.push({
      value: String(write),
      label: custom ? "Written answer" : "Write an answer",
      description: custom && displayLine(custom.label),
    }, {
      value: String(done),
      label: selected.size || custom ? "Done" : "Done · select at least one answer",
    });
    if (navigation.previous) items.push({ value: String(back), label: PREVIOUS_QUESTION });
    return items;
  }

  function activate(index: number): boolean {
    if (index < write) {
      const { value } = question.options[index];
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      return false;
    }
    return index !== done || !!(selected.size || custom);
  }

  while (!signal?.aborted) {
    let index: number | undefined;
    if (ctx.mode === "tui") {
      index = await pickChoice(ctx.ui, heading, rows, {
        signal,
        previous: navigation.previous ? back : undefined,
        next: navigation.next ? () => (selected.size || custom ? done : undefined) : undefined,
        checklist: { activate, optionCount: write },
      });
    } else {
      do {
        index = await selectRow(ctx.ui, `${dialogTitle(heading)}\nSelect one or more answers.`, rows(), signal);
      } while (index !== undefined && !activate(index));
    }
    if (index === undefined || signal?.aborted) return undefined;
    if (index === done || index === back) {
      const values = question.options.flatMap(({ value }, index) =>
        selected.has(value) ? [selectedOption(question, index)] : []);
      if (custom) values.push(custom);
      return index === back ? { back: true, values } : { values };
    }

    if (custom) {
      const action = await selectRow(ctx.ui, `${dialogTitle(heading)}\nCurrent written answer: ${displayLine(custom.label)}`, [
        { value: "replace", label: "Replace written answer" },
        { value: "remove", label: "Remove written answer" },
        { value: "keep", label: "Keep written answer" },
      ], signal);
      if (action === 1) custom = undefined;
      if (action !== 0) continue;
    }
    const answer = await writeAnswer(ctx, heading, signal);
    if (answer) custom = answer;
  }
  return undefined;
}

export async function runQuestionnaire(
  ctx: QuestionContext, questions: Question[], signal?: AbortSignal,
): Promise<Answer[] | undefined> {
  const answers: Answer[] = [];
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

  for (let index = 0; index < questions.length;) {
    const step = await ask(index, { previous: index > 0, next: questions.length > 1 });
    if (!step) return undefined;
    index += step.back ? -1 : 1;
  }
  if (questions.length === 1) return answers;

  while (!signal?.aborted) {
    const rows: SelectItem[] = questions.map((question, index) => ({
      value: String(index),
      label: displayLine(question.prompt),
      description: answers[index].values.map(({ label }) => displayLine(label)).join(", "),
    }));
    rows.push({ value: "submit", label: "Submit answers" });
    const edit = await selectRow(ctx.ui, "Review your answers", rows, signal);
    if (edit === undefined) return undefined;
    if (edit === questions.length) return answers;
    await ask(edit, { previous: false, next: false });
  }
  return undefined;
}
