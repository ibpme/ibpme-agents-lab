#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, fchmodSync, openSync } from 'node:fs';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from './client.js';
import { resolveConfig } from './config.js';
import { startService } from './service.js';

const usage = `agent-hub <start|status|stop> [options]
  --directory PATH          Control directory (AGENT_HUB_DIR or XDG state/agent-hub)
  --background              Detached launch (start only)
  --foreground              Foreground launch, the default (start only)
  --registry-directory PATH Registry state directory (start only)
  --spawner-directory PATH  Spawner state directory (start only)
  --interval MS             Discovery interval (start only)
  --activity-ttl MS         Activity expiry (start only)
  --tmux-socket PATH        Repeat to watch multiple servers; first is used by spawner
  --tmux-session NAME       Spawner tmux session (start only)
  --routing-config PATH     Supervisor model routing configuration (start only)
  --pi PATH                 Pi executable (start only)
  --recover-lock            Recover stale spawner ownership (start only)
  --registry-only           Run without the spawner (start only)
  --help                    Show this help

Control requests use hub.sock inside the control directory.
Defaults may be set in <control-directory>/config.json; explicit flags override them.
Registry and spawner directories retain their AGENTS_* / XDG defaults;
--directory changes only the hub control directory.
No hooks, Pi extensions, or OS startup configuration are installed.`;

const delay = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));
const absent = (error: unknown): boolean => ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException)?.code ?? '');
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
type Config = ReturnType<typeof resolveConfig>;

function parse(args: string[]): { command: string; background: boolean; options: NonNullable<Parameters<typeof resolveConfig>[0]> } {
  const command = args.shift();
  if (!command || !['start', 'status', 'stop'].includes(command)) throw new Error(usage);
  const options: NonNullable<Parameters<typeof resolveConfig>[0]> = {};
  let background = false;
  let foreground = false;
  const seen = new Set<string>();
  while (args.length) {
    const option = args.shift()!;
    if (!['--directory', '--background', '--foreground', '--registry-directory', '--spawner-directory', '--interval', '--activity-ttl', '--tmux-socket', '--tmux-session', '--pi', '--routing-config', '--recover-lock', '--registry-only'].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    if (seen.has(option) && option !== '--tmux-socket') throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (command !== 'start' && option !== '--directory') throw new Error(`${option} is only valid for start`);
    if (option === '--background') { background = true; continue; }
    if (option === '--foreground') { foreground = true; continue; }
    if (option === '--recover-lock') { options.recoverLock = true; continue; }
    if (option === '--registry-only') { options.registryOnly = true; continue; }
    const value = args.shift();
    if (!value || !value.trim() || value.startsWith('--') || value.includes('\0')) throw new Error(`Missing or invalid value for ${option}`);
    switch (option) {
      case '--directory': options.directory = resolve(value); break;
      case '--registry-directory': options.registryDirectory = resolve(value); break;
      case '--spawner-directory': options.spawnerDirectory = resolve(value); break;
      case '--routing-config': options.routingConfigPath = resolve(value); break;
      case '--pi': options.pi = value; break;
      case '--tmux-session':
        if (value.includes(':')) throw new Error('Invalid tmux session name');
        options.tmuxSession = value;
        break;
      case '--tmux-socket':
        if (!isAbsolute(value)) throw new Error('--tmux-socket must be an absolute path');
        if (Buffer.byteLength(value) > 100) throw new Error('--tmux-socket must not exceed 100 bytes');
        (options.tmuxServers ??= []).push(value);
        break;
      case '--interval':
      case '--activity-ttl': {
        const number = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 100 || number > 2147483647) {
          throw new Error(`${option} must be an integer between 100 and 2147483647`);
        }
        if (option === '--interval') options.intervalMs = number;
        else options.activityTtlMs = number;
        break;
      }
    }
  }
  if (background && foreground) throw new Error('Choose either --background or --foreground');
  return { command, background, options };
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Not a private directory: ${directory}`);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Directory is owned by another user: ${directory}`);
  await chmod(directory, 0o700);
}

function childFlags(config: Config): string[] {
  const flags = ['start', '--foreground', '--directory', config.directory,
    '--registry-directory', config.registryDirectory, '--spawner-directory', config.spawnerDirectory,
    '--interval', String(config.intervalMs), '--activity-ttl', String(config.activityTtlMs),
    ...config.tmuxServers.flatMap(socket => ['--tmux-socket', socket])];
  if (config.tmuxSession !== undefined) flags.push('--tmux-session', config.tmuxSession);
  if (config.routingConfigPath !== undefined) flags.push('--routing-config', config.routingConfigPath);
  if (config.pi !== undefined) flags.push('--pi', config.pi);
  if (config.recoverLock) flags.push('--recover-lock');
  if (config.registryOnly) flags.push('--registry-only');
  return flags;
}

async function backgroundStart(config: Config): Promise<void> {
  try {
    const response = await request(config.directory, 'status');
    if (!response.ok) throw new Error(response.error ?? 'Service status failed');
    console.log(`Agent hub already running (PID ${response.pid})`);
    return;
  } catch (error) {
    if (!absent(error)) throw error;
  }
  await privateDirectory(config.directory);
  const logPath = join(config.directory, 'daemon.log');
  const log = openSync(logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    const stat = fstatSync(log);
    if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid())) throw new Error(`Not a private log file: ${logPath}`);
    fchmodSync(log, 0o600);
    child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...childFlags(config)], {
      detached: true, stdio: ['ignore', log, log, 'ipc'],
    });
  } finally {
    closeSync(log);
  }
  await new Promise<void>((done, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('message', onMessage);
    };
    const fail = (error: Error): void => {
      cleanup();
      child.kill('SIGTERM');
      if (child.connected) child.disconnect();
      child.unref();
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      fail(new Error(`Agent hub startup exited (${signal ?? code}); inspect ${logPath}`));
    };
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== 'object') return;
      const result = message as { ready?: boolean; error?: string };
      if (result.ready === true) {
        cleanup();
        if (child.connected) child.disconnect();
        done();
      } else if (typeof result.error === 'string') {
        fail(new Error(result.error));
      }
    };
    const timeout = setTimeout(() => fail(new Error(`Agent hub startup timed out; inspect ${logPath}`)), 20000);
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
  });
  child.unref();
  console.log(`Agent hub running in background (PID ${child.pid}) at ${config.directory}`);
}

function notifyParent(message: { ready: true } | { error: string }): Promise<void> {
  return new Promise(done => {
    if (!process.send || !process.connected) { done(); return; }
    process.send(message, () => {
      if (process.connected) process.disconnect();
      done();
    });
  });
}

async function foregroundStart(config: Config): Promise<void> {
  let runtime: Awaited<ReturnType<typeof startService>> | undefined;
  let interrupted = false;
  let stopping: Promise<void> | undefined;
  const stop = (): void => {
    interrupted = true;
    if (!runtime || stopping) return;
    stopping = Promise.resolve().then(() => runtime!.stop()).then(() => undefined).catch(error => {
      console.error(messageOf(error));
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    runtime = await startService(config);
    if (interrupted) stop();
    else {
      await notifyParent({ ready: true });
      console.log(`Agent hub running (PID ${process.pid}) at ${config.directory}`);
    }
    await runtime.closed;
    await stopping;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if ((args.length === 1 && ['help', '--help', '-h'].includes(args[0]!)) ||
      (args.length === 2 && ['start', 'status', 'stop'].includes(args[0]!) && args[1] === '--help')) {
    console.log(usage);
    return;
  }
  const { command, background, options } = parse(args);
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  const directory = resolve(options.directory ?? (process.env.AGENT_HUB_DIR || join(stateHome, 'agent-hub')));
  if (command === 'status') {
    const response = await request(directory, 'status');
    if (!response.ok) throw new Error(response.error ?? 'Service status failed');
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (command === 'stop') {
    const response = await request(directory, 'stop');
    if (!response.ok) throw new Error(response.error ?? 'Service stop failed');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        await request(directory, 'status', Math.min(1000, Math.max(1, deadline - Date.now())));
      } catch (error) {
        if (absent(error)) {
          const ownership = await lstat(join(directory, 'hub.lock')).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
          });
          if (!ownership) {
            console.log('Agent hub stopped');
            return;
          }
        } else {
          // Shutdown can close an accepted probe before replying. Wait for both
          // endpoint disappearance and lease release before reporting success.
          const code = (error as NodeJS.ErrnoException)?.code;
          if (code !== 'ECONNRESET' && code !== 'EPIPE' && messageOf(error) !== 'Hub closed without a response' && messageOf(error) !== 'Hub request timed out') throw error;
        }
      }
      await delay(50);
    }
    throw new Error('Stop requested, but service control socket or ownership lock remained after 15 seconds');
  }
  const config = resolveConfig({ ...options, directory });
  if (background) await backgroundStart(config);
  else await foregroundStart(config);
}

main().catch(async error => {
  const message = messageOf(error);
  console.error(message);
  process.exitCode = 1;
  await notifyParent({ error: message });
});
