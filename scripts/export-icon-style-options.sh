#!/usr/bin/env bash
# Build a Current + tone/PixelPot/DayCity/Passage comparison PNG for redesign review.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "${ROOT}/scripts/export-icon-style-options.py" "$@"
