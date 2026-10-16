import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import extension, { resolveAgentToolRenderer } from "./index.ts";

type Call = NonNullable<ToolRenderers["renderCall"]>;
type Result = NonNullable<ToolRenderers["renderResult"]>;
const theme = { fg: (tone: string, text: string) => text } as Parameters<Call>[1];
const context = (expanded = false, isError = false) => ({ expanded, isError }) as Parameters<Call>[2];
function tool(name: string): ToolRenderers {
  return resolveAgentToolRenderer(`mcp__agent_hub__${name}`, () => undefined)!;
}
function result(name: string, data: unknown, expanded = false): string {
  const output = {
    content: [{ type: "text", text: JSON.stringify(data) }],
    details: { server: "agent-hub", tool: name },
  } as Parameters<Result>[0];
  return tool(name).renderResult!(output, { expanded, isPartial: false }, theme, context(expanded)).render(120).join("\n");
}

test("registers a renderer resolver without replacing tools or execution", () => {
  let resolver: unknown;
  extension({ registerToolRenderer: value => { resolver = value; } } as ExtensionAPI);
  assert.equal(resolver, resolveAgentToolRenderer);
  let delegated = 0;
  const fallback = {};
  for (const name of ["bash", "mcp__other__list_agents", "mcp__agent_hub__unknown", "list_agents"]) {
    assert.equal(resolveAgentToolRenderer(name, () => { delegated++; return fallback; }), fallback);
  }
  assert.equal(delegated, 4);
  assert.ok(resolveAgentToolRenderer("mcp__agents__send_message", () => undefined)?.renderCall);
});

test("all five tools have compact titles and expandable full arguments", () => {
  const cases = [
    ["list_agents", "Live agents"], ["send_message", "Send message"],
    ["spawn_agent", "Spawn agent"], ["list_agent_tasks", "Agent tasks"], ["agent_task", "Agent task"],
  ];
  const args = { agent_id: "agt_one", message: "Hello\n" + "message ".repeat(100), routing_hint: "Use a reviewer", action: "check", task_id: "task_1" };
  for (const [name, title] of cases) {
    const renderer = tool(name!).renderCall!;
    const compact = renderer(args, theme, context()).render(80).join("\n");
    assert.ok(compact.includes(title!));
    assert.ok(compact.split("\n").length <= 2);
    assert.doesNotMatch(compact, /routing_hint/);
    const expanded = renderer(args, theme, context(true)).render(120).join("\n");
    assert.match(expanded, /Arguments/);
    assert.match(expanded, /routing_hint/);
    assert.match(expanded, /Use a reviewer/);
    assert.ok(expanded.length > compact.length);
  }
});

test("live-agent results show identity, self, activity and readiness with bounded previews", () => {
  const agents = Array.from({ length: 8 }, (_, i) => ({ agent_id: `agt_${i}`, name: `Reviewer ${i}`, activity: "idle", can_receive_messages: i === 0, cwd: "/code", session_id: `session_${i}` }));
  const data = { self_agent_id: "agt_0", agents };
  const compact = result("list_agents", data);
  assert.match(compact, /8 live agents/);
  assert.match(compact, /Reviewer 0 \(you\) · idle · listening/);
  assert.match(compact, /Reviewer 1 · idle · not ready/);
  assert.match(compact, /\+4 more agents/);
  assert.doesNotMatch(compact, /session_7/);
  const expanded = result("list_agents", data, true);
  assert.match(expanded, /session_7/);
  assert.match(result("list_agents", { agents: [] }), /0 live agents/);
});

test("send-message results distinguish queued from answered", () => {
  const compact = result("send_message", { status: "accepted", agent_id: "agt_two", message_id: "message_one" });
  assert.match(compact, /Queued \(not yet answered\) → agt_two/);
  assert.doesNotMatch(compact, /message_one/);
  assert.match(result("send_message", { status: "accepted", message_id: "message_one" }, true), /message_one/);
});

test("task tools show lifecycle, messaging and answer previews, retaining all details on expansion", () => {
  const task = { task_id: "task_1", agent_id: "agt_two", status: "completed", process_state: "available", can_receive_messages: true, answer: { text: "A complete answer\nwith details", status: "completed" }, execution: { model: "model_one" } };
  for (const name of ["spawn_agent", "agent_task"]) {
    const compact = result(name, task);
    assert.match(compact, /task_1 · completed · agt_two/);
    assert.match(compact, /Messaging: ready · Process: available/);
    assert.match(compact, /Answer: A complete answer with details/);
    assert.doesNotMatch(compact, /model_one/);
    assert.match(result(name, task, true), /model_one/);
  }
  assert.match(result("list_agent_tasks", { tasks: [task] }), /1 task/);
  assert.match(result("list_agent_tasks", { tasks: [] }), /0 tasks/);
  assert.match(result("list_agent_tasks", { tasks: Array(6).fill(task) }), /\+2 more tasks/);
  assert.match(result("agent_task", { ...task, delivery_error: "Listener unavailable" }), /Listener unavailable/);
});

test("handles text results, partial updates, transport errors and non-text content", () => {
  const renderer = tool("agent_task").renderResult!;
  const render = (output: Parameters<Result>[0], expanded = false, isPartial = false, isError = false) =>
    renderer(output, { expanded, isPartial }, theme, context(expanded, isError)).render(120).join("\n");
  const legacy = { content: [{ type: "text", text: '{"task_id":"legacy","status":"running"}' }], details: undefined } as Parameters<Result>[0];
  assert.match(render(legacy), /legacy · running/);
  assert.match(render({ content: [], details: undefined }, false, true), /Working…/);
  const error = { content: [{ type: "text", text: "Socket disconnected\nTry again" }], details: undefined } as Parameters<Result>[0];
  assert.match(render(error, false, false, true), /Tool failed/);
  assert.match(render(error, true, false, true), /Try again/);
  assert.match(result("send_message", { error: { code: "NOT_FOUND", message: "No such agent" } }), /NOT_FOUND · No such agent/);
  assert.match(render({ content: [{ type: "image", data: "", mimeType: "image/png" }], details: { fullOutputPath: "/tmp/full.txt" } }, true), /\[image content\][\s\S]*Full output: \/tmp\/full.txt/);
  assert.match(render({ content: [{ type: "text", text: "null" }], details: undefined }), /null/);
});

test("fits narrow terminals, strips terminal controls and supports invalidation and resize", () => {
  const args = { agent_id: "界😀\x1b[31mred\x1b[0m\x07", message: "hello\nworld\x1b]0;title\x07" };
  for (const expanded of [false, true]) {
    const components = [
      tool("send_message").renderCall!(args, theme, context(expanded)),
      tool("send_message").renderResult!({ content: [{ type: "text", text: "界😀\x1b[31mred\x1b[0m\x07\nnext" }], details: undefined }, { expanded, isPartial: false }, theme, context(expanded)),
    ];
    for (const component of components) {
      for (const width of [0, 1, 2, 3, 8, 30, 80]) {
        component.invalidate();
        for (const line of component.render(width)) {
          assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
          assert.doesNotMatch(stripVTControlCharacters(line), /[\x00-\x1f\x7f-\x9f]/);
          assert.doesNotMatch(line, /\x1b\[31m|\x1b\]0;title/);
        }
      }
    }
  }
});

test("uses a background-free shell and semantic colors for fields and expanded JSON", () => {
  const colors: Array<[string, string]> = [];
  const styled = {
    fg: (tone: string, text: string) => { colors.push([tone, text]); return text; },
    bg: (_color: string, _text: string): string => { throw new Error("Tool renderers must not apply backgrounds"); },
  } as Parameters<Call>[1];
  for (const name of ["list_agents", "send_message", "spawn_agent", "list_agent_tasks", "agent_task"]) {
    assert.equal(tool(name).renderShell, "self");
  }
  const ctx = { ...context(), outputPad: 2 };
  tool("send_message").renderCall!({ agent_id: "agt_one" }, styled, ctx).render(120);
  assert.ok(colors.some(([tone, text]) => tone === "toolTitle" && text === "Send message"));
  assert.ok(colors.some(([tone, text]) => tone === "accent" && text.includes("agt_one")));
  const data = { self_agent_id: "agt_one", agents: [
    { agent_id: "agt_one", name: "Reviewer", activity: "idle", can_receive_messages: true, cwd: "/code" },
    { agent_id: "agt_two", activity: "busy", can_receive_messages: false },
  ] };
  tool("list_agents").renderResult!({ content: [{ type: "text", text: JSON.stringify(data) }], details: undefined }, { expanded: false, isPartial: false }, styled, ctx).render(120);
  for (const [tone, text] of [["accent", "Reviewer"], ["success", "idle"], ["success", "listening"], ["warning", "busy"], ["warning", "not ready"], ["muted", "/code"], ["dim", " (you)"]]) {
    assert.ok(colors.some(([actualTone, actualText]) => actualTone === tone && actualText === text), `${tone}: ${text}`);
  }
  tool("agent_task").renderCall!({ task_id: "task_one", count: 1, ready: true, missing: null }, styled, { ...ctx, expanded: true }).render(120);
  for (const [tone, text] of [["accent", '"task_id"'], ["success", '"task_one"'], ["warning", "1"], ["warning", "true"], ["muted", "null"]]) {
    assert.ok(colors.some(([actualTone, actualText]) => actualTone === tone && actualText === text), `${tone}: ${text}`);
  }
  const colored = { fg: (_tone: string, text: string) => `\x1b[36m${text}\x1b[39m` } as Parameters<Call>[1];
  const component = tool("spawn_agent").renderCall!({ name: "界😀", cwd: "/a/long/path" }, colored, ctx);
  for (const width of [0, 1, 2, 4, 20, 80]) {
    component.invalidate();
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
  }
});
