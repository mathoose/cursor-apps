(function () {
  'use strict';

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var NEIGHBORHOOD_ALIASES = {
    'Midtown Village': 'Midtown',
    'Washington Square West': 'Midtown',
    'Logan Square': 'Fairmount',
    'Society Hill': 'Old City',
    "Penn's Landing": 'Old City',
    'South Street': 'Queen Village',
    'Passyunk Square': 'East Passyunk',
    'South Philadelphia': 'South Philly',
    'Center City West': 'Center City'
  };
  var HERE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
  var COLOR_COFFEE = '#c2410c';
  var COLOR_HH = '#43a047';
  var COLOR_BAR = '#78716c';
  var COLOR_FOOD = '#0f766e';
  var DAY_SHORT = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };

  var coffeePlaces = [];
  var drinkPlaces = [];
  var foodPlaces = [];
  var hhRestaurants = [];
  var modes = {};

  var daySel = document.getElementById('day');
  var timeSel = document.getElementById('time');
  var nSel = document.getElementById('neighborhood');

  function canonicalNeighborhood(n) {
    n = String(n || '').trim();
    return NEIGHBORHOOD_ALIASES[n] || n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.hidden = s.id !== id;
    });
    var screen = document.getElementById(id);
    document.body.classList.toggle('on-map', !!(screen && screen.classList.contains('screen-map')));
    window.scrollTo(0, 0);
  }

  /* apps-shell inserts the version footer after the first <main>, which lives inside a hidden screen. */
  function hoistVersionFooter() {
    var footer = document.querySelector('.app-version-footer');
    if (footer && footer.parentNode !== document.body) document.body.appendChild(footer);
    return !!footer;
  }
  if (!hoistVersionFooter() && typeof MutationObserver !== 'undefined') {
    var footerObserver = new MutationObserver(function () {
      if (hoistVersionFooter()) footerObserver.disconnect();
    });
    footerObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function parseTime(t) {
    if (!t) return NaN;
    var m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!m) return NaN;
    var h = +m[1];
    var min = m[2] ? +m[2] : 0;
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function fmtMinutes(m) {
    var h = Math.floor(m / 60);
    var min = m % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + String(min).padStart(2, '0') + ' ' + ap;
  }

  function fmtMinutesShort(m) {
    var h = Math.floor(m / 60);
    var min = m % 60;
    var ap = h >= 12 ? 'p' : 'a';
    var h12 = h % 12 || 12;
    return min ? h12 + ':' + String(min).padStart(2, '0') + ap : h12 + ap;
  }

  function getTodayDayName() {
    return DAY_NAMES[new Date().getDay()];
  }

  function roundToSlot(m) {
    return Math.floor(m / 30) * 30;
  }

  function getNowSlot() {
    var d = new Date();
    return roundToSlot(d.getHours() * 60 + d.getMinutes());
  }

  function isActive(r, day, slot) {
    var s = r.schedule && r.schedule[day];
    if (!s) return false;
    return parseTime(s.start) <= slot && slot < parseTime(s.end);
  }

  function hasSchedule(p) {
    return !!(p.schedule && Object.keys(p.schedule).length);
  }

  function hhNow(p) {
    var d = new Date();
    return isActive(p, getTodayDayName(), d.getHours() * 60 + d.getMinutes());
  }

  function hasCoords(p) {
    return typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng);
  }

  function parseTime12(s) {
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function isOpenNowHours(hours) {
    if (!hours || typeof hours !== 'object') return false;
    var today = hours[getTodayDayName()];
    if (!today || !today.open || !today.close) return false;
    var start = parseTime12(today.open);
    var end = parseTime12(today.close);
    if (start == null || end == null) return false;
    var d = new Date();
    var now = d.getHours() * 60 + d.getMinutes();
    if (end <= start) return now >= start || now < end;
    return now >= start && now < end;
  }

  function renderHoursBlock(hours) {
    var el = document.getElementById('detail-hours');
    el.innerHTML = '';
    if (!hours || typeof hours !== 'object') {
      el.hidden = true;
      return;
    }
    var hasAny = DAY_NAMES.some(function (d) {
      var h = hours[d];
      return h && h.open && h.close;
    });
    if (!hasAny) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var todayName = getTodayDayName();
    var todayH = hours[todayName];
    var todayRow = document.createElement('div');
    todayRow.className = 'hours-today' + (isOpenNowHours(hours) ? ' on' : '');
    if (todayH && todayH.open && todayH.close) {
      todayRow.innerHTML =
        '<span class="hours-today-label">Today</span>' +
        '<span class="hours-today-time">' + todayH.open + ' – ' + todayH.close + '</span>' +
        (isOpenNowHours(hours) ? '<span class="hours-today-badge">Open now</span>' : '');
    } else {
      todayRow.innerHTML =
        '<span class="hours-today-label">Today</span>' +
        '<span class="hours-today-closed">Closed</span>';
    }
    el.appendChild(todayRow);
    var list = document.createElement('ul');
    list.className = 'hours-list';
    DAY_NAMES.forEach(function (d) {
      var h = hours[d];
      var li = document.createElement('li');
      li.className = 'hours-row' + (d === todayName ? ' is-today' : '');
      var day = document.createElement('span');
      day.className = 'hours-day';
      day.textContent = DAY_SHORT[d] || d;
      var time = document.createElement('span');
      time.className = 'hours-time';
      if (h && h.open && h.close) {
        time.textContent = h.open + ' – ' + h.close;
      } else {
        time.textContent = 'Closed';
        time.classList.add('closed');
      }
      li.appendChild(day);
      li.appendChild(time);
      list.appendChild(li);
    });
    el.appendChild(list);
  }

  function matchesMeal(p, mealFilter) {
    if (!mealFilter || mealFilter === 'all') return true;
    var m = p.meal || 'both';
    return m === 'both' || m === mealFilter;
  }

  function appleMapsUrl(p, name) {
    var pin = name || p.name || 'Place';
    if (hasCoords(p)) {
      return 'https://maps.apple.com/?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(pin);
    }
    if (p.address) return 'https://maps.apple.com/?q=' + encodeURIComponent(pin + ' ' + p.address);
    return '';
  }

  function openDetail(place, kind) {
    var name = place.name || 'Place';
    document.getElementById('detail-name').textContent = name;
    var meta = [canonicalNeighborhood(place.neighborhood), place.address].filter(Boolean).join(' · ');
    document.getElementById('detail-meta').textContent = meta;
    var hhEl = document.getElementById('detail-hh');
    if (kind === 'drinks' && hasSchedule(place)) {
      var today = place.schedule[getTodayDayName()];
      var line = today
        ? 'Happy hour today: ' + today.start + ' – ' + today.end + (hhNow(place) ? ' · on now' : '')
        : 'No happy hour today';
      hhEl.textContent = line;
      hhEl.classList.toggle('on', hhNow(place));
      hhEl.hidden = false;
    } else {
      hhEl.hidden = true;
    }
    renderHoursBlock(place.hours);
    var desc = place.description || place.hoursNote || '';
    document.getElementById('detail-desc').textContent = desc;
    var links = document.getElementById('detail-links');
    links.innerHTML = '';
    var ig = place.instagram || place.instagramUrl;
    var web = place.hh_menu || place.website;
    [[web, kind === 'drinks' && place.hh_menu ? 'Menu' : 'Website'], [ig, 'Instagram']].forEach(function (pair) {
      if (!pair[0]) return;
      var a = document.createElement('a');
      a.href = pair[0];
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = pair[1];
      links.appendChild(a);
    });
    var maps = document.getElementById('detail-maps');
    var mu = appleMapsUrl(place, name);
    maps.hidden = !mu;
    if (mu) maps.href = mu;
    document.getElementById('detail-overlay').hidden = false;
    document.body.classList.add('sheet-open');
  }

  function closeDetail() {
    document.getElementById('detail-overlay').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function walkMinutesTo(here, p) {
    if (!here || !here.active || !hasCoords(p)) return null;
    var m = PhillyWalkMap.haversineMeters(here.lat, here.lng, p.lat, p.lng);
    return Math.max(1, Math.round(m / PhillyWalkMap.WALK_M_PER_MIN));
  }

  /* One controller per map screen (coffee / drinks / food). */
  function createMode(cfg) {
    var root = document.getElementById(cfg.screenId);
    var q = function (sel) { return root.querySelector(sel); };
    var mode = {
      cfg: cfg,
      root: root,
      map: null,
      layer: null,
      here: null,
      view: 'map',
      mealFilter: 'all'
    };

    function places() {
      var list = cfg.getPlaces();
      if (cfg.kind !== 'food') return list;
      return list.filter(function (p) { return matchesMeal(p, mode.mealFilter); });
    }

    function hereActive() {
      return !!(mode.here && mode.here.isActive());
    }

    function ensureMap() {
      if (mode.map || typeof L === 'undefined' || typeof PhillyWalkMap === 'undefined') return;
      mode.map = L.map(cfg.mapId, {
        zoomControl: false,
        attributionControl: true,
        minZoom: PhillyWalkMap.minZoom,
        maxZoom: 19,
        maxBounds: PhillyWalkMap.panLatLngBounds(),
        maxBoundsViscosity: PhillyWalkMap.maxBoundsViscosity
      }).setView([PhillyWalkMap.center.lat, PhillyWalkMap.center.lng], PhillyWalkMap.defaultZoom);
      PhillyWalkMap.addTiles(mode.map);
      PhillyWalkMap.applyLimits(mode.map);
      PhillyWalkMap.ensurePinPane(mode.map);
      PhillyWalkMap.bindZoomLabels(mode.map);
      L.control.zoom({ position: 'bottomleft' }).addTo(mode.map);
      mode.layer = L.layerGroup().addTo(mode.map);
      mode.here = PhillyWalkMap.attachHereControl(mode.map, {
        onChange: updateHereUi,
        onError: function (msg) { toast(msg); }
      });
    }

    function renderPins() {
      if (!mode.layer) return;
      mode.layer.clearLayers();
      var active = hereActive();
      places().filter(hasCoords).forEach(function (p) {
        var dim = active && !mode.here.isWithin(p.lat, p.lng);
        var pin = PhillyWalkMap.addCirclePin([p.lat, p.lng], {
          fillColor: cfg.pinColor(p),
          dim: dim,
          label: p.name,
          labelInteractive: true,
          onClick: function () { openDetail(p, cfg.kind); }
        });
        if (pin) mode.layer.addLayer(pin);
      });
    }

    function updateSub() {
      q('[data-sub]').textContent = cfg.subtitle(places());
    }

    function updateHereUi(state) {
      var btn = q('[data-here-btn]');
      var bar = q('[data-here-bar]');
      btn.disabled = !!(state && state.locating);
      btn.innerHTML = HERE_ICON + '<span>' + (state && state.locating ? 'Locating…' : 'Where am I') + '</span>';
      if (!state || !state.active) {
        bar.hidden = true;
        root.classList.remove('here-open');
      } else {
        bar.hidden = false;
        root.classList.add('here-open');
        var slider = q('[data-here-slider]');
        if (Number(slider.value) !== state.minutes) slider.value = String(state.minutes);
        q('[data-here-label]').textContent = PhillyWalkMap.formatWalkLabel(state.minutes);
        q('[data-here-minutes]').textContent = state.minutes + ' min';
        var n = mode.here.countWithin(places());
        q('[data-here-count]').textContent = n + ' place' + (n === 1 ? '' : 's') + ' inside this walk';
      }
      renderPins();
      if (mode.view === 'list') renderList();
    }

    function renderList() {
      var search = (q('[data-search]').value || '').trim().toLowerCase();
      var here = mode.here ? mode.here.getState() : null;
      var active = hereActive();
      var list = places().filter(function (p) {
        if (active && (!hasCoords(p) || !mode.here.isWithin(p.lat, p.lng))) return false;
        if (!search) return true;
        return (p.name + ' ' + (p.neighborhood || '') + ' ' + (p.address || '')).toLowerCase().indexOf(search) >= 0;
      });
      if (active) {
        list.forEach(function (p) { p._walk = walkMinutesTo(here, p); });
        list.sort(function (a, b) { return a._walk - b._walk || a.name.localeCompare(b.name); });
      } else {
        list.sort(function (a, b) { return a.name.localeCompare(b.name); });
      }
      var note = q('[data-list-note]');
      if (active) {
        note.hidden = false;
        note.innerHTML = 'Showing <strong>' + list.length + '</strong> inside your ' + here.minutes +
          ' min walk · <button type="button" class="text-btn" data-list-clear>Show all</button>';
      } else {
        note.hidden = true;
        note.innerHTML = '';
      }
      var listEl = q('[data-list]');
      if (!list.length) {
        listEl.innerHTML = '<p class="empty-state">' +
          (active ? 'Nothing inside this walk. Try a longer walk on the map.' : 'No matches.') + '</p>';
        return;
      }
      listEl.innerHTML = list.map(function (p, i) {
        var metaParts = [];
        if (active && p._walk != null) metaParts.push(p._walk + ' min walk');
        var hood = canonicalNeighborhood(p.neighborhood);
        if (hood) metaParts.push(hood);
        else if (p.address) metaParts.push(p.address);
        var badge = cfg.badge ? cfg.badge(p) : '';
        return '<button type="button" class="place-card" data-idx="' + i + '">' +
          '<span class="name"><span class="dot" style="background:' + cfg.pinColor(p) + '"></span>' +
          '<span class="name-text">' + escapeHtml(p.name) + '</span>' + badge + '</span>' +
          (metaParts.length ? '<span class="meta">' + escapeHtml(metaParts.join(' · ')) + '</span>' : '') +
          '</button>';
      }).join('');
      mode.lastList = list;
    }

    function setView(view) {
      mode.view = view;
      root.classList.toggle('view-list', view === 'list');
      q('[data-list-view]').hidden = view !== 'list';
      root.querySelectorAll('.nav-btn').forEach(function (b) {
        var on = b.getAttribute('data-view') === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (view === 'list') {
        renderList();
        q('[data-list-view]').scrollTop = 0;
      } else if (mode.map) {
        setTimeout(function () { mode.map.invalidateSize(); }, 30);
      }
    }

    function show() {
      showScreen(cfg.screenId);
      var first = !mode.map;
      ensureMap();
      if (!mode.map) return;
      mode.map.invalidateSize();
      if (first) {
        PhillyWalkMap.fit(mode.map, [28, 28]);
        renderPins();
      }
      updateSub();
      if (mode.view === 'list') renderList();
    }

    root.querySelector('[data-back]').addEventListener('click', function () { showScreen('screen-home'); });
    root.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    q('[data-here-btn]').addEventListener('click', function () {
      if (!mode.here) {
        toast('Location helper failed to load');
        return;
      }
      mode.here.locate();
    });
    q('[data-here-clear]').addEventListener('click', function () { if (mode.here) mode.here.clear(); });
    q('[data-here-slider]').addEventListener('input', function (e) {
      if (mode.here) mode.here.setMinutes(e.target.value);
    });
    q('[data-search]').addEventListener('input', renderList);
    var chips = q('[data-meal-chips]');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-meal]');
        if (!btn) return;
        mode.mealFilter = btn.getAttribute('data-meal') || 'all';
        chips.querySelectorAll('[data-meal]').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        updateSub();
        renderPins();
        if (mode.view === 'list') renderList();
      });
    }
    q('[data-list]').addEventListener('click', function (e) {
      var card = e.target.closest('.place-card');
      if (!card || !mode.lastList) return;
      var p = mode.lastList[+card.getAttribute('data-idx')];
      if (p) openDetail(p, cfg.kind);
    });
    q('[data-list-note]').addEventListener('click', function (e) {
      if (e.target.closest('[data-list-clear]') && mode.here) mode.here.clear();
    });

    mode.show = show;
    return mode;
  }

  function buildTimeOptions(day, selected) {
    timeSel.innerHTML = '';
    var list = hhRestaurants.filter(function (r) { return r.schedule && r.schedule[day]; });
    var minT = Infinity;
    var maxT = -Infinity;
    list.forEach(function (r) {
      var s = r.schedule[day];
      minT = Math.min(minT, parseTime(s.start));
      maxT = Math.max(maxT, parseTime(s.end));
    });
    if (!isFinite(minT)) {
      minT = 16 * 60;
      maxT = 20 * 60;
    }
    minT = Math.floor(minT / 30) * 30;
    maxT = Math.ceil(maxT / 30) * 30;
    var matched = false;
    for (var t = minT; t <= maxT; t += 30) {
      var opt = document.createElement('option');
      opt.value = String(t);
      opt.textContent = fmtMinutes(t);
      if (t === selected) {
        opt.selected = true;
        matched = true;
      }
      timeSel.appendChild(opt);
    }
    if (!matched && selected != null && isFinite(selected)) {
      var extra = document.createElement('option');
      extra.value = String(selected);
      extra.textContent = fmtMinutes(selected);
      extra.selected = true;
      timeSel.insertBefore(extra, selected < minT ? timeSel.firstChild : null);
    }
  }

  function filteredForGrid(day) {
    var list = hhRestaurants.filter(function (r) { return r.schedule && r.schedule[day]; });
    if (nSel.value) list = list.filter(function (r) { return canonicalNeighborhood(r.neighborhood) === nSel.value; });
    var q = (document.getElementById('schedule-search').value || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (r) {
        return (r.name + ' ' + (r.neighborhood || '') + ' ' + (r.address || '')).toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function renderGrid() {
    var nowMode = document.getElementById('filter-hh-now').checked;
    var selectedTime = nowMode ? getNowSlot() : +timeSel.value;
    if (nowMode) {
      daySel.value = getTodayDayName();
      buildTimeOptions(daySel.value, selectedTime);
    }
    var day = daySel.value;
    var filtered = filteredForGrid(day);
    filtered.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var thead = document.querySelector('#grid thead');
    var tbody = document.querySelector('#grid tbody');
    if (!filtered.length) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      document.getElementById('summary').textContent = 'No happy hours for these filters.';
      return;
    }
    var minT = Infinity;
    var maxT = -Infinity;
    filtered.forEach(function (r) {
      var s = r.schedule[day];
      minT = Math.min(minT, parseTime(s.start));
      maxT = Math.max(maxT, parseTime(s.end));
    });
    minT = Math.floor(minT / 30) * 30;
    maxT = Math.ceil(maxT / 30) * 30;
    var slots = [];
    for (var t = minT; t < maxT; t += 30) slots.push(t);
    var activeNow = filtered.filter(function (r) { return isActive(r, day, selectedTime); });
    var head = nowMode
      ? '<strong>' + activeNow.length + '</strong> with happy hour <strong>right now</strong>'
      : '<strong>' + activeNow.length + '</strong> active at <strong>' + fmtMinutes(selectedTime) + '</strong> on <strong>' + day + '</strong>';
    if (nSel.value) head += ' in <strong>' + escapeHtml(nSel.value) + '</strong>';
    document.getElementById('summary').innerHTML = head +
      (activeNow.length ? ': ' + activeNow.map(function (r) {
        return '<button type="button" class="rest-link" data-name="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</button>';
      }).join(', ') : '');
    thead.innerHTML = '<tr><th class="rest">Place</th><th class="neigh">Neighborhood</th>' +
      slots.map(function (s) {
        var sel = s === selectedTime ? ' selected-col' : '';
        return '<th class="time-header' + sel + '" title="' + fmtMinutes(s) + '">' + fmtMinutesShort(s) + '</th>';
      }).join('') + '</tr>';
    tbody.innerHTML = filtered.map(function (r) {
      var cells = slots.map(function (s) {
        var active = isActive(r, day, s);
        var sel = s === selectedTime ? ' selected-col' : '';
        var cls = active ? (s === selectedTime ? 'active-now' : 'active') : 'inactive';
        return '<td class="slot ' + cls + sel + '"></td>';
      }).join('');
      return '<tr><td class="rest"><button type="button" class="rest-link" data-name="' + escapeHtml(r.name) + '">' +
        escapeHtml(r.name) + '</button></td><td class="neigh">' + escapeHtml(canonicalNeighborhood(r.neighborhood)) +
        '</td>' + cells + '</tr>';
    }).join('');
  }

  function rebuildNeighborhoods() {
    var seen = {};
    hhRestaurants.forEach(function (p) {
      var n = canonicalNeighborhood(p.neighborhood);
      if (n) seen[n] = true;
    });
    nSel.innerHTML = '<option value="">All neighborhoods</option>';
    Object.keys(seen).sort().forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      nSel.appendChild(opt);
    });
  }

  function bootstrapCatalog() {
    drinkPlaces.forEach(function (p) { p.neighborhood = canonicalNeighborhood(p.neighborhood); });
    coffeePlaces.forEach(function (p) { p.neighborhood = canonicalNeighborhood(p.neighborhood); });
    foodPlaces.forEach(function (p) { p.neighborhood = canonicalNeighborhood(p.neighborhood); });
    hhRestaurants = drinkPlaces.filter(hasSchedule);
    rebuildNeighborhoods();
    DAY_NAMES.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      daySel.appendChild(opt);
    });
    daySel.value = getTodayDayName();
    buildTimeOptions(daySel.value, getNowSlot());
    document.getElementById('home-status').textContent =
      coffeePlaces.length + ' coffee shops · ' + drinkPlaces.length + ' bars (' +
      hhRestaurants.length + ' with happy hours) · ' + foodPlaces.length + ' restaurants';
  }

  function openDrinkByName(name) {
    var p = drinkPlaces.find(function (x) { return x.name === name; });
    if (p) openDetail(p, 'drinks');
  }

  function wireUi() {
    modes.coffee = createMode({
      kind: 'coffee',
      screenId: 'screen-coffee',
      mapId: 'map-coffee',
      getPlaces: function () { return coffeePlaces; },
      pinColor: function () { return COLOR_COFFEE; },
      subtitle: function (list) {
        return list.length + ' coffee shops';
      }
    });
    modes.drinks = createMode({
      kind: 'drinks',
      screenId: 'screen-drinks',
      mapId: 'map-drinks',
      getPlaces: function () { return drinkPlaces; },
      pinColor: function (p) { return hasSchedule(p) ? COLOR_HH : COLOR_BAR; },
      badge: function (p) {
        if (!hasSchedule(p)) return '';
        return hhNow(p) ? '<span class="hh-pill on">HH now</span>' : '<span class="hh-pill">HH</span>';
      },
      subtitle: function (list) {
        var withHh = list.filter(hasSchedule).length;
        return list.length + ' bars · ' + withHh + ' with happy hours';
      }
    });
    modes.food = createMode({
      kind: 'food',
      screenId: 'screen-food',
      mapId: 'map-food',
      getPlaces: function () { return foodPlaces; },
      pinColor: function () { return COLOR_FOOD; },
      badge: function (p) {
        if (p.meal === 'lunch') return '<span class="meal-pill lunch">Lunch</span>';
        if (p.meal === 'dinner') return '<span class="meal-pill dinner">Dinner</span>';
        return '';
      },
      subtitle: function (list) {
        return list.length + ' restaurants';
      }
    });

    document.getElementById('pick-coffee').addEventListener('click', function () { modes.coffee.show(); });
    document.getElementById('pick-drinks').addEventListener('click', function () { modes.drinks.show(); });
    document.getElementById('pick-food').addEventListener('click', function () { modes.food.show(); });
    document.getElementById('schedule-back').addEventListener('click', function () { modes.drinks.show(); });
    document.getElementById('open-schedule').addEventListener('click', function () {
      showScreen('screen-schedule');
      renderGrid();
    });
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.getElementById('detail-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'detail-overlay') closeDetail();
    });

    var hhNowEl = document.getElementById('filter-hh-now');
    daySel.addEventListener('change', function () {
      hhNowEl.checked = false;
      buildTimeOptions(daySel.value, +timeSel.value);
      renderGrid();
    });
    timeSel.addEventListener('change', function () {
      hhNowEl.checked = false;
      renderGrid();
    });
    nSel.addEventListener('change', renderGrid);
    document.getElementById('schedule-search').addEventListener('input', renderGrid);
    hhNowEl.addEventListener('change', renderGrid);
    ['grid', 'summary'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function (e) {
        var btn = e.target.closest('.rest-link');
        if (btn) openDrinkByName(btn.getAttribute('data-name'));
      });
    });
  }

  function loadCatalog() {
    return Promise.all([
      fetch('coffee.json?v=1').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('drinks.json?v=6').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('food.json?v=7').then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (triple) {
      coffeePlaces = Array.isArray(triple[0]) ? triple[0] : [];
      drinkPlaces = Array.isArray(triple[1]) ? triple[1] : [];
      foodPlaces = Array.isArray(triple[2]) ? triple[2] : [];
      bootstrapCatalog();
      wireUi();
    }).catch(function () {
      toast('Could not load catalog.');
    });
  }

  document.addEventListener('DOMContentLoaded', loadCatalog);
})();
