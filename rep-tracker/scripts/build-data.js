#!/usr/bin/env node
'use strict';
/**
 * Build static data for rep-tracker.
 *
 * Usage: node scripts/build-data.js
 *        node scripts/build-data.js --skip-geo
 *        node scripts/build-data.js --skip-wiki
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INPUT_DIR = path.join(__dirname, 'input');

const PRES_YEARS = [2008, 2012, 2016, 2020, 2024];
const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21',
  LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30',
  NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
  VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56'
};
const FIPS_STATE = Object.fromEntries(Object.entries(STATE_FIPS).map(function (e) { return [e[1], e[0]]; }));
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
  '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
  '21st', '22nd', '23rd', '24th', '25th', '26th', '27th', '28th', '29th', '30th',
  '31st', '32nd', '33rd', '34th', '35th', '36th', '37th', '38th', '39th', '40th',
  '41st', '42nd', '43rd', '44th', '45th', '46th', '47th', '48th', '49th', '50th', '51st', '52nd', '53rd'];

const args = process.argv.slice(2);
const skipGeo = args.includes('--skip-geo');
const skipWiki = args.includes('--skip-wiki');

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

const FETCH_HEADERS = {
  'User-Agent': 'rep-tracker-build/1.0 (https://github.com/mathoose/cursor-apps; educational)'
};

async function fetchText(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
  }
  return rows;
}

function partyCode(raw) {
  const p = String(raw || '').toUpperCase();
  if (p.includes('DEM') || p === 'D' || p === '(D)') return 'D';
  if (p.includes('REP') || p === 'R' || p === '(R)') return 'R';
  if (p.includes('IND') || p === 'I') return 'I';
  return '';
}

function districtId(state, district) {
  if (state === 'AK' && (district === 0 || district === '0' || district === 'AL')) return 'AK-AL';
  const n = parseInt(district, 10);
  if (!n && n !== 0) return state + '-??';
  return state + '-' + String(n).padStart(2, '0');
}

function geoidFromStateDistrict(state, district) {
  const fips = STATE_FIPS[state];
  if (!fips) return '';
  if (state === 'AK') return fips + '00';
  const n = parseInt(district, 10);
  return fips + String(n).padStart(2, '0');
}

function parseDistrictLabel(label) {
  const m = String(label || '').trim().match(/^([A-Z]{2})-(\d+|AL)$/);
  if (!m) return null;
  return { state: m[1], district: m[2] === 'AL' ? 0 : parseInt(m[2], 10), id: label.trim() };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function signedPartyMargin(demPct, repPct, party) {
  const margin = demPct - repPct;
  if (party === 'D') return round1(margin);
  if (party === 'R') return round1(-margin);
  return round1(Math.abs(margin));
}

function overUnder(partyMargin, presMargin, party) {
  if (partyMargin == null || presMargin == null || !party) return null;
  const signedPres = party === 'D' ? presMargin : party === 'R' ? -presMargin : presMargin;
  return round1(partyMargin - signedPres);
}

async function fetchDownballotPresMargins() {
  const urls = [
    { years: [2024, 2020], url: 'https://docs.google.com/spreadsheets/d/1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo/export?format=csv&gid=620838163' },
    { years: [2020, 2016, 2012, 2008], url: 'https://docs.google.com/spreadsheets/d/1XbUXnI9OyfAuhP5P3vWtMuGc5UJlrhXbzZo3AwMuHtk/export?format=csv&gid=0' },
    { years: [2016, 2012, 2008], url: 'https://docs.google.com/spreadsheets/d/1zLNAuRqPauss00HDz4XbTH2HqsCzMe0pR8QmD1K8jk8/export?format=csv&gid=0' },
    { years: [2012, 2008], url: 'https://docs.google.com/spreadsheets/d/1xn6nCNM97oFDZ4M-HQgoUT3X4paOiSDsRMSuxbaOBdg/export?format=csv&gid=0' }
  ];
  const byDistrict = {};
  for (const spec of urls) {
    console.log('Fetching Downballot pres margins:', spec.url);
    const text = await fetchText(spec.url);
    const rows = parseCsv(text);
    let headerIdx = -1;
    let prevRow = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === 'District' || rows[i][0] === 'CD') {
        var next = rows[i + 1] || [];
        var subHeader = String(next[3] || next[4] || '');
        if (/Harris|Biden|Obama|Clinton|Kerry|Trump|Romney|McCain/i.test(subHeader)) {
          headerIdx = i + 1;
          prevRow = rows[i];
        } else {
          headerIdx = i;
          prevRow = rows[i - 1] || [];
        }
        break;
      }
    }
    if (headerIdx < 0) continue;
    const header = rows[headerIdx];
    const marginCols = {};
    const demRepCols = {};

    function yearNearColumn(col) {
      for (let k = col; k >= 0; k--) {
        const ym = String(prevRow[k] || '').trim().match(/^(20\d{2})$/);
        if (ym) return parseInt(ym[1], 10);
      }
      return null;
    }

    for (let c = 0; c < header.length; c++) {
      const cell = String(header[c] || '').trim();
      const year = yearNearColumn(c);
      if (cell === 'Margin') {
        var marginYear = yearNearColumn(c - 2) || yearNearColumn(c - 1) || year;
        if (marginYear && spec.years.indexOf(marginYear) >= 0) marginCols[marginYear] = c;
      }
      if (/^(Biden|Harris|Obama|Clinton|Kerry)$/i.test(cell) && year && spec.years.indexOf(year) >= 0) {
        demRepCols[year] = { dem: c, rep: c + 1 };
      }
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const label = row[0];
      if (!label || !/^[A-Z]{2}-/.test(label)) continue;
      const parsed = parseDistrictLabel(label);
      if (!parsed) continue;
      if (!byDistrict[parsed.id]) byDistrict[parsed.id] = { presMargin: {} };

      Object.keys(marginCols).forEach(function (year) {
        const col = marginCols[year];
        const val = parseFloat(String(row[col] || '').replace(/%/g, ''));
        if (!isNaN(val)) byDistrict[parsed.id].presMargin[year] = round1(val);
      });

      Object.keys(demRepCols).forEach(function (year) {
        if (byDistrict[parsed.id].presMargin[year] != null) return;
        const cols = demRepCols[year];
        const dem = parseFloat(String(row[cols.dem] || '').replace(/%/g, ''));
        const rep = parseFloat(String(row[cols.rep] || '').replace(/%/g, ''));
        if (!isNaN(dem) && !isNaN(rep)) {
          byDistrict[parsed.id].presMargin[year] = round1(dem - rep);
        }
      });
    }
  }
  return byDistrict;
}

function aggregateStatePresFromCountyCsv(text, year) {
  const rows = parseCsv(text);
  const header = rows[0].map(function (h) { return String(h).toLowerCase(); });
  let stateIdx = header.indexOf('state_name');
  let demIdx = header.indexOf('votes_dem');
  let gopIdx = header.indexOf('votes_gop');
  let fipsIdx = -1;
  if (stateIdx < 0) stateIdx = header.indexOf('state_abbr');
  if (demIdx < 0) demIdx = header.indexOf('votes_dem_' + year);
  if (gopIdx < 0) gopIdx = header.indexOf('votes_gop_' + year);
  if (demIdx < 0) demIdx = header.indexOf('dem_' + year);
  if (gopIdx < 0) gopIdx = header.indexOf('gop_' + year);
  if (demIdx < 0 || gopIdx < 0) return {};
  if (stateIdx < 0) {
    fipsIdx = header.indexOf('fips_code');
    if (fipsIdx < 0) fipsIdx = header.indexOf('combined_fips');
    if (fipsIdx < 0) fipsIdx = header.indexOf('county_fips');
  }
  const totals = {};
  for (let i = 1; i < rows.length; i++) {
    let abbr = '';
    if (stateIdx >= 0) {
      const stateCell = rows[i][stateIdx];
      abbr = String(stateCell || '').trim();
      if (abbr.length > 2) {
        abbr = Object.keys(STATE_NAMES).find(function (k) { return STATE_NAMES[k] === abbr; }) || '';
      }
    } else if (fipsIdx >= 0) {
      const fips = String(rows[i][fipsIdx] || '').padStart(5, '0');
      const stateFips = fips.slice(0, 2);
      abbr = FIPS_STATE[stateFips] || '';
    }
    if (!abbr || !STATE_NAMES[abbr]) continue;
    if (!totals[abbr]) totals[abbr] = { dem: 0, gop: 0 };
    totals[abbr].dem += parseFloat(rows[i][demIdx]) || 0;
    totals[abbr].gop += parseFloat(rows[i][gopIdx]) || 0;
  }
  const out = {};
  Object.keys(totals).forEach(function (st) {
    const t = totals[st];
    const total = t.dem + t.gop;
    if (!total) return;
    if (!out[st]) out[st] = {};
    out[st][year] = round1(((t.dem / total) * 100) - ((t.gop / total) * 100));
  });
  return out;
}

async function fetchStatePresMargins() {
  const sources = [
    { year: 2024, url: 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv' },
    { year: 2020, url: 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv' },
    { year: 2016, url: 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2016_US_County_Level_Presidential_Results.csv' },
    { year: 2012, url: 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/US_County_Level_Presidential_Results_12-16.csv' },
    { year: 2008, url: 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/US_County_Level_Presidential_Results_08-16.csv' }
  ];
  const out = {};
  for (const spec of sources) {
    console.log('Fetching state pres margins for', spec.year);
    const text = await fetchText(spec.url);
    const chunk = aggregateStatePresFromCountyCsv(text, spec.year);
    Object.keys(chunk).forEach(function (st) {
      if (!out[st]) out[st] = {};
      out[st][spec.year] = chunk[st][spec.year];
    });
  }
  return out;
}

function parseWikiElectionPercents(wikitext) {
  const pct1 = wikitext.match(/\| percentage1\s*=\s*'*([\d.]+)%?/i);
  const pct2 = wikitext.match(/\| percentage2\s*=\s*'*([\d.]+)%?/i);
  const party1 = wikitext.match(/\| party1\s*=\s*(?:\[\[)?([^\]|}\n]+)/i);
  const party2 = wikitext.match(/\| party2\s*=\s*(?:\[\[)?([^\]|}\n]+)/i);
  if (!pct1 || !pct2) return null;
  const dem1 = /democratic/i.test(party1 ? party1[1] : '');
  const dem2 = /democratic/i.test(party2 ? party2[1] : '');
  const p1 = parseFloat(pct1[1]);
  const p2 = parseFloat(pct2[1]);
  let demPct, repPct, winnerParty;
  if (dem1 && !dem2) { demPct = p1; repPct = p2; winnerParty = p1 >= p2 ? 'D' : 'R'; }
  else if (dem2 && !dem1) { demPct = p2; repPct = p1; winnerParty = p2 >= p1 ? 'D' : 'R'; }
  else if (dem1 && dem2) return null;
  else { demPct = dem1 ? p1 : p2; repPct = dem1 ? p2 : p1; winnerParty = demPct >= repPct ? 'D' : 'R'; }
  return { demPct, repPct, margin: round1(demPct - repPct), winnerParty };
}

function houseWikiTitle(state, district) {
  if (state === 'AK') return '2024 United States House of Representatives election in Alaska';
  const name = STATE_NAMES[state];
  const ord = ORDINALS[district] || (district + 'th');
  return "2024 United States House of Representatives election in " + name + "'s " + ord + " congressional district";
}

function senateWikiTitle(state) {
  return '2024 United States Senate election in ' + STATE_NAMES[state];
}

async function fetchWikiElection(title, attempt) {
  const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=' + encodeURIComponent(title) + '&prop=wikitext&format=json';
  try {
    const json = await fetchJson(url);
    if (json.error && json.error.code === 'ratelimited' && attempt < 4) {
      await sleep(3000 * (attempt + 1));
      return fetchWikiElection(title, attempt + 1);
    }
    if (!json.parse || !json.parse.wikitext) return null;
    return parseWikiElectionPercents(json.parse.wikitext['*']);
  } catch (e) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchWikiElection(title, attempt + 1);
    }
    return null;
  }
}

function loadInputElectionCsv(filename, keyCol) {
  const p = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(p)) return {};
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const keyIdx = header.indexOf(keyCol);
  const demIdx = header.indexOf('dempct');
  const repIdx = header.indexOf('reppct');
  const marginIdx = header.indexOf('partymargin');
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][keyIdx];
    if (!key) continue;
    let partyMargin = marginIdx >= 0 ? parseFloat(rows[i][marginIdx]) : NaN;
    const dem = demIdx >= 0 ? parseFloat(rows[i][demIdx]) : NaN;
    const rep = repIdx >= 0 ? parseFloat(rows[i][repIdx]) : NaN;
    if (isNaN(partyMargin) && !isNaN(dem) && !isNaN(rep)) partyMargin = round1(dem - rep);
    if (!isNaN(partyMargin)) out[String(key).trim()] = { demPct: dem, repPct: rep, partyMargin: partyMargin, margin: partyMargin };
  }
  return out;
}

async function fetchHouseElectionMargins(houseMembers) {
  const margins = loadInputElectionCsv('house-election-2024.csv', 'district');
  const cachePath = path.join(INPUT_DIR, 'house-election-cache.json');
  if (fs.existsSync(cachePath)) {
    Object.assign(margins, JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  }
  if (skipWiki || Object.keys(margins).length >= 300) return margins;
  console.log('Fetching House election margins from Wikipedia (this may take a few minutes)...');
  const seen = {};
  for (const m of houseMembers) {
    const id = m.id;
    if (seen[id]) continue;
    seen[id] = true;
    const title = houseWikiTitle(m.state, m.district);
    const result = await fetchWikiElection(title, 0);
    if (result) {
      margins[id] = {
        demPct: result.demPct,
        repPct: result.repPct,
        margin: result.margin,
        partyMargin: signedPartyMargin(result.demPct, result.repPct, m.party)
      };
    }
    await sleep(450);
  }
  fs.writeFileSync(path.join(INPUT_DIR, 'house-election-cache.json'), JSON.stringify(margins, null, 2));
  return margins;
}

async function fetchSenateElectionMargins(states) {
  const margins = loadInputElectionCsv('senate-election-2024.csv', 'state');
  const cachePath = path.join(INPUT_DIR, 'senate-election-cache.json');
  if (fs.existsSync(cachePath)) {
    Object.assign(margins, JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  }
  if (skipWiki || Object.keys(margins).length >= 40) return margins;
  console.log('Fetching Senate election margins from Wikipedia...');
  for (const st of states) {
    const title = senateWikiTitle(st);
    const result = await fetchWikiElection(title, 0);
    if (result) {
      margins[st] = {
        demPct: result.demPct,
        repPct: result.repPct,
        margin: result.margin,
        winnerParty: result.winnerParty
      };
    }
    await sleep(450);
  }
  fs.writeFileSync(path.join(INPUT_DIR, 'senate-election-cache.json'), JSON.stringify(margins, null, 2));
  return margins;
}

async function fetchLegislators() {
  console.log('Fetching legislators-current.json...');
  const json = await fetchJson('https://unitedstates.github.io/congress-legislators/legislators-current.json');
  const house = [];
  const senate = [];
  json.forEach(function (leg) {
    const term = leg.terms[leg.terms.length - 1];
    if (!term) return;
    const party = partyCode(term.party);
    const name = leg.name && (leg.name.official_full || (leg.name.first + ' ' + leg.name.last));
    if (term.type === 'rep') {
      const district = term.district;
      const state = term.state;
      house.push({
        id: districtId(state, district),
        geoid: geoidFromStateDistrict(state, district),
        state: state,
        district: state === 'AK' ? 0 : district,
        name: name,
        party: party,
        bioguide: leg.id && leg.id.bioguide,
        url: term.url || ''
      });
    } else if (term.type === 'sen') {
      senate.push({
        state: term.state,
        name: name,
        party: party,
        bioguide: leg.id && leg.id.bioguide,
        url: term.url || '',
        class: term.class || null
      });
    }
  });
  return { house, senate };
}

function loadBoltsWatch() {
  const p = path.join(INPUT_DIR, 'bolts-watch.json');
  if (!fs.existsSync(p)) return { house: {}, senate: {} };
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const house = {};
  (raw.house || []).forEach(function (item) {
    if (!house[item.id]) {
      house[item.id] = {
        watch: true,
        url: raw.sourceUrl,
        label: item.label || raw.sourceLabel,
        note: item.note || ''
      };
    }
  });
  const senate = {};
  (raw.senate || []).forEach(function (item) {
    if (!senate[item.state]) {
      senate[item.state] = {
        watch: true,
        url: raw.sourceUrl,
        label: item.label || raw.sourceLabel,
        note: item.note || ''
      };
    }
  });
  return { house, senate, meta: raw };
}

function roundCoords(coords, precision) {
  if (typeof coords[0] === 'number') {
    return coords.map(function (n) { return Math.round(n * precision) / precision; });
  }
  return coords.map(function (c) { return roundCoords(c, precision); });
}

async function fetchDistrictGeojson() {
  if (skipGeo) {
    const existing = path.join(DATA_DIR, 'districts.geojson');
    if (fs.existsSync(existing)) return JSON.parse(fs.readFileSync(existing, 'utf8'));
    return { type: 'FeatureCollection', features: [] };
  }
  console.log('Fetching congressional district boundaries (119th)...');
  const listUrl = 'https://api.github.com/repos/JeffreyBLewis/congressional-district-boundaries/contents/GeoJson';
  const list = await fetchJson(listUrl);
  const features = [];
  const seen = {};
  const files = list.filter(function (f) {
    return /_119_to_119\.geojson$/.test(f.name) || /_118_to_119\.geojson$/.test(f.name);
  });
  for (const file of files) {
    const stateName = file.name.split('_')[0].replace(/%20/g, ' ');
    const abbr = Object.keys(STATE_NAMES).find(function (k) { return STATE_NAMES[k] === stateName; });
    if (!abbr) continue;
    const key = abbr + ':' + file.name;
    if (seen[key]) continue;
    seen[key] = true;
    const gj = await fetchJson(file.download_url);
    (gj.features || []).forEach(function (feat) {
      const district = feat.properties && feat.properties.district;
      const statefp = feat.properties && feat.properties.statefp;
      const state = abbr || FIPS_STATE[statefp];
      const id = districtId(state, district);
      const geoid = geoidFromStateDistrict(state, district);
      features.push({
        type: 'Feature',
        properties: { id: id, geoid: geoid, state: state, district: district },
        geometry: {
          type: feat.geometry.type,
          coordinates: roundCoords(feat.geometry.coordinates, 10000)
        }
      });
    });
  }
  return { type: 'FeatureCollection', features: features };
}

async function fetchStatesTopojson() {
  console.log('Fetching states topojson...');
  return fetchJson('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json');
}

function buildHouseRecords(houseLeg, presByDistrict, houseMargins, bolts) {
  return houseLeg.map(function (m) {
    const pres = (presByDistrict[m.id] && presByDistrict[m.id].presMargin) || {};
    PRES_YEARS.forEach(function (y) {
      if (pres[y] == null) pres[y] = null;
    });
    const hm = houseMargins[m.id];
    const partyMargin = hm ? (hm.partyMargin != null ? hm.partyMargin : signedPartyMargin(hm.demPct, hm.repPct, m.party)) : null;
    const over = overUnder(partyMargin, pres[2024], m.party);
    const record = {
      id: m.id,
      geoid: m.geoid,
      state: m.state,
      district: m.district,
      name: m.name,
      party: m.party,
      bioguide: m.bioguide,
      url: m.url,
      presMargin: pres,
      partyMargin: partyMargin,
      overUnder: over
    };
    if (bolts.house[m.id]) record.bolts = bolts.house[m.id];
    return record;
  }).sort(function (a, b) { return a.id.localeCompare(b.id); });
}

function buildSenateRecords(senateLeg, statePres, senateMargins, bolts) {
  const byState = {};
  senateLeg.forEach(function (s) {
    if (!byState[s.state]) byState[s.state] = [];
    byState[s.state].push(s);
  });
  const records = [];
  Object.keys(byState).sort().forEach(function (st) {
    const senators = byState[st];
    const pres = statePres[st] || {};
    PRES_YEARS.forEach(function (y) {
      if (pres[y] == null) pres[y] = null;
    });
    const sm = senateMargins[st];
    senators.forEach(function (sen) {
      const partyMargin = sm ? signedPartyMargin(sm.demPct, sm.repPct, sen.party) : null;
      const over = overUnder(partyMargin, pres[2024], sen.party);
      const record = {
        id: 'senate:' + st + ':' + (sen.bioguide || sen.name),
        state: st,
        name: sen.name,
        party: sen.party,
        bioguide: sen.bioguide,
        url: sen.url,
        class: sen.class,
        presMargin: Object.assign({}, pres),
        partyMargin: partyMargin,
        overUnder: over
      };
      if (bolts.senate[st]) record.bolts = bolts.senate[st];
      records.push(record);
    });
  });
  return records;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bolts = loadBoltsWatch();

  const legislators = await fetchLegislators();
  const presByDistrict = await fetchDownballotPresMargins();
  const statePres = await fetchStatePresMargins();
  const houseMargins = await fetchHouseElectionMargins(legislators.house);
  const senateStates = Array.from(new Set(legislators.senate.map(function (s) { return s.state; })));
  const senateMargins = await fetchSenateElectionMargins(senateStates);

  const houseJson = buildHouseRecords(legislators.house, presByDistrict, houseMargins, bolts);
  const senateJson = buildSenateRecords(legislators.senate, statePres, senateMargins, bolts);

  const districtsGeo = await fetchDistrictGeojson();
  const statesTopo = await fetchStatesTopojson();

  const meta = {
    builtAt: new Date().toISOString(),
    sources: [
      { name: 'Bolts / What\'s on the Ballot', url: 'https://boltsmag.org/whats-on-the-ballot/' },
      { name: 'The Downballot', url: 'https://www.the-downballot.com/p/data' },
      { name: 'unitedstates/congress-legislators', url: 'https://github.com/unitedstates/congress-legislators' },
      { name: 'JeffreyBLewis/congressional-district-boundaries', url: 'https://github.com/JeffreyBLewis/congressional-district-boundaries' },
      { name: 'U.S. Census / us-atlas', url: 'https://github.com/topojson/us-atlas' }
    ],
    houseCount: houseJson.length,
    senateCount: senateJson.length,
    presYears: PRES_YEARS
  };

  fs.writeFileSync(path.join(DATA_DIR, 'house.json'), JSON.stringify(houseJson));
  fs.writeFileSync(path.join(DATA_DIR, 'senate.json'), JSON.stringify(senateJson));
  fs.writeFileSync(path.join(DATA_DIR, 'districts.geojson'), JSON.stringify(districtsGeo));
  fs.writeFileSync(path.join(DATA_DIR, 'states.topo.json'), JSON.stringify(statesTopo));
  fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('Wrote', houseJson.length, 'house records,', senateJson.length, 'senate records.');
  console.log('District features:', districtsGeo.features.length);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
