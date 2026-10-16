#!/usr/bin/env bash
# Link this package into pi's extensions directory as one entry; the
# `pi.extensions` manifest in package.json selects the entry points.
#   ./install.sh            link the package
#   ./install.sh --remove   remove the link (only if it points here)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DEST="$TARGET/extensions/ibpme-pi-extensions"

if [ "${1:-}" = "--remove" ]; then
  if [ -L "$DEST" ] && [ "$(readlink "$DEST")" = "$ROOT" ]; then rm "$DEST"; echo "removed $DEST"; fi
  exit 0
fi

mkdir -p "$TARGET/extensions"
if [ -e "$DEST" ] && ! [ -L "$DEST" ]; then echo "$DEST exists and is not a symlink" >&2; exit 1; fi
ln -sfn "$ROOT" "$DEST"
echo "linked $DEST"

# tool-set binds shift+tab, which pi reserves for app.thinking.cycle, so move that action.
# Add only the actions missing from the local keybindings.json; existing choices win.
KEYS="$TARGET/keybindings.json"
if [ -L "$KEYS" ]; then
  echo "skip $KEYS: symlink (add the entries from $ROOT/keybindings.json yourself)" >&2
else
  node - "$ROOT/keybindings.json" "$KEYS" <<'JS'
const fs = require("node:fs");
const [, , source, target] = process.argv;
const wanted = JSON.parse(fs.readFileSync(source, "utf8"));
let current = {};
try { current = JSON.parse(fs.readFileSync(target, "utf8")); } catch (e) { if (e.code !== "ENOENT") { console.error(`skip ${target}: not valid JSON`); process.exit(0); } }
const added = Object.keys(wanted).filter((action) => !(action in current));
if (added.length) {
  fs.writeFileSync(target, JSON.stringify({ ...current, ...Object.fromEntries(added.map((a) => [a, wanted[a]])) }, null, 2) + "\n");
  console.log(`keybindings: added ${added.join(", ")} to ${target}`);
}
JS
fi
