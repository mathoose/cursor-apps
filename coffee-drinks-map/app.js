(function () {
  'use strict';

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  var COLOR_PIN_OPEN = '#43a047';
  var COLOR_PIN_CLOSED = '#c62828';
  var COLOR_PIN_UNKNOWN = '#9ca3af';
  var COLOR_HH_NOW = '#d97706';
  var COLOR_BAR = '#78716c';
  var COLOR_FOOD = '#0f766e';
  var DAY_SHORT = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
  var KIND_ORDER = ['coffee', 'food', 'drinks'];
  var KIND_TAG = { coffee: 'Coffee', food: 'Food', drinks: 'Drinks' };
  /* A place that sits in two catalogs under one name is one place when the pins are this close. */
  var SAME_PLACE_METERS = 200;

  var allPlaces = [];
  var placeByKey = {};
  var hhRestaurants = [];
  var modes = {};
  var currentScreen = 'screen-home';

  var daySel = document.getElementById('day');
  var timeSel = document.getElementById('time');
  var nSel = document.getElementById('neighborhood');

  function $(id) { return document.getElementById(id); }

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

  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
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
    var screen = $(id);
    currentScreen = id;
    document.body.classList.toggle('on-map', !!(screen && screen.classList.contains('screen-map')));
    document.body.classList.toggle('decide-open', id === 'screen-decide');
    window.scrollTo(0, 0);
  }

  /* Map screens need their map resized on the way back in; plain screens just show. */
  function goScreen(id) {
    if (id === 'screen-coffee' && modes.coffee) modes.coffee.show();
    else if (id === 'screen-eat' && modes.eat) modes.eat.show();
    else if (id === 'screen-saved') openSaved();
    else if (id === 'screen-home') openHome();
    else showScreen(id);
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

  /* ---------- Time, hours and happy hours ---------- */

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

  /* "4 PM" / "6:30 PM" for one-line blurbs. */
  function fmtClock(m) {
    if (!isFinite(m)) return '';
    m = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var min = m % 60;
    var h12 = h % 12 || 12;
    return h12 + (min ? ':' + String(min).padStart(2, '0') : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function getTodayDayName() {
    return DAY_NAMES[new Date().getDay()];
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function roundToSlot(m) {
    return Math.floor(m / 30) * 30;
  }

  function getNowSlot() {
    return roundToSlot(nowMinutes());
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
    return isActive(p, getTodayDayName(), nowMinutes());
  }

  function hhToday(p) {
    return hasSchedule(p) ? (p.schedule[getTodayDayName()] || null) : null;
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

  function hasAnyHours(hours) {
    if (!hours || typeof hours !== 'object') return false;
    return DAY_NAMES.some(function (d) {
      var h = hours[d];
      return h && h.open && h.close;
    });
  }

  function hoursOpenStatus(p) {
    if (!hasAnyHours(p.hours)) return 'unknown';
    var today = p.hours[getTodayDayName()];
    if (!today || !today.open || !today.close) return 'closed';
    return isOpenNowHours(p.hours) ? 'open' : 'closed';
  }

  function pinColorByHours(p) {
    var st = hoursOpenStatus(p);
    if (st === 'open') return COLOR_PIN_OPEN;
    if (st === 'closed') return COLOR_PIN_CLOSED;
    return COLOR_PIN_UNKNOWN;
  }

  function matchesPlaceSearch(p, search) {
    if (!search) return true;
    return (p.name + ' ' + (p.neighborhood || '') + ' ' + (p.address || '') + ' ' + (p.cuisine || ''))
      .toLowerCase().indexOf(search) >= 0;
  }

  function isOpenNowHours(hours) {
    if (!hours || typeof hours !== 'object') return false;
    var today = hours[getTodayDayName()];
    if (!today || !today.open || !today.close) return false;
    var start = parseTime12(today.open);
    var end = parseTime12(today.close);
    if (start == null || end == null) return false;
    var now = nowMinutes();
    if (end <= start) return now >= start || now < end;
    return now >= start && now < end;
  }

  function openBlurb(p) {
    var st = hoursOpenStatus(p);
    if (st === 'open') {
      var close = parseTime12(p.hours[getTodayDayName()].close);
      return close == null ? 'Open now' : 'Open · closes ' + fmtClock(close);
    }
    if (st === 'closed') return 'Closed now';
    return '';
  }

  function hhBlurb(p) {
    var today = hhToday(p);
    if (!today) return '';
    if (hhNow(p)) return 'Happy hour right now · until ' + fmtClock(parseTime(today.end));
    return 'Happy hour today ' + fmtClock(parseTime(today.start)) + ' – ' + fmtClock(parseTime(today.end));
  }

  function renderHoursBlock(hours) {
    var el = $('detail-hours');
    el.innerHTML = '';
    if (!hasAnyHours(hours)) {
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

  function metersBetween(a, b) {
    return PhillyWalkMap.haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }

  function fmtDistance(m) {
    return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
  }

  /* ---------- One catalog: a place can be coffee, food and drinks at once ---------- */

  var BOILERPLATE_RE = /^(popular pick in|listed in .*openstreetmap|.*chain location from openstreetmap)/i;

  function isBoilerplate(text) {
    return BOILERPLATE_RE.test(String(text || '').trim());
  }

  function isEmptyValue(v) {
    if (v == null || v === '') return true;
    return typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
  }

  function buildPlaces(sources) {
    var byName = {};
    allPlaces = [];
    placeByKey = {};
    sources.forEach(function (src) {
      var kind = src.kind;
      var nameCount = {};
      src.list.forEach(function (raw) {
        var k = nameKey(raw.name);
        nameCount[k] = (nameCount[k] || 0) + 1;
      });
      src.list.forEach(function (raw) {
        var nk = nameKey(raw.name);
        if (!nk) return;
        /* Same shape the app has always used for marks, so saved favorites keep working. */
        var key = kind + ':' + String(raw.id || raw.name).toLowerCase();
        var unique = nameCount[nk] === 1;
        var target = null;
        (byName[nk] || []).forEach(function (cand) {
          if (target || cand.kinds[kind]) return;
          var near = hasCoords(cand) && hasCoords(raw) && metersBetween(cand, raw) <= SAME_PLACE_METERS;
          if (near || (unique && cand._uniqueName)) target = cand;
        });
        if (!target) {
          target = Object.assign({}, raw);
          target.kinds = {};
          target.keys = [];
          target._uniqueName = unique;
          target.neighborhood = canonicalNeighborhood(raw.neighborhood);
          if (isBoilerplate(target.description)) target.description = '';
          (byName[nk] = byName[nk] || []).push(target);
          allPlaces.push(target);
        } else {
          Object.keys(raw).forEach(function (field) {
            if (field === 'description' || field === 'neighborhood') return;
            if (isEmptyValue(target[field]) && !isEmptyValue(raw[field])) target[field] = raw[field];
          });
          if (!hasAnyHours(target.hours) && hasAnyHours(raw.hours)) {
            target.hours = raw.hours;
            target.hoursNote = raw.hoursNote || target.hoursNote;
          }
          var extra = String(raw.description || '').trim();
          if (extra && !isBoilerplate(extra) && String(target.description || '').indexOf(extra) < 0) {
            target.description = target.description ? target.description + '\n\n' + extra : extra;
          }
          if (!target.neighborhood) target.neighborhood = canonicalNeighborhood(raw.neighborhood);
        }
        target.kinds[kind] = true;
        target.keys.push(key);
        placeByKey[key] = target;
      });
    });
    allPlaces.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function placesOf(kind) {
    return allPlaces.filter(function (p) { return p.kinds[kind]; });
  }

  function primaryKind(p) {
    if (p.kinds.food) return 'food';
    if (p.kinds.drinks) return 'drinks';
    if (p.kinds.coffee) return 'coffee';
    return 'place';
  }

  function kindTagsHtml(p) {
    return KIND_ORDER.filter(function (k) { return p.kinds && p.kinds[k]; }).map(function (k) {
      return '<span class="tag tag-' + k + '">' + KIND_TAG[k] + '</span>';
    }).join('');
  }

  /* First match wins, so the specific words sit above the general ones. */
  var LABEL_RULES = [
    [/sushi|omakase/, 'Sushi'],
    [/ramen/, 'Ramen'],
    [/izakaya|japanese/, 'Japanese'],
    [/\bpho\b|vietnamese|banh mi|\bviet\b/, 'Vietnamese'],
    [/\bthai\b/, 'Thai'],
    [/dim sum|dumpling/, 'Dumplings'],
    [/sichuan|szechuan|chinese/, 'Chinese'],
    [/korean/, 'Korean'],
    [/cambodian/, 'Cambodian'],
    [/indian|tandoor/, 'Indian'],
    [/jamaican|jerk/, 'Jamaican'],
    [/colombian/, 'Colombian'],
    [/taco|taqueria|cantina|mexican|tamale|barbacoa|mezcal/, 'Mexican'],
    [/pizza|pizzeria|tomato pie/, 'Pizza'],
    [/steakhouse/, 'Steakhouse'],
    [/cheesesteak|\bsteaks\b/, 'Cheesesteaks'],
    [/burger/, 'Burgers'],
    [/fried chicken/, 'Fried chicken'],
    [/oyster|seafood|fish & chips/, 'Seafood'],
    [/\bbbq\b|barbecue|smokehouse/, 'BBQ'],
    [/italian|trattoria|osteria|ristorante|pasta/, 'Italian'],
    [/greek|gyro|souvlaki|taverna/, 'Greek'],
    [/mediterranean|falafel|hummus|lebanese|halal|egyptian/, 'Mediterranean'],
    [/french|bistro|brasserie|creperie/, 'French'],
    [/ice cream|water ice|gelato/, 'Ice cream'],
    [/donut|bakery|pastr|bagel/, 'Bakery'],
    [/brewery|brewing|brewpub|\bbrew\b/, 'Brewery'],
    [/wine bar|\bvino\b/, 'Wine bar'],
    [/beer garden/, 'Beer garden'],
    [/rooftop/, 'Rooftop bar'],
    [/irish/, 'Irish pub'],
    [/tavern|\bpub\b|saloon|taproom|tap room|sports bar/, 'Pub'],
    [/diner|brunch/, 'Brunch'],
    [/delicatessen|\bdeli\b/, 'Deli'],
    [/chipotle/, 'Mexican'],
    [/domino/, 'Pizza'],
    [/coffee|roasters?\b|starbucks|dunkin/, 'Coffee']
  ];

  function matchLabel(text) {
    for (var i = 0; i < LABEL_RULES.length; i++) {
      if (LABEL_RULES[i][0].test(text)) return LABEL_RULES[i][1];
    }
    return '';
  }

  /* Short "what kind of place" word: the catalog's own cuisine first, then the name, then the write-up. */
  function cuisineLabel(p) {
    if (p.cuisine) return p.cuisine;
    if (p._label != null) return p._label;
    var label = matchLabel(String(p.name || '').toLowerCase());
    if (!label && p.kinds.food && !p.kinds.drinks) {
      label = matchLabel(String(p.description || '').toLowerCase());
    }
    if (label === 'Coffee' && p.kinds.coffee) label = '';
    p._label = label;
    return label;
  }

  function snippet(p, max) {
    var lines = String(p.description || '').split('\n').map(function (l) {
      return l.replace(/^\*\s*/, '').trim();
    }).filter(function (l) {
      return l && !isBoilerplate(l) && !/^https?:/i.test(l) && !/^\d+(\.\d+)?\s*\/\s*10\b/.test(l);
    });
    var t = lines[0] || (p.kinds.coffee ? String(p.hoursNote || '') : '');
    max = max || 140;
    if (t.length > max) t = t.slice(0, max - 3).replace(/\s+\S*$/, '') + '\u2026';
    return t;
  }

  /* ---------- What stays on the phone: marks, ratings, logged orders ---------- */

  var STORE_KEY = 'coffee-drinks-marks-v1';
  var store = loadStore();

  function plainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function loadStore() {
    var parsed = {};
    try { parsed = plainObject(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { parsed = {}; }
    return {
      fav: plainObject(parsed.fav),
      want: plainObject(parsed.want),
      nope: plainObject(parsed.nope),
      ratings: plainObject(parsed.ratings),
      visits: Array.isArray(parsed.visits) ? parsed.visits : [],
      extraCosts: plainObject(parsed.extraCosts)
    };
  }

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { toast('Could not save on this phone'); }
  }

  function isMarked(p, bucket) {
    return p.keys.some(function (k) { return !!store[bucket][k]; });
  }

  /* One emoji on the map. Nope wins, then a favorite, then someplace you want to go. */
  var MAP_TAGS = {
    nope: { emoji: '💩', label: 'Nope' },
    fav: { emoji: '⭐', label: 'Favorite' },
    want: { emoji: '👀', label: 'Want to go' }
  };

  function mapTag(p) {
    if (!p) return '';
    if (isMarked(p, 'nope')) return 'nope';
    if (isMarked(p, 'fav')) return 'fav';
    if (isMarked(p, 'want')) return 'want';
    return '';
  }

  function setMark(p, bucket, on) {
    p.keys.forEach(function (k) { delete store[bucket][k]; });
    if (on) store[bucket][p.keys[0]] = { name: p.name || '', kind: primaryKind(p) };
  }

  function toggleMark(p, bucket) {
    var turningOn = !isMarked(p, bucket);
    if (turningOn && bucket === 'nope') {
      setMark(p, 'fav', false);
      setMark(p, 'want', false);
    }
    if (turningOn && (bucket === 'fav' || bucket === 'want')) setMark(p, 'nope', false);
    setMark(p, bucket, turningOn);
    saveStore();
  }

  function addPlacePin(latlng, opts) {
    opts = opts || {};
    var tag = opts.place ? mapTag(opts.place) : '';
    var cafeMug = !tag && opts.cafeMug && opts.place && opts.place.kinds && opts.place.kinds.coffee &&
      !opts.place.kinds.food && !opts.place.kinds.drinks;
    if ((!tag && !cafeMug) || typeof L === 'undefined') return PhillyWalkMap.addCirclePin(latlng, opts);
    var emoji = cafeMug ? '☕' : MAP_TAGS[tag].emoji;
    var face = cafeMug ? 'cafe' : tag;
    var size = opts.big ? 42 : 34;
    var marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'philly-pin-icon tag-pin',
        html: '<div class="tag-pin-face tag-' + face + '" style="width:' + size + 'px;height:' + size + 'px;font-size:' +
          (opts.big ? 26 : 22) + 'px" aria-hidden="true">' + emoji + '</div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      }),
      pane: 'pins',
      bubblingMouseEvents: false,
      interactive: opts.interactive !== false,
      opacity: opts.dim ? 0.35 : 1,
      zIndexOffset: opts.big ? 800 : 500
    });
    if (opts.label) {
      marker.bindTooltip(opts.label, {
        permanent: true,
        direction: 'right',
        offset: [size / 2 - 2, 0],
        className: 'philly-pin-label' + (opts.dim ? ' dim' : ''),
        opacity: opts.dim ? 0.35 : 1,
        interactive: !!opts.labelInteractive
      });
    }
    if (opts.onClick) {
      marker.on('click', opts.onClick);
      if (opts.labelInteractive) {
        marker.on('add', function () {
          var tip = marker.getTooltip();
          var tipEl = tip && tip.getElement();
          if (!tipEl) return;
          tipEl.style.pointerEvents = 'auto';
          tipEl.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            opts.onClick(ev);
          });
        });
      }
    }
    return marker;
  }

  function getRating(p) {
    for (var i = 0; i < p.keys.length; i++) {
      var n = +store.ratings[p.keys[i]];
      if (n >= 1 && n <= 5) return n;
    }
    return 0;
  }

  function setRating(p, n) {
    p.keys.forEach(function (k) { delete store.ratings[k]; });
    if (n >= 1 && n <= 5) store.ratings[p.keys[0]] = n;
    saveStore();
  }

  function visitsFor(p) {
    return store.visits.filter(function (v) { return p.keys.indexOf(v.key) >= 0; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  }

  function itemTotal(item) {
    var extras = (item.extras || []).reduce(function (sum, e) { return sum + (+e.cost || 0); }, 0);
    return Math.round(((+item.price || 0) + extras) * 100) / 100;
  }

  function visitTotal(v) {
    return Math.round((v.items || []).reduce(function (sum, it) { return sum + itemTotal(it); }, 0) * 100) / 100;
  }

  function parseMoney(s) {
    var n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, ''));
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }

  function fmtMoney(n) {
    return '$' + (+n || 0).toFixed(2);
  }

  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours();
    return DAY_SHORT[DAY_NAMES[d.getDay()]] + ', ' + MONTH_SHORT[d.getMonth()] + ' ' + d.getDate() +
      ' · ' + (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function starsText(n) {
    n = Math.max(0, Math.min(5, Math.round(+n || 0)));
    return n ? '\u2605'.repeat(n) + '\u2606'.repeat(5 - n) : '';
  }

  /* Places the phone remembers that the catalog no longer (or never) had. */
  function looseKeyName(key) {
    var rec = store.fav[key] || store.want[key] || store.nope[key];
    if (rec && rec.name) return rec.name;
    for (var i = store.visits.length - 1; i >= 0; i--) {
      if (store.visits[i].key === key) return store.visits[i].name || '';
    }
    return '';
  }

  function loosePlace(key, name) {
    return { name: name || looseKeyName(key) || 'Place', keys: [key], kinds: {}, loose: true };
  }

  function resolvePlace(key) {
    return placeByKey[key] || loosePlace(key);
  }

  function savedCount() {
    var seen = {};
    ['fav', 'want'].forEach(function (bucket) {
      Object.keys(store[bucket]).forEach(function (k) { seen[resolvePlace(k).keys[0]] = true; });
    });
    return Object.keys(seen).length;
  }

  function renderStars(el, value, onChange) {
    el.innerHTML = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="star' + (n <= value ? ' on' : '') + '" data-star="' + n +
        '" aria-label="' + n + ' star' + (n === 1 ? '' : 's') + '" aria-pressed="' + (n === value ? 'true' : 'false') + '">\u2605</button>';
    }).join('');
    el.onclick = function (e) {
      var btn = e.target.closest('[data-star]');
      if (!btn) return;
      var n = +btn.getAttribute('data-star');
      onChange(n === value ? 0 : n);
    };
  }

  /* ---------- Place detail ---------- */

  var detailPlace = null;

  function refreshMarkButtons() {
    ['fav', 'want', 'nope'].forEach(function (bucket) {
      var btn = document.querySelector('#detail-marks [data-bucket="' + bucket + '"]');
      if (!btn) return;
      var on = !!(detailPlace && isMarked(detailPlace, bucket));
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function refreshDetailStars() {
    if (!detailPlace) return;
    renderStars($('detail-stars'), getRating(detailPlace), function (n) {
      setRating(detailPlace, n);
      refreshDetailStars();
    });
  }

  function itemLine(it) {
    var extras = (it.extras || []).map(function (e) {
      return escapeHtml(e.label) + (e.cost ? ' +' + fmtMoney(e.cost) : '');
    }).join(', ');
    return '<span class="visit-item-name">' + escapeHtml(it.name || 'Order') + '</span>' +
      (extras ? ' <span class="visit-item-extras">' + extras + '</span>' : '') +
      (it.stars ? ' <span class="visit-item-stars">' + starsText(it.stars) + '</span>' : '');
  }

  function renderVisits() {
    var el = $('detail-visits');
    var visits = detailPlace ? visitsFor(detailPlace) : [];
    if (!visits.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var spent = visits.reduce(function (sum, v) { return sum + visitTotal(v); }, 0);
    el.hidden = false;
    el.innerHTML = '<div class="visits-head"><h3>Your orders</h3><span>' + visits.length + ' visit' +
      (visits.length === 1 ? '' : 's') + ' · ' + fmtMoney(spent) + '</span></div>' +
      visits.slice(0, 20).map(function (v) {
        return '<div class="visit"><div class="visit-top"><span class="visit-when">' + escapeHtml(fmtWhen(v.at)) +
          '</span><span class="visit-total">' + fmtMoney(visitTotal(v)) + '</span>' +
          '<button type="button" class="visit-del" data-del-visit="' + escapeHtml(v.id) + '" aria-label="Remove this order">\u00d7</button></div>' +
          (v.items || []).map(function (it) {
            return '<p class="visit-item">' + itemLine(it) + '<span class="visit-item-price">' + fmtMoney(itemTotal(it)) + '</span></p>';
          }).join('') +
          (v.note ? '<p class="visit-note">' + escapeHtml(v.note) + '</p>' : '') + '</div>';
      }).join('');
  }

  function openDetail(place) {
    var name = place.name || 'Place';
    detailPlace = place;
    $('detail-name').textContent = name;
    $('detail-kinds').innerHTML = kindTagsHtml(place) +
      (cuisineLabel(place) ? '<span class="tag tag-plain">' + escapeHtml(cuisineLabel(place)) + '</span>' : '') +
      (place.loose ? '<span class="tag tag-plain">Not on the map</span>' : '');
    $('detail-meta').textContent = [canonicalNeighborhood(place.neighborhood), place.address].filter(Boolean).join(' · ');
    var hhRow = $('detail-hh-row');
    if (hasSchedule(place)) {
      var hhEl = $('detail-hh');
      hhEl.textContent = hhBlurb(place) || 'No happy hour today';
      hhEl.classList.toggle('on', hhNow(place));
      hhRow.hidden = false;
    } else {
      hhRow.hidden = true;
    }
    renderHoursBlock(place.hours);
    var descParts = [];
    if (place.description) descParts.push(place.description);
    if (place.hoursNote && place.hoursNote !== place.description) descParts.push(place.hoursNote);
    $('detail-desc').textContent = descParts.join('\n\n');
    var links = $('detail-links');
    links.innerHTML = '';
    var ig = place.instagram || place.instagramUrl;
    var site = place.website && place.website !== place.hh_menu ? place.website : '';
    var feature = place.featureUrl && place.featureUrl !== ig ? [place.featureUrl, place.featureLabel || 'Link'] : null;
    [[place.hh_menu, 'Menu'], [site, 'Website'], [ig, 'Instagram'], feature].forEach(function (pair) {
      if (!pair || !pair[0]) return;
      var a = document.createElement('a');
      a.href = pair[0];
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = pair[1];
      links.appendChild(a);
    });
    var maps = $('detail-maps');
    var mu = appleMapsUrl(place, name);
    maps.hidden = !mu;
    if (mu) maps.href = mu;
    refreshMarkButtons();
    refreshDetailStars();
    renderVisits();
    $('detail-overlay').hidden = false;
    $('detail-overlay').querySelector('.sheet').scrollTop = 0;
    document.body.classList.add('sheet-open');
  }

  function closeDetail() {
    $('detail-overlay').hidden = true;
    document.body.classList.remove('sheet-open');
    refreshOpenViews();
  }

  /* Whatever is on screen behind a sheet may show marks, stars or orders that just changed. */
  var refreshDecidePins = function () {};

  function refreshOpenViews() {
    Object.keys(modes).forEach(function (k) {
      var mode = modes[k];
      if (currentScreen !== mode.cfg.screenId) return;
      if (mode.renderPins) mode.renderPins();
      if (mode.view === 'list' && mode.renderList) mode.renderList();
    });
    if (currentScreen === 'screen-decide') refreshDecidePins();
    if (currentScreen === 'screen-saved') renderSaved();
    if (currentScreen === 'screen-home') renderHome();
  }

  function walkMinutesTo(here, p) {
    if (!here || !here.active || !hasCoords(p)) return null;
    var m = PhillyWalkMap.haversineMeters(here.lat, here.lng, p.lat, p.lng);
    return Math.max(1, Math.round(m / PhillyWalkMap.WALK_M_PER_MIN));
  }

  function cardMarks(p) {
    var bits = '';
    var rating = getRating(p);
    if (rating) bits += '<span class="card-stars" aria-label="Rated ' + rating + ' of 5">' + starsText(rating) + '</span>';
    if (isMarked(p, 'nope')) bits += '<span class="card-mark nope">💩 Nope</span>';
    if (isMarked(p, 'fav')) bits += '<span class="card-mark fav">⭐ Favorite</span>';
    if (isMarked(p, 'want')) bits += '<span class="card-mark want">👀 Want to go</span>';
    return bits ? '<span class="card-marks">' + bits + '</span>' : '';
  }

  /* ---------- Map + list screens (coffee, and the joint food & drinks one) ---------- */

  function createMode(cfg) {
    var root = $(cfg.screenId);
    var q = function (sel) { return root.querySelector(sel); };
    var mode = {
      cfg: cfg,
      root: root,
      map: null,
      layer: null,
      here: null,
      view: 'map',
      filter: 'all'
    };

    function places() {
      var list = cfg.getPlaces();
      if (!cfg.filter || mode.filter === 'all') return list;
      return list.filter(function (p) { return cfg.filter(p, mode.filter); });
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

    function searchQuery() {
      return (q('[data-search]').value || '').trim().toLowerCase();
    }

    function filteredPlaces() {
      var search = searchQuery();
      return places().filter(function (p) {
        if (!hasCoords(p)) return false;
        return matchesPlaceSearch(p, search);
      });
    }

    function renderPins() {
      if (!mode.layer) return;
      mode.layer.clearLayers();
      var active = hereActive();
      filteredPlaces().forEach(function (p) {
        var dim = active && !mode.here.isWithin(p.lat, p.lng);
        var pin = addPlacePin([p.lat, p.lng], {
          place: p,
          cafeMug: !!cfg.cafeMug,
          fillColor: cfg.pinColor(p),
          dim: dim,
          label: p.name,
          labelInteractive: true,
          onClick: function () { openDetail(p); }
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
      var search = searchQuery();
      var here = mode.here ? mode.here.getState() : null;
      var active = hereActive();
      var list = places().filter(function (p) {
        if (active && (!hasCoords(p) || !mode.here.isWithin(p.lat, p.lng))) return false;
        return matchesPlaceSearch(p, search);
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
      mode.lastList = list;
      if (!list.length) {
        listEl.innerHTML = '<p class="empty-state">' +
          (active ? 'Nothing inside this walk. Try a longer walk on the map.' : 'No matches.') + '</p>';
        return;
      }
      listEl.innerHTML = list.map(function (p, i) {
        var metaParts = [];
        if (active && p._walk != null) metaParts.push(p._walk + ' min walk');
        if (cfg.metaLead && cfg.metaLead(p)) metaParts.push(cfg.metaLead(p));
        var hood = canonicalNeighborhood(p.neighborhood);
        if (hood) metaParts.push(hood);
        else if (p.address) metaParts.push(p.address);
        var badge = cfg.badge ? cfg.badge(p) : '';
        return '<button type="button" class="place-card" data-idx="' + i + '">' +
          '<span class="name"><span class="dot" style="background:' + cfg.pinColor(p) + '"></span>' +
          '<span class="name-text">' + escapeHtml(p.name) + '</span>' + badge + '</span>' +
          (metaParts.length ? '<span class="meta">' + escapeHtml(metaParts.join(' · ')) + '</span>' : '') +
          cardMarks(p) + '</button>';
      }).join('');
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

    function setFilter(name) {
      mode.filter = name || 'all';
      var chips = q('[data-filter-chips]');
      if (chips) {
        chips.querySelectorAll('[data-filter]').forEach(function (b) {
          var on = b.getAttribute('data-filter') === mode.filter;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      }
      updateSub();
      renderPins();
      if (mode.view === 'list') renderList();
    }

    function show() {
      showScreen(cfg.screenId);
      var first = !mode.map;
      ensureMap();
      if (!mode.map) return;
      mode.map.invalidateSize();
      if (first) PhillyWalkMap.fit(mode.map, [28, 28]);
      renderPins();
      updateSub();
      if (mode.view === 'list') renderList();
    }

    root.querySelector('[data-back]').addEventListener('click', function () { openHome(); });
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
    q('[data-search]').addEventListener('input', function () {
      renderPins();
      if (mode.view === 'list') renderList();
    });
    var chipsEl = q('[data-filter-chips]');
    if (chipsEl) {
      chipsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-filter]');
        if (btn) setFilter(btn.getAttribute('data-filter'));
      });
    }
    q('[data-list]').addEventListener('click', function (e) {
      var card = e.target.closest('.place-card');
      if (!card || !mode.lastList) return;
      var p = mode.lastList[+card.getAttribute('data-idx')];
      if (p) openDetail(p);
    });
    q('[data-list-note]').addEventListener('click', function (e) {
      if (e.target.closest('[data-list-clear]') && mode.here) mode.here.clear();
    });

    mode.show = show;
    mode.renderList = renderList;
    mode.renderPins = renderPins;
    mode.setFilter = setFilter;
    return mode;
  }

  /* ---------- Happy hour page ---------- */

  var scheduleReturn = 'screen-home';
  var scheduleFocus = '';

  function openSchedule(returnTo, focusName) {
    scheduleReturn = returnTo || 'screen-home';
    scheduleFocus = focusName || '';
    $('schedule-search').value = '';
    nSel.value = '';
    $('filter-hh-now').checked = true;
    showScreen('screen-schedule');
    renderGrid();
    /* Land on the current time column (and the place you came from), not on 10 AM. */
    var wrap = document.querySelector('.grid-wrap');
    var col = document.querySelector('#grid th.time-header.selected-col');
    var lead = document.querySelector('#grid th.rest');
    var row = document.querySelector('#grid tr.focus-row');
    wrap.scrollLeft = col ? Math.max(0, col.offsetLeft - (lead ? lead.offsetWidth : 0) - 64) : 0;
    wrap.scrollTop = row ? Math.max(0, row.offsetTop - wrap.clientHeight / 2) : 0;
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
    var q = ($('schedule-search').value || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (r) {
        return (r.name + ' ' + (r.neighborhood || '') + ' ' + (r.address || '')).toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function renderGrid() {
    var nowMode = $('filter-hh-now').checked;
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
      $('summary').textContent = 'No happy hours for these filters.';
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
    $('summary').innerHTML = head +
      (activeNow.length ? ': ' + activeNow.map(function (r) {
        return '<button type="button" class="rest-link" data-key="' + escapeHtml(r.keys[0]) + '">' + escapeHtml(r.name) + '</button>';
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
      return '<tr' + (scheduleFocus && r.name === scheduleFocus ? ' class="focus-row"' : '') +
        '><td class="rest"><button type="button" class="rest-link" data-key="' + escapeHtml(r.keys[0]) + '">' +
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
    hhRestaurants = allPlaces.filter(hasSchedule);
    rebuildNeighborhoods();
    DAY_NAMES.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      daySel.appendChild(opt);
    });
    daySel.value = getTodayDayName();
    buildTimeOptions(daySel.value, getNowSlot());
  }

  /* ---------- Home: "I'm here", the pick-a-place carousel, shortcuts ---------- */

  var pickFilter = 'any';
  var picks = [];
  var PICK_COUNT = 8;

  function pickPool() {
    return allPlaces.filter(function (p) {
      if (pickFilter === 'hh') return hhNow(p);
      if (pickFilter === 'saved') return isMarked(p, 'fav') || isMarked(p, 'want');
      if (pickFilter === 'any') return true;
      return !!p.kinds[pickFilter];
    });
  }

  /* Random, but leaning toward places you could walk into right now and ones you already flagged. */
  function pickWeight(p) {
    var w = 1;
    var st = hoursOpenStatus(p);
    if (st === 'open') w *= 3;
    else if (st === 'closed') w *= 0.12;
    if (hhNow(p)) w *= 4;
    else if (hhToday(p)) w *= 1.4;
    if (isMarked(p, 'want')) w *= 2.5;
    if (isMarked(p, 'fav')) w *= 2;
    if (!p._uniqueName) w *= 0.25;
    /* A card with nothing to say about the place is not much help choosing. */
    if (!cuisineLabel(p) && !snippet(p)) w *= st === 'unknown' ? 0.05 : 0.4;
    return w;
  }

  function shufflePicks() {
    var pool = pickPool().map(function (p) { return { p: p, w: pickWeight(p) }; });
    picks = [];
    while (pool.length && picks.length < PICK_COUNT) {
      var total = pool.reduce(function (sum, row) { return sum + row.w; }, 0);
      var roll = Math.random() * total;
      var idx = 0;
      for (var i = 0; i < pool.length; i++) {
        roll -= pool[i].w;
        if (roll <= 0) { idx = i; break; }
      }
      picks.push(pool[idx].p);
      pool.splice(idx, 1);
    }
  }

  function renderPicks() {
    var track = $('pick-track');
    if (!picks.length) {
      var msg = pickFilter === 'hh'
        ? 'No happy hour is on right now.'
        : (pickFilter === 'saved' ? 'Nothing on your list yet. Open a place and tap ⭐ or 👀.' : 'Nothing to suggest.');
      track.innerHTML = '<div class="pick-card pick-empty"><p>' + msg + '</p>' +
        (pickFilter === 'hh' ? '<button type="button" class="btn-small" data-pick-schedule>See today’s happy hours</button>' : '') + '</div>';
      return;
    }
    track.innerHTML = picks.map(function (p, i) {
      var pills = '';
      var hh = hhBlurb(p);
      if (hh) {
        pills += '<button type="button" class="pill pill-hh' + (hhNow(p) ? ' on' : '') + '" data-pick-hh="' + i + '">' +
          escapeHtml(hh) + ' \u203a</button>';
      }
      var label = cuisineLabel(p);
      if (label) pills += '<span class="pill pill-cuisine">' + escapeHtml(label) + '</span>';
      if (p.featureUrl) {
        pills += '<a class="pill pill-feature" href="' + escapeHtml(p.featureUrl) + '" target="_blank" rel="noopener">' +
          escapeHtml(p.featureLabel || 'Link') + '</a>';
      }
      var open = openBlurb(p);
      if (open) pills += '<span class="pill ' + (open === 'Closed now' ? 'pill-closed' : 'pill-open') + '">' + escapeHtml(open) + '</span>';
      if (isMarked(p, 'nope')) pills += '<span class="pill pill-nope">💩 Nope</span>';
      if (isMarked(p, 'fav')) pills += '<span class="pill pill-saved">⭐ Favorite</span>';
      else if (isMarked(p, 'want')) pills += '<span class="pill pill-saved">👀 Want to go</span>';
      var rating = getRating(p);
      if (rating) pills += '<span class="pill pill-stars">' + starsText(rating) + '</span>';
      var text = snippet(p, 130);
      if (!text && !pills) text = 'No hours or notes on file yet — tap Details for the address and links.';
      var maps = appleMapsUrl(p, p.name);
      return '<article class="pick-card" data-pick-card="' + i + '">' +
        '<div class="tag-row">' + kindTagsHtml(p) +
        (p.neighborhood ? '<span class="pick-hood">' + escapeHtml(p.neighborhood) + '</span>' : '') + '</div>' +
        '<h3>' + escapeHtml(p.name) + '</h3>' +
        '<div class="pill-row">' + pills + '</div>' +
        (text ? '<p class="pick-desc">' + escapeHtml(text) + '</p>' : '') +
        '<div class="pick-actions"><button type="button" class="btn-small solid" data-pick-details="' + i + '">Details</button>' +
        (maps ? '<a class="btn-small" href="' + escapeHtml(maps) + '" target="_blank" rel="noopener">Maps</a>' : '') +
        '<span class="pick-count">' + (i + 1) + ' / ' + picks.length + '</span></div></article>';
    }).join('');
  }

  function renderHome() {
    picks = picks.filter(function (p) { return pickFilter !== 'saved' || isMarked(p, 'fav') || isMarked(p, 'want'); });
    renderPicks();
    var nowCount = hhRestaurants.filter(hhNow).length;
    var todayCount = hhRestaurants.filter(hhToday).length;
    $('home-hh').innerHTML = (nowCount
      ? '<strong>' + nowCount + '</strong> happy hour' + (nowCount === 1 ? '' : 's') + ' on right now'
      : '<strong>' + todayCount + '</strong> happy hour' + (todayCount === 1 ? '' : 's') + ' today') +
      '<span aria-hidden="true">\u203a</span>';
    $('home-hh').classList.toggle('on', nowCount > 0);
    var saved = savedCount();
    $('home-count-saved').textContent = saved
      ? saved + ' saved · ' + store.visits.length + ' order' + (store.visits.length === 1 ? '' : 's') + ' logged'
      : 'Favorites & want to go';
    $('home-count-coffee').textContent = placesOf('coffee').length + ' cafes & roasters';
    $('home-count-eat').textContent = eatPlaces().length + ' restaurants, bars & cafes';
    $('home-status').textContent = allPlaces.length + ' places · ' + hhRestaurants.length + ' with happy hours';
  }

  function openHome() {
    showScreen('screen-home');
    if (!picks.length) shufflePicks();
    renderHome();
  }

  function setPickFilter(name) {
    pickFilter = name;
    document.querySelectorAll('#pick-filters [data-pick-filter]').forEach(function (b) {
      var on = b.getAttribute('data-pick-filter') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    shufflePicks();
    renderPicks();
    $('pick-track').scrollLeft = 0;
  }

  function eatPlaces() {
    return allPlaces.filter(function (p) { return p.kinds.food || p.kinds.drinks || p.kinds.coffee; });
  }

  /* ---------- "I'm here": find the place, then log the order ---------- */

  var hereFix = null;
  var hereRows = [];

  function recentVisitPlaces() {
    var seen = {};
    var out = [];
    store.visits.slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).forEach(function (v) {
      var p = resolvePlace(v.key);
      if (seen[p.keys[0]]) return;
      seen[p.keys[0]] = true;
      out.push(p);
    });
    return out.slice(0, 6);
  }

  function renderHereList() {
    var q = ($('here-search').value || '').trim();
    var ql = q.toLowerCase();
    var rows;
    if (ql) {
      rows = allPlaces.filter(function (p) { return matchesPlaceSearch(p, ql); });
    } else if (hereFix) {
      rows = allPlaces.filter(hasCoords);
    } else {
      rows = recentVisitPlaces();
    }
    if (hereFix) {
      rows = rows.map(function (p) {
        p._meters = hasCoords(p) ? PhillyWalkMap.haversineMeters(hereFix.lat, hereFix.lng, p.lat, p.lng) : Infinity;
        return p;
      }).sort(function (a, b) { return a._meters - b._meters || a.name.localeCompare(b.name); });
    }
    hereRows = rows.slice(0, ql ? 30 : 8);
    var html = hereRows.map(function (p, i) {
      var meta = [];
      if (hereFix && isFinite(p._meters)) meta.push(fmtDistance(p._meters));
      if (p.neighborhood) meta.push(p.neighborhood);
      var n = visitsFor(p).length;
      if (n) meta.push(n + ' order' + (n === 1 ? '' : 's') + ' logged');
      return '<button type="button" class="place-card" data-here-idx="' + i + '">' +
        '<span class="name"><span class="name-text">' + escapeHtml(p.name) + '</span>' +
        (hereFix && !ql && i === 0 && p._meters < 120 ? '<span class="near-pill">Closest</span>' : '') + '</span>' +
        '<span class="tag-row">' + kindTagsHtml(p) + '</span>' +
        (meta.length ? '<span class="meta">' + escapeHtml(meta.join(' · ')) + '</span>' : '') + '</button>';
    }).join('');
    var exact = ql && hereRows.some(function (p) { return p.name.toLowerCase() === ql; });
    if (q && !exact) {
      html += '<button type="button" class="place-card place-card-new" data-here-new>' +
        '<span class="name"><span class="name-text">Log at “' + escapeHtml(q) + '”</span></span>' +
        '<span class="meta">Not on the map — keep it as your own place</span></button>';
    }
    if (!html) {
      html = '<p class="empty-state">' + (hereFix ? 'Nothing nearby. Type the name instead.' : 'Type the name of the place you’re at.') + '</p>';
    }
    $('here-list').innerHTML = html;
  }

  function openHere() {
    hereFix = null;
    $('here-search').value = '';
    $('here-status').textContent = 'Finding the places closest to you…';
    $('here-overlay').hidden = false;
    document.body.classList.add('sheet-open');
    renderHereList();
    if (!navigator.geolocation) {
      $('here-status').textContent = 'No location on this device — type the name.';
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if ($('here-overlay').hidden) return;
      hereFix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $('here-status').textContent = 'Closest to you first. Tap where you are.';
      renderHereList();
    }, function () {
      if ($('here-overlay').hidden) return;
      $('here-status').textContent = 'Couldn’t get your location — type the name.';
      renderHereList();
    }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
  }

  function closeHere() {
    $('here-overlay').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  var EXTRA_GROUPS = [
    { id: 'milk', label: 'Milk', single: true, options: [
      { id: 'whole', label: 'Whole milk', chip: 'Whole' },
      { id: 'skim', label: 'Skim milk', chip: 'Skim' },
      { id: 'almond', label: 'Almond milk', chip: 'Almond' },
      { id: 'oat', label: 'Oat milk', chip: 'Oat' }
    ] },
    { id: 'flavor', label: 'Flavor', other: 'Other flavor', options: [
      { id: 'vanilla', label: 'Vanilla', chip: 'Vanilla' },
      { id: 'caramel', label: 'Caramel', chip: 'Caramel' },
      { id: 'hazelnut', label: 'Hazelnut', chip: 'Hazelnut' },
      { id: 'mocha', label: 'Mocha', chip: 'Mocha' },
      { id: 'lavender', label: 'Lavender', chip: 'Lavender' },
      { id: 'honey', label: 'Honey', chip: 'Honey' }
    ] },
    { id: 'more', label: 'More', other: 'Something else', options: [
      { id: 'shot', label: 'Extra shot', chip: 'Extra shot' }
    ] }
  ];
  var QUICK_COSTS = [0.5, 0.75];
  var SUGGEST = {
    coffee: ['Latte', 'Cappuccino', 'Drip coffee', 'Cold brew', 'Americano', 'Cortado', 'Espresso', 'Mocha', 'Matcha latte', 'Chai latte', 'Tea', 'Pastry'],
    drinks: ['Beer', 'Cocktail', 'Wine', 'Margarita', 'Happy hour special', 'Appetizer'],
    food: ['Entrée', 'Sandwich', 'Appetizer', 'Dessert', 'Drink']
  };

  var logState = null;

  function emptyDraft() {
    return { name: '', price: '', extras: [], stars: 0 };
  }

  function draftHasContent(d) {
    return !!(String(d.name).trim() || parseMoney(d.price) != null || d.extras.length || d.stars);
  }

  function draftToItem(d) {
    return {
      name: String(d.name).trim() || 'Order',
      price: parseMoney(d.price),
      extras: d.extras.map(function (e) {
        var extra = { id: e.id, group: e.group, label: e.label, cost: +e.cost || 0 };
        if (e.custom) extra.custom = true;
        return extra;
      }),
      stars: d.stars || 0
    };
  }

  function findOption(groupId, id) {
    var group = EXTRA_GROUPS.filter(function (g) { return g.id === groupId; })[0];
    if (!group) return null;
    return group.options.filter(function (o) { return o.id === id; })[0] || null;
  }

  function rememberedCost(extraId) {
    if (!logState) return null;
    var here = store.extraCosts[logState.place.keys[0] + '|' + extraId];
    if (typeof here === 'number') return here;
    var any = store.extraCosts[extraId];
    return typeof any === 'number' ? any : null;
  }

  function historySuggestions(place) {
    var seen = {};
    var out = [];
    visitsFor(place).forEach(function (v) {
      (v.items || []).forEach(function (it) {
        var k = nameKey(it.name);
        if (!k || seen[k] || it.name === 'Order') return;
        seen[k] = true;
        out.push(it);
      });
    });
    return out.slice(0, 4);
  }

  function renderLogSuggest() {
    var place = logState.place;
    var again = historySuggestions(place);
    var seen = {};
    again.forEach(function (it) { seen[nameKey(it.name)] = true; });
    var names = [];
    KIND_ORDER.forEach(function (k) {
      if (!place.kinds[k]) return;
      SUGGEST[k].forEach(function (n) {
        if (seen[nameKey(n)]) return;
        seen[nameKey(n)] = true;
        names.push(n);
      });
    });
    if (!names.length && !again.length) names = SUGGEST.coffee.slice(0, 6).concat(SUGGEST.food.slice(0, 3));
    logState.again = again;
    $('log-suggest').innerHTML = again.map(function (it, i) {
      return '<button type="button" class="chip chip-again" data-again="' + i + '">' + escapeHtml(it.name) +
        (it.price != null || (it.extras || []).length ? ' · ' + fmtMoney(itemTotal(it)) : '') + '</button>';
    }).join('') + names.slice(0, 12).map(function (n) {
      return '<button type="button" class="chip" data-suggest="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>';
    }).join('');
  }

  function renderLogExtras() {
    var d = logState.draft;
    var prompt = logState.prompt;
    var wrap = $('log-extras');
    var toggle = $('log-extras-toggle');
    toggle.hidden = logState.showExtras;
    wrap.hidden = !logState.showExtras;
    if (!logState.showExtras) return;
    wrap.innerHTML = EXTRA_GROUPS.map(function (group) {
      var chips = group.options.map(function (o) {
        var picked = d.extras.filter(function (e) { return e.id === o.id; })[0];
        return '<button type="button" class="chip chip-extra' + (picked ? ' active' : '') + '" data-extra="' + o.id +
          '" data-group="' + group.id + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' + escapeHtml(o.chip) +
          (picked && picked.cost ? ' <b>+' + fmtMoney(picked.cost) + '</b>' : '') + '</button>';
      }).join('');
      chips += d.extras.filter(function (e) { return e.group === group.id && e.custom; }).map(function (e) {
        return '<button type="button" class="chip chip-extra active" data-extra="' + escapeHtml(e.id) + '" data-group="' + group.id +
          '" aria-pressed="true">' + escapeHtml(e.label) + (e.cost ? ' <b>+' + fmtMoney(e.cost) + '</b>' : '') + '</button>';
      }).join('');
      if (group.other) {
        chips += '<button type="button" class="chip chip-other" data-extra-other="' + group.id + '">+ Other</button>';
      }
      var html = '<p class="field-label">' + group.label + '</p><div class="chip-row wrap">' + chips + '</div>';
      if (prompt && prompt.group === group.id) html += costPromptHtml(group, prompt);
      return html;
    }).join('');
  }

  function costPromptHtml(group, prompt) {
    var title;
    var known = null;
    if (prompt.custom) {
      title = '<strong>' + escapeHtml(group.other) + '</strong> — what did it cost?';
    } else {
      var opt = findOption(group.id, prompt.id);
      title = '<strong>' + escapeHtml(opt ? opt.label : 'Extra') + '</strong> — did it cost extra?';
      known = rememberedCost(prompt.id);
    }
    var costs = QUICK_COSTS.slice();
    if (known && costs.indexOf(known) < 0) costs.push(known);
    return '<div class="cost-prompt" id="log-cost">' +
      '<p class="cost-title">' + title + '</p>' +
      (prompt.custom ? '<input type="text" class="field" id="log-cost-name" placeholder="What was it? (pistachio, whipped cream…)" autocomplete="off" />' : '') +
      '<div class="cost-options">' +
      '<button type="button" class="cost-btn' + (known === 0 ? ' last' : '') + '" data-cost="0">No charge</button>' +
      costs.map(function (c) {
        return '<button type="button" class="cost-btn' + (known === c ? ' last' : '') + '" data-cost="' + c + '">+' + fmtMoney(c) +
          (known === c ? '<small>last time</small>' : '') + '</button>';
      }).join('') +
      '<span class="money-field mini"><span aria-hidden="true">$</span><input type="text" inputmode="decimal" id="log-cost-other" placeholder="Other" autocomplete="off" enterkeyhint="done" /></span>' +
      '<button type="button" class="cost-btn set" data-cost-set>Add</button>' +
      '</div></div>';
  }

  function renderLogItems() {
    var el = $('log-items');
    var items = logState.items;
    el.hidden = !items.length;
    el.innerHTML = items.map(function (it, i) {
      return '<div class="log-item"><p class="visit-item">' + itemLine(it) + '<span class="visit-item-price">' + fmtMoney(itemTotal(it)) + '</span></p>' +
        '<button type="button" class="visit-del" data-del-item="' + i + '" aria-label="Remove ' + escapeHtml(it.name) + '">\u00d7</button></div>';
    }).join('');
    $('log-name-label').textContent = items.length ? 'Next item' : 'What did you get?';
  }

  function renderLogTotals() {
    var d = logState.draft;
    var draftItem = draftToItem(d);
    var hasDraft = draftHasContent(d);
    var extrasSum = d.extras.reduce(function (sum, e) { return sum + (+e.cost || 0); }, 0);
    $('log-item-total').textContent = hasDraft && (draftItem.price != null || extrasSum)
      ? 'This item ' + fmtMoney(itemTotal(draftItem)) + (extrasSum ? ' (incl. ' + fmtMoney(extrasSum) + ' extras)' : '')
      : '';
    var total = logState.items.reduce(function (sum, it) { return sum + itemTotal(it); }, 0) + (hasDraft ? itemTotal(draftItem) : 0);
    var count = logState.items.length + (hasDraft ? 1 : 0);
    $('log-save').textContent = count
      ? 'Save ' + (count === 1 ? 'order' : count + ' items') + ' · ' + fmtMoney(total)
      : 'Save order';
  }

  function renderLogStars() {
    renderStars($('log-item-stars'), logState.draft.stars, function (n) {
      logState.draft.stars = n;
      renderLogStars();
      renderLogTotals();
    });
    renderStars($('log-place-stars'), logState.placeStars, function (n) {
      logState.placeStars = n;
      renderLogStars();
    });
  }

  function renderLogForm() {
    $('log-name').value = logState.draft.name;
    $('log-price').value = logState.draft.price;
    renderLogItems();
    renderLogSuggest();
    renderLogExtras();
    renderLogStars();
    renderLogTotals();
  }

  function openLog(place) {
    logState = {
      place: place,
      items: [],
      draft: emptyDraft(),
      prompt: null,
      placeStars: getRating(place),
      showExtras: !!place.kinds.coffee || !KIND_ORDER.some(function (k) { return place.kinds[k]; }),
      again: []
    };
    $('log-where').textContent = 'At ' + place.name + ' · ' + fmtWhen(new Date().toISOString());
    $('log-note').value = '';
    renderLogForm();
    $('detail-overlay').hidden = true;
    $('here-overlay').hidden = true;
    $('log-overlay').hidden = false;
    $('log-overlay').querySelector('.sheet').scrollTop = 0;
    document.body.classList.add('sheet-open');
  }

  function closeLog() {
    $('log-overlay').hidden = true;
    document.body.classList.remove('sheet-open');
    logState = null;
  }

  function tapExtra(groupId, id) {
    var d = logState.draft;
    var group = EXTRA_GROUPS.filter(function (g) { return g.id === groupId; })[0];
    var at = -1;
    d.extras.forEach(function (e, i) { if (e.id === id) at = i; });
    if (at >= 0) {
      d.extras.splice(at, 1);
      if (logState.prompt && logState.prompt.id === id) logState.prompt = null;
    } else {
      var opt = findOption(groupId, id);
      if (!opt) return;
      if (group.single) d.extras = d.extras.filter(function (e) { return e.group !== groupId; });
      d.extras.push({ id: id, group: groupId, label: opt.label, cost: 0 });
      logState.prompt = { group: groupId, id: id };
    }
    renderLogExtras();
    renderLogTotals();
    var prompt = $('log-cost');
    if (prompt) prompt.scrollIntoView({ block: 'nearest' });
  }

  function applyCost(cost) {
    var prompt = logState.prompt;
    if (!prompt) return;
    cost = Math.round((+cost || 0) * 100) / 100;
    var d = logState.draft;
    if (prompt.custom) {
      var group = EXTRA_GROUPS.filter(function (g) { return g.id === prompt.group; })[0];
      var nameEl = $('log-cost-name');
      var label = (nameEl && nameEl.value.trim()) || group.other;
      d.extras.push({ id: 'custom-' + Date.now().toString(36), group: prompt.group, label: label, cost: cost, custom: true });
    } else {
      d.extras.forEach(function (e) { if (e.id === prompt.id) e.cost = cost; });
    }
    logState.prompt = null;
    renderLogExtras();
    renderLogTotals();
  }

  function addLogItem() {
    if (!draftHasContent(logState.draft)) {
      toast('Add what you ordered first');
      $('log-name').focus();
      return false;
    }
    logState.items.push(draftToItem(logState.draft));
    logState.draft = emptyDraft();
    logState.prompt = null;
    renderLogForm();
    return true;
  }

  function saveLog() {
    if (draftHasContent(logState.draft)) logState.items.push(draftToItem(logState.draft));
    if (!logState.items.length) {
      toast('Add what you ordered first');
      $('log-name').focus();
      return;
    }
    var place = logState.place;
    var visit = {
      id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      key: place.keys[0],
      name: place.name,
      at: new Date().toISOString(),
      items: logState.items,
      note: $('log-note').value.trim()
    };
    store.visits.push(visit);
    visit.items.forEach(function (it) {
      it.extras.forEach(function (e) {
        if (e.custom) return;
        store.extraCosts[e.id] = e.cost;
        store.extraCosts[place.keys[0] + '|' + e.id] = e.cost;
      });
    });
    if (logState.placeStars !== getRating(place)) setRating(place, logState.placeStars);
    else saveStore();
    var total = visitTotal(visit);
    closeLog();
    toast('Saved · ' + fmtMoney(total));
    openDetail(place);
  }

  function initLog() {
    $('home-here').addEventListener('click', openHere);
    $('here-close').addEventListener('click', closeHere);
    $('here-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'here-overlay') closeHere();
    });
    $('here-search').addEventListener('input', renderHereList);
    $('here-list').addEventListener('click', function (e) {
      var fresh = e.target.closest('[data-here-new]');
      if (fresh) {
        var name = $('here-search').value.trim();
        if (name) openLog(loosePlace('custom:' + nameKey(name), name));
        return;
      }
      var card = e.target.closest('[data-here-idx]');
      if (card && hereRows[+card.getAttribute('data-here-idx')]) openLog(hereRows[+card.getAttribute('data-here-idx')]);
    });
    $('detail-here').addEventListener('click', function () {
      if (detailPlace) openLog(detailPlace);
    });

    $('log-cancel').addEventListener('click', function () {
      var place = logState && logState.place;
      var dirty = logState && (logState.items.length || draftHasContent(logState.draft));
      if (dirty && !window.confirm('Discard this order?')) return;
      closeLog();
      if (place && !place.loose) openDetail(place);
      else refreshOpenViews();
    });
    $('log-name').addEventListener('input', function (e) {
      logState.draft.name = e.target.value;
      renderLogTotals();
    });
    $('log-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('log-price').focus(); }
    });
    $('log-price').addEventListener('input', function (e) {
      logState.draft.price = e.target.value;
      renderLogTotals();
    });
    $('log-price').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('log-suggest').addEventListener('click', function (e) {
      var again = e.target.closest('[data-again]');
      if (again) {
        var it = logState.again[+again.getAttribute('data-again')];
        if (!it) return;
        logState.draft.name = it.name;
        logState.draft.price = it.price != null ? it.price.toFixed(2) : '';
        logState.draft.extras = (it.extras || []).map(function (x) { return Object.assign({}, x); });
        if (logState.draft.extras.length) logState.showExtras = true;
        logState.prompt = null;
        renderLogForm();
        return;
      }
      var chip = e.target.closest('[data-suggest]');
      if (!chip) return;
      logState.draft.name = chip.getAttribute('data-suggest');
      $('log-name').value = logState.draft.name;
      renderLogTotals();
      if (!$('log-price').value) $('log-price').focus();
    });
    $('log-extras-toggle').addEventListener('click', function () {
      logState.showExtras = true;
      renderLogExtras();
    });
    $('log-extras').addEventListener('click', function (e) {
      var cost = e.target.closest('[data-cost]');
      if (cost) { applyCost(+cost.getAttribute('data-cost')); return; }
      if (e.target.closest('[data-cost-set]')) {
        var amount = parseMoney($('log-cost-other').value);
        if (amount == null) { toast('Type the extra amount'); $('log-cost-other').focus(); return; }
        applyCost(amount);
        return;
      }
      var other = e.target.closest('[data-extra-other]');
      if (other) {
        logState.prompt = { group: other.getAttribute('data-extra-other'), custom: true };
        renderLogExtras();
        var nameEl = $('log-cost-name');
        if (nameEl) nameEl.focus();
        return;
      }
      var chip = e.target.closest('[data-extra]');
      if (chip) tapExtra(chip.getAttribute('data-group'), chip.getAttribute('data-extra'));
    });
    $('log-extras').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.id !== 'log-cost-other') return;
      e.preventDefault();
      var amount = parseMoney(e.target.value);
      if (amount != null) applyCost(amount);
    });
    $('log-items').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del-item]');
      if (!del) return;
      logState.items.splice(+del.getAttribute('data-del-item'), 1);
      renderLogItems();
      renderLogTotals();
    });
    $('log-add').addEventListener('click', function () {
      if (addLogItem()) $('log-name').focus();
    });
    $('log-save').addEventListener('click', saveLog);
  }

  /* ---------- Places to try ---------- */

  var savedFilter = 'all';
  var savedRows = [];

  function savedEntries() {
    var byPrimary = {};
    function entry(p) {
      var k = p.keys[0];
      if (!byPrimary[k]) byPrimary[k] = { place: p, fav: false, want: false, nope: false, visits: [] };
      return byPrimary[k];
    }
    Object.keys(store.fav).forEach(function (k) { entry(resolvePlace(k)).fav = true; });
    Object.keys(store.want).forEach(function (k) { entry(resolvePlace(k)).want = true; });
    Object.keys(store.nope).forEach(function (k) { entry(resolvePlace(k)).nope = true; });
    store.visits.forEach(function (v) { entry(resolvePlace(v.key)).visits.push(v); });
    return Object.keys(byPrimary).map(function (k) {
      var row = byPrimary[k];
      row.visits.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      return row;
    });
  }

  function renderSaved() {
    var all = savedEntries();
    var counts = {
      all: all.filter(function (r) { return r.fav || r.want; }).length,
      want: all.filter(function (r) { return r.want; }).length,
      fav: all.filter(function (r) { return r.fav; }).length,
      visited: all.filter(function (r) { return r.visits.length; }).length,
      nope: all.filter(function (r) { return r.nope; }).length
    };
    var labels = [['all', 'All'], ['want', 'Want to go'], ['fav', 'Favorites'], ['nope', 'Nope'], ['visited', 'Visited']];
    $('saved-filters').innerHTML = labels.map(function (pair) {
      var on = pair[0] === savedFilter;
      return '<button type="button" class="chip' + (on ? ' active' : '') + '" data-saved-filter="' + pair[0] +
        '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' + pair[1] + ' <b>' + counts[pair[0]] + '</b></button>';
    }).join('');
    savedRows = all.filter(function (r) {
      if (savedFilter === 'want') return r.want;
      if (savedFilter === 'fav') return r.fav;
      if (savedFilter === 'visited') return r.visits.length > 0;
      if (savedFilter === 'nope') return r.nope;
      return r.fav || r.want;
    });
    if (savedFilter === 'visited') {
      savedRows.sort(function (a, b) { return String(b.visits[0].at).localeCompare(String(a.visits[0].at)); });
    } else {
      /* Still-to-try first: that is what this page is for. */
      savedRows.sort(function (a, b) {
        return (b.want - a.want) || a.place.name.localeCompare(b.place.name);
      });
    }
    $('saved-sub').textContent = counts.want + ' to try · ' + counts.fav + ' favorite' + (counts.fav === 1 ? '' : 's') +
      ' · ' + counts.visited + ' visited';
    if (!savedRows.length) {
      var empty = {
        all: 'Nothing here yet. Open a place and tap ⭐ or 👀.',
        want: 'Nothing you want to go to yet. Open a place and tap 👀.',
        fav: 'No favorites yet. Open a place and tap ⭐.',
        nope: 'No nopes yet. Open a place and tap 💩 for somewhere you would not recommend.',
        visited: 'No orders logged yet. Tap “I’m here right now” when you’re at a place.'
      };
      $('saved-list').innerHTML = '<p class="empty-state">' + empty[savedFilter] + '</p>';
      return;
    }
    $('saved-list').innerHTML = savedRows.map(function (row, i) {
      var p = row.place;
      var pills = '';
      if (row.nope) pills += '<span class="pill pill-nope">💩 Nope</span>';
      if (row.want) pills += '<span class="pill pill-want">👀 Want to go</span>';
      if (row.fav) pills += '<span class="pill pill-saved">⭐ Favorite</span>';
      if (hhNow(p)) pills += '<span class="pill pill-hh on">Happy hour now</span>';
      var open = openBlurb(p);
      if (open) pills += '<span class="pill ' + (open === 'Closed now' ? 'pill-closed' : 'pill-open') + '">' + escapeHtml(open) + '</span>';
      var rating = getRating(p);
      if (rating) pills += '<span class="pill pill-stars">' + starsText(rating) + '</span>';
      var meta = [cuisineLabel(p), p.neighborhood].filter(Boolean);
      var last = row.visits[0];
      var lastLine = last
        ? row.visits.length + ' order' + (row.visits.length === 1 ? '' : 's') + ' · last ' + fmtMoney(visitTotal(last)) +
          ' on ' + fmtWhen(last.at).split(' · ')[0]
        : '';
      return '<button type="button" class="place-card saved-card" data-saved-idx="' + i + '">' +
        '<span class="name"><span class="name-text">' + escapeHtml(p.name) + '</span></span>' +
        '<span class="tag-row">' + kindTagsHtml(p) +
        (meta.length ? '<span class="pick-hood">' + escapeHtml(meta.join(' · ')) + '</span>' : '') + '</span>' +
        '<span class="pill-row">' + pills + '</span>' +
        (lastLine ? '<span class="meta">' + escapeHtml(lastLine) + '</span>' : '') + '</button>';
    }).join('');
  }

  function openSaved() {
    showScreen('screen-saved');
    renderSaved();
  }

  function initSaved() {
    $('saved-back').addEventListener('click', openHome);
    $('saved-filters').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-saved-filter]');
      if (!btn) return;
      savedFilter = btn.getAttribute('data-saved-filter');
      renderSaved();
    });
    $('saved-list').addEventListener('click', function (e) {
      var card = e.target.closest('[data-saved-idx]');
      var row = card && savedRows[+card.getAttribute('data-saved-idx')];
      if (row) openDetail(row.place);
    });
  }

  /* ---------- Help me decide ---------- */

  var DECIDE_SETTINGS_KEY = 'coffee-drinks-decide-v1';
  var CUISINES = [
    { id: 'mexican', label: 'Mexican' },
    { id: 'thai', label: 'Thai' },
    { id: 'pizza', label: 'Pizza' },
    { id: 'bar', label: 'Bar food' },
    { id: 'cafe', label: 'Cafe' },
    { id: 'indian', label: 'Indian' },
    { id: 'chinese', label: 'Chinese' },
    { id: 'japanese', label: 'Japanese / sushi' },
    { id: 'italian', label: 'Italian' },
    { id: 'vietnamese', label: 'Vietnamese' },
    { id: 'greek', label: 'Greek' },
    { id: 'korean', label: 'Korean' },
    { id: 'seafood', label: 'Seafood' },
    { id: 'burgers', label: 'Burgers' },
    { id: 'mediterranean', label: 'Mediterranean' }
  ];
  var CUISINE_RE = {
    mexican: /mexican|taco|taqueria|cantina|burrito|quesadilla|tex-mex/,
    thai: /\bthai\b|pad thai/,
    pizza: /pizza|pizzeria/,
    bar: /\bbar\b|pub\b|tavern|wings|happy hour/,
    cafe: /\bcafe\b|caf\u00e9|coffee|bakery|brunch/,
    indian: /indian|tandoor|naan|tikka|curry/,
    chinese: /chinese|szechuan|sichuan|dim sum|dumpling/,
    japanese: /japanese|sushi|ramen|izakaya/,
    italian: /italian|pasta|trattoria|osteria/,
    vietnamese: /vietnamese|\bpho\b|banh mi/,
    greek: /greek|gyro|souvlaki/,
    korean: /korean|bibimbap|korean bbq/,
    seafood: /seafood|oyster|crab/,
    burgers: /burger/,
    mediterranean: /mediterranean|falafel|hummus|lebanese/
  };

  function loadDecideSettings() {
    try {
      var raw = localStorage.getItem(DECIDE_SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return {
        uberOne: !!parsed.uberOne,
        dashPass: !!parsed.dashPass,
        grubhubPlus: !!parsed.grubhubPlus
      };
    } catch (e) {
      return { uberOne: false, dashPass: false, grubhubPlus: false };
    }
  }

  function saveDecideSettings(s) {
    try { localStorage.setItem(DECIDE_SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }

  function placeTags(p, kind) {
    var text = ((p.name || '') + ' ' + (p.cuisine || '') + ' ' + (p.description || '') + ' ' + (p.hoursNote || '')).toLowerCase();
    var tags = [];
    CUISINES.forEach(function (c) {
      if (CUISINE_RE[c.id] && CUISINE_RE[c.id].test(text)) tags.push(c.id);
    });
    if (kind === 'coffee' && tags.indexOf('cafe') < 0) tags.push('cafe');
    if (kind === 'drinks' && tags.indexOf('bar') < 0) tags.push('bar');
    return tags;
  }

  function isBreakfastPlace(p) {
    var text = ((p.name || '') + ' ' + (p.cuisine || '') + ' ' + (p.description || '') + ' ' +
      (p.featureLabel || '') + ' ' + (p.hoursNote || '')).toLowerCase();
    return /breakfast|bagel|brunch|biscuit|pancake|\bdiner\b/.test(text);
  }

  var DECIDE_INTENTS = {
    coffee: 'Going for coffee',
    breakfast: 'Going for breakfast',
    drinks: 'Drinks + happy hours',
    near: 'Places near'
  };

  function initDecide() {
    var settings = loadDecideSettings();
    var session = { service: 'dine', handoff: 'dine', nogo: {}, intent: '' };
    var results = [];
    var selected = 0;
    var map = null;
    var pinLayer = null;
    var lineLayer = null;
    var here = null;
    var awaitingFix = false;
    var box = $('decide-cuisines');
    box.innerHTML = CUISINES.map(function (c) {
      return '<label><input type="checkbox" data-nogo="' + c.id + '" /> ' + escapeHtml(c.label) + '</label>';
    }).join('');

    function setStep(name) {
      document.querySelectorAll('[data-decide-step]').forEach(function (el) {
        el.hidden = el.getAttribute('data-decide-step') !== name;
      });
      $('decide-wizard').hidden = false;
      $('decide-results').hidden = true;
      var sub = $('decide-sub');
      if (name === 'service') sub.textContent = 'Pick a trip';
      else if (name === 'handoff') sub.textContent = 'Pickup or delivery';
      else sub.textContent = 'Skip anything you don\u2019t want';
    }

    function ensureMap() {
      if (map || typeof L === 'undefined' || typeof PhillyWalkMap === 'undefined') return;
      map = L.map('map-decide', {
        zoomControl: false,
        attributionControl: true,
        minZoom: PhillyWalkMap.minZoom,
        maxZoom: 19,
        maxBounds: PhillyWalkMap.panLatLngBounds(),
        maxBoundsViscosity: PhillyWalkMap.maxBoundsViscosity
      }).setView([PhillyWalkMap.center.lat, PhillyWalkMap.center.lng], PhillyWalkMap.defaultZoom);
      PhillyWalkMap.addTiles(map);
      PhillyWalkMap.applyLimits(map);
      PhillyWalkMap.ensurePinPane(map);
      PhillyWalkMap.bindZoomLabels(map);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      pinLayer = L.layerGroup().addTo(map);
      lineLayer = L.layerGroup().addTo(map);
      here = PhillyWalkMap.attachHereControl(map, {
        onChange: function (state) {
          if (awaitingFix && state && state.active && !state.locating) {
            awaitingFix = false;
            if (!PhillyWalkMap.contains(state.lat, state.lng)) {
              here.clear();
              toast('Outside Philly — showing places by hours');
              buildResults(null);
            } else {
              buildResults(state);
            }
          }
        },
        onError: function () {
          awaitingFix = false;
          toast('No location — showing places that are open in Philly');
          buildResults(null);
        }
      });
    }

    function kindColor(kind) {
      if (kind === 'coffee') return COLOR_COFFEE;
      if (kind === 'drinks') return COLOR_BAR;
      return COLOR_FOOD;
    }

    function kindLabel(kind) {
      if (kind === 'coffee') return 'Cafe';
      if (kind === 'drinks') return 'Bar';
      return 'Restaurant';
    }

    function orderButtons(p) {
      if (session.handoff !== 'pickup' && session.handoff !== 'delivery') return '';
      var q = encodeURIComponent((p.name || 'restaurant') + ' Philadelphia');
      var rows = [
        { href: 'https://www.ubereats.com/search?q=' + q, label: 'Search Uber Eats', on: settings.uberOne, note: 'Uber One' },
        { href: 'https://www.doordash.com/search/store/' + encodeURIComponent(p.name || '') + '/', label: 'Search DoorDash', on: settings.dashPass, note: 'DashPass' },
        { href: 'https://www.grubhub.com/search?queryText=' + q, label: 'Search Grubhub', on: settings.grubhubPlus, note: 'Grubhub+' }
      ];
      return rows.map(function (r) {
        return '<a href="' + r.href + '" target="_blank" rel="noopener">' + r.label +
          (r.on ? '<span class="member-note">You have ' + r.note + '</span>' : '') + '</a>';
      }).join('');
    }

    function siteButtons(p) {
      var html = '';
      var web = p.website || p.hh_menu;
      var ig = p.instagramUrl || p.instagram;
      if (web) html += '<a href="' + escapeHtml(web) + '" target="_blank" rel="noopener">Website</a>';
      if (ig) html += '<a href="' + escapeHtml(ig) + '" target="_blank" rel="noopener">Instagram</a>';
      if (p.featureUrl && p.featureUrl !== ig) {
        html += '<a href="' + escapeHtml(p.featureUrl) + '" target="_blank" rel="noopener">' + escapeHtml(p.featureLabel || 'Link') + '</a>';
      }
      return html;
    }

    function walkMinutes(meters) {
      if (meters == null) return null;
      return Math.max(1, Math.round(meters / PhillyWalkMap.WALK_M_PER_MIN));
    }

    function renderBubbles() {
      var el = $('decide-bubbles');
      if (!results.length) {
        el.innerHTML = '<p class="decide-empty">Nothing matched nearby. Restart and try another trip, or a wider area.</p>';
        return;
      }
      el.innerHTML = results.map(function (p, i) {
        var walk = walkMinutes(p._meters);
        var walkLabel = walk != null ? (walk + ' min') : (p._open ? 'Open' : 'Walk n/a');
        return '<button type="button" class="decide-row' + (i === selected ? ' is-on' : '') + '" data-pick="' + i + '">' +
          '<span class="decide-num' + (i === selected ? ' is-on' : '') + '" aria-hidden="true">' + (i + 1) + '</span>' +
          '<span class="decide-row-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="decide-row-walk">' + escapeHtml(walkLabel) + '</span></button>';
      }).join('');
    }

    function renderPins() {
      if (!pinLayer || typeof L === 'undefined') return;
      pinLayer.clearLayers();
      lineLayer.clearLayers();
      var user = here && here.getState();
      results.forEach(function (p, i) {
        var on = i === selected;
        var size = on ? 34 : 28;
        var marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'philly-pin-icon decide-num-pin',
            html: '<div class="decide-num' + (on ? ' is-on' : '') + '">' + (i + 1) + '</div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          }),
          pane: 'pins',
          bubblingMouseEvents: false,
          zIndexOffset: on ? 900 : 500
        });
        marker.on('click', function () { selectResult(i, true); });
        pinLayer.addLayer(marker);
      });
      var pick = results[selected];
      if (pick && user && user.active) {
        lineLayer.addLayer(L.polyline([[user.lat, user.lng], [pick.lat, pick.lng]], {
          color: '#0f766e',
          weight: 3,
          opacity: 0.85,
          dashArray: '6 6'
        }));
      }
    }

    refreshDecidePins = function () { renderPins(); };

    function fitAll(user) {
      if (!map || !results.length) return;
      var pts = results.map(function (p) { return [p.lat, p.lng]; });
      if (user && user.active) pts.push([user.lat, user.lng]);
      map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    }

    function fitPair(user, p) {
      if (!map || !user || !p) return;
      map.fitBounds(L.latLngBounds([[user.lat, user.lng], [p.lat, p.lng]]), { padding: [48, 48], maxZoom: 16 });
    }

    function selectResult(i, openSheet) {
      if (!results[i]) return;
      selected = i;
      renderBubbles();
      renderPins();
      var card = document.querySelector('.decide-row[data-pick="' + i + '"]');
      if (card) card.scrollIntoView({ block: 'nearest' });
      if (openSheet) {
        openDetail(results[i]._place);
        var extra = $('detail-links');
        if (extra && (session.handoff === 'pickup' || session.handoff === 'delivery')) {
          extra.insertAdjacentHTML('beforeend', orderButtons(results[i]));
        }
      }
    }

    function hoursRank(p) {
      if (p._open) return 0;
      if (!p._hasHours) return 1;
      return 2;
    }

    function matchesIntent(p) {
      if (session.intent === 'coffee') return !!p.kinds.coffee;
      if (session.intent === 'breakfast') return isBreakfastPlace(p);
      if (session.intent === 'drinks') return !!(p.kinds.drinks || hasSchedule(p));
      return true;
    }

    function gather(user) {
      var minutes = session.intent ? (session._radiusMin || 15) : (session.handoff === 'delivery' ? 100 : 10);
      var limit = user ? (session.handoff === 'delivery' && !session.intent ? 8000 : minutes * PhillyWalkMap.WALK_M_PER_MIN) : Infinity;
      var seen = {};
      var list = [];
      allPlaces.forEach(function (p) {
        if (!hasCoords(p)) return;
        if (!matchesIntent(p)) return;
        var key = nameKey(p.name);
        if (!key || seen[key]) return;
        var kind = primaryKind(p);
        var tags = placeTags(p, kind);
        if (!session.intent && tags.some(function (t) { return session.nogo[t]; })) return;
        var meters = user ? PhillyWalkMap.haversineMeters(user.lat, user.lng, p.lat, p.lng) : null;
        if (user && meters > limit) return;
        seen[key] = true;
        var copy = Object.assign({}, p);
        copy._place = p;
        copy._kind = kind;
        copy._meters = meters;
        copy._tags = tags;
        copy._open = isOpenNowHours(p.hours);
        copy._hasHours = hasAnyHours(p.hours);
        list.push(copy);
      });
      list.sort(function (a, b) {
        if (session.intent === 'drinks') {
          var ah = hhNow(a) ? 0 : (hasSchedule(a) ? 1 : 2);
          var bh = hhNow(b) ? 0 : (hasSchedule(b) ? 1 : 2);
          if (ah !== bh) return ah - bh;
        }
        if (session.intent && user && a._meters != null && b._meters != null && a._meters !== b._meters) {
          return a._meters - b._meters;
        }
        var rank = hoursRank(a) - hoursRank(b);
        if (rank) return rank;
        if (user && a._meters != null && b._meters != null && a._meters !== b._meters) return a._meters - b._meters;
        return a.name.localeCompare(b.name);
      });
      return list.slice(0, 8);
    }

    function centerSnapshot(user) {
      if (!map) return;
      if (user && user.active) {
        var far = 0;
        results.forEach(function (p) { if (p._meters > far) far = p._meters; });
        var zoom = far > 1400 ? 14 : 15;
        map.setView([user.lat, user.lng], zoom);
        return;
      }
      if (results.length) fitAll(null);
      else map.setView([PhillyWalkMap.center.lat, PhillyWalkMap.center.lng], PhillyWalkMap.defaultZoom);
    }

    function buildResults(user) {
      session.remote = !user;
      if (session.intent) session._radiusMin = 15;
      results = gather(user);
      if (user && session.intent && results.length < 4) {
        session._radiusMin = 25;
        results = gather(user);
      }
      if (user && !results.length && !session.intent) {
        session.remote = true;
        user = null;
        results = gather(null);
      }
      selected = 0;
      ensureMap();
      $('decide-wizard').hidden = true;
      $('decide-results').hidden = false;
      var label = DECIDE_INTENTS[session.intent] ||
        (session.service === 'dine' ? 'Eat in' : (session.handoff === 'delivery' ? 'Delivery' : 'Pickup'));
      $('decide-sub').textContent = session.remote
        ? (label + ' \u00b7 open in Philly')
        : (label + ' \u00b7 ' + results.length + ' around you');
      var located = user;
      if (here && located && located.active && session.handoff !== 'delivery') {
        here.setMinutes(session._radiusMin || 10);
      }
      setTimeout(function () {
        if (!map) return;
        map.invalidateSize();
        renderBubbles();
        renderPins();
        centerSnapshot(located && located.active ? located : null);
      }, 40);
    }

    function readNogo() {
      session.nogo = {};
      box.querySelectorAll('[data-nogo]').forEach(function (input) {
        if (input.checked) session.nogo[input.getAttribute('data-nogo')] = true;
      });
    }

    function askLocation() {
      readNogo();
      ensureMap();
      if (!here) {
        toast('Map failed to load');
        return;
      }
      $('decide-wizard').hidden = true;
      $('decide-results').hidden = false;
      $('decide-sub').textContent = 'Finding you\u2026';
      $('decide-bubbles').innerHTML = '<p class="decide-empty">Checking location. If you are outside Philly, options use who’s open.</p>';
      awaitingFix = true;
      setTimeout(function () {
        map.invalidateSize();
        here.locate();
      }, 40);
    }

    function openDecide() {
      showScreen('screen-decide');
      session = { service: 'dine', handoff: 'dine', nogo: {}, intent: '' };
      results = [];
      box.querySelectorAll('input').forEach(function (input) { input.checked = false; });
      setStep('service');
    }

    function syncMemberInputs() {
      document.querySelectorAll('#decide-settings-overlay [data-member]').forEach(function (input) {
        input.checked = !!settings[input.getAttribute('data-member')];
      });
    }

    $('pick-decide').addEventListener('click', openDecide);
    $('eat-decide').addEventListener('click', openDecide);
    $('decide-back').addEventListener('click', openHome);
    $('decide-restart').addEventListener('click', openDecide);
    document.querySelector('[data-decide-step="service"]').addEventListener('click', function (e) {
      var intentBtn = e.target.closest('[data-intent]');
      if (intentBtn) {
        session.intent = intentBtn.getAttribute('data-intent');
        session.service = 'dine';
        session.handoff = 'dine';
        session.nogo = {};
        askLocation();
        return;
      }
      var btn = e.target.closest('[data-service]');
      if (!btn) return;
      session.intent = '';
      session.service = btn.getAttribute('data-service');
      if (session.service === 'takeout') setStep('handoff');
      else {
        session.handoff = 'dine';
        setStep('nogo');
      }
    });
    document.querySelector('[data-decide-step="handoff"]').addEventListener('click', function (e) {
      var prev = e.target.closest('[data-decide-prev]');
      if (prev) { setStep('service'); return; }
      var btn = e.target.closest('[data-handoff]');
      if (!btn) return;
      session.handoff = btn.getAttribute('data-handoff');
      setStep('nogo');
    });
    $('decide-nogo-back').addEventListener('click', function () {
      setStep(session.service === 'takeout' ? 'handoff' : 'service');
    });
    $('decide-nogo-next').addEventListener('click', askLocation);
    $('decide-bubbles').addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var card = e.target.closest('[data-pick]');
      if (!card) return;
      var i = +card.getAttribute('data-pick');
      selectResult(i, selected === i);
    });
    $('decide-settings').addEventListener('click', function () {
      syncMemberInputs();
      $('decide-settings-overlay').hidden = false;
    });
    $('decide-settings-close').addEventListener('click', function () {
      $('decide-settings-overlay').hidden = true;
    });
    $('decide-settings-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'decide-settings-overlay') e.currentTarget.hidden = true;
    });
    $('decide-settings-overlay').addEventListener('change', function (e) {
      var input = e.target.closest('[data-member]');
      if (!input) return;
      settings[input.getAttribute('data-member')] = input.checked;
      saveDecideSettings(settings);
      if (!$('decide-results').hidden) renderBubbles();
    });
  }

  /* ---------- Wiring ---------- */

  function wireUi() {
    modes.coffee = createMode({
      screenId: 'screen-coffee',
      mapId: 'map-coffee',
      getPlaces: function () { return placesOf('coffee'); },
      pinColor: pinColorByHours,
      subtitle: function (list) {
        return list.length + ' cafes · green open · red closed · grey no hours';
      }
    });
    modes.eat = createMode({
      screenId: 'screen-eat',
      mapId: 'map-eat',
      getPlaces: eatPlaces,
      cafeMug: true,
      filter: function (p, f) {
        if (f === 'food') return !!p.kinds.food;
        if (f === 'drinks') return !!p.kinds.drinks;
        if (f === 'coffee') return !!p.kinds.coffee;
        if (f === 'hh') return hasSchedule(p);
        if (f === 'lunch' || f === 'dinner') return !!p.kinds.food && matchesMeal(p, f);
        return true;
      },
      pinColor: function (p) { return hhNow(p) ? COLOR_HH_NOW : pinColorByHours(p); },
      metaLead: cuisineLabel,
      badge: function (p) {
        if (hasSchedule(p)) {
          return hhNow(p) ? '<span class="hh-pill on">HH now</span>' : '<span class="hh-pill">HH</span>';
        }
        if (p.meal === 'lunch') return '<span class="meal-pill lunch">Lunch</span>';
        if (p.meal === 'dinner') return '<span class="meal-pill dinner">Dinner</span>';
        return '';
      },
      subtitle: function (list) {
        var now = list.filter(hhNow).length;
        return list.length + ' places' + (now ? ' · ' + now + ' HH now' : '');
      }
    });

    $('pick-coffee').addEventListener('click', function () { modes.coffee.show(); });
    $('pick-eat').addEventListener('click', function () { modes.eat.show(); });
    $('pick-saved').addEventListener('click', openSaved);
    initDecide();
    initLog();
    initSaved();

    $('pick-shuffle').addEventListener('click', function () {
      shufflePicks();
      renderPicks();
      $('pick-track').scrollTo({ left: 0, behavior: 'smooth' });
    });
    $('pick-filters').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pick-filter]');
      if (btn) setPickFilter(btn.getAttribute('data-pick-filter'));
    });
    $('pick-track').addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      if (e.target.closest('[data-pick-schedule]')) { openSchedule('screen-home'); return; }
      var hh = e.target.closest('[data-pick-hh]');
      if (hh) {
        var hp = picks[+hh.getAttribute('data-pick-hh')];
        openSchedule('screen-home', hp ? hp.name : '');
        return;
      }
      var card = e.target.closest('[data-pick-card]');
      var p = card && picks[+card.getAttribute('data-pick-card')];
      if (p) openDetail(p);
    });
    $('home-hh').addEventListener('click', function () { openSchedule('screen-home'); });

    $('schedule-back').addEventListener('click', function () { goScreen(scheduleReturn); });
    $('open-schedule').addEventListener('click', function () { openSchedule('screen-eat'); });
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-marks').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-bucket]');
      if (!btn || !detailPlace) return;
      toggleMark(detailPlace, btn.getAttribute('data-bucket'));
      refreshMarkButtons();
      refreshOpenViews();
    });
    $('detail-hh-link').addEventListener('click', function () {
      var name = detailPlace ? detailPlace.name : '';
      var back = currentScreen === 'screen-schedule' ? scheduleReturn : currentScreen;
      closeDetail();
      openSchedule(back, name);
    });
    $('detail-visits').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del-visit]');
      if (!del || !window.confirm('Remove this order?')) return;
      var id = del.getAttribute('data-del-visit');
      store.visits = store.visits.filter(function (v) { return v.id !== id; });
      saveStore();
      renderVisits();
    });
    $('detail-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'detail-overlay') closeDetail();
    });

    var hhNowEl = $('filter-hh-now');
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
    $('schedule-search').addEventListener('input', renderGrid);
    hhNowEl.addEventListener('change', renderGrid);
    ['grid', 'summary'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var btn = e.target.closest('.rest-link');
        var p = btn && placeByKey[btn.getAttribute('data-key')];
        if (p) openDetail(p);
      });
    });
  }

  function loadCatalog() {
    return Promise.all([
      fetch('coffee.json?v=4').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('drinks.json?v=12').then(function (r) { return r.ok ? r.json() : []; }),
      fetch('food.json?v=12').then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (triple) {
      /* Drinks first, then coffee, then food: when one place is in two files, the hand-placed pin wins. */
      buildPlaces([
        { kind: 'drinks', list: Array.isArray(triple[1]) ? triple[1] : [] },
        { kind: 'coffee', list: Array.isArray(triple[0]) ? triple[0] : [] },
        { kind: 'food', list: Array.isArray(triple[2]) ? triple[2] : [] }
      ]);
      bootstrapCatalog();
      wireUi();
      openHome();
    }).catch(function (err) {
      if (window.console) console.error(err);
      toast('Could not load catalog.');
    });
  }

  document.addEventListener('DOMContentLoaded', loadCatalog);
})();
