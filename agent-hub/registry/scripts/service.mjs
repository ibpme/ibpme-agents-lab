#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'io.agent-hub.agents-registry';
const marker = 'Managed by agents-registry service installer';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Usage: node scripts/service.mjs <install|uninstall> [options]
  --dry-run              Print configuration without changing files or services
  --directory PATH       Registry state directory (same default as the CLI)
  --interval MS          Discovery interval (default 5000)
  --activity-ttl MS      Activity expiry (default 20000)
  --tmux-socket PATH     Absolute tmux socket path; repeatable

Run as your regular user, never with sudo. Install requires a built checkout.
Captures this Node executable and PATH; reinstall after moving/upgrading them.
Uninstall removes only the service, preserving registry state and logs.`;

function safe(value) {
  if (/[\x00-\x1f\x7f]/u.test(value)) throw new Error('Control characters are not supported in service configuration');
  return value;
}
const unitQuote = value => `"${safe(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
const execQuote = value => unitQuote(value).replaceAll('$', () => '$$');
const xml = value => safe(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function renderService({ platform, node, cli, directory, path, home, args = [] }) {
  const argv = [node, cli, 'start', '--foreground', '--directory', directory, ...args];
  if (platform === 'linux') return `# ${marker}
[Unit]
Description=Machine-local agent registry
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${argv.map(execQuote).join(' ')}
Environment=${unitQuote(`PATH=${path}`)} ${unitQuote(`HOME=${home}`)}
Restart=on-failure
RestartSec=35
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
`;
  if (platform !== 'darwin') throw new Error('Only Linux (systemd) and macOS (launchd) are supported');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${marker} -->
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${argv.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(home)}</string></dict>
<key>WorkingDirectory</key><string>${xml(dirname(cli))}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>35</integer>
<key>ExitTimeOut</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(directory, 'service.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, 'service.stderr.log'))}</string>
</dict></plist>
`;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { console.log(help); return; }
  const action = argv.shift();
  if (!['install', 'uninstall'].includes(action)) throw new Error(help);
  const platform = process.platform;
  if (!['linux', 'darwin'].includes(platform)) throw new Error('Only Linux and macOS are supported');
  if (process.getuid?.() === 0) throw new Error('Run as your regular user, not root or sudo');
  let directory = resolve(process.env.AGENTS_REGISTRY_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'agents-registry'));
  let dryRun = false;
  const args = [];
  while (argv.length) {
    const option = argv.shift();
    if (option === '--dry-run') { dryRun = true; continue; }
    if (!['--directory', '--interval', '--activity-ttl', '--tmux-socket'].includes(option)) throw new Error(`Unknown option: ${option}`);
    const value = argv.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--directory') { directory = resolve(value); continue; }
    if (option === '--tmux-socket') {
      if (!isAbsolute(value)) throw new Error('--tmux-socket must be absolute');
    } else if (!Number.isSafeInteger(Number(value)) || Number(value) < 100 || Number(value) > 2147483647) {
      throw new Error(`${option} must be an integer between 100 and 2147483647`);
    }
    args.push(option, value);
  }
  if (Buffer.byteLength(join(directory, 'registry.sock')) > 100) throw new Error('Socket path exceeds 100 bytes; choose a shorter --directory');
  const cli = join(root, 'dist/cli.js');
  const file = platform === 'linux'
    ? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd/user/agents-registry.service')
    : join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const content = renderService({ platform, node: process.execPath, cli, directory, path: process.env.PATH ?? '/usr/bin:/bin', home: homedir(), args });
  if (dryRun) { console.log(`${action}: ${file}\n${action === 'install' ? content : '(state and logs preserved)'}`); return; }
  const existing = existsSync(file);
  if (existing && !readFileSync(file, 'utf8').includes(marker)) throw new Error(`Refusing to modify unmanaged file: ${file}`);
  if (action === 'install' && !existsSync(cli)) throw new Error('Run npm ci && npm run build first');
  const run = (cmd, parameters) => execFileSync(cmd, parameters, { stdio: 'inherit' });
  const domain = `gui/${process.getuid()}`;
  if (platform === 'linux') {
    // Fail before touching configuration when the user service manager is unavailable.
    execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
    if (existing) run('systemctl', ['--user', 'disable', '--now', 'agents-registry.service']);
  } else if (existing) {
    // An unloaded job is normal (for example, after logging out and back in).
    let loaded = false;
    try { execFileSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }); loaded = true; } catch {}
    if (loaded) run('launchctl', ['bootout', `${domain}/${label}`]);
  }
  if (action === 'uninstall') {
    if (existing) unlinkSync(file);
    if (platform === 'linux') run('systemctl', ['--user', 'daemon-reload']);
    console.log(`Removed service configuration: ${file}. State and logs preserved.`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(file, content, { mode: 0o600 });
  if (platform === 'linux') {
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'reset-failed', 'agents-registry.service']);
    run('systemctl', ['--user', 'enable', '--now', 'agents-registry.service']);
  } else {
    run('launchctl', ['enable', `${domain}/${label}`]);
    run('launchctl', ['bootstrap', domain, file]);
  }
  console.log(`Installed: ${file}\nCheck registry health: ${process.execPath} ${cli} status --directory ${JSON.stringify(directory)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
