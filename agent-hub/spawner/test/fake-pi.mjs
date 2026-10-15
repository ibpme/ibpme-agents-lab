#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.env.AGENT_HUB_SPAWN_DIR;
const { input } = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8'));
const write = (name, data) => {
  const path = join(directory, name);
  writeFileSync(path + '.tmp', JSON.stringify(data));
  renameSync(path + '.tmp', path);
};
write('launch-args.json', process.argv.slice(2));
write('ready.json', { pid: process.pid, sessionId: 'fake-session' });
if (input.prompt === 'crash') setTimeout(() => process.exit(1), 100);
else if (input.prompt && input.prompt !== 'wait') setTimeout(() => {
  write('completion.json', { status: 'completed', text: input.prompt === 'large' ? 'x'.repeat(70000) : 'Final answer' });
  if (input.mode === 'headless') process.exit(0);
}, input.prompt === 'slow' ? 500 : 100);
const timer = setInterval(() => {
  if (existsSync(join(directory, 'cancel.json'))) {
    write('completion.json', { status: 'cancelled', text: 'Partial output' });
    clearInterval(timer);
    if (input.mode === 'headless') process.exit(0);
  }
}, 20);
process.stdin.on('data', data => write('manual.json', data.toString()));
process.stdin.resume();
