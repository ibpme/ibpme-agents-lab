import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import agentStats from "../extensions/agent-stats/index.ts";

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
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true,
    extensionFactories: [agentStats],
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
  const errors = [];
  await session.bindExtensions({
    mode: "tui", onError: (error) => errors.push(error.error),
    uiContext: {
      theme: { fg: (_color, text) => text },
      setStatus: (key, value) => {
        assert.equal(key, "reasoning-stats");
        writes.push(value);
      },
    },
  });
  assert.deepEqual(writes, [status(10)]);

  session.agent.streamFunction = () => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: assistant(undefined) });
    const partial = assistant(6);
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_end", contentIndex: 0, content: "Done", partial });
    stream.push({ type: "done", reason: "stop", message: assistant(12) });
    return stream;
  };
  await session.prompt("Reply with staged usage.");
  assert.deepEqual(writes, [status(10), status(16), status(22)]);

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
  assert.deepEqual(errors, []);
});
