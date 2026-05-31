#!/usr/bin/env node
'use strict';
/**
 * Fetch real opening hours from Google Places API (New).
 *
 * Requires a Google Cloud API key with Places API (New) enabled.
 * Set: export GOOGLE_PLACES_API_KEY=your_key
 *
 * Usage:
 *   node fetch-google-hours.js           # fetch missing hours only
 *   node fetch-google-hours.js --force   # re-fetch all
 *   node fetch-google-hours.js --limit 5 # test on first 5
 *
 * Billing: each place uses ~2 calls (Text Search + Place Details with
 * regularOpeningHours). Google offers free monthly tiers; see:
 * https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
 */
const fs = require('fs');
const path = require('path');

const PLACES_PATH = path.join(__dirname, 'places.json');
const API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DELAY_MS = 250;

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function normalizeUrl(url) {
  if (!url || !String(url).trim()) return '';
  var s = String(url).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    var u = new URL(s);
    var host = u.hostname.replace(/^www\./i, '').toLowerCase();
    var pathPart = u.pathname.replace(/\/$/, '') || '';
    return host + pathPart + (u.search || '');
  } catch (e) {
    return s.toLowerCase().replace(/\/$/, '');
  }
}

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ''));
}

function applyGoogleWebsite(place, websiteUri) {
  var googleUrl = (websiteUri || '').trim();
  if (!googleUrl) return false;
  var current = (place.hh_menu || '').trim();
  if (!current) {
    place.hh_menu = googleUrl;
    place.websiteSource = 'google';
    return true;
  }
  if (normalizeUrl(current) === normalizeUrl(googleUrl)) return false;
  if (isPdfUrl(current)) {
    place.menu_pdf = current;
  } else {
    place.hh_menuPrevious = current;
  }
  place.hh_menu = googleUrl;
  place.websiteSource = 'google';
  return true;
}

function fmtGoogleTime(hour, minute) {
  var h = hour;
  var min = minute || 0;
  var ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + String(min).padStart(2, '0') + ' ' + ap;
}

function periodsToHours(periods) {
  if (!periods || !periods.length) return null;
  var hours = {};
  periods.forEach(function(period) {
    if (!period.open) return;
    var day = DAY_NAMES[period.open.day];
    var open = fmtGoogleTime(period.open.hour, period.open.minute);
    var close;
    if (period.close) {
      close = fmtGoogleTime(period.close.hour, period.close.minute);
    } else {
      close = '11:59 PM';
    }
    if (!hours[day]) {
      hours[day] = { open: open, close: close };
    }
  });
  return Object.keys(hours).length ? hours : null;
}

async function textSearch(query) {
  var res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.businessStatus'
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
  var res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId), {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,displayName,regularOpeningHours,currentOpeningHours,businessStatus,websiteUri'
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

async function fetchHoursForPlace(place) {
  var query = buildQuery(place);
  var found = await textSearch(query);
  if (!found || !found.id) return { ok: false, reason: 'not found on Google: ' + query };

  await sleep(DELAY_MS);
  var details = await placeDetails(found.id);
  var roh = details.regularOpeningHours;
      if (!roh || !roh.periods || !roh.periods.length) {
    return {
      ok: false,
      reason: 'no opening hours on Google',
      googlePlaceId: found.id,
      websiteUri: details.websiteUri || '',
      displayName: found.displayName && found.displayName.text
    };
  }

  var hours = periodsToHours(roh.periods);
  if (!hours) return { ok: false, reason: 'could not parse hours', googlePlaceId: found.id };

  return {
    ok: true,
    hours: hours,
    googlePlaceId: found.id,
    websiteUri: details.websiteUri || '',
    weekdayDescriptions: roh.weekdayDescriptions || [],
    displayName: details.displayName && details.displayName.text
  };
}

async function main() {
  if (!API_KEY) {
    console.error('Missing API key. Set GOOGLE_PLACES_API_KEY in your environment.');
    console.error('');
    console.error('Setup:');
    console.error('  1. https://console.cloud.google.com/ → create project');
    console.error('  2. Enable "Places API (New)"');
    console.error('  3. Create an API key → restrict to Places API (New)');
    console.error('  4. export GOOGLE_PLACES_API_KEY=your_key');
    console.error('  5. node fetch-google-hours.js');
    process.exit(1);
  }

  var places = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  var todo = places.filter(function(p) {
    return force || p.hoursSource !== 'google' || !p.hours;
  });
  if (isFinite(limit)) todo = todo.slice(0, limit);

  console.log('Fetching Google hours for', todo.length, 'of', places.length, 'places…');

  var ok = 0;
  var fail = 0;
  var websitesUpdated = 0;
  for (var i = 0; i < todo.length; i++) {
    var place = todo[i];
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + place.name + ' … ');
    try {
      var result = await fetchHoursForPlace(place);
      if (result.ok) {
        place.hours = result.hours;
        place.hoursSource = 'google';
        place.googlePlaceId = result.googlePlaceId;
        if (result.weekdayDescriptions.length) {
          place.hoursNote = result.weekdayDescriptions.join('; ');
        }
        if (applyGoogleWebsite(place, result.websiteUri)) websitesUpdated++;
        ok++;
        console.log('OK');
      } else {
        if (result.googlePlaceId) place.googlePlaceId = result.googlePlaceId;
        if (applyGoogleWebsite(place, result.websiteUri)) websitesUpdated++;
        fail++;
        console.log('skip (' + result.reason + ')');
      }
    } catch (e) {
      fail++;
      console.log('error: ' + e.message);
      if (e.message.indexOf('403') >= 0 || e.message.indexOf('API key') >= 0) {
        console.error('\nStopping — check API key and Places API (New) billing.');
        break;
      }
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(PLACES_PATH, JSON.stringify(places, null, 2) + '\n');
  console.log('\nDone. Saved', ok, 'with Google hours,', fail, 'skipped/failed,', websitesUpdated, 'website links updated.');
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
