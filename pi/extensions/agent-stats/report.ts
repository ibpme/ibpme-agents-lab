import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { TurnTiming } from "./timing.ts";

interface Response {
  message: AssistantMessage;
  tools: Map<string, { name: string; result?: ToolResultMessage }>;
  timing?: TurnTiming;
}

export function readStats(branch: readonly SessionEntry[], timings?: ReadonlyMap<string, TurnTiming>) {
  const responses: Response[] = [];
  let current: Response | undefined;
  let reasoning: number | undefined;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      current = { message, tools: new Map(), timing: timings?.get(entry.id) };
      responses.push(current);
      const tokens = reportedReasoning(message);
      if (tokens !== undefined) reasoning = (reasoning ?? 0) + tokens;
      for (const part of message.content) {
        if (part.type === "toolCall") current.tools.set(part.id, { name: part.name });
      }
    } else if (message.role === "user") {
      current = undefined;
    } else if (message.role === "toolResult" && current) {
      current.tools.set(message.toolCallId, {
        name: current.tools.get(message.toolCallId)?.name ?? message.toolName,
        result: message,
      });
    }
  }
  return { responses, reasoning };
}

export function reportedReasoning(message: AssistantMessage): number | undefined {
  const tokens = message.usage?.reasoning;
  return tokens !== undefined && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : undefined;
}

export function outputRate(tokens: number, ms: number | undefined): string | undefined {
  if (ms === undefined || ms <= 0 || !Number.isFinite(ms) || !Number.isFinite(tokens) || tokens < 0) return undefined;
  return `${(tokens * 1000 / ms).toFixed(1)} tok/s`;
}

function duration(ms: number | undefined): string {
  if (!isDuration(ms)) return "unknown";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function isDuration(ms: number | undefined): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0;
}

function timingTotal(values: (number | undefined)[]): string {
  const timed = values.filter(isDuration);
  const count = `${timed.length}/${values.length} timed`;
  return timed.length ? `${duration(timed.reduce((sum, value) => sum + value, 0))} (${count})` : `unknown (${count})`;
}

function byTool<T extends { name: string }>(
  calls: T[],
  metrics: (call: T) => { failed: boolean; unresolved: boolean; ms?: number },
): string[] {
  const groups = new Map<string, T[]>();
  for (const call of calls) {
    const group = groups.get(call.name);
    if (group) group.push(call);
    else groups.set(call.name, [call]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
    const rows = group.map(metrics);
    const times = rows.map(({ ms }) => ms);
    const measured = times.filter(isDuration);
    const average = measured.length ? Math.round(measured.reduce((sum, ms) => sum + ms, 0) / measured.length) : undefined;
    const maximum = measured.reduce<number | undefined>((max, ms) => Math.max(max ?? 0, ms), undefined);
    return `  ${name}: ${rows.length} calls · ${rows.filter(({ failed }) => failed).length} failed · ${rows.filter(({ unresolved }) => unresolved).length} unresolved · sum ${timingTotal(times)} · avg ${duration(average)} · max ${duration(maximum)}`;
  });
}

export function formatReport({ responses, reasoning }: ReturnType<typeof readStats>): string {
  if (!responses.length) return "No assistant responses on this branch.";

  const tools = responses.flatMap((response) => [...response.tools.values()]);
  const nested = tools.flatMap(({ result }) => result?.nestedCalls?.calls ?? []);
  const incomplete = tools.filter(({ result }) => result?.nestedCalls?.complete === false).length;
  let timedTokens = 0;
  let timedMs = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let cost = 0;
  let generationMs = 0;
  let generatedTokens = 0;
  const ttft: number[] = [];
  for (const { message, timing } of responses) {
    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    cacheWrite += message.usage.cacheWrite;
    totalTokens += message.usage.totalTokens;
    cost += message.usage.cost.total;
    const ms = message.durationMs;
    if (ms !== undefined && outputRate(message.usage.output, ms) !== undefined) {
      timedTokens += message.usage.output;
      timedMs += ms;
    }
    if (timing?.ttftMs !== undefined) ttft.push(timing.ttftMs);
    if (timing?.generationMs && timing.generationMs > 0) {
      generationMs += timing.generationMs;
      generatedTokens += message.usage.output;
    }
  }

  const lines = [
    `Responses: ${responses.length}`,
    `Tokens: ${input} input · ${output} output · ${reasoning ?? "unknown"} reasoning (included in output)`,
    `Cache read/write: ${cacheRead} / ${cacheWrite} · total tokens: ${totalTokens}`,
    `Model cost: $${cost.toFixed(4)}`,
    `Output rate over timed responses: ${outputRate(timedTokens, timedMs) ?? "unknown"}`,
    `Response time sum: ${timingTotal(responses.map(({ message }) => message.durationMs))}`,
    `Turn elapsed sum: ${timingTotal(responses.map(({ timing }) => timing?.elapsedMs))}`,
    `Observed tool wall time: ${timingTotal(responses.map(({ timing }) => timing?.toolWallMs))} · overlaps counted once`,
    `Observed generation time: ${timingTotal(responses.map(({ timing }) => timing?.generationMs))} · ${outputRate(generatedTokens, generationMs) ?? "rate unknown"}`,
    `TTFT avg/min/max: ${ttft.length ? [
      Math.round(ttft.reduce((sum, ms) => sum + ms, 0) / ttft.length),
      ttft.reduce((min, ms) => Math.min(min, ms), Infinity),
      ttft.reduce((max, ms) => Math.max(max, ms), 0),
    ].map(duration).join(" / ") : "unknown"} (${ttft.length}/${responses.length} timed)`,
    `Top-level calls: ${tools.length} · ${tools.filter(({ result }) => result?.isError).length} failed · ${tools.filter(({ result }) => !result).length} unresolved`,
    `Tool execution sum: ${timingTotal(tools.map(({ result }) => result?.durationMs))} · parallel calls can overlap`,
    `Recorded nested calls: ${nested.length} · ${incomplete} incomplete parent records`,
    `Nested call elapsed sum: ${timingTotal(nested.map((call) => call.durationMs))} · may overlap parent calls`,
  ];
  if (tools.length) lines.push("", "Top-level tools by name (execution time)", ...byTool(tools, ({ result }) => ({
    failed: result?.isError === true, unresolved: result === undefined, ms: result?.durationMs,
  })));
  if (nested.length) lines.push("", "Nested tools by name (elapsed time)", ...byTool(nested, (call) => ({
    failed: call.status === "error", unresolved: call.status === "unfinished", ms: call.durationMs,
  })));

  responses.forEach(({ message, tools, timing }, index) => {
    const { usage } = message;
    lines.push("", `Response ${index + 1} · ${message.provider}/${message.responseModel ?? message.model} · ${message.stopReason}`);
    lines.push(`  ${usage.input} input · ${usage.output} output · ${reportedReasoning(message) ?? "unknown"} reasoning · ${usage.cacheRead}/${usage.cacheWrite} cache read/write · ${usage.totalTokens} total · $${usage.cost.total.toFixed(4)}`);
    lines.push(`  Response ${duration(message.durationMs)} · turn ${duration(timing?.elapsedMs)} · ${outputRate(usage.output, message.durationMs) ?? "rate unknown"}`);
    if (timing) {
      lines.push(`  TTFT ${duration(timing.ttftMs)} · generation ${duration(timing.generationMs)} · ${outputRate(usage.output, timing.generationMs) ?? "rate unknown"} · tool wall ${duration(timing.toolWallMs)} · ${timing.attempts} provider requests observed`);
    }
    for (const { name, result } of tools.values()) {
      const outcome = result ? (result.isError ? "failed" : "ok") : "unresolved";
      lines.push(`  ${name} · ${outcome} · execution ${duration(result?.durationMs)}`);
      for (const call of result?.nestedCalls?.calls ?? []) {
        lines.push(`    ${call.name} · ${call.status} · elapsed ${duration(call.durationMs)}`);
      }
    }
  });

  return lines.join("\n");
}
