import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TransportError } from "./transport.ts";

export type AuthenticateInteractively = (args: string[]) => Promise<void>;
export const AUTH_TIMEOUT_MS = 120_000;

/** Credential keystrokes go only to the PTY, never Pi's editor or conversation. */
export function terminalAuthentication(ctx: ExtensionContext, signal?: AbortSignal): AuthenticateInteractively | undefined {
  if (ctx.mode !== "tui" || !process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return async (args) => {
    // Native PTY support is only needed when authentication actually requires interaction.
    const { SshAuthTerminal } = await import("./auth-terminal.ts");
    const outcome = await ctx.ui.custom<import("./auth-terminal.ts").AuthOutcome>(
      (tui, _theme, _keys, done) => new SshAuthTerminal(tui, args, done, AUTH_TIMEOUT_MS, signal),
      { overlay: true, overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center", margin: 1 } },
    );
    if (outcome !== "success") {
      const reason = outcome === "timeout" ? "timed out" : outcome === "cancelled" ? "was cancelled" : "failed";
      throw new TransportError(`SSH authentication ${reason}. Run /ssh to retry.`);
    }
  };
}
