import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execute } from './io.js';

interface TmuxOptions {
  directory: string;
  socket?: string;
  session?: string;
  env?: NodeJS.ProcessEnv;
}
type Run = (args: string[]) => Promise<string>;
const runTmux: Run = async args => (await execute('tmux', args, { timeout: 5000 })).stdout.trim();

export async function prepareTmux(options: TmuxOptions, run: Run = runTmux): Promise<{ tmuxSocket: string; tmuxSession: string }> {
  const env = options.env ?? process.env;
  // TMUX ends in ,server-pid,session-index; socket paths may contain commas.
  const inheritedSocket = env.TMUX?.match(/^(.*),\d+,\d+$/)?.[1];
  const tmuxSocket = options.socket ?? inheritedSocket ?? join(options.directory, 'tmux.sock');
  if (!isAbsolute(tmuxSocket)) throw new Error('Tmux socket path must be absolute');
  if (Buffer.byteLength(tmuxSocket) > 100) throw new Error('Tmux socket path exceeds 100 bytes; use --tmux-socket with a shorter path');
  let tmuxSession = options.session;
  if (tmuxSession === undefined && inheritedSocket === tmuxSocket) {
    const target = env.TMUX_PANE ? ['-t', env.TMUX_PANE] : [];
    tmuxSession = await run(['-S', tmuxSocket, 'display-message', '-p', ...target, '#{session_name}']);
    if (!tmuxSession) throw new Error('Could not detect the current tmux session');
  }
  tmuxSession ??= 'agent-spawn';
  if (!tmuxSession.trim() || tmuxSession.includes(':') || tmuxSession.includes('\0')) throw new Error('Invalid tmux session name');
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  try {
    await run(['-S', tmuxSocket, 'has-session', '-t', `=${tmuxSession}`]);
  } catch {
    await run(['-S', tmuxSocket, 'new-session', '-Ad', '-s', tmuxSession]);
  }
  return { tmuxSocket, tmuxSession };
}
