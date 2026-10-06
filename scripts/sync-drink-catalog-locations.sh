#!/usr/bin/env bash
# Sync bar/restaurant map pins from philly-dates/places.json (source of truth).
# Uses Google Places when GOOGLE_PLACES_API_KEY is set; otherwise OSM Photon by address.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="${ROOT}/scripts/location-sync-report.json"
cd "$ROOT/philly-dates"
node sync-google-locations.js --provider auto --threshold 75 --report "$REPORT" "$@"
# For label-aligned pins on the OSM basemap, run: ./scripts/align-all-map-pins.sh
echo "Report: $REPORT"
