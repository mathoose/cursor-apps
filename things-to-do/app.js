(function () {
  "use strict";

  var STORAGE_KEY = "local-events-v1";
  var EVENTS_URL = "events.json?v=6";
  var TZID = "America/New_York";
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

  var days = [];
  var activeDate = null;
  var activeTag = "all";
  var toastTimer = null;
  var prefs = loadPrefs();
  var checked = new Set(prefs.checked);

  var els = {
    dayChips: document.getElementById("dayChips"),
    dayKicker: document.getElementById("dayKicker"),
    dayTitle: document.getElementById("dayTitle"),
    dayLede: document.getElementById("dayLede"),
    headerSub: document.getElementById("headerSub"),
    q: document.getElementById("q"),
    chips: document.getElementById("chips"),
    count: document.getElementById("count"),
    list: document.getElementById("list"),
    addBtn: document.getElementById("addBtn"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast")
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

  function visibleEvents() {
    var day = currentDay();
    if (!day) return [];
    var q = els.q.value.trim().toLowerCase();
    return day.events.filter(function (ev) {
      if (activeTag !== "all" && ev.tags.indexOf(activeTag) < 0) return false;
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

    var solo = el("button", "solo", "Add just this");
    solo.type = "button";
    solo.addEventListener("click", function () {
      exportEvents([{ day: day, ev: ev }], ev.id + "-" + day.date + ".ics");
    });

    card.appendChild(top);
    card.appendChild(meta);
    card.appendChild(fact("Hours", ev.hours));
    card.appendChild(fact("Price", ev.price));
    card.appendChild(place);
    card.appendChild(links);
    if (ev.priceNote) card.appendChild(el("p", "note", ev.priceNote));
    card.appendChild(solo);
    return card;
  }

  function renderList() {
    var day = currentDay();
    var shown = visibleEvents();
    els.list.innerHTML = "";
    if (!shown.length) {
      els.list.appendChild(el("p", "empty", day ? "Nothing matches that search." : "No events loaded."));
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
    renderList();
  }

  function icsEscape(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function fold(line) {
    var bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    var dec = new TextDecoder();
    var out = "";
    var start = 0;
    var limit = 75;
    while (start < bytes.length) {
      var end = Math.min(start + limit, bytes.length);
      while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      if (end === start) end = Math.min(start + limit, bytes.length);
      out += (start === 0 ? "" : "\r\n ") + dec.decode(bytes.slice(start, end));
      start = end;
      limit = 74;
    }
    return out;
  }

  function stamp(local) {
    return String(local).replace(/[-:]/g, "");
  }

  function buildICS(items, calName) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//mathoose cursor-apps//Local Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + icsEscape(calName),
      "BEGIN:VTIMEZONE",
      "TZID:" + TZID,
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "TZNAME:EDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "TZNAME:EST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE"
    ];
    var dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    items.forEach(function (item) {
      var ev = item.ev;
      var day = item.day;
      var bits = [
        ev.blurb,
        "Price: " + ev.price,
        ev.priceNote,
        ev.ticketsUrl ? "Tickets: " + ev.ticketsUrl : "Tickets: " + (ev.ticketsLabel || "None listed"),
        ev.website ? "Website: " + ev.website : "",
        day.source && day.source.url ? "Source: " + day.source.url : ""
      ].filter(Boolean);
      lines.push(
        "BEGIN:VEVENT",
        "UID:" + ev.id + "-" + stamp(day.date) + "@mathoose-local-events",
        "DTSTAMP:" + dtstamp,
        "DTSTART;TZID=" + TZID + ":" + stamp(ev.start),
        "DTEND;TZID=" + TZID + ":" + stamp(ev.end),
        "SUMMARY:" + icsEscape(ev.title),
        "LOCATION:" + icsEscape(ev.venue + ", " + ev.address),
        "DESCRIPTION:" + icsEscape(bits.join("\n"))
      );
      if (ev.website) lines.push("URL:" + ev.website);
      lines.push("STATUS:CONFIRMED", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  function calendarName(items) {
    var dates = new Set(items.map(function (i) { return i.day.date; }));
    if (dates.size !== 1) return "Local Events";
    var day = items[0].day;
    var d = parseDateKey(day.date);
    return (day.title || "Local Events") + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
  }

  function exportEvents(items, filename) {
    if (!items.length) return;
    var ics = buildICS(items, calendarName(items));
    var appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var file = null;
    try {
      file = new File([ics], filename, { type: "text/calendar" });
    } catch (e) { /* older Safari without File constructor */ }

    if (appleMobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: calendarName(items) }).then(function () {
        els.hint.textContent = "Shared. Open the file from the share sheet or Files, then tap Add All in Calendar.";
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        openBlob(ics, filename, appleMobile);
      });
      return;
    }
    openBlob(ics, filename, appleMobile);
  }

  function openBlob(ics, filename, appleMobile) {
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    if (appleMobile) {
      window.location.href = url;
      els.hint.textContent = "Opening the calendar file. Tap Add All.";
      return;
    }
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
    els.hint.textContent = "Downloaded " + filename + ". On iPhone, open that file and tap Add All.";
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

  els.addBtn.addEventListener("click", function () {
    var items = checkedItems();
    var dates = Array.from(new Set(items.map(function (i) { return i.day.date; })));
    var name = dates.length === 1 ? "local-events-" + dates[0] + ".ics" : "local-events.ics";
    exportEvents(items, name);
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
