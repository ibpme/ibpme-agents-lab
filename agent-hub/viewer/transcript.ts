import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AgentSnapshot } from "./reader.ts";
import type { SessionMetrics, SessionSnapshot } from "./session.ts";
import type { BrowserTheme, BrowserTone } from "./theme.ts";
import { ago, clean, compactCount, spinner, stateGlyph } from "./view.ts";

export { compactCount };

export const formatCost = (value: number): string => value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;

/** Fallback for snapshots without structured metrics: compact counts and highlight the string. */
export const usageText = (text: string, theme: BrowserTheme): string =>
  text.replace(/([a-z-]+)=([0-9]+|unavailable)|(\$[0-9.]+)|(\(partial\)|\(latest snapshot; may lag\))/g, (_m, key, value, dollars, note) =>
    dollars ? theme.fg("success", theme.bold(dollars)) : note ? theme.fg("warning", note)
      : `${theme.fg("dim", `${key}=`)}${theme.fg(value === "unavailable" ? "dim" : "syntaxNumber", value === "unavailable" ? value : compactCount(Number(value)))}`);

const meter = (ratio: number, cells: number, theme: BrowserTheme, tone: BrowserTone): string => {
  const filled = Math.max(0, Math.min(cells, Math.round(ratio * cells)));
  return theme.fg(tone, "▰".repeat(filled)) + theme.fg("dim", "▱".repeat(cells - filled));
};

/** Token, cost, and activity chips shown above a transcript. */
export function metricsLines(snapshot: SessionSnapshot | undefined, width: number, theme: BrowserTheme): string[] {
  const metrics: SessionMetrics | undefined = snapshot?.metrics;
  if (!metrics) return wrapTextWithAnsi(usageText(snapshot?.usage ?? "Usage/cost: unavailable", theme), width);
  const { input, output, cacheRead, cacheWrite } = metrics.tokens;
  const chip = (glyph: string, value: number | null, label: string, tone: BrowserTone) =>
    `${theme.fg(tone, glyph)} ${value === null ? theme.fg("dim", "–") : theme.bold(theme.fg(tone, compactCount(value)))} ${theme.fg("dim", label)}`;
  const gap = "   ";
  const tokens = [
    chip("↑", input, "in", "syntaxType"), chip("↓", output, "out", "syntaxKeyword"),
    chip("⟳", cacheRead, "cache read", "syntaxString"), chip("✎", cacheWrite, "cache write", "syntaxNumber"),
  ].join(gap) + (metrics.partial ? theme.fg("warning", " ~partial") : "");
  const cost = metrics.cost === null ? theme.fg("dim", "$ –")
    : theme.fg("success", theme.bold(formatCost(metrics.cost))) +
      (metrics.costPartial ? theme.fg("warning", " ~partial") : "") + (metrics.costMayLag ? theme.fg("dim", " (may lag)") : "");
  const entries = snapshot!.entries;
  const count = (kind: string) => entries.filter(entry => entry.label.split(" ")[0] === kind).length;
  const failed = entries.filter(entry => entry.label.startsWith("RESULT") && entry.label.endsWith(" ERROR")).length;
  const stats = [
    `${theme.fg("userMessageText", "❯")} ${theme.bold(String(count("USER")))} ${theme.fg("dim", "prompts")}`,
    `${theme.fg("success", "●")} ${theme.bold(String(count("ASSISTANT")))} ${theme.fg("dim", "replies")}`,
    `${theme.fg("toolTitle", "▸")} ${theme.bold(String(count("TOOL")))} ${theme.fg("dim", "tools")}`,
    failed ? theme.fg("error", `✗ ${theme.bold(String(failed))} failed`) : "",
  ].filter(Boolean);
  const prompt = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  if (cacheRead !== null && prompt > 0) {
    const ratio = cacheRead / prompt;
    stats.push(`${theme.fg("dim", "cache hit")} ${meter(ratio, 8, theme, ratio >= 0.5 ? "syntaxString" : "warning")} ${theme.fg("text", `${Math.round(ratio * 100)}%`)}`);
  }
  const first = `${tokens}${theme.fg("dim", " · ")}${cost}`;
  return [...wrapTextWithAnsi(first, width), ...wrapTextWithAnsi(stats.join(gap), width)];
}

const markdownTheme = (theme: BrowserTheme): MarkdownTheme => ({
  heading: text => theme.bold(theme.fg("mdHeading", text)),
  link: text => (theme.underline ?? (value => value))(theme.fg("mdLink", text)),
  linkUrl: text => theme.fg("mdLinkUrl", text),
  code: text => theme.fg("mdCode", text),
  codeBlock: text => theme.fg("mdCodeBlock", text),
  // Swap raw ``` fences for a quiet rule that still names the language.
  codeBlockBorder: text => theme.fg("mdCodeBlockBorder", text.replace(/^```\s*(\S*).*$/, (_m, lang: string) => lang ? `╌╌ ${lang}` : "╌╌")),
  quote: text => (theme.italic ?? (value => value))(theme.fg("mdQuote", text)),
  quoteBorder: text => theme.fg("mdQuoteBorder", text),
  hr: text => theme.fg("mdHr", text),
  listBullet: text => theme.fg("mdListBullet", text),
  bold: text => theme.bold(text),
  italic: text => (theme.italic ?? (value => value))(text),
  strikethrough: text => theme.fg("dim", text),
  underline: text => (theme.underline ?? (value => value))(text),
});

function markdown(text: string, width: number, theme: BrowserTheme): string[] {
  try {
    const lines = new Markdown(text, 0, 0, markdownTheme(theme)).render(Math.max(1, width)).map(line => line.replace(/ +$/, ""));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    return lines;
  } catch { return text.split("\n").flatMap(line => wrapTextWithAnsi(line, width)); }
}

const TOOL_KINDS: Array<[RegExp, string, BrowserTone]> = [
  [/^(bash|shell|exec|run|terminal|command)/i, "$", "syntaxFunction"],
  [/^(edit|write|multiedit|notebookedit|patch|apply)/i, "✎", "syntaxString"],
  [/^(read|view|cat|open|notebookread)/i, "≡", "mdLink"],
  [/^(grep|glob|find|ls|search|list)/i, "⌕", "syntaxType"],
  [/^(web|fetch|http|curl|browse)/i, "↯", "mdCode"],
  [/^(task|agent|spawn|subagent|send_message|delegate)/i, "◈", "syntaxKeyword"],
];
const toolStyle = (name: string): [string, BrowserTone] => {
  const plain = name.replace(/^mcp__[^_]+__/, "");
  const match = TOOL_KINDS.find(([pattern]) => pattern.test(plain));
  return match ? [match[1], match[2]] : ["▸", "toolTitle"];
};

/** Renders `{"command":"npm test"}` as `npm test` and other objects as `key: value, …`. */
export function toolArguments(text: string): string {
  const raw = text.replace(/\n… \[truncated\]$/, "");
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      const primitive = (item: unknown) => typeof item === "string" ? item : JSON.stringify(item);
      if (entries.length === 1) return clean(primitive(entries[0][1]));
      return clean(entries.map(([key, item]) => `${key}: ${primitive(item)}`).join(", "));
    }
  } catch { /* truncated or non-JSON input */ }
  return clean(raw);
}

export function transcriptLines(entries: SessionSnapshot["entries"], width: number, theme: BrowserTheme): string[] {
  const lines: string[] = [];
  const block = (text: string | string[], first: string, rest: string, tone?: BrowserTone, limit = Infinity) => {
    const room = Math.max(1, width - visibleWidth(first));
    let wrapped = Array.isArray(text) ? text : text.split("\n").flatMap(line => wrapTextWithAnsi(line, room));
    if (wrapped.length > limit) wrapped = [...wrapped.slice(0, limit - 1), theme.fg("dim", `… +${wrapped.length - limit + 1} lines`)];
    wrapped.forEach((line, i) => lines.push((i ? rest : first) + (tone ? theme.fg(tone, line) : line)));
  };
  let previous = "";
  for (const entry of entries) {
    const [kind, ...rest] = entry.label.split(" ");
    const error = rest.at(-1) === "ERROR";
    const name = clean((error ? rest.slice(0, -1) : rest).join(" ") || "unknown");
    const turn = kind !== "TOOL" && kind !== "RESULT";
    if (lines.length && (turn || previous === "turn")) lines.push("");
    previous = turn ? "turn" : "tool";
    if (kind === "USER") block(entry.text, theme.fg("accent", theme.bold("❯ ")), "  ", "userMessageText");
    else if (kind === "ASSISTANT") block(markdown(entry.text, width - 2, theme), theme.fg("success", "● "), "  ");
    else if (kind === "TOOL") {
      const [glyph, tone] = toolStyle(name);
      const args = toolArguments(entry.text);
      const head = `${theme.fg(tone, `${glyph} `)}${theme.bold(theme.fg(tone, name))}`;
      const room = Math.max(1, width - visibleWidth(head) - 2);
      lines.push(`${head}${theme.fg("dim", "(")}${theme.fg("muted", truncateToWidth(args.replace(/\s+/g, " "), room, "…"))}${theme.fg("dim", ")")}`);
    } else if (kind === "RESULT") {
      block(error ? `✗ ${entry.text}` : entry.text, theme.fg(error ? "error" : "dim", "  ⎿  "), "     ", error ? "error" : "toolOutput", 5);
    } else if (kind === "SUMMARY") block(markdown(entry.text, width - 2, theme), theme.fg("thinkingText", "✦ "), "  ", "thinkingText");
    else block(entry.text, theme.fg("customMessageLabel", `◇ ${clean(entry.label)} `), "  ");
  }
  return lines;
}

/** Live trailer under the transcript, like a "Working…" line in an agent CLI. */
export function activityLine(agent: AgentSnapshot, theme: BrowserTheme, now = Date.now()): string | undefined {
  const { state, rawState, waitingFor, reportedAt } = agent.activity;
  const since = reportedAt !== undefined && reportedAt <= now + 5000 ? theme.fg("dim", ` · ${ago(now - reportedAt)}`) : "";
  const detail = rawState && rawState !== state ? theme.fg("muted", ` · ${clean(rawState)}`) : "";
  if (state === "busy") return `${theme.fg("accent", `${spinner(now)} `)}${theme.bold(theme.fg("accent", "Working…"))}${detail}${since}`;
  if (state === "waiting") {
    return `${theme.fg("warning", `${stateGlyph(state, now)} `)}${theme.bold(theme.fg("warning", "Waiting for input"))}` +
      (waitingFor ? theme.fg("warning", ` · ${clean(waitingFor)}`) : "") + since;
  }
  return undefined;
}
