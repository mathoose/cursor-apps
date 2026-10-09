#!/usr/bin/env python3
"""Expand coffee-drinks-map/food.json from OSM + neighborhood seeds (no alcohol-first bars)."""
from __future__ import annotations

import json
import re
import time
from collections import Counter
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOOD_PATH = ROOT / "coffee-drinks-map" / "food.json"
DRINKS_PATH = ROOT / "coffee-drinks-map" / "drinks.json"
SEEDS_PATH = Path(__file__).resolve().parent / "food-catalog-neighborhood-seeds.json"
CACHE_PATH = Path(__file__).resolve().parent / "food-catalog-geocode-cache.json"
OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

# south, west, north, east
NEIGHBORHOODS: dict[str, tuple[float, float, float, float]] = {
    "Rittenhouse": (39.9452, -75.1790, 39.9530, -75.1645),
    "East Passyunk": (39.9245, -75.1760, 39.9365, -75.1575),
    "Pennsport": (39.9175, -75.1540, 39.9305, -75.1365),
    "Point Breeze": (39.9210, -75.1880, 39.9380, -75.1640),
    "South Street": (39.9395, -75.1820, 39.9465, -75.1440),
    "Fairmount": (39.9575, -75.1860, 39.9735, -75.1670),
    "Northern Liberties": (39.9570, -75.1490, 39.9725, -75.1280),
    "Fishtown": (39.9610, -75.1390, 39.9785, -75.1120),
}

PER_HOOD = 20
# Fast-food / cafe chains still skipped. Allowed in catalog: Starbucks, Chipotle, Panera,
# Taco Bell, Chick-fil-A, Wawa, Domino's, Dunkin (and similar spellings via removed patterns).
CHAIN = re.compile(
    r"mcdonald|subway|pizza hut|7-eleven|wendy|burger king|kfc|"
    r"capital one|sweetgreen|cava|shake shack",
    re.I,
)
ALLOWED_CHAIN = re.compile(
    r"starbucks|chipotle|panera|taco bell|chick-fil-a|chick fil a|wawa|domino|dunkin",
    re.I,
)
SKIP_AMENITY = {"bar", "pub", "biergarten", "nightclub"}
DAY_MAP = {
    "Mo": "Monday",
    "Tu": "Tuesday",
    "We": "Wednesday",
    "Th": "Thursday",
    "Fr": "Friday",
    "Sa": "Saturday",
    "Su": "Sunday",
}


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "place").lower()).strip("-")
    return s[:48] or "place"


def load_json(path: Path) -> list:
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def load_cache() -> dict:
    if CACHE_PATH.is_file():
        return json.loads(CACHE_PATH.read_text())
    return {}


def save_cache(c: dict) -> None:
    CACHE_PATH.write_text(json.dumps(c, indent=2) + "\n", encoding="utf-8")


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
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        feats = data.get("features") or []
        if feats:
            coords = feats[0]["geometry"]["coordinates"]
            lng, lat = float(coords[0]), float(coords[1])
            props = feats[0].get("properties") or {}
            parts = [
                props.get("housenumber"),
                props.get("street"),
                props.get("city"),
                props.get("state"),
                props.get("postcode"),
            ]
            address = ", ".join(str(p) for p in parts if p) or address
    except Exception:
        pass
    cache[key] = {"lat": lat, "lng": lng, "address": address}
    time.sleep(0.12)
    return lat, lng, address


def overpass_restaurants(south: float, west: float, north: float, east: float) -> list[dict]:
    q = f"""
    [out:json][timeout:90];
    (
      nwr["amenity"~"restaurant|fast_food|cafe"]["name"]({south},{west},{north},{east});
    );
    out center tags;
    """
    data = None
    last_err: Exception | None = None
    for base in OVERPASS_URLS:
        try:
            req = urllib.request.Request(
                base,
                data=q.encode(),
                headers={"User-Agent": "cursor-apps-food-catalog/1.0"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception as e:
            last_err = e
            time.sleep(3)
    if data is None:
        raise last_err or RuntimeError("overpass failed")
    rows = []
    for el in data.get("elements") or []:
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name or len(name) < 2:
            continue
        amenity = tags.get("amenity", "")
        if amenity in SKIP_AMENITY or tags.get("bar") == "yes":
            continue
        if CHAIN.search(name):
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue
        street = tags.get("addr:street") or ""
        hn = tags.get("addr:housenumber") or ""
        addr = " ".join(x for x in [hn, street] if x).strip()
        city = tags.get("addr:city") or "Philadelphia"
        state = tags.get("addr:state") or "PA"
        zipc = tags.get("addr:postcode") or ""
        if addr:
            full = f"{addr}, {city}, {state}"
            if zipc:
                full += f" {zipc}"
        else:
            full = f"{name}, Philadelphia, PA"
        rows.append(
            {
                "name": name,
                "address": full,
                "lat": round(float(lat), 6),
                "lng": round(float(lng), 6),
                "opening_hours": tags.get("opening_hours") or "",
                "website": tags.get("website") or tags.get("contact:website") or "",
                "score": (10 if tags.get("opening_hours") else 0)
                + (5 if tags.get("website") else 0)
                + min(len(name), 20),
            }
        )
    rows.sort(key=lambda r: -r["score"])
    return rows


def existing_names(food: list, drinks: list) -> set[str]:
    names: set[str] = set()
    for p in food + drinks:
        n = norm_name(p.get("name", ""))
        if n:
            names.add(n)
    return names


def place_row(
    name: str,
    neighborhood: str,
    address: str,
    lat: float | None,
    lng: float | None,
    note: str,
    website: str = "",
    hours_note: str = "",
) -> dict:
    return {
        "id": slug(name),
        "name": name,
        "neighborhood": neighborhood,
        "address": address or "",
        "lat": lat,
        "lng": lng,
        "website": website or "",
        "instagramUrl": "",
        "hours": {},
        "hoursSource": "osm",
        "hoursNote": hours_note or "Hours unconfirmed — check website or Google before visiting.",
        "description": note,
        "meal": "both",
    }


def main() -> None:
    food = load_json(FOOD_PATH)
    drinks = load_json(DRINKS_PATH)
    taken = existing_names(food, drinks)
    ids = {p.get("id") for p in food if p.get("id")}
    cache = load_cache()
    seeds: dict[str, list[str]] = {}
    if SEEDS_PATH.is_file():
        seeds = json.loads(SEEDS_PATH.read_text(encoding="utf-8"))

    hood_counts = Counter(p.get("neighborhood") for p in food)
    added = 0
    for hood, bbox in NEIGHBORHOODS.items():
        need = max(0, PER_HOOD - hood_counts.get(hood, 0))
        if need <= 0:
            print(f"{hood}: skip (have {hood_counts.get(hood, 0)})")
            continue
        south, west, north, east = bbox
        candidates: list[dict] = []
        seed_names = seeds.get(hood) or []
        for sname in seed_names:
            if norm_name(sname) in taken:
                continue
            lat, lng, addr = geocode(sname, hood + " Philadelphia", cache)
            if lat is None:
                continue
            candidates.append(
                {
                    "name": sname,
                    "address": addr,
                    "lat": round(lat, 6),
                    "lng": round(lng, 6),
                    "opening_hours": "",
                    "website": "",
                    "score": 1000,
                }
            )
        try:
            candidates.extend(overpass_restaurants(south, west, north, east))
            time.sleep(2)
        except Exception as e:
            print(f"Overpass failed for {hood}: {e}")
        picked: list[dict] = []
        seen_local: set[str] = set()
        for c in sorted(candidates, key=lambda r: -r["score"]):
            nk = norm_name(c["name"])
            if not nk or nk in taken or nk in seen_local:
                continue
            seen_local.add(nk)
            picked.append(c)
            if len(picked) >= need:
                break
        for c in picked:
            pid = slug(c["name"])
            if pid in ids:
                pid = pid + "-" + hood.lower().replace(" ", "-")[:12]
            ids.add(pid)
            taken.add(norm_name(c["name"]))
            oh = c.get("opening_hours") or ""
            note = f"Listed in {hood} (OpenStreetMap / local picks). Verify hours and menu."
            if c["score"] >= 1000:
                note = f"Popular pick in {hood}. Verify hours before visiting."
            food.append(
                {
                    **place_row(
                        c["name"],
                        hood,
                        c["address"],
                        c["lat"],
                        c["lng"],
                        note,
                        c.get("website") or "",
                        f"OSM hours: {oh}" if oh else "",
                    ),
                    "id": pid,
                }
            )
            added += 1
        hood_counts[hood] = hood_counts.get(hood, 0) + len(picked)
        print(f"{hood}: +{len(picked)} (now {hood_counts.get(hood, 0)}, target {PER_HOOD})")

    drink_names = existing_names([], drinks)
    chain_added = 0
    chain_seen: set[str] = set()
    for hood, bbox in NEIGHBORHOODS.items():
        south, west, north, east = bbox
        try:
            rows = overpass_restaurants(south, west, north, east)
            time.sleep(1.5)
        except Exception as e:
            print(f"Allowed chains: Overpass failed for {hood}: {e}")
            continue
        for c in rows:
            if not ALLOWED_CHAIN.search(c["name"]):
                continue
            nk = norm_name(c["name"])
            if nk in drink_names:
                continue
            loc_key = f"{nk}|{c['lat']}|{c['lng']}"
            if loc_key in chain_seen:
                continue
            chain_seen.add(loc_key)
            pid = slug(f"{c['name']}-{c['lat']}")
            if pid in ids:
                pid = f"{pid}-{hood.lower().replace(' ', '-')[:10]}"
            ids.add(pid)
            oh = c.get("opening_hours") or ""
            food.append(
                {
                    **place_row(
                        c["name"],
                        hood,
                        c["address"],
                        c["lat"],
                        c["lng"],
                        f"{c['name']} ({hood}). Chain location from OpenStreetMap.",
                        c.get("website") or "",
                        f"OSM hours: {oh}" if oh else "",
                    ),
                    "id": pid,
                }
            )
            chain_added += 1
    if chain_added:
        print(f"Allowed chains: +{chain_added}")
        added += chain_added

    save_cache(cache)
    FOOD_PATH.write_text(json.dumps(food, indent=2) + "\n", encoding="utf-8")
    meta_path = ROOT / "coffee-drinks-map" / "catalog-meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["food"] = len(food)
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Total food places: {len(food)} (+{added} new)")


if __name__ == "__main__":
    main()
