#!/usr/bin/env bash
# Link this package into pi's extensions directory as one entry; the
# `pi.extensions` manifest in package.json selects the entry points.
#   ./install.sh            link the package
#   ./install.sh --remove   remove the link (only if it points here)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DEST="$TARGET/extensions/ibpme-agents-lab"

if [ "${1:-}" = "--remove" ]; then
  if [ -L "$DEST" ] && [ "$(readlink "$DEST")" = "$ROOT" ]; then rm "$DEST"; echo "removed $DEST"; fi
  exit 0
fi

mkdir -p "$TARGET/extensions"
if [ -e "$DEST" ] && ! [ -L "$DEST" ]; then echo "$DEST exists and is not a symlink" >&2; exit 1; fi
ln -sfn "$ROOT" "$DEST"
echo "linked $DEST"
