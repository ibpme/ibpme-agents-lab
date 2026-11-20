import type { ExtensionAPI, ExtensionContext, MessageEndEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { showDocument, type OpenDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";
import { formatReport, outputRate, readStats, reportedReasoning } from "./report.ts";
import { observeTurns, type TurnTiming } from "./timing.ts";

const STATUS_ID = "reasoning-stats";

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

const openLocal: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) =>
    documentViewport(tui, theme, done, new Text(document.content, 0, 0), document.title, () => "↑↓ scroll · Esc/q close"));
};

export default function agentStats(pi: ExtensionAPI): void {
  let branchTotal: number | undefined;
  let displayedTotal: number | undefined;
  let displayedSummary: string | undefined;
  const timings = new Map<string, TurnTiming>();
  observeTurns(pi, (id, timing) => timings.set(id, timing));

  function publish(ctx: ExtensionContext, total: number | undefined): void {
    if (total === displayedTotal) return;
    displayedTotal = total;
    ctx.ui.setStatus(STATUS_ID, total === undefined
      ? undefined
      : ctx.ui.theme.fg("accent", `\u{F135E} ${formatTokens(total)}`));
  }

  function refreshBranch(_event: unknown, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    const { responses, reasoning } = readStats(ctx.sessionManager.getBranch());
    branchTotal = reasoning;
    publish(ctx, branchTotal);
    const latest = responses.at(-1)?.message;
    const count = responses.reduce((total, response) => total + response.tools.size, 0);
    const rate = latest && outputRate(latest.usage.output, latest.durationMs);
    const summary = latest ? [rate, `${count} tool calls`].filter(Boolean).join(" · ") : undefined;
    if (summary !== displayedSummary) {
      displayedSummary = summary;
      ctx.ui.setStatus("agent-stats", summary);
    }
  }

  function preview({ message }: MessageUpdateEvent | MessageEndEvent, ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || message.role !== "assistant") return;
    const tokens = reportedReasoning(message);
    publish(ctx, tokens === undefined ? branchTotal : (branchTotal ?? 0) + tokens);
  }

  pi.on("session_start", (event, ctx) => {
    timings.clear();
    refreshBranch(event, ctx);
  });
  pi.on("session_tree", refreshBranch);
  pi.on("message_update", preview);
  // Pi saves the final message after message_end, then turn_end can read the saved usage.
  pi.on("message_end", preview);
  pi.on("turn_end", refreshBranch);
  pi.on("agent_settled", refreshBranch);
  pi.on("session_shutdown", (_event, ctx) => {
    timings.clear();
    if (ctx.mode !== "tui") return;
    branchTotal = undefined;
    publish(ctx, undefined);
    displayedSummary = undefined;
    ctx.ui.setStatus("agent-stats", undefined);
  });

  pi.registerCommand("agent-stats", {
    description: "Show model and tool timings for the selected branch",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const content = formatReport(readStats(ctx.sessionManager.getBranch(), timings));
      await showDocument(pi.events, ctx, { title: "Agent Stats", format: "text", content }, openLocal);
    },
  });
}
