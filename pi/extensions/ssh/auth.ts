import { spawnSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TransportError } from "./transport.ts";

export type AuthenticateInteractively = (args: string[]) => Promise<void>;
export const AUTH_TIMEOUT_MS = 120_000;

/** OpenSSH owns all credential entry; neither Pi nor the model receives secrets. */
export function terminalAuthentication(ctx: ExtensionContext): AuthenticateInteractively | undefined {
  if (ctx.mode !== "tui" || !process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return async (args) => {
    const ok = await ctx.ui.custom<boolean>((tui, _theme, _keys, done) => {
      tui.stop();
      let success = false;
      try {
        process.stdout.write("\x1b[2J\x1b[HSSH authentication — enter credentials at the SSH prompt. Ctrl-C cancels.\n");
        const result = spawnSync("ssh", args, {
          stdio: "inherit",
          timeout: AUTH_TIMEOUT_MS,
          killSignal: "SIGKILL",
          env: { ...process.env, SSH_ASKPASS_REQUIRE: "never" },
        });
        success = !result.error && result.status === 0;
      } finally {
        tui.start();
        tui.requestRender(true);
      }
      done(success);
      return { render: () => [], invalidate() {} };
    });
    if (!ok) throw new TransportError("SSH authentication failed, was cancelled, or timed out. Run /ssh to retry.");
  };
}
