import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const execute = promisify(execFile);
export async function atomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}
export async function json<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function processStart(pid: number): Promise<number | undefined> {
  try {
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {
      timeout: 1000, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    });
    const value = Date.parse(`${stdout.trim().replace(/\s+/g, ' ')} UTC`);
    return Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}
// Byte framing deliberately splits only LF, not Unicode line separators.
export function exchange(path: string, value: unknown, timeout = 10000, limit = 4 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('Socket request timed out; outcome may be unknown')), timeout);
    let done = false;
    function finish(error?: Error, result?: unknown): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.on('connect', () => socket.write(JSON.stringify(value) + '\n'));
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(new Error('Connection closed before response')));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length > limit) return finish(new Error('Response too large'));
      const end = data.indexOf(10);
      if (end < 0) return;
      try { finish(undefined, JSON.parse(data.subarray(0, end).toString('utf8'))); }
      catch { finish(new Error('Invalid JSON response')); }
    });
  });
}
