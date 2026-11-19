import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import promptSuggestions from "../extensions/prompt-suggestions/index.ts";
import { readSettings, writeEnabled } from "../extensions/prompt-suggestions/config.ts";
import { buildTranscript, parseSuggestion } from "../extensions/prompt-suggestions/generation.ts";
import { registerExtension } from "./extension-fixture.mjs";

const user = (content) => ({ type: "message", message: { role: "user", content } });
const assistant = (text) => ({
  type: "message",
  message: {
    role: "assistant", stopReason: "stop",
    content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text }],
  },
});

function setup(t, mode = "tui") {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-v2-suggestions-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const existingAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (existingAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = existingAgentDir;
  });
  const path = join(agentDir, "prompt-suggestions.json");
  const commands = new Map();
  const host = registerExtension(promptSuggestions, { registerCommand: (name, command) => commands.set(name, command) });
  const h = { leaf: "a", draft: "", requests: [], path, mode };
  const base = {
    getSuggestions: async () => ({ prefix: "", items: [{ value: "file.txt", label: "file.txt" }] }),
    applyCompletion: () => ({ lines: ["file.txt"], cursorLine: 0, cursorCol: 8 }),
    shouldTriggerFileCompletion: () => false,
    triggerCharacters: ["@"],
  };
  const ctx = {
    mode, hasUI: true,
    isIdle: () => true,
    sessionManager: {
      getLeafId: () => h.leaf,
      getSessionId: () => "session-a",
      buildContextEntries: () => [user("Fix the build."), assistant("The build completed. The integration suite is pending.")],
    },
    modelRegistry: {
      find: () => ({ provider: "opencode-go" }),
      hasConfiguredAuth: () => true,
      complete: async (_model, input, options) => new Promise((resolve) => h.requests.push({ input, options, resolve })),
    },
    ui: {
      theme: { fg: (_color, text) => text },
      notify() {},
      getEditorText: () => h.draft,
      setStatus: (_id, status) => { h.status = status; },
      setWidget: (_id, factory, options) => {
        if (factory) assert.equal(options.placement, "belowEditor");
        h.widget = factory?.(undefined, ctx.ui.theme);
      },
      onTerminalInput: (listener) => { h.input = listener; return () => { h.input = undefined; }; },
      addAutocompleteProvider: (wrap) => { h.provider = wrap(base); },
    },
  };
  h.fire = (event, payload = {}) => host.fire(event, payload, ctx);
  h.command = (args) => commands.get("suggestions").handler(args, ctx);
  h.resolve = async (index, text = "Run the integration suite.") => {
    h.requests[index].resolve({ stopReason: "stop", content: [{ type: "text", text }] });
    await new Promise(setImmediate);
  };
  t.after(() => h.fire("session_shutdown"));
  return h;
}

test("suggestions opt in, fit the terminal, and accept once through native autocomplete", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 0);
  await h.command("on");
  assert.equal(JSON.parse(readFileSync(h.path, "utf8")).enabled, true);
  assert.equal(h.requests.length, 1);
  await h.resolve(0);
  assert.match(h.widget.render(80)[0], /Run the integration suite\.  Tab to accept/);
  assert.ok(visibleWidth(h.widget.render(12)[0]) <= 12);
  assert.deepEqual(h.provider.triggerCharacters, ["@"]);
  assert.equal(h.provider.shouldTriggerFileCompletion([""], 0, 0), true);
  h.input("\t");
  const { items: [suggestion] } = await h.provider.getSuggestions([""], 0, 0, { force: true });
  assert.deepEqual(h.provider.applyCompletion([""], 0, 0, suggestion, ""), {
    lines: ["Run the integration suite."], cursorLine: 0, cursorCol: 26,
  });
  assert.equal(h.widget, undefined);
  const { items: [file] } = await h.provider.getSuggestions(["@"], 0, 1, { force: true });
  assert.equal(file.value, "file.txt");
  assert.deepEqual(h.provider.applyCompletion(["@"], 0, 1, file, "@").lines, ["file.txt"]);
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 1);
});

test("typing cancels a pending request and a draft or branch change blocks stale completion", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  await h.command("on");
  h.input("H");
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.resolve(0);
  assert.equal(h.widget, undefined);

  h.leaf = "b";
  h.draft = "My draft";
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 1);
  h.draft = "";
  await h.fire("agent_settled");
  await h.resolve(1);
  const { items: [suggestion] } = await h.provider.getSuggestions([""], 0, 0, { force: true });
  h.leaf = "c";
  assert.deepEqual(h.provider.applyCompletion([""], 0, 0, suggestion, "").lines, [""]);
  assert.deepEqual(h.widget.render(80), []);
  await h.fire("session_tree");
  assert.equal(h.widget, undefined);
});

test("RPC never starts a background request or changes the preference", async (t) => {
  const h = setup(t, "rpc");
  await h.fire("session_start");
  await h.command("on");
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 0);
  assert.equal(h.provider, undefined);
  assert.equal(readSettings(h.path).enabled, false);
});

test("a timeout releases the UI and shutdown cancels the new request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t);
  await h.fire("session_start");
  await h.command("on");
  assert.match(h.status, /thinking/);
  t.mock.timers.tick(10_000);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.match(h.status, /unavailable/);
  await h.resolve(0);
  assert.equal(h.widget, undefined);
  h.leaf = "b";
  await h.fire("agent_settled");
  await h.fire("session_shutdown");
  assert.equal(h.requests[1].options.signal.aborted, true);
  assert.equal(h.input, undefined);
});

test("configuration preserves legacy Ollama files and never saves environment overrides", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-v2-suggestions-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "prompt-suggestions.json");
  writeFileSync(path, JSON.stringify({ ollamaUrl: "http://localhost:11434/", model: "configured", extra: true }));
  assert.deepEqual(readSettings(path, { PI_SUGGESTIONS_MODEL: "override" }), {
    enabled: false, provider: "ollama", model: "override", ollamaUrl: "http://localhost:11434",
  });
  writeEnabled(path, true);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    ollamaUrl: "http://localhost:11434/", model: "configured", extra: true, enabled: true,
  });
});

test("transcript keeps recent text and drops tool data, and suggestions reject command and control output", () => {
  const result = assistant("Build fixed");
  result.message.content.push({ type: "toolCall", arguments: { token: "tool-argument" } });
  const entries = [
    ...Array.from({ length: 20 }, () => user("older".repeat(500))),
    { type: "branch_summary", summary: "omitted summary" },
    user([{ type: "text", text: "Run the test" }, { type: "image", data: "omitted image" }]),
    { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "tool-output" }] } },
    result,
  ];
  const ctx = { sessionManager: { buildContextEntries: () => entries } };
  const transcript = buildTranscript(ctx);
  assert.ok(transcript.length <= 12_000);
  assert.match(transcript, /"role":"user","text":"Run the test"/);
  assert.match(transcript, /"role":"assistant","text":"Build fixed"/);
  assert.doesNotMatch(transcript, /omitted|private reasoning|tool-argument|tool-output/);
  result.message.stopReason = "aborted";
  assert.equal(buildTranscript(ctx), undefined);
  for (const raw of ["/quit", "!ls", "Would you like me to proceed?", "NO_SUGGESTION", "One\nTwo", "A\x1b[31m", "A\u202e"]) {
    assert.equal(parseSuggestion(raw), undefined);
  }
  assert.equal(parseSuggestion('Suggestion: “Run the tests.”'), "Run the tests.");
});
