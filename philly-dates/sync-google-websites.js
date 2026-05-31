#!/usr/bin/env node
'use strict';
/**
 * Update hh_menu (Website / Menu) when Google Maps has a different websiteUri.
 *
 * Requires GOOGLE_PLACES_API_KEY. Uses stored googlePlaceId when available.
 *
 * Usage:
 *   node sync-google-websites.js           # places with googlePlaceId only
 *   node sync-google-websites.js --all     # text-search places missing an id
 *   node sync-google-websites.js --dry-run # report only, no writes
 *   node sync-google-websites.js --limit 10
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

function isLikelyMenuOnly(url) {
  return isPdfUrl(url)
    || /yelp\.com\/biz_photos/i.test(url || '')
    || /instagram\.com/i.test(url || '')
    || /tiktok\.com/i.test(url || '')
    || /facebook\.com/i.test(url || '');
}

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ''));
}

async function textSearch(query) {
  var res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.websiteUri'
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

async function placeWebsite(placeId) {
  var id = placeId.replace(/^places\//, '');
  var res = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(id), {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,websiteUri,displayName'
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

async function googleWebsiteForPlace(place) {
  if (place.googlePlaceId) {
    var details = await placeWebsite(place.googlePlaceId);
    return {
      websiteUri: details.websiteUri || '',
      googlePlaceId: details.id || place.googlePlaceId,
      displayName: details.displayName && details.displayName.text
    };
  }
  if (!searchAll) return null;
  var found = await textSearch(buildQuery(place));
  if (!found) return null;
  if (found.websiteUri) {
    return {
      websiteUri: found.websiteUri,
      googlePlaceId: found.id,
      displayName: found.displayName && found.displayName.text
    };
  }
  await sleep(DELAY_MS);
  var details = await placeWebsite(found.id);
  return {
    websiteUri: details.websiteUri || '',
    googlePlaceId: details.id || found.id,
    displayName: details.displayName && details.displayName.text
  };
}

async function main() {
  if (!API_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY');
    process.exit(1);
  }

  var places = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  var todo = searchAll ? places.slice() : places.filter(function(p) { return p.googlePlaceId; });
  if (isFinite(limit)) todo = todo.slice(0, limit);

  console.log((dryRun ? '[dry-run] ' : '') + 'Checking websites for ' + todo.length + ' places…');

  var updated = 0;
  var same = 0;
  var noGoogleSite = 0;
  var filled = 0;
  var errors = 0;

  for (var i = 0; i < todo.length; i++) {
    var place = todo[i];
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + place.name + ' … ');
    try {
      var info = await googleWebsiteForPlace(place);
      if (!info) {
        console.log('skip (no googlePlaceId; use --all to search)');
        continue;
      }
      if (info.googlePlaceId && !place.googlePlaceId) place.googlePlaceId = info.googlePlaceId;

      var googleUrl = (info.websiteUri || '').trim();
      if (!googleUrl) {
        noGoogleSite++;
        console.log('no website on Google');
        await sleep(DELAY_MS);
        continue;
      }

      var current = (place.hh_menu || '').trim();
      var normCurrent = normalizeUrl(current);
      var normGoogle = normalizeUrl(googleUrl);

      if (!current) {
        if (!dryRun) {
          place.hh_menu = googleUrl;
          place.websiteSource = 'google';
        }
        filled++;
        console.log('filled empty → ' + googleUrl);
      } else if (normCurrent === normGoogle) {
        same++;
        console.log('same');
      } else {
        if (!dryRun) {
          if (isLikelyMenuOnly(current) || isPdfUrl(current)) {
            place.menu_pdf = current;
          } else {
            place.hh_menuPrevious = current;
          }
          place.hh_menu = googleUrl;
          place.websiteSource = 'google';
        }
        updated++;
        console.log('UPDATE');
        console.log('  was: ' + current);
        console.log('  now: ' + googleUrl);
        if (isPdfUrl(current)) {
          console.log('  (kept PDF as menu_pdf — still shown as Menu on the page)');
        }
      }
    } catch (e) {
      errors++;
      console.log('error: ' + e.message);
      if (e.message.indexOf('429') >= 0) {
        console.error('\nQuota exceeded — try again tomorrow or use --limit.');
        break;
      }
      if (e.message.indexOf('403') >= 0 || e.message.indexOf('API key') >= 0) break;
    }
    await sleep(DELAY_MS);
  }

  if (!dryRun) {
    fs.writeFileSync(PLACES_PATH, JSON.stringify(places, null, 2) + '\n');
  }

  console.log('\nSummary:');
  console.log('  updated (different):', updated);
  console.log('  filled (was empty):', filled);
  console.log('  unchanged:', same);
  console.log('  no Google website:', noGoogleSite);
  console.log('  errors:', errors);
  if (dryRun) console.log('(dry-run — places.json not written)');
}

main().catch(function(e) {
  console.error(e);
  process.exit(1);
});
