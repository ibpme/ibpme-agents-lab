import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
let temp;
let loader;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

before(async () => {
	temp = await mkdtemp(join(tmpdir(), "pi-v2-alias-"));
	const agentDir = join(temp, "agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	await symlink(root, join(agentDir, "extensions", "ibpme-pi-extensions"), "dir");
	loader = new DefaultResourceLoader({
		cwd: temp,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
});

after(async () => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (temp) await rm(temp, { recursive: true, force: true });
});

function command(name) {
	const extension = loader.getExtensions().extensions.find((entry) => entry.resolvedPath.endsWith("/alias/index.ts"));
	assert.ok(extension, "alias extension loaded");
	const registered = extension.commands.get(name);
	assert.ok(registered, `/${name} registered`);
	return registered;
}

function context(methods) {
	return new Proxy(methods, {
		get(target, key) {
			assert.ok(Object.hasOwn(target, key), `unexpected context access: ${String(key)}`);
			return target[key];
		},
	});
}

test("Pi discovers exactly the manifest entry points on load and reload", async () => {
	const expected = await Promise.all(manifest.pi.extensions.map((entry) => realpath(join(root, entry))));
	for (const pass of ["load", "reload"]) {
		if (pass === "reload") await loader.reload();
		const result = loader.getExtensions();
		assert.deepEqual(result.errors, []);
		assert.deepEqual(result.warnings, []);
		const actual = await Promise.all(result.extensions.map((extension) => realpath(extension.resolvedPath)));
		assert.deepEqual(actual.sort(), expected.sort());
		const thinkingStyle = result.extensions.find((entry) => entry.resolvedPath.endsWith("/thinking-style/index.ts"));
		assert.ok(thinkingStyle, "thinking-style loaded");
		assert.deepEqual([...thinkingStyle.markdownTransformer.messageTypes], ["assistant-thinking"]);
		assert.equal(thinkingStyle.markdownTransformer.transformer("Reasoning\n\n"), "> Reasoning\n>\n>");
		const statusLine = result.extensions.find((entry) => entry.resolvedPath.endsWith("/status-line/index.ts"));
		assert.ok(statusLine, "status-line loaded");
		assert.deepEqual([...statusLine.commands.keys()], ["statusline"]);
		assert.ok(statusLine.handlers.has("session_start"));
		assert.ok(statusLine.handlers.has("session_shutdown"));
		const contextUsage = result.extensions.find((entry) => entry.resolvedPath.endsWith("/context-usage/index.ts"));
		assert.ok(contextUsage, "independent context-usage producer loaded");
		assert.ok(contextUsage.handlers.has("session_start"));
		assert.ok(contextUsage.handlers.has("session_shutdown"));
		const alias = result.extensions.find((entry) => entry.resolvedPath.endsWith("/alias/index.ts"));
		assert.deepEqual([...alias.commands.keys()].sort(), ["clear", "exit"]);
		for (const [name, key] of [["stash", "ctrl+s"], ["thinking-cycle-backward", "shift+left"]]) {
			const extension = result.extensions.find((entry) => entry.resolvedPath.endsWith(`/${name}/index.ts`));
			assert.ok(extension, `${name} loaded`);
			assert.deepEqual([...extension.shortcuts.keys()], [key]);
		}
	}
});

test("/exit requests Pi's graceful shutdown exactly once", async () => {
	let calls = 0;
	await command("exit").handler("", context({ shutdown: () => { calls++; } }));
	assert.equal(calls, 1);
});

test("/clear awaits Pi's new-session operation without using the old context afterwards", async () => {
	const { promise, resolve: finish } = Promise.withResolvers();
	let calls = 0;
	let completed = false;
	const running = command("clear").handler("", context({ newSession: () => { calls++; return promise; } }));
	running.then(() => { completed = true; });
	await Promise.resolve();
	assert.equal(calls, 1);
	assert.equal(completed, false);
	finish({ cancelled: false });
	await running;
	assert.equal(completed, true);
});

test("/clear respects cancellation without retrying or touching the context again", async () => {
	let calls = 0;
	await command("clear").handler("", context({
		newSession: async () => { calls++; return { cancelled: true }; },
	}));
	assert.equal(calls, 1);
});

test("/clear leaves session errors to Pi's command error handling", async () => {
	const error = new Error("Session switch failed");
	await assert.rejects(
		command("clear").handler("", context({ newSession: async () => { throw error; } })),
		(candidate) => candidate === error,
	);
});

test("legacy shortcut settings cannot remap or disable directly registered shortcuts", async () => {
	const configPath = join(temp, "agent", "keybindings.json");
	try {
		for (const [config, expected] of [
			[{
				"extensions.stash.toggle": "ctrl+shift+s",
				"extensions.thinking.cycleBackward": ["ctrl+shift+left", "ctrl+shift+left"],
			}, { stash: ["ctrl+s"], "thinking-cycle-backward": ["shift+left"] }],
			[{
				"extensions.stash.toggle": [],
				"extensions.thinking.cycleBackward": [],
			}, { stash: ["ctrl+s"], "thinking-cycle-backward": ["shift+left"] }],
		]) {
			await writeFile(configPath, JSON.stringify(config));
			await loader.reload();
			const result = loader.getExtensions();
			assert.deepEqual(result.errors, []);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.extensions.length, manifest.pi.extensions.length);
			for (const [name, keys] of Object.entries(expected)) {
				const extension = result.extensions.find((entry) => entry.resolvedPath.endsWith(`/${name}/index.ts`));
				assert.deepEqual([...extension.shortcuts.keys()], keys);
			}
		}
	} finally {
		await rm(configPath, { force: true });
	}
});
