import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession, DefaultResourceLoader, initTheme, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { loadedSkillPaths } from "../extensions/loaded-skills/state.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const viewers = ["readmd", "system-prompt", "loaded-skills"];
const messageEntry = (message) => ({ type: "message", message });

test("Pi reload switches all three commands between their own viewers and the optional pager", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-v2-viewers-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const agentDir = join(cwd, "agent");
  const skillDir = join(cwd, "example");
  await mkdir(skillDir);
  const skillPath = join(skillDir, "SKILL.md");
  await writeFile(skillPath, "abcdabcd");

  const select = (names) => [{ source: packageRoot, extensions: names.map((name) => `extensions/${name}/index.ts`) }];
  const settingsManager = SettingsManager.inMemory({ packages: select(viewers) });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true,
    appendSystemPrompt: ["Example addendum text."],
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage({
    role: "user", timestamp: 0,
    content: `<skill name="example" location="${skillPath}">\nSkill body\n</skill>`,
  });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = { role: "assistant", timestamp: 1, api: "openai-completions", provider: "openai",
    model: "test", stopReason: "stop", usage };
  sessionManager.appendMessage({ ...assistant, content: [
    { type: "text", text: Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}. 文字`).join("\n\n") },
    { type: "thinking", thinking: "Hidden reasoning" },
  ] });
  sessionManager.appendMessage({ ...assistant, timestamp: 2, content: [{ type: "thinking", thinking: "Later reasoning" }] });

  const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager, noTools: "all" });
  t.after(() => session.dispose());
  initTheme("dark");

  const views = [];
  const dialogs = [];
  const statuses = new Map();
  const failures = [];
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const terminal = { rows: 18 };
  const uiContext = {
    theme,
    setStatus: (key, value) => statuses.set(key, value),
    notify: (message) => failures.push(message),
    editor: async (title, prefill) => { dialogs.push({ title, prefill }); return "discard this edit"; },
    custom: (factory) => new Promise((resolve, reject) => {
      const component = factory({ terminal, requestRender() {} }, theme, undefined, resolve);
      try {
        const render = (width) => component.render(width).map(stripTerminalSequences);
        const initial = render(100);
        component.handleInput("\x1b[F");
        const end = render(100);
        component.handleInput("g");
        component.handleInput("g");
        const afterGg = render(100);
        const narrow = render(3);
        terminal.rows = 3;
        const short = render(100);
        terminal.rows = 18;
        views.push({ initial, end, afterGg, narrow, short });
        component.handleInput("\x1b");
      } catch (error) {
        reject(error);
      }
    }),
  };
  await session.bindExtensions({ mode: "tui", uiContext, onError: (error) => failures.push(error) });
  assert.equal(statuses.get("loaded-skills"), "skills: example");

  const commands = ["/readmd", "/system-prompt append", "/loaded-skills"];
  for (const shared of [false, true, false]) {
    settingsManager.setPackages(select(shared ? [...viewers, "pager"] : viewers));
    await session.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    assert.equal(resourceLoader.getExtensions().extensions.some(({ path }) => path.endsWith("/pager/index.ts")), shared);
    for (const command of commands) await session.prompt(command);
    const [readmd, system, skills] = views.splice(0);
    assert.match(readmd.initial.join("\n"), /Paragraph 1\./);
    assert.match(readmd.end.join("\n"), /Paragraph 30\./);
    assert.deepEqual(readmd.afterGg, shared ? readmd.initial : readmd.end);
    assert.match(system.initial.join("\n"), /Example addendum text\./);
    assert.match(skills.initial.join("\n"), /example: ~2 tokens/);
    for (const view of [readmd, system, skills]) {
      if (shared) {
        assert.equal(view.initial[0], `┌${"─".repeat(98)}┐`);
        assert.equal(view.initial.at(-1), `└${"─".repeat(98)}┘`);
        assert.match(view.initial.at(-2), /^│ Lines /);
        assert.ok(view.initial.slice(1, -1).every((line) => line.startsWith("│ ") && line.endsWith(" │")));
        assert.ok(view.initial.every((line) => visibleWidth(line) === 100));
      } else {
        assert.ok(!view.initial[0].startsWith("┌"));
        assert.ok(!view.initial.at(-1).startsWith("Lines "));
      }
      assert.ok(!view.narrow[0].startsWith("┌"));
      assert.ok(view.narrow.every((line) => visibleWidth(line) <= 3));
      assert.ok(!view.short[0].startsWith("┌"));
      assert.ok(view.short.length <= 3);
    }
  }

  session.extensionRunner.setUIContext(uiContext, "rpc");
  await session.prompt("/system-prompt");
  await session.prompt("/readmd");
  assert.equal(views.length, 0);
  assert.match(dialogs[0].title, /^System Prompt/);
  assert.equal(dialogs[0].prefill, session.systemPrompt);
  assert.match(dialogs[1].prefill, /Paragraph 30\./);
  assert.doesNotMatch(dialogs[1].prefill, /reasoning/);
  assert.deepEqual(failures, []);
});

test("loaded skill history counts successful reads and slash invocations on the supplied branch", () => {
  const read = (id, path) => ({ type: "toolCall", name: "read", id, arguments: { path } });
  const entries = [
    messageEntry({ role: "assistant", content: [read("ok", "alpha/SKILL.md"), read("failed", "beta/SKILL.md")] }),
    messageEntry({ role: "toolResult", toolCallId: "ok", isError: false }),
    messageEntry({ role: "toolResult", toolCallId: "failed", isError: true }),
    messageEntry({ role: "toolResult", isError: true, nestedCalls: { calls: [
      { status: "ok", name: "read", arguments: { path: "skills/charlie.md" } },
      { status: "unfinished", name: "read", arguments: { path: "delta/SKILL.md" } },
    ] } }),
  ];
  const pending = { role: "user", content: '<skill name="echo" location="echo/SKILL.md">\nBody\n</skill>' };
  assert.deepEqual([...loadedSkillPaths(entries, pending)], [
    ["alpha", "alpha/SKILL.md"], ["charlie", "skills/charlie.md"], ["echo", "echo/SKILL.md"],
  ]);
  assert.deepEqual([...loadedSkillPaths(entries.slice(0, 2))], [["alpha", "alpha/SKILL.md"]]);
});
