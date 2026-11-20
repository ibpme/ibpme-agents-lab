import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import agentStats from "../extensions/agent-stats/index.ts";
import { formatReport, readStats } from "../extensions/agent-stats/report.ts";
import { observeTurns } from "../extensions/agent-stats/timing.ts";
import { PAGER_LOOKUP } from "../extensions/shared/document-view.ts";
import { registerExtension } from "./extension-fixture.mjs";

const status = (tokens) => `\u{F135E} ${tokens}`;

function assistant(reasoning) {
  return {
    role: "assistant", api: "openai-responses", provider: "openai", model: "test",
    stopReason: "stop", timestamp: Date.now(), content: [{ type: "text", text: "Done" }],
    usage: {
      input: 20, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 40, reasoning,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("reasoning stats reconcile stream counts with persisted usage and follow branch navigation", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-v2-reasoning-stats-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const agentDir = join(cwd, "agent");
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  let report;
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true,
    extensionFactories: [agentStats, (pi) => {
      pi.events.on(PAGER_LOOKUP, (offer) => offer(async (_ctx, document) => { report = document.content; }));
    }],
  });
  await resourceLoader.reload();

  const manager = SessionManager.inMemory(cwd);
  const root = manager.appendMessage({ role: "user", content: "Start", timestamp: 0 });
  const original = manager.appendMessage(assistant(10));
  const followUp = manager.appendMessage({ role: "user", content: "Continue", timestamp: 1 });
  manager.appendMessage(assistant(undefined));
  const compacted = manager.appendCompaction("Summary", followUp, 100, undefined, false, assistant(50).usage);
  manager.branch(root);
  const unknown = manager.appendMessage(assistant(undefined));
  const zero = manager.appendMessage(assistant(0));
  manager.branch(compacted);

  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai", async () => ({ type: "api_key", key: "offline-test" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, sessionManager: manager, modelRuntime,
    model: modelRuntime.getModels("openai")[0], noTools: "all",
  });
  t.after(() => session.dispose());
  const writes = [];
  const summaries = [];
  const errors = [];
  await session.bindExtensions({
    mode: "tui", onError: (error) => errors.push(error.error),
    uiContext: {
      theme: { fg: (_color, text) => text },
      setStatus: (key, value) => {
        if (key === "reasoning-stats") writes.push(value);
        else if (key === "agent-stats") summaries.push(value);
        else assert.fail(`Unexpected status ${key}`);
      },
    },
  });
  assert.deepEqual(writes, [status(10)]);

  session.agent.streamFunction = () => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: assistant(undefined) });
    const partial = assistant(6);
    stream.push({ type: "text_delta", contentIndex: 0, delta: "Done", partial });
    stream.push({ type: "text_end", contentIndex: 0, content: "Done", partial });
    stream.push({ type: "done", reason: "stop", message: { ...assistant(12), durationMs: 2000 } });
    return stream;
  };
  await session.prompt("Reply with staged usage.");
  assert.deepEqual(writes, [status(10), status(16), status(22)]);
  assert.equal(summaries.at(-1), "10.0 tok/s · 0 tool calls");
  assert.equal(manager.getBranch().some((entry) => entry.type === "custom"), false);
  await session.prompt("/agent-stats");
  assert.match(report, /Output rate over timed responses: 10\.0 tok\/s/);
  assert.match(report, /Turn elapsed sum: .*\(1\/3 timed\)/);

  session.agent.streamFunction = () => {
    const stream = createAssistantMessageEventStream();
    const partial = assistant(5);
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "error", reason: "aborted", error: { ...assistant(undefined), stopReason: "aborted" } });
    return stream;
  };
  await session.prompt("Abort after reporting partial usage.");
  assert.deepEqual(writes.slice(3), [status(27), status(22)]);
  const completed = manager.getLeafId();

  await session.navigateTree(unknown);
  assert.equal(writes.at(-1), undefined);
  await session.navigateTree(zero);
  assert.equal(writes.at(-1), status(0));
  await session.navigateTree(original);
  assert.equal(writes.at(-1), status(10));
  await session.navigateTree(completed);
  assert.equal(writes.at(-1), status(22));
  await session.reload();
  assert.equal(writes.at(-1), status(22));
  await session.prompt("/agent-stats");
  assert.match(report, /Turn elapsed sum: unknown \(0\/4 timed\)/);
  assert.match(report, /Response 3[\s\S]*Response 2\.00 s/);
  assert.deepEqual(errors, []);
});

test("report distinguishes execution, nested elapsed time, and unresolved calls", () => {
  const manager = SessionManager.inMemory();
  const toolCall = (id, name) => ({ type: "toolCall", id, name, arguments: {} });
  manager.appendMessage({
    ...assistant(undefined), durationMs: 1000, stopReason: "toolUse",
    content: [toolCall("a", "codemode"), toolCall("b", "edit"), toolCall("c", "read")],
  });
  manager.appendMessage({
    role: "toolResult", toolCallId: "a", toolName: "codemode", content: [],
    isError: false, timestamp: 1, durationMs: 200,
    nestedCalls: { complete: false, calls: [
      { id: "a.1", name: "grep", status: "ok", durationMs: 120 },
      { id: "a.2", name: "find", status: "unfinished" },
    ] },
  });
  manager.appendMessage({
    role: "toolResult", toolCallId: "b", toolName: "edit", content: [],
    isError: true, timestamp: 2,
  });
  manager.appendMessage({ ...assistant(0), durationMs: 3000 });
  const report = formatReport(readStats(manager.getBranch()));
  assert.match(report, /Output rate over timed responses: 10\.0 tok\/s/);
  assert.match(report, /Top-level calls: 3 · 1 failed · 1 unresolved/);
  assert.match(report, /Tool execution sum: 200 ms \(1\/3 timed\)/);
  assert.match(report, /Nested call elapsed sum: 120 ms \(1\/2 timed\)/);
  assert.match(report, /edit · failed · execution unknown/);
  assert.match(report, /read · unresolved · execution unknown/);
  assert.match(report, /Turn elapsed sum: unknown \(0\/2 timed\)/);
  assert.match(report, /codemode: 1 calls · 0 failed · 0 unresolved · sum 200 ms \(1\/1 timed\) · avg 200 ms · max 200 ms/);
  assert.match(report, /Cache read\/write: 0 \/ 0 · total tokens: 80/);
});

test("live timing counts only the union of top-level tool intervals", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const turns = new Map();
  const host = registerExtension((pi) => observeTurns(pi, (id, timing) => turns.set(id, timing)));
  async function fire(at, event, payload = {}) {
    now = at;
    await host.fire(event, payload);
  }

  await fire(0, "turn_start");
  await fire(10, "before_provider_request");
  await fire(20, "before_provider_request");
  await fire(50, "message_update", { assistantMessageEvent: { type: "thinking_delta" } });
  await fire(70, "message_update", { assistantMessageEvent: { type: "text_delta" } });
  await fire(90, "message_end", { message: { role: "assistant" } });
  await fire(100, "tool_execution_start", { toolCallId: "a" });
  await fire(110, "tool_execution_start", { toolCallId: "b" });
  await fire(120, "tool_execution_start", { toolCallId: "nested", parentToolCallId: "a" });
  await fire(130, "tool_execution_end", { toolCallId: "a" });
  await fire(140, "tool_execution_end", { toolCallId: "b" });
  await fire(150, "tool_execution_end", { toolCallId: "nested", parentToolCallId: "a" });
  await fire(160, "turn_end", { messageEntryId: "assistant" });

  assert.deepEqual(turns.get("assistant"), {
    elapsedMs: 160, ttftMs: 30, generationMs: 40, toolWallMs: 40, attempts: 2,
  });
});
