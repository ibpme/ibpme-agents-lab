import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export async function skillReport(skills: ReadonlyMap<string, string>, cwd: string): Promise<string> {
  if (!skills.size) return "No skills loaded on the active branch.";
  let total = 0;
  let unavailable = 0;
  const rows = await Promise.all([...skills].sort(([a], [b]) => a.localeCompare(b)).map(async ([name, path]) => {
    const absolute = resolve(cwd, path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
    try {
      const content = await readFile(absolute, "utf8");
      const tokens = Math.ceil(Array.from(content).length / 4);
      total += tokens;
      return `${name}: ~${tokens.toLocaleString("en-US")} tokens\n  ${path}`;
    } catch {
      unavailable++;
      return `${name}: tokens unavailable (file unreadable)\n  ${path}`;
    }
  }));
  return [...rows, "", `Total${unavailable ? " (known files only)" : ""}: ~${total.toLocaleString("en-US")} tokens`,
    "", "Estimate: current full skill files, ~4 characters/token; excludes references and repeated reads.",
    "This is not a measurement of tokens remaining in context after compaction."].join("\n");
}
