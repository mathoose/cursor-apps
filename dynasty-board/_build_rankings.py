#!/usr/bin/env python3
"""Build Superflex dynasty snapshot + league owners. Run from this folder."""
from __future__ import annotations

import json
import re
from pathlib import Path

FC_PATH = Path("/home/ubuntu/.cursor/projects/workspace/agent-tools/af9308c3-f3c2-43c9-925f-5a40220a71f7.txt")
TARGET = 280

# Superflex dynasty positional boards (deeper than top 14).
BDGE = {
    "QB": [
        "Josh Allen", "Drake Maye", "Lamar Jackson", "Jayden Daniels", "Jalen Hurts", "Joe Burrow",
        "Caleb Williams", "Patrick Mahomes", "Justin Herbert", "Jordan Love", "Bo Nix", "Jaxson Dart",
        "Brock Purdy", "Dak Prescott", "Trevor Lawrence", "C.J. Stroud", "Baker Mayfield", "Sam Darnold",
        "Jared Goff", "Cam Ward", "Matthew Stafford", "Kyler Murray", "Bryce Young", "J.J. McCarthy",
        "Michael Penix", "Daniel Jones", "Tua Tagovailoa", "Justin Fields", "Geno Smith", "Aaron Rodgers",
        "Tyler Shough", "Jacoby Brissett", "Shedeur Sanders", "Anthony Richardson", "Joe Flacco",
        "Mac Jones", "Jalen Milroe", "Jameis Winston", "Malik Willis", "Brady Cook", "Will Levis",
        "Will Howard", "Dillon Gabriel", "Mason Rudolph", "Kenny Pickett", "Joe Milton", "Sam Howell",
        "Zach Wilson", "Gardner Minshew", "Aidan O'Connell", "Russell Wilson", "Deshaun Watson",
        "Jake Browning", "Spencer Rattler", "Kirk Cousins", "Quinn Ewers", "Kyle McCord", "Trey Lance",
        "Hendon Hooker", "Marcus Mariota", "Riley Leonard", "Tyrod Taylor", "Andy Dalton", "Joshua Dobbs",
        "Tyson Bagent",
    ],
    "RB": [
        "Bijan Robinson", "Jahmyr Gibbs", "Ashton Jeanty", "Omarion Hampton", "De'Von Achane",
        "Jonathan Taylor", "James Cook", "TreVeyon Henderson", "Christian McCaffrey", "Kyren Williams",
        "Saquon Barkley", "Breece Hall", "Bucky Irving", "RJ Harvey", "Quinshon Judkins", "Chase Brown",
        "Derrick Henry", "Javonte Williams", "Travis Etienne", "Josh Jacobs", "Kenneth Walker",
        "David Montgomery", "Rico Dowdle", "Cam Skattebo", "D'Andre Swift", "Zach Charbonnet",
        "Woody Marks", "Tyrone Tracy", "Trey Benson", "Bhayshul Tuten", "Jaylen Warren", "Alvin Kamara",
        "Jordan Mason", "Jacory Croskey-Merritt", "Tony Pollard", "Chuba Hubbard", "Isiah Pacheco",
        "Braelon Allen", "Dylan Sampson", "Brian Robinson", "Najee Harris", "Rhamondre Stevenson",
        "DJ Giddens", "Aaron Jones", "Rachaad White", "Tank Bigsby", "Ray Davis", "Trevor Etienne",
        "Kendre Miller", "Kaleb Johnson", "Kyle Monangai", "Tyjae Spears", "Blake Corum", "Isaac Guerendo",
        "Chris Rodriguez", "J.K. Dobbins", "Bam Knight", "Jaleel McLaughlin", "Jordan James",
        "Jarquez Hunter", "Kareem Hunt", "MarShawn Lloyd", "Devin Neal", "Brashard Smith", "Sean Tucker",
        "Jonathon Brooks", "Roschon Johnson", "James Conner", "Ollie Gordon", "Jaylen Wright",
        "Tahj Brooks", "Jaydon Blue", "Tyler Allgeier", "Keaton Mitchell", "Kimani Vidal", "Kenny Gainwell",
        "Jerome Ford", "Mike Washington", "Emmett Johnson", "Jonah Coleman", "Kaytron Allen",
        "Nicholas Singleton",
    ],
    "WR": [
        "Puka Nacua", "Ja'Marr Chase", "Jaxon Smith-Njigba", "Malik Nabers", "Amon-Ra St. Brown",
        "CeeDee Lamb", "Justin Jefferson", "Drake London", "Tetairoa McMillan", "Nico Collins",
        "George Pickens", "Emeka Egbuka", "Garrett Wilson", "Chris Olave", "Tee Higgins", "Rashee Rice",
        "Rome Odunze", "Marvin Harrison", "Zay Flowers", "A.J. Brown", "Ladd McConkey", "Jordan Addison",
        "Jaylen Waddle", "DeVonta Smith", "DK Metcalf", "Brian Thomas", "Jameson Williams", "Travis Hunter",
        "Terry McLaurin", "Luther Burden", "Courtland Sutton", "Davante Adams", "Ricky Pearsall",
        "Michael Pittman", "Khalil Shakir", "Xavier Worthy", "Keon Coleman", "Quentin Johnston",
        "DJ Moore", "Jakobi Meyers", "Jayden Reed", "Troy Franklin", "Deebo Samuel", "Josh Downs",
        "Mike Evans", "Tre Tucker", "Tre' Harris", "Elic Ayomanor", "Jayden Higgins", "Jauan Jennings",
        "Kyle Williams", "Chris Godwin", "Matthew Golden", "Isaac TeSlaa", "Keenan Allen", "Cooper Kupp",
        "Adonai Mitchell", "Kayshon Boutte", "Wan'Dale Robinson", "Dont'e Thornton", "Darnell Mooney",
        "Cedric Tillman", "Marvin Mims", "Rashid Shaheed", "Calvin Ridley", "Caleb Douglas",
        "Xavier Legette", "Romeo Doubs", "Rashod Bateman", "Stefon Diggs", "Dontayvion Wicks",
        "Jack Bech", "Brandon Aiyuk", "Parker Washington", "Christian Watson", "Jerry Jeudy",
        "Jalen Coker", "Hollywood Brown", "Jaylin Noel", "Jalen McMillan", "Christian Kirk",
        "Alec Pierce", "Michael Wilson", "Malik Washington", "Malachi Fields", "Carnell Tate",
        "Jordyn Tyson", "KC Concepcion", "Makai Lemon", "Denzel Boston", "Omar Cooper", "Ja'Kobi Lane",
    ],
    "TE": [
        "Trey McBride", "Brock Bowers", "Colston Loveland", "Tyler Warren", "Harold Fannin",
        "Kyle Pitts", "Tucker Kraft", "George Kittle", "Sam LaPorta", "Dalton Kincaid",
        "Jake Ferguson", "Mark Andrews", "Isaiah Likely", "David Njoku", "Mason Taylor",
        "Brenton Strange", "Dallas Goedert", "AJ Barner", "Theo Johnson", "Cade Otton",
        "T.J. Hockenson", "Hunter Henry", "Evan Engram", "Chig Okonkwo", "Ja'Tavion Sanders",
        "Pat Freiermuth", "Travis Kelce", "Terrance Ferguson", "Dalton Schultz", "Luke Musgrave",
        "Jonnu Smith", "Cade Stover", "Noah Gray", "Zach Ertz", "Dawson Knox", "Michael Mayer",
        "Elijah Arroyo", "Cole Kmet", "Ben Sinnott", "Mike Gesicki", "Colby Parkinson",
        "Juwan Johnson", "Greg Dulcich", "Gunnar Helm", "Oronde Gadsden", "Noah Fant",
        "Eli Stowers", "Kenyon Sadiq", "Eli Raridon",
    ],
}

# Superflex dynasty (Jagger May, Sep 3 2026) — positional order from the RW chart.
RW = {
    "QB": [
        "Josh Allen", "Drake Maye", "Caleb Williams", "Jayden Daniels", "Lamar Jackson", "Joe Burrow",
        "Justin Herbert", "Jalen Hurts", "Bo Nix", "Trevor Lawrence", "Jaxson Dart", "Patrick Mahomes",
        "Brock Purdy", "Dak Prescott", "Jordan Love", "Fernando Mendoza", "Cam Ward", "Tyler Shough",
        "Jared Goff", "C.J. Stroud", "Baker Mayfield", "Kyler Murray", "Sam Darnold", "Matthew Stafford",
        "Bryce Young", "Malik Willis", "Daniel Jones", "Ty Simpson", "Geno Smith", "Aaron Rodgers",
        "Tua Tagovailoa", "Michael Penix", "Jacoby Brissett", "Drew Allar", "Carson Beck",
    ],
    "RB": [
        "Jahmyr Gibbs", "Bijan Robinson", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton",
        "De'Von Achane", "Chase Brown", "James Cook", "Jonathan Taylor", "Kenneth Walker",
        "Quinshon Judkins", "TreVeyon Henderson", "Breece Hall", "Saquon Barkley", "Christian McCaffrey",
        "Jadarian Price", "Kyren Williams", "Cam Skattebo", "Javonte Williams", "D'Andre Swift",
        "Bucky Irving", "Bhayshul Tuten", "Travis Etienne", "Josh Jacobs", "Jonathon Brooks",
        "Derrick Henry", "David Montgomery", "Jaylen Warren", "Rico Dowdle", "Blake Corum",
        "Rhamondre Stevenson", "Jonah Coleman", "Kyle Monangai", "Jordan Mason", "Rachaad White",
        "RJ Harvey", "Jacory Croskey-Merritt", "Tyler Allgeier", "Chuba Hubbard", "Zach Charbonnet",
        "MarShawn Lloyd", "Mike Washington", "Tony Pollard", "Woody Marks", "J.K. Dobbins",
        "Aaron Jones", "Tyjae Spears", "Kenny Gainwell", "Tank Bigsby", "Keaton Mitchell",
        "Alvin Kamara", "Ray Davis", "Emmett Johnson", "Chris Rodriguez", "Chris Brooks",
        "George Holani", "Demond Claiborne", "James Conner", "Braelon Allen", "Sean Tucker",
        "Dylan Sampson", "Nicholas Singleton", "Kaytron Allen", "Isiah Pacheco", "Tyrone Tracy",
        "Isaiah Davis", "Brian Robinson", "Kaleb Johnson",
    ],
    "WR": [
        "Puka Nacua", "Ja'Marr Chase", "Jaxon Smith-Njigba", "Justin Jefferson", "Malik Nabers",
        "Amon-Ra St. Brown", "CeeDee Lamb", "Emeka Egbuka", "Drake London", "Chris Olave",
        "Zay Flowers", "Nico Collins", "Ladd McConkey", "Jaylen Waddle", "Garrett Wilson",
        "Tetairoa McMillan", "George Pickens", "Luther Burden", "DeVonta Smith", "Carnell Tate",
        "Rome Odunze", "A.J. Brown", "Tee Higgins", "Parker Washington", "Brian Thomas",
        "KC Concepcion", "Makai Lemon", "Jordyn Tyson", "Jameson Williams", "Marvin Harrison",
        "De'Zhaun Stribling", "DJ Moore", "Josh Downs", "Davante Adams", "Christian Watson",
        "Terry McLaurin", "Rashee Rice", "Michael Wilson", "Denzel Boston", "Jayden Reed",
        "DK Metcalf", "Mike Evans", "Jordan Addison", "Alec Pierce", "Matthew Golden",
        "Quentin Johnston", "Jayden Higgins", "Jalen Coker", "Michael Pittman", "Chris Godwin",
        "Omar Cooper", "Stefon Diggs", "Cyrus Allen", "Xavier Worthy", "Malachi Fields",
        "Germie Bernard", "Romeo Doubs", "Kayshon Boutte", "Pat Bryant", "Travis Hunter",
        "Wan'Dale Robinson", "Adonai Mitchell", "Courtland Sutton", "Ted Hurst", "Caleb Douglas",
        "Antonio Williams", "Ja'Kobi Lane", "Tre Tucker", "Jauan Jennings", "Jakobi Meyers",
        "Khalil Shakir", "Jerry Jeudy", "Malik Washington", "Jalen McMillan", "Zachariah Branch",
        "Deebo Samuel", "Rashid Shaheed", "Ryan Flournoy",
    ],
    "TE": [
        "Brock Bowers", "Trey McBride", "Colston Loveland", "Tyler Warren", "Tucker Kraft",
        "Sam LaPorta", "Harold Fannin", "Kyle Pitts", "Terrance Ferguson", "Kenyon Sadiq",
        "Isaiah Likely", "George Kittle", "Brenton Strange", "Eli Stowers", "Jake Ferguson",
        "AJ Barner", "Dalton Kincaid", "Mark Andrews", "Eli Raridon", "T.J. Hockenson",
        "Chig Okonkwo", "Travis Kelce", "Dallas Goedert", "Dalton Schultz", "Cade Otton",
        "Colby Parkinson", "Juwan Johnson", "Oronde Gadsden", "Gunnar Helm", "Hunter Henry",
        "Charlie Kolar", "Oscar Delp", "Michael Mayer", "Mason Taylor", "Max Klare", "Greg Dulcich",
    ],
}

# KeepTradeCut Superflex via Dynasty Dealmaker (positional ranks from SF overall).
KTC = {
    "QB": [
        "Josh Allen", "Drake Maye", "Caleb Williams", "Lamar Jackson", "Jayden Daniels", "Joe Burrow",
        "Justin Herbert", "Patrick Mahomes", "Jaxson Dart", "Trevor Lawrence", "Jalen Hurts", "Bo Nix",
        "Brock Purdy", "Fernando Mendoza", "Jordan Love", "Cam Ward", "Dak Prescott", "Tyler Shough",
        "Jared Goff", "Baker Mayfield", "C.J. Stroud", "Sam Darnold", "Kyler Murray", "Bryce Young",
        "Daniel Jones", "Matthew Stafford", "Malik Willis",
    ],
    "RB": [
        "Bijan Robinson", "Jahmyr Gibbs", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton",
        "De'Von Achane", "Jonathan Taylor", "James Cook", "Kenneth Walker", "Quinshon Judkins",
        "TreVeyon Henderson", "Chase Brown", "Breece Hall", "Christian McCaffrey", "Saquon Barkley",
        "Kyren Williams", "Jadarian Price", "Cam Skattebo", "Bucky Irving", "Javonte Williams",
        "Travis Etienne", "Bhayshul Tuten", "Derrick Henry", "Josh Jacobs", "D'Andre Swift",
        "Kyle Monangai", "Jonathon Brooks",
    ],
    "WR": [
        "Ja'Marr Chase", "Jaxon Smith-Njigba", "Puka Nacua", "Amon-Ra St. Brown", "Justin Jefferson",
        "Malik Nabers", "CeeDee Lamb", "Drake London", "Tetairoa McMillan", "Emeka Egbuka",
        "George Pickens", "Carnell Tate", "Ladd McConkey", "Nico Collins", "Garrett Wilson",
        "Chris Olave", "Luther Burden", "DeVonta Smith", "Jordyn Tyson", "Rome Odunze",
        "A.J. Brown", "Zay Flowers", "Makai Lemon", "Rashee Rice", "Tee Higgins", "Jaylen Waddle",
        "Brian Thomas", "Marvin Harrison", "Jameson Williams", "KC Concepcion", "Christian Watson",
        "Jordan Addison", "Alec Pierce", "Parker Washington", "Michael Wilson", "Josh Downs",
        "Terry McLaurin",
    ],
    "TE": [
        "Brock Bowers", "Trey McBride", "Colston Loveland", "Tyler Warren", "Tucker Kraft",
        "Harold Fannin", "Sam LaPorta", "Kyle Pitts", "Kenyon Sadiq",
    ],
}

# FantasyPros Superflex dynasty: QB from SF expert consensus; RB/WR/TE positional
# dynasty ECR (skill ranks do not change in Superflex). Extended from Aug 31 boards + ECR.
FP = {
    "QB": [
        "Drake Maye", "Josh Allen", "Jayden Daniels", "Lamar Jackson", "Justin Herbert", "Joe Burrow",
        "Jalen Hurts", "Patrick Mahomes", "Caleb Williams", "Trevor Lawrence", "Jaxson Dart",
        "Brock Purdy", "Bo Nix", "Jordan Love", "Dak Prescott", "C.J. Stroud", "Baker Mayfield",
        "Cam Ward", "Jared Goff", "Kyler Murray", "Tyler Shough", "Sam Darnold", "Matthew Stafford",
        "Bryce Young", "Daniel Jones", "Michael Penix", "Tua Tagovailoa", "Geno Smith",
        "Aaron Rodgers", "Jacoby Brissett",
    ],
    "RB": [
        "Jahmyr Gibbs", "Bijan Robinson", "Ashton Jeanty", "Jeremiyah Love", "Omarion Hampton",
        "De'Von Achane", "James Cook", "Kenneth Walker", "Breece Hall", "Jonathan Taylor",
        "Chase Brown", "Saquon Barkley", "Christian McCaffrey", "TreVeyon Henderson", "Kyren Williams",
        "Bucky Irving", "Quinshon Judkins", "Javonte Williams", "Cam Skattebo", "Derrick Henry",
        "Josh Jacobs", "Travis Etienne", "D'Andre Swift", "Bhayshul Tuten", "David Montgomery",
        "Jaylen Warren", "RJ Harvey", "Jadarian Price",
    ],
    "WR": [
        "Ja'Marr Chase", "Jaxon Smith-Njigba", "Puka Nacua", "Amon-Ra St. Brown", "Malik Nabers",
        "Drake London", "Justin Jefferson", "CeeDee Lamb", "Tetairoa McMillan", "Nico Collins",
        "Zay Flowers", "George Pickens", "Emeka Egbuka", "Chris Olave", "A.J. Brown", "Tee Higgins",
        "Ladd McConkey", "Garrett Wilson", "Jaylen Waddle", "Rome Odunze", "Luther Burden",
        "Brian Thomas", "Marvin Harrison", "DeVonta Smith", "Rashee Rice", "Carnell Tate",
        "Jameson Williams", "DK Metcalf", "Terry McLaurin", "Jordan Addison",
    ],
    "TE": [
        "Brock Bowers", "Colston Loveland", "Trey McBride", "Tyler Warren", "Tucker Kraft",
        "Kyle Pitts", "Sam LaPorta", "Harold Fannin", "Eli Stowers", "Kenyon Sadiq",
        "Isaiah Likely", "Dalton Kincaid", "George Kittle", "Jake Ferguson", "Mark Andrews",
        "Brenton Strange", "Dallas Goedert", "T.J. Hockenson", "Travis Kelce", "Mason Taylor",
    ],
}

OWNERS = [
    {"id": "mathoose", "name": "mathoose", "you": True},
    {"id": "silenthei", "name": "Silenthei"},
    {"id": "cvbrazil", "name": "cvbrazil"},
    {"id": "kaylama", "name": "kaylama"},
    {"id": "qadams", "name": "qadams"},
    {"id": "cbrennan", "name": "cbrennan"},
    {"id": "miketo", "name": "miketo"},
    {"id": "nricciarelli", "name": "nricciarelli"},
    {"id": "bturner", "name": "bturner99"},
    {"id": "thehulka", "name": "thehulka"},
]

ROSTERS = {
    "mathoose": [
        "Lamar Jackson", "Bo Nix", "Tyler Shough", "Carson Beck", "Jacoby Brissett", "Kyler Murray",
        "Tua Tagovailoa", "Jonathan Taylor", "Christian McCaffrey", "Chase Brown", "Travis Etienne",
        "Dylan Sampson", "Mike Washington", "Isiah Pacheco", "George Pickens", "Emeka Egbuka",
        "Terry McLaurin", "Michael Wilson", "Jalen Coker", "Malachi Fields", "Caleb Douglas",
        "Courtland Sutton", "DK Metcalf", "Tucker Kraft", "Mark Andrews", "Jake Ferguson",
    ],
    "silenthei": [
        "Jaxson Dart", "Quinn Ewers", "Sam Darnold", "Daniel Jones", "Trevor Lawrence",
        "De'Von Achane", "Kyren Williams", "Breece Hall", "TreVeyon Henderson", "Tyrone Tracy",
        "Nicholas Singleton", "Ja'Marr Chase", "Jaxon Smith-Njigba", "Justin Jefferson",
        "Malik Washington", "Keon Coleman", "Elic Ayomanor", "Jakobi Meyers", "Jaylen Waddle",
        "Jordan Addison", "Brock Bowers", "Kenyon Sadiq", "Dalton Schultz", "Pat Freiermuth",
    ],
    "cvbrazil": [
        "Joe Burrow", "Caleb Williams", "Matthew Stafford", "Baker Mayfield", "Jordan Love",
        "Saquon Barkley", "Kenneth Walker", "Bucky Irving", "Quinshon Judkins", "Emmett Johnson",
        "Josh Jacobs", "Zach Charbonnet", "A.J. Brown", "Ladd McConkey", "Jameson Williams",
        "Tre Tucker", "Jayden Reed", "Ricky Pearsall", "Jaylin Noel", "Chimere Dike",
        "Antonio Williams", "Calvin Ridley", "Christian Watson", "Trey McBride", "Kyle Pitts",
    ],
    "kaylama": [
        "Dak Prescott", "Shedeur Sanders", "Jeremiyah Love", "David Montgomery", "D'Andre Swift",
        "Jonathon Brooks", "Bhayshul Tuten", "Kyle Monangai", "Rico Dowdle", "Chuba Hubbard",
        "Puka Nacua", "Tetairoa McMillan", "Garrett Wilson", "Luther Burden", "Omar Cooper",
        "Ja'Kobi Lane", "Denzel Boston", "Jauan Jennings", "Alec Pierce", "Harold Fannin",
        "George Kittle", "Isaiah Likely",
    ],
    "qadams": [
        "Brock Purdy", "Bryce Young", "Marcus Mariota", "James Cook", "Cam Skattebo",
        "Jadarian Price", "Roschon Johnson", "Blake Corum", "Kaytron Allen", "Najee Harris",
        "Jerome Ford", "Brian Robinson", "Amon-Ra St. Brown", "DJ Moore", "De'Zhaun Stribling",
        "Marvin Harrison", "Jordyn Tyson", "Christian Kirk", "Wan'Dale Robinson",
        "T.J. Hockenson", "Mason Taylor", "Noah Fant",
    ],
    "cbrennan": [
        "Justin Herbert", "Malik Willis", "Ty Simpson", "Patrick Mahomes", "Anthony Richardson",
        "Omarion Hampton", "Javonte Williams", "Chris Rodriguez", "MarShawn Lloyd", "Jaylen Wright",
        "Kaleb Johnson", "James Conner", "J.K. Dobbins", "Keaton Mitchell", "Drake London",
        "Brian Thomas", "Josh Downs", "KC Concepcion", "Jack Bech", "Dontayvion Wicks",
        "Terrance Ferguson", "AJ Barner", "Cole Kmet", "Greg Dulcich", "Chig Okonkwo",
    ],
    "miketo": [
        "Drake Maye", "Cam Ward", "Drew Allar", "Joe Flacco", "Deshaun Watson", "Trey Lance",
        "Aaron Rodgers", "Derrick Henry", "RJ Harvey", "Tony Pollard", "Jonah Coleman",
        "Elijah Mitchell", "Dameon Pierce", "CeeDee Lamb", "Tee Higgins", "Carnell Tate",
        "Jordan Whittington", "Xavier Legette", "Tre' Harris", "Keenan Allen", "Jahan Dotson",
        "Khalil Shakir", "Sam LaPorta", "Dallas Goedert", "Mike Gesicki",
    ],
    "nricciarelli": [
        "Jared Goff", "Michael Penix", "Fernando Mendoza", "Justin Fields", "Ashton Jeanty",
        "Aaron Jones", "Kenny Gainwell", "Jordan Mason", "Jacory Croskey-Merritt", "DeVonta Smith",
        "Davante Adams", "Rome Odunze", "Jalen McMillan", "Matthew Golden", "Kyle Williams",
        "Zachariah Branch", "Tyreek Hill", "Michael Pittman", "Romeo Doubs", "Calvin Austin",
        "Rashid Shaheed", "Quentin Johnston", "Travis Kelce", "Gunnar Helm", "Eli Stowers",
        "Juwan Johnson",
    ],
    "bturner": [
        "Jayden Daniels", "Jalen Hurts", "C.J. Stroud", "Bijan Robinson", "Jahmyr Gibbs",
        "Emanuel Wilson", "Rhamondre Stevenson", "Tyler Allgeier", "Jaylen Warren", "Nico Collins",
        "Malik Nabers", "Chris Olave", "Zay Flowers", "Mike Evans", "Stefon Diggs",
        "Parker Washington", "Tank Dell", "Kayshon Boutte", "Colston Loveland", "Dalton Kincaid",
        "Oronde Gadsden", "Hunter Henry",
    ],
    "thehulka": [
        "Josh Allen", "Woody Marks", "Trey Benson", "Kimani Vidal", "Jaydon Blue", "Alvin Kamara",
        "Kareem Hunt", "Rachaad White", "Tyjae Spears", "Rashee Rice", "Chris Godwin", "Makai Lemon",
        "Xavier Worthy", "Adonai Mitchell", "Jayden Higgins", "Germie Bernard", "Deebo Samuel",
        "Rashod Bateman", "Marvin Mims", "Tyler Warren", "Brenton Strange", "Ja'Tavion Sanders",
        "Eli Raridon", "Evan Engram",
    ],
}

SUFFIX = re.compile(
    r"\s+(?:Jr\.?|Sr\.?|III|II|IV|R)$",
    re.I,
)


def norm(name: str) -> str:
    n = name.replace("’", "'").strip()
    n = SUFFIX.sub("", n)
    n = re.sub(r"\s+", " ", n)
    aliases = {
        "Kenneth Walker III": "Kenneth Walker",
        "Brian Thomas Jr": "Brian Thomas",
        "Brian Thomas Jr.": "Brian Thomas",
        "Patrick Mahomes II": "Patrick Mahomes",
        "James Cook III": "James Cook",
        "Marvin Harrison Jr": "Marvin Harrison",
        "Marvin Harrison Jr.": "Marvin Harrison",
        "Michael Penix Jr": "Michael Penix",
        "Michael Penix Jr.": "Michael Penix",
        "Kyle Pitts Sr": "Kyle Pitts",
        "Kyle Pitts Sr.": "Kyle Pitts",
        "Harold Fannin Jr": "Harold Fannin",
        "Harold Fannin Jr.": "Harold Fannin",
        "Travis Etienne Jr": "Travis Etienne",
        "Travis Etienne Jr.": "Travis Etienne",
        "Tyrone Tracy Jr": "Tyrone Tracy",
        "A.J. Barner": "AJ Barner",
        "Chris Godwin Jr": "Chris Godwin",
        "Chris Godwin Jr.": "Chris Godwin",
        "Luther Burden III": "Luther Burden",
        "Dont'e Thornton Jr": "Dont'e Thornton",
        "Jeremiyah Love R": "Jeremiyah Love",
        "Carnell Tate R": "Carnell Tate",
        "Fernando Mendoza R": "Fernando Mendoza",
        "Jordyn Tyson R": "Jordyn Tyson",
        "Makai Lemon R": "Makai Lemon",
        "KC Concepcion R": "KC Concepcion",
        "Kenyon Sadiq R": "Kenyon Sadiq",
        "Mike Washington Jr": "Mike Washington",
        "Mike Washington Jr.": "Mike Washington",
    }
    return aliases.get(n, n)


def rank_map(board: dict[str, list[str]]) -> dict[str, int]:
    out = {}
    for names in board.values():
        for i, name in enumerate(names, 1):
            out[norm(name)] = i
    return out


def main() -> None:
    fc = json.loads(FC_PATH.read_text())
    maps = {
        "bdge": rank_map(BDGE),
        "rotowire": rank_map(RW),
        "ktc": rank_map(KTC),
        "fantasypros": rank_map(FP),
    }
    owner_of = {}
    for oid, names in ROSTERS.items():
        for n in names:
            owner_of[norm(n)] = oid

    skill = []
    for row in fc:
        pl = row["player"]
        if pl["position"] not in ("QB", "RB", "WR", "TE"):
            continue
        skill.append(row)
    skill.sort(key=lambda r: r["overallRank"])

    roster_norms = {norm(n) for names in ROSTERS.values() for n in names}
    picked = skill[:TARGET]
    have = {norm(r["player"]["name"]) for r in picked}
    for row in skill:
        key = norm(row["player"]["name"])
        if key in roster_norms and key not in have:
            picked.append(row)
            have.add(key)

    you_id = "mathoose"
    players = []
    for row in picked:
        pl = row["player"]
        key = norm(pl["name"])
        display = key
        owner = owner_of.get(key)
        players.append({
            "name": display,
            "pos": pl["position"],
            "team": pl.get("maybeTeam") or "",
            "age": round(float(pl["maybeAge"]), 1) if pl.get("maybeAge") is not None else None,
            "value": None,
            "owner": owner,
            "you": owner == you_id,
            "ranks": {
                "bdge": maps["bdge"].get(key),
                "rotowire": maps["rotowire"].get(key),
                "ktc": maps["ktc"].get(key),
                "fantasycalc": row["positionRank"],
                "fantasypros": maps["fantasypros"].get(key),
            },
        })

    # RW Superflex JTV from positional boards (same order/value as chart).
    rw_values = {}
    rw_jtv = {
        # filled below from RW lists + known chart values via FC fallback remaining None
    }
    # Pair RW rank lists with values from the Sep 3 Superflex chart names we stored as order-only;
    # overlay explicit values from the overall chart dump in this file's companion dict.
    explicit = _rw_values()
    for p in players:
        p["value"] = explicit.get(p["name"])

    extras = [
        {"name": "Jerome Ford", "pos": "RB", "team": "CLE", "age": 27.4},
        {"name": "Elijah Mitchell", "pos": "RB", "team": "KC", "age": 28.3},
        {"name": "Dameon Pierce", "pos": "RB", "team": "HOU", "age": 26.5},
        {"name": "Calvin Austin", "pos": "WR", "team": "PIT", "age": 27.6},
    ]
    have_names = {norm(p["name"]) for p in players}
    for extra in extras:
        key = norm(extra["name"])
        if key in have_names:
            continue
        owner = owner_of.get(key)
        players.append({
            "name": key,
            "pos": extra["pos"],
            "team": extra["team"],
            "age": extra["age"],
            "value": None,
            "owner": owner,
            "you": owner == you_id,
            "ranks": {
                "bdge": maps["bdge"].get(key),
                "rotowire": maps["rotowire"].get(key),
                "ktc": maps["ktc"].get(key),
                "fantasycalc": None,
                "fantasypros": maps["fantasypros"].get(key),
            },
        })

    # Drop players missing age (can't filter); fill from None only if rostered
    players = [p for p in players if p["age"] is not None]

    payload = {
        "updated": "2026-09-06",
        "format": "superflex",
        "valueScale": "RotoWire Superflex JTV (Jagger May, Sep 3 2026)",
        "owners": OWNERS,
        "rosterNote": "League rosters reconstructed from Sleeper trade-partner screenshots (skill players). Benches may be incomplete.",
        "sources": [
            {"id": "bdge", "label": "BDGE", "note": "Nick Ercolano Superflex dynasty positional ranks"},
            {"id": "rotowire", "label": "RW", "note": "RotoWire Superflex dynasty chart, Jagger May, Sep 3 2026"},
            {"id": "ktc", "label": "KTC", "note": "KeepTradeCut Superflex via Dynasty Dealmaker, Sep 6 2026"},
            {"id": "fantasycalc", "label": "FC", "note": "FantasyCalc Superflex dynasty API (2QB / 0.5 PPR), Sep 6 2026"},
            {"id": "fantasypros", "label": "FP", "note": "FantasyPros Superflex dynasty (QB from SF ECR; RB/WR/TE dynasty positional)"},
        ],
        "players": players,
    }
    out = Path(__file__).with_name("rankings.json")
    out.write_text(json.dumps(payload, indent=2) + "\n")
    owned = sum(1 for p in players if p["owner"])
    print(f"Wrote {out} ({len(players)} players, {owned} rostered)")


def _rw_values() -> dict[str, int]:
    # Superflex JTV from the Sep 3 positional / overall chart.
    return {
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
        "Luther Burden": 5508, "DeVonta Smith": 5353, "Dak Prescott": 5326, "Jordan Love": 5316,
        "Quinshon Judkins": 5304, "TreVeyon Henderson": 5297, "Carnell Tate": 5286, "Breece Hall": 5262,
        "Fernando Mendoza": 5235, "Cam Ward": 5230, "Rome Odunze": 5203, "A.J. Brown": 5152,
        "Saquon Barkley": 5107, "Christian McCaffrey": 5065, "Tee Higgins": 5015, "Jadarian Price": 4963,
        "Kyren Williams": 4929, "Parker Washington": 4895, "Brian Thomas": 4826, "Cam Skattebo": 4824,
        "Tucker Kraft": 4819, "Tyler Shough": 4803, "Javonte Williams": 4763, "Jared Goff": 4703,
        "KC Concepcion": 4686, "Makai Lemon": 4674, "C.J. Stroud": 4644, "Baker Mayfield": 4643,
        "Jordyn Tyson": 4622, "Jameson Williams": 4602, "Marvin Harrison": 4578, "Sam LaPorta": 4566,
        "Kyler Murray": 4565, "Sam Darnold": 4562, "D'Andre Swift": 4470, "Bucky Irving": 4408,
        "De'Zhaun Stribling": 4367, "Harold Fannin": 4366, "Kyle Pitts": 4281, "Bhayshul Tuten": 4249,
        "DJ Moore": 3999, "Travis Etienne": 3968, "Josh Downs": 3885, "Josh Jacobs": 3839,
        "Davante Adams": 3838, "Jonathon Brooks": 3802, "Christian Watson": 3752, "Terry McLaurin": 3747,
        "Rashee Rice": 3742, "Derrick Henry": 3741, "Matthew Stafford": 3734, "Michael Wilson": 3733,
        "Bryce Young": 3712, "Malik Willis": 3711, "Denzel Boston": 3703, "Jayden Reed": 3692,
        "David Montgomery": 3660, "Jaylen Warren": 3633, "Rico Dowdle": 3548, "DK Metcalf": 3498,
        "Blake Corum": 3494, "Mike Evans": 3490, "Daniel Jones": 3470, "Ty Simpson": 3458,
        "Geno Smith": 3412, "Jordan Addison": 3346, "Alec Pierce": 3332, "Terrance Ferguson": 3310,
        "Kenyon Sadiq": 3308, "Aaron Rodgers": 3293, "Tua Tagovailoa": 3292, "Michael Penix": 3291,
        "Rhamondre Stevenson": 3272, "Jacoby Brissett": 3270, "Matthew Golden": 3264,
        "Quentin Johnston": 3258, "Jayden Higgins": 3247, "Jonah Coleman": 3246, "Kyle Monangai": 3218,
        "Isaiah Likely": 3215, "Jalen Coker": 3199, "Jordan Mason": 3192, "George Kittle": 3189,
        "Michael Pittman": 3145, "Chris Godwin": 3131, "Rachaad White": 3119, "Omar Cooper": 3064,
        "RJ Harvey": 3051, "Jacory Croskey-Merritt": 3050, "Tyler Allgeier": 3045, "Chuba Hubbard": 3042,
        "Brenton Strange": 3036, "Eli Stowers": 3030, "Jake Ferguson": 3023, "Zach Charbonnet": 3000,
        "MarShawn Lloyd": 2999, "Mike Washington": 2983, "Stefon Diggs": 2961, "Cyrus Allen": 2953,
        "Xavier Worthy": 2902, "Malachi Fields": 2898, "Germie Bernard": 2882, "AJ Barner": 2878,
        "Dalton Kincaid": 2870, "Mark Andrews": 2848, "Romeo Doubs": 2847, "Kayshon Boutte": 2801,
        "Pat Bryant": 2793, "Travis Hunter": 2787, "Tony Pollard": 2786, "Wan'Dale Robinson": 2784,
        "Adonai Mitchell": 2766, "Courtland Sutton": 2762, "Eli Raridon": 2761, "Ted Hurst": 2755,
        "Drew Allar": 2735, "Carson Beck": 2719, "Woody Marks": 2684, "Caleb Douglas": 2645,
        "Antonio Williams": 2640, "J.K. Dobbins": 2639, "Aaron Jones": 2638, "Tyjae Spears": 2637,
        "Kenny Gainwell": 2635, "T.J. Hockenson": 2632, "Chig Okonkwo": 2624, "Travis Kelce": 2618,
        "Dallas Goedert": 2615, "Tank Bigsby": 2614, "Ja'Kobi Lane": 2596, "Dalton Schultz": 2591,
        "Cade Otton": 2588, "Tre Tucker": 2586, "Keaton Mitchell": 2580, "Alvin Kamara": 2574,
        "Ray Davis": 2567, "Jauan Jennings": 2552, "Jakobi Meyers": 2543, "Khalil Shakir": 2532,
        "Emmett Johnson": 2528, "Jerry Jeudy": 2523, "Colby Parkinson": 2515, "Juwan Johnson": 2512,
        "Malik Washington": 2507, "Jalen McMillan": 2502, "Zachariah Branch": 2498,
        "Chris Rodriguez": 2491, "Chris Brooks": 2479, "George Holani": 2475, "Demond Claiborne": 2468,
        "Oronde Gadsden": 2460, "James Conner": 2444, "Gunnar Helm": 2433, "Hunter Henry": 2406,
        "Charlie Kolar": 2396, "Braelon Allen": 2390, "Sean Tucker": 2387, "Dylan Sampson": 2342,
        "Oscar Delp": 2331, "Michael Mayer": 2323, "Deebo Samuel": 2316, "Rashid Shaheed": 2315,
        "Mason Taylor": 2314, "Max Klare": 2312, "Nicholas Singleton": 2304, "Kaytron Allen": 2292,
        "Isiah Pacheco": 2285, "Greg Dulcich": 2277, "Ryan Flournoy": 2273, "Tyrone Tracy": 2266,
        "Isaiah Davis": 2252, "Brian Robinson": 2251, "Kaleb Johnson": 2239,
    }


if __name__ == "__main__":
    main()
