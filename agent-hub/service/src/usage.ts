// Help text lives apart from the commands so help never loads their dependencies.
export const lifecycleUsage = `agent-hub <start|status|stop> [options]
  --directory PATH          State directory (AGENT_HUB_DIR, else XDG state/agent-hub)
  --background              Detached launch (start only)
  --foreground              Foreground launch, the default (start only)
  --interval MS             Discovery interval (start only)
  --activity-ttl MS         Activity expiry (start only)
  --tmux-socket PATH        Repeat to watch multiple servers; first is used by spawner
  --tmux-session NAME       Spawner tmux session (start only)
  --routing-config PATH     Supervisor model routing configuration (start only)
  --pi PATH                 Pi executable (start only)
  --recover-lock            Recover stale spawner ownership (start only)
  --registry-only           Run without the spawner (start only)
  --help                    Show this help

The state directory holds hub.sock, config.json and the registry/ and spawner/
directories. Defaults may be set in config.json; explicit flags override them.
No hooks, Pi extensions, or OS startup configuration are installed.`;

export const usage = `agent-hub <command> [options]

Commands:
  start      Run the registry and spawn supervisor
  status     Report service configuration and health
  stop       Stop the service
  view       Browse live agents and transcripts
  publish    Send one registry publisher message from stdin
  route      Validate or test model routing configuration
  claude     Install or remove the Claude Code registry publishers
  help       Show help for a command

Run agent-hub help <command> for its options. All state lives in AGENT_HUB_DIR
(default: XDG state/agent-hub, usually ~/.local/state/agent-hub).`;

export const publishUsage = `agent-hub publish [--directory PATH]

Read one versioned registry publisher message from stdin and send it to the
running registry.
  --directory PATH   State directory (AGENT_HUB_DIR, else XDG state/agent-hub)`;

export const routeUsage = `agent-hub route validate [--config PATH] [--directory PATH]
agent-hub route test [--config PATH] [--directory PATH] [PROMPT | --prompt TEXT | --stdin]
                     [--routing-hint TEXT] [--require-classifier]

Check model routing configuration without spawning Pi.
validate  Check every profile against Pi's local catalog and configured auth.
test      Route a delegated prompt. With no prompt or only one configured
          profile, resolve the default profile without calling System One.
--config defaults to routingConfigPath in the state directory's config.json.
--routing-hint supplies optional advisory routing context, not child instructions.
--require-classifier exits 2 unless System One selected the profile.
JSON output does not echo the prompt, agent hint, profile system instructions, or credentials.
TYPESAFE_API_KEY authenticates System 1. A real prompt test sends text to TypeSafe.`;

export const claudeUsage = `agent-hub claude <install|uninstall> [--hooks] [--statusline] [--settings FILE]

Install or remove the Claude Code registry publishers in Claude's settings.json.
With neither --hooks nor --statusline, both are selected.
  --hooks            Lifecycle hooks that report Claude activity
  --statusline       Wrap the existing command status line to report model/session
  --settings FILE    Settings file (default: $CLAUDE_CONFIG_DIR or ~/.claude settings.json)

The status-line publisher wraps an existing command status line, so configure
one first. Uninstall restores what installation changed. Installed settings call
"$HOME/.local/bin/agent-hub" claude hook|statusline, so they survive Node
upgrades; re-run install to update an older installation.`;

export const commandUsage: Record<string, string> = {
  start: lifecycleUsage, status: lifecycleUsage, stop: lifecycleUsage,
  publish: publishUsage, route: routeUsage, claude: claudeUsage,
};
