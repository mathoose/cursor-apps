#!/usr/bin/env node
'use strict';
/**
 * Build static data for rep-tracker (election history database).
 *
 * Usage: node scripts/build-data.js
 *        node scripts/build-data.js --skip-geo
 *        node scripts/build-data.js --skip-history
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ELECTIONS_DIR = path.join(DATA_DIR, 'elections');
const HISTORY_DIR = path.join(DATA_DIR, 'district-history');
const INPUT_DIR = path.join(__dirname, 'input');

const ELECTION_DB_VERSION = '1.0.0';
const PRES_YEARS = [2008, 2012, 2016, 2020, 2024];
const HOUSE_CYCLE = 2024;
const SENATE_CYCLE = 2024;
const SENATE_CLASS_2024 = 1;

const MIT_HOUSE_TAB_URL = 'https://raw.githubusercontent.com/jaytimm/PresElectionResults/master/data-raw/1976-2024-house.tab';
const MEDSL_SENATE_2024_URL = 'https://raw.githubusercontent.com/MEDSL/2024-elections-official/main/2024-senate-state.csv';

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

const PRES_YEAR_CONGRESS = {
  2008: 110,
  2012: 113,
  2016: 115,
  2020: 117,
  2024: 119
};

const args = process.argv.slice(2);
const skipGeo = args.includes('--skip-geo');
const skipHistory = args.includes('--skip-history');

const FETCH_HEADERS = {
  'User-Agent': 'rep-tracker-build/2.0 (https://github.com/mathoose/cursor-apps; educational)'
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
  if (isNaN(n)) return state + '-??';
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

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function writeJsonPretty(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

function buildPresByCdRecords(presByDistrict) {
  const records = [];
  Object.keys(presByDistrict).sort().forEach(function (id) {
    const pres = presByDistrict[id].presMargin || {};
    PRES_YEARS.forEach(function (year) {
      if (pres[year] == null) return;
      records.push({ id: id, year: year, margin: pres[year] });
    });
  });
  return records;
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

function buildPresByStateRecords(statePres) {
  const records = [];
  Object.keys(statePres).sort().forEach(function (st) {
    PRES_YEARS.forEach(function (year) {
      if (statePres[st][year] == null) return;
      records.push({ state: st, year: year, margin: statePres[st][year] });
    });
  });
  return records;
}

async function loadMitHouseTabText() {
  const localPath = path.join(INPUT_DIR, '1976-2024-house.tab');
  if (fs.existsSync(localPath)) {
    console.log('Reading local MIT house tab:', localPath);
    return fs.readFileSync(localPath, 'utf8');
  }
  console.log('Downloading MIT house tab from', MIT_HOUSE_TAB_URL);
  const text = await fetchText(MIT_HOUSE_TAB_URL);
  fs.writeFileSync(localPath, text);
  return text;
}

function parseMitHouseTab2024(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  const buckets = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[idx.year] !== String(HOUSE_CYCLE)) continue;
    if (row[idx.office] !== 'US HOUSE') continue;
    if (row[idx.stage] !== 'GEN') continue;
    if (row[idx.special] === 'TRUE') continue;
    const state = row[idx.state_po];
    const district = row[idx.district];
    const id = districtId(state, district);
    if (!buckets[id]) buckets[id] = { dem: 0, rep: 0, total: 0, winner: '', winnerParty: '', candidates: {} };
    const party = String(row[idx.party] || '').toUpperCase();
    const votes = parseInt(row[idx.candidatevotes], 10) || 0;
    const total = parseInt(row[idx.totalvotes], 10) || 0;
    const candidate = String(row[idx.candidate] || '').trim();
    if (total) buckets[id].total = total;
    if (/DEMOCRAT/.test(party)) buckets[id].dem += votes;
    if (/REPUBLICAN/.test(party)) buckets[id].rep += votes;
    if (candidate && !/WRITEIN/i.test(candidate)) {
      buckets[id].candidates[candidate] = { party: partyCode(party), votes: votes };
    }
  }

  const results = [];
  Object.keys(buckets).sort().forEach(function (id) {
    const b = buckets[id];
    if (!b.total) return;
    const demPct = round1((b.dem / b.total) * 100);
    const repPct = round1((b.rep / b.total) * 100);
    const margin = round1(demPct - repPct);
    let topName = '';
    let topVotes = -1;
    let topParty = '';
    Object.keys(b.candidates).forEach(function (name) {
      const c = b.candidates[name];
      if (c.votes > topVotes) {
        topVotes = c.votes;
        topName = name;
        topParty = c.party;
      }
    });
    results.push({
      id: id,
      cycle: HOUSE_CYCLE,
      winner: topName,
      party: topParty,
      dem: demPct,
      rep: repPct,
      margin: margin
    });
  });
  return results;
}

function loadHouseResultsCsv() {
  const csvPath = path.join(INPUT_DIR, 'house-results-2024.csv');
  if (!fs.existsSync(csvPath)) return null;
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const idIdx = header.indexOf('district');
  const demIdx = header.indexOf('dempct');
  const repIdx = header.indexOf('reppct');
  const marginIdx = header.indexOf('partymargin');
  const partyIdx = header.indexOf('party');
  const winnerIdx = header.indexOf('winner');
  const results = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][idIdx] || '').trim();
    if (!id) continue;
    const dem = demIdx >= 0 ? parseFloat(rows[i][demIdx]) : NaN;
    const rep = repIdx >= 0 ? parseFloat(rows[i][repIdx]) : NaN;
    let margin = marginIdx >= 0 ? parseFloat(rows[i][marginIdx]) : NaN;
    if (isNaN(margin) && !isNaN(dem) && !isNaN(rep)) margin = round1(dem - rep);
    if (isNaN(margin)) continue;
    results.push({
      id: id,
      cycle: HOUSE_CYCLE,
      winner: winnerIdx >= 0 ? String(rows[i][winnerIdx] || '').trim() : '',
      party: partyIdx >= 0 ? partyCode(rows[i][partyIdx]) : '',
      dem: isNaN(dem) ? null : round1(dem),
      rep: isNaN(rep) ? null : round1(rep),
      margin: round1(margin)
    });
  }
  return results.length ? results : null;
}

async function buildHouseResults() {
  const csv = loadHouseResultsCsv();
  if (csv) {
    console.log('Using house-results-2024.csv (' + csv.length + ' districts)');
    return csv;
  }
  const text = await loadMitHouseTabText();
  const results = parseMitHouseTab2024(text);
  if (results.length < 400) {
    throw new Error(
      'House 2024 results incomplete (' + results.length + ' districts). ' +
      'Place scripts/input/1976-2024-house.tab or house-results-2024.csv and rebuild.'
    );
  }
  console.log('Parsed MIT house tab for 2024:', results.length, 'districts');
  return results;
}

function parseMedslSenate2024(text) {
  const rows = parseCsv(text);
  const header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const iYear = header.indexOf('year');
  const iState = header.indexOf('state_po');
  const iParty = header.indexOf('party_simplified');
  const iVotes = header.indexOf('votes');
  const iTotal = header.indexOf('totalvotes');
  const iCand = header.indexOf('candidate');
  const iStage = header.indexOf('stage');
  const iSpecial = header.indexOf('special');
  const buckets = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[iYear] !== String(SENATE_CYCLE)) continue;
    if (row[iStage] !== 'GEN') continue;
    if (row[iSpecial] === 'TRUE') continue;
    const state = row[iState];
    if (!buckets[state]) {
      buckets[state] = { dem: 0, rep: 0, total: parseInt(row[iTotal], 10) || 0, candidates: {} };
    }
    const party = String(row[iParty] || '').toUpperCase();
    const votes = parseInt(row[iVotes], 10) || 0;
    const candidate = String(row[iCand] || '').trim();
    if (party === 'DEMOCRAT') buckets[state].dem += votes;
    if (party === 'REPUBLICAN') buckets[state].rep += votes;
    if (candidate) buckets[state].candidates[candidate] = { party: partyCode(party), votes: votes };
  }

  const results = [];
  Object.keys(buckets).sort().forEach(function (state) {
    const b = buckets[state];
    if (!b.total) return;
    const demPct = round1((b.dem / b.total) * 100);
    const repPct = round1((b.rep / b.total) * 100);
    const margin = round1(demPct - repPct);
    let topName = '';
    let topVotes = -1;
    let topParty = '';
    Object.keys(b.candidates).forEach(function (name) {
      const c = b.candidates[name];
      if (c.votes > topVotes) {
        topVotes = c.votes;
        topName = name;
        topParty = c.party;
      }
    });
    results.push({
      state: state,
      cycle: SENATE_CYCLE,
      class: SENATE_CLASS_2024,
      winner: topName,
      party: topParty,
      dem: demPct,
      rep: repPct,
      margin: margin
    });
  });
  return results;
}

function loadSenateResultsCsv() {
  const csvPath = path.join(INPUT_DIR, 'senate-results-2024.csv');
  if (!fs.existsSync(csvPath)) return null;
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const stIdx = header.indexOf('state');
  const demIdx = header.indexOf('dempct');
  const repIdx = header.indexOf('reppct');
  const marginIdx = header.indexOf('partymargin');
  const classIdx = header.indexOf('class');
  const partyIdx = header.indexOf('party');
  const winnerIdx = header.indexOf('winner');
  const results = [];
  for (let i = 1; i < rows.length; i++) {
    const state = String(rows[i][stIdx] || '').trim();
    if (!state) continue;
    const dem = demIdx >= 0 ? parseFloat(rows[i][demIdx]) : NaN;
    const rep = repIdx >= 0 ? parseFloat(rows[i][repIdx]) : NaN;
    let margin = marginIdx >= 0 ? parseFloat(rows[i][marginIdx]) : NaN;
    if (isNaN(margin) && !isNaN(dem) && !isNaN(rep)) margin = round1(dem - rep);
    if (isNaN(margin)) continue;
    results.push({
      state: state,
      cycle: SENATE_CYCLE,
      class: classIdx >= 0 ? parseInt(rows[i][classIdx], 10) || SENATE_CLASS_2024 : SENATE_CLASS_2024,
      winner: winnerIdx >= 0 ? String(rows[i][winnerIdx] || '').trim() : '',
      party: partyIdx >= 0 ? partyCode(rows[i][partyIdx]) : '',
      dem: isNaN(dem) ? null : round1(dem),
      rep: isNaN(rep) ? null : round1(rep),
      margin: round1(margin)
    });
  }
  return results.length ? results : null;
}

async function buildSenateResults() {
  const csv = loadSenateResultsCsv();
  if (csv) {
    console.log('Using senate-results-2024.csv (' + csv.length + ' states)');
    return csv;
  }
  console.log('Fetching MEDSL 2024 senate state results...');
  const text = await fetchText(MEDSL_SENATE_2024_URL);
  const results = parseMedslSenate2024(text);
  if (results.length < 30) {
    throw new Error(
      'Senate 2024 results incomplete (' + results.length + ' states). ' +
      'Place scripts/input/senate-results-2024.csv and rebuild.'
    );
  }
  console.log('Parsed MEDSL senate 2024:', results.length, 'states');
  return results;
}

function indexHouseResults(houseResults) {
  const byId = {};
  houseResults.forEach(function (r) { byId[r.id] = r; });
  return byId;
}

function indexSenateResults(senateResults) {
  const byKey = {};
  senateResults.forEach(function (r) {
    const key = r.state + ':' + (r.class != null ? r.class : SENATE_CLASS_2024);
    byKey[key] = r;
  });
  return byKey;
}

function presHistoryFromDistrict(id, presByDistrict) {
  const pres = (presByDistrict[id] && presByDistrict[id].presMargin) || {};
  const out = {};
  PRES_YEARS.forEach(function (y) {
    out[y] = pres[y] != null ? pres[y] : null;
  });
  return out;
}

function presHistoryFromState(st, statePres) {
  const pres = statePres[st] || {};
  const out = {};
  PRES_YEARS.forEach(function (y) {
    out[y] = pres[y] != null ? pres[y] : null;
  });
  return out;
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

function parseCongressFileName(name) {
  const m = String(name).match(/^(.+)_(\d+)_to_(\d+)\.geojson$/);
  if (!m) return null;
  return {
    stateName: m[1].replace(/%20/g, ' '),
    from: parseInt(m[2], 10),
    to: parseInt(m[3], 10)
  };
}

function ringCentroid(ring) {
  var n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
  if (!n) return [0, 0];
  var sx = 0;
  var sy = 0;
  for (var i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

function geometryCentroid(geom) {
  if (!geom) return [0, 0];
  if (geom.type === 'Polygon') return ringCentroid(geom.coordinates[0]);
  if (geom.type === 'MultiPolygon') return ringCentroid(geom.coordinates[0][0]);
  return [0, 0];
}

function visitCoords(coords, visitor) {
  if (typeof coords[0] === 'number') visitor(coords);
  else coords.forEach(function (c) { visitCoords(c, visitor); });
}

function bboxArea(geom) {
  if (!geom) return 0;
  var minX = Infinity;
  var maxX = -Infinity;
  var minY = Infinity;
  var maxY = -Infinity;
  visitCoords(geom.coordinates, function (pt) {
    minX = Math.min(minX, pt[0]);
    maxX = Math.max(maxX, pt[0]);
    minY = Math.min(minY, pt[1]);
    maxY = Math.max(maxY, pt[1]);
  });
  return (maxX - minX) * (maxY - minY);
}

function centroidDistanceKm(a, b) {
  var R = 6371;
  var dLat = (b[1] - a[1]) * Math.PI / 180;
  var dLng = (b[0] - a[0]) * Math.PI / 180;
  var lat1 = a[1] * Math.PI / 180;
  var lat2 = b[1] * Math.PI / 180;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function geometriesDiffer(g1, g2) {
  if (!g1 || !g2) return !!g1 !== !!g2;
  var c1 = geometryCentroid(g1);
  var c2 = geometryCentroid(g2);
  if (centroidDistanceKm(c1, c2) > 2) return true;
  var a1 = bboxArea(g1);
  var a2 = bboxArea(g2);
  if (!a1 || !a2) return true;
  var ratio = a1 < a2 ? a1 / a2 : a2 / a1;
  return ratio < 0.85;
}

function districtNumberKey(state, district) {
  if (state === 'AK') return '0';
  return String(district);
}

function findDistrictFeature(geojson, state, district) {
  if (!geojson || !geojson.features) return null;
  var key = districtNumberKey(state, district);
  for (var i = 0; i < geojson.features.length; i++) {
    var feat = geojson.features[i];
    var d = feat.properties && feat.properties.district;
    if (String(d) === key || (state === 'AK' && (d === 0 || d === '0' || d === 'AL'))) {
      return feat;
    }
  }
  return null;
}

function simplifyGeometry(geom) {
  return {
    type: geom.type,
    coordinates: roundCoords(geom.coordinates, 1000)
  };
}

async function buildDistrictHistory(houseLeg, presByDistrict) {
  var historyIndexPath = path.join(HISTORY_DIR, 'index.json');
  if ((skipHistory || skipGeo) && fs.existsSync(historyIndexPath)) {
    console.log('Skipping district history (existing index.json)');
    return JSON.parse(fs.readFileSync(historyIndexPath, 'utf8'));
  }

  console.log('Building district history overlays...');
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  var listUrl = 'https://api.github.com/repos/JeffreyBLewis/congressional-district-boundaries/contents/GeoJson';
  var list = await fetchJson(listUrl);
  var filesByStateCongress = {};
  list.forEach(function (file) {
    var parsed = parseCongressFileName(file.name);
    if (!parsed) return;
    var abbr = Object.keys(STATE_NAMES).find(function (k) { return STATE_NAMES[k] === parsed.stateName; });
    if (!abbr) return;
    if (!filesByStateCongress[abbr]) filesByStateCongress[abbr] = [];
    filesByStateCongress[abbr].push({
      from: parsed.from,
      to: parsed.to,
      download_url: file.download_url,
      name: file.name
    });
  });

  var geoCache = {};
  async function loadStateCongressGeo(stateAbbr, congress) {
    var cacheKey = stateAbbr + ':' + congress;
    if (geoCache[cacheKey]) return geoCache[cacheKey];
    var candidates = (filesByStateCongress[stateAbbr] || []).filter(function (f) {
      return f.from <= congress && congress <= f.to;
    });
    if (!candidates.length) {
      geoCache[cacheKey] = null;
      return null;
    }
    candidates.sort(function (a, b) {
      return (a.to - a.from) - (b.to - b.from);
    });
    var file = candidates[0];
    var gj = await fetchJson(file.download_url);
    geoCache[cacheKey] = gj;
    return gj;
  }

  var indexDistricts = {};
  var stateShards = {};
  var changedCount = 0;

  for (var hi = 0; hi < houseLeg.length; hi++) {
    var member = houseLeg[hi];
    var id = member.id;
    var state = member.state;
    var district = member.district;
    var pres = (presByDistrict[id] && presByDistrict[id].presMargin) || {};

    var geometries = {};
    for (var yi = 0; yi < PRES_YEARS.length; yi++) {
      var year = PRES_YEARS[yi];
      var congress = PRES_YEAR_CONGRESS[year];
      var gj = await loadStateCongressGeo(state, congress);
      var feat = gj ? findDistrictFeature(gj, state, district) : null;
      geometries[year] = feat ? feat.geometry : null;
    }

    var geom2024 = geometries[2024];
    var changed = false;
    for (yi = 0; yi < PRES_YEARS.length; yi++) {
      year = PRES_YEARS[yi];
      if (year === 2024) continue;
      if (geometriesDiffer(geometries[year], geom2024)) {
        changed = true;
        break;
      }
    }

    indexDistricts[id] = { changed: changed, state: state };

    if (!changed) continue;
    changedCount++;

    if (!stateShards[state]) stateShards[state] = {};
    var vintages = {};
    for (yi = 0; yi < PRES_YEARS.length; yi++) {
      year = PRES_YEARS[yi];
      var geom = geometries[year];
      if (!geom) {
        vintages[String(year)] = { congress: PRES_YEAR_CONGRESS[year], missing: true };
        continue;
      }
      vintages[String(year)] = {
        congress: PRES_YEAR_CONGRESS[year],
        presMargin: pres[year] != null ? pres[year] : null,
        geometry: simplifyGeometry(geom)
      };
    }
    stateShards[state][id] = { vintages: vintages };
  }

  var historyIndex = {
    version: 1,
    presYears: PRES_YEARS,
    presYearCongress: PRES_YEAR_CONGRESS,
    changedCount: changedCount,
    districts: indexDistricts
  };

  writeJsonPretty(historyIndexPath, historyIndex);
  Object.keys(stateShards).sort().forEach(function (st) {
    writeJson(path.join(HISTORY_DIR, st + '.json'), stateShards[st]);
  });

  console.log('District history:', changedCount, 'changed districts across', Object.keys(stateShards).length, 'state shards');
  return historyIndex;
}

function buildHouseRecords(houseLeg, presByDistrict, houseById, bolts) {
  return houseLeg.map(function (m) {
    const pres = presHistoryFromDistrict(m.id, presByDistrict);
    const hr = houseById[m.id];
    const partyMargin = hr ? signedPartyMargin(hr.dem, hr.rep, m.party) : null;
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
      overUnder: over,
      electionHistory: {
        pres: pres,
        results: hr ? [hr] : []
      }
    };
    if (bolts.house[m.id]) record.bolts = bolts.house[m.id];
    return record;
  }).sort(function (a, b) { return a.id.localeCompare(b.id); });
}

function buildSenateRecords(senateLeg, statePres, senateByKey, bolts) {
  const byState = {};
  senateLeg.forEach(function (s) {
    if (!byState[s.state]) byState[s.state] = [];
    byState[s.state].push(s);
  });
  const records = [];
  Object.keys(byState).sort().forEach(function (st) {
    const senators = byState[st];
    const pres = presHistoryFromState(st, statePres);
    senators.forEach(function (sen) {
      const resultKey = st + ':' + (sen.class != null ? sen.class : SENATE_CLASS_2024);
      const sr = senateByKey[resultKey];
      const partyMargin = sr ? signedPartyMargin(sr.dem, sr.rep, sen.party) : null;
      const over = overUnder(partyMargin, pres[2024], sen.party);
      const record = {
        id: 'senate:' + st + ':' + (sen.bioguide || sen.name),
        state: st,
        name: sen.name,
        party: sen.party,
        bioguide: sen.bioguide,
        url: sen.url,
        class: sen.class,
        presMargin: pres,
        partyMargin: partyMargin,
        overUnder: over,
        electionHistory: {
          pres: pres,
          results: sr ? [sr] : []
        }
      };
      if (bolts.senate[st]) record.bolts = bolts.senate[st];
      records.push(record);
    });
  });
  return records;
}

function countPresByCdYears(records) {
  const counts = {};
  records.forEach(function (r) {
    counts[r.year] = (counts[r.year] || 0) + 1;
  });
  return counts;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ELECTIONS_DIR, { recursive: true });
  const bolts = loadBoltsWatch();

  const legislators = await fetchLegislators();
  const presByDistrict = await fetchDownballotPresMargins();
  const statePres = await fetchStatePresMargins();
  const houseResults = await buildHouseResults();
  const senateResults = await buildSenateResults();

  const presByCd = buildPresByCdRecords(presByDistrict);
  const presByState = buildPresByStateRecords(statePres);
  const houseById = indexHouseResults(houseResults);
  const senateByKey = indexSenateResults(senateResults);

  const builtAt = new Date().toISOString();

  const houseJson = buildHouseRecords(legislators.house, presByDistrict, houseById, bolts);
  const senateJson = buildSenateRecords(legislators.senate, statePres, senateByKey, bolts);
  const districtHistory = await buildDistrictHistory(legislators.house, presByDistrict);

  const electionMeta = {
    electionDbVersion: ELECTION_DB_VERSION,
    builtAt: builtAt,
    cyclesIncluded: { house: [HOUSE_CYCLE], senate: [SENATE_CYCLE], pres: PRES_YEARS },
    counts: {
      'pres-by-cd': presByCd.length,
      'pres-by-state': presByState.length,
      'house-results': houseResults.length,
      'senate-results': senateResults.length
    },
    presByCdYearCounts: countPresByCdYears(presByCd),
    districtHistoryChangedCount: districtHistory.changedCount
  };

  writeJson(path.join(ELECTIONS_DIR, 'pres-by-cd.json'), presByCd);
  writeJson(path.join(ELECTIONS_DIR, 'pres-by-state.json'), presByState);
  writeJson(path.join(ELECTIONS_DIR, 'house-results.json'), houseResults);
  writeJson(path.join(ELECTIONS_DIR, 'senate-results.json'), senateResults);
  writeJsonPretty(path.join(ELECTIONS_DIR, 'meta.json'), electionMeta);

  const districtsGeo = await fetchDistrictGeojson();
  const statesTopo = await fetchStatesTopojson();

  const houseWithOu = houseJson.filter(function (r) { return r.overUnder != null; }).length;
  const meta = {
    builtAt: builtAt,
    electionDbVersion: ELECTION_DB_VERSION,
    sources: [
      { name: 'Bolts / What\'s on the Ballot', url: 'https://boltsmag.org/whats-on-the-ballot/' },
      { name: 'The Downballot', url: 'https://www.the-downballot.com/p/data' },
      { name: 'MIT Election Lab (house tab via jaytimm/PresElectionResults)', url: 'https://electionlab.mit.edu/data' },
      { name: 'MEDSL 2024 Senate state returns', url: 'https://github.com/MEDSL/2024-elections-official' },
      { name: 'unitedstates/congress-legislators', url: 'https://github.com/unitedstates/congress-legislators' },
      { name: 'JeffreyBLewis/congressional-district-boundaries', url: 'https://github.com/JeffreyBLewis/congressional-district-boundaries' },
      { name: 'U.S. Census / us-atlas', url: 'https://github.com/topojson/us-atlas' }
    ],
    houseCount: houseJson.length,
    senateCount: senateJson.length,
    presYears: PRES_YEARS,
    houseOverUnderCount: houseWithOu,
    districtHistoryChangedCount: districtHistory.changedCount,
    pollsPhase: 2
  };

  writeJson(path.join(DATA_DIR, 'house.json'), houseJson);
  writeJson(path.join(DATA_DIR, 'senate.json'), senateJson);
  writeJson(path.join(DATA_DIR, 'districts.geojson'), districtsGeo);
  writeJson(path.join(DATA_DIR, 'states.topo.json'), statesTopo);
  writeJsonPretty(path.join(DATA_DIR, 'meta.json'), meta);
  writeJsonPretty(path.join(DATA_DIR, 'polls.json'), { updated: null, races: [] });

  console.log('Election DB: pres-by-cd', presByCd.length, 'house-results', houseResults.length, 'senate-results', senateResults.length);
  console.log('Wrote', houseJson.length, 'house records (' + houseWithOu + ' with overUnder),', senateJson.length, 'senate records.');
  console.log('District features:', districtsGeo.features.length);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
