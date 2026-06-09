(function () {
  'use strict';

  var STORAGE_KEY = 'rep-tracker-v1';
  var PRES_YEARS = [2008, 2012, 2016, 2020, 2024];
  var STATE_NAMES = {
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
  var FIPS_STATE = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
    '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
    '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
    '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
    '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
    '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
    '54': 'WV', '55': 'WI', '56': 'WY'
  };

  var houseData = [];
  var senateData = [];
  var districtsGeo = null;
  var statesTopo = null;
  var meta = null;

  var appState = null;
  var chamber = 'house';
  var viewMode = 'split';
  var selectedId = '';
  var map = null;
  var geoLayer = null;
  var districtIndex = {};
  var stateSenateIndex = {};

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadAppState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function defaultState() {
    return {
      version: 1,
      notes: {},
      filters: {
        state: '',
        party: '',
        presYear: 2024,
        presMin: -30,
        presMax: 30,
        ouMin: -30,
        ouMax: 30,
        boltsOnly: false,
        search: ''
      }
    };
  }

  function normalizeState(st) {
    if (!st || typeof st !== 'object') st = defaultState();
    if (!st.notes || typeof st.notes !== 'object') st.notes = {};
    if (!st.filters || typeof st.filters !== 'object') st.filters = defaultState().filters;
    st.version = 1;
    return st;
  }

  function saveAppState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }

  function showStatus(msg, isError) {
    var el = $('status');
    if (!el) return;
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { el.hidden = true; }, 4000);
  }

  function noteKey(record) {
    if (chamber === 'house') return 'house:' + record.id;
    return 'senate:' + record.state + ':' + record.bioguide;
  }

  function formatMargin(n) {
    if (n == null || isNaN(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(1);
  }

  function marginColor(val, min, max) {
    if (val == null || isNaN(val)) return '#cbd5e1';
    var clamped = Math.max(min, Math.min(max, val));
    var t = (clamped - min) / (max - min);
    if (t < 0.5) {
      var r = Math.round(220 + (248 - 220) * (t / 0.5));
      var g = Math.round(38 + (250 - 38) * (t / 0.5));
      var b = Math.round(38 + (250 - 38) * (t / 0.5));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    var t2 = (t - 0.5) / 0.5;
    r = Math.round(248 + (37 - 248) * t2);
    g = Math.round(250 + (99 - 250) * t2);
    b = Math.round(250 + (235 - 250) * t2);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function getMetric(record, year) {
    var f = appState.filters;
    var pres = record.presMargin && record.presMargin[year || f.presYear];
    return {
      pres: pres,
      ou: record.overUnder,
      party: record.partyMargin
    };
  }

  function matchesFilters(record) {
    var f = appState.filters;
    if (f.state && record.state !== f.state) return false;
    if (f.party && record.party !== f.party) return false;
    if (f.boltsOnly && !(record.bolts && record.bolts.watch)) return false;
    var pres = record.presMargin && record.presMargin[f.presYear];
    if (pres != null) {
      if (pres < f.presMin || pres > f.presMax) return false;
    }
    if (record.overUnder != null) {
      if (record.overUnder < f.ouMin || record.overUnder > f.ouMax) return false;
    }
    if (f.search) {
      var q = f.search.toLowerCase().trim();
      var hay = [
        record.name,
        record.state,
        STATE_NAMES[record.state],
        record.id,
        chamber === 'house' ? record.id : '',
        chamber === 'house' ? record.state + '-' + String(record.district).padStart(2, '0') : ''
      ].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function currentRecords() {
    var list = chamber === 'house' ? houseData.slice() : senateData.slice();
    return list.filter(matchesFilters);
  }

  function mapMetricValue(record) {
    var f = appState.filters;
    var mode = f.mapMetric || 'pres';
    if (mode === 'ou' && record.overUnder != null) return record.overUnder;
    var pres = record.presMargin && record.presMargin[f.presYear];
    return pres;
  }

  function bindFilterUi() {
    var f = appState.filters;
    $('filter-state').value = f.state || '';
    $('filter-pres-year').value = String(f.presYear);
    $('pres-min').value = f.presMin;
    $('pres-max').value = f.presMax;
    $('ou-min').value = f.ouMin;
    $('ou-max').value = f.ouMax;
    $('filter-bolts').checked = !!f.boltsOnly;
    $('search').value = f.search || '';
    updateRangeLabels();
    document.querySelectorAll('.party-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-party') === (f.party || ''));
    });
  }

  function updateRangeLabels() {
    var f = appState.filters;
    $('pres-range-val').textContent = formatMargin(f.presMin) + ' to ' + formatMargin(f.presMax);
    $('ou-range-val').textContent = formatMargin(f.ouMin) + ' to ' + formatMargin(f.ouMax);
  }

  function populateStateSelect() {
    var sel = $('filter-state');
    var states = Object.keys(STATE_NAMES).sort();
    states.forEach(function (st) {
      var opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st + ' — ' + STATE_NAMES[st];
      sel.appendChild(opt);
    });
  }

  function renderList() {
    var list = currentRecords();
    var ul = $('member-list');
    ul.innerHTML = '';
    list.forEach(function (rec) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'member-card' + (selectedId === rec.id ? ' selected' : '');
      var metrics = getMetric(rec, appState.filters.presYear);
      var label = chamber === 'house' ? rec.id : rec.state + ' · ' + (STATE_NAMES[rec.state] || rec.state);
      btn.innerHTML =
        '<div class="row1"><span class="name">' + escapeHtml(rec.name) + '</span>' +
        '<span class="party-badge ' + escapeHtml(rec.party || 'U') + '">' + escapeHtml(rec.party || '?') + '</span></div>' +
        '<div class="meta">' + escapeHtml(label) +
        ' · Pres ' + appState.filters.presYear + ': ' + formatMargin(metrics.pres) +
        (metrics.ou != null ? ' · O/U: ' + formatMargin(metrics.ou) : '') +
        '</div>' +
        (rec.bolts && rec.bolts.watch ? '<span class="bolts-tag">Bolts watch</span>' : '');
      btn.addEventListener('click', function () {
        selectedId = rec.id;
        renderList();
        highlightMapSelection(rec);
        openDetail(rec);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    $('list-meta').textContent = list.length + ' of ' + (chamber === 'house' ? houseData.length : senateData.length) + ' shown';
  }

  function updateLegend() {
    var el = $('map-legend');
    var label = chamber === 'house' ? 'District color' : 'State color';
    var metric = 'Pres. margin ' + appState.filters.presYear + ' (D+ blue, R+ red)';
    el.innerHTML = '<strong>' + label + '</strong><br>' + metric +
      '<div class="legend-bar"></div><span>−30</span> … <span>+30 D</span>';
  }

  function ensureMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
  }

  function renderHouseMap() {
    ensureMap();
    if (geoLayer) {
      map.removeLayer(geoLayer);
      geoLayer = null;
    }
    if (!districtsGeo) return;
    var f = appState.filters;
    geoLayer = L.geoJSON(districtsGeo, {
      style: function (feat) {
        var id = feat.properties && feat.properties.id;
        var rec = districtIndex[id];
        var val = rec ? mapMetricValue(rec) : null;
        return {
          fillColor: marginColor(val, -30, 30),
          fillOpacity: 0.72,
          color: selectedId === id ? '#0f172a' : '#64748b',
          weight: selectedId === id ? 2.5 : 0.6
        };
      },
      onEachFeature: function (feat, layer) {
        var id = feat.properties && feat.properties.id;
        var rec = districtIndex[id];
        if (!rec || !matchesFilters(rec)) {
          layer.setStyle({ fillOpacity: 0.08, fillColor: '#e2e8f0' });
        }
        layer.on('click', function () {
          if (!rec || !matchesFilters(rec)) return;
          selectedId = rec.id;
          renderList();
          openDetail(rec);
          highlightMapSelection(rec);
        });
        if (rec) {
          var pres = rec.presMargin && rec.presMargin[f.presYear];
          layer.bindTooltip(rec.id + ' · ' + rec.name + '<br>Pres: ' + formatMargin(pres), { sticky: true });
        }
      }
    }).addTo(map);
    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function renderSenateMap() {
    ensureMap();
    if (geoLayer) {
      map.removeLayer(geoLayer);
      geoLayer = null;
    }
    if (!statesTopo || typeof topojson === 'undefined') return;
    var states = topojson.feature(statesTopo, statesTopo.objects.states);
    var f = appState.filters;
    geoLayer = L.geoJSON(states, {
      style: function (feat) {
        var fips = feat.id;
        var st = FIPS_STATE[fips];
        var recs = stateSenateIndex[st] || [];
        var rec = recs[0];
        var val = rec ? mapMetricValue(rec) : null;
        var selected = recs.some(function (r) { return r.id === selectedId; });
        return {
          fillColor: marginColor(val, -30, 30),
          fillOpacity: 0.72,
          color: selected ? '#0f172a' : '#64748b',
          weight: selected ? 2.5 : 0.8
        };
      },
      onEachFeature: function (feat, layer) {
        var st = FIPS_STATE[feat.id];
        var recs = (stateSenateIndex[st] || []).filter(matchesFilters);
        if (!recs.length) {
          layer.setStyle({ fillOpacity: 0.08, fillColor: '#e2e8f0' });
        }
        layer.on('click', function () {
          if (!recs.length) return;
          selectedId = recs[0].id;
          renderList();
          openDetail(recs[0]);
          highlightMapSelection(recs[0]);
        });
        if (recs.length) {
          var pres = recs[0].presMargin && recs[0].presMargin[f.presYear];
          var names = recs.map(function (r) { return r.name; }).join(', ');
          layer.bindTooltip(st + ' · ' + names + '<br>Pres: ' + formatMargin(pres), { sticky: true });
        }
      }
    }).addTo(map);
    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function renderMap() {
    if (chamber === 'house') renderHouseMap();
    else renderSenateMap();
  }

  function highlightMapSelection(rec) {
    if (!geoLayer) return;
    geoLayer.eachLayer(function (layer) {
      if (chamber === 'house') {
        var id = layer.feature && layer.feature.properties && layer.feature.properties.id;
        var match = rec && rec.id === id;
        layer.setStyle({ weight: match ? 2.5 : 0.6, color: match ? '#0f172a' : '#64748b' });
      } else if (rec) {
        var st = rec.state;
        var fips = Object.keys(FIPS_STATE).find(function (k) { return FIPS_STATE[k] === st; });
        var layerFips = layer.feature && layer.feature.id;
        var match = String(layerFips) === String(fips);
        layer.setStyle({ weight: match ? 2.5 : 0.8, color: match ? '#0f172a' : '#64748b' });
      }
    });
  }

  function openDetail(rec) {
    if (!rec) return;
    var modal = $('detail-modal');
    var f = appState.filters;
    var nk = noteKey(rec);
    var presRows = PRES_YEARS.map(function (y) {
      var v = rec.presMargin && rec.presMargin[y];
      return '<tr><td>' + y + '</td><td>' + formatMargin(v) + '</td></tr>';
    }).join('');
    var title = chamber === 'house' ? rec.id + ' · ' + (STATE_NAMES[rec.state] || rec.state) : rec.state + ' · ' + (STATE_NAMES[rec.state] || rec.state);
    $('modal-content').innerHTML =
      '<h2 class="detail-title">' + escapeHtml(rec.name) + '</h2>' +
      '<p class="detail-sub">' + escapeHtml(title) + '</p>' +
      '<span class="party-badge ' + escapeHtml(rec.party || 'U') + '">' + escapeHtml(rec.party || '?') + '</span>' +
      (rec.bolts && rec.bolts.watch ? '<span class="bolts-tag" style="margin-left:8px">Bolts watch</span>' : '') +
      '<div class="metrics-grid">' +
        '<div class="metric-box"><div class="label">Pres. margin ' + f.presYear + '</div><div class="value">' + formatMargin(rec.presMargin && rec.presMargin[f.presYear]) + '</div></div>' +
        '<div class="metric-box"><div class="label">Party margin (2024)</div><div class="value">' + formatMargin(rec.partyMargin) + '</div></div>' +
        '<div class="metric-box"><div class="label">Over / under</div><div class="value">' + formatMargin(rec.overUnder) + '</div></div>' +
      '</div>' +
      '<table class="pres-table"><thead><tr><th>Year</th><th>Pres. margin (D−R)</th></tr></thead><tbody>' + presRows + '</tbody></table>' +
      (rec.bolts && rec.bolts.note ? '<p class="detail-sub">' + escapeHtml(rec.bolts.note) + '</p>' : '') +
      '<label class="notes-label" for="detail-notes">Your notes</label>' +
      '<textarea class="notes-input" id="detail-notes" placeholder="Add notes…">' + escapeHtml(appState.notes[nk] || '') + '</textarea>' +
      '<div class="detail-links">' +
        (rec.url ? '<a href="' + escapeHtml(rec.url) + '" target="_blank" rel="noopener">Official site</a>' : '') +
        (rec.bolts && rec.bolts.url ? '<a href="' + escapeHtml(rec.bolts.url) + '" target="_blank" rel="noopener">Bolts guide</a>' : '') +
      '</div>';
    var notesEl = $('detail-notes');
    notesEl.addEventListener('input', function () {
      appState.notes[nk] = notesEl.value;
      saveAppState();
    });
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', 'open');
  }

  function closeDetail() {
    var modal = $('detail-modal');
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  function setChamber(next) {
    chamber = next;
    selectedId = '';
    document.querySelectorAll('.chamber-chip').forEach(function (btn) {
      var on = btn.getAttribute('data-chamber') === chamber;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('section-sub').textContent = chamber === 'house' ? 'U.S. House districts' : 'U.S. Senate by state';
    $('locate-btn').hidden = chamber !== 'house';
    renderList();
    renderMap();
  }

  function setView(mode) {
    viewMode = mode;
    var ws = $('workspace');
    ws.className = 'workspace view-' + mode;
    document.querySelectorAll('.view-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
    });
    if (map) setTimeout(function () { map.invalidateSize(); }, 120);
  }

  function applyFilters() {
    renderList();
    renderMap();
    saveAppState();
  }

  function buildIndexes() {
    districtIndex = {};
    houseData.forEach(function (r) { districtIndex[r.id] = r; });
    stateSenateIndex = {};
    senateData.forEach(function (r) {
      if (!stateSenateIndex[r.state]) stateSenateIndex[r.state] = [];
      stateSenateIndex[r.state].push(r);
    });
  }

  function pointInRing(point, ring) {
    var x = point[0];
    var y = point[1];
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') {
      return pointInRing(point, geom.coordinates[0]);
    }
    if (geom.type === 'MultiPolygon') {
      for (var i = 0; i < geom.coordinates.length; i++) {
        if (pointInRing(point, geom.coordinates[i][0])) return true;
      }
    }
    return false;
  }

  function findDistrictAt(lng, lat) {
    if (!districtsGeo || !districtsGeo.features) return null;
    var point = [lng, lat];
    for (var i = 0; i < districtsGeo.features.length; i++) {
      var feat = districtsGeo.features[i];
      if (pointInPolygon(point, feat.geometry)) {
        var id = feat.properties && feat.properties.id;
        return districtIndex[id] || null;
      }
    }
    return null;
  }

  function locateMe() {
    if (!navigator.geolocation) {
      showStatus('Geolocation is not available in this browser.', true);
      return;
    }
    showStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var rec = findDistrictAt(lng, lat);
      if (map) {
        map.setView([lat, lng], 9);
        L.circleMarker([lat, lng], { radius: 7, color: '#0f172a', fillColor: '#f59e0b', fillOpacity: 0.9 }).addTo(map);
      }
      if (rec) {
        selectedId = rec.id;
        renderList();
        renderMap();
        openDetail(rec);
        showStatus('You are in ' + rec.id + ' (' + rec.name + ').');
      } else {
        showStatus('Location found, but no district matched. Try zooming the map.', true);
      }
    }, function () {
      showStatus('Could not get your location. Check permissions.', true);
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rep-tracker-notes-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showStatus('Exported notes.');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, 'rep-tracker');
          if (!slice) {
            showStatus('No rep-tracker data in that backup file.', true);
            return;
          }
        }
        appState = normalizeState(slice);
        saveAppState();
        bindFilterUi();
        applyFilters();
        showStatus('Imported notes.');
      } catch (e) {
        showStatus('Could not read that file.', true);
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.querySelectorAll('.chamber-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { setChamber(btn.getAttribute('data-chamber')); });
    });
    document.querySelectorAll('.view-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-view')); });
    });
    document.querySelectorAll('.party-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.filters.party = btn.getAttribute('data-party');
        bindFilterUi();
        applyFilters();
      });
    });

    $('search').addEventListener('input', function () {
      appState.filters.search = $('search').value;
      applyFilters();
    });
    $('filter-state').addEventListener('change', function () {
      appState.filters.state = $('filter-state').value;
      applyFilters();
    });
    $('filter-pres-year').addEventListener('change', function () {
      appState.filters.presYear = parseInt($('filter-pres-year').value, 10);
      applyFilters();
    });
    ['pres-min', 'pres-max', 'ou-min', 'ou-max'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        var f = appState.filters;
        f.presMin = Math.min(parseFloat($('pres-min').value), parseFloat($('pres-max').value));
        f.presMax = Math.max(parseFloat($('pres-min').value), parseFloat($('pres-max').value));
        f.ouMin = Math.min(parseFloat($('ou-min').value), parseFloat($('ou-max').value));
        f.ouMax = Math.max(parseFloat($('ou-min').value), parseFloat($('ou-max').value));
        updateRangeLabels();
        applyFilters();
      });
    });
    $('filter-bolts').addEventListener('change', function () {
      appState.filters.boltsOnly = $('filter-bolts').checked;
      applyFilters();
    });
    $('locate-btn').addEventListener('click', locateMe);
    $('modal-close').addEventListener('click', closeDetail);
    $('detail-modal').addEventListener('click', function (e) {
      if (e.target === $('detail-modal')) closeDetail();
    });
    $('export-btn').addEventListener('click', exportData);
    $('export-btn').addEventListener('dblclick', function () {
      $('import-file').click();
    });
    $('import-file').addEventListener('change', function () {
      if ($('import-file').files[0]) importData($('import-file').files[0]);
      $('import-file').value = '';
    });
  }

  function loadData() {
    return Promise.all([
      fetch('data/house.json').then(function (r) { return r.json(); }),
      fetch('data/senate.json').then(function (r) { return r.json(); }),
      fetch('data/districts.geojson').then(function (r) { return r.json(); }),
      fetch('data/states.topo.json').then(function (r) { return r.json(); }),
      fetch('data/meta.json').then(function (r) { return r.json(); })
    ]).then(function (parts) {
      houseData = parts[0];
      senateData = parts[1];
      districtsGeo = parts[2];
      statesTopo = parts[3];
      meta = parts[4];
      buildIndexes();
      if (meta && meta.builtAt) {
        $('footer-meta').textContent = 'Data built ' + new Date(meta.builtAt).toLocaleString();
      }
    });
  }

  function init() {
    appState = normalizeState(loadAppState());
    populateStateSelect();
    bindFilterUi();
    bindEvents();
    setView('split');
    loadData().then(function () {
      renderList();
      renderMap();
    }).catch(function (err) {
      console.error(err);
      showStatus('Could not load map data. Run scripts/build-data.js first.', true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
