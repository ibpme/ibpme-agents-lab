import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession, createCodemodeExtension, createToolSearchExtension, DefaultResourceLoader,
  initTheme, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { rgbColor, stripTerminalSequences, styleText, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function response(content, stopReason = "stop") {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: stopReason, message: {
    role: "assistant", api: "openai-responses", provider: "openai", model: "test",
    stopReason, timestamp: Date.now(), content, usage,
  } });
  return stream;
}

test("tool-control preserves Pi's loadout and applies SAFE at direct and nested call entry points", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-v2-tool-control-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const agentDir = join(cwd, "agent");
  const settingsManager = SettingsManager.inMemory({ packages: [{
    source: packageRoot, extensions: ["extensions/tool-control/index.ts", "extensions/question/index.ts"],
  }] });
  let registerLateTool;
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createCodemodeExtension(), createToolSearchExtension(), (pi) => {
      registerLateTool = () => pi.registerTool(definition("mcp__late__inspect", true));
    }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(cwd);
  const legacyTip = manager.appendMessage({
    role: "system", content: "Restored tools", timestamp: 0,
    toolsAdded: ["read", "write", "ls", "question"].map((name) => ({ name, description: name, parameters: {} })),
  });
  manager.appendCustomEntry("tool-set-mode", { mode: "safe" });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai", async () => ({ type: "api_key", key: "offline-test" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const definition = (name, readOnlyHint) => ({
    name, label: name, description: "Test tool", parameters: Type.Object({}), exposure: "deferred",
    ...(readOnlyHint === undefined ? {} : { annotations: { readOnlyHint } }),
    execute: async () => ({ content: [{ type: "text", text: name }] }),
  });
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, sessionManager: manager,
    modelRuntime: runtime, model: runtime.getModels("openai")[0], excludeTools: ["find"],
    customTools: [definition("fixture_mutation", false), definition("mcp__demo__update"), definition("mcp__demo__inspect", true)],
  });
  t.after(() => session.dispose());
  initTheme("dark", false);
  const statuses = new Map();
  const errors = [];
  const views = [];
  const theme = {
    fg: (color, text) => color === "dim" ? styleText(text, { dim: true }, "truecolor") : text,
    style: (text, options) => styleText(text, options, "truecolor"),
    bold: (text) => text,
  };
  let approve = () => false;
  const uiContext = {
    theme,
    setStatus: (key, value) => statuses.set(key, value),
    confirm: async () => approve(),
    custom: (factory) => new Promise((resolve, reject) => {
      const viewer = factory({ terminal: { rows: 45 }, requestRender() {} }, theme, undefined, resolve);
      try {
        const initial = viewer.render(90).join("\n");
        viewer.handleInput("\x1b[C");
        const expanded = viewer.render(90).join("\n");
        const narrow = viewer.render(6);
        views.push({ initial, expanded, narrow });
        viewer.handleInput("\x1b");
      } catch (error) {
        reject(error);
      }
    }),
  };
  await session.bindExtensions({ mode: "tui", uiContext, onError: (error) => errors.push(error.error) });
  const active = session.getActiveToolNames();
  assert.deepEqual(new Set(active), new Set(["read", "write", "ls", "question", "codemode", "tool_search", "change_mode"]));
  assert.equal(statuses.get("mode"), "● SAFE");
  const activeCodemode = theme.style("  codemode", { fg: rgbColor(245, 158, 66) });
  const searchIcon = theme.style("󰍉", { fg: rgbColor(106, 169, 255) });
  assert.equal(statuses.get("codemode"), activeCodemode);
  assert.ok(statuses.get("tools").startsWith(searchIcon + " "));
  assert.doesNotMatch(stripTerminalSequences(statuses.get("tools")), /tool_search|codemode/);
  assert.match(stripTerminalSequences(statuses.get("tools")), /\bquestion\b/);
  assert.ok(statuses.get("mcp-tools").startsWith(theme.fg("dim", "󰌘") + " "));
  assert.equal(stripTerminalSequences(statuses.get("mcp-tools")), "󰌘 mcp: demo (2)");
  registerLateTool();
  assert.ok(session.getCallableToolNames().includes("mcp__late__inspect"));
  const deadline = Date.now() + 1000;
  while (!statuses.get("mcp-tools").includes("late (1)") && Date.now() < deadline) await delay(25);
  assert.match(stripTerminalSequences(statuses.get("mcp-tools")), /late \(1\)/);
  assert.equal(session.getToolDefinition("grep").exposure, "deferred");
  assert.equal(session.getToolDefinition("find"), undefined);
  assert.ok(session.getCallableToolNames().includes("grep"));
  assert.ok(!session.getCallableToolNames().includes("change_mode"));

  await session.prompt("/tools");
  assert.match(views[0].initial, /write\s+active · blocked \(SAFE\)/);
  assert.match(views[0].initial, /fixture_mutation\s+deferred · blocked \(SAFE\)/);
  assert.match(views[0].expanded, /Arguments\n\s+path\s+string/);
  assert.ok(views[0].narrow.every((line) => visibleWidth(line) <= 6));

  const safeFile = join(cwd, "fixture.txt");
  await writeFile(safeFile, "initial");
  let id = 0;
  async function call(name, args) {
    const toolCallId = `fixture-${++id}`;
    let requested = false;
    session.agent.streamFunction = () => {
      if (requested) return response([{ type: "text", text: "Done" }]);
      requested = true;
      return response([{ type: "toolCall", id: toolCallId, name, arguments: args }], "toolUse");
    };
    await session.prompt(`Call ${name}`);
    const result = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === toolCallId);
    assert.ok(result, name);
    return result;
  }
  const resultText = ({ content }) => content.map(({ text }) => text).join("\n");

  let result = await call("write", { path: safeFile, content: "blocked" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Blocked by SAFE/);
  result = await call("codemode", { code: 'try { return await tools.write({path: "fixture.txt", content: "blocked"}); } catch (error) { return error.message; }' });
  assert.match(resultText(result), /Blocked by SAFE/);
  assert.equal(await readFile(safeFile, "utf8"), "initial");
  result = await call("codemode", { code: 'return await tools.ls({});' });
  assert.match(resultText(result), /fixture\.txt/);
  result = await call("codemode", { code: 'try { return await tools.mcp__demo__update({}); } catch (error) { return error.message; }' });
  assert.match(resultText(result), /Blocked by SAFE/);
  result = await call("codemode", { code: 'return await tools.mcp__demo__inspect({});' });
  assert.equal(result.isError, false);
  assert.match(resultText(result), /mcp__demo__inspect/);

  const notices = () => session.messages.filter(({ role, customType }) => role === "custom" && customType === "tool-control-mode-context");
  assert.deepEqual(notices().map(({ content }) => content.split(".")[0]), ["Execution policy: SAFE"]);
  await session.prompt("/yolo");
  await session.prompt("/safe");
  assert.equal(notices().length, 1);
  assert.deepEqual(session.getActiveToolNames(), active);

  approve = async () => { await session.prompt("/safe"); return true; };
  result = await call("change_mode", { mode: "yolo" });
  assert.match(result.content[0].text, /expired/);
  assert.equal(statuses.get("mode"), "● SAFE");
  approve = () => true;
  result = await call("change_mode", { mode: "yolo" });
  assert.match(result.content[0].text, /approved/);
  assert.equal(statuses.get("mode"), "⏵⏵ YOLO");
  assert.deepEqual(notices().map(({ content }) => content.split(".")[0]), ["Execution policy: SAFE", "Execution policy: YOLO"]);
  assert.deepEqual(session.getActiveToolNames(), active);

  await session.prompt("/safe");
  assert.equal((await session.navigateTree(legacyTip)).cancelled, false);
  assert.equal(notices().length, 0);
  assert.equal(statuses.get("mode"), "● SAFE");
  session.setActiveToolsByName(active.filter((name) => name !== "codemode" && name !== "tool_search"));
  await session.prompt("/safe");
  assert.equal(statuses.get("codemode"), theme.fg("dim", "  codemode"));
  assert.doesNotMatch(statuses.get("tools"), /󰍉/);
  await session.reload();
  assert.equal(statuses.get("mode"), "● SAFE");
  assert.equal(statuses.get("codemode"), activeCodemode);
  assert.ok(statuses.get("tools").startsWith(searchIcon + " "));
  session.extensionRunner.setUIContext(undefined, "print");
  result = await call("change_mode", { mode: "yolo" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /approval is unavailable/);
  assert.match(notices().at(-1).content, /^Execution policy: SAFE\./);
  await session.prompt("/auto");
  result = await call("write", { path: safeFile, content: "allowed" });
  assert.equal(result.isError, false);
  assert.equal(await readFile(safeFile, "utf8"), "allowed");
  assert.deepEqual(errors, []);
});

test("a turn-end policy notice appends to preceding proposals and does not request continuation", async () => {
  const { registerModeNotice } = await import("../extensions/tool-control/state-notice.ts");
  const hooks = new Map();
  registerModeNotice({ on: (name, handler) => hooks.set(name, handler) }, () => "safe");
  const earlier = { type: "custom_message", customType: "another-extension", content: "Keep this", display: true };
  const event = { entries: [earlier], continue: false, context: { contextMessages: [] } };
  const result = hooks.get("turn_end")(event, {});
  assert.deepEqual(result.entries.slice(0, 1), [earlier]);
  assert.match(result.entries[1].content, /^Execution policy: SAFE\./);
  assert.equal(result.continue, undefined);
});
