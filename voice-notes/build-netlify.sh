#!/usr/bin/env bash
# Stage monorepo root into voice-notes/dist for Netlify (legacy package directory).
set -euo pipefail
ROOT="$(cd .. && pwd)"
DEST="$(pwd)/dist"
rm -rf "$DEST"
mkdir -p "$DEST"
shopt -s dotglob nullglob
for item in "$ROOT"/*; do
  name="$(basename "$item")"
  case "$name" in
    voice-notes | .git) continue ;;
  esac
  cp -a "$item" "$DEST/"
done
# Drop Netlify-oversized / dev-only paths (see root .netlifyignore).
rm -rf "$DEST/rep-tracker/scripts" "$DEST/html-features" "$DEST/rep-tracker/data/district-history"
