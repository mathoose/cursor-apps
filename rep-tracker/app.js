(function () {
  'use strict';

  var STORAGE_KEY = 'rep-tracker-v1';
  var PRES_YEARS = [2008, 2012, 2016, 2020, 2024];
  var PRES_MARGIN_LIMIT = 90;
  var OU_MARGIN_LIMIT = 100;
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
  var swingArrowLayer = null;
  var SWING_ARROW_ANGLE = 65;
  var districtIndex = {};
  var stateSenateIndex = {};
  var districtHistoryIndex = null;
  var districtHistoryShardCache = {};
  var historyMap = null;
  var historyLayers = {};
  var historyVisibleYears = {};
  var HISTORY_YEAR_COLORS = {
    2008: '#d97706',
    2012: '#059669',
    2016: '#0284c7',
    2020: '#7c3aed',
    2024: '#dc2626'
  };

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
        presMin: -PRES_MARGIN_LIMIT,
        presMax: PRES_MARGIN_LIMIT,
        ouMin: -OU_MARGIN_LIMIT,
        ouMax: OU_MARGIN_LIMIT,
        boltsOnly: false,
        search: '',
        quickFilter: '',
        trumpMin: 0,
        demMin: 0,
        mapMode: 'colors',
        swingFrom: 2008,
        swingTo: 2024
      }
    };
  }

  function normalizeState(st) {
    if (!st || typeof st !== 'object') st = defaultState();
    if (!st.notes || typeof st.notes !== 'object') st.notes = {};
    if (!st.filters || typeof st.filters !== 'object') st.filters = defaultState().filters;
    if (st.filters.presMin === -30 && st.filters.presMax === 30) {
      st.filters.presMin = -PRES_MARGIN_LIMIT;
      st.filters.presMax = PRES_MARGIN_LIMIT;
    }
    if (st.filters.ouMin === -30 && st.filters.ouMax === 30) {
      st.filters.ouMin = -OU_MARGIN_LIMIT;
      st.filters.ouMax = OU_MARGIN_LIMIT;
    }
    st.filters.presMin = Math.max(-PRES_MARGIN_LIMIT, Math.min(PRES_MARGIN_LIMIT, st.filters.presMin));
    st.filters.presMax = Math.max(-PRES_MARGIN_LIMIT, Math.min(PRES_MARGIN_LIMIT, st.filters.presMax));
    st.filters.ouMin = Math.max(-OU_MARGIN_LIMIT, Math.min(OU_MARGIN_LIMIT, st.filters.ouMin));
    st.filters.ouMax = Math.max(-OU_MARGIN_LIMIT, Math.min(OU_MARGIN_LIMIT, st.filters.ouMax));
    if (st.filters.quickFilter == null) st.filters.quickFilter = '';
    if (st.filters.trumpMin == null) st.filters.trumpMin = 0;
    if (st.filters.demMin == null) st.filters.demMin = 0;
    if (st.filters.mapMode == null) st.filters.mapMode = 'colors';
    if (st.filters.swingFrom == null) st.filters.swingFrom = 2008;
    if (st.filters.swingTo == null) st.filters.swingTo = 2024;
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

  function presSwing(record, fromYear, toYear) {
    var fromVal = record.presMargin && record.presMargin[fromYear];
    var toVal = record.presMargin && record.presMargin[toYear];
    if (fromVal == null || toVal == null) return null;
    return Math.round((toVal - fromVal) * 10) / 10;
  }

  function formatSwing(swing) {
    if (swing == null || isNaN(swing)) return '—';
    if (swing > 0) return 'D +' + swing.toFixed(1) + ' swing';
    if (swing < 0) return 'R +' + Math.abs(swing).toFixed(1) + ' swing';
    return 'No change';
  }

  function featureCentroidLatLng(feat) {
    if (!feat || !feat.geometry) return null;
    var geom = feat.geometry;
    var ring;
    if (geom.type === 'Polygon') ring = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') ring = geom.coordinates[0][0];
    else return null;
    if (!ring || !ring.length) return null;
    var n = ring.length - 1;
    if (n < 1) n = ring.length;
    var sx = 0;
    var sy = 0;
    for (var i = 0; i < n; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return [sy / n, sx / n];
  }

  function swingArrowIcon(swing, maxAbs, uid) {
    var abs = Math.abs(swing);
    var len = maxAbs > 0 ? Math.max(12, Math.min(52, (abs / maxAbs) * 52)) : 12;
    var color = swing >= 0 ? '#2563eb' : '#dc2626';
    var angle = swing >= 0 ? SWING_ARROW_ANGLE : SWING_ARROW_ANGLE + 180;
    var size = len + 20;
    var cx = size / 2;
    var cy = size / 2;
    var x2 = cx;
    var y2 = cy - len / 2;
    var markerId = 'swing-arr-' + uid;
    var html = '<svg class="swing-arrow-svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'style="transform:rotate(' + angle + 'deg)">' +
      '<defs><marker id="' + markerId + '" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">' +
      '<polygon points="0 0, 7 3.5, 0 7" fill="' + color + '"/></marker></defs>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + color + '" ' +
      'stroke-width="3.5" stroke-linecap="round" marker-end="url(#' + markerId + ')"/></svg>';
    return L.divIcon({
      className: 'swing-arrow-marker',
      html: html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  function clearSwingArrows() {
    if (swingArrowLayer && map) {
      map.removeLayer(swingArrowLayer);
      swingArrowLayer = null;
    }
  }

  function formatPresMarginPlain(pres) {
    if (pres == null || isNaN(pres)) return '—';
    if (pres < 0) return 'Trump +' + Math.abs(pres).toFixed(1);
    if (pres > 0) return 'Dems +' + pres.toFixed(1);
    return 'Even';
  }

  function presYearLabel(year) {
    var labels = {
      2024: 'Harris vs Trump',
      2020: 'Biden vs Trump',
      2016: 'Clinton vs Trump',
      2012: 'Obama vs Romney',
      2008: 'Obama vs McCain'
    };
    return year + ' (' + (labels[year] || '') + ')';
  }

  function gopNominee(year) {
    if (year >= 2016) return 'Trump';
    if (year === 2012) return 'Romney';
    return 'McCain';
  }

  function demNominee(year) {
    if (year === 2024) return 'Harris';
    if (year >= 2020) return 'Biden';
    if (year === 2016) return 'Clinton';
    return 'Obama';
  }

  function updateQuickFilterLabels() {
    var year = appState.filters.presYear;
    var gop = gopNominee(year);
    var dem = demNominee(year);
    var demRed = $('quick-dem-red');
    var repBlue = $('quick-rep-blue');
    var trumpLabel = $('trump-margin-label');
    if (demRed) demRed.textContent = 'Dem won ' + gop + ' district';
    if (repBlue) repBlue.textContent = 'Rep won ' + dem + ' district';
    if (trumpLabel) trumpLabel.textContent = 'How much did ' + gop + ' win by?';
    document.querySelectorAll('.trump-chip[data-trump-label]').forEach(function (btn) {
      var amt = btn.getAttribute('data-trump-label');
      if (parseInt(btn.getAttribute('data-trump'), 10) > 0) {
        btn.textContent = gop + ' ' + amt;
      }
    });
  }

  function filterSummaryText() {
    var f = appState.filters;
    var parts = [];
    if (f.quickFilter === 'dem-trump') {
      var gop = gopNominee(f.presYear);
      var trumpPart = f.trumpMin > 0 ? gop + ' +' + f.trumpMin + '+ districts' : gop + '-won districts';
      parts.push('Democrat-held seats in ' + trumpPart);
    } else if (f.quickFilter === 'rep-biden') {
      var demPart = f.demMin > 0 ? 'Dems +' + f.demMin + '+ districts' : 'Dem-won districts';
      parts.push('Republican-held seats in ' + demPart);
    } else if (f.party === 'D') {
      parts.push('Democrat-held seats');
    } else if (f.party === 'R') {
      parts.push('Republican-held seats');
    } else {
      parts.push('All seats');
    }
    parts.push('· ' + presYearLabel(f.presYear));
    if (f.state) parts.push('· ' + f.state);
    if (f.boltsOnly) parts.push('· Bolts watch');
    return parts.join(' ');
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
    if (f.boltsOnly && !(record.bolts && record.bolts.watch)) return false;
    var pres = record.presMargin && record.presMargin[f.presYear];

    if (f.quickFilter === 'dem-trump') {
      if (record.party !== 'D') return false;
      if (pres == null || pres >= 0) return false;
      if (f.trumpMin > 0 && pres > -f.trumpMin) return false;
    } else if (f.quickFilter === 'rep-biden') {
      if (record.party !== 'R') return false;
      if (pres == null || pres <= 0) return false;
      if (f.demMin > 0 && pres < f.demMin) return false;
    } else if (f.party && record.party !== f.party) {
      return false;
    }

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

  function mapColorScale() {
    var f = appState.filters;
    if ((f.mapMetric || 'pres') === 'ou') {
      return { min: -OU_MARGIN_LIMIT, max: OU_MARGIN_LIMIT };
    }
    return { min: -PRES_MARGIN_LIMIT, max: PRES_MARGIN_LIMIT };
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
    document.querySelectorAll('.quick-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-quick') === (f.quickFilter || ''));
    });
    document.querySelectorAll('.trump-chip').forEach(function (btn) {
      btn.classList.toggle('active', parseInt(btn.getAttribute('data-trump'), 10) === (f.trumpMin || 0));
    });
    document.querySelectorAll('.dem-chip').forEach(function (btn) {
      btn.classList.toggle('active', parseInt(btn.getAttribute('data-dem'), 10) === (f.demMin || 0));
    });
    var trumpRow = $('trump-margin-row');
    var demRow = $('dem-margin-row');
    if (trumpRow) trumpRow.hidden = f.quickFilter !== 'dem-trump';
    if (demRow) demRow.hidden = f.quickFilter !== 'rep-biden';
    var summary = $('filter-summary');
    if (summary) summary.textContent = filterSummaryText();
    updateQuickFilterLabels();
    document.querySelectorAll('.map-mode-chip').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-map-mode') === (f.mapMode || 'colors'));
    });
    var swingControls = $('swing-controls');
    if (swingControls) swingControls.hidden = f.mapMode !== 'swing';
    if ($('swing-from')) $('swing-from').value = String(f.swingFrom);
    if ($('swing-to')) $('swing-to').value = String(f.swingTo);
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
        (appState.filters.mapMode === 'swing'
          ? ' · Swing ' + appState.filters.swingFrom + '→' + appState.filters.swingTo + ': ' +
            formatSwing(presSwing(rec, appState.filters.swingFrom, appState.filters.swingTo))
          : ' · Pres: ' + formatPresMarginPlain(metrics.pres) +
            (metrics.ou != null ? ' · vs pres: ' + formatMargin(metrics.ou) : '')) +
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
    var f = appState.filters;
    if (f.mapMode === 'swing') {
      var unit = chamber === 'house' ? 'district' : 'state';
      el.innerHTML = '<strong>Presidential swing</strong><br>' +
        f.swingFrom + ' → ' + f.swingTo + ' by ' + unit +
        '<div class="swing-legend-arrows">' +
          '<span class="swing-legend-item dem"><span class="swing-legend-icon dem"></span> Toward Dems</span>' +
          '<span class="swing-legend-item rep"><span class="swing-legend-icon rep"></span> Toward Reps</span>' +
        '</div>' +
        '<span class="legend-hint">Longer arrow = bigger shift</span>';
      return;
    }
    var label = chamber === 'house' ? 'District color' : 'State color';
    var scale = mapColorScale();
    var metric;
    if (f.quickFilter === 'dem-trump') {
      metric = 'Dem-held in Trump districts (' + presYearLabel(f.presYear) + ')';
    } else if (f.quickFilter === 'rep-biden') {
      metric = 'Rep-held in Dem districts (' + presYearLabel(f.presYear) + ')';
    } else if (f.mapMetric === 'ou') {
      metric = 'Over/under vs presidential result';
    } else {
      metric = 'Presidential margin · ' + presYearLabel(f.presYear);
    }
    el.innerHTML = '<strong>' + label + '</strong><br>' + metric +
      '<div class="legend-bar"></div><span>Trump +' + Math.abs(scale.min) + '</span> … <span>Dems +' + scale.max + '</span>';
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
    clearSwingArrows();
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
        var scale = mapColorScale();
        return {
          fillColor: marginColor(val, scale.min, scale.max),
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
          layer.bindTooltip(rec.id + ' · ' + rec.name + '<br>Pres: ' + formatPresMarginPlain(pres), { sticky: true });
        }
      }
    }).addTo(map);
    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function addSwingArrows(features, getRecord, getLabel) {
    var f = appState.filters;
    var fromY = f.swingFrom;
    var toY = f.swingTo;
    if (fromY === toY) return;
    var swings = [];
    features.forEach(function (item) {
      var rec = getRecord(item);
      if (!rec || !matchesFilters(rec)) return;
      var swing = presSwing(rec, fromY, toY);
      if (swing == null) return;
      swings.push({ rec: rec, swing: swing, latlng: item.latlng, label: getLabel(item, rec) });
    });
    if (!swings.length) return;
    var maxAbs = 0;
    swings.forEach(function (s) { maxAbs = Math.max(maxAbs, Math.abs(s.swing)); });
    if (maxAbs < 1) maxAbs = 1;
    swingArrowLayer = L.layerGroup();
    swings.forEach(function (s, idx) {
      var fromVal = s.rec.presMargin[fromY];
      var toVal = s.rec.presMargin[toY];
      var tip = s.label + '<br>' + fromY + ': ' + formatPresMarginPlain(fromVal) +
        '<br>' + toY + ': ' + formatPresMarginPlain(toVal) +
        '<br>Swing: ' + formatSwing(s.swing);
      var marker = L.marker(s.latlng, { icon: swingArrowIcon(s.swing, maxAbs, idx), interactive: true });
      marker.bindTooltip(tip, { sticky: true });
      marker.on('click', function () {
        selectedId = s.rec.id;
        renderList();
        openDetail(s.rec);
        highlightMapSelection(s.rec);
      });
      swingArrowLayer.addLayer(marker);
    });
    swingArrowLayer.addTo(map);
  }

  function renderSwingHouseMap() {
    ensureMap();
    clearSwingArrows();
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
        var toPres = rec && rec.presMargin && rec.presMargin[f.swingTo];
        var selected = selectedId === id;
        return {
          fillColor: toPres != null ? marginColor(toPres, -PRES_MARGIN_LIMIT, PRES_MARGIN_LIMIT) : '#e2e8f0',
          fillOpacity: 0.35,
          color: selected ? '#0f172a' : '#94a3b8',
          weight: selected ? 2 : 0.5
        };
      },
      onEachFeature: function (feat, layer) {
        var id = feat.properties && feat.properties.id;
        var rec = districtIndex[id];
        if (!rec || !matchesFilters(rec)) {
          layer.setStyle({ fillOpacity: 0.06, fillColor: '#e2e8f0' });
        }
      }
    }).addTo(map);

    var arrowItems = [];
    (districtsGeo.features || []).forEach(function (feat) {
      var id = feat.properties && feat.properties.id;
      var rec = districtIndex[id];
      var latlng = featureCentroidLatLng(feat);
      if (!latlng) return;
      arrowItems.push({
        latlng: latlng,
        feat: feat,
        id: id,
        rec: rec
      });
    });
    addSwingArrows(arrowItems, function (item) { return item.rec; }, function (item, rec) {
      return (rec ? rec.id + ' · ' + rec.name : item.id);
    });

    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function renderSwingSenateMap() {
    ensureMap();
    clearSwingArrows();
    if (geoLayer) {
      map.removeLayer(geoLayer);
      geoLayer = null;
    }
    if (!statesTopo || typeof topojson === 'undefined') return;
    var states = topojson.feature(statesTopo, statesTopo.objects.states);
    var f = appState.filters;
    geoLayer = L.geoJSON(states, {
      style: function (feat) {
        var st = FIPS_STATE[feat.id];
        var recs = stateSenateIndex[st] || [];
        var rec = recs[0];
        var toPres = rec && rec.presMargin && rec.presMargin[f.swingTo];
        var selected = recs.some(function (r) { return r.id === selectedId; });
        return {
          fillColor: toPres != null ? marginColor(toPres, -PRES_MARGIN_LIMIT, PRES_MARGIN_LIMIT) : '#e2e8f0',
          fillOpacity: 0.35,
          color: selected ? '#0f172a' : '#94a3b8',
          weight: selected ? 2 : 0.8
        };
      }
    }).addTo(map);

    var arrowItems = [];
    states.features.forEach(function (feat) {
      var st = FIPS_STATE[feat.id];
      var recs = stateSenateIndex[st] || [];
      var rec = recs[0];
      var latlng = featureCentroidLatLng(feat);
      if (!latlng || !st) return;
      arrowItems.push({ latlng: latlng, st: st, rec: rec, recs: recs });
    });
    addSwingArrows(arrowItems, function (item) { return item.rec; }, function (item, rec) {
      return item.st + (rec ? ' · ' + rec.name : '');
    });

    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function renderSenateMap() {
    ensureMap();
    clearSwingArrows();
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
        var scale = mapColorScale();
        return {
          fillColor: marginColor(val, scale.min, scale.max),
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
          layer.bindTooltip(st + ' · ' + names + '<br>Pres: ' + formatPresMarginPlain(pres), { sticky: true });
        }
      }
    }).addTo(map);
    setTimeout(function () {
      if (geoLayer && geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding: [12, 12] });
    }, 50);
    updateLegend();
  }

  function renderMap() {
    var mode = appState.filters.mapMode || 'colors';
    if (chamber === 'house') {
      if (mode === 'swing') renderSwingHouseMap();
      else renderHouseMap();
    } else {
      if (mode === 'swing') renderSwingSenateMap();
      else renderSenateMap();
    }
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

  function destroyHistoryMap() {
    if (historyMap) {
      historyMap.remove();
      historyMap = null;
    }
    historyLayers = {};
    historyVisibleYears = {};
  }

  function fetchDistrictHistoryShard(state) {
    if (districtHistoryShardCache[state]) {
      return Promise.resolve(districtHistoryShardCache[state]);
    }
    return fetch('data/district-history/' + state + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('shard ' + state);
        return r.json();
      })
      .then(function (data) {
        districtHistoryShardCache[state] = data;
        return data;
      });
  }

  function historyYearChipHtml(year) {
    var color = HISTORY_YEAR_COLORS[year] || '#64748b';
    return '<button type="button" class="chip history-year-chip active" data-history-year="' + year + '" ' +
      'style="--history-color:' + color + '">' + year + '</button>';
  }

  function buildDistrictHistorySection(rec) {
    if (chamber !== 'house' || !districtHistoryIndex || !districtHistoryIndex.districts) return '';
    var info = districtHistoryIndex.districts[rec.id];
    if (!info) return '';
    if (!info.changed) {
      return '<p class="detail-sub history-stable">District boundaries unchanged across 2008–2024 lines.</p>';
    }
    var chips = PRES_YEARS.map(historyYearChipHtml).join('');
    return '<h3 class="detail-heading">District over time</h3>' +
      '<p class="detail-sub">Overlaid boundaries by presidential line vintage. Toggle years to compare.</p>' +
      '<div class="history-year-row" role="group" aria-label="History years">' + chips + '</div>' +
      '<div id="district-history-map" class="district-history-map" aria-label="District boundaries over time"></div>';
  }

  function fitHistoryMapBounds() {
    if (!historyMap) return;
    var bounds = null;
    PRES_YEARS.forEach(function (year) {
      if (!historyVisibleYears[year]) return;
      var layer = historyLayers[year];
      if (layer && layer.getBounds().isValid()) {
        bounds = bounds ? bounds.extend(layer.getBounds()) : layer.getBounds();
      }
    });
    if (bounds && bounds.isValid()) {
      historyMap.fitBounds(bounds, { padding: [12, 12] });
    }
  }

  function renderDistrictHistoryLayers(rec, shard) {
    if (!shard || !shard[rec.id] || !shard[rec.id].vintages) return;
    var vintages = shard[rec.id].vintages;
    destroyHistoryMap();
    var el = $('district-history-map');
    if (!el) return;

    historyMap = L.map(el, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(historyMap);

    PRES_YEARS.forEach(function (year) {
      historyVisibleYears[year] = true;
      var vintage = vintages[String(year)];
      if (!vintage || vintage.missing || !vintage.geometry) return;
      var color = HISTORY_YEAR_COLORS[year] || '#64748b';
      var margin = vintage.presMargin != null ? vintage.presMargin : (rec.presMargin && rec.presMargin[year]);
      var layer = L.geoJSON({ type: 'Feature', geometry: vintage.geometry, properties: {} }, {
        style: {
          color: color,
          weight: 2.5,
          fillColor: color,
          fillOpacity: 0.15
        }
      });
      layer.bindTooltip(year + ' · Pres ' + formatMargin(margin), { sticky: true });
      if (historyVisibleYears[year]) layer.addTo(historyMap);
      historyLayers[year] = layer;
    });

    setTimeout(function () {
      fitHistoryMapBounds();
      historyMap.invalidateSize();
    }, 80);
  }

  function bindHistoryYearChips(rec) {
    document.querySelectorAll('.history-year-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var year = parseInt(btn.getAttribute('data-history-year'), 10);
        historyVisibleYears[year] = !historyVisibleYears[year];
        btn.classList.toggle('active', historyVisibleYears[year]);
        var layer = historyLayers[year];
        if (!layer || !historyMap) return;
        if (historyVisibleYears[year]) layer.addTo(historyMap);
        else historyMap.removeLayer(layer);
        fitHistoryMapBounds();
      });
    });
  }

  function initDistrictHistoryMap(rec) {
    if (chamber !== 'house' || !districtHistoryIndex || !districtHistoryIndex.districts) return;
    var info = districtHistoryIndex.districts[rec.id];
    if (!info || !info.changed) return;
    fetchDistrictHistoryShard(rec.state).then(function (shard) {
      if (!$('district-history-map')) return;
      renderDistrictHistoryLayers(rec, shard);
      bindHistoryYearChips(rec);
    }).catch(function (err) {
      console.warn('District history shard failed', err);
    });
  }

  function formatResultLine(result) {
    if (!result) return '';
    var parts = [];
    if (result.winner) parts.push(escapeHtml(result.winner));
    if (result.party) parts.push('(' + escapeHtml(result.party) + ')');
    var margin = result.margin != null ? formatMargin(result.margin) : '—';
    var pct = (result.dem != null && result.rep != null)
      ? ' · D ' + result.dem + '% / R ' + result.rep + '%'
      : '';
    return '<p class="detail-sub"><strong>' + (result.cycle || 2024) + ' result:</strong> ' +
      parts.join(' ') + ' · margin ' + margin + pct + '</p>';
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
    var hist = rec.electionHistory || {};
    var result2024 = (hist.results && hist.results[0]) || null;
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
      formatResultLine(result2024) +
      buildDistrictHistorySection(rec) +
      '<h3 class="detail-heading">Presidential margins (D−R)</h3>' +
      '<table class="pres-table"><thead><tr><th>Year</th><th>Margin</th></tr></thead><tbody>' + presRows + '</tbody></table>' +
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
    initDistrictHistoryMap(rec);
  }

  function closeDetail() {
    destroyHistoryMap();
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
        appState.filters.quickFilter = '';
        appState.filters.trumpMin = 0;
        appState.filters.demMin = 0;
        bindFilterUi();
        applyFilters();
      });
    });
    document.querySelectorAll('.quick-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-quick') || '';
        appState.filters.quickFilter = q;
        appState.filters.trumpMin = 0;
        appState.filters.demMin = 0;
        if (q === 'dem-trump') appState.filters.party = 'D';
        else if (q === 'rep-biden') appState.filters.party = 'R';
        else appState.filters.party = '';
        bindFilterUi();
        applyFilters();
      });
    });
    document.querySelectorAll('.trump-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.filters.trumpMin = parseInt(btn.getAttribute('data-trump'), 10) || 0;
        bindFilterUi();
        applyFilters();
      });
    });
    document.querySelectorAll('.dem-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.filters.demMin = parseInt(btn.getAttribute('data-dem'), 10) || 0;
        bindFilterUi();
        applyFilters();
      });
    });
    document.querySelectorAll('.map-mode-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.filters.mapMode = btn.getAttribute('data-map-mode') || 'colors';
        bindFilterUi();
        applyFilters();
        if (map) setTimeout(function () { map.invalidateSize(); }, 120);
      });
    });
    $('swing-from').addEventListener('change', function () {
      appState.filters.swingFrom = parseInt($('swing-from').value, 10);
      if (appState.filters.swingFrom === appState.filters.swingTo) {
        showStatus('Pick two different years to compare.', true);
      }
      bindFilterUi();
      applyFilters();
    });
    $('swing-to').addEventListener('change', function () {
      appState.filters.swingTo = parseInt($('swing-to').value, 10);
      if (appState.filters.swingFrom === appState.filters.swingTo) {
        showStatus('Pick two different years to compare.', true);
      }
      bindFilterUi();
      applyFilters();
    });
    document.querySelectorAll('.swing-preset-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        appState.filters.swingFrom = parseInt(btn.getAttribute('data-from'), 10);
        appState.filters.swingTo = parseInt(btn.getAttribute('data-to'), 10);
        appState.filters.mapMode = 'swing';
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
      bindFilterUi();
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
      fetch('data/meta.json').then(function (r) { return r.json(); }),
      fetch('data/district-history/index.json').then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; })
    ]).then(function (parts) {
      houseData = parts[0];
      senateData = parts[1];
      districtsGeo = parts[2];
      statesTopo = parts[3];
      meta = parts[4];
      districtHistoryIndex = parts[5];
      buildIndexes();
      if (meta && $('footer-meta')) {
        var parts = [];
        if (meta.electionDbVersion) parts.push('Election DB v' + meta.electionDbVersion);
        if (meta.builtAt) parts.push('built ' + new Date(meta.builtAt).toLocaleString());
        parts.push('Polls: Phase 2');
        $('footer-meta').textContent = parts.join(' · ');
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
