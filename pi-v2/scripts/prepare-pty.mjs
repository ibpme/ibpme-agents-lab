import { existsSync, chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// node-pty 1.1.0's published macOS prebuilds omit execute permission on spawn-helper.
if (process.platform === "darwin") {
  let entry;
  try { entry = import.meta.resolve("node-pty"); } catch { process.exit(0); }
  const root = dirname(dirname(fileURLToPath(entry)));
  for (const helper of [
    join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
    join(root, "build", "Release", "spawn-helper"),
  ]) {
    if (existsSync(helper)) chmodSync(helper, statSync(helper).mode | 0o111);
  }
}
