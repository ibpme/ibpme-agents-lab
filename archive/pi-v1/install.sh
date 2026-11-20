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
  command -v jq >/dev/null || { echo "jq is required to merge $KEYS" >&2; exit 1; }
  current='{}'
  if [ -e "$KEYS" ]; then
    if ! current="$(jq -ce 'if type == "object" then . else error("not an object") end' "$KEYS" 2>/dev/null)"; then
      echo "skip $KEYS: not a valid JSON object" >&2
      exit 0
    fi
  fi
  added="$(jq -r --argjson cur "$current" '[keys_unsorted[] | select(in($cur) | not)] | join(", ")' "$ROOT/keybindings.json")"
  if [ -n "$added" ]; then
    printf '%s\n' "$(jq --argjson cur "$current" '$cur + with_entries(select(.key | in($cur) | not))' "$ROOT/keybindings.json")" > "$KEYS"
    echo "keybindings: added $added to $KEYS"
  fi
fi
