export interface BrowserTheme {
  fg(tone: "accent" | "border" | "text" | "muted" | "dim" | "success" | "warning" | "error", text: string): string;
  bold(text: string): string;
}
