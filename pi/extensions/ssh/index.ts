import type { ExtensionAPI, ExtensionContext, SessionContext } from "@earendil-works/pi-coding-agent";
import { terminalAuthentication } from "./auth.ts";
import { connectSsh, listSshConfigHosts } from "./connection.ts";
import { destination, registerSshTools } from "./tools.ts";
import { type SshConnection, RemoteAbortError } from "./transport.ts";

const noticeType = "ssh-connection-context";

export default function ssh(pi: ExtensionAPI): void {
  pi.registerFlag("ssh", { description: "Connect the deferred _remote tools to user@host[:/path] at startup", type: "string" });
  let connection: SshConnection | undefined;
  let attempt: AbortController | undefined;
  const pending = new Set<Promise<void>>();
  const retiring = new Set<SshConnection>();

  async function close(old: SshConnection) {
    retiring.add(old);
    await old.close();
    retiring.delete(old);
  }

  registerSshTools(pi, () => connection, async (lost, ctx) => {
    if (connection !== lost) return;
    connection = undefined;
    updateStatus(ctx);
    await close(lost);
  });

  function updateStatus(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    const { theme } = ctx.ui;
    const label = connection
      ? theme.fg("warning", theme.bold("⇄ SSH")) + " " + theme.fg("accent", destination(connection))
      : undefined;
    ctx.ui.setStatus("ssh", label);
  }

  function connect(target: string, ctx: ExtensionContext) {
    attempt?.abort();
    const current = new AbortController();
    attempt = current;
    const work = (async () => {
      try {
        const next = await connectSsh(target, close, terminalAuthentication(ctx, current.signal), current.signal);
        if (current.signal.aborted) {
          await close(next);
          return;
        }
        const previous = connection;
        connection = next;
        updateStatus(ctx);
        ctx.ui.notify("SSH connected: " + destination(next), "info");
        if (previous) await close(previous);
      } catch (error) {
        if (error instanceof RemoteAbortError) return;
        const message = "SSH: " + (error instanceof Error ? error.message : String(error));
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
      const hosts = listSshConfigHosts().map((host) => ({ value: host, label: host, description: "from ~/.ssh/config" }));
      if (connection || retiring.size) hosts.unshift({ value: "off", label: "off", description: "disconnect" });
      return hosts.filter(({ value }) => value.startsWith(prefix));
    },
    async handler(args, ctx) {
      const target = args.trim();
      if (target && target !== "off") return connect(target, ctx);
      attempt?.abort();
      const previous = connection;
      connection = undefined;
      updateStatus(ctx);
      if (previous) retiring.add(previous);
      const disconnected = retiring.size > 0;
      await Promise.all([...retiring].map(close));
      ctx.ui.notify(disconnected ? "SSH disconnected." : "SSH is disconnected.", "info");
    },
  });

  function notice(messages: SessionContext["messages"], ctx: ExtensionContext) {
    const content = connection
      ? "SSH connected to " + destination(connection) + ". The deferred _remote tools run there. Unqualified tools run locally."
      : "SSH disconnected. The _remote tools remain discoverable and require the user to connect through /ssh. Unqualified tools run locally.";
    const previous = messages.slice().reverse().find((message) => message.role === "custom" && message.customType === noticeType);
    if (previous?.role === "custom" && previous.content === content) return;
    if (!previous && !connection && !ctx.sessionManager.getEntries().some((entry) =>
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
  pi.on("session_start", async (event, ctx) => {
    updateStatus(ctx);
    if (event.reason !== "startup") return;
    const target = pi.getFlag("ssh");
    if (typeof target === "string") await connect(target, ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    attempt?.abort();
    const previous = connection;
    connection = undefined;
    if (ctx.mode === "tui") ctx.ui.setStatus("ssh", undefined);
    if (previous) retiring.add(previous);
    await Promise.allSettled(pending);
    const results = await Promise.allSettled([...retiring].map(close));
    for (const result of results) {
      if (result.status === "rejected") ctx.ui.notify(String(result.reason), "error");
    }
  });
}
