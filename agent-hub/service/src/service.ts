import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { startDaemon, type Daemon } from '@agent-hub/registry/daemon';
import { request as registryRequest } from '@agent-hub/registry/client';
import { startSupervisor } from '@agent-hub/spawner/supervisor';
import { prepareTmux } from '@agent-hub/spawner/tmux';
import { request } from './client.js';
import type { Config } from './config.js';

export async function startService(config: Config) {
  const socketPath = join(config.directory, 'hub.sock');
  if (Buffer.byteLength(socketPath) > 100) throw new Error('Hub socket path exceeds 100 bytes; choose a shorter --directory');
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const info = await lstat(config.directory);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) throw new Error('Hub directory must be owned by the current user');
  await chmod(config.directory, 0o700);
  const release = await lockfile.lock(join(config.directory, 'hub'), {
    realpath: false, lockfilePath: join(config.directory, 'hub.lock'), stale: 30000, update: 10000, retries: 0,
    onCompromised: error => { console.error(`Hub ownership compromised: ${error.message}`); process.exit(1); },
  });
  let registry: Daemon | undefined;
  let supervisor: Awaited<ReturnType<typeof startSupervisor>> | undefined;
  let stopping: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const sockets = new Set<Socket>();
  let tmux: { tmuxSocket: string; tmuxSession: string } | undefined;
  const server = createServer(socket => {
    if (stopping || sockets.size >= 32) { socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(10000, () => socket.destroy());
    let input = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += chunk.toString();
      if (Buffer.byteLength(input) > 1024) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      void (async () => {
        const value = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (value.action === 'stop') {
          socket.once('finish', () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
          return { ok: true };
        }
        if (value.action !== 'status') throw new Error('Unknown hub action');
        const response = await registryRequest(config.registryDirectory, { version: 1, type: 'status' });
        return { ok: true, pid: process.pid, config, tmux, supervisor: supervisor ? 'running' : 'disabled', registry: response.ok ? response.health : { error: response.error } };
      })().then(result => socket.end(JSON.stringify(result) + '\n'), error => socket.end(JSON.stringify({ ok: false, error: String(error) }) + '\n'));
    });
  });
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      // Keep discovery and parent routing available until supervisor delivery has drained.
      try { await supervisor?.close(); }
      finally {
        try { await registry?.stop(); }
        finally {
          for (const socket of sockets) socket.destroy();
          if (server.listening) {
            await new Promise<void>(resolve => server.close(() => resolve()));
            await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
          await release();
          resolveClosed();
        }
      }
    })();
    return stopping;
  };
  try {
    const previous = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (previous) {
      if (!previous.isSocket() || (process.getuid && previous.uid !== process.getuid())) throw new Error('Refusing to replace an unowned or non-socket hub path');
      try { await request(config.directory, 'status'); throw new Error('Hub socket is already running'); }
      catch (error) {
        if (!['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    if (!config.registryOnly) tmux = await prepareTmux({ directory: config.spawnerDirectory, socket: config.tmuxServers[0], session: config.tmuxSession });
    const tmuxServers = [...new Set([...config.tmuxServers, ...(tmux ? [tmux.tmuxSocket] : [])])];
    registry = await startDaemon({ directory: config.registryDirectory, intervalMs: config.intervalMs, activityTtlMs: config.activityTtlMs, tmuxServers });
    if (!config.registryOnly) supervisor = await startSupervisor({ directory: config.spawnerDirectory, registryDirectory: config.registryDirectory, pi: config.pi, routingConfigPath: config.routingConfigPath, recoverLock: config.recoverLock, ...tmux });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    server.on('error', error => { console.error(error); void stop(); });
    // A legacy registry stop request must stop the whole service, not leave half running.
    void registry.closed.then(() => { if (!stopping) void stop(); });
    return { closed, stop };
  } catch (error) { await stop(); throw error; }
}
