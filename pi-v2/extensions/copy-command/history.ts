import { contentText } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Marked } from "@earendil-works/pi-tui";

const shellLanguages = new Set(["bash", "sh", "shell", "zsh", "console"]);
const markdown = new Marked();

export interface CommandReply {
  repliesBack: number;
  blocks: string[];
}

function shellBlocks(text: string): string[] {
  const blocks: string[] = [];
  markdown.walkTokens(markdown.lexer(text), (token) => {
    if (token.type !== "code" || !token.lang || !token.text.trim()) return;
    const language = token.lang.trim().split(/[\s,]+/, 1)[0].toLowerCase();
    if (!shellLanguages.has(language)) return;

    // Markdown also accepts fences closed by EOF. A reply may have stopped mid-command.
    const opening = token.raw.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    const closing = token.raw.match(/\n {0,3}(`{3,}|~{3,})[ \t]*(?:\n[ \t]*)*$/)?.[1];
    if (opening && closing?.startsWith(opening)) blocks.push(token.text);
  });
  return blocks;
}

export function commandReplies(branch: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): CommandReply[] {
  const replies: CommandReply[] = [];
  let repliesBack = 0;
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const text = contentText(entry.message.content);
    if (!text.trim()) continue;
    const blocks = shellBlocks(text);
    if (blocks.length) replies.push({ repliesBack, blocks });
    repliesBack++;
  }
  return replies;
}

export function replyLabel(reply: CommandReply): string {
  const { repliesBack } = reply;
  return repliesBack === 0 ? "Latest reply" : `${repliesBack} ${repliesBack === 1 ? "reply" : "replies"} back`;
}
