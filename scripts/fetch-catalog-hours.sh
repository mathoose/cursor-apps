#!/usr/bin/env bash
# Fetch Google opening hours into coffee-drinks-map catalogs (chunked batches).
# Requires GOOGLE_PLACES_API_KEY with Places API (New) enabled.
#
# Usage:
#   ./scripts/fetch-catalog-hours.sh food 50
#   ./scripts/fetch-catalog-hours.sh coffee 50
#   ./scripts/fetch-catalog-hours.sh drinks 50
# Extra flags are passed through, e.g. --force or --only "Name A,Name B"
set -euo pipefail
CATALOG="${1:-food}"
LIMIT="${2:-50}"
shift 2 2>/dev/null || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/philly-dates"
exec node fetch-google-hours.js --catalog "$CATALOG" --limit "$LIMIT" "$@"
