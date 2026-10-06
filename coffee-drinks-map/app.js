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

  var coffeePlaces = [];
  var drinkPlaces = [];
  var hhRestaurants = [];
  var neighborhoods = [];
  var mapCoffee = null;
  var mapDrinks = null;
  var layerCoffee = null;
  var layerDrinks = null;

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

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.hidden = s.id !== id;
    });
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

  function hasCoords(p) {
    return typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng);
  }

  function appleMapsUrl(p, name) {
    if (!hasCoords(p)) return '';
    var pin = name || p.name || 'Place';
    return 'https://maps.apple.com/?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(pin);
  }

  function openDetail(place, kind) {
    var name = place.name || 'Place';
    document.getElementById('detail-name').textContent = name;
    var meta = [canonicalNeighborhood(place.neighborhood), place.address].filter(Boolean).join(' · ');
    document.getElementById('detail-meta').textContent = meta;
    var desc = place.description || place.hoursNote || '';
    if (kind === 'coffee' && !desc) desc = 'From the shared coffee catalog.';
    document.getElementById('detail-desc').textContent = desc;
    var links = document.getElementById('detail-links');
    links.innerHTML = '';
    var ig = place.instagram || place.instagramUrl;
    var web = place.hh_menu || place.website;
    if (web) {
      var a = document.createElement('a');
      a.href = web;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Website / menu';
      links.appendChild(a);
    }
    if (ig) {
      var b = document.createElement('a');
      b.href = ig;
      b.target = '_blank';
      b.rel = 'noopener';
      b.textContent = 'Instagram';
      links.appendChild(b);
    }
    var maps = document.getElementById('detail-maps');
    var mu = appleMapsUrl(place, name);
    if (mu) {
      maps.href = mu;
      maps.hidden = false;
    } else maps.hidden = true;
    document.getElementById('detail-overlay').hidden = false;
  }

  function closeDetail() {
    document.getElementById('detail-overlay').hidden = true;
  }

  function initMap(elId) {
    if (typeof PhillyWalkMap === 'undefined' || typeof L === 'undefined') return null;
    var map = L.map(elId, {
      zoomControl: true,
      maxZoom: 19,
      minZoom: PhillyWalkMap.minZoom,
      maxBounds: PhillyWalkMap.panLatLngBounds ? PhillyWalkMap.panLatLngBounds() : PhillyWalkMap.latLngBounds(),
      maxBoundsViscosity: PhillyWalkMap.maxBoundsViscosity != null ? PhillyWalkMap.maxBoundsViscosity : 0.85
    });
    PhillyWalkMap.addTiles(map);
    PhillyWalkMap.applyLimits(map);
    PhillyWalkMap.fit(map, [28, 28]);
    return map;
  }

  function makePin(lat, lng, color, onClick) {
    var m = L.circleMarker([lat, lng], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95
    });
    m.on('click', onClick);
    return m;
  }

  function renderCoffeeMap() {
    if (!mapCoffee) {
      mapCoffee = initMap('map-coffee');
      layerCoffee = L.layerGroup().addTo(mapCoffee);
    }
    layerCoffee.clearLayers();
    coffeePlaces.filter(hasCoords).forEach(function (p) {
      layerCoffee.addLayer(makePin(p.lat, p.lng, '#9a3412', function () {
        openDetail(p, 'coffee');
      }));
    });
    document.getElementById('coffee-sub').textContent = coffeePlaces.length + ' cafes · ' +
      coffeePlaces.filter(hasCoords).length + ' on map';
  }

  function renderDrinksMap() {
    if (!mapDrinks) {
      mapDrinks = initMap('map-drinks');
      layerDrinks = L.layerGroup().addTo(mapDrinks);
    }
    layerDrinks.clearLayers();
    drinkPlaces.filter(hasCoords).forEach(function (p) {
      var hasHh = p.schedule && Object.keys(p.schedule).length;
      layerDrinks.addLayer(makePin(p.lat, p.lng, hasHh ? '#15803d' : '#a8a29e', function () {
        openDetail(p, 'drinks');
      }));
    });
    var withHh = drinkPlaces.filter(function (p) { return p.schedule && Object.keys(p.schedule).length; }).length;
    document.getElementById('drinks-sub').textContent = drinkPlaces.length + ' places · ' +
      withHh + ' with HH times';
  }

  function renderCoffeeList() {
    var q = (document.getElementById('coffee-search').value || '').toLowerCase();
    var html = coffeePlaces
      .filter(function (p) {
        if (!q) return true;
        return (p.name + ' ' + (p.neighborhood || '') + ' ' + (p.address || '')).toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (p) {
        return '<button type="button" data-coffee-id="' + escapeHtml(p.id || p.name) + '">' +
          escapeHtml(p.name) + '<span class="meta">' + escapeHtml(p.neighborhood || p.address || '') + '</span></button>';
      }).join('');
    document.getElementById('coffee-list').innerHTML = html || '<p class="meta">No matches.</p>';
  }

  function renderDrinksList() {
    var q = (document.getElementById('drinks-search').value || '').toLowerCase();
    var html = drinkPlaces
      .filter(function (p) {
        if (!q) return true;
        return (p.name + ' ' + (p.neighborhood || '') + ' ' + (p.address || '')).toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (p) {
        return '<button type="button" data-drink-name="' + escapeHtml(p.name) + '">' +
          escapeHtml(p.name) + '<span class="meta">' + escapeHtml(p.neighborhood || '') + '</span></button>';
      }).join('');
    document.getElementById('drinks-list').innerHTML = html || '<p class="meta">No matches.</p>';
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
    for (var t = minT; t <= maxT; t += 30) {
      var opt = document.createElement('option');
      opt.value = String(t);
      opt.textContent = fmtMinutes(t);
      if (t === selected) opt.selected = true;
      timeSel.appendChild(opt);
    }
  }

  function getScheduleSearch() {
    return (document.getElementById('schedule-search').value || '').trim().toLowerCase();
  }

  function filteredForGrid(day) {
    var list = hhRestaurants.filter(function (r) { return r.schedule && r.schedule[day]; });
    if (nSel.value) list = list.filter(function (r) { return canonicalNeighborhood(r.neighborhood) === nSel.value; });
    var q = getScheduleSearch();
    if (q) {
      list = list.filter(function (r) {
        return (r.name + ' ' + (r.neighborhood || '') + ' ' + (r.address || '')).toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function renderGrid() {
    var day = daySel.value;
    var hhNow = document.getElementById('filter-hh-now').checked;
    var selectedTime = hhNow ? getNowSlot() : +timeSel.value;
    if (hhNow) {
      daySel.value = getTodayDayName();
      day = daySel.value;
      buildTimeOptions(day, selectedTime);
    }
    var filtered = filteredForGrid(day);
    filtered.sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!filtered.length) {
      document.querySelector('#grid thead').innerHTML = '';
      document.querySelector('#grid tbody').innerHTML = '<tr><td colspan="20">No places for these filters.</td></tr>';
      document.getElementById('summary').textContent = 'No places for these filters.';
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
    var summaryParts = [];
    if (hhNow) {
      summaryParts.push('<strong>' + activeNow.length + '</strong> with happy hour <strong>right now</strong>');
    } else {
      summaryParts.push('<strong>' + activeNow.length + '</strong> at <strong>' + fmtMinutes(selectedTime) + '</strong> on <strong>' + day + '</strong>');
    }
    if (nSel.value) summaryParts.push('in <strong>' + escapeHtml(nSel.value) + '</strong>');
    document.getElementById('summary').innerHTML = summaryParts.join(' · ') +
      (activeNow.length ? ': ' + activeNow.map(function (r) {
        return '<button type="button" class="rest-link" data-name="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</button>';
      }).join(', ') : '');
    document.querySelector('#grid thead').innerHTML = '<tr><th class="rest">Restaurant</th><th class="neigh">Neighborhood</th>' +
      slots.map(function (t) {
        var sel = t === selectedTime ? ' selected-col' : '';
        return '<th class="time-header' + sel + '" title="' + fmtMinutes(t) + '">' + fmtMinutesShort(t) + '</th>';
      }).join('') + '</tr>';
    document.querySelector('#grid tbody').innerHTML = filtered.map(function (r) {
      var cells = slots.map(function (t) {
        var active = isActive(r, day, t);
        var sel = t === selectedTime ? ' selected-col' : '';
        var cls = active ? (t === selectedTime ? 'active-now' : 'active') : 'inactive';
        return '<td class="slot ' + cls + sel + '"></td>';
      }).join('');
      return '<tr><td class="rest"><button type="button" class="rest-link" data-name="' + escapeHtml(r.name) + '">' +
        escapeHtml(r.name) + '</button></td><td class="neigh">' + escapeHtml(canonicalNeighborhood(r.neighborhood)) +
        '</td>' + cells + '</tr>';
    }).join('');
  }

  function rebuildNeighborhoods() {
    neighborhoods = [];
    drinkPlaces.forEach(function (p) {
      var n = canonicalNeighborhood(p.neighborhood);
      if (n && neighborhoods.indexOf(n) === -1) neighborhoods.push(n);
    });
    neighborhoods.sort();
    nSel.innerHTML = '<option value="">All neighborhoods</option>';
    neighborhoods.forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      nSel.appendChild(opt);
    });
  }

  function bootstrapCatalog() {
    drinkPlaces.forEach(function (p) {
      p.neighborhood = canonicalNeighborhood(p.neighborhood);
    });
    coffeePlaces.forEach(function (p) {
      p.neighborhood = canonicalNeighborhood(p.neighborhood);
    });
    hhRestaurants = drinkPlaces.filter(function (p) {
      return p.schedule && Object.keys(p.schedule).length;
    });
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
      coffeePlaces.length + ' coffees · ' + drinkPlaces.length + ' drinks (' + hhRestaurants.length + ' with HH times)';
  }

  function wireUi() {
    document.getElementById('pick-coffee').onclick = function () {
      showScreen('screen-coffee');
      setTimeout(function () {
        if (mapCoffee) mapCoffee.invalidateSize();
        renderCoffeeMap();
      }, 80);
    };
    document.getElementById('pick-drinks').onclick = function () {
      showScreen('screen-drinks');
      setTimeout(function () {
        if (mapDrinks) mapDrinks.invalidateSize();
        renderDrinksMap();
      }, 80);
    };
    document.getElementById('coffee-back').onclick = function () { showScreen('screen-home'); };
    document.getElementById('drinks-back').onclick = function () { showScreen('screen-home'); };
    document.getElementById('schedule-back').onclick = function () { showScreen('screen-drinks'); };
    document.getElementById('open-schedule').onclick = function () {
      showScreen('screen-schedule');
      renderGrid();
    };
    document.getElementById('detail-close').onclick = closeDetail;
    document.getElementById('detail-overlay').onclick = function (e) {
      if (e.target.id === 'detail-overlay') closeDetail();
    };

    document.querySelectorAll('[data-coffee-view]').forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll('[data-coffee-view]').forEach(function (b) { b.classList.toggle('on', b === btn); });
        var list = btn.getAttribute('data-coffee-view') === 'list';
        document.getElementById('coffee-list-panel').hidden = !list;
        if (list) renderCoffeeList();
        if (mapCoffee) setTimeout(function () { mapCoffee.invalidateSize(); }, 50);
      };
    });
    document.querySelectorAll('[data-drinks-view]').forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll('[data-drinks-view]').forEach(function (b) { b.classList.toggle('on', b === btn); });
        var list = btn.getAttribute('data-drinks-view') === 'list';
        document.getElementById('drinks-list-panel').hidden = !list;
        if (list) renderDrinksList();
        if (mapDrinks) setTimeout(function () { mapDrinks.invalidateSize(); }, 50);
      };
    });

    document.getElementById('coffee-search').oninput = renderCoffeeList;
    document.getElementById('drinks-search').oninput = renderDrinksList;
    document.getElementById('coffee-list').onclick = function (e) {
      var btn = e.target.closest('button[data-coffee-id]');
      if (!btn) return;
      var id = btn.getAttribute('data-coffee-id');
      var p = coffeePlaces.find(function (x) { return (x.id || x.name) === id; });
      if (p) openDetail(p, 'coffee');
    };
    document.getElementById('drinks-list').onclick = function (e) {
      var btn = e.target.closest('button[data-drink-name]');
      if (!btn) return;
      var name = btn.getAttribute('data-drink-name');
      var p = drinkPlaces.find(function (x) { return x.name === name; });
      if (p) openDetail(p, 'drinks');
    };

    daySel.addEventListener('change', function () {
      buildTimeOptions(daySel.value, getNowSlot());
      renderGrid();
    });
    timeSel.addEventListener('change', renderGrid);
    nSel.addEventListener('change', renderGrid);
    document.getElementById('schedule-search').addEventListener('input', renderGrid);
    document.getElementById('filter-hh-now').addEventListener('change', function () {
      if (document.getElementById('filter-hh-now').checked) {
        daySel.value = getTodayDayName();
        buildTimeOptions(daySel.value, getNowSlot());
      }
      renderGrid();
    });
    document.querySelector('#grid tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('.rest-link');
      if (!btn) return;
      var name = btn.getAttribute('data-name');
      var p = drinkPlaces.find(function (x) { return x.name === name; });
      if (p) openDetail(p, 'drinks');
    });
    document.getElementById('summary').addEventListener('click', function (e) {
      var btn = e.target.closest('.rest-link');
      if (!btn) return;
      var name = btn.getAttribute('data-name');
      var p = drinkPlaces.find(function (x) { return x.name === name; });
      if (p) openDetail(p, 'drinks');
    });

    function wireHere(btnId, getMap) {
      var btn = document.getElementById(btnId);
      if (!btn || !PhillyWalkMap || !PhillyWalkMap.locateOnce) return;
      btn.onclick = function () {
        var map = getMap();
        if (!map) return;
        PhillyWalkMap.locateOnce(function (fix) {
          if (!PhillyWalkMap.contains(fix.lat, fix.lng)) {
            toast('Outside Philadelphia map area.');
            return;
          }
          map.panTo([fix.lat, fix.lng]);
        }, function () { toast('Could not get location.'); });
      };
    }
    wireHere('here-coffee', function () { return mapCoffee; });
    wireHere('here-drinks', function () { return mapDrinks; });
  }

  function loadCatalog() {
    return Promise.all([
      fetch('coffee.json?v=1').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('drinks.json?v=1').then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (pair) {
      coffeePlaces = Array.isArray(pair[0]) ? pair[0] : [];
      drinkPlaces = Array.isArray(pair[1]) ? pair[1] : [];
      bootstrapCatalog();
      wireUi();
    }).catch(function () {
      toast('Could not load catalog.');
    });
  }

  document.addEventListener('DOMContentLoaded', loadCatalog);
})();
