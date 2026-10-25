import xterm from "@xterm/headless";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import {
  CURSOR_MARKER, decodeKittyPrintable, isKeyRelease, matchesKey, parseKey,
  renderFakeCursor, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI,
} from "@earendil-works/pi-tui";

export type AuthOutcome = "success" | "failed" | "cancelled" | "timeout";
type PtyProcess = Pick<IPty, "onData" | "onExit" | "write" | "resize" | "kill" | "pause" | "resume">;
export type SpawnAuthTerminal = (args: string[], cols: number, rows: number) => PtyProcess;

const spawnAuthTerminal: SpawnAuthTerminal = (args, cols, rows) => pty.spawn("ssh", args, {
  name: "xterm", cols, rows,
  env: { ...process.env, SSH_ASKPASS_REQUIRE: "never" },
});

/** Only translate keys used by line-oriented SSH prompts, never forward outer-terminal protocols. */
export function authenticationInput(data: string): string {
  if (isKeyRelease(data)) return "";
  if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) {
    // Paste must not submit a password/host-key answer or inject terminal control keys.
    return data.slice(6, -6).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  }
  const key = parseKey(data);
  if (key === "enter" || key === "shift+enter") return "\r";
  if (key === "backspace") return "\x7f";
  if (key === "tab") return "\t";
  if (key === "space") return " ";
  if (key?.startsWith("ctrl+") && /^ctrl\+[a-z]$/.test(key)) {
    return String.fromCharCode(key.charCodeAt(5) - 96);
  }
  if (key && key.length > 1 && !/^shift\+.$/u.test(key)) return "";
  const kittyCode = data.match(/^\x1b\[(\d+)(?=[:;u])/);
  if (kittyCode && Number(kittyCode[1]) >= 57344 && Number(kittyCode[1]) <= 63743) return "";
  const printable = decodeKittyPrintable(data);
  if (printable !== undefined) return printable;
  // xterm modifyOtherKeys text events are distinct from Kitty CSI-u events.
  const modified = data.match(/^\x1b\[27;([12]);(\d+)~$/);
  if (modified) {
    const code = Number(modified[2]);
    if (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
  }
  return data.replace(/[\x00-\x1f\x7f-\x9f]/g, "") === data ? data : "";
}

/** An authentication-only terminal: no shell, transcript entries, or keystroke logging. */
export class SshAuthTerminal implements Component, Focusable {
  focused = false;
  private readonly screen = new xterm.Terminal({
    cols: 80, rows: 12, scrollback: 300, allowProposedApi: true, logLevel: "off",
  });
  private child?: PtyProcess;
  private exited = false;
  private disposed = false;
  private finished = false;
  private failure = false;
  private scroll = 0;
  private readonly subscriptions: { dispose(): void }[] = [];
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.finish("cancelled");

  constructor(
    private readonly tui: Pick<TUI, "terminal" | "requestRender">,
    private readonly args: string[],
    private readonly done: (outcome: AuthOutcome) => void,
    timeoutMs: number,
    private readonly signal?: AbortSignal,
    private readonly spawnTerminal: SpawnAuthTerminal = spawnAuthTerminal,
  ) {
    this.timer = setTimeout(() => this.finish("timeout"), timeoutMs);
    this.signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) queueMicrotask(this.abort);
  }

  private start(cols: number, rows: number): void {
    try {
      this.child = this.spawnTerminal(this.args, cols, rows);
      this.subscriptions.push(this.child.onData((data) => {
        if (this.disposed) return;
        this.child?.pause();
        this.screen.write(data, () => {
          if (this.disposed) return;
          this.child?.resume();
          this.tui.requestRender();
        });
      }));
      this.subscriptions.push(this.child.onExit(({ exitCode }) => {
        this.exited = true;
        if (this.disposed) return;
        if (exitCode === 0) this.finish("success");
        else {
          this.failure = true;
          clearTimeout(this.timer);
          this.tui.requestRender();
        }
      }));
      // Respond to terminal queries inside the PTY, never through Pi's outer terminal.
      this.subscriptions.push(this.screen.onData((data) => {
        if (!this.disposed && !this.exited) this.child?.write(data);
      }));
    } catch {
      this.failure = true;
      clearTimeout(this.timer);
    }
  }

  handleInput(data: string): void {
    if (this.disposed || isKeyRelease(data)) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.finish("cancelled");
      return;
    }
    if (this.failure) {
      if (matchesKey(data, "enter")) this.finish("failed");
      return;
    }
    if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
      const direction = matchesKey(data, "pageUp") ? 1 : -1;
      this.scroll = Math.max(0, Math.min(this.screen.buffer.active.baseY, this.scroll + direction * this.screen.rows));
      this.tui.requestRender();
      return;
    }
    if (!this.child || this.exited) return;
    this.scroll = 0;
    const input = authenticationInput(data);
    if (input) this.child.write(input);
  }

  render(width: number): string[] {
    if (this.disposed) return [];
    const rows = Math.min(20, Math.floor(this.tui.terminal.rows * 0.8) - 3);
    if (width < 12 || rows < 1) return [truncateToWidth("SSH: enlarge terminal; Esc cancels", width)];
    const cols = width - 4;
    if (cols !== this.screen.cols || rows !== this.screen.rows) {
      this.screen.resize(cols, rows);
      this.child?.resize(cols, rows);
    }
    if (!this.child && !this.failure) this.start(cols, rows);
    const buffer = this.screen.buffer.active;
    this.scroll = Math.min(this.scroll, buffer.baseY);
    const top = buffer.baseY - this.scroll;
    const lines = [truncateToWidth("┌ SSH authentication " + "─".repeat(width), width - 1) + "┐"];
    for (let y = 0; y < rows; y++) {
      const line = buffer.getLine(top + y);
      let text = "";
      for (let x = 0; x < cols; x++) {
        const cell = line?.getCell(x);
        if (cell?.getWidth() === 0) continue;
        const size = cell?.getWidth() ?? 1;
        const chars = cell?.isInvisible() ? " ".repeat(size) : (cell?.getChars() || " ");
        // Render cells, not escape sequences, links, title changes, or bidi instructions.
        const safe = chars.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "�");
        const cursor = this.focused && !this.scroll && y === buffer.cursorY && x === Math.min(buffer.cursorX, cols - 1);
        text += cursor ? CURSOR_MARKER + renderFakeCursor(safe) : safe;
      }
      const bounded = truncateToWidth(text, cols, "");
      lines.push("│ " + bounded + " ".repeat(Math.max(0, cols - visibleWidth(bounded))) + " │");
    }
    const footer = this.failure ? "SSH failed. Enter closes; Esc cancels" : "Esc/Ctrl-C cancel · PgUp/PgDn scroll";
    lines.push(truncateToWidth("│ " + footer, width - 1).padEnd(width - 1) + "│");
    lines.push("└" + "─".repeat(width - 2) + "┘");
    return lines;
  }

  invalidate(): void {}

  private finish(outcome: AuthOutcome): void {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.done(outcome);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.abort);
    for (const subscription of this.subscriptions) subscription.dispose();
    if (this.child && !this.exited) {
      try { this.child.kill("SIGKILL"); } catch { /* Already exited. */ }
    }
    this.screen.dispose();
    if (!this.finished) {
      this.finished = true;
      this.done("cancelled");
    }
  }
}
