#!/usr/bin/env bash
# Install dependencies, link this package into Pi's extensions directory, and add
# missing keybindings from keybindings.json (existing choices win).
#   ./install.sh            install and link
#   ./install.sh --remove   remove the link (only if it points here)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PI_CODING_AGENT_DIR:-${PI_AGENT_DIR:-$HOME/.pi/agent}}"
DEST="$TARGET/extensions/ibpme-pi-extensions"

if [ "${1:-}" = "--remove" ]; then
  if [ -L "$DEST" ] && [ "$(readlink "$DEST")" = "$ROOT" ]; then rm "$DEST"; echo "removed $DEST"; fi
  exit 0
fi

npm ci --prefix "$ROOT" --no-audit --no-fund

mkdir -p "$TARGET/extensions"
if [ -e "$DEST" ] && ! [ -L "$DEST" ]; then echo "$DEST exists and is not a symlink" >&2; exit 1; fi
ln -sfn "$ROOT" "$DEST"
echo "linked $DEST"

KEYS="$TARGET/keybindings.json"
if [ -L "$KEYS" ]; then
  echo "skip $KEYS: symlink (add the entries from $ROOT/keybindings.json yourself)" >&2
  exit 0
fi
command -v jq >/dev/null || { echo "jq is required to merge $KEYS" >&2; exit 1; }
current='{}'
if [ -e "$KEYS" ] && ! current="$(jq -ce 'if type == "object" then . else error end' "$KEYS" 2>/dev/null)"; then
  echo "skip $KEYS: not a valid JSON object" >&2
  exit 0
fi
added="$(jq -r --argjson cur "$current" '[keys_unsorted[] | select(in($cur) | not)] | join(", ")' "$ROOT/keybindings.json")"
if [ -n "$added" ]; then
  jq --argjson cur "$current" '$cur + with_entries(select(.key | in($cur) | not))' "$ROOT/keybindings.json" > "$KEYS.tmp"
  mv "$KEYS.tmp" "$KEYS"
  echo "keybindings: added $added to $KEYS"
fi
