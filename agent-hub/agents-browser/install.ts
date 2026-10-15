import { chmodSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultCli = fileURLToPath(new URL("./agents-browser", import.meta.url));
const help = `Usage: bun run install.ts <install|uninstall>

Install a symlink at ~/.local/bin/agents-browser pointing to this checkout's
launcher. Run bun install first. Keep the checkout available after installation.
Uninstall removes only this checkout's symlink. No browser or daemon is started.`;

export function installCli(action: string, { home = homedir(), cli = defaultCli }: { home?: string; cli?: string } = {}): string {
  if (action !== "install" && action !== "uninstall") throw new Error(help);
  const target = resolve(cli);
  const link = join(home, ".local/bin/agents-browser");
  let existing: ReturnType<typeof lstatSync> | undefined;
  try { existing = lstatSync(link); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing && (!existing.isSymbolicLink() || resolve(dirname(link), readlinkSync(link)) !== target)) {
    throw new Error(`Refusing to modify an existing file or unrelated symlink: ${link}`);
  }
  if (action === "uninstall") {
    if (existing) unlinkSync(link);
    return `Removed CLI link: ${link}. Checkout and registry state preserved.`;
  }
  const launcher = statSync(target);
  if (!launcher.isFile()) throw new Error(`Launcher is not a file: ${target}`);
  chmodSync(target, launcher.mode | 0o111);
  mkdirSync(dirname(link), { recursive: true });
  if (!existing) symlinkSync(target, link);
  return `Installed: ${link} -> ${target}\nEnsure ~/.local/bin and Bun are on PATH. No browser or daemon was started.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log(help);
    else if (args.length !== 1) throw new Error(help);
    else console.log(installCli(args[0]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
