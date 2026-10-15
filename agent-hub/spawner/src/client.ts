import { agentId } from './identity.js';
export { agentId } from './identity.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { exchange } from './io.js';
import type { Request, Task } from './types.js';
export type { SpawnInput, Parent, Task } from './types.js';
export function spawnerDirectory(): string {
  return resolve(process.env.AGENTS_SPAWNER_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'agents-spawner'));
}
export function createSpawnerClient(directory = spawnerDirectory()) {
  return {
    async request(request: Request, timeout = 45000): Promise<Record<string, unknown>> {
      const response = await exchange(join(directory, 'spawner.sock'), request, timeout);
      if (!response.ok) throw new Error(response.error ?? 'Spawner request failed');
      return response.data;
    },
  };
}
export function taskSummary(task: Task): Record<string, unknown> {
  return {
    agent_id: task.pid !== undefined && task.startedAt !== undefined ? agentId({ harness: task.input.harness, process: { pid: task.pid, startedAt: task.startedAt } }) : null,
    task_id: task.id, status: task.status, mode: task.input.mode, harness: task.input.harness,
    cwd: task.input.cwd, process_state: task.processState, delivery: task.delivery,
    ...(task.deliveryError ? { delivery_error: task.deliveryError } : {}),
    ...(task.pane ? { tmux: { socket: task.tmuxSocket, pane: task.pane } } : {}),
    ...(task.sessionId ? { session_id: task.sessionId } : {}),
    ...(task.routing ? { routing: task.routing } : {}),
    ...(task.execution ? { execution: { harness: task.execution.harness, provider: task.execution.provider, model: task.execution.model, effort: task.execution.effort } } : {}),
    result_path: join(task.directory, 'completion.json'),
  };
}
