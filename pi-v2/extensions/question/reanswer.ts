import type { ContextEvent, ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { pickChoice, selectQuestionRow, type PickerRow } from "./choice-picker.ts";
import { runQuestionnaire } from "./form.ts";
import { displayLine, formatAnswers, readQuestionnaire, sameAnswers, type QuestionnaireResult } from "./model.ts";
import { renderRevisedAnswers } from "./rendering.ts";

const REANSWER_MESSAGE = "question-reanswer";

type Revision = {
  toolCallId: string;
  resultEntryId?: string;
  resultTimestamp?: number;
  result: QuestionnaireResult;
};
type Batch = { checkpointId: string; revisions: Map<string, Revision> };
type Candidate = Revision & { resultEntryId: string; resultTimestamp: number; batch: Batch };

function readRevisions(details: unknown): Revision[] {
  // Legacy sessions stored a single revision directly in details.
  return (Array.isArray(details) ? details : [details]).flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("toolCallId" in item) || typeof item.toolCallId !== "string") return [];
    const result = readQuestionnaire("result" in item ? item.result : undefined);
    if (!result || result.cancelled) return [];
    const resultEntryId = "resultEntryId" in item && typeof item.resultEntryId === "string" ? item.resultEntryId : undefined;
    const resultTimestamp = "resultTimestamp" in item && typeof item.resultTimestamp === "number" ? item.resultTimestamp : undefined;
    return [{ toolCallId: item.toolCallId, resultEntryId, resultTimestamp, result }];
  });
}

function findCandidates(branch: SessionEntry[]): Candidate[] {
  const candidates = new Map<string, Candidate>();
  const byCall = new Map<string, Candidate>();
  const pending = new Map<string, { name: string; arguments: unknown }>();
  const questionnaires: Omit<Candidate, "batch">[] = [];

  for (const entry of branch) {
    if (entry.type === "custom_message" && entry.customType === REANSWER_MESSAGE) {
      for (const revision of readRevisions(entry.details)) {
        const candidate = revision.resultEntryId ? candidates.get(revision.resultEntryId) : byCall.get(revision.toolCallId);
        if (!candidate || candidate.toolCallId !== revision.toolCallId) continue;
        candidate.result = revision.result;
        candidate.batch.revisions.set(candidate.resultEntryId, {
          ...revision, resultEntryId: candidate.resultEntryId, resultTimestamp: candidate.resultTimestamp,
        });
      }
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "system") continue;
    if (message.role !== "toolResult") {
      pending.clear();
      questionnaires.length = 0;
      if (message.role === "assistant") {
        for (const call of message.content) {
          if (call.type === "toolCall") pending.set(call.id, call);
        }
      }
      continue;
    }
    const call = pending.get(message.toolCallId);
    if (!call) continue;
    pending.delete(message.toolCallId);
    if (call.name === "question" && message.toolName === "question" && !message.isError) {
      const result = readQuestionnaire(message.details, call.arguments);
      if (result && result.reason !== "unavailable") {
        questionnaires.push({
          result, toolCallId: message.toolCallId, resultEntryId: entry.id, resultTimestamp: message.timestamp,
        });
      }
    }
    if (pending.size) continue;

    // Every tool in the assistant message must have a result on the new branch.
    const batch: Batch = { checkpointId: entry.id, revisions: new Map() };
    for (const questionnaire of questionnaires) {
      const candidate = { ...questionnaire, batch };
      candidates.set(candidate.resultEntryId, candidate);
      byCall.set(candidate.toolCallId, candidate);
    }
  }
  return [...candidates.values()].reverse();
}

function revisionContent(revisions: Revision[]): string {
  const questionnaires = revisions.map(({ result: { questions, answers } }) =>
    `${questions.map(({ label, prompt }) => `${label}: ${prompt}`).join("\n")}\n\n${formatAnswers(questions, answers)}`);
  return `The user revised their questionnaire answers. These answers supersede the earlier answers.\n\n${questionnaires.join("\n\n")}`;
}

function projectRevisions({ messages }: ContextEvent) {
  type Message = ContextEvent["messages"][number];
  const results = new Map<string, number>();
  const projected = new Map<number, Message | null>();

  messages.forEach((message, index) => {
    if (message.role === "toolResult" && message.toolName === "question") results.set(message.toolCallId, index);
    if (message.role !== "custom" || message.customType !== REANSWER_MESSAGE) return;
    const revisions = readRevisions(message.details);
    if (!revisions.length) return;

    const remaining = revisions.filter((revision) => {
      const target = results.get(revision.toolCallId);
      if (target === undefined) return true;
      const original = messages[target];
      if (original.role !== "toolResult" ||
          (revision.resultTimestamp !== undefined && original.timestamp !== revision.resultTimestamp)) return true;
      const { questions, answers } = revision.result;
      projected.set(target, {
        ...original, isError: false, details: revision.result,
        content: [{ type: "text", text: formatAnswers(questions, answers) }],
      });
      return false;
    });
    // A compaction can retain the revision beyond the original tool batch.
    if (!remaining.length) projected.set(index, null);
    else if (remaining.length < revisions.length) {
      projected.set(index, { ...message, content: revisionContent(remaining), details: remaining });
    }
  });

  if (!projected.size) return undefined;
  return {
    messages: messages.flatMap((message, index) => {
      const replacement = projected.get(index);
      return replacement === null ? [] : [replacement ?? message];
    }),
  };
}

function candidateRow({ result }: Candidate): PickerRow {
  const { questions, answers } = result;
  const topics = questions.map(({ label, prompt }) =>
    /^Q\d+$/.test(label) ? displayLine(prompt) : displayLine(label));
  const summary = answers.flatMap(({ values }) => values.map(({ label }) => displayLine(label))).join(", ");
  return { label: truncateToWidth(topics.join(", "), 55), description: truncateToWidth(summary || "Unanswered", 76) };
}

export function registerReanswer(pi: ExtensionAPI): void {
  pi.on("context", projectRevisions);
  pi.registerMessageRenderer(REANSWER_MESSAGE, (message, options, theme) =>
    renderRevisedAnswers(readRevisions(message.details).map(({ result }) => result), options, theme));

  pi.registerCommand("reanswer", {
    description: "Reopen a questionnaire. Optional number counts from newest.",
    async handler(args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify("/reanswer requires an interactive client", "warning");
        return;
      }
      const requested = args.trim();
      const number = Number(requested);
      if (requested && (!/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(number))) {
        ctx.ui.notify("Use /reanswer or /reanswer <number>, counting from the newest questionnaire.", "warning");
        return;
      }
      await ctx.waitForIdle();
      const sessionId = ctx.sessionManager.getSessionId();
      const leafId = ctx.sessionManager.getLeafId();
      const candidates = findCandidates(ctx.sessionManager.getBranch());
      if (!candidates.length) {
        ctx.ui.notify("No completed questionnaires on this branch", "info");
        return;
      }

      if (requested && number > candidates.length) {
        ctx.ui.notify(`Choose a questionnaire from 1 to ${candidates.length}, counting from newest.`, "warning");
        return;
      }
      let index = requested ? number - 1 : 0;
      if (!requested && candidates.length > 1) {
        const rows = candidates.map(candidateRow);
        const title = "Which questionnaire do you want to revise?";
        const picked = ctx.mode === "tui"
          ? await pickChoice(ctx.ui, { prompt: title }, () => rows, {
            numbered: rows.length, instruction: "Newest first", inlineDetails: true,
          })
          : await selectQuestionRow(ctx.ui, title, rows);
        if (picked === undefined) return;
        index = picked;
      }
      const candidate = candidates[index];
      const { questions, answers: previous } = candidate.result;
      const answers = await runQuestionnaire(ctx, questions, { initialAnswers: previous });
      if (!answers) return;
      if (sameAnswers(previous, answers)) {
        ctx.ui.notify("Answers are unchanged", "info");
        return;
      }
      if (ctx.sessionManager.getSessionId() !== sessionId || ctx.sessionManager.getLeafId() !== leafId || !ctx.isIdle()) {
        ctx.ui.notify("The conversation changed while you were editing. Run /reanswer again.", "warning");
        return;
      }

      const { batch, resultEntryId, resultTimestamp, toolCallId } = candidate;
      const navigation = await ctx.navigateTree(batch.checkpointId, { summarize: false });
      if (navigation.cancelled) {
        ctx.ui.notify("The revised branch was cancelled", "info");
        return;
      }
      if (ctx.sessionManager.getLeafId() !== batch.checkpointId || !ctx.isIdle()) {
        ctx.ui.notify("The conversation moved before the revision could be saved. Run /reanswer again.", "warning");
        return;
      }

      // Carry forward earlier revisions of sibling questionnaires from this batch.
      batch.revisions.set(resultEntryId, { resultEntryId, resultTimestamp, toolCallId, result: { questions, answers, cancelled: false } });
      const revisions = [...batch.revisions.values()];
      pi.sendMessage({
        customType: REANSWER_MESSAGE, display: true, details: revisions, content: revisionContent(revisions),
      }, { triggerTurn: true });
    },
  });
}
