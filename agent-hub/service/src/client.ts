import { createConnection } from 'node:net';
import { join } from 'node:path';
import type { Health } from '@agent-hub/registry/types';
import type { Config } from './config.js';

export interface HubResponse {
  ok: boolean;
  error?: string;
  pid?: number;
  config?: Config;
  tmux?: { tmuxSocket: string; tmuxSession: string };
  supervisor?: 'running' | 'disabled';
  registry?: Health | { error?: string };
}

export function request(directory: string, action: 'status' | 'stop', timeoutMs = 10000): Promise<HubResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(directory, 'hub.sock'));
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Hub request timed out')); }, timeoutMs);
    let input = '';
    let done = false;
    const finish = (error?: Error, value?: unknown) => {
      if (done) return;
      done = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value as HubResponse);
    };
    socket.once('error', error => finish(error));
    socket.once('connect', () => socket.write(JSON.stringify({ action }) + '\n'));
    socket.on('data', chunk => {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 65536) { finish(new Error('Hub response too large')); return; }
      const end = input.indexOf('\n');
      if (end < 0) return;
      try { finish(undefined, JSON.parse(input.slice(0, end))); } catch { finish(new Error('Invalid hub response')); }
    });
    socket.once('end', () => { if (!done) finish(new Error('Hub closed without a response')); });
  });
}
