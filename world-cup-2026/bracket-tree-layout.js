/* Visual bracket column order — R32 pairs feed into R16 per FIFA knockout wiring */
window.WC2026_TREE = {
  r32: [74, 77, 73, 75, 76, 78, 79, 80, 83, 84, 81, 82, 86, 88, 85, 87],
  r16: [89, 90, 91, 92, 93, 94, 95, 96],
  qf: [97, 98, 99, 100],
  sf: [101, 102],
  final: 104,
  bronze: 103,
  columns: [
    { key: "r32", label: "Round of 32", span: 1 },
    { key: "r16", label: "Round of 16", span: 2 },
    { key: "qf", label: "Quarters", span: 4 },
    { key: "sf", label: "Semis", span: 8 },
    { key: "final", label: "Final", span: 16 }
  ]
};
