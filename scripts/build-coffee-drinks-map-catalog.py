#!/usr/bin/env python3
"""One-off / refresh: merge OSM candidates into coffee-drinks-map catalogs.

Canonical data for agents and the live app is coffee-drinks-map/drinks.json and coffee.json.
Legacy philly-dates/places.json and coffee-map/places.json are archived (launcher hidden).
"""
from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "coffee-drinks-map"
DATES_PATH = ROOT / "philly-dates" / "places.json"
COFFEE_PATH = ROOT / "coffee-map" / "places.json"
CANDIDATES_TXT = Path(__file__).resolve().parent / "osm-candidate-list.txt"
GEOCODE_CACHE = Path(__file__).resolve().parent / "coffee-drinks-geocode-cache.json"

STOP = re.compile(
    r"\b(the|and|bar|pub|cafe|coffee|co|company|restaurant|grill|grille|tavern|"
    r"kitchen|philly|philadelphia|lounge|house|shop|roasters|roastery|of|at|on|"
    r"brewery|brewing|beer|pie|bakery)\b"
)
CHAIN = re.compile(
    r"starbucks|saxby|le pain quotidien|corner bakery|paris baguette|bluestone|"
    r"capital one|kung fu tea|gong cha|chicha|yi fang|bambu|mango mango|federal donuts|"
    r"chickie|iron hill|lucky strike|fado|howl at the moon|buffalo billiards",
    re.I,
)
SKIP_COF_CUISINE = re.compile(
    r"bubble_tea|^tea$|dessert|ice_cream|crepe|pretzel|donut|cookie|macaron|sushi|thai|ethiopian|mexican|pizza"
)
SKIP_COF_NAME = re.compile(
    r"tea|boba|juice|smoothie|dilworth|independence mall|balcony|divine lorraine|"
    r"cosmic|waterfront|bicycles|game|hotel|matcha|mr\. wish|vivi|t\.uni|molly|miucha|"
    r"teassert|golden donuts|deli|eggcellent|green eggs|global crepes|madison k|sue\*saki|"
    r"miller|machi|smile cafe",
    re.I,
)
SKIP_BEER = re.compile(
    r"nightclub|ktv|vikings high school|monkey club|brasil|pop up garden|philadium|"
    r"libertad|tango|red lounge|living room lounge|prime fusion",
    re.I,
)
NEIGHBORHOODS = [
    "Bella Vista", "Center City", "East Passyunk", "Fairmount", "Fishtown",
    "Graduate Hospital", "Kensington", "Midtown", "Northern Liberties", "Old City",
    "Queen Village", "Rittenhouse", "South Philly", "University City", "Nicetown",
    "Brewerytown", "Point Breeze",
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.split(" — ")[0].split(" - ")[0]
    s = s.replace("&", " and ").replace("'", "")
    s = re.sub(r"\(.*?\)", "", s)
    s = STOP.sub(" ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def slug(s: str) -> str:
    s = norm(s) or "place"
    return s[:48]


def matched(name: str, pool: list) -> bool:
    k = norm(name)
    if not k:
        return False
    for p in pool:
        pk = norm(p.get("name", ""))
        if not pk:
            continue
        if pk == k or (len(k) >= 4 and len(pk) >= 4 and (k in pk or pk in k)):
            return True
    return False


def parse_candidate_txt() -> tuple[list[dict], list[dict]]:
    if not CANDIDATES_TXT.is_file():
        return [], []
    text = CANDIDATES_TXT.read_text(encoding="utf-8")
    beers: list[dict] = []
    coffees: list[dict] = []
    side = None
    for line in text.splitlines():
        if line.startswith("===== beer"):
            side = "beer"
            continue
        if line.startswith("===== coffee"):
            side = "coffee"
            continue
        if not side or "|" not in line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 3:
            continue
        kind, name, street = parts[0], parts[1], parts[2]
        cuisine = parts[3] if len(parts) > 3 else ""
        brand = parts[4] if len(parts) > 4 else ""
        row = {"kind": kind, "name": name, "street": street, "cuisine": cuisine, "brand": brand}
        if side == "beer":
            beers.append(row)
        else:
            coffees.append(row)
    return beers, coffees


def filter_beer(row: dict) -> bool:
    n = row["name"].lower()
    if CHAIN.search(n):
        return False
    if SKIP_BEER.search(n):
        return False
    return True


def filter_coffee(row: dict) -> bool:
    n = row["name"].lower()
    c = (row.get("cuisine") or "").lower()
    b = (row.get("brand") or "").lower()
    if CHAIN.search(n) or CHAIN.search(b):
        return False
    if (SKIP_COF_CUISINE.search(c) and "coffee_shop" not in c) or SKIP_COF_NAME.search(n):
        return False
    return True


def load_cache() -> dict:
    if GEOCODE_CACHE.is_file():
        return json.loads(GEOCODE_CACHE.read_text())
    return {}


def save_cache(cache: dict) -> None:
    GEOCODE_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def geocode(name: str, street: str, cache: dict) -> tuple[float | None, float | None, str]:
    key = f"{name}|{street}"
    if key in cache:
        hit = cache[key]
        return hit.get("lat"), hit.get("lng"), hit.get("address", street)
    q = ", ".join(x for x in [name, street, "Philadelphia", "PA"] if x)
    url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 1})
    lat = lng = None
    address = street or ""
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        feats = data.get("features") or []
        if feats:
            coords = feats[0]["geometry"]["coordinates"]
            lng, lat = float(coords[0]), float(coords[1])
            props = feats[0].get("properties") or {}
            address = props.get("street") or props.get("name") or address
    except Exception:
        pass
    cache[key] = {"lat": lat, "lng": lng, "address": address}
    time.sleep(0.15)
    return lat, lng, address


def drink_row(name: str, address: str, lat, lng, note: str = "") -> dict:
    return {
        "name": name,
        "address": address or "",
        "neighborhood": "",
        "description": note or "Added from OpenStreetMap catalog expansion.",
        "social": "",
        "hh_menu": "",
        "instagram": "",
        "schedule": {},
        "lat": lat,
        "lng": lng,
    }


def coffee_row(name: str, address: str, lat, lng) -> dict:
    return {
        "id": slug(name),
        "name": name,
        "neighborhood": "",
        "address": address or "",
        "lat": lat,
        "lng": lng,
        "website": "",
        "instagramUrl": "",
        "hoursSource": "osm",
        "hoursNote": "Hours unconfirmed — verify before visiting.",
        "hours": {},
    }


def dedupe_drinks(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        k = norm(r["name"])
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def dedupe_coffee(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        k = norm(r.get("name", ""))
        if not k or k in seen:
            continue
        seen.add(k)
        if not r.get("id"):
            r["id"] = slug(r["name"])
        out.append(r)
    return out


def main() -> None:
    dates = json.loads(DATES_PATH.read_text(encoding="utf-8"))
    coffees = json.loads(COFFEE_PATH.read_text(encoding="utf-8"))
    beer_raw, coffee_raw = parse_candidate_txt()
    cache = load_cache()

    drinks = list(dates)
    coffee_out = list(coffees)

    added_d = added_c = 0
    for row in beer_raw:
        if not filter_beer(row):
            continue
        if matched(row["name"], drinks):
            continue
        lat, lng, addr = geocode(row["name"], row["street"], cache)
        if lat is None or lng < -75.131 or (lng > -75.137 and lat < 39.965):
            continue
        drinks.append(
            drink_row(
                row["name"],
                (row["street"] or addr or "").strip(),
                lat,
                lng,
                "Bar / brewery / distillery pin from OSM — happy hour not yet researched.",
            )
        )
        added_d += 1

    for row in coffee_raw:
        if not filter_coffee(row):
            continue
        if matched(row["name"], coffee_out):
            continue
        lat, lng, addr = geocode(row["name"], row["street"], cache)
        if lat is None:
            continue
        coffee_out.append(coffee_row(row["name"], (row["street"] or addr or "").strip(), lat, lng))
        added_c += 1

    save_cache(cache)
    drinks = dedupe_drinks(drinks)
    coffee_out = dedupe_coffee(coffee_out)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "drinks.json").write_text(json.dumps(drinks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT_DIR / "coffee.json").write_text(json.dumps(coffee_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    meta = {
        "drinks": len(drinks),
        "coffee": len(coffee_out),
        "added_drinks": added_d,
        "added_coffee": added_c,
        "with_hh_schedule": sum(1 for d in drinks if d.get("schedule")),
    }
    (OUT_DIR / "catalog-meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
