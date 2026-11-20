(function (root) {
  "use strict";

  var TZID = "America/New_York";
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function escapeText(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    return Buffer.from(str, "utf8");
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }

  function fold(line) {
    var bytes = utf8Bytes(line);
    if (bytes.length <= 75) return line;
    var out = "";
    var start = 0;
    var limit = 75;
    while (start < bytes.length) {
      var end = Math.min(start + limit, bytes.length);
      while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      if (end === start) end = Math.min(start + limit, bytes.length);
      out += (start === 0 ? "" : "\r\n ") + utf8Decode(bytes.slice(start, end));
      start = end;
      limit = 74;
    }
    return out;
  }

  function compact(local) {
    return String(local).replace(/[-:]/g, "");
  }

  function dayLabel(dateKey) {
    var p = String(dateKey).split("-");
    return MONTHS_SHORT[Number(p[1]) - 1] + " " + Number(p[2]);
  }

  function calendarName(items) {
    var dates = {};
    items.forEach(function (i) { dates[i.day.date] = true; });
    if (Object.keys(dates).length !== 1) return "Local Events";
    var day = items[0].day;
    return (day.title || "Local Events") + " " + dayLabel(day.date);
  }

  /** items: [{ day, ev }]. dtstamp: "YYYYMMDDTHHMMSSZ" (defaults to now). */
  function build(items, dtstamp) {
    var stamp = dtstamp || new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//mathoose cursor-apps//Local Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + escapeText(calendarName(items)),
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
        "UID:" + ev.id + "-" + compact(day.date) + "@mathoose-local-events",
        "DTSTAMP:" + stamp,
        "DTSTART;TZID=" + TZID + ":" + compact(ev.start),
        "DTEND;TZID=" + TZID + ":" + compact(ev.end),
        "SUMMARY:" + escapeText(ev.title),
        "LOCATION:" + escapeText(ev.venue + ", " + ev.address),
        "DESCRIPTION:" + escapeText(bits.join("\n"))
      );
      if (ev.website) lines.push("URL:" + ev.website);
      lines.push("STATUS:CONFIRMED", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  /** Path of the pre-built file, relative to things-to-do/. */
  function eventPath(day, ev) {
    return "ics/" + day.date + "/" + ev.id + ".ics";
  }

  function dayPath(day) {
    return "ics/" + day.date + "/all.ics";
  }

  var api = { build: build, calendarName: calendarName, eventPath: eventPath, dayPath: dayPath };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalEventsICS = api;
})(typeof window !== "undefined" ? window : this);
