import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractTextParts } from "../shared/message-text.ts";
import { shellCommandsFrom, type ShellCommand } from "./commands.ts";

export interface CommandReply {
	repliesBack: number;
	summary: string;
	commands: ShellCommand[];
}

export function commandReplies(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): CommandReply[] {
	const replies: CommandReply[] = [];
	let repliesBack = 0;
	for (const entry of [...entries].reverse()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const text = extractTextParts(entry.message.content);
		if (!text.trim()) continue;
		const commands = shellCommandsFrom(text);
		if (commands.length) replies.push({
			repliesBack,
			summary: text.split("\n").find((line) => line.trim() && !/^\s*[`~]{3}/.test(line))?.trim() ?? "Shell commands",
			commands,
		});
		repliesBack++;
	}
	return replies;
}

export function replyLabel(reply: CommandReply): string {
	return reply.repliesBack === 0 ? "Latest reply" : `${reply.repliesBack} ${reply.repliesBack === 1 ? "reply" : "replies"} back`;
}
