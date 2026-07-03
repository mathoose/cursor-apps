#!/usr/bin/env bash
# Quick syntax check for habit-journal/index.html inline script.
set -euo pipefail
node -e "
const fs = require('fs');
const html = fs.readFileSync('habit-journal/index.html', 'utf8');
const m = html.match(/<script>\\s*\\(function \\(\\) \\{([\\s\\S]*)\\}\\)\\(\\);\\s*<\\/script>/);
if (!m) { console.error('habit-journal: inline script not found'); process.exit(1); }
try { new Function(m[1]); console.log('habit-journal: JS syntax OK'); }
catch (e) { console.error('habit-journal: JS syntax error:', e.message); process.exit(1); }
"
