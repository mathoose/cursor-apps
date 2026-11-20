#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/shared-lists/logic.js"
node --check "$ROOT/shared-lists/app.js"
node "$ROOT/shared-lists/logic.test.js"
echo "shared-lists JS ok"
