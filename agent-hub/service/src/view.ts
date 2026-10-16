import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Runs the viewer from source with the current Node; options and help are handled by the viewer itself. */
export function view(args: string[]): Promise<number> {
  const cli = fileURLToPath(import.meta.resolve('@agent-hub/viewer/cli'));
  // Type stripping warns on stderr, which would garble the terminal UI.
  const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  return new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}
