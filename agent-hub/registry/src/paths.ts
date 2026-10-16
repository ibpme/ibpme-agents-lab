import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

type Environment = Record<string, string | undefined>;

/** Root of all agent-hub state: control socket, config, and the registry and spawner directories. */
export function hubDirectory(env: Environment = process.env): string {
  return resolve(env.AGENT_HUB_DIR || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'agent-hub'));
}

export const registryDirectory = (env: Environment = process.env): string => join(hubDirectory(env), 'registry');
export const spawnerDirectory = (env: Environment = process.env): string => join(hubDirectory(env), 'spawner');
