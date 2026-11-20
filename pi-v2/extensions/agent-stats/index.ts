import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, MessageEndEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "reasoning-stats";

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function reportedReasoning(message: AssistantMessage): number | undefined {
  const tokens = message.usage?.reasoning;
  return tokens !== undefined && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : undefined;
}

export default function agentStats(pi: ExtensionAPI): void {
  let branchTotal: number | undefined;
  let displayedTotal: number | undefined;

  function publish(ctx: ExtensionContext, total: number | undefined): void {
    if (total === displayedTotal) return;
    displayedTotal = total;
    ctx.ui.setStatus(STATUS_ID, total === undefined
      ? undefined
      : ctx.ui.theme.fg("accent", `\u{F135E} ${formatTokens(total)}`));
  }

  function refreshBranch(_event: unknown, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    branchTotal = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      const tokens = reportedReasoning(entry.message);
      if (tokens !== undefined) branchTotal = (branchTotal ?? 0) + tokens;
    }
    publish(ctx, branchTotal);
  }

  function preview({ message }: MessageUpdateEvent | MessageEndEvent, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || message.role !== "assistant") return;
    const tokens = reportedReasoning(message);
    publish(ctx, tokens === undefined ? branchTotal : (branchTotal ?? 0) + tokens);
  }

  pi.on("session_start", refreshBranch);
  pi.on("session_tree", refreshBranch);
  pi.on("message_update", preview);
  // Pi saves the final message after message_end, then turn_end can read the saved usage.
  pi.on("message_end", preview);
  pi.on("turn_end", refreshBranch);
  pi.on("agent_settled", refreshBranch);
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    branchTotal = undefined;
    publish(ctx, undefined);
  });
}
