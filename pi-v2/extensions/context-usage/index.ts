import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "context-usage";
const BAR_WIDTH = 10;

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export default function contextUsage(pi: ExtensionAPI): void {
  function publish(_event: unknown, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    const usage = ctx.getContextUsage();
    const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const percent = usage?.percent;
    const color = percent != null && percent > 70 ? "error" : percent != null && percent > 40 ? "warning" : "success";
    const filled = Math.round(Math.max(0, Math.min(100, percent ?? 0)) / 100 * BAR_WIDTH);
    const bar = ctx.ui.theme.fg(color, "━".repeat(filled)) + ctx.ui.theme.fg("dim", "─".repeat(BAR_WIDTH - filled));
    const label = percent == null ? "?" : `${percent.toFixed(0)}%`;
    const used = usage?.tokens == null ? "?" : formatTokens(usage.tokens);
    const capacity = window > 0 ? formatTokens(window) : "?";
    ctx.ui.setStatus(STATUS_KEY, `${bar} ${ctx.ui.theme.fg(color, label)}${ctx.ui.theme.fg("dim", ` ${used}/${capacity}`)}`);
  }

  pi.on("session_start", publish);
  pi.on("message_end", publish);
  pi.on("turn_end", publish);
  pi.on("agent_settled", publish);
  pi.on("session_tree", publish);
  pi.on("session_compact", publish);
  pi.on("model_select", publish);
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
