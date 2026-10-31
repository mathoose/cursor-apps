#!/usr/bin/env python3
"""Fix known-bad rows after bulk photon sync (see location-sync-report.json)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRINKS = ROOT / "coffee-drinks-map" / "drinks.json"
REPORT = ROOT / "scripts" / "location-sync-report.json"

# Verified OSM building points (Photon housenumber match).
MANUAL = {
    # Passyunk (plan examples): building / OSM POI coords
    "Barcelona Wine Bar": (39.9280849, -75.1653322),
    "Cantinas los caballitos": (39.9289141, -75.1643785),
    "La Chinesca": (39.96182, -75.155124),
    "Poison heart": (39.961476, -75.154058),
    "Alice": (39.9619369, -75.1558934),
    "Fountain Porter": (39.9294913, -75.161383),
    "Prunella": (39.94997, -75.162028),
    "Vintage Wine Bar": (39.949648, -75.161882),
    "Darling Jack's Tavern": (39.950382, -75.16172),
    "Double Knot": (39.949691, -75.16209),
    # Same Sansom row as Harp & Crown; OSM has no named POI for Giuseppe / Lesiuer.
    "Giuseppe & Sons": (39.950452, -75.166199),
    "The Lesiuer": (39.9506117, -75.16722),
}

# Photon mis-parsed "South St" / moved too far — restore pre-sync pins from report.
REVERT_FROM_REPORT = {
    "Bob & Barbara's",
    "Indo Spice Restaurant",
}


def main() -> None:
    places = json.loads(DRINKS.read_text(encoding="utf-8"))
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    by_name = {u["name"]: u for u in report.get("updated", [])}

    for p in places:
        name = p.get("name")
        if name in MANUAL:
            lat, lng = MANUAL[name]
            p["lat"] = round(lat, 6)
            p["lng"] = round(lng, 6)
            p["locationSource"] = "photon-osm-manual"
            p["locationSyncedAt"] = "2026-10-06"
        elif name in REVERT_FROM_REPORT and name in by_name:
            prev = by_name[name]["from"]
            p["lat"] = prev["lat"]
            p["lng"] = prev["lng"]
            p.pop("locationSource", None)
            p.pop("locationSyncedAt", None)

    DRINKS.write_text(json.dumps(places, indent=2) + "\n", encoding="utf-8")
    print("Reconciled", len(MANUAL), "manual fixes and", len(REVERT_FROM_REPORT), "reverts.")


if __name__ == "__main__":
    main()
