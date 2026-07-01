/* FIFA World Cup 2026 knockout bracket — Round of 32 slots per official schedule (times ET) */
window.WC2026_BRACKET = {
  r32: [
    { id: 73, date: "Jun 28", time: "15:00", venue: "Los Angeles Stadium", home: { r: 2, g: "A" }, away: { r: 2, g: "B" } },
    { id: 74, date: "Jun 29", time: "16:30", venue: "Boston Stadium", home: { r: 1, g: "E" }, away: { slot: "1E" } },
    { id: 75, date: "Jun 29", time: "21:00", venue: "Estadio Monterrey", home: { r: 1, g: "F" }, away: { r: 2, g: "C" } },
    { id: 76, date: "Jun 29", time: "13:00", venue: "Houston Stadium", home: { r: 1, g: "C" }, away: { r: 2, g: "F" } },
    { id: 77, date: "Jun 30", time: "17:00", venue: "New York New Jersey Stadium", home: { r: 1, g: "I" }, away: { slot: "1I" } },
    { id: 78, date: "Jun 30", time: "13:00", venue: "Dallas Stadium", home: { r: 2, g: "E" }, away: { r: 2, g: "I" } },
    { id: 79, date: "Jun 30", time: "21:00", venue: "Mexico City Stadium", home: { r: 1, g: "A" }, away: { slot: "1A" } },
    { id: 80, date: "Jul 1", time: "12:00", venue: "Atlanta Stadium", home: { r: 1, g: "L" }, away: { slot: "1L" } },
    { id: 81, date: "Jul 1", time: "20:00", venue: "San Francisco Bay Area Stadium", home: { r: 1, g: "D" }, away: { slot: "1D" } },
    { id: 82, date: "Jul 1", time: "16:00", venue: "Seattle Stadium", home: { r: 1, g: "G" }, away: { slot: "1G" } },
    { id: 83, date: "Jul 2", time: "19:00", venue: "Toronto Stadium", home: { r: 2, g: "K" }, away: { r: 2, g: "L" } },
    { id: 84, date: "Jul 2", time: "15:00", venue: "Los Angeles Stadium", home: { r: 1, g: "H" }, away: { r: 2, g: "J" } },
    { id: 85, date: "Jul 2", time: "23:00", venue: "BC Place Vancouver", home: { r: 1, g: "B" }, away: { slot: "1B" } },
    { id: 86, date: "Jul 3", time: "18:00", venue: "Miami Stadium", home: { r: 1, g: "J" }, away: { r: 2, g: "H" } },
    { id: 87, date: "Jul 3", time: "21:30", venue: "Kansas City Stadium", home: { r: 1, g: "K" }, away: { slot: "1K" } },
    { id: 88, date: "Jul 3", time: "14:00", venue: "Dallas Stadium", home: { r: 2, g: "D" }, away: { r: 2, g: "G" } }
  ],
  r16: [
    { id: 89, date: "Jul 4", time: "17:00", venue: "Philadelphia Stadium", home: 74, away: 77 },
    { id: 90, date: "Jul 4", time: "13:00", venue: "Houston Stadium", home: 73, away: 75 },
    { id: 91, date: "Jul 5", time: "16:00", venue: "New York New Jersey Stadium", home: 76, away: 78 },
    { id: 92, date: "Jul 5", time: "20:00", venue: "Mexico City Stadium", home: 79, away: 80 },
    { id: 93, date: "Jul 6", time: "15:00", venue: "Dallas Stadium", home: 83, away: 84 },
    { id: 94, date: "Jul 6", time: "20:00", venue: "Seattle Stadium", home: 81, away: 82 },
    { id: 95, date: "Jul 7", time: "12:00", venue: "Atlanta Stadium", home: 86, away: 88 },
    { id: 96, date: "Jul 7", time: "16:00", venue: "BC Place Vancouver", home: 85, away: 87 }
  ],
  qf: [
    { id: 97, date: "Jul 9", time: "16:00", venue: "Boston Stadium", home: 89, away: 90 },
    { id: 98, date: "Jul 10", time: "15:00", venue: "Los Angeles Stadium", home: 93, away: 94 },
    { id: 99, date: "Jul 11", time: "17:00", venue: "Miami Stadium", home: 91, away: 92 },
    { id: 100, date: "Jul 11", time: "21:00", venue: "Kansas City Stadium", home: 95, away: 96 }
  ],
  sf: [
    { id: 101, date: "Jul 14", time: "15:00", venue: "Dallas Stadium", home: 97, away: 98 },
    { id: 102, date: "Jul 15", time: "15:00", venue: "Atlanta Stadium", home: 99, away: 100 }
  ],
  bronze: { id: 103, date: "Jul 18", time: "17:00", venue: "Miami Stadium", home: 101, away: 102, loser: true },
  final: { id: 104, date: "Jul 19", time: "15:00", venue: "New York New Jersey Stadium", home: 101, away: 102 }
};
