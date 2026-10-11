# Unused photo cutouts

The live home icon is built from the exact Philly Dates map (`philly-dates/app-icon.png`) by `scripts/build-coffee-drinks-app-icon.py` — larger “Philadelphia” plus blue “dates”. These PNGs are leftover photo cutouts and are not composited into `app-icon.png`.

Foreground photos are **real photographs** (not AI-generated). Backgrounds were removed with [rembg](https://github.com/danielgatis/rembg).

| Asset | Source | License |
|-------|--------|---------|
| `coffee.png` | [A small cup of coffee](https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG) (Julius Schorzman) | CC BY-SA 2.0 |
| `sandwich.png` | [Club sandwich](https://commons.wikimedia.org/wiki/File:Club_sandwich.jpg) (Jeffreyw) | CC BY 2.0 |
| `beer.png` | [Pexels #1552630](https://www.pexels.com/photo/glass-of-beer-on-table-1552630/) | Pexels License |

Rebuild: `./scripts/build-coffee-drinks-app-icon.py` (requires `pillow`, `numpy`, and cutout PNGs in this folder).
