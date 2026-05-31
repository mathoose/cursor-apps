/* FIFA World Cup 2026 knockout bracket — Round of 32 slots per official schedule */
window.WC2026_BRACKET = {
  r32: [
    { id: 73, date: "Jun 28", venue: "Los Angeles Stadium", home: { r: 2, g: "A" }, away: { r: 2, g: "B" } },
    { id: 74, date: "Jun 29", venue: "Boston Stadium", home: { r: 1, g: "E" }, away: { slot: "1E" } },
    { id: 75, date: "Jun 29", venue: "Estadio Monterrey", home: { r: 1, g: "F" }, away: { r: 2, g: "C" } },
    { id: 76, date: "Jun 29", venue: "Houston Stadium", home: { r: 1, g: "C" }, away: { r: 2, g: "F" } },
    { id: 77, date: "Jun 30", venue: "New York New Jersey Stadium", home: { r: 1, g: "I" }, away: { slot: "1I" } },
    { id: 78, date: "Jun 30", venue: "Dallas Stadium", home: { r: 2, g: "E" }, away: { r: 2, g: "I" } },
    { id: 79, date: "Jun 30", venue: "Mexico City Stadium", home: { r: 1, g: "A" }, away: { slot: "1A" } },
    { id: 80, date: "Jul 1", venue: "Atlanta Stadium", home: { r: 1, g: "L" }, away: { slot: "1L" } },
    { id: 81, date: "Jul 1", venue: "San Francisco Bay Area Stadium", home: { r: 1, g: "D" }, away: { slot: "1D" } },
    { id: 82, date: "Jul 1", venue: "Seattle Stadium", home: { r: 1, g: "G" }, away: { slot: "1G" } },
    { id: 83, date: "Jul 2", venue: "Toronto Stadium", home: { r: 2, g: "K" }, away: { r: 2, g: "L" } },
    { id: 84, date: "Jul 2", venue: "Los Angeles Stadium", home: { r: 1, g: "H" }, away: { r: 2, g: "J" } },
    { id: 85, date: "Jul 2", venue: "BC Place Vancouver", home: { r: 1, g: "B" }, away: { slot: "1B" } },
    { id: 86, date: "Jul 3", venue: "Miami Stadium", home: { r: 1, g: "J" }, away: { r: 2, g: "H" } },
    { id: 87, date: "Jul 3", venue: "Kansas City Stadium", home: { r: 1, g: "K" }, away: { slot: "1K" } },
    { id: 88, date: "Jul 3", venue: "Dallas Stadium", home: { r: 2, g: "D" }, away: { r: 2, g: "G" } }
  ],
  r16: [
    { id: 89, date: "Jul 4", venue: "Philadelphia Stadium", home: 74, away: 77 },
    { id: 90, date: "Jul 4", venue: "Houston Stadium", home: 73, away: 75 },
    { id: 91, date: "Jul 5", venue: "New York New Jersey Stadium", home: 76, away: 78 },
    { id: 92, date: "Jul 5", venue: "Mexico City Stadium", home: 79, away: 80 },
    { id: 93, date: "Jul 6", venue: "Dallas Stadium", home: 83, away: 84 },
    { id: 94, date: "Jul 6", venue: "Seattle Stadium", home: 81, away: 82 },
    { id: 95, date: "Jul 7", venue: "Atlanta Stadium", home: 86, away: 88 },
    { id: 96, date: "Jul 7", venue: "BC Place Vancouver", home: 85, away: 87 }
  ],
  qf: [
    { id: 97, date: "Jul 9", venue: "Boston Stadium", home: 89, away: 90 },
    { id: 98, date: "Jul 10", venue: "Los Angeles Stadium", home: 93, away: 94 },
    { id: 99, date: "Jul 11", venue: "Miami Stadium", home: 91, away: 92 },
    { id: 100, date: "Jul 11", venue: "Kansas City Stadium", home: 95, away: 96 }
  ],
  sf: [
    { id: 101, date: "Jul 14", venue: "Dallas Stadium", home: 97, away: 98 },
    { id: 102, date: "Jul 15", venue: "Atlanta Stadium", home: 99, away: 100 }
  ],
  bronze: { id: 103, date: "Jul 18", venue: "Miami Stadium", home: 101, away: 102, loser: true },
  final: { id: 104, date: "Jul 19", venue: "New York New Jersey Stadium", home: 101, away: 102 }
};
