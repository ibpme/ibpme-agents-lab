import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import type { KeyId } from "@earendil-works/pi-tui";

function readObject(path: string): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function readSettings(path: string, env = process.env) {
  let saved: Record<string, unknown> = {};
  try {
    saved = readObject(path);
  } catch {
    // An unreadable preference leaves background requests disabled.
  }
  const savedOllamaUrl = stringValue(saved.ollamaUrl);
  return {
    enabled: saved.enabled === true,
    provider: stringValue(env.PI_SUGGESTIONS_PROVIDER) ?? stringValue(saved.provider)
      ?? (savedOllamaUrl ? "ollama" : "opencode-go"),
    model: stringValue(env.PI_SUGGESTIONS_MODEL) ?? stringValue(saved.model) ?? "muse-spark-1.3-contributor",
    ollamaUrl: (stringValue(env.PI_SUGGESTIONS_OLLAMA_URL) ?? savedOllamaUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
  };
}

export function writeEnabled(path: string, enabled: boolean): void {
  const values = { ...readObject(path), enabled };
  // Follow dangling links too, so the first write creates the target.
  while (true) {
    let target: string;
    try {
      target = readlinkSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EINVAL" && code !== "ENOENT") throw error;
      break;
    }
    path = isAbsolute(target) ? target : realpathSync.native(dirname(path)) + sep + target;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function toggleKeys(agentDir: string): KeyId[] {
  try {
    const value = readObject(join(agentDir, "keybindings.json"))["extensions.suggestions.toggle"];
    const keys = typeof value === "string" ? [value] : value;
    if (Array.isArray(keys) && keys.every((key) => typeof key === "string" && key.trim())) {
      return [...new Set(keys.map((key: string) => key.trim()))] as KeyId[];
    }
  } catch {
    // Invalid keybindings leave the default shortcut available.
  }
  return ["shift+right"];
}
