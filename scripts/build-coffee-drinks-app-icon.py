#!/usr/bin/env python3
"""Composite Coffee & Drinks home icon: real Philly Apple Maps base + photo cutouts."""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MAP_SRC = ROOT / "philly-dates" / "app-icon.png"
ASSETS = ROOT / "coffee-drinks-map" / "icon-assets"
OUT = ROOT / "coffee-drinks-map" / "app-icon.png"
SIZE = 1024


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def dark_apple_maps(base: Image.Image) -> Image.Image:
    """Darken the real Apple Maps Philly capture (keeps grid/rivers/parks readable)."""
    rgb = np.array(base.convert("RGB"), dtype=np.float32) / 255.0
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

    # Night-mode tint while preserving street contrast from the source map.
    tinted = rgb * np.array([0.42, 0.44, 0.52], dtype=np.float32)
    tinted = tinted ** 1.55

    water = (rgb[..., 2] > rgb[..., 0] + 0.08) & (rgb[..., 2] > 0.35)
    park = (rgb[..., 1] > rgb[..., 0] + 0.05) & (rgb[..., 1] > rgb[..., 2]) & ~water
    tinted[water] = np.clip(tinted[water] * np.array([0.55, 0.75, 1.15]), 0, 1)
    tinted[park] = np.clip(tinted[park] * np.array([0.7, 1.05, 0.75]), 0, 1)

    streets = lum > 0.78
    tinted[streets] = np.clip(tinted[streets] + 0.12, 0, 1)

    poi = (rgb[..., 0] > 0.72) & (rgb[..., 1] > 0.35) & (rgb[..., 1] < 0.72) & (rgb[..., 2] < 0.5)
    tinted[poi] = np.clip(tinted[poi] * np.array([1.35, 0.85, 0.65]) + 0.08, 0, 1)

    out = (tinted * 255.0).astype(np.uint8)
    return Image.fromarray(out, "RGB")


def fit_height(img: Image.Image, height: int) -> Image.Image:
    w, h = img.size
    scale = height / h
    return img.resize((max(1, int(w * scale)), height), Image.Resampling.LANCZOS)


def paste_rgba(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> None:
    canvas.alpha_composite(layer, (x, y))


def draw_philadelphia_label(canvas: Image.Image) -> None:
    draw = ImageDraw.Draw(canvas)
    text = "Philadelphia"
    target_w = int(SIZE * 0.9)
    font_size = 120
    font = load_font(font_size)
    while font_size > 40:
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= target_w:
            break
        font_size -= 4
        font = load_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) // 2
    y = int(SIZE * 0.30) - th // 2
    for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
        draw.text((x + dx, y + dy), text, font=font, fill=(0, 0, 0, 140))
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))


def build() -> None:
    base_map = Image.open(MAP_SRC).convert("RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    dark = dark_apple_maps(base_map)
    canvas = dark.convert("RGBA")

    # Hide the baked-in light-mode city label from the source map capture.
    label_mask = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask_draw = ImageDraw.Draw(label_mask)
    mask_draw.rounded_rectangle((48, 250, SIZE - 48, 410), radius=36, fill=(18, 20, 24, 210))
    canvas = Image.alpha_composite(canvas, label_mask)

    draw_philadelphia_label(canvas)

    coffee = Image.open(ASSETS / "coffee.png").convert("RGBA")
    sandwich = Image.open(ASSETS / "sandwich.png").convert("RGBA")
    beer = Image.open(ASSETS / "beer.png").convert("RGBA")

    coffee = fit_height(coffee, 290)
    sandwich = fit_height(sandwich, 270)
    beer = fit_height(beer, 340)

    paste_rgba(canvas, coffee, 70, 430)
    paste_rgba(canvas, sandwich, SIZE - sandwich.width - 60, 450)
    paste_rgba(canvas, beer, (SIZE - beer.width) // 2, SIZE - beer.height - 55)

    # Subtle vignette like Maps UI depth
    vignette = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-80, -40, SIZE + 80, SIZE + 120), fill=(0, 0, 0, 35))
    canvas = Image.alpha_composite(canvas, vignette)

    final = canvas.convert("RGB")
    final = final.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=3))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    final.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({final.size[0]}×{final.size[1]})")


if __name__ == "__main__":
    build()
