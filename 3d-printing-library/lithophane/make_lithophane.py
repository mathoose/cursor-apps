#!/usr/bin/env python3
"""Make a lithophane ornament STL from a photo.

Darker pixels -> thicker plastic (blocks more light). Produces one watertight
solid: lithophane panel clipped to a shape + raised border rim + hanging loop.

Usage:
  python make_lithophane.py photo.jpg -o out.stl --shape circle --size 80 \
      --tmin 0.8 --tmax 3.2
Shapes: circle | rect | heart
Requires: numpy, pillow, trimesh, manifold3d  (venv at /workspace/etsy/.venv)
"""
import argparse, sys
import numpy as np
from PIL import Image, ImageOps
import trimesh
from trimesh.creation import extrude_polygon, cylinder, annulus
from shapely.geometry import Point, Polygon, box


def shape_polygon(shape, w, h):
    """2D outline centred at origin, w x h mm."""
    if shape == "circle":
        return Point(0, 0).buffer(w / 2, resolution=128)
    if shape == "rect":
        r = min(w, h) * 0.06
        return box(-w / 2 + r, -h / 2 + r, w / 2 - r, h / 2 - r).buffer(r, resolution=16)
    if shape == "heart":
        t = np.linspace(0, 2 * np.pi, 400, endpoint=False)
        x = 16 * np.sin(t) ** 3
        y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
        x = x / (x.max() - x.min()) * w
        y = y / (y.max() - y.min()) * h
        y -= (y.max() + y.min()) / 2
        return Polygon(np.c_[x, y]).buffer(0).simplify(0.05)
    raise SystemExit(f"unknown shape {shape}")


def heightmap_solid(img, w, h, tmin, tmax, res, invert=False):
    """Watertight rectangular heightmap block, z from 0 to thickness(x,y)."""
    nx, ny = int(round(w / res)) + 1, int(round(h / res)) + 1
    g = ImageOps.exif_transpose(img).convert("L")
    g = ImageOps.fit(g, (nx, ny), Image.LANCZOS)          # crop-to-fill
    g = ImageOps.autocontrast(g, cutoff=1)
    a = np.asarray(g, dtype=np.float64) / 255.0
    a = np.flipud(a)                                        # image row 0 = top (+y)
    if invert:
        a = 1 - a
    z = tmax - a * (tmax - tmin)                            # dark = thick
    # Mirror in x so the photo reads correctly when the textured face is the back.
    z = z[:, ::-1]
    xs = np.linspace(-w / 2, w / 2, nx)
    ys = np.linspace(-h / 2, h / 2, ny)
    X, Y = np.meshgrid(xs, ys)
    top = np.c_[X.ravel(), Y.ravel(), z.ravel()]
    bot = np.c_[X.ravel(), Y.ravel(), np.zeros(nx * ny)]
    V = np.vstack([top, bot])
    off = nx * ny
    idx = np.arange(nx * ny).reshape(ny, nx)
    a0, a1 = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
    b0, b1 = idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    F = [np.c_[a0, a1, b1], np.c_[a0, b1, b0],                       # top (up)
         np.c_[a0 + off, b1 + off, a1 + off], np.c_[a0 + off, b0 + off, b1 + off]]  # bottom
    def wall(edge, flip):
        e = np.asarray(edge)
        p, q = e[:-1], e[1:]
        f1 = np.c_[p, p + off, q]; f2 = np.c_[q, p + off, q + off]
        return [f1[:, ::-1], f2[:, ::-1]] if flip else [f1, f2]
    F += wall(idx[0, :], False) + wall(idx[-1, :], True)
    F += wall(idx[:, 0], True) + wall(idx[:, -1], False)
    m = trimesh.Trimesh(V, np.vstack(F), process=True)
    m.fix_normals()
    return m


def build(args):
    w = args.size
    h = args.height or (w * 0.95 if args.shape == "heart" else w)
    outline = shape_polygon(args.shape, w, h)
    rim = args.rim
    inner = outline.buffer(-rim * 0.5).simplify(0.02)       # photo area overlaps rim
    img = Image.open(args.image)
    hm = heightmap_solid(img, w, h, args.tmin, args.tmax, args.res, args.invert)
    clip = extrude_polygon(inner, args.tmax + 2)
    clip.apply_translation([0, 0, -1])
    panel = hm.intersection(clip, engine="manifold")
    parts = [panel]
    if rim > 0:
        ring = outline.difference(outline.buffer(-rim)).simplify(0.02)
        parts.append(extrude_polygon(ring, args.tmax + args.rim_extra))
    if args.loop:
        ro, ri, lt = args.loop_od / 2, args.loop_id / 2, args.tmax + args.rim_extra
        top_y = outline.bounds[3]
        loop = annulus(r_min=ri, r_max=ro, height=lt, sections=64)
        loop.apply_translation([0, top_y + ri + 0.2, lt / 2])
        # small neck so the loop is solidly fused to the rim
        neck = extrude_polygon(box(-ro * 0.7, top_y - rim, ro * 0.7, top_y + 1.2), lt)
        parts += [loop, neck]
    solid = trimesh.boolean.union(parts, engine="manifold")
    if args.text:
        print("note: --text not implemented; add names in your slicer", file=sys.stderr)
    return solid


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image")
    p.add_argument("-o", "--out", default="lithophane.stl")
    p.add_argument("--shape", default="circle", choices=["circle", "rect", "heart"])
    p.add_argument("--size", type=float, default=80, help="width/diameter mm")
    p.add_argument("--height", type=float, default=None, help="height mm (rect/heart)")
    p.add_argument("--tmin", type=float, default=0.8, help="thinnest (brightest) mm")
    p.add_argument("--tmax", type=float, default=3.0, help="thickest (darkest) mm")
    p.add_argument("--res", type=float, default=0.2, help="mm per pixel sample")
    p.add_argument("--rim", type=float, default=3.0, help="border width mm (0=none)")
    p.add_argument("--rim-extra", type=float, default=0.6, help="rim height above tmax")
    p.add_argument("--no-loop", dest="loop", action="store_false")
    p.add_argument("--loop-od", type=float, default=10)
    p.add_argument("--loop-id", type=float, default=5)
    p.add_argument("--invert", action="store_true")
    p.add_argument("--text", default=None)
    a = p.parse_args()
    if not 0 < a.tmin < a.tmax:
        p.error("need 0 < tmin < tmax")
    m = build(a)
    m.export(a.out)
    ext = m.extents
    print(f"wrote {a.out}: {len(m.faces)} triangles, watertight={m.is_watertight}, "
          f"size {ext[0]:.1f} x {ext[1]:.1f} x {ext[2]:.2f} mm, volume {m.volume/1000:.2f} cm3")


if __name__ == "__main__":
    main()
