import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

async function setup(t: test.TestContext, mode = "tui") {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const bus = new EventEmitter();
  const endpoints: any[] = [];
  bus.on("message-listener:changed", value => endpoints.push(value));
  const messages: any[] = [];
  const customMessages: any[] = [];
  const renderers = new Map<string, Function>();
  const statuses = new Map<string, string>();
  const notices: string[] = [];
  const ctx = { mode, sessionManager: { getSessionId: () => "current-session" }, ui: { setStatus: (key: string, value: string) => statuses.set(key, value), notify: (value: string) => notices.push(value) } } as unknown as ExtensionContext;
  extension({
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerMessageRenderer: (name: string, renderer: Function) => renderers.set(name, renderer),
    sendMessage: (message: any, options: any) => customMessages.push({ message, options }),
    events: { on: (name: string, handler: (...args: any[]) => void) => { bus.on(name, handler); return () => bus.off(name, handler); }, emit: (name: string, value: any) => bus.emit(name, value) },
    sendUserMessage: (content: string, options: any) => messages.push({ content, options }),
  } as unknown as ExtensionAPI);
  const fire = (name: string) => handlers.get(name)?.({}, ctx);
  t.after(() => fire("session_shutdown"));
  await fire("session_start");
  return { endpoints, messages, customMessages, renderers, statuses, notices, fire, command: (args: string) => commands.get("listen").handler(args, ctx), bus };
}
function send(path: string, message: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let output = "";
    socket.on("error", reject);
    socket.on("connect", () => socket.end(JSON.stringify(message) + "\n"));
    socket.on("data", chunk => output += chunk);
    socket.on("end", () => resolve(JSON.parse(output)));
  });
}

test("TUI startup advertises v2 socket, delivers opaque content unchanged and /listen closes it", async t => {
  const h = await setup(t);
  const endpoint = h.endpoints.at(-1);
  assert.equal(endpoint.protocol, "pi-listener-v2");
  assert.match(h.statuses.get("message-listener")!, /listening/);
  const content = "  Arbitrary text\n{\"from\":\"literal, not metadata\"}\n/listen off  ";
  const ack = await send(endpoint.path, { version: 2, type: "message", id: "one", content, deliverAs: "steer" });
  assert.equal(ack.ok, true);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].content, content);
  assert.equal(ack.version, 2);
  assert.deepEqual(h.messages[0].options, { deliverAs: "steer", expandPromptTemplates: false });
  await h.command("");
  assert.equal(h.endpoints.at(-1), null);
  await assert.rejects(send(endpoint.path, {}));
  await h.command("on");
  assert.ok(h.endpoints.at(-1)?.path);
  const count = h.endpoints.length;
  h.bus.emit("message-listener:query");
  assert.equal(h.endpoints.length, count + 1);
  await h.fire("session_shutdown");
  assert.equal(h.endpoints.at(-1), null);
});

test("headless startup never opens a listener and rejects enabling it", async t => {
  const h = await setup(t, "json");
  assert.equal(h.endpoints.at(-1), null);
  await h.command("on");
  assert.equal(h.endpoints.at(-1), null);
  assert.equal(h.statuses.size, 0);
});

test("concurrent toggles and shutdown leave no advertised socket", async t => {
  const h = await setup(t);
  await Promise.all([h.command("off"), h.command("on"), h.fire("session_shutdown")]);
  assert.equal(h.endpoints.at(-1), null);
});

test("session-targeted delivery rejects another session before injection", async t => {
  const h = await setup(t);
  const endpoint = h.endpoints.at(-1);
  const ack = await send(endpoint.path, { version: 2, type: "message", id: "guarded", content: "task finished", expectedSessionId: "other-session" });
  assert.equal(ack.ok, false);
  assert.equal(h.messages.length, 0);
});

test("session-targeted delivery accepts the current session", async t => {
  const h = await setup(t);
  const ack = await send(h.endpoints.at(-1).path, { version: 2, type: "message", id: "matching-session", content: "task finished", expectedSessionId: "current-session" });
  assert.equal(ack.ok, true);
  assert.equal(h.messages.length, 1);
});

for (const deliverAs of ['steer', 'followUp']) {
  test(`agent XML uses a custom rendered message with ${deliverAs} delivery`, async t => {
    const h = await setup(t);
    const content = '<agent_message sender_id="agt_123" sender_name="Reviewer" sender_harness="pi" message_id="one">\n**Please review.**\n</agent_message>';
    const ack = await send(h.endpoints.at(-1).path, { version: 2, type: 'message', id: 'one', content, deliverAs });
    assert.equal(ack.ok, true);
    assert.equal(h.messages.length, 0);
    assert.deepEqual(h.customMessages, [{ message: { customType: 'agent-hub-message', content, display: true }, options: { deliverAs, triggerTurn: true } }]);
    assert.ok(h.renderers.has('agent-hub-message'));
  });
}

test('malformed agent XML remains ordinary user input', async t => {
  const h = await setup(t);
  const content = '<agent_message sender_name="Reviewer">\nhello\n</agent_message>';
  await send(h.endpoints.at(-1).path, { version: 2, type: 'message', id: 'one', content });
  assert.equal(h.customMessages.length, 0);
  assert.equal(h.messages[0].content, content);
});
