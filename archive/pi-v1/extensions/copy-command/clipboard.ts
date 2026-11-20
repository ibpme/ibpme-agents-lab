import { spawnSync } from "node:child_process";

export type ClipboardRunner = typeof spawnSync;

function clipboardCommands(platform: NodeJS.Platform): Array<{ command: string; args: string[] }> {
	switch (platform) {
		case "darwin":
			return [{ command: "pbcopy", args: [] }];
		case "win32":
			return [{ command: "clip.exe", args: [] }];
		default:
			return [
				{ command: "wl-copy", args: [] },
				{ command: "xclip", args: ["-selection", "clipboard"] },
				{ command: "xsel", args: ["--clipboard", "--input"] },
			];
	}
}

export function copyToClipboard(
	text: string,
	platform: NodeJS.Platform = process.platform,
	run: ClipboardRunner = spawnSync,
): string | undefined {
	for (const candidate of clipboardCommands(platform)) {
		const result = run(candidate.command, candidate.args, {
			input: text,
			encoding: "utf8",
			stdio: ["pipe", "ignore", "ignore"],
			timeout: 2_000,
		});
		if (!result.error && result.status === 0) return candidate.command;
	}
	return undefined;
}
