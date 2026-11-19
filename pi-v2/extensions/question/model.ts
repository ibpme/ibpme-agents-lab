import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

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

export type AnswerValue = {
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
};

export type Answer = { id: string; values: AnswerValue[] };

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

export function formatAnswers(questions: Question[], answers: Answer[]): string {
  return answers.map(({ id, values }) => {
    const label = questions.find((question) => question.id === id)?.label ?? id;
    const parts = values.map((choice) => choice.wasCustom
      ? `(wrote) ${choice.label} [value: ${JSON.stringify(choice.value)}]`
      : `${choice.index}. ${choice.label} [value: ${JSON.stringify(choice.value)}]`);
    return `${label}: ${parts.join(", ")}`;
  }).join("\n");
}
