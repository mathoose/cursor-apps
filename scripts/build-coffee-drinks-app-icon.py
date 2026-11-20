#!/usr/bin/env python3
"""Coffee & Drinks home icon: sharp Philly street map + large labels.

The Philly Dates / happy-hours app only stores its Apple Maps look as a
180×180 home-screen PNG, so enlarging that file goes soft. This icon uses
a 1024px street-map capture of the same Center City view
(coffee-drinks-map/icon-assets/philly-map-base.png) and draws
"Philadelphia" and blue "dates" in the same bold sans.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "coffee-drinks-map" / "icon-assets" / "philly-map-base.png"
OUT = ROOT / "coffee-drinks-map" / "app-icon.png"
FONT = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
LABEL = (28, 28, 30, 255)
DATES_BLUE = (0, 122, 255, 255)


def fit_font(draw: ImageDraw.ImageDraw, text: str, target_w: int) -> ImageFont.FreeTypeFont:
    size = 240
    while size > 24:
        font = ImageFont.truetype(FONT, size)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= target_w:
            return font
        size -= 2
    return ImageFont.truetype(FONT, 24)


def build() -> None:
    canvas = Image.open(BASE).convert("RGBA")
    size = canvas.size[0]
    draw = ImageDraw.Draw(canvas)
    font = fit_font(draw, "Philadelphia", int(size * 0.9))
    box = draw.textbbox((0, 0), "Philadelphia", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (size - tw) // 2 - box[0]
    y = int(size * 0.36) - box[1]
    draw.text((x, y), "Philadelphia", font=font, fill=LABEL)
    dbox = draw.textbbox((0, 0), "dates", font=font)
    dw = dbox[2] - dbox[0]
    dx = (size - dw) // 2 - dbox[0]
    dy = y + th + 8 - dbox[1]
    draw.text((dx, dy), "dates", font=font, fill=DATES_BLUE)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
