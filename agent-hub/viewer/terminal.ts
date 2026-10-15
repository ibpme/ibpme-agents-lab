import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { createBrowser } from "./browser.ts";
import { readRegistry, registryDirectory } from "./reader.ts";
import { performPaneAction, type Origin } from "./tmux-actions.ts";

export async function runBrowser(origin?: Origin, directory = registryDirectory()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("An interactive terminal is required.");
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  const palette: Record<string, number> = { accent: 36, border: 90, muted: 90, dim: 90, success: 32, warning: 33, error: 31 };
  const theme = {
    fg: (tone: string, text: string) => process.env.NO_COLOR !== undefined ? text : `\x1b[${palette[tone] ?? 39}m${text}\x1b[39m`,
    bold: (text: string) => process.env.NO_COLOR !== undefined ? text : `\x1b[1m${text}\x1b[22m`,
  };
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
