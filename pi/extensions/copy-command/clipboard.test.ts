import assert from "node:assert/strict";
import test from "node:test";
import { copyToClipboard } from "./clipboard.ts";

test("uses the platform clipboard command and passes text on stdin", () => {
	let invocation: { command: string; args: string[]; input: unknown } | undefined;
	const copied = copyToClipboard("printf hi\n", "darwin", ((command: string, args: string[], options: { input?: unknown }) => {
		invocation = { command, args, input: options.input };
		return { status: 0, error: undefined };
	}) as never);

	assert.equal(copied, "pbcopy");
	assert.deepEqual(invocation, { command: "pbcopy", args: [], input: "printf hi\n" });
});

test("tries Linux clipboard utilities in order and reports when none are available", () => {
	const attempted: string[] = [];
	const copied = copyToClipboard("echo hi", "linux", ((command: string) => {
		attempted.push(command);
		return { status: null, error: new Error("not installed") };
	}) as never);

	assert.equal(copied, undefined);
	assert.deepEqual(attempted, ["wl-copy", "xclip", "xsel"]);
});
