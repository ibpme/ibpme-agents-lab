import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runQuestionnaire } from "./form.ts";
import { formatAnswers, normalizeQuestions, QuestionnaireParams, type QuestionnaireResult } from "./model.ts";
import { renderQuestionCall, renderQuestionResult } from "./rendering.ts";

const questionTool = defineTool<typeof QuestionnaireParams, QuestionnaireResult>({
  name: "question",
  label: "Question",
  description: "Ask the user one or more questions with single-choice, multiple-choice, or written answers.",
  promptSnippet: "Ask the user to make a decision or provide missing information",
  promptGuidelines: [
    "Group related questions in one question call. Wait for the answers before calling tools that depend on them.",
  ],
  parameters: QuestionnaireParams,
  executionMode: "sequential",
  renderShell: "self",

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const questions = normalizeQuestions(params.questions);
    const interactive = ctx.mode === "tui" || ctx.mode === "rpc";
    const answers = interactive && !signal?.aborted ? await runQuestionnaire(ctx, questions, signal) : undefined;
    const reason = signal?.aborted ? "aborted" : !interactive ? "unavailable" : answers ? undefined : "dismissed";
    const details: QuestionnaireResult = { questions, answers: reason ? [] : answers ?? [], cancelled: !!reason };
    if (reason) details.reason = reason;

    const text = reason === "aborted" ? "Questionnaire interrupted before submission."
      : reason === "unavailable" ? "Interactive questions are unavailable in this mode. Ask in plain text if user input is required."
      : reason === "dismissed" ? "The user cancelled the questionnaire without submitting answers."
      : formatAnswers(questions, details.answers);
    return { content: [{ type: "text", text }], details };
  },

  renderCall: renderQuestionCall,
  renderResult: renderQuestionResult,
});

export default function questionExtension(pi: ExtensionAPI): void {
  pi.registerTool(questionTool);
}
