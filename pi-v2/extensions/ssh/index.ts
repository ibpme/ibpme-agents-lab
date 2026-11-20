import type { ExtensionAPI, ExtensionContext, SessionContext } from "@earendil-works/pi-coding-agent";
import { terminalAuthentication } from "./auth.ts";
import { connectSsh, listSshConfigHosts } from "./connection.ts";
import { destination, registerSshTools } from "./tools.ts";
import { type SshConnection, RemoteAbortError } from "./transport.ts";

const noticeType = "ssh-connection-context";

export default function ssh(pi: ExtensionAPI): void {
  pi.registerFlag("ssh", { description: "Route model file and shell tools to user@host[:/path]", type: "string" });
  let cli = false;
  let unavailable: string | undefined;
  let connection: SshConnection | undefined;
  let attempt: AbortController | undefined;
  const pending = new Set<Promise<void>>();

  registerSshTools(pi, () => ({ cli, connection, unavailable }), async (lost, ctx) => {
    if (connection !== lost) return;
    connection = undefined;
    unavailable = cli ? "SSH connection lost. Restart Pi with --ssh to reconnect." : undefined;
    updateStatus(ctx);
    await lost.close();
  });

  function updateStatus(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    const { theme } = ctx.ui;
    const label = connection
      ? theme.fg("warning", theme.bold("⇄ SSH")) + " " + theme.fg("accent", destination(connection))
      : cli ? theme.fg("error", "⇄ SSH unavailable") : undefined;
    ctx.ui.setStatus("ssh", label);
  }

  function connect(target: string, ctx: ExtensionContext) {
    attempt?.abort();
    const current = new AbortController();
    attempt = current;
    const work = (async () => {
      try {
        const next = await connectSsh(target, terminalAuthentication(ctx, current.signal), current.signal);
        if (current.signal.aborted) {
          await next.close();
          return;
        }
        const previous = connection;
        connection = next;
        unavailable = undefined;
        updateStatus(ctx);
        ctx.ui.notify("SSH connected: " + destination(next), "info");
        await previous?.close();
      } catch (error) {
        if (current.signal.aborted || error instanceof RemoteAbortError) return;
        const message = "SSH connection failed: " + (error instanceof Error ? error.message : String(error));
        if (cli) unavailable = message;
        updateStatus(ctx);
        ctx.ui.notify(message, "error");
      } finally {
        if (attempt === current) attempt = undefined;
      }
    })();
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
  }

  pi.registerCommand("ssh", {
    description: "Connect the deferred _remote tools to user@host[:/path], or use off to disconnect",
    getArgumentCompletions(prefix) {
      if (cli) return null;
      const hosts = listSshConfigHosts().map((host) => ({ value: host, label: host, description: "from ~/.ssh/config" }));
      if (connection) hosts.unshift({ value: "off", label: "off", description: "disconnect" });
      return hosts.filter(({ value }) => value.startsWith(prefix));
    },
    async handler(args, ctx) {
      if (cli) {
        ctx.ui.notify("Restart Pi with --ssh to change or reconnect the startup target.", "warning");
        return;
      }
      const target = args.trim();
      if (target && target !== "off") return connect(target, ctx);
      attempt?.abort();
      const previous = connection;
      connection = undefined;
      updateStatus(ctx);
      await previous?.close();
      ctx.ui.notify(previous ? "SSH disconnected." : "SSH is disconnected.", "info");
    },
  });

  function notice(messages: SessionContext["messages"], ctx: ExtensionContext) {
    const content = connection
      ? cli
        ? "SSH override active at " + destination(connection) + ". The unqualified read/write/edit/bash/grep/ls/find tools run there. User shell shortcuts run locally."
        : "SSH connected to " + destination(connection) + ". The deferred _remote tools run there. Unqualified tools run locally."
      : cli
        ? "SSH override unavailable. The unqualified read/write/edit/bash/grep/ls/find tools cannot run until the startup target connects."
        : "SSH disconnected. The _remote tools remain discoverable and require the user to connect through /ssh. Unqualified tools run locally.";
    const previous = messages.slice().reverse().find((message) => message.role === "custom" && message.customType === noticeType);
    if (previous?.role === "custom" && previous.content === content) return;
    if (!previous && !connection && !cli && !ctx.sessionManager.getEntries().some((entry) =>
      entry.type === "custom_message" && entry.customType === noticeType)) return;
    return { type: "custom_message", customType: noticeType, content, display: true } as const;
  }

  pi.on("before_agent_start", (_event, ctx) => {
    const message = notice(ctx.sessionManager.buildSessionProjection().messages, ctx);
    if (message) return { message };
  });
  pi.on("turn_end", (event, ctx) => {
    const entry = notice(event.context.contextMessages, ctx);
    if (entry) return { entries: [...event.entries, entry] };
  });
  pi.on("session_start", async (_event, ctx) => {
    const target = pi.getFlag("ssh");
    cli = typeof target === "string";
    updateStatus(ctx);
    if (typeof target === "string") await connect(target, ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    attempt?.abort();
    const previous = connection;
    connection = undefined;
    if (ctx.mode === "tui") ctx.ui.setStatus("ssh", undefined);
    await Promise.allSettled([previous?.close(), ...pending]);
  });
}
