import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface ConfigInput {
  directory?: string;
  registryDirectory?: string;
  spawnerDirectory?: string;
  intervalMs?: number;
  activityTtlMs?: number;
  tmuxServers?: string[];
  tmuxSession?: string;
  pi?: string;
  recoverLock?: boolean;
  registryOnly?: boolean;
}
export interface Config extends ConfigInput {
  directory: string;
  registryDirectory: string;
  spawnerDirectory: string;
  intervalMs: number;
  activityTtlMs: number;
  tmuxServers: string[];
  registryOnly: boolean;
}
export function resolveConfig(input: ConfigInput = {}, env = process.env): Config {
  const state = env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  const directory = resolve(input.directory ?? env.AGENT_HUB_DIR ?? join(state, 'agent-hub'));
  let file: ConfigInput = {};
  try {
    const value: unknown = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.json must contain an object');
    const allowed = ['registryDirectory', 'spawnerDirectory', 'intervalMs', 'activityTtlMs', 'tmuxServers', 'tmuxSession', 'pi', 'registryOnly'];
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown config key: ${key}`);
    file = value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const merged = { ...file, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
  for (const key of ['registryDirectory', 'spawnerDirectory', 'tmuxSession', 'pi'] as const) {
    if (merged[key] !== undefined && (typeof merged[key] !== 'string' || !merged[key]!.trim() || merged[key]!.includes('\0'))) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['intervalMs', 'activityTtlMs'] as const) {
    const value = merged[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 100 || value > 2147483647)) throw new Error(`Invalid ${key}: expected integer between 100 and 2147483647`);
  }
  for (const key of ['registryOnly', 'recoverLock'] as const) if (merged[key] !== undefined && typeof merged[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  if (merged.tmuxServers !== undefined && (!Array.isArray(merged.tmuxServers) || merged.tmuxServers.some(path => typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')))) throw new Error('tmuxServers must be absolute socket paths');
  return {
    ...merged, directory,
    registryDirectory: resolve(merged.registryDirectory ?? env.AGENTS_REGISTRY_DIR ?? join(state, 'agents-registry')),
    spawnerDirectory: resolve(merged.spawnerDirectory ?? env.AGENTS_SPAWNER_DIR ?? join(state, 'agents-spawner')),
    intervalMs: merged.intervalMs ?? 5000, activityTtlMs: merged.activityTtlMs ?? 20000,
    tmuxServers: [...new Set(merged.tmuxServers ?? [])], registryOnly: merged.registryOnly ?? false,
  };
}
