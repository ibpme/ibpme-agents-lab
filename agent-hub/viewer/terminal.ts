import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { createBrowser } from "./browser.ts";
import { readRegistry, registryDirectory } from "./reader.ts";
import { harnessPainter, type BrowserBackground, type BrowserTheme, type BrowserTone } from "./theme.ts";
import { performPaneAction, type Origin } from "./tmux-actions.ts";

// Resolved from Pi 1.3's built-in dark theme; no coding-agent dependency at runtime.
const palette: Record<BrowserTone, readonly [string, number, number]> = {
  accent: ["a798d7", 140, 35],
  border: ["5fa8cc", 74, 36],
  borderAccent: ["a08ed5", 140, 35],
  borderMuted: ["768186", 102, 90],
  text: ["dee0e1", 254, 39],
  muted: ["9da5a9", 145, 37],
  dim: ["7e888e", 102, 90],
  success: ["68b78d", 72, 32],
  warning: ["cd9a22", 172, 33],
  error: ["ea7f81", 174, 31],
  toolTitle: ["dee0e1", 254, 39],
  toolOutput: ["9da5a9", 145, 37],
  thinkingText: ["96a0a4", 109, 90],
  userMessageText: ["dee0e1", 254, 39],
  customMessageLabel: ["a798d7", 140, 35],
  mdHeading: ["cd9a22", 172, 33],
  mdCode: ["a798d7", 140, 35],
  mdLink: ["69add0", 74, 34],
  mdLinkUrl: ["9da5a9", 145, 37],
  mdCodeBlock: ["68b78d", 72, 32],
  mdCodeBlockBorder: ["9da5a9", 145, 37],
  mdQuote: ["9da5a9", 145, 37],
  mdQuoteBorder: ["9da5a9", 145, 37],
  mdHr: ["9da5a9", 145, 37],
  mdListBullet: ["a798d7", 140, 35],
  syntaxKeyword: ["69add0", 74, 34],
  syntaxFunction: ["cd9a22", 172, 33],
  syntaxString: ["de8d5a", 173, 33],
  syntaxNumber: ["68b78d", 72, 32],
  syntaxType: ["a798d7", 140, 35],
};
const backgrounds: Record<BrowserBackground, readonly [string, number]> = {
  selectedBg: ["213b49", 23],
  toolPendingBg: ["34383a", 237],
  toolSuccessBg: ["254131", 23],
  toolErrorBg: ["5b282a", 52],
};
const rgb = (hex: string): string => hex.match(/../g)!.map(part => parseInt(part, 16)).join(";");

export function ansiTheme(env: NodeJS.ProcessEnv = process.env): BrowserTheme {
  const plain = env.NO_COLOR !== undefined;
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? "");
  const rich = truecolor || /256/.test(env.TERM ?? "");
  const sgr = (on: string, off: string) => (text: string) => plain ? text : `\x1b[${on}m${text}\x1b[${off}m`;
  return {
    fg: (tone, text) => {
      const [hex, indexed, ansi] = palette[tone];
      return sgr(truecolor ? `38;2;${rgb(hex)}` : rich ? `38;5;${indexed}` : String(ansi), "39")(text);
    },
    bold: sgr("1", "22"),
    italic: sgr("3", "23"),
    underline: sgr("4", "24"),
    harness: plain ? (_harness, text) => text : harnessPainter(truecolor ? "truecolor" : rich ? "256color" : "16color"),
    ...(rich && !plain ? { bg: (tone: BrowserBackground, text: string) => `\x1b[${truecolor ? `48;2;${rgb(backgrounds[tone][0])}` : `48;5;${backgrounds[tone][1]}`}m${text}\x1b[49m` } : {}),
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
