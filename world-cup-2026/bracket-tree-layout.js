/* Split knockout tree — left & right halves meet at the final (FIFA wiring) */
window.WC2026_TREE = {
  rows: 8,
  final: 104,
  bronze: 103,
  left: {
    r32: [74, 77, 73, 75, 83, 84, 81, 82],
    r16: [89, 90, 93, 94],
    qf: [97, 98],
    sf: [101]
  },
  right: {
    r32: [76, 78, 79, 80, 86, 88, 85, 87],
    r16: [91, 92, 95, 96],
    qf: [99, 100],
    sf: [102]
  },
  columns: [
    { key: "r32", side: "left", label: "Round of 32", span: 1 },
    { key: "r16", side: "left", label: "Round of 16", span: 2 },
    { key: "qf", side: "left", label: "Quarters", span: 4 },
    { key: "sf", side: "left", label: "Semis", span: 8 },
    { key: "final", label: "Final", span: 8 },
    { key: "sf", side: "right", label: "Semis", span: 8 },
    { key: "qf", side: "right", label: "Quarters", span: 4 },
    { key: "r16", side: "right", label: "Round of 16", span: 2 },
    { key: "r32", side: "right", label: "Round of 32", span: 1 }
  ]
};
