#!/usr/bin/env bash
# Rasterize your-app/app-icon.svg → app-icon.png (180×180) for iOS home screen.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?Usage: rasterize-app-icon.sh <app-folder-name>}"
SVG="${ROOT}/${APP}/app-icon.svg"
PNG="${ROOT}/${APP}/app-icon.png"
SIZE=180

if [[ ! -f "$SVG" ]]; then
  echo "Missing ${SVG}" >&2
  exit 1
fi

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w "$SIZE" -h "$SIZE" "$SVG" -o "$PNG"
elif node -e "require('@resvg/resvg-js')" >/dev/null 2>&1; then
  node - "$SVG" "$PNG" "$SIZE" <<'NODE'
const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const [svgPath, pngPath, size] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, { fitTo: { mode: "width", value: Number(size) } });
fs.writeFileSync(pngPath, resvg.render().asPng());
NODE
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  (cd "$TMP" && npm init -y >/dev/null 2>&1 && npm install @resvg/resvg-js --no-save >/dev/null 2>&1)
  NODE_PATH="${TMP}/node_modules" node - "$SVG" "$PNG" "$SIZE" <<'NODE'
const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const [svgPath, pngPath, size] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, { fitTo: { mode: "width", value: Number(size) } });
fs.writeFileSync(pngPath, resvg.render().asPng());
NODE
fi

echo "Wrote ${PNG} ($(file -b "$PNG"))"
