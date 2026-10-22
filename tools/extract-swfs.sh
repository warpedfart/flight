#!/usr/bin/env bash
# extract-swfs.sh - copy every SWF out of a mirror folder, adding a .swf extension.
#
# Usage:
#   ./extract-swfs.sh [SOURCE_DIR] [DEST_DIR]
#
# Defaults: SOURCE_DIR=./cache   DEST_DIR=./swf-copies
#
# Files are detected by their first 3 bytes (FWS, CWS or ZWS = the three SWF
# signatures), so audio and other asset types are ignored. The originals are
# never touched or renamed; only copies are made. Re-running is safe: copies
# that already exist are skipped.

set -euo pipefail

SRC="${1:-./cache}"
DEST="${2:-./swf-copies}"

if [ ! -d "$SRC" ]; then
  echo "Source folder not found: $SRC" >&2
  echo "Usage: $0 [SOURCE_DIR] [DEST_DIR]" >&2
  exit 1
fi

mkdir -p "$DEST"

copied=0
skipped=0
checked=0

while IFS= read -r -d '' f; do
  checked=$((checked + 1))
  magic="$(head -c 3 "$f" 2>/dev/null || true)"
  case "$magic" in
    FWS|CWS|ZWS)
      out="$DEST/$(basename "$f").swf"
      if [ -e "$out" ]; then
        skipped=$((skipped + 1))
      else
        cp "$f" "$out"
        copied=$((copied + 1))
      fi
      ;;
  esac
  if [ $((checked % 500)) -eq 0 ]; then
    echo "checked $checked files... copied $copied SWFs so far"
  fi
done < <(find "$SRC" -type f ! -name '*.tmp' -print0)

echo "Done. Checked $checked files: copied $copied SWFs, skipped $skipped already present."
echo "Output folder: $DEST"
