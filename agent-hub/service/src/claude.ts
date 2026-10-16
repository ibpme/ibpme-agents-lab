import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const claudeUsage = `agent-hub claude <install|uninstall> [--hooks] [--statusline] [--settings FILE]

Install or remove the Claude Code registry publishers in Claude's settings.json.
With neither --hooks nor --statusline, both are selected.
  --hooks            Lifecycle hooks that report Claude activity
  --statusline       Wrap the existing command status line to report model/session
  --settings FILE    Settings file (default: $CLAUDE_CONFIG_DIR or ~/.claude settings.json)

The status-line publisher wraps an existing command status line, so configure
one first. Uninstall restores what installation changed.`;

const publishers = { hooks: 'install.mjs', statusline: 'install-statusline.mjs' } as const;

export function claude(args: string[]): number {
  const action = args[0];
  if (action !== 'install' && action !== 'uninstall') throw new Error(claudeUsage);
  const selected = new Set<keyof typeof publishers>();
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
  for (const name of selected.size ? selected : Object.keys(publishers) as (keyof typeof publishers)[]) {
    const script = fileURLToPath(import.meta.resolve(`@agent-hub/registry/publishers/claude/${publishers[name]}`));
    const result = spawnSync(process.execPath, [script, ...forwarded], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) status = 1;
  }
  return status;
}
