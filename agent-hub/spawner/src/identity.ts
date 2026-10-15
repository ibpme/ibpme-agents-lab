import { createHash } from 'node:crypto';

export function agentId(agent: { harness: string; process: { pid: number; startedAt: number } }): string {
  const identity = JSON.stringify([agent.harness, agent.process.pid, agent.process.startedAt]);
  return `agt_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}
