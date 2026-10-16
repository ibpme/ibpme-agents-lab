import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AgentSnapshot, Health } from "@agent-hub/registry/types";
export type { AgentSnapshot };

export interface RegistryView {
  state: "fresh" | "degraded" | "stale" | "unavailable";
  agents: AgentSnapshot[];
  updatedAt?: number;
  warnings: string[];
}

const validateAgent = new Ajv2020().compile<AgentSnapshot>(JSON.parse(readFileSync(
  new URL(import.meta.resolve("@agent-hub/registry/schemas/agent-snapshot.schema.json")), "utf8",
)));
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validHealth = (value: unknown): value is Health => {
  if (!value || typeof value !== "object") return false;
  const h = value as Health;
  return h.version === 1 && timestamp(h.pid) && h.pid > 0 && timestamp(h.startedAt) && timestamp(h.updatedAt) &&
    ["starting", "running", "stopped"].includes(h.state) && timestamp(h.agentCount) &&
    (h.lastSuccessfulProcessDiscoveryAt === undefined || timestamp(h.lastSuccessfulProcessDiscoveryAt)) &&
    Array.isArray(h.errors) && h.errors.every(error => typeof error === "string");
};

export { registryDirectory } from "@agent-hub/registry/paths";

export async function readRegistry(directory: string, now = Date.now(), staleAfterMs = 30_000): Promise<RegistryView> {
  try {
    const [contents, healthText] = await Promise.all([
      readFile(join(directory, "agents.jsonl"), "utf8"),
      readFile(join(directory, "registry-health.json"), "utf8"),
    ]);
    const health: unknown = JSON.parse(healthText);
    if (!validHealth(health)) throw new Error("Invalid registry health record");
    const warnings = [...health.errors];
    const agents: AgentSnapshot[] = [];
    const keys = new Set<string>();
    for (const [index, line] of contents.split("\n").entries()) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!validateAgent(value) || value.observedAt > now + 5000 || value.process.startedAt > value.observedAt) throw new Error();
        const key = `${value.harness}:${value.process.pid}:${value.process.startedAt}`;
        if (keys.has(key)) throw new Error();
        keys.add(key);
        agents.push(value);
      } catch { warnings.push(`Invalid registry snapshot line ${index + 1}; skipped.`); }
    }
    const recent = (at: number | undefined) => at !== undefined && at <= now + 5000 && now - at <= staleAfterMs;
    const stale = health.state !== "running" || !recent(health.updatedAt) || !recent(health.lastSuccessfulProcessDiscoveryAt);
    if (stale) warnings.unshift("Registry observations are stale; pane actions disabled.");
    return { state: stale ? "stale" : warnings.length ? "degraded" : "fresh", agents, updatedAt: health.updatedAt, warnings };
  } catch (error) {
    return { state: "unavailable", agents: [], warnings: [`Registry unavailable: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
