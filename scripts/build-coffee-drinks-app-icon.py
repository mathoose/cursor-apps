#!/usr/bin/env python3
"""Coffee & Drinks home icon from the real Philly Dates Apple Maps capture.

Uses philly-dates/app-icon.png exactly (no redrawn map). Covers the small
built-in "Philadelphia" label, then draws a larger "Philadelphia" and
"dates" in the same bold sans, with "dates" in Apple blue.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MAP_SRC = ROOT / "philly-dates" / "app-icon.png"
OUT = ROOT / "coffee-drinks-map" / "app-icon.png"
SIZE = 1024
FONT = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
LABEL = (28, 28, 30, 255)
DATES_BLUE = (0, 122, 255, 255)


def clear_builtin_label(src: Image.Image) -> Image.Image:
    a = np.array(src.convert("RGB"))
    h, w = a.shape[:2]
    lum = a.mean(axis=2)
    mask = np.zeros((h, w), dtype=bool)
    mask[72:86, 40:168] = lum[72:86, 40:168] < 210
    dilated = mask.copy()
    dilated[1:] |= mask[:-1]
    dilated[:-1] |= mask[1:]
    dilated[:, 1:] |= mask[:, :-1]
    dilated[:, :-1] |= mask[:, 1:]

    filled = a.copy()
    ys, xs = np.where(dilated)
    for y, x in zip(ys, xs):
        samples = []
        for dy in (-10, -8, 9, 11):
            yy = int(y + dy)
            if 0 <= yy < h and not dilated[yy, x]:
                samples.append(a[yy, x])
        if samples:
            filled[y, x] = np.median(np.stack(samples), axis=0)
    return Image.fromarray(filled.astype(np.uint8), "RGB")


def fit_font(draw: ImageDraw.ImageDraw, text: str, target_w: int, start: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > 24:
        font = ImageFont.truetype(FONT, size)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= target_w:
            return font
        size -= 2
    return ImageFont.truetype(FONT, 24)


def build() -> None:
    base = clear_builtin_label(Image.open(MAP_SRC))
    canvas = base.resize((SIZE, SIZE), Image.Resampling.LANCZOS).convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    ph_font = fit_font(draw, "Philadelphia", int(SIZE * 0.92), 240)
    ph_box = draw.textbbox((0, 0), "Philadelphia", font=ph_font)
    ph_w, ph_h = ph_box[2] - ph_box[0], ph_box[3] - ph_box[1]
    ph_x = (SIZE - ph_w) // 2 - ph_box[0]
    ph_y = int(SIZE * 0.30) - ph_box[1]
    draw.text((ph_x, ph_y), "Philadelphia", font=ph_font, fill=LABEL)

    # Same face and size as Philadelphia; color is the only change.
    d_box = draw.textbbox((0, 0), "dates", font=ph_font)
    d_w = d_box[2] - d_box[0]
    d_x = (SIZE - d_w) // 2 - d_box[0]
    d_y = ph_y + ph_h + int(SIZE * 0.015) - d_box[1]
    draw.text((d_x, d_y), "dates", font=ph_font, fill=DATES_BLUE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
