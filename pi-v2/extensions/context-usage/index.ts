import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type TUI, visibleWidth } from "@earendil-works/pi-tui";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

interface ContextSnapshot {
  percent: number | null | undefined;
  tokens: number | null | undefined;
  capacity: number;
}

const BAR_WIDTH = 10;

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

class ContextUsageEditor extends CustomEditor {
  private readSnapshot: () => ContextSnapshot;
  private readTheme: () => Theme;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    readSnapshot: () => ContextSnapshot,
    readTheme: () => Theme,
  ) {
    super(tui, theme, keybindings, { embedWorkingStatus: true });
    this.readSnapshot = readSnapshot;
    this.readTheme = readTheme;
  }

  refresh(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    const { percent, tokens, capacity } = this.readSnapshot();
    const theme = this.readTheme();
    const color = percent != null && percent > 70 ? "error" : percent != null && percent > 40 ? "warning" : "success";
    const filled = Math.round(Math.max(0, Math.min(100, percent ?? 0)) / 100 * BAR_WIDTH);
    const bar = theme.fg(color, "━".repeat(filled)) + theme.fg("dim", "─".repeat(BAR_WIDTH - filled));
    const percentage = theme.fg(color, percent == null ? "?" : `${percent.toFixed(0)}%`);
    const used = tokens == null ? "?" : formatTokens(tokens);
    const tokenCounts = theme.fg("dim", `${used}/${capacity > 0 ? formatTokens(capacity) : "?"}`);
    const labels = [`${bar} ${percentage} ${tokenCounts}`, `${percentage} ${tokenCounts}`, percentage];

    // Reserve space for Pi's native working indicator and hidden-line cue.
    const label = labels.find((candidate) => visibleWidth(candidate) + 4 + 20 <= width);
    if (!label) return super.renderTopBorder(width, hiddenLineCount);
    const leftWidth = width - visibleWidth(label) - 4;
    return super.renderTopBorder(leftWidth, hiddenLineCount) + " " + label + this.borderColor(" ──");
  }
}

export default function contextUsage(pi: ExtensionAPI): void {
  let snapshot: ContextSnapshot = { percent: undefined, tokens: undefined, capacity: 0 };
  let editor: ContextUsageEditor | undefined;
  let factory: EditorFactory | undefined;

  function refresh(_event: unknown, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || !factory || ctx.ui.getEditorComponent() !== factory) return;
    const usage = ctx.getContextUsage();
    snapshot = {
      percent: usage?.percent,
      tokens: usage?.tokens,
      capacity: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
    };
    editor?.refresh();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if (ctx.ui.getEditorComponent()) {
      ctx.ui.notify("Context border preview requires the default editor; another extension already owns the editor", "warning");
      return;
    }
    factory = (tui, theme, keybindings) => {
      editor = new ContextUsageEditor(tui, theme, keybindings, () => snapshot, () => ctx.ui.theme);
      return editor;
    };
    ctx.ui.setEditorComponent(factory);
    refresh(_event, ctx);
  });
  pi.on("message_end", refresh);
  pi.on("turn_end", refresh);
  pi.on("agent_settled", refresh);
  pi.on("session_tree", refresh);
  pi.on("session_compact", refresh);
  pi.on("model_select", refresh);
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui" && factory && ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(undefined);
    factory = undefined;
    editor = undefined;
    snapshot = { percent: undefined, tokens: undefined, capacity: 0 };
  });
}
