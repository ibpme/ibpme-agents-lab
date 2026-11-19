import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import statusLine from "../extensions/status-line/index.ts";
import contextUsage from "../extensions/context-usage/index.ts";
import { loadLayout } from "../extensions/status-line/config.ts";
import { alignRow, defaultLayout, parseLayout, renderLayout } from "../extensions/status-line/layout.ts";
import { registerExtension } from "./extension-fixture.mjs";

const usage = (input = 1000, cost = 0.01) => ({
	input, output: 200, cacheRead: 3000, cacheWrite: 0, totalTokens: input + 3200,
	cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

async function setup(t, options = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-v2-statusline-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	await mkdir(agentDir, { recursive: true });
	await mkdir(join(cwd, ".pi"), { recursive: true });
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	});
	const configPath = join(cwd, ".pi", "statusline.json");
	if (options.global) await writeFile(join(agentDir, "statusline.json"), JSON.stringify(options.global));
	if (options.layout) await writeFile(configPath, JSON.stringify(options.layout));
	if (options.rawProject) await writeFile(configPath, options.rawProject);
	const statuses = new Map();
		const notifications = [];
	const commands = new Map();
	const colors = [];
	let footer;
	let reads = 0;
	let repaints = 0;
	let subscriptions = 0;
	let branchCallback;
	const theme = options.theme ?? {
		fg: (color, text) => { colors.push(color); return text; },
		bold: (text) => text,
		getThinkingBorderColor: (level) => (text) => { colors.push(`thinking:${level}`); return text; },
	};
	const data = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => 2,
		onBranchChange: (callback) => {
			branchCallback = callback;
			subscriptions++;
			return () => { subscriptions--; branchCallback = undefined; };
		},
	};
	const tui = { requestRender: () => { repaints++; } };
	const settings = { compaction: { enabled: true } };
	const entries = [{ type: "message", id: "a", message: {
		role: "assistant", timestamp: 1, usage: usage(), provider: "test", model: "model", content: [],
	} }];
	let leaf = "a";
	const sessionManager = {
		getCwd: () => cwd,
		getSessionName: () => "session",
		getSessionId: () => "session-1",
		getLeafId: () => leaf,
		getBranch: () => { reads++; return [...entries]; },
		getEntries: () => assert.fail("footer must not scan all session entries"),
		getEntryCount: () => entries.length,
		buildSessionProjection: () => ({ messages: entries.filter((entry) => entry.type === "message").map((entry) => entry.message) }),
	};
	const ctx = {
		mode: options.mode ?? "tui", cwd, sessionManager, thinkingLevel: "high",
		model: { provider: "test", id: "model", reasoning: true, contextWindow: 200000 },
		modelRegistry: { isUsingOAuth: () => false },
		isProjectTrusted: () => options.trusted !== false,
		getContextUsage: () => assert.fail("context-usage is owned by its producer, not the footer"),
		ui: new Proxy({
			theme,
			setStatus: (key, text) => {
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
				repaints++;
			},
			setFooter: (factory) => {
				footer?.dispose();
				footer = factory?.(tui, theme, data);
			},
			notify: (message, level) => notifications.push({ message, level }),
		}, {
			get(target, key) {
				assert.equal(ctx.mode, "tui", "non-TUI modes must not touch UI");
				assert.ok(Object.hasOwn(target, key), `unexpected UI access: ${String(key)}`);
				return target[key];
			},
		}),
	};
	const host = registerExtension(statusLine, {
		getSettings: () => settings,
		getThinkingLevel: () => ctx.thinkingLevel,
		registerCommand: (name, command) => commands.set(name, command),
	});
	return {
		ctx, statuses, notifications, entries, colors, settings, configPath, data,
		get reads() { return reads; }, get subscriptions() { return subscriptions; },
		get repaints() { return repaints; }, get footer() { return footer; },
		setLeaf: (id) => { leaf = id; }, branchChanged: () => branchCallback?.(),
		fire: (event) => host.fire(event, {}, ctx),
		command: (args = "") => commands.get("statusline").handler(args, ctx),
	};
}

test("default composition follows the old location, usage, model, and optional status style", async (t) => {
	const h = await setup(t);
	h.statuses.set("agent-stats", "ACTIVITY");
	h.statuses.set("ssh", "remote");
	h.statuses.set("openai-fast", "fast");
	h.statuses.set("a", "other");
	await h.fire("session_start");
	const lines = h.footer.render(240);
	assert.equal(lines[0], `${h.ctx.cwd} on ⎇ main remote • session`);
	assert.match(lines[1], /^↑1\.0k ↓200 R3\.0k · ACTIVITY · \$0\.010 +test\/model • high • fast$/);
	assert.equal(lines[2], "other");
	assert.ok(h.colors.includes("accent"));
	assert.ok(h.colors.includes("success"));
	assert.ok(h.colors.includes("thinking:high"));
	await h.fire("session_shutdown");
});

test("custom layouts can move or omit any built-in segment without forced rows", async (t) => {
	const h = await setup(t, { layout: {
		footer: [{ left: ["model", "status:custom"], right: ["cwd"], separator: " / " }],
	} });
	h.statuses.set("custom", "CUSTOM");
	h.statuses.set("not-placed", "OMITTED");
	await h.fire("session_start");
	const lines = h.footer.render(120);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /^test\/model \/ CUSTOM +/);
	assert.ok(lines[0].endsWith(h.ctx.cwd));
	assert.doesNotMatch(lines[0], /OMITTED|↑|\$|high|main/);
	assert.equal(h.reads, 0, "unselected usage segments never scan history");
	await writeFile(h.configPath, JSON.stringify({ footer: [] }));
	await h.command("reload");
	assert.deepEqual(h.footer.render(120), []);
	await h.fire("session_shutdown");
});

test("status-only layout has no mandatory location, model, or usage rows", async (t) => {
	const h = await setup(t, { layout: { footer: [{ left: ["status:*"] }] } });
	h.statuses.set("z", "Z");
	h.statuses.set("a", "A");
	await h.fire("session_start");
	assert.deepEqual(h.footer.render(80), ["A Z"]);
	assert.equal(h.reads, 0);
	await h.fire("session_shutdown");
});

test("latest-assistant tokens and branch assistant cost retain old semantics and are cached", async (t) => {
	const h = await setup(t);
	h.entries.push(
		{ type: "message", message: { role: "assistant", usage: usage(2000, 0.02) } },
		{ type: "usage", usage: usage(9000, 1) },
		{ type: "message", message: { role: "toolResult", usage: usage(9000, 1) } },
	);
	await h.fire("session_start");
	assert.match(h.footer.render(240)[1], /↑2\.0k .*\$0\.030/);
	for (let i = 0; i < 20; i++) { h.footer.invalidate(); h.footer.render(240); }
	assert.equal(h.reads, 1);
	h.statuses.set("live", "updated");
	h.footer.render(240);
	assert.equal(h.reads, 1);
	h.setLeaf("new-leaf");
	h.footer.render(240);
	assert.equal(h.reads, 2);
	for (const event of ["message_end", "session_tree", "session_compact", "model_select", "turn_end"]) {
		await h.fire(event);
		h.footer.render(240);
	}
	assert.equal(h.reads, 7);
	await h.fire("session_shutdown");
});

test("branch navigation replaces usage snapshot rather than accumulating it", async (t) => {
	const h = await setup(t);
	await h.fire("session_start");
	assert.match(h.footer.render(200)[1], /\$0\.010/);
	h.entries.splice(0, h.entries.length, { type: "message", message: { role: "assistant", usage: usage(500, 0.05) } });
	h.setLeaf("other-branch");
	await h.fire("session_tree");
	assert.match(h.footer.render(200)[1], /↑500 .*\$0\.050/);
	await h.fire("session_shutdown");
});

test("toggle, reload, and shutdown dispose Git subscriptions without touching widgets or statuses", async (t) => {
	const h = await setup(t);
	h.statuses.set("other-extension", "unchanged");
	await h.fire("session_start");
	assert.equal(h.subscriptions, 1);
	h.branchChanged();
	assert.equal(h.repaints, 1);
	await h.command();
	assert.equal(h.footer, undefined);
	assert.equal(h.subscriptions, 0);
	await h.command();
	assert.equal(h.subscriptions, 1);
	await h.command("reload");
	assert.equal(h.subscriptions, 1);
	await h.fire("session_shutdown");
	await h.fire("session_shutdown");
	assert.equal(h.subscriptions, 0);
	assert.deepEqual([...h.statuses], [["other-extension", "unchanged"]]);
	const before = h.repaints;
	await h.fire("message_end");
	assert.equal(h.repaints, before);
});

test("trusted project layout replaces global layout; untrusted projects use global only", async (t) => {
	const h = await setup(t, {
		global: { footer: [{ left: ["model"] }] },
		layout: { footer: [{ left: ["cwd"] }] },
	});
	await h.fire("session_start");
	assert.deepEqual(h.footer.render(200), [h.ctx.cwd]);
	h.ctx.isProjectTrusted = () => false;
	await h.command("reload");
	assert.deepEqual(h.footer.render(200), ["test/model"]);
	await h.fire("session_shutdown");
});

test("malformed configuration warns and falls back without modifying files", async (t) => {
	const h = await setup(t, { rawProject: "{broken" });
	await h.fire("session_start");
	assert.equal(h.notifications[0].level, "warning");
	assert.match(h.notifications[0].message, /Invalid .*statusline\.json.*using default status layout/);
	assert.match(h.footer.render(200)[0], /on ⎇ main/);
	await h.command("unexpected");
	assert.match(h.notifications.at(-1).message, /Usage:/);
	assert.equal(await readFile(h.configPath, "utf8"), "{broken");
	await h.fire("session_shutdown");
});

for (const mode of ["rpc", "json", "print"]) {
	test(`${mode} never installs terminal UI or writes output`, async (t) => {
		const h = await setup(t, { mode });
		await h.fire("session_start");
		await h.command();
		await h.command("reload");
		await h.fire("message_end");
		await h.fire("session_shutdown");
		assert.equal(h.footer, undefined);
		assert.deepEqual(h.notifications, []);
	});
}

test("missing models, off thinking, and subscription markers follow the old segments", async (t) => {
	const h = await setup(t);
	h.ctx.modelRegistry.isUsingOAuth = () => true;
	await h.fire("session_start");
	assert.match(h.footer.render(200)[1], /\$0\.010 \(sub\)/);
	h.ctx.thinkingLevel = "off";
	assert.match(h.footer.render(200)[1], /test\/model • off$/);
	h.ctx.model = undefined;
	assert.match(h.footer.render(200)[1], /no-model$/);
	assert.doesNotMatch(h.footer.render(200)[1], /\(sub\)/);
	await h.fire("session_shutdown");
});

test("selectors preserve explicit order, wildcard exclusion, hidden keys, and independent separators", () => {
	const layout = parseLayout({ footer: [
		{ left: ["cwd", "status:*"], right: ["model", "thinking"], separator: " · ", rightSeparator: " • " },
		{ left: ["status:later", "status:missing"] },
	], hidden: ["secret"] });
	const statuses = new Map([["z", "Z"], ["a", "A\n\t B"], ["later", "LATER"], ["secret", "SECRET"]]);
	const lines = renderLayout(layout, statuses, (name) => name.toUpperCase(), 100);
	assert.match(lines[0], /^CWD · A B · Z +MODEL • THINKING$/);
	assert.equal(lines[1], "LATER");
});

test("empty segments leave no rows or dangling separators; no implicit wildcard is appended", () => {
	const layout = parseLayout({ footer: [{ left: ["status:a", "status:b"], separator: " · " }] });
	assert.deepEqual(renderLayout(layout, new Map([["b", "B"], ["c", "not placed"]]), () => "", 80), ["B"]);
	assert.deepEqual(renderLayout(layout, new Map(), () => "", 80), []);
	assert.deepEqual(renderLayout(parseLayout({ footer: [] }), new Map([["x", "X"]]), () => "", 80), []);
});

test("invalid layouts reject typos, duplicate selectors, widgets, and unsafe separators", () => {
	for (const value of [null, [], { typo: [] }, { footer: "x" }, { footer: null }, { footer: [null] },
		{ footer: [{ left: null }] }, { hidden: null }, { footer: [{ separator: null }] },
		{ footer: [{ left: ["unknown"] }] }, { footer: [{ left: ["model"], right: ["model"] }] },
		{ footer: [{ left: ["status:*"] }, { left: ["status:*"] }] },
		{ aboveEditor: [{ left: ["status:x"] }] }, { belowEditor: ["x"] },
		{ footer: [{ separator: "\n" }] }, { footer: [{ rightSeparator: "\n" }] }, { hidden: ["*"] },
	]) assert.throws(() => parseLayout(value));
	assert.deepEqual(parseLayout({}), defaultLayout);
	assert.deepEqual(parseLayout({ footer: [], aboveEditor: [], belowEditor: [] }), { footer: [], hidden: [] });
});

test("missing config files use defaults while unreadable paths surface an error", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-v2-layout-config-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await loadLayout([join(root, "missing")]), defaultLayout);
	await assert.rejects(loadLayout([root]), /Cannot read|Invalid/);
});

function coloredTheme() {
	return new Theme({
		accent: "#6aa9ff", success: "#90be6d", warning: "#f9c74f", error: "#f94144",
		text: "#ffffff", muted: "#808080", dim: "#505050",
		thinkingHigh: "#bb88ff", thinkingXhigh: "#bb88ff", thinkingOff: "#777777",
	}, { selectedBg: "#202020" }, "truecolor");
}

test("segment modules apply old-style colors while producer styling and width bounds are preserved", async (t) => {
	const theme = coloredTheme();
	const h = await setup(t, { theme });
	const status = "\x1b[35mProducer-owned color\x1b[39m";
	h.statuses.set("example", status);
	await h.fire("session_start");
	const lines = h.footer.render(240);
	assert.ok(lines[0].includes(theme.fg("accent", theme.bold(h.ctx.cwd))));
	assert.ok(lines[0].includes(theme.fg("dim", "on ") + theme.fg("success", "⎇ main")));
	assert.ok(lines[0].includes(theme.fg("dim", "• ") + theme.fg("muted", "session")));
	assert.ok(lines[1].includes(theme.fg("accent", "↑1.0k")));
	assert.ok(lines[1].includes(theme.fg("success", "↓200")));
	assert.ok(lines[1].includes(theme.fg("muted", "R3.0k")));
	assert.ok(lines[1].includes(theme.fg("warning", "$0.010")));
	assert.ok(lines[1].includes(theme.fg("accent", theme.bold("test/model"))));
	assert.ok(lines[1].includes(theme.getThinkingBorderColor("high")("high")));
	assert.equal(lines[2], status);
	for (let width = 0; width <= 240; width++) {
		for (const line of h.footer.render(width)) assert.ok(visibleWidth(line) <= width);
	}
	await h.fire("session_shutdown");
});

test("ANSI and wide-character statuses remain bounded even at zero width", () => {
	const layout = parseLayout({ footer: [{ left: ["cwd", "status:a"], right: ["status:b"] }] });
	const statuses = new Map([["a", "\x1b[31m左側😀 long text\x1b[39m"], ["b", "右側"]]);
	for (let width = 0; width <= 80; width++) {
		for (const line of renderLayout(layout, statuses, () => "目录", width)) assert.ok(visibleWidth(line) <= width);
		assert.ok(visibleWidth(alignRow("left", "right", width)) <= width);
	}
});

test("context border stays independent of footer toggles and does not publish a status", async (t) => {
	const theme = coloredTheme();
	const h = await setup(t, { theme });
	let editorFactory;
	let editor;
	const tui = { terminal: { rows: 24 }, requestRender() {} };
	const editorTheme = { borderColor: (text) => text };
	h.ctx.ui.getEditorComponent = () => editorFactory;
	h.ctx.ui.setEditorComponent = (factory) => {
		editorFactory = factory;
		editor = factory?.(tui, editorTheme, {});
	};
	h.ctx.getContextUsage = () => ({ percent: 45, tokens: 90000, contextWindow: 200000 });
	const producer = registerExtension(contextUsage);
	await h.fire("session_start");
	await producer.fire("session_start", {}, h.ctx);
	const footer = h.footer.render(240);
	const [border] = editor.render(80);
	assert.ok(stripTerminalSequences(border).endsWith(" [█▊  ] 45% 90k/200k ──"));
	assert.ok(border.includes(theme.fg("warning", "45%")));
	assert.doesNotMatch(stripTerminalSequences(footer.join("\n")), /45%|█/);
	assert.ok(!h.statuses.has("context-usage"));
	assert.equal(h.reads, 1);
	h.ctx.getContextUsage = () => ({ percent: 80, tokens: 160000, contextWindow: 200000 });
	await producer.fire("message_end", {}, h.ctx);
	const [updatedBorder] = editor.render(80);
	assert.ok(updatedBorder.includes(theme.fg("error", "80%")));
	h.footer.render(240);
	assert.equal(h.reads, 1, "context updates do not rescan footer history");
	await h.command();
	assert.equal(editor.render(80)[0], updatedBorder);
	await h.command();
	assert.equal(editor.render(80)[0], updatedBorder);
	await producer.fire("session_shutdown", {}, h.ctx);
	assert.equal(editorFactory, undefined);
	await h.fire("session_shutdown");
});

test("copyable layout example matches the bundled old-style composition", async () => {
	const example = JSON.parse(await readFile(new URL("../statusline.example.json", import.meta.url), "utf8"));
	assert.deepEqual(parseLayout(example), defaultLayout);
});
