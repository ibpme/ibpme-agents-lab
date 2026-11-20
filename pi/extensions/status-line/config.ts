import { readFile } from "node:fs/promises";
import { parseLayout, defaultLayout, type StatusLayout } from "./layout.ts";

export async function loadLayout(paths: string[]): Promise<StatusLayout> {
  for (const path of [...paths].reverse()) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      return parseLayout(JSON.parse(content));
    } catch (error) {
      throw new Error(`Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return defaultLayout;
}
