import type { KeybindingHints, MessageRenderOptions, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { displayLine, displayText, type QuestionnaireParams, type QuestionnaireResult } from "./model.ts";

type QuestionTool = ToolDefinition<typeof QuestionnaireParams, QuestionnaireResult>;
const PREVIEW_LIMIT = 3;

function withQuestionBackground(
  component: Component,
  theme: Theme,
  outputPad: number,
  { top = false, bottom = false, failed = false }: { top?: boolean; bottom?: boolean; failed?: boolean },
): Component {
  const color = failed ? "toolErrorBg" : "toolPendingBg";
  return {
    render(width) {
      if (width <= 0) return [];
      const padding = " ".repeat(Math.min(outputPad, Math.floor((width - 1) / 2)));
      const available = width - padding.length * 2;
      const rows = [...(top ? [""] : []), ...component.render(available), ...(bottom ? [""] : [])];
      return rows.map((line) =>
        theme.bg(color, padding + truncateToWidth(line, available, undefined, true) + padding));
    },
    invalidate: () => component.invalidate(),
  };
}

export const renderQuestionCall: NonNullable<QuestionTool["renderCall"]> = (args, theme, context) => {
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  const count = questions.length;
  const title = theme.fg("toolTitle", theme.bold(count > 1 ? `Questions (${count})` : "Question"));
  const topics = questions.slice(0, 2).map((question) => {
    const label = count > 1 && typeof question?.label === "string" ? displayLine(question.label) : "";
    const prompt = typeof question?.prompt === "string" ? displayLine(question.prompt) : "";
    return count > 1 ? truncateToWidth(label || prompt, 24) : prompt;
  }).filter(Boolean);
  const preview = topics.length ? ` · ${topics.join(", ")}${count > 2 ? ` +${count - 2}` : ""}` : "";
  const heading = title + theme.fg("muted", preview);
  return withQuestionBackground({
    render: (width) => [truncateToWidth(heading, width)],
    invalidate() {},
  }, theme, context.outputPad, { top: true, bottom: context.isPartial });
};

export const renderQuestionResult: NonNullable<QuestionTool["renderResult"]> = (result, options, theme, context) => {
  const failed = context.isError && !options.isPartial && !result.details?.cancelled;
  return withQuestionBackground(renderResultBody(result, options, theme, context), theme, context.outputPad, {
    bottom: true, failed,
  });
};

const renderResultBody: NonNullable<QuestionTool["renderResult"]> = (result, options, theme, context) => {
  const details = result.details;
  if (details?.cancelled) {
    const status = details.reason === "aborted" ? "Interrupted"
      : details.reason === "unavailable" ? "Interactive questions unavailable" : "Cancelled";
    return new Text(theme.fg("warning", status), 0, 0);
  }
  if (context.isError || !Array.isArray(details?.answers) || !Array.isArray(details.questions) || !details.answers.length) {
    const content = result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    if (!context.isError) return new Text(displayText(content), 0, 0);
    const status = theme.fg("error", "✗ Failed");
    const message = options.expanded ? displayText(content) : displayLine(content);
    return new Text(message ? `${status}\n${theme.fg("text", message)}` : status, 0, 0);
  }
  return renderAnswers(details, options.expanded, theme, context);
};

export function renderRevisedAnswers(
  results: QuestionnaireResult[], options: MessageRenderOptions, theme: Theme,
): Component {
  const title = theme.fg("toolTitle", theme.bold("Revised questionnaire answers"));
  const sections = results.map((result) => renderAnswers(result, options.expanded, theme, options));
  return withQuestionBackground({
    render: (width) => [
      truncateToWidth(title, width),
      ...sections.flatMap((section) => options.expanded ? ["", ...section.render(width)] : section.render(width)),
    ],
    invalidate: () => sections.forEach((section) => section.invalidate()),
  }, theme, options.outputPad, { top: true, bottom: true });
}

function renderAnswers(details: QuestionnaireResult, expanded: boolean, theme: Theme, context: KeybindingHints): Component {
  const questions = new Map(details.questions.map((question) => [question.id, question]));
  if (!expanded) {
    const rows = details.answers.slice(0, PREVIEW_LIMIT).map(({ id, values }, index) => {
      const question = questions.get(id);
      const topic = displayLine(question?.label ?? id) || displayLine(id);
      const summary = values.map(({ label }) => displayLine(label)).join(", ");
      return [
        index === 0 ? theme.fg("success", "✓ ") : "  ",
        theme.fg("accent", topic),
        theme.fg("text", ` → ${summary}`),
      ].join("");
    });
    const remaining = details.answers.length - rows.length;
    return {
      render(width) {
        if (width <= 0) return [];
        const lines = ["", ...rows.map((row) => truncateToWidth(row, width))];
        if (remaining > 0 || rows.some((row) => visibleWidth(row) > width)) {
          const hint = context.keyHint("app.tools.expand", "expand");
          const note = [remaining ? `+${remaining} more` : "", hint].filter(Boolean).join(" · ");
          if (note) lines.push("", truncateToWidth(`  ${theme.fg("muted", note)}`, width));
        }
        return lines;
      },
      invalidate() {},
    };
  }

  return {
    render(width) {
      if (width <= 0) return [];
      const indent = width >= 12 ? "  " : "";
      return details.answers.flatMap(({ id, values }, index) => {
        const question = questions.get(id);
        const prompt = displayText(question?.prompt ?? id);
        const heading = wrapTextWithAnsi(prompt, width).map((line) => theme.fg("mdLink", theme.bold(line)));
        const answers = values.flatMap(({ label, wasCustom }) => {
          if (!wasCustom) {
            return wrapTextWithAnsi(`• ${displayLine(label)}`, width - indent.length)
              .map((line) => indent + theme.fg("text", line));
          }
          const left = indent + indent;
          const body = displayText(label).replaceAll("\t", "    ");
          return [
            truncateToWidth(indent + theme.fg("muted", "Written answer"), width),
            ...wrapTextWithAnsi(body, width - left.length).map((line) => left + theme.fg("text", line)),
          ];
        });
        return [...(index ? [""] : []), ...heading, ...answers];
      });
    },
    invalidate() {},
  };
}
