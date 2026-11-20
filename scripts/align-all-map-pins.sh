#!/usr/bin/env bash
# Snap pins to OpenStreetMap restaurant/bar POI nodes (matches map labels).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="$ROOT/scripts"
cd "$ROOT/philly-dates"
node sync-google-locations.js --provider photon --align-osm --threshold 3 \
  --catalog drinks --report "$REPORT_DIR/location-align-drinks-report.json" "$@"
node sync-google-locations.js --provider photon --align-osm --threshold 3 \
  --catalog coffee --no-drinks-copy --report "$REPORT_DIR/location-align-coffee-report.json" "$@"
python3 "$ROOT/scripts/reconcile-location-sync.py"
echo "Done. Reports in $REPORT_DIR/location-align-*-report.json"
