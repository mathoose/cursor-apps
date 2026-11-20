#!/usr/bin/env node
/*
 * Writes things-to-do/ics/<date>/<event-id>.ics and ics/<date>/all.ics from events.json.
 * iOS Safari only offers "Add to Calendar" for .ics files fetched over HTTP, so the app
 * links to these static files instead of sharing a generated blob.
 *
 *   node things-to-do/build-ics.js          # rebuild
 *   node things-to-do/build-ics.js --check  # exit 1 if files are missing or stale
 */
"use strict";

var fs = require("fs");
var path = require("path");
var ICS = require("./ics.js");

var ROOT = __dirname;
var OUT = path.join(ROOT, "ics");
var check = process.argv.indexOf("--check") >= 0;

var data = JSON.parse(fs.readFileSync(path.join(ROOT, "events.json"), "utf8"));
var want = {};

(data.days || []).forEach(function (day) {
  var stamp = day.date.replace(/-/g, "") + "T120000Z";
  var all = day.events.map(function (ev) { return { day: day, ev: ev }; });
  all.forEach(function (item) {
    want[ICS.eventPath(day, item.ev)] = ICS.build([item], stamp);
  });
  want[ICS.dayPath(day)] = ICS.build(all, stamp);
});

function listExisting(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  var out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    var rel = prefix + "/" + ent.name;
    if (ent.isDirectory()) out = out.concat(listExisting(path.join(dir, ent.name), rel));
    else if (ent.name.endsWith(".ics")) out.push(rel);
  });
  return out;
}

var existing = listExisting(OUT, "ics");
var problems = [];

Object.keys(want).forEach(function (rel) {
  var file = path.join(ROOT, rel);
  var current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === want[rel]) return;
  if (check) problems.push((current == null ? "missing " : "stale ") + rel);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, want[rel]);
  }
});

existing.forEach(function (rel) {
  if (want[rel]) return;
  if (check) problems.push("extra " + rel);
  else fs.unlinkSync(path.join(ROOT, rel));
});

if (check) {
  if (problems.length) {
    console.error(problems.join("\n") + "\nRun: node things-to-do/build-ics.js");
    process.exit(1);
  }
  console.log("things-to-do ics files are up to date (" + Object.keys(want).length + ").");
} else {
  console.log("Wrote " + Object.keys(want).length + " .ics files to things-to-do/ics/");
}
