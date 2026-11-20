#!/usr/bin/env bash
# Install the icon-redesign user Cursor skill (not a project skill).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/.cursor/skills/icon-redesign"
mkdir -p "${HOME}/.cursor/skills"
rm -rf "${DEST}"
cp -R "${ROOT}/cursor-user-skills/icon-redesign" "${DEST}"
echo "Installed to ${DEST}/SKILL.md"
echo "Restart Cursor or start a new chat for the skill to appear."
