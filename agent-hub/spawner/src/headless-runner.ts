// A detached pipe owner keeps RPC stdin alive across supervisor restarts.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { atomic } from './io.ts';
const [pi, ...args] = process.argv.slice(2);
const child = spawn(pi!, args, { stdio: ['pipe', 'ignore', 'inherit'], env: process.env });
process.once('SIGTERM', () => child.kill('SIGTERM'));
process.once('SIGINT', () => child.kill('SIGINT'));
child.on('error', async error => {
  await atomic(join(process.env.AGENT_HUB_SPAWN_DIR!, 'completion.json'), { status: 'failed', text: '', error: error.message });
  process.exitCode = 1;
});
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
