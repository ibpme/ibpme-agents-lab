import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../shared/terminal-text.ts";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderResult"]>>[3];

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function linesComponent(lines: string[], padding: number, wrap = false): Component {
  return {
    render(width) {
      if (width <= 0) return [];
      const pad = Math.min(Math.max(0, padding), Math.floor((width - 1) / 2));
      const available = width - pad * 2;
      return lines.flatMap((line) => line.replace(/\t/g, "    ").split(/\r?\n/))
        .flatMap((line) => wrap ? wrapTextWithAnsi(line, available) : [line])
        .map((line) => " ".repeat(pad) + truncateToWidth(line, available, "", true));
    },
    invalidate() {},
  };
}

export function outputLines(text: string): string[] {
  return text ? text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
}

export function lineSummary(lines: string[], qualifier = "output"): string {
  return `${lines.length} ${qualifier ? `${qualifier} ` : ""}line${lines.length === 1 ? "" : "s"}`;
}

export function pathArg(args: unknown): string {
  return stringArg(args, "path") || stringArg(args, "file_path");
}

export function stringArg(args: unknown, key: string): string {
  const value = record(args)[key];
  return typeof value === "string" ? sanitizeTerminalText(value) : "";
}

export function skillName(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  if (/^SKILL\.md$/i.test(normalized)) return normalized;
  const match = /(?:^|\/)([^/]+)\/SKILL\.md$/i.exec(normalized);
  if (match) return match[1];
  return /(?:^|\/)skills\/([^/]+)\.md$/i.exec(normalized)?.[1];
}

export function diffColor(theme: Theme, line: string): string {
  const color = line.startsWith("+") && !line.startsWith("+++") ? "toolDiffAdded"
    : line.startsWith("-") && !line.startsWith("---") ? "toolDiffRemoved" : "toolDiffContext";
  return theme.fg(color, line);
}

interface ResultView {
  label: string;
  lines: string[];
  extras?: string[];
  warnings?: string[];
  previewLimit?: number;
  expanded: boolean;
  isPartial: boolean;
  theme: Theme;
  context: RenderContext;
  isDiff?: boolean;
  tail?: boolean;
}

export function resultComponent({
  label, lines, extras = [], warnings = [], previewLimit = 3,
  expanded, isPartial, theme, context, isDiff = false, tail = false,
}: ResultView): Component {
  const failed = !isPartial && context.isError;
  const color = isPartial ? "borderAccent" : failed ? "error" : "success";
  const status = isPartial ? "⟳ running" : failed ? "✗ failed" : "✓ done";
  const parts: string[] = [];
  if (!isPartial && context.durationMs != null && Number.isFinite(context.durationMs)) {
    parts.push(`${(context.durationMs / 1000).toFixed(2)}s`);
  }
  parts.push(...extras);
  const shown = expanded ? lines : tail ? lines.slice(-previewLimit) : lines.slice(0, previewLimit);
  const hidden = lines.length - shown.length;
  if (hidden > 0) {
    parts.push(`${hidden} ${tail ? "earlier" : "more"} line${hidden === 1 ? "" : "s"}`);
    parts.push(context.keyHint("app.tools.expand", "expand"));
  }
  const statusLine = theme.fg(isPartial ? "warning" : failed ? "error" : "muted", status)
    + (parts.length ? theme.fg("muted", ` · ${parts.filter(Boolean).join(" · ")}`) : "");
  const body = shown.map((line) => failed ? theme.fg("error", line)
    : isDiff ? diffColor(theme, line) : theme.fg(expanded ? "toolOutput" : "dim", line));
  const notices = warnings.map((warning) => theme.fg("warning", sanitizeTerminalText(warning)));
  if (!expanded && !isDiff) return linesComponent([statusLine, ...body, ...notices], context.outputPad);

  const guide = theme.fg(color, "│");
  return linesComponent([
    `${theme.fg(color, "●")} ${theme.fg("toolTitle", theme.bold(label))}`,
    ...body.map((line) => `${guide} ${line}`),
    ...notices.map((line) => `${guide} ${line}`),
    `${guide} ${statusLine}`,
  ], context.outputPad, true);
}
