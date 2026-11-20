import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const h = { leaf: "a", draft: "", requests: [], notices: [], renders: 0, modelAvailable: true, path, mode };
  const tui = { requestRender: () => h.renders++ };
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
      find: () => h.modelAvailable ? { provider: "opencode-go" } : undefined,
      hasConfiguredAuth: () => true,
      complete: async (_model, input, options) => new Promise((resolve) => h.requests.push({ input, options, resolve })),
    },
    ui: {
      theme: { fg: (_color, text) => text },
      notify: (message, level) => h.notices.push({ message, level }),
      getEditorText: () => h.draft,
      setWidget: (_id, factory, options) => {
        h.widget?.dispose?.();
        if (factory) assert.equal(options.placement, "aboveEditor");
        h.widget = factory?.(tui, ctx.ui.theme);
      },
      onTerminalInput: (listener) => { h.input = listener; return () => { h.input = undefined; }; },
      addAutocompleteProvider: (wrap) => { h.provider = wrap(base); },
    },
  };
  h.fire = (event, payload = {}) => host.fire(event, payload, ctx);
  h.command = (args) => commands.get("suggestions").handler(args, ctx);
  h.toggle = () => host.shortcuts.get("shift+right").handler(ctx);
  h.type = (text) => {
    h.input?.(text);
    h.draft += text;
  };
  h.resolve = async (index, text = "Run the integration suite.", stopReason = "stop") => {
    h.requests[index].resolve({ stopReason, content: [{ type: "text", text }] });
    await new Promise(setImmediate);
  };
  t.after(() => h.fire("session_shutdown"));
  return h;
}

test("suggestions animate until ready and can be accepted again after clearing the draft", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = setup(t);
  await h.fire("session_start");
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 0);
  await h.command("on");
  assert.equal(JSON.parse(readFileSync(h.path, "utf8")).enabled, true);
  assert.equal(h.requests.length, 1);
  for (const frame of [".", "..", "...", "."]) {
    assert.deepEqual(h.widget.render(80), [frame]);
    assert.deepEqual(h.widget.render(1), ["."]);
    t.mock.timers.tick(180);
  }
  assert.equal(h.renders, 4);
  await h.resolve(0);
  t.mock.timers.tick(180);
  assert.equal(h.renders, 4, "the loading animation stops when the preview replaces it");
  assert.match(h.widget.render(80)[0], /^↱ Run the integration suite\.  Tab to accept$/);
  assert.ok(visibleWidth(h.widget.render(12)[0]) <= 12);
  assert.deepEqual(h.provider.triggerCharacters, ["@"]);
  assert.equal(h.provider.shouldTriggerFileCompletion([""], 0, 0), true);
  const { items: [suggestion] } = await h.provider.getSuggestions([""], 0, 0, { force: true });
  const accepted = h.provider.applyCompletion([""], 0, 0, suggestion, "");
  assert.deepEqual(accepted, { lines: ["Run the integration suite."], cursorLine: 0, cursorCol: 26 });
  h.draft = accepted.lines[0];
  assert.deepEqual(h.widget.render(80), []);
  h.draft = "";
  assert.match(h.widget.render(80)[0], /^↱ Run the integration suite\./);
  const { items: [restored] } = await h.provider.getSuggestions([""], 0, 0, { force: true });
  assert.deepEqual(h.provider.applyCompletion([""], 0, 0, restored, ""), accepted);
  await h.fire("input");
  assert.equal(h.widget, undefined);
  const { items: [file] } = await h.provider.getSuggestions(["@"], 0, 1, { force: true });
  assert.equal(file.value, "file.txt");
  assert.deepEqual(h.provider.applyCompletion(["@"], 0, 1, file, "@").lines, ["file.txt"]);
  await h.fire("agent_settled");
  assert.equal(h.requests.length, 1);
});

test("Shift+Right toggles and persists the suggestions preference", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  assert.equal(h.widget, undefined);
  h.toggle();
  assert.equal(readSettings(h.path).enabled, true);
  assert.deepEqual(h.widget.render(80), ["."]);
  h.toggle();
  assert.equal(readSettings(h.path).enabled, false);
  assert.equal(h.widget, undefined);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.resolve(0, "", "error");
  assert.deepEqual(h.notices.map(({ message }) => message), ["Prompt suggestions on", "Prompt suggestions off"]);
});

test("a suggestion survives drafting and reappears when the editor is emptied", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  await h.command("on");
  h.type("My draft");
  assert.equal(h.requests[0].options.signal.aborted, false);
  await h.resolve(0);
  assert.deepEqual(h.widget.render(80), []);
  h.draft = "";
  const preview = h.widget.render(80);
  assert.match(preview[0], /Run the integration suite/);
  const { items: [suggestion] } = await h.provider.getSuggestions([""], 0, 0, { force: true });

  h.type("@");
  assert.deepEqual(h.widget.render(80), []);
  const { items: [file] } = await h.provider.getSuggestions(["@"], 0, 1, { force: true });
  assert.equal(file.value, "file.txt");
  assert.deepEqual(h.provider.applyCompletion(["@"], 0, 1, suggestion, "").lines, ["@"]);
  h.draft = "";
  assert.deepEqual(h.widget.render(80), preview);
  assert.equal(h.requests.length, 1);
});

test("an offer generated while drafting is invalidated by a branch change", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  h.draft = "My draft";
  await h.command("on");
  assert.equal(h.requests.length, 1);
  await h.resolve(0);
  h.draft = "";
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

test("a timeout removes the loading dots, notifies once, and shutdown cancels the new request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(t);
  await h.fire("session_start");
  await h.command("on");
  assert.deepEqual(h.widget.render(80), ["."]);
  t.mock.timers.tick(10_000);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.widget, undefined);
  assert.deepEqual(h.notices.at(-1), { message: "Follow-up suggestion timed out", level: "warning" });
  await h.resolve(0, "", "error");
  assert.equal(h.widget, undefined);
  assert.equal(h.notices.length, 2);
  h.leaf = "b";
  await h.fire("agent_settled");
  await h.fire("session_shutdown");
  assert.equal(h.requests[1].options.signal.aborted, true);
  assert.equal(h.widget, undefined);
});

test("no suggestion, an unavailable model, and provider errors leave notifications instead of a widget", async (t) => {
  const h = setup(t);
  await h.fire("session_start");
  await h.command("on");
  await h.resolve(0, "NO_SUGGESTION");
  assert.deepEqual(h.notices.at(-1), { message: "No follow-up suggestion available", level: "info" });
  assert.equal(h.widget, undefined);

  h.leaf = "b";
  h.modelAvailable = false;
  await h.fire("agent_settled");
  assert.deepEqual(h.notices.at(-1), { message: "Follow-up suggestion model unavailable", level: "warning" });
  assert.equal(h.widget, undefined);

  h.leaf = "c";
  h.modelAvailable = true;
  await h.fire("agent_settled");
  await h.resolve(1, "", "error");
  assert.deepEqual(h.notices.at(-1), { message: "Could not load a follow-up suggestion", level: "error" });
  assert.equal(h.widget, undefined);
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
  const target = join(dir, "settings.json");
  renameSync(path, target);
  symlinkSync("settings.json", path);
  writeEnabled(path, false);
  assert.equal(readlinkSync(path), "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), {
    ollamaUrl: "http://localhost:11434/", model: "configured", extra: true, enabled: false,
  });
  rmSync(target);
  writeEnabled(path, true);
  assert.equal(readlinkSync(path), "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { enabled: true });
});

test("transcript reserves space for the latest user message across long assistant output", () => {
  const entries = [user("Latest request"), ...Array.from({ length: 8 }, () => assistant("x".repeat(3_000))),
    assistant("Final answer")];
  const ctx = { sessionManager: { buildContextEntries: () => entries } };
  const transcript = buildTranscript(ctx);
  assert.ok(transcript.length <= 12_000);
  const messages = transcript.split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(messages[0], { role: "user", text: "Latest request" });
  assert.deepEqual(messages.at(-1), { role: "assistant", text: "Final answer" });
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
