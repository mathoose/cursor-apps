#!/usr/bin/env node
'use strict';
/**
 * Sync map pin coordinates (lat/lng) with authoritative location data.
 *
 * Primary: Google Places API (New) Place Details `location` when googlePlaceId is set.
 * Fallback: Photon address geocode (OSM) when --provider photon or --provider auto
 * without an API key.
 *
 * Updates philly-dates/places.json and mirrors to coffee-drinks-map/drinks.json.
 *
 * Requires GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) for --provider google.
 *
 * Usage:
 *   node sync-google-locations.js --dry-run
 *   node sync-google-locations.js --provider auto
 *   node sync-google-locations.js --provider google
 *   node sync-google-locations.js --provider photon --threshold 50
 *   node sync-google-locations.js --all          # text-search missing googlePlaceId (google only)
 *   node sync-google-locations.js --limit 20
 *   node sync-google-locations.js --report /tmp/location-sync-report.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLACES_PATH = path.join(__dirname, 'places.json');
const DRINKS_PATH = path.join(ROOT, 'coffee-drinks-map', 'drinks.json');
const PHOTON_CACHE_PATH = path.join(ROOT, 'scripts', 'location-photon-cache.json');
const API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const DELAY_MS = 250;

/** Same box as html-features/philly-walk-map/philly-walk-map.js */
const BOUNDS = { south: 39.878, north: 39.992, west: -75.222, east: -75.114 };
const PHOTON_BBOX = [BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north].join(',');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const searchAll = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const threshIdx = args.indexOf('--threshold');
const thresholdM = threshIdx >= 0 ? parseFloat(args[threshIdx + 1]) : 50;
const maxMoveIdx = args.indexOf('--max-move');
const maxMoveM = args.includes('--allow-large-moves')
  ? Infinity
  : (maxMoveIdx >= 0 ? parseFloat(args[maxMoveIdx + 1]) : 1200);
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : '';
const providerIdx = args.indexOf('--provider');
const providerArg = providerIdx >= 0 ? args[providerIdx + 1] : 'auto';
const skipDrinks = args.includes('--no-drinks-copy');
const onlyIdx = args.indexOf('--only');
const onlyNames = onlyIdx >= 0
  ? args[onlyIdx + 1].split(',').map(function(s) { return s.trim(); }).filter(Boolean)
  : null;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var p = Math.PI / 180;
  var a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function contains(lat, lng) {
  return lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
}

function houseNumberFromAddress(addr) {
  var m = String(addr || '').match(/^\s*(\d+)/);
  return m ? m[1] : '';
}

function normalizeStreet(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bphiladelphia\b/g, '')
    .replace(/\bpa\b/g, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function streetFromAddress(addr) {
  var s = String(addr || '').replace(/,.*$/, '').trim();
  var m = s.match(/^\d+\s+(.+)$/);
  return m ? m[1] : s;
}

function scorePhotonFeature(feat, place) {
  var props = feat.properties || {};
  var score = 0;
  var wantHouse = houseNumberFromAddress(place.address);
  var wantStreet = normalizeStreet(streetFromAddress(place.address));
  var gotHouse = props.housenumber ? String(props.housenumber) : '';
  var gotStreet = normalizeStreet(props.street || '');
  if (wantHouse && gotHouse === wantHouse) score += 20;
  else if (wantHouse && gotHouse) score -= 5;
  if (wantStreet && gotStreet && (gotStreet.indexOf(wantStreet) >= 0 || wantStreet.indexOf(gotStreet) >= 0)) {
    score += 12;
  }
  if (props.city && /philadelphia/i.test(props.city)) score += 2;
  if (props.postcode && String(place.address || '').indexOf(props.postcode) >= 0) score += 3;
  return score;
}

function buildQuery(place) {
  var parts = [place.name];
  if (place.address) parts.push(place.address);
  else if (place.neighborhood) parts.push(place.neighborhood);
  parts.push('Philadelphia PA');
  return parts.join(', ');
}

function photonQuery(place) {
  if (place.address && String(place.address).trim()) {
    return String(place.address).trim() + ', Philadelphia, PA';
  }
  return buildQuery(place);
}

async function textSearch(query) {
  var res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.location'
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: 39.9526, longitude: -75.1652 },
          radius: 25000
        }
      },
      maxResultCount: 1
    })
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Text Search failed (' + res.status + '): ' + errText.slice(0, 300));
  }
  var data = await res.json();
  return data.places && data.places[0] ? data.places[0] : null;
}

async function googlePlaceDetails(placeId) {
  var id = String(placeId).replace(/^places\//, '');
  var res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(id), {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,location,formattedAddress,googleMapsUri'
    }
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Place Details failed (' + res.status + '): ' + errText.slice(0, 300));
  }
  return res.json();
}

function pickGoogleLocation(details) {
  if (!details || !details.location) return null;
  var lat = Number(details.location.latitude);
  var lng = Number(details.location.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return {
    lat: lat,
    lng: lng,
    source: 'google',
    googlePlaceId: details.id ? String(details.id).replace(/^places\//, '') : undefined,
    formattedAddress: details.formattedAddress,
    googleMapsUri: details.googleMapsUri
  };
}

async function googleLocationForPlace(place) {
  if (place.googlePlaceId) {
    var details = await googlePlaceDetails(place.googlePlaceId);
    return pickGoogleLocation(details);
  }
  if (!searchAll) return null;
  var found = await textSearch(buildQuery(place));
  if (!found) return null;
  if (found.location) {
    return pickGoogleLocation(found);
  }
  await sleep(DELAY_MS);
  var details = await googlePlaceDetails(found.id);
  return pickGoogleLocation(details);
}

function loadPhotonCache() {
  try {
    if (fs.existsSync(PHOTON_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(PHOTON_CACHE_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function savePhotonCache(cache) {
  fs.mkdirSync(path.dirname(PHOTON_CACHE_PATH), { recursive: true });
  fs.writeFileSync(PHOTON_CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

async function photonFetch(q, cache) {
  if (cache && cache[q]) {
    return cache[q].features || [];
  }
  var url = 'https://photon.komoot.io/api/?' + new URLSearchParams({
    q: q,
    limit: '8',
    bbox: PHOTON_BBOX
  }).toString();
  var res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Photon failed (' + res.status + ')');
  var data = await res.json();
  var feats = data.features || [];
  if (cache) cache[q] = { features: feats, at: new Date().toISOString().slice(0, 10) };
  return feats;
}

function pickBestPhoton(feats, place) {
  if (!feats.length) return null;
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < feats.length; i++) {
    var sc = scorePhotonFeature(feats[i], place);
    if (sc > bestScore) {
      bestScore = sc;
      best = feats[i];
    }
  }
  var wantHouse = houseNumberFromAddress(place.address);
  if (wantHouse && bestScore < 12) {
    var anyExactHouse = feats.some(function(f) {
      var hn = f.properties && f.properties.housenumber;
      return hn && String(hn) === wantHouse;
    });
    if (!anyExactHouse && bestScore >= 8) {
      /* street-level Photon hit when OSM lacks housenumber */
    } else {
      return null;
    }
  } else if (!wantHouse && bestScore < 5) {
    return null;
  }
  var coords = best.geometry.coordinates;
  var lat = Number(coords[1]);
  var lng = Number(coords[0]);
  if (!isFinite(lat) || !isFinite(lng) || !contains(lat, lng)) return null;
  return { lat: lat, lng: lng, source: 'photon-osm', score: bestScore };
}

async function photonGeocode(place, cache) {
  var queries = [photonQuery(place)];
  if (place.address && place.name) {
    queries.push(place.name + ', ' + photonQuery(place));
  }
  for (var qi = 0; qi < queries.length; qi++) {
    var feats = await photonFetch(queries[qi], cache);
    var hit = pickBestPhoton(feats, place);
    if (hit) return hit;
    if (!cache[queries[qi]]) await sleep(80);
  }
  return null;
}

function resolveProvider() {
  if (providerArg === 'google' || providerArg === 'photon') return providerArg;
  if (providerArg === 'auto') return API_KEY ? 'google' : 'photon';
  console.error('Unknown --provider ' + providerArg + ' (use google, photon, or auto)');
  process.exit(1);
}

function shouldUpdate(place, hit) {
  if (!hit || !isFinite(hit.lat) || !isFinite(hit.lng)) return { ok: false, reason: 'no location' };
  if (!contains(hit.lat, hit.lng)) return { ok: false, reason: 'outside philly bounds' };
  var oldLat = Number(place.lat);
  var oldLng = Number(place.lng);
  if (!isFinite(oldLat) || !isFinite(oldLng)) {
    return { ok: true, distanceM: null };
  }
  var d = haversineMeters(oldLat, oldLng, hit.lat, hit.lng);
  if (d < thresholdM) return { ok: false, reason: 'within ' + thresholdM + 'm (' + Math.round(d) + 'm)', distanceM: d };
  if (d > maxMoveM) return { ok: false, reason: 'move too large (' + Math.round(d) + 'm > ' + maxMoveM + 'm)', distanceM: d };
  return { ok: true, distanceM: d };
}

function applyLocation(place, hit) {
  var prev = { lat: place.lat, lng: place.lng };
  place.lat = Math.round(hit.lat * 1e6) / 1e6;
  place.lng = Math.round(hit.lng * 1e6) / 1e6;
  place.locationSource = hit.source;
  place.locationSyncedAt = new Date().toISOString().slice(0, 10);
  if (hit.googlePlaceId && !place.googlePlaceId) place.googlePlaceId = hit.googlePlaceId;
  if (hit.formattedAddress && !place.address) {
    place.address = hit.formattedAddress;
    place.addressSource = 'google';
  }
  if (hit.googleMapsUri && !place.googleMapsUri) place.googleMapsUri = hit.googleMapsUri;
  return prev;
}

function copyToDrinks(places) {
  if (!fs.existsSync(path.dirname(DRINKS_PATH))) return;
  fs.writeFileSync(DRINKS_PATH, JSON.stringify(places, null, 2) + '\n');
}

async function main() {
  var provider = resolveProvider();
  if (provider === 'google' && !API_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY for --provider google');
    process.exit(1);
  }

  var places = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  var todo = places.slice();
  if (onlyNames && onlyNames.length) {
    var set = {};
    onlyNames.forEach(function(n) { set[n] = true; });
    todo = places.filter(function(p) { return set[p.name]; });
  }
  if (isFinite(limit)) todo = todo.slice(0, limit);

  console.log((dryRun ? '[dry-run] ' : '') + 'Location sync (' + provider + ', threshold ' + thresholdM + 'm) for ' +
    todo.length + ' places…\n');

  var report = {
    provider: provider,
    thresholdM: thresholdM,
    dryRun: dryRun,
    updated: [],
    skipped: [],
    errors: []
  };

  var updated = 0;
  var unchanged = 0;
  var errors = 0;
  var photonCache = provider === 'photon' ? loadPhotonCache() : null;

  for (var i = 0; i < todo.length; i++) {
    var place = todo[i];
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + place.name + ' … ');
    try {
      var hit = provider === 'google'
        ? await googleLocationForPlace(place)
        : await photonGeocode(place, photonCache);

      if (!hit) {
        console.log('no geocode result');
        report.skipped.push({ name: place.name, reason: 'no geocode result' });
        unchanged++;
        if (provider === 'photon') await sleep(120);
        continue;
      }

      var decision = shouldUpdate(place, hit);
      if (!decision.ok) {
        console.log('skip (' + decision.reason + ')');
        report.skipped.push({
          name: place.name,
          reason: decision.reason,
          distanceM: decision.distanceM != null ? Math.round(decision.distanceM) : undefined
        });
        unchanged++;
      } else {
        var prev = { lat: place.lat, lng: place.lng };
        var dist = decision.distanceM != null ? Math.round(decision.distanceM) : null;
        console.log('UPDATE' + (dist != null ? ' ~' + dist + 'm' : '') + ' → ' + hit.lat + ', ' + hit.lng);
        if (!dryRun) applyLocation(place, hit);
        report.updated.push({
          name: place.name,
          distanceM: dist,
          from: prev,
          to: { lat: hit.lat, lng: hit.lng },
          source: hit.source
        });
        updated++;
      }

      if (provider === 'google') await sleep(DELAY_MS);
      else await sleep(120);
    } catch (e) {
      errors++;
      console.log('error: ' + e.message);
      report.errors.push({ name: place.name, error: e.message });
    }
  }

  if (photonCache) savePhotonCache(photonCache);

  if (!dryRun && updated > 0) {
    fs.writeFileSync(PLACES_PATH, JSON.stringify(places, null, 2) + '\n');
    if (!skipDrinks) copyToDrinks(places);
  }

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log('\nWrote report: ' + reportPath);
  }

  console.log('\nSummary:');
  console.log('  updated:', updated);
  console.log('  unchanged/skipped:', unchanged);
  console.log('  errors:', errors);
  if (dryRun && updated) console.log('\nRe-run without --dry-run to save.');
  else if (!dryRun && updated && !skipDrinks) console.log('\nMirrored to coffee-drinks-map/drinks.json');
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
