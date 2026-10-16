import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { registryDirectory as defaultRegistryDirectory } from '@agent-hub/registry/paths';
import { json, exchange, processStart } from './io.js';
import type { Task } from './types.js';
interface Row {
  harness: string;
  process: { pid: number; startedAt: number };
  session: { id?: string };
  messaging?: { protocol: string; path: string; reportedAt: number };
}
const fresh = (time: number): boolean => Number.isFinite(time) && time <= Date.now() + 5000 && Date.now() - time <= 20000;
export async function notifyParent(task: Task, registryDirectory?: string): Promise<void> {
  const directory = registryDirectory ?? defaultRegistryDirectory();
  const health = await json<{ state: string; updatedAt: number; lastSuccessfulProcessDiscoveryAt: number }>(join(directory, 'registry-health.json'));
  if (!health || health.state !== 'running' || !fresh(health.updatedAt) || !fresh(health.lastSuccessfulProcessDiscoveryAt)) throw new Error('Registry unavailable or stale');
  const { readFile } = await import('node:fs/promises');
  const rows: Row[] = (await readFile(join(directory, 'agents.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const parent = task.input.parent;
  const matches = rows.filter(row => row.harness === 'pi' && row.process.pid === parent.pid && row.process.startedAt === parent.startedAt);
  const row = matches.length === 1 ? matches[0] : undefined;
  const identity = row && `agt_${createHash('sha256').update(JSON.stringify([row.harness, row.process.pid, row.process.startedAt])).digest('hex').slice(0, 16)}`;
  if (!row || identity !== parent.agentId || row.session.id !== parent.sessionId || await processStart(parent.pid) !== parent.startedAt) throw new Error('Parent exited or changed session');
  if (row.messaging?.protocol !== 'pi-listener-v2' || !fresh(row.messaging.reportedAt)) throw new Error('Parent listener unavailable');
  const id = `completion_${task.id}`;
  const ack = await exchange(row.messaging.path, {
    version: 2, type: 'message', id, expectedSessionId: parent.sessionId,
    content: task.notification, deliverAs: 'steer',
  }, 6000, 65536);
  if (ack.version !== 2 || ack.type !== 'ack' || ack.id !== id || !ack.ok || !['accepted', 'duplicate'].includes(ack.status)) throw new Error(ack.error ?? 'Invalid delivery ACK');
}
