import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function alias(pi: ExtensionAPI): void {
	pi.registerCommand("exit", {
		description: "Exit Pi gracefully",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	pi.registerCommand("clear", {
		description: "Start a new session (keep the previous session saved)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
}
