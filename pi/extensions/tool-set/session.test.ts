import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  createAgentSession, createCodemodeExtension, createToolSearchExtension,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, initTheme,
} from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import stylishTools from "../stylish-tools/index.ts";
import ssh from "../ssh/index.ts";

test("real Pi 1.3 session preserves restored declarations and gates codemode's deferred calls", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "permission-session-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  initTheme("dark", false);
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [extension, stylishTools, ssh, createCodemodeExtension(), createToolSearchExtension()],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(dir);
  manager.appendMessage({
    role: "system", content: "Restored session", timestamp: 0,
    toolsAdded: ["read", "write", "edit", "bash", "grep"].map((name) => ({ name, description: name, parameters: {} })),
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai", async () => ({ type: "api_key", key: "test-not-used-for-network" }));
  const runtime = await ModelRuntime.create({
    credentials, modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: manager,
    settingsManager, modelRuntime: runtime, model: runtime.getModels("openai")[0],
  });
  t.after(async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  const errors: string[] = [];
  await session.bindExtensions({ onError: (error) => errors.push(error.error) });
  assert.deepEqual(errors, []);
  const active = session.getActiveToolNames();
  const initialPrompt = session.systemPrompt;
  const declarations = session.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  for (const name of ["read", "write", "edit", "bash", "grep", "codemode", "tool_search", "change_mode"]) {
    assert.ok(active.includes(name), name);
  }
  assert.ok(!active.includes("ls"));
  assert.ok(!active.includes("read_remote"));
  for (const name of ["ls", "find", "read_remote", "write_remote"]) {
    assert.ok(session.getCallableToolNames().includes(name), name);
  }
  assert.ok(!session.getCallableToolNames().includes("change_mode"));

  function response(content: AssistantMessage["content"], stopReason: "stop" | "toolUse" = "stop") {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: stopReason, message: {
      role: "assistant", api: "openai-responses", provider: "openai", model: "test", stopReason, timestamp: Date.now(), content,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } });
    return stream;
  }
  // Replace only the provider call; lifecycle, projection, persistence and tools are real Pi.
  session.agent.streamFunction = () => response([{ type: "text", text: "Acknowledged" }]);
  const notices = () => session.messages.filter((message) => message.role === "custom");
  await session.prompt("First prompt with defaults");
  assert.equal(notices().length, 0, "fresh YOLO/disconnected sessions need no notices");
  await session.prompt("/safe");
  assert.equal(notices().length, 0, "idle commands must not append notices");
  await session.prompt("Inspect permissions");
  assert.equal(notices().length, 1, "only the non-default SAFE state needs a notice");
  assert.ok(notices().some((message) => String(message.content).includes("Execution policy: SAFE")));
  const announced = notices().length;
  await session.prompt("/yolo");
  await session.prompt("/safe");
  await session.prompt("Still inspecting");
  assert.equal(notices().length, announced, "idle round trips must not add notices");
  assert.equal(session.systemPrompt, initialPrompt);
  assert.deepEqual(session.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })), declarations);
  assert.deepEqual(session.getActiveToolNames(), active);
  async function runScript(id: string, code: string) {
    manager.appendMessage({
      role: "assistant", api: "openai-responses", provider: "openai", model: "test", stopReason: "toolUse", timestamp: 0,
      content: [{ type: "toolCall", id, name: "codemode", arguments: { code } }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    session.refreshContext();
    return session.agent.state.tools.find((tool) => tool.name === "codemode")!.execute(id, { code });
  }
  const blockedPath = join(dir, "blocked.txt");
  const blocked = await runScript("blocked-script",
    `try { await tools.write({path: ${JSON.stringify(blockedPath)}, content: "blocked"}); } catch (error) { return error.message; }`);
  assert.match(JSON.stringify(blocked.content), /Blocked by SAFE/);
  await assert.rejects(readFile(blockedPath), { code: "ENOENT" });
  const listed = await runScript("read-only-script", `return await tools.ls({path: ${JSON.stringify(dir)}});`);
  assert.match(JSON.stringify(listed.content), /Script completed/);
  assert.deepEqual(session.getActiveToolNames(), active);

  await session.prompt("/yolo");
  assert.equal(session.systemPrompt, initialPrompt);
  assert.deepEqual(session.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })), declarations);
  const allowed = await runScript("allowed-script", `return await tools.write({path: ${JSON.stringify(blockedPath)}, content: "allowed"});`);
  assert.match(JSON.stringify(allowed.content), /Script completed/);
  assert.equal(await readFile(blockedPath, "utf8"), "allowed");
  assert.deepEqual(session.getActiveToolNames(), active);

  await session.prompt("/safe");
  const search = session.agent.state.tools.find((tool) => tool.name === "tool_search")!;
  await search.execute("discover-remote", { query: "write_remote", limit: 1 });
  assert.ok(session.getActiveToolNames().includes("write_remote"));
  const discoveredLoadout = session.getActiveToolNames();
  const remote = await runScript("blocked-remote-script", 'return await tools.write_remote({path: "/fixture", content: "blocked"});');
  assert.match(JSON.stringify(remote.content), /Blocked by SAFE/);
  await session.prompt("/yolo");
  assert.deepEqual(session.getActiveToolNames(), discoveredLoadout);

  let requests = 0;
  session.agent.streamFunction = async (_model, context) => {
    requests++;
    if (requests === 1) {
      await session.prompt("/safe");
      return response([{ type: "toolCall", id: "mid-run-read", name: "read", arguments: { path: blockedPath } }], "toolUse");
    }
    const text = JSON.stringify(context.messages);
    assert.ok(text.lastIndexOf("Execution policy: SAFE") > text.lastIndexOf('"role":"toolResult"'), "mid-run notice must follow the tool result and reach the next request");
    return response([{ type: "text", text: "Done" }]);
  };
  await session.prompt("Inspect the file");
  assert.equal(requests, 2, "notice must not force another provider request");

  // Retain only the final assistant response, dropping the policy notices.
  manager.appendCompaction("Earlier work summarized", manager.getLeafId()!, 0);
  session.refreshContext();
  assert.equal(notices().length, 0);
  session.agent.streamFunction = () => response([{ type: "text", text: "After compaction" }]);
  await session.prompt("Continue inspecting");
  assert.equal(notices().length, 1);
  assert.ok(notices().some((message) => String(message.content).includes("Execution policy: SAFE")));
  await session.prompt("Continue again");
  assert.equal(notices().length, 1);

  await session.prompt("/yolo");
  manager.appendCompaction("Earlier work mentioned SAFE", manager.getLeafId()!, 0);
  session.refreshContext();
  await session.prompt("Continue with the current policy");
  assert.equal(notices().length, 1);
  assert.ok(notices().some((message) => String(message.content).includes("Execution policy: YOLO")),
    "compaction must not suppress a corrective default notice after SAFE");
  assert.deepEqual(errors, []);
});
