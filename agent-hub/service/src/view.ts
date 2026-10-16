import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Runs the Bun-based viewer launcher; options and help are handled by the viewer itself. */
export function view(args: string[]): Promise<number> {
  const launcher = fileURLToPath(import.meta.resolve('@agent-hub/viewer/launcher'));
  const child = spawn(launcher, args, { stdio: 'inherit' });
  return new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}
