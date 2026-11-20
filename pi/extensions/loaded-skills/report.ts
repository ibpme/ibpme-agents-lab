import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { replaceControlCharacters, stripTerminalSequences } from "@earendil-works/pi-tui";

export function skillLabel(text: string): string {
  return replaceControlCharacters(stripTerminalSequences(text));
}

async function estimateTokens(path: string): Promise<number | undefined> {
  try {
    // Paths can come from saved sessions. Opening nonblocking avoids waiting on a FIFO.
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) return undefined;
      return Math.ceil(Array.from(await file.readFile("utf8")).length / 4);
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

export async function skillReport(skills: ReadonlyMap<string, string>, cwd: string): Promise<string> {
  if (!skills.size) return "No skills loaded on the active branch.";

  const rows = await Promise.all([...skills].sort(([a], [b]) => a.localeCompare(b)).map(async ([name, path]) => {
    const absolute = resolve(cwd, path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
    const tokens = await estimateTokens(absolute);
    const estimate = tokens === undefined ? "tokens unavailable" : `~${tokens.toLocaleString("en-US")} tokens`;
    return { tokens, label: `${skillLabel(name)}: ${estimate}\n  ${skillLabel(path)}` };
  }));
  const total = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const subtotal = rows.some((row) => row.tokens === undefined) ? " (known files only)" : "";
  return [
    ...rows.map((row) => row.label),
    "",
    `Total${subtotal}: ~${total.toLocaleString("en-US")} tokens`,
    "",
    "Estimates use current skill files at roughly four characters per token. References and repeated reads are excluded.",
  ].join("\n");
}
