import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Origin } from "./tmux-actions.ts";
import type { Runner } from "@agent-hub/registry/types";

const execute = promisify(execFile);
export const launcher = fileURLToPath(new URL("./launcher", import.meta.url));
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const run: Runner = async (command, args) => (await execute(command, args)).stdout;

/** `directory` is the agent-hub state directory, passed through to the popup. */
export async function openPopup(origin: Origin, directory?: string, runner: Runner = run): Promise<void> {
  const client = origin.client ?? (await runner("tmux", ["-S", origin.server, "display-message", "-p", "-t", origin.paneId, "#{client_name}"])).trim();
  if (!client) throw new Error("No attached tmux client for the invoking pane.");
  const command = [launcher, "--direct", "--socket", origin.server, "--pane", origin.paneId, "--client", client];
  if (directory) command.push("--directory", directory);
  // A popup may remain open indefinitely; do not use the registry runner's five-second timeout.
  await runner("tmux", ["-S", origin.server, "display-popup", "-c", client, "-E", "-w", "90%", "-h", "90%", "-T", "Agents", command.map(shellQuote).join(" ")]);
}
