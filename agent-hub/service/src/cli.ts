#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Commands are imported on demand so that hooks and the status line start quickly.
import { commandUsage, usage } from './usage.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || ['help', '--help', '-h'].includes(command)) {
    const topic = command ? args[1] : undefined;
    if (topic === 'view') { process.exitCode = await (await import('./view.ts')).view(['--help']); return; }
    if (topic !== undefined && !commandUsage[topic]) throw new Error(`Unknown command: ${topic}\n\n${usage}`);
    console.log(topic ? commandUsage[topic] : usage);
    return;
  }
  if (command === 'view') { process.exitCode = await (await import('./view.ts')).view(args.slice(1)); return; }
  if (commandUsage[command] && args.length === 2 && ['--help', '-h'].includes(args[1]!)) { console.log(commandUsage[command]); return; }
  switch (command) {
    case 'start': case 'status': case 'stop': return (await import('./lifecycle.ts')).lifecycle(args);
    case 'publish': return (await import('./publish.ts')).publish(args.slice(1));
    case 'route': process.exitCode = await (await import('./route.ts')).route(args.slice(1)); return;
    case 'claude': process.exitCode = await (await import('./claude.ts')).claude(args.slice(1)); return;
    default: throw new Error(`Unknown command: ${command}\n\n${usage}`);
  }
}

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
  // A background start waits for this child's readiness or failure over IPC.
  if (process.send) await (await import('./lifecycle.ts')).notifyParent({ error: message });
});
