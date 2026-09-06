#!/usr/bin/env python3
"""Build Superflex snapshot JSON. Run from this folder."""
import json
from pathlib import Path

# Positional top 14 per source (1-indexed by list order).
BDGE = {
    "QB": ["Josh Allen", "Drake Maye", "Lamar Jackson", "Jayden Daniels", "Jalen Hurts", "Joe Burrow", "Caleb Williams", "Patrick Mahomes", "Justin Herbert", "Jordan Love", "Bo Nix", "Jaxson Dart", "Brock Purdy", "Dak Prescott"],
    "RB": ["Bijan Robinson", "Jahmyr Gibbs", "Ashton Jeanty", "Omarion Hampton", "De'Von Achane", "Jonathan Taylor", "James Cook", "TreVeyon Henderson", "Christian McCaffrey", "Kyren Williams", "Saquon Barkley", "Breece Hall", "Bucky Irving", "RJ Harvey"],
    "WR": ["Puka Nacua", "Ja'Marr Chase", "Jaxon Smith-Njigba", "Malik Nabers", "Amon-Ra St. Brown", "CeeDee Lamb", "Justin Jefferson", "Drake London", "Tetairoa McMillan", "Nico Collins", "George Pickens", "Emeka Egbuka", "Garrett Wilson", "Chris Olave"],
    "TE": ["Trey McBride", "Brock Bowers", "Colston Loveland", "Tyler Warren", "Harold Fannin", "Kyle Pitts", "Tucker Kraft", "George Kittle", "Sam LaPorta", "Dalton Kincaid", "Jake Ferguson", "Mark Andrews", "Isaiah Likely", "David Njoku"],
}
RW = {
    "QB": ["Josh Allen", "Drake Maye", "Caleb Williams", "Jayden Daniels", "Lamar Jackson", "Joe Burrow", "Justin Herbert", "Jalen Hurts", "Bo Nix", "Trevor Lawrence", "Jaxson Dart", "Patrick Mahomes", "Brock Purdy", "Dak Prescott"],
    "RB": ["Jahmyr Gibbs", "Bijan Robinson", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton", "De'Von Achane", "Chase Brown", "James Cook", "Jonathan Taylor", "Kenneth Walker", "Quinshon Judkins", "TreVeyon Henderson", "Breece Hall", "Saquon Barkley"],
    "WR": ["Puka Nacua", "Ja'Marr Chase", "Jaxon Smith-Njigba", "Justin Jefferson", "Malik Nabers", "Amon-Ra St. Brown", "CeeDee Lamb", "Emeka Egbuka", "Drake London", "Chris Olave", "Zay Flowers", "Nico Collins", "Ladd McConkey", "Jaylen Waddle"],
    "TE": ["Brock Bowers", "Trey McBride", "Colston Loveland", "Tyler Warren", "Tucker Kraft", "Sam LaPorta", "Harold Fannin", "Kyle Pitts", "Terrance Ferguson", "Kenyon Sadiq", "Isaiah Likely", "George Kittle", "Brenton Strange", "Eli Stowers"],
}
# KeepTradeCut Superflex via Dynasty Dealmaker (KTC-powered), Sep 6 2026.
KTC = {
    "QB": ["Josh Allen", "Drake Maye", "Caleb Williams", "Lamar Jackson", "Jayden Daniels", "Joe Burrow", "Justin Herbert", "Patrick Mahomes", "Jaxson Dart", "Trevor Lawrence", "Jalen Hurts", "Bo Nix", "Brock Purdy", "Fernando Mendoza"],
    "RB": ["Bijan Robinson", "Jahmyr Gibbs", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton", "De'Von Achane", "Jonathan Taylor", "James Cook", "Kenneth Walker", "Quinshon Judkins", "TreVeyon Henderson", "Chase Brown", "Breece Hall", "Christian McCaffrey"],
    "WR": ["Ja'Marr Chase", "Jaxon Smith-Njigba", "Puka Nacua", "Amon-Ra St. Brown", "Justin Jefferson", "Malik Nabers", "CeeDee Lamb", "Drake London", "Tetairoa McMillan", "Emeka Egbuka", "George Pickens", "Carnell Tate", "Ladd McConkey", "Nico Collins"],
    "TE": ["Brock Bowers", "Trey McBride", "Colston Loveland", "Tyler Warren", "Tucker Kraft", "Harold Fannin", "Sam LaPorta", "Kyle Pitts", "Kenyon Sadiq"],
}
FC = {
    "QB": ["Josh Allen", "Drake Maye", "Lamar Jackson", "Caleb Williams", "Joe Burrow", "Jayden Daniels", "Justin Herbert", "Jalen Hurts", "Trevor Lawrence", "Jaxson Dart", "Patrick Mahomes", "Bo Nix", "Dak Prescott", "Brock Purdy"],
    "RB": ["Jahmyr Gibbs", "Bijan Robinson", "Jeremiyah Love", "Ashton Jeanty", "De'Von Achane", "Omarion Hampton", "James Cook", "Jonathan Taylor", "Christian McCaffrey", "Saquon Barkley", "Chase Brown", "Kenneth Walker", "Breece Hall", "Jadarian Price"],
    "WR": ["Ja'Marr Chase", "Jaxon Smith-Njigba", "Puka Nacua", "Amon-Ra St. Brown", "Justin Jefferson", "Malik Nabers", "CeeDee Lamb", "Drake London", "George Pickens", "Nico Collins", "Tetairoa McMillan", "Chris Olave", "Emeka Egbuka", "A.J. Brown"],
    "TE": ["Brock Bowers", "Trey McBride", "Colston Loveland", "Tyler Warren", "Tucker Kraft", "Sam LaPorta", "Harold Fannin", "Kyle Pitts", "Kenyon Sadiq", "George Kittle", "Dalton Kincaid", "Isaiah Likely", "Jake Ferguson", "Eli Stowers"],
}
# FantasyPros 3-expert dynasty consensus Aug 31 2026 (table published through 12; 13–14 from adjacent ECR).
FP = {
    "QB": ["Drake Maye", "Josh Allen", "Jayden Daniels", "Lamar Jackson", "Justin Herbert", "Joe Burrow", "Jalen Hurts", "Patrick Mahomes", "Caleb Williams", "Trevor Lawrence", "Jaxson Dart", "Brock Purdy", "Bo Nix", "Jordan Love"],
    "RB": ["Jahmyr Gibbs", "Bijan Robinson", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton", "De'Von Achane", "James Cook", "Kenneth Walker", "Breece Hall", "Jonathan Taylor", "Chase Brown", "Saquon Barkley", "Christian McCaffrey", "TreVeyon Henderson"],
    "WR": ["Ja'Marr Chase", "Jaxon Smith-Njigba", "Puka Nacua", "Amon-Ra St. Brown", "Malik Nabers", "Drake London", "Justin Jefferson", "CeeDee Lamb", "Tetairoa McMillan", "Nico Collins", "Zay Flowers", "George Pickens", "Emeka Egbuka", "Chris Olave"],
    "TE": ["Brock Bowers", "Colston Loveland", "Trey McBride", "Tyler Warren", "Tucker Kraft", "Kyle Pitts", "Sam LaPorta", "Harold Fannin", "Eli Stowers", "Kenyon Sadiq", "Isaiah Likely", "Dalton Kincaid", "George Kittle", "Jake Ferguson"],
}

META = {
    "Josh Allen": ("QB", "BUF", 30.3),
    "Drake Maye": ("QB", "NE", 24.0),
    "Lamar Jackson": ("QB", "BAL", 29.6),
    "Jayden Daniels": ("QB", "WAS", 25.7),
    "Jalen Hurts": ("QB", "PHI", 28.0),
    "Joe Burrow": ("QB", "CIN", 29.7),
    "Caleb Williams": ("QB", "CHI", 24.8),
    "Patrick Mahomes": ("QB", "KC", 29.6),
    "Justin Herbert": ("QB", "LAC", 28.5),
    "Jordan Love": ("QB", "GB", 27.8),
    "Bo Nix": ("QB", "DEN", 26.5),
    "Jaxson Dart": ("QB", "NYG", 23.3),
    "Brock Purdy": ("QB", "SF", 26.7),
    "Dak Prescott": ("QB", "DAL", 33.1),
    "Trevor Lawrence": ("QB", "JAX", 26.9),
    "Fernando Mendoza": ("QB", "LV", 22.9),
    "Kyler Murray": ("QB", "MIN", 29.0),
    "Tyler Shough": ("QB", "NO", 26.9),
    "Tua Tagovailoa": ("QB", "ATL", 28.5),
    "Jacoby Brissett": ("QB", "ARI", 33.7),
    "Carson Beck": ("QB", "ARI", 23.8),
    "Bijan Robinson": ("RB", "ATL", 24.6),
    "Jahmyr Gibbs": ("RB", "DET", 24.4),
    "Ashton Jeanty": ("RB", "LV", 22.7),
    "Jeremiyah Love": ("RB", "ARI", 21.3),
    "Omarion Hampton": ("RB", "LAC", 23.4),
    "De'Von Achane": ("RB", "MIA", 24.9),
    "Jonathan Taylor": ("RB", "IND", 27.6),
    "James Cook": ("RB", "BUF", 26.9),
    "TreVeyon Henderson": ("RB", "NE", 23.8),
    "Christian McCaffrey": ("RB", "SF", 30.2),
    "Kyren Williams": ("RB", "LAR", 26.0),
    "Saquon Barkley": ("RB", "PHI", 29.5),
    "Breece Hall": ("RB", "NYJ", 25.2),
    "Bucky Irving": ("RB", "TB", 24.0),
    "RJ Harvey": ("RB", "DEN", 25.6),
    "Chase Brown": ("RB", "CIN", 26.4),
    "Kenneth Walker": ("RB", "KC", 25.8),
    "Quinshon Judkins": ("RB", "CLE", 22.8),
    "Jadarian Price": ("RB", "SEA", 22.9),
    "Travis Etienne": ("RB", "NO", 27.6),
    "Isiah Pacheco": ("RB", "DET", 27.5),
    "Dylan Sampson": ("RB", "CLE", 21.9),
    "Mike Washington": ("RB", "LV", 23.1),
    "Puka Nacua": ("WR", "LAR", 25.2),
    "Ja'Marr Chase": ("WR", "CIN", 26.5),
    "Jaxon Smith-Njigba": ("WR", "SEA", 24.5),
    "Malik Nabers": ("WR", "NYG", 23.1),
    "Amon-Ra St. Brown": ("WR", "DET", 26.8),
    "CeeDee Lamb": ("WR", "DAL", 25.4),
    "Justin Jefferson": ("WR", "MIN", 27.2),
    "Drake London": ("WR", "ATL", 25.1),
    "Tetairoa McMillan": ("WR", "CAR", 23.4),
    "Nico Collins": ("WR", "HOU", 25.4),
    "George Pickens": ("WR", "DAL", 25.5),
    "Emeka Egbuka": ("WR", "TB", 23.9),
    "Garrett Wilson": ("WR", "NYJ", 26.1),
    "Chris Olave": ("WR", "NO", 24.2),
    "Zay Flowers": ("WR", "BAL", 24.0),
    "Ladd McConkey": ("WR", "LAC", 24.8),
    "Jaylen Waddle": ("WR", "DEN", 27.2),
    "Carnell Tate": ("WR", "TEN", 21.6),
    "A.J. Brown": ("WR", "NE", 29.2),
    "Terry McLaurin": ("WR", "WAS", 30.9),
    "Michael Wilson": ("WR", "ARI", 26.5),
    "Jalen Coker": ("WR", "CAR", 23.3),
    "Malachi Fields": ("WR", "NYG", 23.0),
    "Caleb Douglas": ("WR", "MIA", 23.0),
    "Courtland Sutton": ("WR", "DEN", 30.9),
    "DK Metcalf": ("WR", "PIT", 28.7),
    "Trey McBride": ("TE", "ARI", 26.8),
    "Brock Bowers": ("TE", "LV", 23.7),
    "Colston Loveland": ("TE", "CHI", 20.3),
    "Tyler Warren": ("TE", "IND", 24.3),
    "Harold Fannin": ("TE", "CLE", 22.1),
    "Kyle Pitts": ("TE", "ATL", 25.9),
    "Tucker Kraft": ("TE", "GB", 25.8),
    "George Kittle": ("TE", "SF", 32.9),
    "Sam LaPorta": ("TE", "DET", 25.6),
    "Dalton Kincaid": ("TE", "BUF", 26.9),
    "Jake Ferguson": ("TE", "DAL", 27.6),
    "Mark Andrews": ("TE", "BAL", 31.0),
    "Isaiah Likely": ("TE", "NYG", 26.4),
    "David Njoku": ("TE", "LAC", 30.0),
    "Terrance Ferguson": ("TE", "LAR", 23.5),
    "Kenyon Sadiq": ("TE", "NYJ", 21.5),
    "Brenton Strange": ("TE", "JAX", 25.7),
    "Eli Stowers": ("TE", "PHI", 23.4),
}

RW_VALUE = {
    "Jahmyr Gibbs": 9999, "Bijan Robinson": 9998, "Puka Nacua": 9989, "Ja'Marr Chase": 9986,
    "Josh Allen": 9189, "Drake Maye": 8906, "Jaxon Smith-Njigba": 8547, "Caleb Williams": 8283,
    "Brock Bowers": 8175, "Jayden Daniels": 7773, "Justin Jefferson": 7550, "Ashton Jeanty": 7374,
    "Jeremiyah Love": 7363, "Lamar Jackson": 7340, "Malik Nabers": 7335, "Amon-Ra St. Brown": 7300,
    "CeeDee Lamb": 7278, "Trey McBride": 7256, "Joe Burrow": 7159, "Justin Herbert": 6957,
    "Omarion Hampton": 6920, "Emeka Egbuka": 6913, "De'Von Achane": 6799, "Chase Brown": 6510,
    "Drake London": 6420, "James Cook": 6311, "Jonathan Taylor": 6296, "Jalen Hurts": 6273,
    "Chris Olave": 6222, "Zay Flowers": 6221, "Nico Collins": 6058, "Colston Loveland": 5989,
    "Bo Nix": 5953, "Ladd McConkey": 5921, "Jaylen Waddle": 5840, "Garrett Wilson": 5765,
    "Trevor Lawrence": 5757, "Jaxson Dart": 5752, "Tetairoa McMillan": 5749, "George Pickens": 5748,
    "Tyler Warren": 5669, "Kenneth Walker": 5646, "Patrick Mahomes": 5545, "Brock Purdy": 5544,
    "Carnell Tate": 5286, "Dak Prescott": 5326, "Jordan Love": 5316, "Quinshon Judkins": 5304,
    "TreVeyon Henderson": 5297, "Breece Hall": 5262, "Fernando Mendoza": 5235, "A.J. Brown": 5152,
    "Saquon Barkley": 5107, "Christian McCaffrey": 5065, "Kyren Williams": 4929, "Jadarian Price": 4963,
    "Tyler Shough": 4803, "Tucker Kraft": 4819, "Sam LaPorta": 4566, "Kyler Murray": 4565,
    "Bucky Irving": 4408, "Harold Fannin": 4366, "Kyle Pitts": 4281, "Travis Etienne": 3968,
    "Terry McLaurin": 3747, "Michael Wilson": 3733, "DK Metcalf": 3498, "Terrance Ferguson": 3310,
    "Kenyon Sadiq": 3308, "Tua Tagovailoa": 3292, "Jacoby Brissett": 3270, "Isaiah Likely": 3215,
    "Jalen Coker": 3199, "George Kittle": 3189, "RJ Harvey": 3051, "Brenton Strange": 3036,
    "Eli Stowers": 3030, "Jake Ferguson": 3023, "Mike Washington": 2983, "Malachi Fields": 2898,
    "Dalton Kincaid": 2870, "Mark Andrews": 2848, "Courtland Sutton": 2762, "Carson Beck": 2719,
    "Caleb Douglas": 2645, "Dylan Sampson": 2342, "Isiah Pacheco": 2285,
}

YOU = {
    "Lamar Jackson", "Bo Nix", "Kyler Murray", "Tyler Shough", "Tua Tagovailoa",
    "Jacoby Brissett", "Carson Beck", "Jonathan Taylor", "Christian McCaffrey",
    "Chase Brown", "Travis Etienne", "Isiah Pacheco", "Dylan Sampson", "Mike Washington",
    "George Pickens", "Emeka Egbuka", "Terry McLaurin", "Michael Wilson", "Jalen Coker",
    "Malachi Fields", "Caleb Douglas", "Courtland Sutton", "DK Metcalf",
    "Tucker Kraft", "Mark Andrews", "Jake Ferguson",
}

SOURCES = [
    ("bdge", BDGE),
    ("rotowire", RW),
    ("ktc", KTC),
    ("fantasycalc", FC),
    ("fantasypros", FP),
]


def rank_map(board):
    out = {}
    for pos, names in board.items():
        for i, name in enumerate(names, 1):
            out[name] = i
    return out


maps = {key: rank_map(board) for key, board in SOURCES}

names = set(META)
for _, board in SOURCES:
    for lst in board.values():
        names.update(lst)
names.update(YOU)

players = []
for name in sorted(names):
    pos, team, age = META[name]
    ranks = {key: maps[key].get(name) for key, _ in SOURCES}
    players.append({
        "name": name,
        "pos": pos,
        "team": team,
        "age": age,
        "value": RW_VALUE.get(name),
        "you": name in YOU,
        "ranks": ranks,
    })

payload = {
    "updated": "2026-09-06",
    "format": "superflex",
    "valueScale": "RotoWire Superflex JTV (Jagger May, Sep 3 2026)",
    "sources": [
        {"id": "bdge", "label": "BDGE", "note": "Nick Ercolano Superflex / positional, FantasyPros expert page"},
        {"id": "rotowire", "label": "RW", "note": "RotoWire Superflex trade chart, Jagger May, Sep 3 2026"},
        {"id": "ktc", "label": "KTC", "note": "KeepTradeCut Superflex via Dynasty Dealmaker, Sep 6 2026"},
        {"id": "fantasycalc", "label": "FC", "note": "FantasyCalc Superflex API, 10-team 0.5 PPR, Sep 6 2026"},
        {"id": "fantasypros", "label": "FP", "note": "FantasyPros 3-expert dynasty consensus Aug 31 2026; ranks 13–14 from adjacent ECR"},
    ],
    "players": players,
}

out = Path(__file__).with_name("rankings.json")
out.write_text(json.dumps(payload, indent=2) + "\n")
print(f"Wrote {out} ({len(players)} players)")
