import type { Theme } from "@earendil-works/pi-coding-agent";

export function hubTitle(theme: Theme, title: string, detail = ""): string {
  return theme.fg("accent", "◈ ") + theme.fg("toolTitle", title)
    + (detail ? theme.fg("dim", " · ") + theme.fg("accent", detail) : "");
}

export function colorJson(text: string, theme: Theme): string {
  const tokens = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    result += theme.fg("dim", text.slice(offset, match.index));
    const value = match[0];
    const key = value.startsWith('"') && /^\s*:/.test(text.slice(match.index + value.length));
    const tone = key ? "accent" : value.startsWith('"') ? "success" : value === "null" ? "muted" : "warning";
    result += theme.fg(tone, value);
    offset = match.index + value.length;
  }
  return result + theme.fg("dim", text.slice(offset));
}
