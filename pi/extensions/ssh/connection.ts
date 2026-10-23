import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSshTarget, shq, SshConnection } from "./transport.ts";
import type { AuthenticateInteractively } from "./auth.ts";

/** Opens a connection. Without an explicit path, the remote cwd is the login directory. */
export async function connectSsh(arg: string, interactive?: AuthenticateInteractively): Promise<SshConnection> {
  const { remote, remoteCwd } = parseSshTarget(arg);
  const connection = new SshConnection(remote, remoteCwd ?? "");
  try {
    await connection.open(interactive);
    const directory = remoteCwd === undefined ? "pwd" : `cd -- ${shq(remoteCwd)} && pwd`;
    connection.remoteCwd = (await connection.exec(directory, { timeoutMs: 15_000 })).toString().trim();
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

/** `Host` aliases from ~/.ssh/config, for /ssh argument hints. Wildcards excluded. */
export function listSshConfigHosts(): string[] {
  try {
    const raw = readFileSync(join(homedir(), ".ssh", "config"), "utf8");
    const hosts = new Set<string>();
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*Host\s+(.+)$/i);
      if (!match) continue;
      for (const host of match[1].trim().split(/\s+/)) {
        if (host && !host.includes("*") && !host.includes("?")) hosts.add(host);
      }
    }
    return [...hosts];
  } catch {
    return [];
  }
}
