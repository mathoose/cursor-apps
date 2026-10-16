#!/usr/bin/env node
'use strict';
/**
 * Find catalog pins with no structured hours, and fill them from OSM when
 * a nearby place name matches.
 *
 *   node scripts/audit-missing-hours.js
 *   node scripts/audit-missing-hours.js --catalog drinks
 *   node scripts/audit-missing-hours.js --catalog drinks --apply-osm
 *
 * Instagram-only happy hours (like @static_phl) are listed, not guessed.
 * Places API backfill is still: ./scripts/fetch-catalog-hours.sh drinks 50
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'coffee-drinks-map');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const args = process.argv.slice(2);
const applyOsm = args.includes('--apply-osm');
const catalogIdx = args.indexOf('--catalog');
const catalog = catalogIdx >= 0 ? args[catalogIdx + 1] : 'drinks';

function hasStructuredHours(hours) {
  if (!hours || typeof hours !== 'object') return false;
  return DAY_NAMES.some(function (d) {
    var h = hours[d];
    return h && h.open && h.close;
  });
}

function hasHappyHour(place) {
  return !!(place.schedule && Object.keys(place.schedule).length);
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fmtTime24(hour, minute) {
  var h = hour;
  if (h >= 24) h = h % 24;
  var ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + String(minute || 0).padStart(2, '0') + ' ' + ap;
}

function osmStringToHours(ohStr) {
  if (!ohStr || typeof ohStr !== 'string') return null;
  var s = ohStr.trim();
  if (/^24\/7$/i.test(s)) {
    var all = {};
    DAY_NAMES.forEach(function (d) {
      all[d] = { open: '12:00 AM', close: '11:59 PM' };
    });
    return all;
  }
  var dayMap = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
  var bare = s.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (bare) {
    var openAll = fmtTime24(parseInt(bare[1], 10), parseInt(bare[1].split(':')[1], 10));
    var closeAll = fmtTime24(parseInt(bare[2], 10), parseInt(bare[2].split(':')[1], 10));
    var every = {};
    DAY_NAMES.forEach(function (d) { every[d] = { open: openAll, close: closeAll }; });
    return every;
  }

  var hours = {};
  var parts = s.split(/;\s*/).map(function (p) { return p.trim(); }).filter(Boolean);

  function dayCode(code) {
    return code.slice(0, 1).toUpperCase() + code.slice(1, 2).toLowerCase();
  }

  function expandDays(daySpec) {
    var out = [];
    var order = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    daySpec.split(',').forEach(function (chunk) {
      chunk = chunk.trim();
      var range = chunk.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/i);
      if (range) {
        var start = order.indexOf(dayCode(range[1]));
        var end = order.indexOf(dayCode(range[2]));
        if (start >= 0 && end >= start) {
          for (var i = start; i <= end; i++) out.push(order[i]);
        }
        return;
      }
      var one = dayCode(chunk);
      if (dayMap[one]) out.push(one);
    });
    return out;
  }

  function parseTime(t) {
    var m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return fmtTime24(parseInt(m[1], 10), parseInt(m[2], 10));
  }

  parts.forEach(function (part) {
    if (/^(off|closed)$/i.test(part)) return;
    if (/\soff$/i.test(part)) return;
    var m = part.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})(?:,(\d{1,2}:\d{2})-(\d{1,2}:\d{2}))?$/i);
    if (!m) return;
    var open = parseTime(m[2]);
    var close = parseTime(m[5] || m[3]);
    if (!open || !close) return;
    expandDays(m[1]).forEach(function (code) {
      if (dayMap[code]) hours[dayMap[code]] = { open: open, close: close };
    });
  });
  return Object.keys(hours).length ? hours : null;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var p = Math.PI / 180;
  var a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function nameScore(placeName, osmName) {
  var a = normName(placeName);
  var b = normName(osmName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 70;
  var aw = a.split(' ').filter(function (w) { return w.length > 2; });
  var bw = b.split(' ').filter(function (w) { return w.length > 2; });
  var shared = aw.filter(function (w) { return bw.indexOf(w) >= 0; }).length;
  if (!aw.length) return 0;
  return Math.round(100 * shared / aw.length);
}

async function fetchOsm() {
  var q = '[out:json][timeout:90];(' +
    'node["opening_hours"]["name"](39.86,-75.28,40.06,-74.95);' +
    'way["opening_hours"]["name"](39.86,-75.28,40.06,-74.95);' +
    ');out center tags;';
  var res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cursor-apps-hours-audit/1.0 (github.com/mathoose/cursor-apps)'
    },
    body: 'data=' + encodeURIComponent(q)
  });
  var text = await res.text();
  if (!res.ok || text.indexOf('"elements"') < 0) {
    throw new Error('Overpass failed (' + res.status + '): ' + text.slice(0, 180));
  }
  return JSON.parse(text).elements || [];
}

function bestMatch(place, elements) {
  var best = null;
  var bestScore = 0;
  elements.forEach(function (el) {
    var tags = el.tags || {};
    if (!tags.opening_hours || !tags.name) return;
    var lat = el.lat || (el.center && el.center.lat);
    var lng = el.lon || (el.center && el.center.lon);
    if (lat == null || lng == null || place.lat == null) return;
    var meters = haversineMeters(place.lat, place.lng, lat, lng);
    if (meters > 80) return;
    var score = nameScore(place.name, tags.name);
    if (score < 60) return;
    if (score > bestScore) {
      bestScore = score;
      best = { name: tags.name, opening_hours: tags.opening_hours, meters: Math.round(meters), score: score };
    }
  });
  return best;
}

async function main() {
  if (catalog !== 'drinks' && catalog !== 'coffee' && catalog !== 'food') {
    console.error('Use --catalog drinks, coffee, or food');
    process.exit(1);
  }
  var file = path.join(ROOT, catalog + '.json');
  var places = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args.includes('--repair-osm-notes')) {
    var repaired = 0;
    places.forEach(function (place) {
      var note = place.hoursNote || '';
      var idx = note.lastIndexOf(': ');
      if (place.hoursSource !== 'osm' || idx < 0) return;
      var raw = note.slice(idx + 2).trim();
      var hours = osmStringToHours(raw);
      if (!hours) return;
      place.hours = hours;
      repaired++;
      console.log('repaired', place.name, raw);
    });
    if (repaired) fs.writeFileSync(file, JSON.stringify(places, null, 2) + '\n');
    console.log('repaired', repaired);
    return;
  }

  var missing = places.filter(function (p) { return !hasStructuredHours(p.hours); });
  console.log(catalog + ': ' + missing.length + ' of ' + places.length + ' have no structured hours');

  var likeStatic = missing.filter(function (p) {
    return p.instagram && !hasHappyHour(p);
  });
  console.log('Instagram set, no happy-hour schedule: ' + likeStatic.length);
  likeStatic.forEach(function (p) {
    console.log('  - ' + p.name + '  ' + p.instagram);
  });

  if (!applyOsm) {
    console.log('\nRe-run with --apply-osm to fill matches from OpenStreetMap.');
    console.log('Google batches: ./scripts/fetch-catalog-hours.sh ' + catalog + ' 50 --only-empty');
    return;
  }

  console.log('\nFetching OSM opening_hours…');
  var elements = await fetchOsm();
  console.log('OSM named places with hours:', elements.length);
  var filled = 0;
  missing.forEach(function (place) {
    var match = bestMatch(place, elements);
    if (!match) return;
    var hours = osmStringToHours(match.opening_hours);
    if (!hours) {
      console.log('unparsed', place.name, match.opening_hours);
      return;
    }
    place.hours = hours;
    place.hoursSource = 'osm';
    place.hoursNote = 'OSM opening_hours for ' + match.name + ' (' + match.meters + ' m): ' + match.opening_hours;
    filled++;
    console.log('filled', place.name, '<-', match.name, match.opening_hours);
  });
  if (filled) fs.writeFileSync(file, JSON.stringify(places, null, 2) + '\n');
  var still = places.filter(function (p) { return !hasStructuredHours(p.hours); });
  console.log('\nFilled', filled + '. Still missing hours:', still.length);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
