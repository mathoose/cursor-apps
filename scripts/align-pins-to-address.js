#!/usr/bin/env node
'use strict';
/**
 * Move drink pins onto the OpenStreetMap address for their street text.
 * The basemap labels (13th, Chestnut, Sansom) are OSM, so a pin that
 * geocodes to a different block looks off even when the address string is right.
 *
 *   node scripts/align-pins-to-address.js
 *   node scripts/align-pins-to-address.js --apply
 *   node scripts/align-pins-to-address.js --min-move 40 --apply
 */
const fs = require('fs');
const path = require('path');

const DRINKS = path.join(__dirname, '..', 'coffee-drinks-map', 'drinks.json');
const CACHE = path.join(__dirname, 'location-nominatim-cache.json');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const minIdx = args.indexOf('--min-move');
const minMove = minIdx >= 0 ? parseFloat(args[minIdx + 1]) : 40;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function haversine(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var p = Math.PI / 180;
  var a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function houseNumber(address) {
  var m = String(address || '').match(/^\s*(\d+)/);
  return m ? m[1] : '';
}

function queryFor(place) {
  var addr = String(place.address || '').split(';')[0].trim();
  if (!addr) return '';
  if (!/philadelphia/i.test(addr)) addr += ', Philadelphia, PA';
  return addr;
}

async function geocode(q, cache) {
  if (cache[q]) return cache[q];
  var url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: q,
    format: 'json',
    addressdetails: '1',
    limit: '1'
  });
  var res = await fetch(url, {
    headers: { 'User-Agent': 'cursor-apps-pin-align/1.0 (github.com/mathoose/cursor-apps)' }
  });
  if (!res.ok) throw new Error('nominatim ' + res.status + ' for ' + q);
  var data = await res.json();
  var hit = data[0] || null;
  cache[q] = hit;
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  await sleep(1100);
  return hit;
}

function acceptable(place, hit) {
  if (!hit) return 'no result';
  var disp = hit.display_name || '';
  if (!/philadelphia/i.test(disp)) return 'not Philadelphia';
  var want = houseNumber(place.address);
  var got = hit.address && hit.address.house_number;
  if (want && got && String(got) !== String(want)) return 'house ' + got + ' != ' + want;
  var cls = hit.class || '';
  if (cls === 'highway' || cls === 'boundary') return 'street not building';
  var lat = Number(hit.lat);
  var lng = Number(hit.lon);
  if (!isFinite(lat) || !isFinite(lng)) return 'bad coords';
  if (lat < 39.86 || lat > 40.06 || lng < -75.28 || lng > -74.95) return 'outside city box';
  var addr = String(place.address || '');
  var east = /\b(east|e)\b/i.test(addr);
  var west = /\b(west|w)\b/i.test(addr);
  var disp = String(hit.display_name || '');
  if (east && !west && !/\beast\b/i.test(disp)) {
    var meters = haversine(place.lat, place.lng, lat, lng);
    if (meters > 400) return 'dropped East from address';
  }
  if (west && !east && !/\bwest\b/i.test(disp)) {
    var metersW = haversine(place.lat, place.lng, lat, lng);
    if (metersW > 400) return 'dropped West from address';
  }
  return '';
}

async function main() {
  var places = JSON.parse(fs.readFileSync(DRINKS, 'utf8'));
  var cache = {};
  if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  var moves = [];
  var skipped = [];
  for (var i = 0; i < places.length; i++) {
    var place = places[i];
    var q = queryFor(place);
    if (!q || !houseNumber(place.address)) {
      skipped.push(place.name + ' (no house number)');
      continue;
    }
    var hit;
    try {
      hit = await geocode(q, cache);
    } catch (e) {
      skipped.push(place.name + ' (' + e.message + ')');
      continue;
    }
    var why = acceptable(place, hit);
    if (why) {
      skipped.push(place.name + ' (' + why + ')');
      continue;
    }
    var lat = Math.round(Number(hit.lat) * 1e6) / 1e6;
    var lng = Math.round(Number(hit.lon) * 1e6) / 1e6;
    var meters = haversine(place.lat, place.lng, lat, lng);
    if (meters < minMove) continue;
    moves.push({ name: place.name, meters: Math.round(meters), from: [place.lat, place.lng], to: [lat, lng], q: q });
    if (apply) {
      place.latPrevious = place.lat;
      place.lngPrevious = place.lng;
      place.lat = lat;
      place.lng = lng;
      place.locationSource = 'nominatim-address';
      place.locationSyncedAt = '2026-10-30';
    }
  }
  moves.sort(function (a, b) { return b.meters - a.meters; });
  console.log((apply ? 'APPLIED' : 'would move') + ' ' + moves.length);
  moves.forEach(function (m) {
    console.log(m.meters + 'm  ' + m.name);
    console.log('    ' + m.from.join(',') + ' -> ' + m.to.join(','));
  });
  console.log('skipped', skipped.length);
  skipped.slice(0, 30).forEach(function (s) { console.log('  skip', s); });
  if (apply && moves.length) {
    fs.writeFileSync(DRINKS, JSON.stringify(places, null, 2) + '\n');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
