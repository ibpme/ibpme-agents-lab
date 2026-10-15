import { isAbsolute } from "node:path";
import type { Origin } from "./tmux-actions.ts";

export function parseOptions(args: string[], env: NodeJS.ProcessEnv = process.env) {
  let direct = false;
  let help = false;
  let directory: string | undefined;
  let server = env.TMUX?.replace(/,\d+,\d+$/, "");
  let paneId = env.TMUX_PANE;
  let client: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--direct") { direct = true; continue; }
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (!["--socket", "--pane", "--client", "--directory"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--socket") server = value;
    if (arg === "--pane") paneId = value;
    if (arg === "--client") client = value;
    if (arg === "--directory") directory = value;
  }
  if (server && !isAbsolute(server)) throw new Error("Tmux socket must be an absolute path.");
  if (paneId && !/^%\d+$/.test(paneId)) throw new Error("Invalid tmux pane ID.");
  if (!!server !== !!paneId || (client && !server)) throw new Error("Tmux socket and origin pane must be supplied together.");
  const origin: Origin | undefined = server && paneId ? { server, paneId, ...(client ? { client } : {}) } : undefined;
  return { direct, help, directory, origin };
}
