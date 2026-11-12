import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commandReplies, replyLabel } from "./history.ts";

test("groups blocks newest first and skips non-text tool turns without changing recency", () => {
	const branch = [
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Older\n```sh\necho old\n```" }] } },
		{ type: "message", message: { role: "user", content: "```sh\necho user\n```" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }] } },
		{ type: "message", message: { role: "assistant", content: "No commands here" } },
	] as unknown as ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
	const replies = commandReplies(branch);
	assert.equal(replies.length, 1);
	assert.equal(replyLabel(replies[0]), "1 reply back");
	assert.equal(replies[0].summary, "Older");
	assert.equal(replies[0].commands[0].text, "echo old");
});
