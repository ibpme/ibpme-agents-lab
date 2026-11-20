export interface ShellCommand {
	language: string;
	text: string;
}

const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh", "console"]);

export function normalizeCommand(source: string): string {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length > 0 && !lines[0].trim()) lines.shift();
	while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

	const nonBlank = lines.filter((line) => line.trim());
	const indentation = nonBlank.length === 0
		? 0
		: Math.min(...nonBlank.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0));

	return lines
		.map((line) => line.slice(indentation).replace(/[\t ]+$/, ""))
		.join("\n");
}

export function shellCommandsFrom(text: string): ShellCommand[] {
	const commands: ShellCommand[] = [];
	const fence = /^\s*(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\s*\1\s*$/gm;

	for (const match of text.matchAll(fence)) {
		const info = (match[2] ?? "").trim().split(/[\s,]+/, 1)[0]?.toLowerCase() ?? "";
		if (!SHELL_LANGUAGES.has(info)) continue;
		const normalized = normalizeCommand(match[3] ?? "");
		if (normalized) commands.push({ language: info, text: normalized });
	}

	return commands;
}
