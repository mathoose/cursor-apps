#!/usr/bin/env bash
# Rebuild the web sample STL shown in ../lithophane.html.
# Needs: pip install numpy pillow trimesh manifold3d shapely scipy fast_simplification
# Generates at 0.25 mm, then decimates to 80K triangles (~4 MB). Most of the
# surface is flat, so the decimated mesh stays within ~0.01 mm of the original.
set -euo pipefail
cd "$(dirname "$0")"
TRIS="${TRIS:-80000}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 make_lithophane.py test-image.png -o "$tmp/full.stl" \
  --shape circle --size 80 --tmin 0.8 --tmax 3.0 --rim 3 --res 0.25

python3 - "$tmp/full.stl" "$TRIS" lithophane-ornament-sample.stl <<'PY'
import sys, numpy as np, trimesh
src, target, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
m = trimesh.load(src)
d = m.simplify_quadric_decimation(face_count=target)
d.merge_vertices()
d.update_faces(d.nondegenerate_faces())
d.remove_unreferenced_vertices()
if not d.is_watertight:
    sys.exit("decimated mesh is not watertight; try a higher TRIS")
_, dist, _ = trimesh.proximity.closest_point(d, m.sample(40000))
d.export(out)
print(f"wrote {out}: {len(d.faces)} triangles, max deviation {dist.max():.3f} mm")
PY
