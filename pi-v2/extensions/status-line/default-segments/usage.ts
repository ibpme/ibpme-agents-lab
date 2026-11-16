import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function usageSegments(ctx: ExtensionContext, theme: Theme) {
  let cached: { sessionId: string; leafId: string | null; cost: number; usage: Usage | undefined } | undefined;

  function snapshot() {
    const sessionId = ctx.sessionManager.getSessionId();
    const leafId = ctx.sessionManager.getLeafId();
    if (cached && cached.sessionId === sessionId && cached.leafId === leafId) return cached;
    let cost = 0;
    let usage: Usage | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        usage = entry.message.usage;
        cost += usage.cost.total;
      }
    }
    cached = { sessionId, leafId, cost, usage };
    return cached;
  }

  return {
    invalidate(): void { cached = undefined; },
    tokens(): string {
      const usage = snapshot().usage;
      const parts: string[] = [];
      if (usage?.input) parts.push(theme.fg("accent", `↑${formatTokens(usage.input)}`));
      if (usage?.output) parts.push(theme.fg("success", `↓${formatTokens(usage.output)}`));
      if (usage?.cacheRead) parts.push(theme.fg("muted", `R${formatTokens(usage.cacheRead)}`));
      if (usage?.cacheWrite) parts.push(theme.fg("muted", `W${formatTokens(usage.cacheWrite)}`));
      return parts.join(" ");
    },
    cost(): string {
      const { cost } = snapshot();
      const subscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
      return cost || subscription ? theme.fg("warning", `$${cost.toFixed(3)}${subscription ? " (sub)" : ""}`) : "";
    },
  };
}
