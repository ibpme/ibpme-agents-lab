import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import questionExtension from "../extensions/question/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

const scope = {
  id: "scope", label: "Scope", prompt: "What should change?",
  options: [
    { value: "app", label: "Application", description: "Update application code" },
    { value: "tests", label: "Tests" },
  ],
};
const note = { id: "note", prompt: "Any other detail?", options: [] };

function registerQuestionTool() {
  let tool;
  registerExtension(questionExtension, {
    registerTool: (definition) => { tool = definition; },
    registerCommand() {},
    registerMessageRenderer() {},
  });
  assert.equal(tool.name, "question");
  assert.equal(tool.executionMode, "sequential");
  return tool;
}

function setup(mode, ui) {
  const tool = registerQuestionTool();
  return (questions, signal) => tool.execute("question-1", { questions }, signal, undefined, { mode, ui });
}

test("native single choice disambiguates identical labels and preserves the selected value", async () => {
  const controller = new AbortController();
  const run = setup("rpc", {
    async select(title, options, { signal }) {
      assert.equal(title, scope.prompt);
      assert.equal(signal, controller.signal);
      assert.deepEqual(options, ["1. Same", "2. Same", "3. Write an answer"]);
      return options[1];
    },
  });
  const result = await run([{ ...scope, options: scope.options.map((item) => ({ value: item.value, label: "Same" })) }], controller.signal);
  assert.deepEqual(result.details.answers, [{
    id: "scope", values: [{ label: "Same", value: "tests", wasCustom: false, index: 2 }],
  }]);
  assert.match(result.content[0].text, /Scope: 2\. Same \[value: "tests"\]/);
});

test("RPC collects a multi-select and written answer, then lets the user revise before submit", async () => {
  const controller = new AbortController();
  const positions = [1, 0, 3, 0, 1, 3, 2];
  const inputs = ["   ", " Finish with a summary. "];
  const run = setup("rpc", {
    async select(title, options, { signal }) {
      assert.equal(signal, controller.signal);
      const index = positions.shift();
      if (positions.length === 3) {
        assert.equal(title, "Review your answers");
        assert.match(options[0], /Application, Tests$/);
        assert.match(options[1], /Finish with a summary\.$/);
        assert.equal(index, 0);
      }
      if (!positions.length) {
        assert.equal(title, "Review your answers");
        assert.match(options[0], /Application$/);
      }
      return options[index];
    },
    async input(title, _placeholder, { signal }) {
      assert.equal(signal, controller.signal);
      if (inputs.length === 1) assert.match(title, /non-blank/);
      return inputs.shift();
    },
  });
  const { details } = await run([{ ...scope, multiSelect: true }, note], controller.signal);
  assert.deepEqual(details.answers, [
    { id: "scope", values: [{ label: "Application", value: "app", wasCustom: false, index: 1 }] },
    { id: "note", values: [{ label: "Finish with a summary.", value: "Finish with a summary.", wasCustom: true }] },
  ]);
  assert.equal(details.cancelled, false);
});

test("the TUI checklist stays open while toggling and is dismissed by the tool signal", async () => {
  const controller = new AbortController();
  let form;
  const run = setup("tui", {
    custom(factory, options) {
      assert.equal(options.blocked.kind, "question");
      return new Promise((resolve) => {
        form = factory({ terminal: { rows: 20 }, requestRender() {} }, { fg: (_color, text) => text, bold: (text) => text }, {}, resolve);
      });
    },
  });
  const result = run([{ ...scope, multiSelect: true }], controller.signal);
  const narrow = form.render(30);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 30));
  assert.ok(narrow.includes("Choose one or more"));
  assert.match(narrow.join("\n"), /\[ \] Application/);
  form.handleInput(" ");
  assert.match(form.render(80).join("\n"), /\[x\] Application/);
  form.handleInput("\x1b[B");
  form.handleInput(" ");
  assert.match(form.render(80).join("\n"), /\[x\] Tests/);
  controller.abort();
  const { details } = await result;
  assert.deepEqual(details.answers, []);
  assert.equal(details.cancelled, true);
  assert.equal(details.reason, "aborted");
});

test("the TUI single-choice picker shows radio markers and a separate focused description", async () => {
  let form;
  const styles = [];
  const run = setup("tui", {
    custom(factory) {
      return new Promise((resolve) => {
        const theme = {
          fg(color, text) { styles.push([color, text]); return text; },
          bold(text) { styles.push(["bold", text]); return text; },
        };
        form = factory({ terminal: { rows: 20 }, requestRender() {} }, theme, {}, resolve);
      });
    },
  });
  const result = run([scope]);
  const lines = form.render(50);
  assert.ok(styles.some(([style, text]) => style === "mdLink" && text === scope.prompt));
  assert.ok(styles.some(([style, text]) => style === "bold" && text === scope.prompt));
  assert.ok(lines.includes("Choose one"));
  assert.match(lines.join("\n"), /○ Application[^\n]*\n[^\n]*○ Tests/);
  assert.ok(lines.includes("  Update application code"));
  assert.doesNotMatch(lines.find((line) => line.includes("○ Application")), /Update application code/);
  form.handleInput(" ");
  form.handleInput("\x1b[B");
  assert.doesNotMatch(form.render(50).join("\n"), /Update application code|Space toggle/);
  form.handleInput("\r");
  assert.equal((await result).details.answers[0].values[0].value, "tests");
});

test("the TUI moves back and forward by Tab while preserving written drafts", async () => {
  let form;
  const styles = [];
  const theme = {
    fg(color, text) { styles.push([color, text]); return text; },
    bold(text) { styles.push(["bold", text]); return text; },
  };
  const run = setup("tui", {
    custom(factory) {
      return new Promise((resolve) => {
        form = factory({ terminal: { rows: 20 }, requestRender() {} }, theme, {}, resolve);
      });
    },
  });
  const result = run([scope, note]);
  form.handleInput("\r");
  await new Promise(setImmediate);
  assert.match(form.render(80).join("\n"), /Question 2 of 2/);
  assert.deepEqual(styles.filter(([, text]) => text === "Question 2 of 2"), [["text", "Question 2 of 2"]]);
  assert.deepEqual(styles.filter(([, text]) => text === note.prompt), [["bold", note.prompt], ["mdLink", note.prompt]]);
  assert.match(form.render(80).join("\n"), /Shift\+Tab \/ Esc previous/);
  for (const letter of "draft") form.handleInput(letter);
  form.handleInput("\x1b[Z");
  await new Promise(setImmediate);
  const earlier = form.render(80).join("\n");
  assert.match(earlier, /Question 1 of 2/);
  assert.match(earlier, /Tab continue/);
  form.handleInput("\t");
  await new Promise(setImmediate);
  assert.match(stripTerminalSequences(form.render(80).join("\n")), /draft/);
  form.handleInput("\t");
  await new Promise(setImmediate);
  const review = form.render(80).join("\n");
  assert.match(review, /1\. What should change\? — Application/);
  assert.match(review, /2\. Any other detail\? — draft/);
  assert.match(review, /draft\n\n  Submit answers/);
  form.handleInput("2");
  await new Promise(setImmediate);
  assert.match(form.render(80).join("\n"), /Esc back to review/);
  form.handleInput("\x1b");
  await new Promise(setImmediate);
  form.handleInput("\t");
  assert.equal((await result).details.answers[1].values[0].value, "draft");
});

test("the TUI opens a multiline written answer in the checklist and saves, discards, or removes it in place", async () => {
  let form;
  let panels = 0;
  const run = setup("tui", {
    custom(factory) {
      panels++;
      return new Promise((resolve) => {
        form = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_color, text) => text, bold: (text) => text }, {}, resolve);
      });
    },
  });
  const result = run([{ ...scope, multiSelect: true }]);
  const view = (width = 80) => stripTerminalSequences(form.render(width).join("\n"));
  const press = (...keys) => keys.forEach((key) => form.handleInput(key));

  press("2", "w");
  assert.match(view(), /2\. \[x\] Tests/);
  assert.match(view(), /Enter save · Shift\+Enter new line · Esc discard edit/);
  press("\r");
  assert.match(view(), /Enter a non-blank answer/);
  press("Check 1", "\n", "Check 2", "\r");
  assert.match(view(), /\[x\] Written answer — Check 1 Check 2/);
  assert.match(view(), /Check 1 Check 2\n\n  Continue/);
  assert.match(view(), /Delete remove/);
  press("w");
  assert.match(view(), /Check 1[^\n]*\n[^\n]*Check 2/);
  press(" saved", "\r");
  assert.match(view(), /Written answer — Check 1 Check 2 saved/);
  press("w");
  press(" discarded", "\x1b");
  assert.match(view(), /Written answer — Check 1 Check 2 saved/);
  assert.doesNotMatch(view(), /discarded/);
  press("\x1b[3~");
  assert.match(view(), /Write an answer/);
  assert.match(view(), /2\. \[x\] Tests/);
  assert.doesNotMatch(view(), /Check 1|\[x\] Written answer/);
  press("2", "\t");
  assert.match(view(), /Continue · select or write an answer/);
  press("w", "Final 1", "\n", "Final 2", "\r", "\t");
  const { details } = await result;
  assert.equal(panels, 1);
  assert.deepEqual(details.answers[0].values.map(({ value, wasCustom }) => [value, wasCustom]), [
    ["Final 1\nFinal 2", true],
  ]);
});

test("number shortcuts reach choices past nine and an invalid number cannot select an answer", async () => {
  let form;
  const run = setup("tui", {
    custom(factory) {
      return new Promise((resolve) => {
        form = factory({ terminal: { rows: 16 }, requestRender() {} }, { fg: (_color, text) => text, bold: (text) => text }, {}, resolve);
      });
    },
  });
  const options = Array.from({ length: 12 }, (_, index) => ({ label: `Option ${index + 1}`, value: String(index + 1) }));
  const result = run([{ ...scope, options }]);
  assert.match(form.render(80).join("\n"), /Number then Enter/);
  for (const key of ["1", "3"]) form.handleInput(key);
  assert.match(form.render(80).join("\n"), /No item 13/);
  form.handleInput("\r");
  assert.match(form.render(80).join("\n"), /Choose one/);
  for (const key of ["1", "0"]) form.handleInput(key);
  assert.match(form.render(80).join("\n"), /→ 10\. ○ Option 10/);
  form.handleInput("\r");
  assert.equal((await result).details.answers[0].values[0].value, "10");
});

test("going back before review preserves prior answers and checklist selections", async () => {
  const followUp = { ...scope, id: "verification", prompt: "What should be verified?", multiSelect: true };
  const steps = [
    [/What should change/, /Application/],
    [/What should be verified/, /\[ \] Tests/],
    [/What should be verified/, /Done$/],
    [/What should be verified/, /\[ \] Application/],
    [/What should be verified/, /Previous question$/],
    [/What should change/, /^2\. Tests$/],
    [/What should be verified/, /Done$/],
    [/Review your answers/, /Submit answers$/],
  ];
  let inputCount = 0;
  const run = setup("rpc", {
    async select(title, options) {
      const [expectedTitle, expectedOption] = steps.shift();
      assert.match(title, expectedTitle);
      if (title.includes("What should change") && options.length === 4) {
        assert.match(options[3], /Keep current answer — Application$/);
      }
      if (title === "Review your answers") {
        assert.match(options[0], /What should change\? — Tests$/);
        assert.match(options[1], /Application, Tests$/);
      }
      const choice = options.find((option) => expectedOption.test(option));
      assert.ok(choice, options.join("\n"));
      if (/Done$|Submit answers$/.test(choice)) assert.ok(choice.startsWith("\n"), choice);
      return choice.trimStart();
    },
    async input(title) {
      assert.match(title, /return to the previous question/);
      return ++inputCount === 1 ? undefined : "Add a summary";
    },
  });
  const { details } = await run([scope, followUp, note]);
  assert.equal(steps.length, 0);
  assert.deepEqual(details.answers.map(({ values }) => values.map(({ value }) => value)), [
    ["tests"], ["app", "tests"], ["Add a summary"],
  ]);
});

test("cancelling the review returns no answers and noninteractive modes open no UI", async () => {
  const run = setup("rpc", {
    async select(title, options) { return title === "Review your answers" ? undefined : options[0]; },
    async input() { return "A draft"; },
  });
  const result = await run([scope, note]);
  assert.deepEqual(result.details.answers, []);
  assert.equal(result.details.reason, "dismissed");
  for (const mode of ["json", "print"]) {
    const headless = await setup(mode, undefined)([scope]);
    assert.equal(headless.details.reason, "unavailable");
    assert.match(headless.content[0].text, /Ask in plain text/);
  }
});

test("invalid duplicate IDs or values fail before displaying a dialog", async () => {
  const run = setup("rpc");
  await assert.rejects(run([scope, scope]), /repeats an ID/);
  await assert.rejects(run([{ ...scope, options: [scope.options[0], scope.options[0]] }]), /repeats an option value/);
});

test("tool call renders a single prompt or a bounded preview of batch topics", () => {
  const tool = registerQuestionTool();
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  const render = (questions, isPartial = false) => tool.renderCall({ questions }, theme, { outputPad: 2, isPartial });
  const verification = { ...scope, label: "Verification" };
  assert.deepEqual(render([scope]).render(80).map((line) => line.trimEnd()), [
    "", "  Question · What should change?",
  ]);
  const batch = render([scope, verification, note]);
  assert.deepEqual(batch.render(80).map((line) => line.trimEnd()), ["", "  Questions (3) · Scope, Verification +1"]);
  assert.ok(batch.render(24).every((line) => visibleWidth(line) <= 24));
  assert.deepEqual(render([null], true).render(80).map((line) => line.trimEnd()), ["", "  Question", ""]);
});

test("tool result previews decisions and expands to complete prompts and written answers", () => {
  const tool = registerQuestionTool();
  const paints = [];
  const theme = {
    fg(color, text) { paints.push([color, text]); return text; },
    bg(color, text) { paints.push([color, text]); return text; },
    bold(text) { paints.push(["bold", text]); return text; },
  };
  const answer = (label, wasCustom = false) => ({ label, wasCustom, value: "structured-value" });
  const details = {
    cancelled: false,
    questions: [
      scope,
      { id: "test", label: "Verification", prompt: "What should we run?" },
      { ...note, label: "Note" },
      { id: "delivery", label: "Delivery", prompt: "When should we deliver?" },
    ],
    answers: [
      { id: "scope", values: [answer("Application")] },
      { id: "test", values: [answer("Unit tests"), answer("Integration tests")] },
      { id: "note", values: [answer("First line\nSecond line", true)] },
      { id: "delivery", values: [answer("Today")] },
    ],
  };
  const result = { content: [{ type: "text", text: "structured-value" }], details };
  const context = {
    isError: false,
    outputPad: 0,
    keyHint(binding, description) {
      assert.equal(binding, "app.tools.expand");
      return `ctrl+o ${description}`;
    },
  };
  const collapsed = tool.renderResult(result, { expanded: false }, theme, context);
  const preview = collapsed.render(80).map((line) => line.trimEnd());
  assert.deepEqual(preview, [
    "", "✓ Scope → Application",
    "  Verification → Unit tests, Integration tests",
    "  Note → First line Second line",
    "", "  +1 more · ctrl+o expand", "",
  ]);
  const expanded = tool.renderResult(result, { expanded: true }, theme, context);
  const full = expanded.render(80).map((line) => line.trimEnd());
  assert.deepEqual(full, [
    "What should change?", "  • Application", "",
    "What should we run?", "  • Unit tests", "  • Integration tests", "",
    "Any other detail?", "  Written answer", "    First line", "    Second line", "",
    "When should we deliver?", "  • Today", "",
  ]);
  assert.ok(paints.some(([style, text]) => style === "mdLink" && text === scope.prompt));
  assert.ok(paints.some(([style, text]) => style === "bold" && text === scope.prompt));
  assert.equal(paints.filter(([style]) => style === "toolPendingBg").length, preview.length + full.length);
  assert.ok([...collapsed.render(18), ...expanded.render(18)].every((line) => visibleWidth(line) <= 18));
});

test("tool result distinguishes cancellation, interruption, and failed execution", () => {
  const tool = registerQuestionTool();
  const colors = [];
  const theme = { fg: (_color, text) => text, bg: (color, text) => { colors.push(color); return text; } };
  const content = [{ type: "text", text: "Repeated option value" }];
  const render = (details, isError = false) => tool.renderResult(
    { content, details }, { expanded: false }, theme, { isError, outputPad: 0 },
  ).render(80).map((line) => line.trimEnd());
  assert.deepEqual(render({ cancelled: true }), ["Cancelled", ""]);
  assert.deepEqual(render({ cancelled: true, reason: "aborted" }, true), ["Interrupted", ""]);
  assert.deepEqual(render(undefined, true), ["✗ Failed", "Repeated option value", ""]);
  assert.deepEqual(render(undefined), ["Repeated option value", ""]);
  assert.deepEqual(colors, [
    "toolPendingBg", "toolPendingBg",
    "toolPendingBg", "toolPendingBg",
    "toolErrorBg", "toolErrorBg", "toolErrorBg",
    "toolPendingBg", "toolPendingBg",
  ]);
});
