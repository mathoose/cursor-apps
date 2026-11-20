#!/usr/bin/env node
'use strict';
/**
 * Fill empty coffee.json hours from nearby OSM opening_hours tags.
 * Use when GOOGLE_PLACES_API_KEY is not available (pins need structured hours).
 *
 *   node scripts/backfill-coffee-osm-hours.js
 *   node scripts/backfill-coffee-osm-hours.js --dry-run
 *   node scripts/backfill-coffee-osm-hours.js --only "Mighty Bread"
 */
const fs = require('fs');
const path = require('path');

const COFFEE_PATH = path.join(__dirname, '..', 'coffee-drinks-map', 'coffee.json');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OVERPASS_URLS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const DELAY_MS = 2000;
const RETRIES = 3;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIdx = args.indexOf('--only');
const onlyNames = onlyIdx >= 0
  ? args[onlyIdx + 1].split(',').map(function(s) { return s.trim(); }).filter(Boolean)
  : null;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function hasStructuredHours(hours) {
  if (!hours || typeof hours !== 'object') return false;
  return DAY_NAMES.some(function(d) {
    var h = hours[d];
    return h && h.open && h.close;
  });
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fmtTime24(h, m) {
  var ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

/** Minimal OSM opening_hours → app hours (common cafe patterns). */
function osmStringToHours(ohStr) {
  if (!ohStr || typeof ohStr !== 'string') return null;
  var s = ohStr.trim();
  if (!s || /^24\/7$/i.test(s)) {
    var all = {};
    DAY_NAMES.forEach(function(d) {
      if (d === 'Sunday' || d === 'Saturday') return;
      all[d] = { open: '12:00 AM', close: '11:59 PM' };
    });
    return all;
  }

  var dayMap = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
  var hours = {};
  var parts = s.split(';').map(function(p) { return p.trim(); }).filter(Boolean);

  function addRange(dayName, open, close) {
    if (!dayName || !open || !close) return;
    hours[dayName] = { open: open, close: close };
  }

  function parseTime(t) {
    var m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return fmtTime24(parseInt(m[1], 10), parseInt(m[2], 10));
  }

  function expandDays(daySpec) {
    var out = [];
    daySpec.split(',').forEach(function(chunk) {
      chunk = chunk.trim();
      var range = chunk.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/);
      if (range) {
        var order = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        var a = order.indexOf(range[1]);
        var b = order.indexOf(range[2]);
        if (a >= 0 && b >= 0) {
          for (var i = a; i <= b; i++) out.push(order[i]);
        }
        return;
      }
      if (dayMap[chunk]) out.push(chunk);
    });
    return out;
  }

  parts.forEach(function(part) {
    if (/^(off|closed)$/i.test(part)) return;
    var offMatch = part.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+off$/i);
    if (offMatch) return;

    var m = part.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/i);
    if (!m) return;
    var open = parseTime(m[2]);
    var close = parseTime(m[3]);
    if (!open || !close) return;
    expandDays(m[1]).forEach(function(code) {
      addRange(dayMap[code], open, close);
    });
  });

  return Object.keys(hours).length ? hours : null;
}

async function overpassOpeningHours(lat, lng) {
  var q = '[out:json][timeout:25];(' +
    'node(around:45,' + lat + ',' + lng + ')[opening_hours];' +
    'way(around:45,' + lat + ',' + lng + ')[opening_hours];' +
    ');out tags;';
  var lastErr;
  for (var attempt = 0; attempt < RETRIES; attempt++) {
    var url = OVERPASS_URLS[attempt % OVERPASS_URLS.length];
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'cursor-apps-coffee-hours/1.0 (contact: github.com/mathoose/cursor-apps)'
        },
        body: 'data=' + encodeURIComponent(q)
      });
      var text = await res.text();
      if (!res.ok || text.indexOf('"elements"') < 0) {
        lastErr = new Error('Overpass error (' + res.status + '): ' + text.slice(0, 120));
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return JSON.parse(text).elements || [];
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Overpass failed');
}

function bestOsmMatch(elements, placeName) {
  var target = normName(placeName);
  var best = null;
  var bestScore = -1;
  elements.forEach(function(el) {
    var tags = el.tags || {};
    var oh = tags.opening_hours;
    if (!oh) return;
    var name = normName(tags.name || '');
    var score = 0;
    if (name && target) {
      if (name === target) score += 100;
      else if (name.indexOf(target) >= 0 || target.indexOf(name) >= 0) score += 60;
      else {
        var tw = target.split(' ').filter(Boolean);
        var nw = name.split(' ').filter(Boolean);
        var shared = tw.filter(function(w) { return nw.indexOf(w) >= 0; }).length;
        score += shared * 15;
      }
    } else {
      score += 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { opening_hours: oh, name: tags.name || '' };
    }
  });
  return bestScore >= 15 ? best : null;
}

async function main() {
  var places = JSON.parse(fs.readFileSync(COFFEE_PATH, 'utf8'));
  var todo = places.filter(function(p) { return !hasStructuredHours(p.hours); });
  if (onlyNames && onlyNames.length) {
    var set = {};
    onlyNames.forEach(function(n) { set[n] = true; });
    todo = places.filter(function(p) { return set[p.name]; });
  }

  console.log((dryRun ? '[dry-run] ' : '') + 'Backfill OSM hours for', todo.length, 'coffee places…');

  var ok = 0;
  var skip = 0;
  for (var i = 0; i < todo.length; i++) {
    var place = todo[i];
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + place.name + ' … ');
    try {
      var elements = await overpassOpeningHours(place.lat, place.lng);
      var match = bestOsmMatch(elements, place.name);
      if (!match) {
        skip++;
        console.log('skip (no OSM opening_hours nearby)');
        await sleep(DELAY_MS);
        continue;
      }
      var hours = osmStringToHours(match.opening_hours);
      if (!hours) {
        skip++;
        console.log('skip (unparsed: ' + match.opening_hours + ')');
        await sleep(DELAY_MS);
        continue;
      }
      if (!dryRun) {
        place.hours = hours;
        place.hoursSource = 'osm';
        place.hoursNote = 'OSM opening_hours near pin (' + (match.name || 'unnamed') + '): ' + match.opening_hours;
      }
      ok++;
      console.log('OK (' + match.opening_hours + ')');
    } catch (e) {
      skip++;
      console.log('error: ' + e.message);
    }
    await sleep(DELAY_MS);
  }

  if (!dryRun && ok > 0) {
    fs.writeFileSync(COFFEE_PATH, JSON.stringify(places, null, 2) + '\n');
  }
  console.log('\nDone.', ok, 'filled,', skip, 'skipped.');
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
