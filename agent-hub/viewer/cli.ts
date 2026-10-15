import { parseOptions } from "./options.ts";
import { openPopup } from "./popup.ts";

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: agents-viewer [--direct] [--directory PATH]
                      [--socket PATH --pane %ID [--client NAME]]

Inside tmux, opens a 90% popup. Outside tmux, runs directly.
--direct     Run the browser in this terminal instead of opening a popup.
--directory  Registry directory (otherwise uses AGENTS_REGISTRY_DIR/XDG defaults).
--socket/--pane/--client preserve the invoking tmux context.`);
  } else if (options.origin && !options.direct) {
    await openPopup(options.origin, options.directory);
  } else {
    const { runBrowser } = await import("./terminal.ts");
    await runBrowser(options.origin, options.directory);
  }
} catch (error) {
  console.error(`agents-viewer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
