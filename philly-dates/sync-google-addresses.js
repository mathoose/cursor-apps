#!/usr/bin/env node
'use strict';
/**
 * Confirm addresses and Google Maps links via Places API (New).
 *
 * Updates address, googlePlaceId, and googleMapsUri from Google when they differ.
 *
 * Requires GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY).
 *
 * Usage:
 *   node sync-google-addresses.js              # places with googlePlaceId only
 *   node sync-google-addresses.js --all        # text-search places missing an id
 *   node sync-google-addresses.js --dry-run
 *   node sync-google-addresses.js --limit 10
 */
const fs = require('fs');
const path = require('path');

const PLACES_PATH = path.join(__dirname, 'places.json');
const API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const DELAY_MS = 250;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const searchAll = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function normalizeAddress(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[,\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidMapsUri(url) {
  if (!url || !String(url).trim()) return false;
  try {
    var u = new URL(String(url).trim());
    return u.protocol === 'https:' && /google\.com$/i.test(u.hostname.replace(/^www\./, ''))
      && /\/maps/i.test(u.pathname + u.search);
  } catch (e) {
    return false;
  }
}

async function textSearch(query) {
  var res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.googleMapsUri'
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

async function placeDetails(placeId) {
  var id = String(placeId).replace(/^places\//, '');
  var res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(id), {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,googleMapsUri'
    }
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Place Details failed (' + res.status + '): ' + errText.slice(0, 300));
  }
  return res.json();
}

function buildQuery(place) {
  var parts = [place.name];
  if (place.address) parts.push(place.address);
  else if (place.neighborhood) parts.push(place.neighborhood);
  parts.push('Philadelphia PA');
  return parts.join(', ');
}

function pickMapsFields(found) {
  if (!found) return null;
  var id = found.id || found.name;
  if (id && String(id).indexOf('places/') === 0) id = String(id).slice('places/'.length);
  return {
    googlePlaceId: id || '',
    formattedAddress: (found.formattedAddress || '').trim(),
    googleMapsUri: (found.googleMapsUri || '').trim(),
    displayName: found.displayName && found.displayName.text
  };
}

async function googleMapsForPlace(place) {
  if (place.googlePlaceId) {
    var details = await placeDetails(place.googlePlaceId);
    return pickMapsFields(details);
  }
  if (!searchAll) return null;
  var found = await textSearch(buildQuery(place));
  if (!found) return null;
  if (found.formattedAddress && isValidMapsUri(found.googleMapsUri)) {
    return pickMapsFields(found);
  }
  await sleep(DELAY_MS);
  var details = await placeDetails(found.id);
  return pickMapsFields(details);
}

function applyMapsFields(place, info) {
  if (!info || !info.googlePlaceId) return { changed: false, reason: 'no match' };
  var changed = false;
  if (info.googlePlaceId && place.googlePlaceId !== info.googlePlaceId) {
    place.googlePlaceId = info.googlePlaceId;
    changed = true;
  }
  if (info.formattedAddress && normalizeAddress(place.address) !== normalizeAddress(info.formattedAddress)) {
    if (place.address && place.address !== info.formattedAddress) {
      place.addressPrevious = place.address;
    }
    place.address = info.formattedAddress;
    place.addressSource = 'google';
    changed = true;
  } else if (info.formattedAddress && !place.address) {
    place.address = info.formattedAddress;
    place.addressSource = 'google';
    changed = true;
  }
  if (info.googleMapsUri && isValidMapsUri(info.googleMapsUri) && place.googleMapsUri !== info.googleMapsUri) {
    place.googleMapsUri = info.googleMapsUri;
    changed = true;
  }
  return { changed: changed, displayName: info.displayName };
}

async function main() {
  if (!API_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY');
    process.exit(1);
  }

  var places = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  var todo = searchAll ? places.slice() : places.filter(function(p) { return p.googlePlaceId; });
  if (isFinite(limit)) todo = todo.slice(0, limit);

  console.log((dryRun ? '[dry-run] ' : '') + 'Syncing Google Maps data for ' + todo.length + ' places…');

  var updated = 0;
  var unchanged = 0;
  var notFound = 0;
  var errors = 0;

  for (var i = 0; i < todo.length; i++) {
    var place = todo[i];
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + place.name + ' … ');
    try {
      var info = await googleMapsForPlace(place);
      if (!info) {
        console.log('skip (no googlePlaceId; use --all to search)');
        notFound++;
        continue;
      }
      var result = applyMapsFields(place, info);
      if (result.changed) {
        updated++;
        console.log('updated' + (result.displayName ? ' (' + result.displayName + ')' : ''));
        if (place.address) console.log('  address: ' + place.address);
        if (place.googleMapsUri) console.log('  maps: ' + place.googleMapsUri);
      } else {
        unchanged++;
        console.log('ok');
      }
      if (!dryRun) await sleep(DELAY_MS);
    } catch (e) {
      errors++;
      console.log('error: ' + e.message);
    }
  }

  if (!dryRun && updated > 0) {
    fs.writeFileSync(PLACES_PATH, JSON.stringify(places, null, 2) + '\n');
  }

  console.log('\nSummary:');
  console.log('  updated:', updated);
  console.log('  unchanged:', unchanged);
  console.log('  skipped/not found:', notFound);
  console.log('  errors:', errors);
  if (dryRun && updated) console.log('\nRe-run without --dry-run to save places.json');
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
