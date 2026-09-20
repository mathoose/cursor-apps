(function () {
  'use strict';

  var STORAGE_KEY = 'coffee-map-v1';
  var APP_ID = 'coffee-map';
  var PHILLY = { lat: 39.9526, lng: -75.1652 };
  var PHOTON_URL = 'https://photon.komoot.io/api/';
  var MICROLINK_URL = 'https://api.microlink.io/';

  var map = null;
  var placesLayer = null;
  var candidatesLayer = null;
  var dropMarker = null;
  var toastTimer = null;
  var activePlaceId = null;
  var droppedPin = null;
  var hereControl = null;
  var sortBeforeDistance = 'name';
  var pendingDistanceSort = false;
  var ui = {
    view: 'map',
    filter: 'all',
    sort: 'name'
  };

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var seedPlaces = [];
  var seedLoaded = false;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return { version: 1, places: [], hiddenSeedIds: [] };
  }

  function clampRating(n) {
    if (n == null || n === '') return null;
    n = Number(n);
    if (!n || n < 1) return null;
    if (n > 5) return 5;
    return Math.round(n);
  }

  function normalizeHours(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var out = {};
    var i;
    var any = false;
    for (i = 0; i < DAY_NAMES.length; i++) {
      var day = DAY_NAMES[i];
      var slot = raw[day];
      if (!slot || typeof slot !== 'object') continue;
      any = true;
      if (slot.closed) {
        out[day] = { closed: true };
        continue;
      }
      var row = {
        open: String(slot.open || '').trim(),
        close: String(slot.close || '').trim()
      };
      if (slot.open2 && slot.close2) {
        row.open2 = String(slot.open2).trim();
        row.close2 = String(slot.close2).trim();
      }
      if (row.open && row.close) out[day] = row;
    }
    return any ? out : null;
  }

  function normalizePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var lat = Number(raw.lat);
    var lng = Number(raw.lng);
    var name = String(raw.name || '').trim();
    if (!name || !isFinite(lat) || !isFinite(lng)) return null;
    var status = raw.status === 'been' ? 'been' : 'want';
    return {
      id: raw.id || uid(),
      name: name,
      lat: lat,
      lng: lng,
      address: String(raw.address || '').trim(),
      neighborhood: String(raw.neighborhood || '').trim(),
      website: String(raw.website || '').trim(),
      instagramUrl: String(raw.instagramUrl || '').trim(),
      hours: normalizeHours(raw.hours),
      hoursNote: String(raw.hoursNote || '').trim(),
      hoursSource: String(raw.hoursSource || '').trim(),
      seeded: !!raw.seeded,
      status: status,
      rating: clampRating(raw.rating),
      notes: String(raw.notes || '').trim(),
      addedAt: raw.addedAt || new Date().toISOString(),
      visitedAt: raw.visitedAt || (status === 'been' ? new Date().toISOString() : null)
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : defaultData();
    var places = Array.isArray(data.places) ? data.places : [];
    var hidden = Array.isArray(data.hiddenSeedIds) ? data.hiddenSeedIds : [];
    return {
      version: 1,
      places: places.map(normalizePlace).filter(Boolean),
      hiddenSeedIds: hidden.map(function (id) { return String(id); }).filter(Boolean)
    };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  }

  function mergePlaces(existing, incoming) {
    if (!incoming) return existing || defaultData();
    if (!existing) return normalizeData(incoming);
    var out = normalizeData(existing);
    var ids = {};
    out.places.forEach(function (p) {
      ids[p.id] = true;
    });
    (incoming.places || []).forEach(function (raw) {
      var p = normalizePlace(raw);
      if (!p) return;
      if (ids[p.id]) return;
      out.places.push(p);
      ids[p.id] = true;
    });
    var hidden = {};
    out.hiddenSeedIds.forEach(function (id) { hidden[id] = true; });
    (incoming.hiddenSeedIds || []).forEach(function (id) {
      if (id && !hidden[id]) {
        out.hiddenSeedIds.push(String(id));
        hidden[id] = true;
      }
    });
    return out;
  }

  function nameKey(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '')
      .replace(/(coffee|cafe|cafes|roasters|roastery|labs|lab)/g, '');
  }

  function namesFuzzy(a, b) {
    var x = nameKey(a);
    var y = nameKey(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
  }

  function isNear(a, b) {
    if (!a || !b) return false;
    var dlat = a.lat - b.lat;
    var dlng = a.lng - b.lng;
    return (dlat * dlat + dlng * dlng) < 0.00000064;
  }

  function applySeedCatalog(dest, seed) {
    dest.name = seed.name;
    dest.lat = seed.lat;
    dest.lng = seed.lng;
    dest.address = seed.address || dest.address;
    dest.neighborhood = seed.neighborhood || dest.neighborhood;
    dest.website = seed.website || '';
    dest.instagramUrl = seed.instagramUrl || dest.instagramUrl || '';
    dest.hours = seed.hours;
    dest.hoursNote = seed.hoursNote || '';
    dest.hoursSource = seed.hoursSource || '';
    dest.seeded = true;
    dest.id = seed.id;
  }

  function mergeSeedIntoData(data, seeds) {
    data = normalizeData(data);
    var hidden = {};
    data.hiddenSeedIds.forEach(function (id) { hidden[id] = true; });
    var byId = {};
    data.places.forEach(function (p) { byId[p.id] = p; });
    seeds.forEach(function (raw) {
      var seed = normalizePlace(Object.assign({}, raw, { seeded: true, status: 'want' }));
      if (!seed || hidden[seed.id]) return;
      if (typeof PhillyWalkMap !== 'undefined' && !PhillyWalkMap.contains(seed.lat, seed.lng)) return;
      var existing = byId[seed.id];
      if (!existing) {
        existing = data.places.filter(function (p) {
          return isNear(p, seed) && namesFuzzy(p.name, seed.name);
        })[0];
      }
      if (existing) {
        var oldId = existing.id;
        applySeedCatalog(existing, seed);
        if (oldId !== seed.id) {
          delete byId[oldId];
          byId[seed.id] = existing;
        }
      } else {
        data.places.push(seed);
        byId[seed.id] = seed;
      }
    });
    if (typeof PhillyWalkMap !== 'undefined') {
      data.places = data.places.filter(function (p) {
        if (!p.seeded) return true;
        return PhillyWalkMap.contains(p.lat, p.lng);
      });
    }
    return data;
  }

  function parseClock(s) {
    var m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2] || 0);
    var ap = m[3].toUpperCase();
    if (h === 12) h = 0;
    if (ap === 'PM') h += 12;
    return h * 60 + min;
  }

  function inSlot(mins, open, close) {
    var o = parseClock(open);
    var c = parseClock(close);
    if (o == null || c == null) return false;
    if (c <= o) return mins >= o || mins < c;
    return mins >= o && mins < c;
  }

  function isOpenNow(place, date) {
    if (!place || !place.hours) return null;
    date = date || new Date();
    var slot = place.hours[DAY_NAMES[date.getDay()]];
    if (!slot || slot.closed) return false;
    var mins = date.getHours() * 60 + date.getMinutes();
    if (slot.open && inSlot(mins, slot.open, slot.close)) return true;
    if (slot.open2 && inSlot(mins, slot.open2, slot.close2)) return true;
    return false;
  }

  function loadSeed() {
    return fetch('places.json?v=4')
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (list) {
        seedPlaces = Array.isArray(list) ? list : [];
        seedLoaded = true;
        if (!seedPlaces.length) return;
        var merged = mergeSeedIntoData(loadData(), seedPlaces);
        saveData(merged);
      });
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
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2800);
  }

  function setAddStatus(msg) {
    var el = document.getElementById('addStatus');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 400);
  }

  function isInstagramUrl(raw) {
    try {
      var u = new URL(String(raw || '').trim());
      var host = u.hostname.replace(/^www\./i, '').replace(/^m\./i, '');
      return host === 'instagram.com' || host === 'instagr.am';
    } catch (e) {
      return false;
    }
  }

  function normalizeInstagramUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) {
      if (/instagram\.com|instagr\.am/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
      else return '';
    }
    if (!isInstagramUrl(s)) return '';
    try {
      var u = new URL(s);
      u.hash = '';
      var path = u.pathname.replace(/\/+$/, '') + '/';
      return u.origin.replace(/instagr\.am/i, 'www.instagram.com') + path;
    } catch (e) {
      return s;
    }
  }

  function parseInstagramUrl(raw) {
    var url = normalizeInstagramUrl(raw);
    if (!url) return null;
    var path = '';
    try { path = new URL(url).pathname; } catch (e) { return { url: url }; }
    var loc = path.match(/\/explore\/locations\/(\d+)\/([^/]+)/i);
    if (loc) {
      return { url: url, locationId: loc[1], locationSlug: decodeURIComponent(loc[2]) };
    }
    var post = path.match(/\/(p|reel|reels|tv)\/([^/]+)/i);
    if (post) {
      return { url: url, isPost: true, shortcode: post[2] };
    }
    var profile = path.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
    if (profile && !/^(p|reel|reels|stories|explore|accounts|tv)$/i.test(profile[1])) {
      return { url: url, profile: profile[1] };
    }
    return { url: url, isPost: true };
  }

  function normIgKey(url) {
    return normalizeInstagramUrl(url).toLowerCase();
  }

  function humanizeHandle(handle) {
    return String(handle || '')
      .replace(/^@/, '')
      .replace(/[._]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  function guessPlaceName(meta, urlInfo) {
    if (urlInfo && urlInfo.locationSlug) {
      return humanizeHandle(urlInfo.locationSlug.replace(/-/g, ' '));
    }
    var caption = (meta && (meta.caption || meta.title)) || '';
    var author = String((meta && meta.author) || '').replace(/^@/, '');
    var re = /@([A-Za-z0-9._]{2,30})/g;
    var m;
    while ((m = re.exec(caption))) {
      if (m[1].toLowerCase() !== author.toLowerCase()) return humanizeHandle(m[1]);
    }
    var atPlace = caption.match(/\b(?:at|from)\s+([A-Z][\w'&.\-]*(?:\s+[A-Z][\w'&.\-]*){0,5})/);
    if (atPlace) return atPlace[1].replace(/\s+/g, ' ').trim();
    if (urlInfo && urlInfo.profile && !urlInfo.isPost) return humanizeHandle(urlInfo.profile);
    if (/coffee|cafe|café|brew|roast|espresso/i.test(author)) return humanizeHandle(author);
    return '';
  }

  function parseMicrolink(json) {
    var d = (json && json.data) || {};
    var title = d.title || '';
    var description = d.description || '';
    var author = (d.author && (d.author.name || d.author)) || '';
    var caption = description;
    var m = title.match(/^(.+?) on Instagram:\s*[\u201c"']?([\s\S]*)/);
    if (m) {
      author = author || m[1].trim();
      if (m[2]) caption = m[2].replace(/[\u201d"']\s*$/, '').trim();
    }
    return { title: title, caption: caption, author: String(author || '').trim() };
  }

  function fetchInstagramMeta(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 8000);
    var opts = controller ? { signal: controller.signal } : {};
    return fetch(MICROLINK_URL + '?url=' + encodeURIComponent(url), opts)
      .then(function (r) { return r.json(); })
      .then(parseMicrolink)
      .catch(function () { return { title: '', caption: '', author: '' }; })
      .then(function (meta) {
        clearTimeout(timer);
        return meta;
      });
  }

  function formatPhotonAddress(props) {
    props = props || {};
    var street = [props.housenumber, props.street].filter(Boolean).join(' ');
    var parts = [];
    if (street) parts.push(street);
    if (props.district && props.district !== props.city) parts.push(props.district);
    if (props.city) parts.push(props.city);
    else if (props.state) parts.push(props.state);
    return parts.join(', ');
  }

  function amenityBonus(props) {
    var v = String((props && (props.osm_value || props.osm_key)) || '').toLowerCase();
    if (/cafe|coffee|bakery|dessert/.test(v)) return 3;
    if (/restaurant|fast_food|bar|pub/.test(v)) return 1;
    return 0;
  }

  function searchPhoton(query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve([]);
    if (!/philadel|philly/i.test(q)) q += ' Philadelphia';
    var params = new URLSearchParams({
      q: q,
      lat: String(PHILLY.lat),
      lon: String(PHILLY.lng),
      limit: '8',
      lang: 'en'
    });
    if (typeof PhillyWalkMap !== 'undefined') {
      params.set('bbox', PhillyWalkMap.photonBbox());
    }
    return fetch(PHOTON_URL + '?' + params.toString())
      .then(function (r) {
        if (!r.ok) throw new Error('search failed');
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) || [];
        var out = features.map(function (f, i) {
          var coords = f.geometry && f.geometry.coordinates;
          var props = f.properties || {};
          if (!coords || coords.length < 2) return null;
          return {
            id: 'c' + i,
            name: props.name || q.replace(/\s*Philadelphia\s*$/i, '').trim(),
            lat: coords[1],
            lng: coords[0],
            address: formatPhotonAddress(props),
            osmValue: props.osm_value || '',
            score: amenityBonus(props)
          };
        }).filter(Boolean);
        if (typeof PhillyWalkMap !== 'undefined') {
          out = out.filter(function (c) { return PhillyWalkMap.contains(c.lat, c.lng); });
        }
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
      });
  }

  function pinFill(kind) {
    if (kind === 'been') return '#5b7050';
    if (kind === 'drop') return '#7c3aed';
    if (kind === 'candidate') return '#1f2937';
    return '#c2410c';
  }

  function addPlacePin(latlng, opts) {
    opts = opts || {};
    if (typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.addCirclePin) {
      return PhillyWalkMap.addCirclePin(latlng, opts);
    }
    return L.circleMarker(latlng, {
      radius: 11,
      color: '#fff',
      weight: 2,
      fillColor: opts.fillColor || pinFill('want'),
      fillOpacity: opts.dim ? 0.28 : 1,
      opacity: opts.dim ? 0.35 : 1,
      bubblingMouseEvents: false
    });
  }

  function filteredPlaces(data) {
    return (data.places || []).filter(function (p) {
      if (ui.filter === 'want') return p.status !== 'been';
      if (ui.filter === 'been') return p.status === 'been';
      return true;
    });
  }

  function starText(rating) {
    if (!rating) return '';
    var s = '';
    var i;
    for (i = 1; i <= 5; i++) s += i <= rating ? '★' : '☆';
    return s;
  }

  function renderPlacesLayer() {
    if (!placesLayer) return;
    placesLayer.clearLayers();
    var data = loadData();
    var hereActive = hereControl && hereControl.isActive();
    filteredPlaces(data).forEach(function (p) {
      var kind = p.status === 'been' ? 'been' : 'want';
      var dim = hereActive && hereControl && !hereControl.isWithin(p.lat, p.lng);
      var marker = addPlacePin([p.lat, p.lng], {
        fillColor: pinFill(kind),
        dim: dim,
        label: p.name,
        labelInteractive: true,
        onClick: function () { openDetail(p.id); }
      });
      placesLayer.addLayer(marker);
    });
  }

  function hereButtons() {
    return [
      document.getElementById('hereBtn'),
      document.getElementById('listHereBtn')
    ];
  }

  function syncDistanceSortUi(state) {
    var select = document.getElementById('listSort');
    var clearBtn = document.getElementById('listHereClear');
    var available = typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.syncDistanceSortOption
      ? PhillyWalkMap.syncDistanceSortOption(select, state, 'distance')
      : !!(state && state.active);
    if (clearBtn) clearBtn.hidden = !available;
    if (available && pendingDistanceSort) {
      pendingDistanceSort = false;
      ui.sort = 'distance';
      if (select) select.value = 'distance';
    } else if (!available && ui.sort === 'distance') {
      ui.sort = sortBeforeDistance || 'name';
      if (select) select.value = ui.sort;
    } else if (select && available && ui.sort === 'distance') {
      select.value = 'distance';
    }
  }

  function updateHereUi(state) {
    if (typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.syncHereButtons) {
      PhillyWalkMap.syncHereButtons(hereButtons(), state);
    }
    syncDistanceSortUi(state);
    if (typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.syncHereBar) {
      PhillyWalkMap.syncHereBar({
        bar: document.getElementById('hereBar'),
        label: document.getElementById('hereLabel'),
        minutes: document.getElementById('hereMinutes'),
        count: document.getElementById('hereCount'),
        slider: document.getElementById('hereSlider'),
        openClassEl: document.body,
        openClass: 'here-open'
      }, state, function () {
        return hereControl ? hereControl.countWithin(filteredPlaces(loadData())) : 0;
      });
    } else {
      var bar = document.getElementById('hereBar');
      if (bar) {
        if (!state || !state.active) {
          bar.hidden = true;
          document.body.classList.remove('here-open');
        } else {
          bar.hidden = false;
          document.body.classList.add('here-open');
        }
      }
    }
    if (ui.view === 'map') renderPlacesLayer();
    if (ui.view === 'list' || (state && state.active)) renderList();
  }

  function clearHere() {
    if (hereControl) hereControl.clear();
  }

  function ensureHereSession() {
    if (hereControl) return hereControl;
    if (typeof PhillyWalkMap === 'undefined' || !PhillyWalkMap.createHereSession) return null;
    hereControl = PhillyWalkMap.createHereSession({
      onChange: updateHereUi,
      onError: function (msg) {
        pendingDistanceSort = false;
        toast(msg);
      }
    });
    if (map && hereControl.attachToMap) hereControl.attachToMap(map);
    return hereControl;
  }

  function requestLocate() {
    var session = ensureHereSession();
    if (!session) {
      toast('Location helper failed to load');
      return;
    }
    session.locate();
  }

  function renderList() {
    var data = loadData();
    var places = filteredPlaces(data).slice();
    var hereState = hereControl ? hereControl.getState() : null;
    var hereActive = !!(hereState && hereState.active && hereState.lat != null);

    if (ui.sort === 'distance' && hereActive && typeof PhillyWalkMap !== 'undefined') {
      places = PhillyWalkMap.sortByDistance(places, hereState.lat, hereState.lng);
    } else if (ui.sort === 'rating') {
      places.sort(function (a, b) {
        return (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name);
      });
    } else if (ui.sort === 'added') {
      places.sort(function (a, b) {
        return String(b.addedAt).localeCompare(String(a.addedAt));
      });
    } else {
      places.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    var countEl = document.getElementById('listCount');
    if (countEl) {
      countEl.textContent = places.length + ' place' + (places.length === 1 ? '' : 's');
    }
    var headerSub = document.getElementById('headerSub');
    if (headerSub) {
      var n = data.places.length;
      var been = data.places.filter(function (p) { return p.status === 'been'; }).length;
      headerSub.textContent = n ? (been + ' been · ' + (n - been) + ' to try') : 'Cafes to try & rate';
    }

    var list = document.getElementById('placeList');
    var empty = document.getElementById('listEmpty');
    if (!list) return;
    if (!places.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = places.map(function (p) {
      var open = isOpenNow(p);
      var metaBits = [];
      if (hereActive && typeof PhillyWalkMap !== 'undefined') {
        var dist = hereControl.distanceTo(p.lat, p.lng);
        if (dist != null) metaBits.push(PhillyWalkMap.formatDistance(dist));
      }
      if (p.neighborhood) metaBits.push(p.neighborhood);
      if (p.hoursNote) metaBits.push(p.hoursNote.split(' · ')[0]);
      else if (p.address) metaBits.push(p.address);
      var openHtml = open == null ? '' : (
        '<span class="' + (open ? 'open-pill' : 'closed-pill') + '">' + (open ? 'Open' : 'Closed') + '</span> '
      );
      return '<button type="button" class="place-card ' + (p.status === 'been' ? 'been' : '') + '" data-id="' +
        escapeHtml(p.id) + '"><div class="name"><span class="name-text">' + escapeHtml(p.name) + '</span>' +
        (p.status === 'been' ? '<span class="been-pill">Been</span>' : '') +
        '</div>' +
        (metaBits.length || openHtml ? '<div class="meta">' + openHtml + escapeHtml(metaBits.join(' · ')) + '</div>' : '') +
        (p.rating ? '<div class="stars-inline">' + starText(p.rating) + '</div>' : '') +
        '</button>';
    }).join('');
  }

  function render() {
    renderPlacesLayer();
    renderList();
  }

  function showCandidates(cands) {
    if (!candidatesLayer) return;
    candidatesLayer.clearLayers();
    var list = document.getElementById('candidateList');
    if (!cands.length) {
      if (list) list.innerHTML = '';
      return;
    }
    var bounds = [];
    cands.forEach(function (c, i) {
      var marker = addPlacePin([c.lat, c.lng], {
        fillColor: pinFill('candidate'),
        label: (i + 1) + ' · ' + c.name,
        labelInteractive: true,
        onClick: function () { saveFromCandidate(c); }
      });
      candidatesLayer.addLayer(marker);
      bounds.push([c.lat, c.lng]);
    });
    if (list) {
      list.innerHTML = cands.map(function (c, i) {
        return '<button type="button" class="candidate" data-idx="' + i + '">' +
          '<div class="c-name">' + (i + 1) + '. ' + escapeHtml(c.name) + '</div>' +
          (c.address ? '<div class="c-addr">' + escapeHtml(c.address) + '</div>' : '') +
          '</button>';
      }).join('');
      list.querySelectorAll('.candidate').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-idx'));
          if (cands[idx]) saveFromCandidate(cands[idx]);
        });
      });
    }
    if (map && bounds.length) {
      map.fitBounds(bounds, {
        maxZoom: 16,
        paddingTopLeft: [24, 130],
        paddingBottomRight: [24, Math.round(window.innerHeight * 0.48)]
      });
    }
    window._coffeeCandidates = cands;
  }

  function clearCandidates() {
    window._coffeeCandidates = [];
    if (candidatesLayer) candidatesLayer.clearLayers();
    var list = document.getElementById('candidateList');
    if (list) list.innerHTML = '';
  }

  function clearDroppedPin() {
    droppedPin = null;
    if (dropMarker && map) {
      map.removeLayer(dropMarker);
      dropMarker = null;
    }
    var btn = document.getElementById('saveDroppedBtn');
    if (btn) btn.hidden = true;
  }

  function openAdd(prefillUrl) {
    document.body.classList.add('sheet-open');
    document.getElementById('addOverlay').hidden = false;
    if (prefillUrl) {
      document.getElementById('igUrlInput').value = prefillUrl;
      lookupFromInput();
    } else {
      document.getElementById('igUrlInput').focus();
    }
  }

  function closeAdd() {
    document.getElementById('addOverlay').hidden = true;
    if (document.getElementById('detailOverlay').hidden &&
        document.getElementById('settingsOverlay').hidden) {
      document.body.classList.remove('sheet-open');
    }
    clearCandidates();
    clearDroppedPin();
    setAddStatus('');
    var snip = document.getElementById('metaSnippet');
    if (snip) { snip.hidden = true; snip.textContent = ''; }
  }

  function lookupFromInput() {
    var raw = document.getElementById('igUrlInput').value;
    var parsed = parseInstagramUrl(raw);
    if (!parsed) {
      setAddStatus('Need an Instagram link, or just type a cafe name and search.');
      return;
    }
    document.getElementById('igUrlInput').value = parsed.url;
    setAddStatus('Looking up that reel…');
    fetchInstagramMeta(parsed.url).then(function (meta) {
      var guess = guessPlaceName(meta, parsed);
      var snip = document.getElementById('metaSnippet');
      var snippet = (meta.author ? '@' + meta.author.replace(/^@/, '') + ' · ' : '') + (meta.caption || '');
      if (snip && snippet.trim()) {
        snip.hidden = false;
        snip.textContent = snippet.trim();
      }
      if (guess) document.getElementById('placeNameInput').value = guess;
      if (guess) {
        setAddStatus('Searching Philadelphia for “' + guess + '”…');
        return runSearch(guess);
      }
      setAddStatus('Couldn’t read the cafe name — type it and tap Search.');
    });
  }

  function runSearch(query) {
    query = query || document.getElementById('placeNameInput').value;
    if (!String(query || '').trim()) {
      setAddStatus('Type a cafe name first.');
      return Promise.resolve();
    }
    setAddStatus('Searching Philadelphia…');
    return searchPhoton(query).then(function (cands) {
      if (!cands.length) {
        clearCandidates();
        setAddStatus('No matches. Try another name, or long-press the map.');
        toast('No matches in Philly');
        return;
      }
      setAddStatus('Tap the right pin or row to save.');
      showCandidates(cands);
    }).catch(function () {
      setAddStatus('Search failed. Check the network and try again.');
    });
  }

  function savePlace(partial) {
    var data = loadData();
    var place = normalizePlace(partial);
    if (!place) {
      toast('Need a name and a pin');
      return;
    }
    var dup = data.places.some(function (p) {
      if (place.instagramUrl && p.instagramUrl && normIgKey(p.instagramUrl) === normIgKey(place.instagramUrl)) return true;
      var dlat = p.lat - place.lat;
      var dlng = p.lng - place.lng;
      var near = (dlat * dlat + dlng * dlng) < 0.0000002;
      return near && p.name.toLowerCase() === place.name.toLowerCase();
    });
    if (dup) {
      toast('Already on your map');
      closeAdd();
      return;
    }
    data.places.push(place);
    saveData(data);
    render();
    closeAdd();
    toast('Saved ' + place.name);
    if (map) {
      map.setView([place.lat, place.lng], Math.max(map.getZoom(), 15));
    }
    setTimeout(function () { openDetail(place.id); }, 250);
  }

  function saveFromCandidate(c) {
    var name = String(document.getElementById('placeNameInput').value || '').trim() || c.name;
    var ig = normalizeInstagramUrl(document.getElementById('igUrlInput').value);
    savePlace({
      id: uid(),
      name: name,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      instagramUrl: ig,
      status: 'want',
      rating: null,
      notes: '',
      addedAt: new Date().toISOString()
    });
  }

  function saveDropped() {
    if (!droppedPin) return;
    var name = String(document.getElementById('placeNameInput').value || '').trim();
    if (!name) {
      setAddStatus('Name the cafe, then save the dropped pin.');
      document.getElementById('placeNameInput').focus();
      return;
    }
    savePlace({
      id: uid(),
      name: name,
      lat: droppedPin.lat,
      lng: droppedPin.lng,
      address: '',
      instagramUrl: normalizeInstagramUrl(document.getElementById('igUrlInput').value),
      status: 'want'
    });
  }

  function onLongPress(latlng) {
    if (!latlng) return;
    if (document.getElementById('detailOverlay') && !document.getElementById('detailOverlay').hidden) return;
    droppedPin = { lat: latlng.lat, lng: latlng.lng };
    if (dropMarker) map.removeLayer(dropMarker);
    var dropIcon = (typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.circleDivIcon)
      ? PhillyWalkMap.circleDivIcon({ fillColor: pinFill('drop'), html: '+' })
      : undefined;
    dropMarker = L.marker([latlng.lat, latlng.lng], {
      icon: dropIcon,
      draggable: true,
      zIndexOffset: 800,
      pane: 'pins'
    });
    dropMarker.on('dragend', function () {
      var ll = dropMarker.getLatLng();
      droppedPin = { lat: ll.lat, lng: ll.lng };
    });
    dropMarker.addTo(map);
    document.getElementById('saveDroppedBtn').hidden = false;
    if (document.getElementById('addOverlay').hidden) openAdd();
    setAddStatus('Pin dropped. Add a name and save, or search instead.');
    toast('Pin dropped');
  }

  function findPlace(id) {
    return loadData().places.filter(function (p) { return p.id === id; })[0] || null;
  }

  function updatePlace(id, patch) {
    var data = loadData();
    var i;
    for (i = 0; i < data.places.length; i++) {
      if (data.places[i].id !== id) continue;
      var next = Object.assign({}, data.places[i], patch);
      if (patch.status === 'been' && !next.visitedAt) next.visitedAt = new Date().toISOString();
      if (patch.status === 'want') next.visitedAt = next.visitedAt || null;
      data.places[i] = normalizePlace(next);
      saveData(data);
      render();
      return data.places[i];
    }
    return null;
  }

  function renderStars(rating) {
    var row = document.getElementById('starRow');
    if (!row) return;
    var html = '';
    var i;
    for (i = 1; i <= 5; i++) {
      html += '<button type="button" class="star' + (rating && i <= rating ? ' on' : '') +
        '" data-star="' + i + '" aria-label="' + i + ' star' + (i === 1 ? '' : 's') + '">★</button>';
    }
    row.innerHTML = html;
  }

  function openDetail(id) {
    var p = findPlace(id);
    if (!p) return;
    activePlaceId = id;
    document.body.classList.add('sheet-open');
    document.getElementById('detailOverlay').hidden = false;
    document.getElementById('detailName').textContent = p.name;
    var addrBits = [];
    if (p.address) addrBits.push(p.address);
    else if (p.neighborhood) addrBits.push(p.neighborhood);
    document.getElementById('detailAddress').textContent = addrBits.join(' · ');
    var hoursEl = document.getElementById('detailHours');
    if (hoursEl) {
      var open = isOpenNow(p);
      var pill = open == null ? '' : (
        '<span class="' + (open ? 'open-pill' : 'closed-pill') + '">' + (open ? 'Open now' : 'Closed') + '</span>'
      );
      hoursEl.innerHTML = pill + escapeHtml(p.hoursNote || '');
      hoursEl.hidden = !p.hoursNote && open == null;
    }
    document.getElementById('statusWant').classList.toggle('on-want', p.status !== 'been');
    document.getElementById('statusBeen').classList.toggle('on-been', p.status === 'been');
    document.getElementById('notesInput').value = p.notes || '';
    renderStars(p.rating);
    var ig = document.getElementById('openIgBtn');
    if (p.instagramUrl && isInstagramUrl(p.instagramUrl)) {
      ig.hidden = false;
      ig.href = p.instagramUrl;
    } else {
      ig.hidden = true;
      ig.removeAttribute('href');
    }
    var site = document.getElementById('openSiteBtn');
    if (site) {
      if (p.website) {
        site.hidden = false;
        site.href = p.website;
      } else {
        site.hidden = true;
        site.removeAttribute('href');
      }
    }
    var maps = document.getElementById('openMapsBtn');
    if (maps) {
      maps.hidden = false;
      maps.href = 'https://maps.google.com/?q=' + encodeURIComponent(
        (p.address ? p.address : p.name + ' Philadelphia') + ' @' + p.lat + ',' + p.lng
      );
    }
    if (map && ui.view === 'map') {
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    }
  }

  function closeDetail() {
    activePlaceId = null;
    document.getElementById('detailOverlay').hidden = true;
    if (document.getElementById('addOverlay').hidden &&
        document.getElementById('settingsOverlay').hidden) {
      document.body.classList.remove('sheet-open');
    }
  }

  function setView(view) {
    ui.view = view === 'list' ? 'list' : 'map';
    document.body.classList.toggle('view-map', ui.view === 'map');
    document.body.classList.toggle('view-list', ui.view === 'list');
    document.getElementById('listView').hidden = ui.view !== 'list';
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-view') === ui.view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (hereControl && hereControl.setDrawEnabled) {
      hereControl.setDrawEnabled(ui.view === 'map');
    }
    if (ui.view === 'map' && map) {
      setTimeout(function () { map.invalidateSize(); }, 50);
      if (hereControl && hereControl.isActive()) renderPlacesLayer();
    }
    renderList();
  }

  function setFilter(filter) {
    ui.filter = filter;
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.classList.toggle('on', chip.getAttribute('data-filter') === filter);
    });
    render();
  }

  function exportJson() {
    var data = loadData();
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      'coffee-map-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    );
    toast('Exported');
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast('No Coffee Map data in this file');
            return;
          }
        }
        if (!slice || !Array.isArray(slice.places)) {
          toast('Invalid backup file');
          return;
        }
        var before = loadData().places.length;
        var merged = mergePlaces(loadData(), slice);
        saveData(merged);
        render();
        var added = merged.places.length - before;
        toast(added ? ('Added ' + added + ' cafe' + (added === 1 ? '' : 's')) : 'No new cafes to add');
      } catch (e) {
        toast('Could not read file');
      }
    };
    reader.readAsText(file);
  }

  function consumeAddQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      var add = params.get('add');
      if (!add) return;
      openAdd(add);
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e) { /* ignore */ }
  }

  function initMap() {
    if (typeof L === 'undefined') {
      toast('Map failed to load');
      return;
    }
    if (typeof PhillyWalkMap !== 'undefined' && PhillyWalkMap.createMap) {
      map = PhillyWalkMap.createMap(document.getElementById('map'), {
        center: PHILLY,
        zoom: 13
      });
    } else {
      map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
        minZoom: 11,
        maxZoom: 19
      }).setView([PHILLY.lat, PHILLY.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
    }
    if (!map) {
      toast('Map failed to load');
      return;
    }
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    placesLayer = L.layerGroup().addTo(map);
    candidatesLayer = L.layerGroup().addTo(map);

    ensureHereSession();

    var holdTimer = null;
    function startHold(latlng) {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        holdTimer = null;
        onLongPress(latlng);
      }, 650);
    }
    function clearHold() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }
    map.on('mousedown', function (e) {
      if (e.originalEvent && e.originalEvent.button && e.originalEvent.button !== 0) return;
      startHold(e.latlng);
    });
    map.on('mouseup', clearHold);
    map.on('dragstart', clearHold);
    map.on('contextmenu', function (e) {
      L.DomEvent.preventDefault(e);
      clearHold();
      onLongPress(e.latlng);
    });

    var data = loadData();
    if (data.places.length) fitMapToPlaces(data);
  }

  function fitMapToPlaces(data) {
    if (!map) return;
    var pts = ((data && data.places) || []).map(function (p) { return [p.lat, p.lng]; });
    if (pts.length) {
      map.fitBounds(pts, { maxZoom: 14, padding: [36, 36] });
      return;
    }
    if (typeof PhillyWalkMap !== 'undefined') PhillyWalkMap.fit(map, [36, 36]);
  }

  function bind() {
    document.getElementById('addFab').addEventListener('click', function () { openAdd(); });
    document.getElementById('addCloseBtn').addEventListener('click', closeAdd);
    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('settingsBtn').addEventListener('click', function () {
      document.body.classList.add('sheet-open');
      document.getElementById('settingsOverlay').hidden = false;
    });
    document.getElementById('settingsCloseBtn').addEventListener('click', function () {
      document.getElementById('settingsOverlay').hidden = true;
      if (document.getElementById('addOverlay').hidden &&
          document.getElementById('detailOverlay').hidden) {
        document.body.classList.remove('sheet-open');
      }
    });
    document.getElementById('pasteBtn').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (text) {
          document.getElementById('igUrlInput').value = text.trim();
          lookupFromInput();
        }).catch(function () {
          document.getElementById('igUrlInput').focus();
          toast('Paste into the box');
        });
      } else {
        document.getElementById('igUrlInput').focus();
        toast('Paste into the box');
      }
    });
    document.getElementById('igUrlInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupFromInput();
      }
    });
    document.getElementById('searchBtn').addEventListener('click', function () { runSearch(); });
    document.getElementById('placeNameInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch();
      }
    });
    document.getElementById('saveDroppedBtn').addEventListener('click', saveDropped);

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-view')); });
    });
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () { setFilter(chip.getAttribute('data-filter')); });
    });
    var hereBtn = document.getElementById('hereBtn');
    if (hereBtn) {
      hereBtn.addEventListener('click', function () { requestLocate(); });
    }
    var listHereBtn = document.getElementById('listHereBtn');
    if (listHereBtn) {
      listHereBtn.addEventListener('click', function () { requestLocate(); });
    }
    var hereClearBtn = document.getElementById('hereClearBtn');
    if (hereClearBtn) {
      hereClearBtn.addEventListener('click', function () { clearHere(); });
    }
    var listHereClear = document.getElementById('listHereClear');
    if (listHereClear) {
      listHereClear.addEventListener('click', function () { clearHere(); });
    }
    var hereSlider = document.getElementById('hereSlider');
    if (hereSlider) {
      hereSlider.addEventListener('input', function () {
        if (!hereControl) return;
        hereControl.setMinutes(hereSlider.value);
      });
    }
    document.getElementById('listSort').addEventListener('change', function () {
      var select = document.getElementById('listSort');
      var next = select.value;
      if (next === 'distance') {
        var state = hereControl && hereControl.getState();
        if (ui.sort !== 'distance') sortBeforeDistance = ui.sort;
        if (!state || !state.active) {
          pendingDistanceSort = true;
          select.value = sortBeforeDistance || 'name';
          requestLocate();
          return;
        }
        ui.sort = 'distance';
        renderList();
        return;
      }
      pendingDistanceSort = false;
      sortBeforeDistance = next;
      ui.sort = next;
      renderList();
    });
    document.getElementById('placeList').addEventListener('click', function (e) {
      var card = e.target.closest('.place-card');
      if (card) openDetail(card.getAttribute('data-id'));
    });

    document.getElementById('statusWant').addEventListener('click', function () {
      if (!activePlaceId) return;
      updatePlace(activePlaceId, { status: 'want' });
      openDetail(activePlaceId);
    });
    document.getElementById('statusBeen').addEventListener('click', function () {
      if (!activePlaceId) return;
      updatePlace(activePlaceId, { status: 'been' });
      openDetail(activePlaceId);
    });
    document.getElementById('starRow').addEventListener('click', function (e) {
      var btn = e.target.closest('.star');
      if (!btn || !activePlaceId) return;
      var n = Number(btn.getAttribute('data-star'));
      var cur = findPlace(activePlaceId);
      var rating = cur && cur.rating === n ? null : n;
      var patch = { rating: rating };
      if (rating) patch.status = 'been';
      updatePlace(activePlaceId, patch);
      openDetail(activePlaceId);
    });
    var notesTimer = null;
    document.getElementById('notesInput').addEventListener('input', function () {
      if (!activePlaceId) return;
      var val = document.getElementById('notesInput').value;
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(function () {
        updatePlace(activePlaceId, { notes: val });
      }, 250);
    });
    document.getElementById('deletePlaceBtn').addEventListener('click', function () {
      if (!activePlaceId) return;
      if (!window.confirm('Remove this cafe from your map?')) return;
      var data = loadData();
      var gone = data.places.filter(function (p) { return p.id === activePlaceId; })[0];
      data.places = data.places.filter(function (p) { return p.id !== activePlaceId; });
      if (gone && gone.seeded && data.hiddenSeedIds.indexOf(gone.id) === -1) {
        data.hiddenSeedIds.push(gone.id);
      }
      saveData(data);
      closeDetail();
      render();
      toast('Removed');
    });

    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonFile').addEventListener('change', function (e) {
      importJson(e.target.files && e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('addOverlay').addEventListener('click', function (e) {
      if (e.target.id === 'addOverlay') closeAdd();
    });
    document.getElementById('detailOverlay').addEventListener('click', function (e) {
      if (e.target.id === 'detailOverlay') closeDetail();
    });
    document.getElementById('settingsOverlay').addEventListener('click', function (e) {
      if (e.target.id === 'settingsOverlay') {
        document.getElementById('settingsOverlay').hidden = true;
        document.body.classList.remove('sheet-open');
      }
    });
  }

  function init() {
    bind();
    initMap();
    render();
    loadSeed().then(function () {
      render();
      fitMapToPlaces(loadData());
      consumeAddQuery();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
