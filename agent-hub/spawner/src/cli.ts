#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadRoutingConfig } from './routing.js';
import { spawnerDirectory } from './client.js';
import { startSupervisor } from './supervisor.js';
import { prepareTmux } from './tmux.js';
const { values } = parseArgs({ options: {
  'tmux-socket': { type: 'string' }, 'tmux-session': { type: 'string' },
  'routing-config': { type: 'string' },
  'recover-lock': { type: 'boolean' }, pi: { type: 'string' }, directory: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: agent-spawn [--directory PATH] [--pi PATH] [--routing-config PATH] [--recover-lock] [--tmux-socket PATH] [--tmux-session NAME]\nUses the current tmux server/session when inside tmux; otherwise creates a dedicated server/session.\nFlags override the inferred defaults. Runs in the foreground.');
} else {
  const directory = resolve(values.directory ?? spawnerDirectory());
  const routingConfig = values['routing-config'] ? await loadRoutingConfig(resolve(values['routing-config'])) : undefined;
  const tmux = await prepareTmux({ directory, socket: values['tmux-socket'], session: values['tmux-session'] });
  const runtime = await startSupervisor({
    directory, routingConfig, pi: values.pi, ...tmux, recoverLock: values['recover-lock'],
  });
  console.error(`agent-spawn ready (tmux socket: ${tmux.tmuxSocket}, session: ${tmux.tmuxSession})`);
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
