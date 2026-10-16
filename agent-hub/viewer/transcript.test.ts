import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSnapshot } from "./reader.ts";
import { sessionSnapshot } from "./session.ts";
import { activityLine, compactCount, metricsLines, transcriptLines, usageText } from "./transcript.ts";

const theme = { fg: (_tone: string, s: string) => s, bold: (s: string) => s };

test("token counts compact into K, M, and B units", () => {
  assert.deepEqual([0, 999, 1000, 1234, 12_034, 999_499, 999_500, 3_400_000, 120_000_000, 2_500_000_000].map(compactCount),
    ["0", "999", "1K", "1.2K", "12K", "999K", "1M", "3.4M", "120M", "2.5B"]);
  assert.equal(usageText("input=12034 output=5 cache-read=unavailable · Recorded cost: $0.010000", theme),
    "input=12K output=5 cache-read=unavailable · Recorded cost: $0.010000");
});

test("structured metrics show compact chips, cost, activity counts and cache hit ratio", () => {
  const snapshot = sessionSnapshot("pi", [
    { type: "message", id: "u", parentId: null, message: { role: "user", content: "go" } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }], usage: { input: 12_034, output: 820, cacheRead: 36_102, cacheWrite: 0, cost: { total: 0.0412 } } } },
    { type: "message", id: "r", parentId: "a", message: { role: "toolResult", toolCallId: "t", toolName: "bash", isError: true, content: "nope" } },
  ]);
  const text = metricsLines(snapshot, 200, theme).join("\n");
  for (const part of ["↑ 12K in", "↓ 820 out", "⟳ 36K cache read", "✎ 0 cache write", "$0.0412", "❯ 1 prompts", "● 1 replies", "▸ 1 tools", "✗ 1 failed", "75%"]) assert.ok(text.includes(part), part);
  for (const width of [10, 40]) assert.ok(metricsLines(snapshot, width, theme).every(line => visibleWidth(line) <= width));
});

test("assistant markdown renders without raw markup and fits the width", () => {
  const lines = transcriptLines([{ label: "ASSISTANT", text: "## Plan\n\nUse **bold** and `code`:\n\n- one\n- two\n\n```ts\nconst a = 1;\n```" }], 40, theme);
  const text = lines.join("\n");
  assert.ok(text.startsWith("● ## Plan") || text.startsWith("● Plan"), text);
  assert.ok(text.includes("Use bold and code:") && text.includes("- one") && text.includes("const a = 1;"));
  assert.ok(!text.includes("**") && !text.includes("```") && text.includes("╌╌ ts"));
  assert.ok(lines.every(line => visibleWidth(line) <= 40));
});

test("busy and waiting agents get a live activity trailer", () => {
  const now = Date.now();
  const agent = (activity: AgentSnapshot["activity"]) => ({ activity } as AgentSnapshot);
  assert.match(activityLine(agent({ state: "busy", source: "pi-registry", rawState: "tool_execution", reportedAt: now - 12_000 }), theme, now)!, /Working… · tool_execution · 12s/);
  assert.match(activityLine(agent({ state: "waiting", source: "claude-hook", waitingFor: "permission" }), theme, now)!, /Waiting for input · permission/);
  assert.equal(activityLine(agent({ state: "idle", source: "pi-registry" }), theme, now), undefined);
});
