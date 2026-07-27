#!/usr/bin/env bash
# Install the add-app user Cursor skill (not a project skill).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/.cursor/skills/add-app"
mkdir -p "${HOME}/.cursor/skills"
rm -rf "${DEST}"
cp -R "${ROOT}/cursor-user-skills/add-app" "${DEST}"
echo "Installed to ${DEST}/SKILL.md"
echo "Restart Cursor or start a new chat for the skill to appear."
