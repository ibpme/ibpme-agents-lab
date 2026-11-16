import type {
  BashToolDetails,
  EditToolDetails,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { linesComponent, lineSummary, outputLines, pathArg, record, resultComponent, skillName, stringArg } from "./rendering.ts";

type Details = Partial<BashToolDetails & EditToolDetails & FindToolDetails & GrepToolDetails & LsToolDetails & ReadToolDetails>;
type Result = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

function detailsOf(result: Result): Details {
  return result.details !== null && typeof result.details === "object" ? result.details as Details : {};
}

function textOf(result: Result): string {
  return result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function warningsOf(result: Result): string[] {
  const details = detailsOf(result);
  const warnings: string[] = [];
  if (details.truncation?.truncated) {
    const truncation = details.truncation;
    warnings.push(truncation.firstLineExceedsLimit ? "Truncated: first line exceeds output limit"
      : `Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.truncatedBy} limit)`);
  }
  if (details.matchLimitReached) warnings.push(`Match limit reached: ${details.matchLimitReached}`);
  if (details.entryLimitReached) warnings.push(`Entry limit reached: ${details.entryLimitReached}`);
  if (details.resultLimitReached) warnings.push(`Result limit reached: ${details.resultLimitReached}`);
  if (details.linesTruncated) warnings.push("Some matching lines were truncated");
  if (details.fullOutputPath) warnings.push(`Full output: ${details.fullOutputPath}`);
  return warnings;
}

export const readRenderer: ToolRenderers = {
  renderShell: "self",
  renderCall(rawArgs, theme, context) {
    const args = record(rawArgs);
    const path = pathArg(args);
    const skill = skillName(path);
    const extra = [args.offset != null ? `offset=${args.offset}` : "", args.limit != null ? `limit=${args.limit}` : ""].filter(Boolean);
    const text = theme.fg("toolTitle", theme.bold(skill ? "✦ skill" : "▸ read")) + " "
      + (skill ? theme.fg("mdLink", skill) + theme.fg("dim", ` ${path}`) : theme.fg("accent", path))
      + (extra.length ? theme.fg("dim", ` (${extra.join(", ")})`) : "");
    return linesComponent([text], context.outputPad, true);
  },
  renderResult(result, options, theme, context) {
    const lines = outputLines(textOf(result));
    const images = result.content.filter((block) => block.type === "image").length;
    const extras = [lineSummary(lines)];
    if (images) extras.push(`${images} image${images === 1 ? "" : "s"}${context.showImages ? "" : " (hidden)"}`);
    if (skillName(pathArg(context.args))) extras.unshift("skill");
    return resultComponent({
      label: "read", lines, extras, warnings: warningsOf(result), ...options, theme, context,
    });
  },
};

export const writeRenderer: ToolRenderers = {
  renderShell: "self",
  renderCall(rawArgs, theme, context) {
    const args = record(rawArgs);
    const lines = outputLines(stringArg(args, "content"));
    const text = theme.fg("toolTitle", theme.bold("✎ write")) + " " + theme.fg("accent", pathArg(args))
      + theme.fg("dim", ` (${lineSummary(lines, "")})`);
    return linesComponent([text], context.outputPad, true);
  },
  renderResult(result, options, theme, context) {
    // A failed write must show the error, not a preview of content that was never written.
    const lines = outputLines(context.isError ? textOf(result) : stringArg(context.args, "content"));
    return resultComponent({
      label: "write", lines, extras: context.isError ? [] : [lineSummary(lines, options.isPartial ? "content" : "written")],
      warnings: warningsOf(result), previewLimit: 10, ...options, theme, context,
    });
  },
};

export const editRenderer: ToolRenderers = {
  renderShell: "self",
  renderCall(rawArgs, theme, context) {
    const args = record(rawArgs);
    const count = Array.isArray(args.edits) ? args.edits.length : 1;
    const text = theme.fg("toolTitle", theme.bold("✎ edit")) + " " + theme.fg("accent", pathArg(args))
      + (count > 1 ? theme.fg("dim", ` (${count} edits)`) : "");
    return linesComponent([text], context.outputPad, true);
  },
  renderResult(result, options, theme, context) {
    const diff = detailsOf(result).diff;
    const hasDiff = !context.isError && typeof diff === "string";
    const lines = outputLines(hasDiff ? diff : textOf(result));
    const extras: string[] = [];
    if (hasDiff) {
      const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removals = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      extras.push(theme.fg("success", `+${additions}`) + theme.fg("dim", "/") + theme.fg("error", `-${removals}`));
    }
    // Keep the native edit convention: the completed diff is visible without expanding.
    return resultComponent({
      label: "edit", lines, extras, warnings: warningsOf(result), ...options,
      expanded: hasDiff || options.expanded, isDiff: hasDiff, theme, context,
    });
  },
};

type SearchTool = "grep" | "find" | "ls";

function searchRenderer(name: SearchTool, previewLimit: number): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(rawArgs, theme, context) {
      const args = record(rawArgs);
      const path = pathArg(args) || ".";
      const pattern = name === "ls" ? "" : theme.fg("accent", stringArg(args, "pattern")) + theme.fg("dim", " in ");
      const extra: string[] = [];
      if (args.glob) extra.push(`glob=${args.glob}`);
      if (args.limit != null) extra.push(`limit=${args.limit}`);
      if (args.ignoreCase) extra.push("ignore case");
      if (args.literal) extra.push("literal");
      if (args.context != null) extra.push(`context=${args.context}`);
      const text = theme.fg("toolTitle", theme.bold(name === "ls" ? "▸ ls" : `⌕ ${name}`)) + " " + pattern
        + theme.fg("accent", path) + (extra.length ? theme.fg("dim", ` (${extra.join(", ")})`) : "");
      return linesComponent([text], context.outputPad, true);
    },
    renderResult(result, options, theme, context) {
      const text = textOf(result);
      const empty = !context.isError && (text.trim() === "No matches found"
        || text.trim() === "No files found matching pattern" || text.trim() === "(empty directory)");
      const lines = outputLines(text);
      return resultComponent({
        label: name, lines, extras: [empty ? "no results" : lineSummary(lines)],
        warnings: warningsOf(result), previewLimit, ...options, theme, context,
      });
    },
  };
}

export const grepRenderer = searchRenderer("grep", 15);
export const findRenderer = searchRenderer("find", 20);
export const lsRenderer = searchRenderer("ls", 20);

export const bashRenderer: ToolRenderers = {
  renderShell: "self",
  renderCall(rawArgs, theme, context) {
    const args = record(rawArgs);
    const text = theme.fg("toolTitle", theme.bold("$ bash")) + " " + theme.fg("accent", stringArg(args, "command"))
      + (args.timeout != null ? theme.fg("dim", ` (timeout ${args.timeout}s)`) : "");
    return linesComponent([text], context.outputPad, true);
  },
  renderResult(result, options, theme, context) {
    const lines = outputLines(textOf(result));
    return resultComponent({
      label: "bash", lines, extras: [lines.length ? lineSummary(lines) : "no output"],
      warnings: warningsOf(result), previewLimit: 5, tail: true, ...options, theme, context,
    });
  },
};
