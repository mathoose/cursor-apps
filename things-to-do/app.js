(function () {
  "use strict";

  var STORAGE_KEY = "local-events-v1";
  var EVENTS_URL = "events.json?v=7";
  var ICS = window.LocalEventsICS;
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var TAG_LABEL = {
    free: "Free",
    art: "Art",
    music: "Music",
    dance: "Dance",
    film: "Film",
    market: "Market",
    nightlife: "Nightlife",
    health: "Health",
    family: "Family",
    outdoors: "Outdoors",
    rsvp: "RSVP",
    workshop: "Workshop"
  };
  // Matched as substrings of each event's "neighborhood" text. Shown even with no events that day.
  var PHILLY_AREAS = [
    { label: "Center City" },
    { label: "South Philly" },
    { label: "North Philly" },
    { label: "West Philly" },
    { label: "Northwest Philly" },
    { label: "Manayunk" },
    { label: "Fishtown" },
    { label: "Northern Liberties" },
    { label: "Kensington" },
    { label: "Old City" },
    { label: "Rittenhouse" },
    { label: "Society Hill" },
    { label: "Wash West", match: ["Washington Square West", "Wash West", "Gayborhood"] },
    { label: "South Street" },
    { label: "Queen Village" },
    { label: "Bella Vista" },
    { label: "Passyunk", match: ["Passyunk"] },
    { label: "Callowhill" },
    { label: "Fairmount" },
    { label: "University City" },
    { label: "Germantown" },
    { label: "East Falls" },
    { label: "Mt. Airy", match: ["Mt. Airy", "Mount Airy"] },
    { label: "Chestnut Hill" },
    { label: "Waterfront", match: ["Waterfront"] }
  ];

  var days = [];
  var activeDate = null;
  var activeTag = "all";
  var activeArea = "all";
  var toastTimer = null;
  var prefs = loadPrefs();
  var checked = new Set(prefs.checked);
  var addedInSheet = new Set();

  var els = {
    dayChips: document.getElementById("dayChips"),
    dayKicker: document.getElementById("dayKicker"),
    dayTitle: document.getElementById("dayTitle"),
    dayLede: document.getElementById("dayLede"),
    headerSub: document.getElementById("headerSub"),
    q: document.getElementById("q"),
    chips: document.getElementById("chips"),
    areaChips: document.getElementById("areaChips"),
    count: document.getElementById("count"),
    list: document.getElementById("list"),
    addBtn: document.getElementById("addBtn"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast"),
    sheet: document.getElementById("calSheet"),
    sheetAll: document.getElementById("calSheetAll"),
    sheetList: document.getElementById("calSheetList"),
    sheetIntro: document.getElementById("calSheetIntro"),
    sheetShare: document.getElementById("calSheetShare"),
    sheetClose: document.getElementById("calSheetClose")
  };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        checked: Array.isArray(p.checked) ? p.checked : [],
        day: typeof p.day === "string" ? p.day : null
      };
    } catch (e) {
      return { checked: [], day: null };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ checked: Array.from(checked), day: activeDate }));
    } catch (e) { /* storage full or private mode */ }
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2600);
  }

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function isAppleMobile() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function parseDateKey(key) {
    var p = String(key).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function longDate(key) {
    var d = parseDateKey(key);
    return DAY_NAMES[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }

  function eventKey(day, ev) {
    return day.date + ":" + ev.id;
  }

  function currentDay() {
    for (var i = 0; i < days.length; i++) {
      if (days[i].date === activeDate) return days[i];
    }
    return days[0] || null;
  }

  function pickDefaultDay() {
    var today = todayKey();
    if (prefs.day && days.some(function (d) { return d.date === prefs.day && d.date >= today; })) return prefs.day;
    var upcoming = days.filter(function (d) { return d.date >= today; });
    if (upcoming.length) return upcoming[0].date;
    return days.length ? days[days.length - 1].date : null;
  }

  function mapsUrl(ev) {
    var params = new URLSearchParams({ q: ev.venue, address: ev.address });
    return "https://maps.apple.com/?" + params.toString();
  }

  function areasForDay(day) {
    if (!day) return [];
    if (day.city === "Philadelphia") return PHILLY_AREAS;
    var seen = {};
    var out = [];
    day.events.forEach(function (ev) {
      String(ev.neighborhood || "").split("·").forEach(function (part) {
        var label = part.trim();
        if (label && !seen[label]) {
          seen[label] = true;
          out.push({ label: label });
        }
      });
    });
    return out;
  }

  function inArea(ev, area) {
    var hay = String(ev.neighborhood || "").toLowerCase();
    return (area.match || [area.label]).some(function (m) { return hay.indexOf(m.toLowerCase()) >= 0; });
  }

  function findArea(day, label) {
    var list = areasForDay(day);
    for (var i = 0; i < list.length; i++) if (list[i].label === label) return list[i];
    return null;
  }

  function visibleEvents() {
    var day = currentDay();
    if (!day) return [];
    var q = els.q.value.trim().toLowerCase();
    var area = activeArea === "all" ? null : findArea(day, activeArea);
    return day.events.filter(function (ev) {
      if (activeTag !== "all" && ev.tags.indexOf(activeTag) < 0) return false;
      if (area && !inArea(ev, area)) return false;
      if (!q) return true;
      var hay = [
        ev.title, ev.venue, ev.address, ev.neighborhood, ev.price,
        ev.priceNote, ev.hours, ev.blurb, ev.tags.join(" ")
      ].join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, label) {
    var a = el("a", null, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  /** Plain link to a static .ics so iOS Safari shows its Add to Calendar preview. */
  function calendarLink(href, label, className) {
    var a = el("a", className, label);
    a.href = href;
    a.type = "text/calendar";
    if (isStandalone()) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    return a;
  }

  function fact(label, value) {
    var p = el("p", "fact");
    p.appendChild(el("strong", null, label));
    p.appendChild(document.createTextNode(" " + value));
    return p;
  }

  function renderDayChips() {
    els.dayChips.innerHTML = "";
    els.dayChips.hidden = days.length < 2;
    if (days.length < 2) return;
    var today = todayKey();
    days.forEach(function (day) {
      var d = parseDateKey(day.date);
      var btn = el("button", "day-chip" + (day.date < today ? " past" : ""));
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(day.date === activeDate));
      btn.appendChild(document.createTextNode(DAY_NAMES[d.getDay()].slice(0, 3) + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate()));
      var sub = day.date === today ? "Today" : day.events.length + " events";
      btn.appendChild(el("small", null, sub));
      btn.addEventListener("click", function () {
        activeDate = day.date;
        activeTag = "all";
        activeArea = "all";
        savePrefs();
        renderAll();
      });
      els.dayChips.appendChild(btn);
    });
  }

  function renderIntro() {
    var day = currentDay();
    if (!day) {
      els.dayTitle.textContent = "No events yet";
      els.dayLede.textContent = "";
      return;
    }
    els.dayKicker.textContent = (day.city || "Local") + (day.title ? " · " + day.title : "");
    els.dayTitle.textContent = longDate(day.date);
    els.headerSub.textContent = (day.city || "Local") + " · " + day.events.length + " events";
    els.dayLede.innerHTML = "";
    if (day.source && day.source.url) {
      els.dayLede.appendChild(document.createTextNode("From the "));
      els.dayLede.appendChild(link(day.source.url, day.source.label || "source"));
      els.dayLede.appendChild(document.createTextNode(". "));
    }
    if (day.note) els.dayLede.appendChild(document.createTextNode(day.note));
    if (day.date < todayKey()) {
      els.dayLede.appendChild(document.createElement("br"));
      els.dayLede.appendChild(el("span", "past-note", "This day has passed"));
    }
  }

  function renderChips() {
    var day = currentDay();
    var used = new Set();
    if (day) day.events.forEach(function (ev) { ev.tags.forEach(function (t) { used.add(t); }); });
    var tags = ["all"].concat(Object.keys(TAG_LABEL).filter(function (t) { return used.has(t); }));
    if (tags.indexOf(activeTag) < 0) activeTag = "all";
    els.chips.innerHTML = "";
    tags.forEach(function (tag) {
      var btn = el("button", "chip", tag === "all" ? "All" : TAG_LABEL[tag]);
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(tag === activeTag));
      btn.addEventListener("click", function () {
        activeTag = tag;
        renderChips();
        renderList();
      });
      els.chips.appendChild(btn);
    });
  }

  function renderAreaChips() {
    var day = currentDay();
    var areas = areasForDay(day);
    els.areaChips.innerHTML = "";
    els.areaChips.hidden = !areas.length;
    if (!areas.length) return;
    if (activeArea !== "all" && !findArea(day, activeArea)) activeArea = "all";

    function chip(label, value, count) {
      var btn = el("button", "chip area-chip" + (count === 0 ? " empty-area" : ""));
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(value === activeArea));
      btn.appendChild(document.createTextNode(label));
      if (count != null) btn.appendChild(el("span", "chip-count", String(count)));
      btn.addEventListener("click", function () {
        activeArea = value;
        renderAreaChips();
        renderList();
      });
      els.areaChips.appendChild(btn);
    }

    chip("All areas", "all", null);
    areas.forEach(function (area) {
      var n = day.events.filter(function (ev) { return inArea(ev, area); }).length;
      chip(area.label, area.label, n);
    });
  }

  function renderCard(day, ev) {
    var key = eventKey(day, ev);
    var card = el("article", "card" + (checked.has(key) ? " checked" : ""));

    var top = el("div", "card-top");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked.has(key);
    box.id = "ev-" + day.date + "-" + ev.id;
    box.setAttribute("aria-label", "Select " + ev.title);
    box.addEventListener("change", function () {
      if (box.checked) checked.add(key);
      else checked.delete(key);
      savePrefs();
      card.classList.toggle("checked", box.checked);
      updateCount();
      updateDock();
    });
    var titles = el("div");
    var h3 = el("h3");
    var lab = el("label", null, ev.title);
    lab.htmlFor = box.id;
    h3.appendChild(lab);
    titles.appendChild(h3);
    titles.appendChild(el("p", "where", ev.neighborhood));
    top.appendChild(box);
    top.appendChild(titles);

    var meta = el("div", "meta");
    ev.tags.forEach(function (tag) {
      meta.appendChild(el("span", "pill" + (tag === "free" ? " free" : ""), TAG_LABEL[tag] || tag));
    });

    var place = el("p", "fact");
    place.appendChild(el("strong", null, ev.venue));

    var links = el("div", "links");
    links.appendChild(link(mapsUrl(ev), "Apple Maps"));
    if (ev.website) links.appendChild(link(ev.website, ev.websiteLabel || "Website"));
    if (ev.extraUrl) links.appendChild(link(ev.extraUrl, ev.extraLabel || "More"));
    if (ev.ticketsUrl) links.appendChild(link(ev.ticketsUrl, ev.ticketsLabel || "Tickets"));
    else if (ev.ticketsLabel) links.appendChild(el("span", null, ev.ticketsLabel));

    card.appendChild(top);
    card.appendChild(meta);
    card.appendChild(fact("Hours", ev.hours));
    card.appendChild(fact("Price", ev.price));
    card.appendChild(place);
    card.appendChild(links);
    if (ev.priceNote) card.appendChild(el("p", "note", ev.priceNote));
    card.appendChild(calendarLink(ICS.eventPath(day, ev), "Add to Calendar", "solo"));
    return card;
  }

  function renderList() {
    var day = currentDay();
    var shown = visibleEvents();
    els.list.innerHTML = "";
    if (!shown.length) {
      var msg = "No events loaded.";
      if (day && activeArea !== "all" && !els.q.value.trim() && activeTag === "all") {
        msg = "Nothing in " + activeArea + " on " + longDate(day.date) + ".";
      } else if (day) {
        msg = "Nothing matches those filters.";
      }
      els.list.appendChild(el("p", "empty", msg));
    }
    shown.forEach(function (ev) { els.list.appendChild(renderCard(day, ev)); });
    updateCount();
    updateDock();
  }

  function updateCount() {
    var day = currentDay();
    var onDay = day ? day.events.filter(function (ev) { return checked.has(eventKey(day, ev)); }).length : 0;
    els.count.textContent = visibleEvents().length + " shown · " + onDay + " checked";
  }

  function checkedItems() {
    var items = [];
    days.forEach(function (day) {
      day.events.forEach(function (ev) {
        if (checked.has(eventKey(day, ev))) items.push({ day: day, ev: ev });
      });
    });
    return items;
  }

  function updateDock() {
    var n = checkedItems().length;
    els.addBtn.disabled = n === 0;
    els.addBtn.textContent = n === 0
      ? "Add to Apple Calendar"
      : "Add " + n + (n === 1 ? " event" : " events") + " to Apple Calendar";
  }

  function renderAll() {
    renderDayChips();
    renderIntro();
    renderChips();
    renderAreaChips();
    renderList();
  }

  function fullDaysIn() {
    return days.filter(function (day) {
      return day.events.length > 1 && day.events.every(function (ev) { return checked.has(eventKey(day, ev)); });
    });
  }

  function openSheet() {
    var items = checkedItems();
    if (!items.length) return;
    addedInSheet = new Set();

    els.sheetAll.innerHTML = "";
    fullDaysIn().forEach(function (day) {
      var a = calendarLink(ICS.dayPath(day), "Add all " + day.events.length + " from " + longDate(day.date), "btn btn-primary cal-all");
      els.sheetAll.appendChild(a);
    });

    els.sheetIntro.textContent = items.length === 1
      ? "Tap Add. Calendar opens a preview — tap Add, then come back here."
      : "Tap Add on each one. Calendar opens a preview — tap Add, then come back for the next.";

    els.sheetList.innerHTML = "";
    items.forEach(function (item) {
      var key = eventKey(item.day, item.ev);
      var row = el("li", "cal-row");
      var text = el("div", "cal-row-text");
      text.appendChild(el("strong", null, item.ev.title));
      text.appendChild(el("span", null, (days.length > 1 ? longDate(item.day.date) + " · " : "") + item.ev.hours));
      var a = calendarLink(ICS.eventPath(item.day, item.ev), "Add", "cal-add");
      a.addEventListener("click", function () {
        addedInSheet.add(key);
        row.classList.add("added");
        a.textContent = "Added ✓";
      });
      row.appendChild(text);
      row.appendChild(a);
      els.sheetList.appendChild(row);
    });

    els.sheet.hidden = false;
    document.body.classList.add("sheet-open");
  }

  function closeSheet() {
    els.sheet.hidden = true;
    document.body.classList.remove("sheet-open");
  }

  function shareCombined() {
    var items = checkedItems();
    if (!items.length) return;
    var ics = ICS.build(items);
    var dates = Array.from(new Set(items.map(function (i) { return i.day.date; })));
    var filename = dates.length === 1 ? "local-events-" + dates[0] + ".ics" : "local-events.ics";
    var file = null;
    try {
      file = new File([ics], filename, { type: "text/calendar" });
    } catch (e) { /* older Safari without File constructor */ }
    if (isAppleMobile() && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: ICS.calendarName(items) }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
    showToast("Saved " + filename);
  }

  document.getElementById("selectShown").addEventListener("click", function () {
    var day = currentDay();
    if (!day) return;
    visibleEvents().forEach(function (ev) { checked.add(eventKey(day, ev)); });
    savePrefs();
    renderList();
  });

  document.getElementById("clearBtn").addEventListener("click", function () {
    var day = currentDay();
    if (!day) return;
    day.events.forEach(function (ev) { checked.delete(eventKey(day, ev)); });
    savePrefs();
    renderList();
  });

  els.addBtn.addEventListener("click", openSheet);
  els.sheetClose.addEventListener("click", closeSheet);
  els.sheetShare.addEventListener("click", shareCombined);
  els.sheet.addEventListener("click", function (e) {
    if (e.target === els.sheet) closeSheet();
  });

  els.q.addEventListener("input", function () {
    renderList();
  });

  fetch(EVENTS_URL)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      days = (data && Array.isArray(data.days) ? data.days : [])
        .filter(function (d) { return d && d.date && Array.isArray(d.events); })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var known = new Set();
      days.forEach(function (day) {
        day.events.forEach(function (ev) {
          ev.tags = Array.isArray(ev.tags) ? ev.tags : [];
          known.add(eventKey(day, ev));
        });
      });
      checked.forEach(function (k) { if (!known.has(k)) checked.delete(k); });
      activeDate = pickDefaultDay();
      renderAll();
    })
    .catch(function () {
      els.dayTitle.textContent = "Couldn’t load events";
      els.dayLede.textContent = "Check your connection and reopen the app.";
      els.list.innerHTML = "";
    });
})();
