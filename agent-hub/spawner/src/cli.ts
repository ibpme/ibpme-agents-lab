#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { spawnerDirectory } from './client.js';
import { startSupervisor } from './supervisor.js';
const { values } = parseArgs({ options: {
  'tmux-socket': { type: 'string' }, 'tmux-session': { type: 'string' },
  'recover-lock': { type: 'boolean' }, pi: { type: 'string' }, directory: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: agents-spawner [--directory PATH] [--pi PATH] [--recover-lock] [--tmux-socket PATH --tmux-session NAME]\nRuns in the foreground. Start explicitly under tmux or your own process manager.');
} else {
  const runtime = await startSupervisor({
    directory: resolve(values.directory ?? spawnerDirectory()), pi: values.pi,
    tmuxSocket: values['tmux-socket'], tmuxSession: values['tmux-session'], recoverLock: values['recover-lock'],
  });
  console.error('agents-spawner ready');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await runtime.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
