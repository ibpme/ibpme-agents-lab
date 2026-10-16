// Tone names are a subset of Pi's ThemeColor/ThemeBg so Pi's theme can be passed through unchanged.
export type BrowserTone =
  | "accent" | "border" | "borderAccent" | "borderMuted" | "text" | "muted" | "dim" | "success" | "warning" | "error"
  | "toolTitle" | "toolOutput" | "thinkingText" | "userMessageText" | "customMessageLabel" | "mdHeading" | "mdCode" | "mdLink"
  | "mdLinkUrl" | "mdCodeBlock" | "mdCodeBlockBorder" | "mdQuote" | "mdQuoteBorder" | "mdHr" | "mdListBullet"
  | "syntaxKeyword" | "syntaxFunction" | "syntaxString" | "syntaxNumber" | "syntaxType";
export type BrowserBackground = "selectedBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";
export type HarnessName = "pi" | "claude";

export interface BrowserTheme {
  fg(tone: BrowserTone, text: string): string;
  bold(text: string): string;
  bg?(tone: BrowserBackground, text: string): string;
  italic?(text: string): string;
  underline?(text: string): string;
  /** Brand color per harness; themes without it fall back to syntax tones. */
  harness?(harness: HarnessName, text: string): string;
}

// Pi purple and Claude's orange, stepped down for terminals without truecolor.
const HARNESS_COLORS: Record<HarnessName, { truecolor: string; "256color": string; "16color": string }> = {
  pi: { truecolor: "38;2;167;139;250", "256color": "38;5;141", "16color": "35" },
  claude: { truecolor: "38;2;217;119;87", "256color": "38;5;209", "16color": "33" },
};

export function harnessPainter(mode: "truecolor" | "256color" | "16color"): NonNullable<BrowserTheme["harness"]> {
  return (harness, text) => `\x1b[${HARNESS_COLORS[harness][mode]}m${text}\x1b[39m`;
}
