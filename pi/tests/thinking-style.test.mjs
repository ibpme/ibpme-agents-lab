import assert from "node:assert/strict";
import test from "node:test";
import thinkingStyle from "../extensions/thinking-style/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

const pulse = { frames: ["[high]·", "[high]•", "[high]●", "[high]•"], intervalMs: 120 };

function setup(mode = "tui") {
	const indicators = [];
	const messages = [];
	const hiddenLabels = [];
	let markdown;
	const host = registerExtension(thinkingStyle, {
		getThinkingLevel: () => ctx.thinkingLevel,
		registerMarkdownTransformer(transformer, options) { markdown = { transformer, options }; },
	});
	const ctx = {
		mode,
		thinkingLevel: "high",
		ui: new Proxy({
			theme: { getThinkingBorderColor: (level) => (text) => `[${level}]${text}` },
			setWorkingIndicator: (options) => indicators.push(options),
			setWorkingMessage: (message) => messages.push(message),
			setHiddenThinkingLabel: (label) => hiddenLabels.push(label),
		}, {
			get(target, key) {
				assert.equal(mode, "tui", "non-TUI modes must not access UI methods");
				assert.ok(Object.hasOwn(target, key), `unexpected UI access: ${String(key)}`);
				return target[key];
			},
		}),
	};
	return {
		ctx, indicators, messages, hiddenLabels, markdown,
		fire: (name, event = {}) => host.fire(name, event, ctx),
		stream: (type, role = "assistant") => host.fire("message_update", {
			message: { role }, assistantMessageEvent: { type },
		}, ctx),
	};
}

test("thinking uses native pulse frames without restarting on every delta", async () => {
	const h = setup();
	await h.fire("session_start");
	await h.fire("turn_start");
	assert.deepEqual(h.indicators, [], "normal working retains Pi's default indicator");
	await h.stream("thinking_start");
	await h.stream("thinking_delta");
	await h.stream("thinking_delta");
	assert.deepEqual(h.indicators, [pulse]);
	assert.deepEqual(h.messages, ["Thinking"]);
	await h.stream("thinking_end");
	assert.deepEqual(h.indicators, [pulse, undefined]);
	assert.deepEqual(h.messages, ["Thinking", undefined]);
	await h.stream("text_start");
	await h.fire("turn_end");
	await h.fire("agent_settled");
	assert.deepEqual(h.indicators, [pulse, undefined], "already-reset indicator is left alone");
});

for (const event of ["thinking_end", "text_start", "text_delta", "toolcall_start", "toolcall_delta", "toolcall_end", "done", "error"]) {
	test(`${event} restores Pi's default working spinner`, async () => {
		const h = setup();
		await h.stream("thinking_delta");
		await h.stream(event);
		assert.deepEqual(h.indicators, [pulse, undefined]);
		assert.deepEqual(h.messages, ["Thinking", undefined]);
	});
}

for (const event of ["session_start", "turn_start", "turn_end", "agent_settled", "session_shutdown"]) {
	test(`${event} cleans up a thinking indicator even without thinking_end`, async () => {
		const h = setup();
		await h.stream("thinking_start");
		await h.fire(event);
		await h.fire(event);
		assert.deepEqual(h.indicators, [pulse, undefined]);
		assert.deepEqual(h.messages, ["Thinking", undefined]);
	});
}

test("assistant message completion resets the indicator, but other messages do not", async () => {
	const h = setup();
	await h.stream("thinking_start");
	await h.fire("message_end", { message: { role: "toolResult" } });
	assert.deepEqual(h.indicators, [pulse]);
	assert.deepEqual(h.messages, ["Thinking"]);
	await h.fire("message_end", { message: { role: "assistant" } });
	assert.deepEqual(h.indicators, [pulse, undefined]);
	assert.deepEqual(h.messages, ["Thinking", undefined]);
});

test("a later thinking block can pulse again within the same turn", async () => {
	const h = setup();
	await h.stream("thinking_start");
	await h.stream("text_start");
	await h.stream("thinking_start");
	await h.stream("thinking_end");
	assert.deepEqual(h.indicators, [pulse, undefined, pulse, undefined]);
	assert.deepEqual(h.messages, ["Thinking", undefined, "Thinking", undefined]);
});

test("normal working and non-assistant updates do not customize the spinner", async () => {
	const h = setup();
	for (const type of ["start", "text_start", "toolcall_start", "done"]) await h.stream(type);
	await h.stream("thinking_start", "user");
	assert.deepEqual(h.indicators, []);
	assert.deepEqual(h.messages, []);
});

for (const mode of ["rpc", "json", "print"]) {
	test(`${mode} does not access terminal UI methods`, async () => {
		const h = setup(mode);
		await h.fire("session_start");
		assert.deepEqual(h.hiddenLabels, []);
		await h.stream("thinking_start");
		await h.stream("thinking_delta");
		await h.stream("thinking_end");
		await h.fire("message_end", { message: { role: "assistant" } });
		await h.fire("agent_settled");
		await h.fire("session_shutdown");
		assert.deepEqual(h.indicators, []);
		assert.deepEqual(h.messages, []);
	});
}

test("Markdown transformation is scoped to thinking and preserves its blockquote styling", () => {
	const { markdown } = setup();
	assert.deepEqual(markdown.options, { messageTypes: ["assistant-thinking"] });
	assert.equal(markdown.transformer("Reasoning\n\n- item\n  detail\n"), "> Reasoning\n>\n> - item\n>   detail\n>");
	assert.equal(markdown.transformer(""), ">");
	assert.equal(markdown.transformer("  😀  "), ">   😀  ");
});

test("pulse frames use the current thinking border color while message text stays unstyled", async () => {
	const h = setup();
	await h.stream("thinking_start");
	assert.deepEqual(h.indicators, [pulse]);
	assert.deepEqual(h.messages, ["Thinking"]);
	await h.stream("thinking_end");
	h.ctx.thinkingLevel = "low";
	await h.stream("thinking_start");
	assert.deepEqual(h.indicators.at(-1), {
		frames: ["[low]·", "[low]•", "[low]●", "[low]•"],
		intervalMs: 120,
	});
	assert.equal(h.messages.at(-1), "Thinking");
});

test("session start globally labels collapsed thinking blocks Thought", async () => {
	const h = setup();
	await h.fire("session_start");
	assert.deepEqual(h.hiddenLabels, ["Thought"]);
	await h.stream("thinking_start");
	await h.stream("thinking_end");
	await h.fire("agent_settled");
	assert.deepEqual(h.hiddenLabels, ["Thought"], "thinking lifecycle leaves the fixed label unchanged");
	await h.fire("session_start");
	assert.deepEqual(h.hiddenLabels, ["Thought", "Thought"]);
});
