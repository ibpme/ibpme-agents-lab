import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeUsage } from './usage.ts';

const installers = { hooks: 'install.mjs', statusline: 'install-statusline.mjs' } as const;
const publisher = (file: string): string => import.meta.resolve(`@agent-hub/registry/publishers/claude/${file}`);

export async function claude(args: string[]): Promise<number> {
  const action = args[0];
  // Entry points written into Claude's settings by the installers.
  if (action === 'hook' && args.length === 1) {
    await (await import(publisher('hook.mjs')) as { runHook(): Promise<void> }).runHook();
    return 0;
  }
  if (action === 'statusline' && args.length === 3 && args[1] === '--command' && args[2]!.trim()) {
    await (await import(publisher('statusline-wrapper.mjs')) as { runStatusline(command: string): Promise<void> }).runStatusline(args[2]!);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  }
  if (action !== 'install' && action !== 'uninstall') throw new Error(claudeUsage);
  const selected = new Set<keyof typeof installers>();
  const forwarded: string[] = action === 'uninstall' ? ['--uninstall'] : [];
  for (let i = 1; i < args.length; i++) {
    const option = args[i];
    if (option === '--hooks') selected.add('hooks');
    else if (option === '--statusline') selected.add('statusline');
    else if (option === '--settings') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --settings');
      forwarded.push('--settings', resolve(value));
    } else throw new Error(`Unknown option: ${option}\n\n${claudeUsage}`);
  }
  let status = 0;
  for (const name of selected.size ? selected : Object.keys(installers) as (keyof typeof installers)[]) {
    const result = spawnSync(process.execPath, [fileURLToPath(publisher(installers[name])), ...forwarded], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) status = 1;
  }
  return status;
}
