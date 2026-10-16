import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareTmux } from '../src/tmux.ts';
import { execute } from '../src/io.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'spawn-tmux-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('infers socket and current pane session, including comma-containing paths', async t => {
  const directory = await fixture(t);
  const calls: string[][] = [];
  const result = await prepareTmux({ directory, env: { TMUX: '/tmp/with,comma.sock,123,0', TMUX_PANE: '%7' } }, async args => {
    calls.push(args);
    return args.includes('display-message') ? '0' : '';
  });
  assert.deepEqual(result, { tmuxSocket: '/tmp/with,comma.sock', tmuxSession: '0' });
  assert.deepEqual(calls, [
    ['-S', '/tmp/with,comma.sock', 'display-message', '-p', '-t', '%7', '#{session_name}'],
    ['-S', '/tmp/with,comma.sock', 'has-session', '-t', '=0'],
  ]);
});

test('session override uses inherited socket without querying current session', async t => {
  const directory = await fixture(t);
  const calls: string[][] = [];
  const result = await prepareTmux({ directory, session: 'workers', env: { TMUX: '/tmp/current.sock,123,0' } }, async args => {
    calls.push(args); return '';
  });
  assert.equal(result.tmuxSession, 'workers');
  assert.deepEqual(calls, [['-S', '/tmp/current.sock', 'has-session', '-t', '=workers']]);
});

test('socket override uses a dedicated session rather than querying another server with the current pane', async t => {
  const directory = await fixture(t);
  const calls: string[][] = [];
  const result = await prepareTmux({ directory, socket: '/tmp/override.sock', env: { TMUX: '/tmp/current.sock,123,0', TMUX_PANE: '%7' } }, async args => {
    calls.push(args);
    if (args.includes('has-session')) throw new Error('No session');
    return '';
  });
  assert.deepEqual(result, { tmuxSocket: '/tmp/override.sock', tmuxSession: 'agent-hub' });
  assert.deepEqual(calls[1], ['-S', '/tmp/override.sock', 'new-session', '-Ad', '-s', 'agent-hub']);
});

test('both flags override the environment', async t => {
  const directory = await fixture(t);
  const result = await prepareTmux({ directory, socket: '/tmp/override.sock', session: 'workers', env: { TMUX: '/tmp/current.sock,123,0' } }, async () => '');
  assert.deepEqual(result, { tmuxSocket: '/tmp/override.sock', tmuxSession: 'workers' });
});

test('does not silently fall back when current-session detection fails', async t => {
  const directory = await fixture(t);
  await assert.rejects(prepareTmux({ directory, env: { TMUX: '/tmp/current.sock,123,0' } }, async () => { throw new Error('Server unavailable'); }), /Server unavailable/);
});

test('outside tmux creates and reuses an isolated server/session', async t => {
  const directory = await fixture(t);
  const socket = join(directory, 'tmux.sock');
  t.after(async () => { await execute('tmux', ['-S', socket, 'kill-server']).catch(() => {}); });
  const result = await prepareTmux({ directory, env: {} });
  assert.deepEqual(result, { tmuxSocket: socket, tmuxSession: 'agent-hub' });
  assert.deepEqual(await prepareTmux({ directory, env: {} }), result);
  const { stdout } = await execute('tmux', ['-S', socket, 'list-sessions', '-F', '#{session_name}']);
  assert.equal(stdout.trim(), 'agent-hub');
  // Numeric session names must remain session targets, not occupied window indices.
  await prepareTmux({ directory, socket, session: '0', env: {} });
  await execute('tmux', ['-S', socket, 'new-window', '-d', '-t', '0:']);
});
