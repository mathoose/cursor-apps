#!/usr/bin/env python3
"""Build a Current vs four-style icon comparison PNG for redesign review."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES = ("tone", "pixelpot", "daycity", "passage")
STYLE_LABELS = ("Current", "tone", "PixelPot", "DayCity", "Passage")


def load_apps_json() -> dict:
    path = ROOT / "apps.json"
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def app_display_name(app_id: str, manifest: dict) -> str:
    for entry in manifest.get("apps") or []:
        if entry.get("id") == app_id:
            return entry.get("name") or app_id
    return app_id.replace("-", " ").title()


def squircle_mask(size: int, radius_ratio: float = 0.22):
    from PIL import Image, ImageDraw

    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = int(size * radius_ratio)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    return m


def export_sheet(apps: list[tuple[str, str]], out_path: Path) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
        from PIL import Image, ImageDraw, ImageFont

    rows: list[tuple[str, list[Path]]] = []
    for app_id, title in apps:
        app_dir = ROOT / app_id
        prev = app_dir / "icon-previous" / "app-icon.png"
        current = prev if prev.is_file() else app_dir / "app-icon.png"
        if not current.is_file():
            raise SystemExit(f"Missing current icon for {app_id}: {current}")
        opts = app_dir / "icon-options"
        paths = [current]
        for style in STYLES:
            p = opts / f"{style}.png"
            if not p.is_file():
                raise SystemExit(
                    f"Missing {p} — generate all four styles before export "
                    f"(tone, pixelpot, daycity, passage)."
                )
            paths.append(p)
        rows.append((title, paths))

    cell = 280
    pad = 24
    head = 64
    label_h = 36
    cols = 5
    row_count = len(rows)
    w = pad + cols * (cell + pad)
    h = pad + head + row_count * (cell + label_h + pad)

    sheet = Image.new("RGB", (w, h), (244, 242, 238))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        font_s = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
        font_s = font

    draw.text((pad, 18), "Icon style options · current icon kept", fill=(40, 36, 32), font=font)
    for c, title in enumerate(STYLE_LABELS):
        x = pad + c * (cell + pad)
        draw.text((x, 46), title, fill=(90, 84, 76), font=font_s)

    mask = squircle_mask(cell - 8)
    for r, (title, paths) in enumerate(rows):
        y = pad + head + r * (cell + label_h + pad)
        draw.text((pad, y + cell + 6), title, fill=(40, 36, 32), font=font_s)
        for c, p in enumerate(paths):
            x = pad + c * (cell + pad)
            icon = Image.open(p).convert("RGB").resize((cell - 8, cell - 8), Image.Resampling.LANCZOS)
            bg = Image.new("RGB", (cell - 8, cell - 8), (244, 242, 238))
            bg.paste(icon, (0, 0), mask)
            sheet.paste(bg, (x, y))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, "PNG", optimize=True)
    print(f"Wrote {out_path} ({sheet.size[0]}×{sheet.size[1]}, {row_count} app(s))")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "app_ids",
        nargs="+",
        metavar="APP_ID",
        help="App folder id(s), e.g. habit-journal shared-lists",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("/opt/cursor/artifacts/icon-style-options.png"),
        help="Output PNG path (default: /opt/cursor/artifacts/icon-style-options.png)",
    )
    args = parser.parse_args()
    manifest = load_apps_json()
    apps = [(aid, app_display_name(aid, manifest)) for aid in args.app_ids]
    export_sheet(apps, args.output)


if __name__ == "__main__":
    main()
