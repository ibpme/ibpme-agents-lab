import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import copyCommandExtension, { copyCommand } from "../extensions/copy-command/index.ts";
import { commandReplies } from "../extensions/copy-command/history.ts";
import { registerExtension } from "./extension-fixture.mjs";

const entry = (role, content) => ({ type: "message", message: { role, content } });
const assistant = (text) => entry("assistant", [{ type: "text", text }]);
const fence = (body, language = "sh") => `\`\`\`${language}\n${body}\n\`\`\``;
const multiline = "cat <<'EOF'\n\tvalue  \nEOF";
const branch = [
  assistant(fence("printf older")),
  entry("user", fence("printf user")),
  assistant([fence("printf first"), fence(multiline)].join("\n\n")),
  entry("assistant", [{ type: "thinking", thinking: fence("printf hidden") }]),
  assistant("No commands in this reply."),
];

function setup(mode, entries = branch) {
  const notifications = [];
  const copied = [];
  const dialogs = [];
  let registered;
  registerExtension(copyCommandExtension, {
    registerCommand(name, options) {
      assert.equal(name, "copy-command");
      registered = options.handler;
    },
  });
  const ctx = {
    mode,
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      editor: async (title, text) => { dialogs.push({ title, text }); return "discarded edit"; },
      select: () => assert.fail("unexpected selection dialog"),
      custom: () => assert.fail("unexpected terminal picker"),
    },
  };
  return {
    ctx, notifications, copied, dialogs,
    run: (args = "") => mode === "tui"
      ? copyCommand(args, ctx, async (text) => { copied.push(text); })
      : registered(args, ctx),
  };
}

test("extracts closed shell fences in branch order and preserves the code body", () => {
  const body = `\n${multiline}\n  `;
  const source = [
    "```markdown\n~~~bash\nignored nested example\n~~~\n```",
    "```BASH title\n" + body + "\n````",
    "> ~~~console\n> $ printf nested\n> result\n> ~~~~",
    "~~~shell\n  \n~~~",
    "```zsh\nunfinished\n    ```",
  ].join("\n\n").replaceAll("\n", "\r\n");

  assert.deepEqual(commandReplies([assistant(source), entry("user", fence("printf ignored"))]), [
    { repliesBack: 0, blocks: [body, "$ printf nested\nresult"] },
  ]);
  assert.deepEqual(commandReplies(branch), [
    { repliesBack: 1, blocks: ["printf first", multiline] },
    { repliesBack: 2, blocks: ["printf older"] },
  ]);
});

test("numbered TUI copy uses the newest reply with commands and reports clipboard failure", async () => {
  const h = setup("tui");
  await h.run(" 2 ");
  assert.deepEqual(h.copied, [multiline]);
  assert.equal(h.notifications.at(-1).level, "info");
  assert.deepEqual(h.dialogs, []);

  await copyCommand("2", h.ctx, async () => { throw new Error("Clipboard unavailable"); });
  assert.deepEqual(h.notifications.at(-1), { level: "error", message: "Clipboard unavailable" });
});

test("invalid numbers and empty history do not open a picker or copy anything", async () => {
  const h = setup("tui");
  for (const args of ["0", "1.5", "01", "9007199254740992", "3"]) await h.run(args);
  assert.deepEqual(h.notifications.map(({ level }) => level), Array(5).fill("error"));
  assert.match(h.notifications.at(-1).message, /1 to 2 in 1 reply back/);
  assert.deepEqual(h.copied, []);

  const empty = setup("tui", []);
  await empty.run();
  assert.match(empty.notifications[0].message, /No fenced shell commands/);
  assert.deepEqual(empty.copied, []);
});

for (const [older, newer] of [["h", "l"], ["\x1b[D", "\x1b[C"]]) {
  test(`TUI reply navigation remembers the selected block for ${JSON.stringify([older, newer])}`, async () => {
    const h = setup("tui");
    h.ctx.ui.custom = (factory) => new Promise((resolve) => {
      const tui = { terminal: { rows: 24 }, requestRender() {} };
      const component = factory(tui, { fg: (_color, text) => text }, undefined, resolve);
      const render = () => component.render(80).map(stripTerminalSequences).join("\n");
      component.handleInput(newer);
      assert.match(render(), /1 reply back/);
      component.handleInput("\x1b[B");
      component.handleInput(older);
      assert.match(render(), /2 replies back/);
      component.handleInput(older);
      assert.match(render(), /2 replies back/);
      component.handleInput(newer);
      assert.match(render(), /→ 2\. cat <<'EOF' \(3 lines\)/);
      component.handleInput("\r");
    });
    await h.run();
    assert.deepEqual(h.copied, [multiline]);
  });
}

test("Escape and Ctrl+C cancel the TUI picker without touching the clipboard", async () => {
  for (const key of ["\x1b", "\x03"]) {
    const h = setup("tui");
    h.ctx.ui.custom = (factory) => new Promise((resolve) => {
      const tui = { terminal: { rows: 24 }, requestRender() {} };
      factory(tui, { fg: (_color, text) => text }, undefined, resolve).handleInput(key);
    });
    await h.run();
    assert.deepEqual(h.copied, []);
    assert.deepEqual(h.notifications, []);
  }
});

test("RPC browses replies and delivers selected or numbered blocks to the client", async () => {
  const h = setup("rpc");
  const choices = ["← Older reply", "→ Newer reply", "2. cat <<'EOF' (3 lines)"];
  h.ctx.ui.select = async (title, options) => {
    assert.match(title, choices.length === 2 ? /2 replies back/ : /1 reply back/);
    const choice = choices.shift();
    assert.ok(options.includes(choice));
    return choice;
  };
  await h.run();
  assert.deepEqual(choices, []);
  h.ctx.ui.select = () => assert.fail("numbered selection must skip the picker");
  await h.run("1");
  assert.deepEqual(h.dialogs.map(({ text }) => text), [multiline, "printf first"]);
  assert.deepEqual(h.notifications, []);
  await copyCommand("2", h.ctx, async () => assert.fail("RPC must not write the host clipboard"));
  assert.equal(h.dialogs.at(-1).text, multiline);
});

test("RPC cancellation and non-interactive modes leave the clipboard and editor untouched", async () => {
  const h = setup("rpc");
  h.ctx.ui.select = async () => undefined;
  await h.run();
  assert.deepEqual(h.dialogs, []);
  for (const [mode, hasUI] of [["print", true], ["json", true], ["tui", false], ["rpc", false]]) {
    await copyCommand("1", {
      mode, hasUI,
      get sessionManager() { assert.fail("non-interactive invocation must not scan history"); },
      get ui() { assert.fail("non-interactive invocation must not touch UI"); },
    });
  }
});
