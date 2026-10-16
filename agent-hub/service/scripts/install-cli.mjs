#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultCli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
const help = `Usage: node scripts/install-cli.mjs <install|uninstall>

Install a symlink at ~/.local/bin/agent-hub pointing to this checkout's
CLI source. Run npm ci from agent-hub/ first. No service is installed or started.
Uninstall removes only this checkout's symlink, preserving state and logs.`;

export function installCli(action, { home = homedir(), cli = defaultCli } = {}) {
  if (!['install', 'uninstall'].includes(action)) throw new Error(help);
  const target = resolve(cli);
  const link = join(home, '.local/bin/agent-hub');
  let existing;
  try { existing = lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isSymbolicLink() || resolve(dirname(link), readlinkSync(link)) !== target)) {
    throw new Error(`Refusing to modify an existing file or unrelated symlink: ${link}`);
  }
  if (action === 'uninstall') {
    if (existing) unlinkSync(link);
    return `Removed CLI link: ${link}. State and logs preserved.`;
  }
  let mode;
  try { mode = statSync(target).mode; } catch (error) {
    if (error.code === 'ENOENT') throw new Error('CLI source not found: ' + target);
    throw error;
  }
  chmodSync(target, mode | 0o111);
  mkdirSync(dirname(link), { recursive: true });
  if (!existing) symlinkSync(target, link);
  return `Installed: ${link} -> ${target}\nEnsure ~/.local/bin is on PATH. No hub process was started.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else if (args.length !== 1) throw new Error(help);
    else console.log(installCli(args[0]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
