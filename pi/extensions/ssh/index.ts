import { SSH_STATUS_KEY, SSH_REMOTE_TOOLS_STATUS_KEY } from "../contracts/status-keys.ts";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  createStylishBashTool,
  createStylishEditTool,
  createStylishFindTool,
  createStylishGrepTool,
  createStylishLsTool,
  createStylishReadTool,
  createStylishWriteTool,
} from "../stylish-tools/factories.ts";
import { clearOperationsOverride, setOperationsOverride } from "../stylish-tools/overrides.ts";
import { getRequiredToolSet } from "../tool-set/service.ts";
import { connectSsh, listSshConfigHosts } from "./connection.ts";
import {
  createRemoteBashOps,
  createRemoteEditOps,
  createRemoteFindOps,
  createRemoteGrepOps,
  createRemoteLsOps,
  createRemoteReadOps,
  createRemoteWriteOps,
} from "./operations.ts";
import { SshConnection } from "./transport.ts";

const REMOTE_DESCRIPTIONS = {
  read: "Read a file on the SSH remote host connected via /ssh, not the local machine.",
  write: "Write a file on the SSH remote host connected via /ssh, not the local machine.",
  edit: "Edit a file on the SSH remote host connected via /ssh, not the local machine.",
  bash: "Execute a shell command on the SSH remote host connected via /ssh, not the local machine.",
  grep: "Search file contents on the SSH remote host connected via /ssh, not the local machine.",
  ls: "List a directory on the SSH remote host connected via /ssh, not the local machine.",
  find: "Find files on the SSH remote host connected via /ssh, not the local machine.",
} as const;

const NOT_CONNECTED_ERROR = "Not connected. Ask the user to run /ssh user@host first.";

/** Footer badge for the "ssh" status key; status-line.ts places it on the cwd line. */
function sshStatusText(theme: Theme, label: string, target: Pick<SshConnection, "remote" | "remoteCwd">): string {
  return (
    theme.fg("warning", theme.bold(`⇄ ${label}`)) +
    theme.fg("dim", " ") +
    theme.fg("accent", target.remote) +
    theme.fg("dim", ":") +
    theme.fg("success", target.remoteCwd)
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("ssh", { description: "SSH remote: user@host or user@host:/path", type: "string" });

  const localCwd = process.cwd();
  const timers = new Set<NodeJS.Timeout>();

  // CLI override mode — resolved once at session_start, redirects the base
  // read/write/edit/bash tools via stylish-tools/overrides.ts.
  let cliSsh: SshConnection | null = null;

  // Interactive session mode — mutated by /ssh, drives the _remote tools.
  let sessionSsh: SshConnection | null = null;

  pi.registerTool(
    createStylishReadTool(localCwd, timers, {
      name: "read_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.read,
      getOperations: () => (sessionSsh ? createRemoteReadOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishWriteTool(localCwd, timers, {
      name: "write_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.write,
      getOperations: () => (sessionSsh ? createRemoteWriteOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishEditTool(localCwd, timers, {
      name: "edit_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.edit,
      getOperations: () => (sessionSsh ? createRemoteEditOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishBashTool(localCwd, timers, {
      name: "bash_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.bash,
      promptSnippet: "Execute bash commands on the SSH remote host connected via /ssh (not the local machine)",
      getOperations: () => (sessionSsh ? createRemoteBashOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishGrepTool(localCwd, timers, {
      name: "grep_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.grep,
      getOperations: () => (sessionSsh ? createRemoteGrepOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishLsTool(localCwd, timers, {
      name: "ls_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.ls,
      getOperations: () => (sessionSsh ? createRemoteLsOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );
  pi.registerTool(
    createStylishFindTool(localCwd, timers, {
      name: "find_remote",
      exposure: "deferred",
      extraDescription: REMOTE_DESCRIPTIONS.find,
      getOperations: () => (sessionSsh ? createRemoteFindOps(sessionSsh, localCwd) : undefined),
      getTag: () => sessionSsh?.remote,
      requireOperationsError: NOT_CONNECTED_ERROR,
    }),
  );

  type StatusUiCtx = { ui: { setStatus(key: string, text: string | undefined): void; theme: Theme } };

  function updateRemoteToolsStatus(ctx: StatusUiCtx) {
    ctx.ui.setStatus(SSH_STATUS_KEY, sessionSsh ? sshStatusText(ctx.ui.theme, "SSH", sessionSsh) : undefined);
    ctx.ui.setStatus(SSH_REMOTE_TOOLS_STATUS_KEY, sessionSsh ? ctx.ui.theme.fg("dim", "remote: deferred") : undefined);
  }

  function announceConnection() {
    pi.sendMessage({
      customType: "ssh-connection-context",
      content: cliSsh
        ? `SSH override mode is active: unqualified read/write/edit/bash/grep/ls/find tools execute on ${cliSsh.remote}:${cliSsh.remoteCwd}, not locally. The _remote tools require a separate /ssh connection and are unavailable in this mode. Execution permissions are unchanged.`
        : sessionSsh
        ? `SSH connected to ${sessionSsh.remote}:${sessionSsh.remoteCwd}. The deferred read_remote/write_remote/edit_remote/bash_remote/grep_remote/ls_remote/find_remote tools target this host; discover them through tool_search or codemode. Unqualified tools still operate locally. Execution permissions are unchanged.`
        : "SSH disconnected. Remote tools remain discoverable but cannot execute until the user connects through /ssh. Unqualified tools still operate locally.",
      display: false,
    }, { triggerTurn: false });
  }

  pi.on("session_start", async (_event, ctx) => {
    getRequiredToolSet().addBlockedTools(["write_remote", "edit_remote", "bash_remote"]);
    updateRemoteToolsStatus(ctx);

    const arg = pi.getFlag("ssh") as string | undefined;
    if (!arg) {
      announceConnection();
      return;
    }

    cliSsh = await connectSsh(arg);
    setOperationsOverride({
      read: createRemoteReadOps(cliSsh, localCwd),
      write: createRemoteWriteOps(cliSsh, localCwd),
      edit: createRemoteEditOps(cliSsh, localCwd),
      bash: createRemoteBashOps(cliSsh, localCwd),
      grep: createRemoteGrepOps(cliSsh, localCwd),
      ls: createRemoteLsOps(cliSsh, localCwd),
      find: createRemoteFindOps(cliSsh, localCwd),
      tag: cliSsh.remote,
    });
    ctx.ui.setStatus(SSH_STATUS_KEY, sshStatusText(ctx.ui.theme, "SSH", cliSsh));
    announceConnection();
    ctx.ui.notify(
      `SSH override mode: ${cliSsh.remote}:${cliSsh.remoteCwd} (read/write/edit/bash/grep/ls/find run remotely)`,
      "info",
    );
  });

  pi.registerCommand("ssh", {
    description: "user@host[:/path] to connect the _remote tools (read/write/edit/bash/grep/ls/find), or 'off' to disconnect",
    getArgumentCompletions: (prefix) => {
      if (cliSsh) return null; // --ssh already covers the whole session; command is a no-op

      const items: { value: string; label: string; description?: string }[] = [];
      if (sessionSsh) {
        items.push({
          value: "off",
          label: "off",
          description: `disconnect (currently ${sessionSsh.remote}:${sessionSsh.remoteCwd})`,
        });
      }
      for (const host of listSshConfigHosts()) {
        items.push({ value: host, label: host, description: "from ~/.ssh/config" });
      }

      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      if (cliSsh) {
        ctx.ui.notify(
          `SSH is already active via --ssh (${cliSsh.remote}); the /ssh command has no effect this session.`,
          "warning",
        );
        return;
      }

      const trimmed = args.trim();
      if (trimmed === "" || trimmed === "off") {
        if (!sessionSsh) {
          ctx.ui.notify("SSH is not active.", "info");
          return;
        }
        const previous = sessionSsh;
        sessionSsh = null;
        updateRemoteToolsStatus(ctx);
        announceConnection();
        await previous.close();
        ctx.ui.notify("SSH disconnected.", "info");
        return;
      }

      let next: SshConnection;
      try {
        next = await connectSsh(trimmed);
      } catch (e) {
        ctx.ui.notify(`SSH connection failed: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
      const previous = sessionSsh;
      sessionSsh = next;
      updateRemoteToolsStatus(ctx);
      announceConnection();
      await previous?.close();
      ctx.ui.notify(
        `SSH connected: ${sessionSsh.remote}:${sessionSsh.remoteCwd} — remote tools are deferred (tool_search or codemode).`,
        "info",
      );
    },
  });

  pi.on("session_tree", announceConnection);

  // Handle user ! commands via SSH — only in CLI override mode, since in
  // session mode local bash remains the default and bash_remote is opt-in.
  pi.on("user_bash", (_event) => {
    if (!cliSsh) return;
    return { operations: createRemoteBashOps(cliSsh, localCwd) };
  });

  // Replace local cwd with remote cwd in system prompt — CLI override mode only.
  pi.on("before_agent_start", async (event) => {
    if (!cliSsh) return;
    const modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${cliSsh.remoteCwd} (via SSH: ${cliSsh.remote})`,
    );
    return { systemPrompt: modified };
  });

  pi.on("session_shutdown", async () => {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    if (cliSsh) clearOperationsOverride();
    await Promise.all([cliSsh?.close(), sessionSsh?.close()]);
    cliSsh = null;
    sessionSsh = null;
  });
}
