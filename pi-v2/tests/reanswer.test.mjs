import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import questionExtension from "../extensions/question/index.ts";

const questions = (id, prompt) => [{
  id, label: id, prompt,
  options: ["Application", "Tests", "Documentation"].map((label) => ({ value: label.toLowerCase(), label })),
}];
const scope = questions("Scope", "What should change?");
const target = questions("Target", "What should be verified?");
const answer = (questionnaire, index) => [{
  id: questionnaire[0].id,
  values: [{ ...questionnaire[0].options[index], wasCustom: false, index: index + 1 }],
}];
const toolCall = (id, questionnaire) => ({ type: "toolCall", name: "question", id, arguments: { questions: questionnaire } });

function setup() {
  const sm = SessionManager.inMemory();
  const notices = [];
  const navigations = [];
  const sent = [];
  let handler, project, render;
  let timestamp = 0;
  const append = (message) => sm.appendMessage({ timestamp: ++timestamp, ...message });
  const assistant = (...content) => append({ role: "assistant", content });
  const toolResult = (toolCallId, toolName, text, details) =>
    append({ role: "toolResult", toolCallId, toolName, isError: false, details, content: [{ type: "text", text }] });
  const result = (id, questionnaire, index = 0) =>
    toolResult(id, "question", questionnaire[0].options[index].label, { questions: questionnaire, answers: answer(questionnaire, index), cancelled: false });
  questionExtension({
    registerTool() {},
    registerCommand(name, command) { if (name === "reanswer") handler = command.handler; },
    on(name, hook) { if (name === "context") project = hook; },
    registerMessageRenderer(name, renderer) { if (name === "question-reanswer") render = renderer; },
    sendMessage(message, options) {
      sent.push({ message, options });
      sm.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    },
  });
  const ctx = {
    mode: "rpc", hasUI: true, isIdle: () => true, waitForIdle: async () => {},
    sessionManager: sm,
    async navigateTree(id, options) {
      navigations.push({ id, options });
      sm.branch(id);
      return { cancelled: false };
    },
    ui: { notify: (message) => notices.push(message) },
  };
  const runWithArgs = async (args, ...steps) => {
    ctx.ui.select = async (title, options) => {
      const step = steps.shift();
      assert.ok(step, title);
      const [expectedTitle, selection, inspect] = step;
      assert.match(title, expectedTitle);
      inspect?.(options);
      if (!selection) return undefined;
      const choice = options.find((option) => selection.test(option));
      assert.ok(choice, options.join("\n"));
      return choice;
    };
    await handler(args, ctx);
    assert.deepEqual(steps, []);
  };
  return {
    sm, ctx, notices, navigations, sent, append, assistant, toolResult, result, runWithArgs,
    run: (...steps) => runWithArgs("", ...steps), project, render,
  };
}

const choose = /^Which questionnaire/;
const review = /^Review and edit previous answers/;
const submit = /Continue with revised answers/;

test("the /reanswer TUI preserves pasted newlines in a single-choice write-in", async () => {
  const h = setup();
  h.assistant(toolCall("scope", scope));
  h.result("scope", scope);
  h.ctx.mode = "tui";
  let form;
  h.ctx.ui.custom = (factory) => new Promise((resolve) => {
    form = factory({ terminal: { rows: 24 }, requestRender() {} },
      { fg: (_color, text) => text, bold: (text) => text }, {}, resolve);
  });
  const result = h.runWithArgs("1");
  await new Promise(setImmediate);
  form.handleInput("1");
  await new Promise(setImmediate);
  for (let i = 0; i < scope[0].options.length; i++) form.handleInput("\x1b[B");
  form.handleInput("\r");
  await new Promise(setImmediate);
  assert.match(form.render(80).join("\n"), /Shift\+Enter new line/);
  form.handleInput("\x1b[200~first line\nsecond line\x1b[201~");
  form.handleInput("\r");
  await new Promise(setImmediate);
  form.handleInput("\t");
  await result;
  assert.equal(h.sent[0].message.details[0].result.answers[0].values[0].value, "first line\nsecond line");
});

test("repeated revisions start from current answers and retain sibling results and revisions", async () => {
  const h = setup();
  h.append({ role: "user", content: "Ask about the work." });
  h.assistant(toolCall("scope", scope), toolCall("target", target), { type: "toolCall", name: "read", id: "read" });
  const originalScope = h.result("scope", scope);
  h.result("target", target);
  const checkpoint = h.toolResult("read", "read", "Sibling result");
  const originalLeaf = h.assistant({ type: "text", text: "Original reply" });
  await h.run(
    [choose, /^2\. Scope/, (options) => assert.match(options[0], /^1\. Target/)],
    [review, /What should change\? — Application$/],
    [/What should change/, /^2\. Tests$/],
    [review, submit, (options) => assert.match(options.at(-1), /^\n2\. Continue with revised answers/)],
  );
  h.assistant({ type: "text", text: "Reply after editing scope" });
  await h.run(
    [choose, /^1\. Target/],
    [review, /What should be verified\? — Application$/],
    [/What should be verified/, /^3\. Documentation$/],
    [review, submit],
  );
  await h.run(
    [choose, /^2\. Scope — Tests$/],
    [review, /What should change\? — Tests$/],
    [/What should change/, /^3\. Documentation$/],
    [review, submit],
  );
  assert.deepEqual(h.navigations, Array(3).fill({ id: checkpoint, options: { summarize: false } }));
  assert.ok(h.sent.every(({ options }) => options.triggerTurn === true));
  assert.equal(h.sm.getEntry(originalLeaf).message.content[0].text, "Original reply");
  assert.equal(h.sm.getEntry(originalScope).message.content[0].text, "Application");
  const messages = h.sm.buildSessionContext().messages;
  const projected = h.project({ messages }).messages;
  assert.deepEqual(projected.filter(({ role }) => role === "toolResult").map(({ toolCallId, content }) => [toolCallId, content[0].text]), [
    ["scope", 'Scope: 3. Documentation [value: "documentation"]'],
    ["target", 'Target: 3. Documentation [value: "documentation"]'],
    ["read", "Sibling result"],
  ]);
  assert.ok(projected.every(({ role }) => role !== "custom"));
  const theme = { fg: (_color, text) => text, bold: (text) => text, bg: (_color, text) => text };
  const message = messages.find(({ role }) => role === "custom");
  for (const expanded of [false, true]) {
    const row = h.render(message, { expanded, outputPad: 1, keyHint: () => "" }, theme);
    assert.match(row.render(60).join("\n"), /Revised questionnaire answers/);
    assert.match(row.render(60).join("\n"), /Documentation/);
    assert.ok(row.render(24).every((line) => visibleWidth(line) <= 24));
  }
});

test("dismissing the form or submitting the same answers leaves the branch alone", async () => {
  const h = setup();
  h.assistant(toolCall("scope", scope));
  const original = h.result("scope", scope);
  await h.run([review, undefined]);
  await h.run([review, submit]);
  assert.equal(h.sm.getLeafId(), original);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.navigations, []);
  assert.deepEqual(h.notices, ["Answers are unchanged"]);

  h.assistant(toolCall("scope-2", scope), { type: "toolCall", name: "read", id: "unfinished" });
  h.result("scope-2", scope);
  await h.run([review, submit]);
  assert.deepEqual(h.navigations, []);
  assert.deepEqual(h.sent, []);
});

test("/reanswer with a number opens that questionnaire directly and validates the range", async () => {
  const h = setup();
  h.assistant(toolCall("scope", scope));
  const older = h.result("scope", scope);
  h.assistant(toolCall("target", target));
  const newest = h.result("target", target);

  await h.runWithArgs("0");
  await h.runWithArgs("3");
  assert.equal(h.sm.getLeafId(), newest);
  assert.match(h.notices[0], /Use \/reanswer or \/reanswer <number>/);
  assert.match(h.notices[1], /1 to 2/);
  await h.runWithArgs(
    "2",
    [review, /What should change\? — Application$/],
    [/What should change/, /^2\. Tests$/],
    [review, submit],
  );
  assert.deepEqual(h.navigations, [{ id: older, options: { summarize: false } }]);
});

test("reads a legacy revision and keeps its replacement available when the source is compacted", async () => {
  const h = setup();
  h.append({ role: "user", content: "Ask about the work." });
  h.assistant(toolCall("scope", scope));
  h.result("scope", scope);
  h.sm.appendCustomMessageEntry("question-reanswer", "Legacy revision", true, {
    toolCallId: "scope",
    result: { questions: scope, answers: answer(scope, 1), cancelled: false },
  });
  await h.run([review, /What should change\? — Tests$/], [/What should change/, /^3\. Documentation$/], [review, submit]);
  const revision = h.sm.getLeafId();
  h.assistant({ type: "text", text: "Revised reply" });
  h.sm.appendCompaction("Earlier messages were compacted.", revision, 100);
  const messages = h.sm.buildSessionContext().messages;
  assert.ok(messages.every(({ role }) => role !== "toolResult"));
  assert.equal(h.project({ messages }), undefined);
  const correction = messages.find(({ role }) => role === "custom");
  assert.match(correction.content, /What should change\?\n\nScope: 3\. Documentation/);
});
