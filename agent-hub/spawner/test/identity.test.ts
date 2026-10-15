import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { agentId, taskSummary } from '../dist/client.js';
import type { Task } from '../src/types.ts';

test('agent IDs match the messaging identity and distinguish process lifetimes and harnesses', () => {
  const agent = { harness: 'pi', process: { pid: 123, startedAt: 0 } };
  const expected = `agt_${createHash('sha256').update(JSON.stringify(['pi', 123, 0])).digest('hex').slice(0, 16)}`;
  assert.equal(agentId(agent), expected);
  assert.notEqual(agentId({ ...agent, harness: 'claude' }), expected);
  assert.notEqual(agentId({ ...agent, process: { pid: 123, startedAt: 1 } }), expected);
});

test('task summaries expose identity only when PID and start time are known', () => {
  const task: Task = {
    id: 'task_test', owner: 'test', input: { harness: 'pi', mode: 'interactive', cwd: '/tmp', parent: { agentId: 'parent', pid: 1, startedAt: 0, sessionId: 'parent' } },
    directory: '/tmp/task_test', createdAt: 0, status: 'starting', processState: 'starting', delivery: 'none',
  };
  assert.equal(taskSummary(task).agent_id, null);
  assert.equal(taskSummary({ ...task, pid: 123 }).agent_id, null);
  assert.equal(taskSummary({ ...task, startedAt: 0 }).agent_id, null);
  assert.equal(taskSummary({ ...task, pid: 123, startedAt: 0 }).agent_id, agentId({ harness: 'pi', process: { pid: 123, startedAt: 0 } }));
});
