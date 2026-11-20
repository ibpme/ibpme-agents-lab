import { existsSync, chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// node-pty 1.1.0's published macOS prebuilds omit execute permission on spawn-helper.
if (process.platform === "darwin") {
  const root = dirname(dirname(fileURLToPath(import.meta.resolve("node-pty"))));
  for (const helper of [
    join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
    join(root, "build", "Release", "spawn-helper"),
  ]) {
    if (existsSync(helper)) chmodSync(helper, statSync(helper).mode | 0o111);
  }
}
