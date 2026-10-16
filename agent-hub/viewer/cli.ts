import { join, resolve } from "node:path";
import { parseOptions } from "./options.ts";
import { openPopup } from "./popup.ts";

try {
  const options = parseOptions(process.argv.slice(2));
  const hub = options.directory && resolve(options.directory);
  if (options.help) {
    console.log(`Usage: agent-hub view [--direct] [--directory PATH]
                      [--socket PATH --pane %ID [--client NAME]]

Browse live agents and their transcripts. Requires Bun on PATH.
Inside tmux, opens a 90% popup. Outside tmux, runs directly.
--direct     Run the browser in this terminal instead of opening a popup.
--directory  agent-hub state directory (default: AGENT_HUB_DIR, else ~/.local/state/agent-hub).
--socket/--pane/--client preserve the invoking tmux context.`);
  } else if (options.origin && !options.direct) {
    await openPopup(options.origin, hub);
  } else {
    const { runBrowser } = await import("./terminal.ts");
    await runBrowser(options.origin, hub && join(hub, "registry"));
  }
} catch (error) {
  console.error(`agent-hub view: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
