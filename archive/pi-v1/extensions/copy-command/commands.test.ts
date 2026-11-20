import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommand, shellCommandsFrom } from "./commands.ts";

test("extracts shell fences and cleans surrounding and trailing whitespace", () => {
	const source = [
		"Here is the command:",
		"",
		"   ```bash",
		"   nmcli device wifi list ifname wlp3s0   ",
		"   ```",
	].join("\n");
	assert.deepEqual(shellCommandsFrom(source), [{
		language: "bash",
		text: "nmcli device wifi list ifname wlp3s0",
	}]);
});

test("preserves internal indentation, line breaks, and shell continuations", () => {
	assert.equal(
		normalizeCommand("\n    printf '%s\\n' \\\n      \"hello\"   \n\n"),
		"printf '%s\\n' \\\n  \"hello\"",
	);
});

test("ignores non-shell fences and returns multiple shell blocks in order", () => {
	const commands = shellCommandsFrom([
		"```typescript\nconst value = 1;\n```",
		"```sh\n echo one \n```",
		"~~~zsh\necho two\n~~~",
	].join("\n"));
	assert.deepEqual(commands.map(({ text }) => text), ["echo one", "echo two"]);
});
