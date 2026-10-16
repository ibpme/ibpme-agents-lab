import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { createBrowser } from "./browser.ts";
import { readRegistry, registryDirectory } from "./reader.ts";
import { harnessPainter, type BrowserBackground, type BrowserTheme, type BrowserTone } from "./theme.ts";
import { performPaneAction, type Origin } from "./tmux-actions.ts";

// The 16-color palette follows the user's terminal colors; the row highlight and harness brand colors use 256/truecolor when available.
const palette: Record<BrowserTone, number> = {
  accent: 96, border: 90, borderAccent: 36, borderMuted: 90, text: 39, muted: 37, dim: 90, success: 92, warning: 93, error: 91,
  toolTitle: 94, toolOutput: 37, thinkingText: 35, userMessageText: 97, customMessageLabel: 95, mdHeading: 95, mdCode: 36, mdLink: 34,
  mdLinkUrl: 90, mdCodeBlock: 37, mdCodeBlockBorder: 90, mdQuote: 37, mdQuoteBorder: 35, mdHr: 90, mdListBullet: 96,
  syntaxKeyword: 95, syntaxFunction: 94, syntaxString: 32, syntaxNumber: 33, syntaxType: 36,
};
const backgrounds: Record<BrowserBackground, string> = { selectedBg: "48;5;236", toolPendingBg: "48;5;236", toolSuccessBg: "48;5;22", toolErrorBg: "48;5;52" };

export function ansiTheme(env: NodeJS.ProcessEnv = process.env): BrowserTheme {
  const plain = env.NO_COLOR !== undefined;
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? "");
  const rich = truecolor || /256/.test(env.TERM ?? "");
  const sgr = (on: string, off: string) => (text: string) => plain ? text : `\x1b[${on}m${text}\x1b[${off}m`;
  return {
    fg: (tone, text) => sgr(String(palette[tone] ?? 39), "39")(text),
    bold: sgr("1", "22"),
    italic: sgr("3", "23"),
    underline: sgr("4", "24"),
    harness: plain ? (_harness, text) => text : harnessPainter(truecolor ? "truecolor" : rich ? "256color" : "16color"),
    ...(rich && !plain ? { bg: (tone: BrowserBackground, text: string) => `\x1b[${backgrounds[tone]}m${text}\x1b[49m` } : {}),
  };
}

export async function runBrowser(origin?: Origin, directory = registryDirectory()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("An interactive terminal is required.");
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  const theme = ansiTheme();
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const browser = createBrowser({ readRegistry: () => readRegistry(directory), origin,
    performPaneAction: async (context, agent, action) => {
      await performPaneAction(context, agent, action);
      if (action === "attach") finish();
    },
  }, terminal, theme, () => tui.requestRender(), finish);
  let timer: ReturnType<typeof setInterval> | undefined;
  const signals = ["SIGTERM", "SIGHUP", "SIGINT"] as const;
  for (const signal of signals) process.on(signal, finish);
  try {
    tui.addChild(browser);
    tui.setFocus(browser);
    tui.start();
    void browser.refresh();
    timer = setInterval(() => { void browser.refresh(); }, 2000);
    await finished;
  } finally {
    if (timer) clearInterval(timer);
    browser.dispose();
    for (const signal of signals) process.off(signal, finish);
    await terminal.drainInput();
    tui.stop();
  }
}
