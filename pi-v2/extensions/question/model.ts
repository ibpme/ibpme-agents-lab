import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const OptionSchema = Type.Object({
  value: Type.String({ description: "Value returned for this choice" }),
  label: Type.String({ minLength: 1, description: "Label shown to the user" }),
  description: Type.Optional(Type.String({ description: "Optional explanation of the choice" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ minLength: 1, description: "Unique identifier within this questionnaire" }),
  label: Type.Optional(Type.String({ description: "Short topic label" })),
  prompt: Type.String({ minLength: 1, description: "Question shown to the user" }),
  options: Type.Array(OptionSchema, { description: "Choices, or an empty list for a written answer" }),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow more than one choice" })),
});

export const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1 }),
});

type QuestionInput = Static<typeof QuestionSchema>;
export type Question = QuestionInput & { label: string; multiSelect: boolean };

const AnswerValueSchema = Type.Object({
  value: Type.String(),
  label: Type.String(),
  wasCustom: Type.Boolean(),
  index: Type.Optional(Type.Number()),
});
const AnswersSchema = Type.Array(Type.Object({ id: Type.String(), values: Type.Array(AnswerValueSchema, { minItems: 1 }) }));
const StoredResultSchema = Type.Object({
  questions: Type.Optional(QuestionnaireParams.properties.questions),
  answers: AnswersSchema,
  cancelled: Type.Boolean(),
  reason: Type.Optional(Type.Union([Type.Literal("dismissed"), Type.Literal("aborted"), Type.Literal("unavailable")])),
});

export type AnswerValue = Static<typeof AnswerValueSchema>;
export type Answer = Static<typeof AnswersSchema>[number];

export type QuestionnaireResult = {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
  reason?: "dismissed" | "aborted" | "unavailable";
};

export function displayText(text: string): string {
  return stripTerminalSequences(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
}

export function displayLine(text: string): string {
  return displayText(text).replace(/\s+/g, " ");
}

export function normalizeQuestions(input: QuestionInput[]): Question[] {
  const ids = new Set<string>();
  return input.map((question, index) => {
    if (!question.id.trim() || !displayText(question.prompt)) throw new Error(`Question ${index + 1} needs an ID and a prompt`);
    if (ids.has(question.id)) throw new Error(`Question ${index + 1} repeats an ID`);
    ids.add(question.id);

    const values = new Set<string>();
    for (const [optionIndex, option] of question.options.entries()) {
      if (!displayLine(option.label)) throw new Error(`Question ${index + 1}, option ${optionIndex + 1} needs a label`);
      if (values.has(option.value)) throw new Error(`Question ${index + 1} repeats an option value`);
      values.add(option.value);
    }

    return {
      ...question,
      label: question.label?.trim() || `Q${index + 1}`,
      multiSelect: question.multiSelect === true,
    };
  });
}

export function readQuestionnaire(details: unknown, args?: unknown): QuestionnaireResult | undefined {
  if (!Check(StoredResultSchema, details)) return undefined;
  const input = details.questions ?? (Check(QuestionnaireParams, args) ? args.questions : undefined);
  if (!input) return undefined;

  let questions: Question[];
  try {
    questions = normalizeQuestions(input);
  } catch {
    return undefined;
  }
  if (details.cancelled) return { ...details, questions, answers: [] };

  const byId = new Map(details.answers.map((answer) => [answer.id, answer]));
  const answers = questions.flatMap(({ id }) => {
    const answer = byId.get(id);
    return answer ? [answer] : [];
  });
  if (answers.length !== questions.length || answers.length !== details.answers.length) return undefined;
  return { ...details, questions, answers };
}

export function sameAnswers(before: Answer[], after: Answer[]): boolean {
  return before.length === after.length && before.every(({ id, values }, index) => {
    const revised = after[index];
    return id === revised.id && values.length === revised.values.length
      && values.every((value) => revised.values.some((other) =>
        value.wasCustom === other.wasCustom && value.value === other.value));
  });
}

export function formatAnswers(questions: Question[], answers: Answer[]): string {
  return answers.map(({ id, values }) => {
    const label = questions.find((question) => question.id === id)?.label ?? id;
    const parts = values.map((choice) => choice.wasCustom
      ? `(wrote) ${choice.label} [value: ${JSON.stringify(choice.value)}]`
      : `${choice.index}. ${choice.label} [value: ${JSON.stringify(choice.value)}]`);
    return `${label}: ${parts.join(", ")}`;
  }).join("\n");
}
