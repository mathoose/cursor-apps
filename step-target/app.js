(function () {
  "use strict";

  var C = window.StepTargetCalc;
  var STORAGE_KEY = "step-target-v1";
  var APP_ID = "step-target";
  var EXPORT_FORMAT = "step-target";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  var state = null;
  var editingISO = null;
  var toastTimer = null;
  var els = {};

  function defaultState() {
    return {
      version: 1,
      asOf: "2026-11-20",
      period: "year",
      baselines: { week: null, month: null, year: 29067 },
      targets: { week: 30000, month: 30000, year: 30000 },
      days: {},
      calMonth: "2026-11",
    };
  }

  function sanitize(raw) {
    var fallback = defaultState();
    if (!raw || typeof raw !== "object") return fallback;
    var period = raw.period === "week" || raw.period === "month" || raw.period === "year" ? raw.period : fallback.period;
    var asOf = C.isRealISO(raw.asOf) ? raw.asOf : fallback.asOf;
    var hasBaselines = !!(raw.baselines && typeof raw.baselines === "object");
    var hasTargets = !!(raw.targets && typeof raw.targets === "object");
    var baselines = {
      week: hasBaselines ? C.cleanSteps(raw.baselines.week) : fallback.baselines.week,
      month: hasBaselines ? C.cleanSteps(raw.baselines.month) : fallback.baselines.month,
      year: hasBaselines ? C.cleanSteps(raw.baselines.year) : fallback.baselines.year,
    };
    var targets = {
      week: hasTargets ? C.cleanSteps(raw.targets.week) : fallback.targets.week,
      month: hasTargets ? C.cleanSteps(raw.targets.month) : fallback.targets.month,
      year: hasTargets ? C.cleanSteps(raw.targets.year) : fallback.targets.year,
    };
    var days = {};
    if (raw.days && typeof raw.days === "object") {
      Object.keys(raw.days).forEach(function (key) {
        if (!C.isRealISO(key)) return;
        var steps = C.cleanSteps(raw.days[key]);
        if (steps == null) return;
        days[key] = steps;
      });
    }
    var calMonth = /^\d{4}-\d{2}$/.test(raw.calMonth || "") ? raw.calMonth : asOf.slice(0, 7);
    if (!C.isRealISO(calMonth + "-01")) calMonth = asOf.slice(0, 7);
    return {
      version: 1,
      asOf: asOf,
      period: period,
      baselines: baselines,
      targets: targets,
      days: days,
      calMonth: calMonth,
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save on this phone");
    }
  }

  function activeInput() {
    return {
      period: state.period,
      asOf: state.asOf,
      baseline: state.baselines[state.period],
      target: state.targets[state.period],
      days: state.days,
    };
  }

  function todayISO() {
    return C.formatISO(new Date());
  }

  function pretty(iso, withYear) {
    var date = C.parseISO(iso);
    if (!date) return iso || "";
    var text = MONTHS_SHORT[date.getMonth()] + " " + date.getDate();
    if (withYear) text += ", " + date.getFullYear();
    return text;
  }

  function prettyLong(iso) {
    var date = C.parseISO(iso);
    if (!date) return iso || "";
    return WEEKDAYS[date.getDay()] + ", " + MONTHS_SHORT[date.getMonth()] + " " + date.getDate();
  }

  function formatSteps(n) {
    if (n == null || !isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function compactSteps(n) {
    var rounded = Math.round(n);
    if (rounded >= 10000) {
      var thousands = rounded / 1000;
      var text = thousands >= 100 ? String(Math.round(thousands)) : String(Math.round(thousands * 10) / 10);
      return text.replace(/\.0$/, "") + "k";
    }
    if (rounded >= 1000) return String(Math.round(rounded / 100) / 10).replace(/\.0$/, "") + "k";
    return String(rounded);
  }

  function periodNoun(period) {
    if (period === "week") return "week";
    if (period === "month") return "month";
    return "year";
  }

  function rangeLabel(result) {
    if (!result.bounds) return "";
    if (result.period === "year") return result.asOf.slice(0, 4);
    if (result.period === "month") {
      var monthDate = C.parseISO(result.bounds.start);
      return MONTHS[monthDate.getMonth()] + " " + monthDate.getFullYear();
    }
    var start = C.parseISO(result.bounds.start);
    var end = C.parseISO(result.bounds.end);
    var startText = MONTHS_SHORT[start.getMonth()] + " " + start.getDate();
    var endText = start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : MONTHS_SHORT[end.getMonth()] + " " + end.getDate();
    return startText + "–" + endText;
  }

  function dayCount(n, singular, plural) {
    return n + " " + (n === 1 ? singular : plural);
  }

  function sentence(result) {
    var noun = periodNoun(result.period);
    var target = formatSteps(result.target);
    if (result.status === "need-target") {
      return "Set a daily step target for this " + noun + ".";
    }
    if (result.status === "need-baseline") {
      var loggedNote = result.loggedElapsedCount
        ? " " + dayCount(result.loggedElapsedCount, "day is", "days are") + " already logged."
        : "";
      return "Enter your average through " + pretty(result.asOf) + ", or log each remaining day from " +
        pretty(result.bounds.start) + " to " + pretty(result.asOf) + "." + loggedNote;
    }
    if (result.status === "done" || result.status === "short") {
      var finalAvg = formatSteps(result.knownSteps / result.totalDays);
      if (result.status === "done") {
        return "This " + noun + " averaged " + finalAvg + " steps a day. That meets your " + target + " target.";
      }
      return "This " + noun + " averaged " + finalAvg + " steps a day, " + formatSteps(result.gapSteps) +
        " steps under a " + target + " daily average.";
    }
    if (result.status === "ahead") {
      return "A " + target + " average is already locked in for this " + noun + ", even if every open day is 0.";
    }
    var pace = formatSteps(result.paceSteps);
    var avg = formatSteps(result.averageSoFar);
    var open = result.openCount === 1 ? "day needs" : result.openCount + " days need";
    var loggedAhead = result.loggedUpcomingCount
      ? " " + dayCount(result.loggedUpcomingCount, "later day is", "later days are") + " already logged."
      : "";
    return "Average so far is " + avg + " through " + pretty(result.asOf) +
      ". To finish the " + noun + " at " + target + ", the next " + open + " to average " + pace + "." + loggedAhead;
  }

  function heroBits(result) {
    if (result.status === "need-target") {
      return { kicker: "Set a target", num: "—", sub: "Choose a daily average" };
    }
    if (result.status === "need-baseline") {
      return { kicker: "Needed each day", num: "—", sub: "Add your average so far" };
    }
    if (result.status === "done" || result.status === "short") {
      return {
        kicker: "Final average",
        num: formatSteps(result.knownSteps / result.totalDays),
        sub: result.status === "done" ? "Target met" : "Under the target",
      };
    }
    if (result.status === "ahead") {
      return { kicker: "Needed each day", num: "0", sub: "Target already reached" };
    }
    return {
      kicker: "Needed each day",
      num: formatSteps(result.paceSteps),
      sub: "next " + dayCount(result.openCount, "day", "days"),
    };
  }

  function staleDays(result) {
    var today = todayISO();
    if (!result.bounds || today <= state.asOf) return [];
    var end = today < result.bounds.end ? today : result.bounds.end;
    if (end <= state.asOf) return [];
    return C.eachDay(C.shiftISO(state.asOf, 1), end).filter(function (iso) {
      return !Object.prototype.hasOwnProperty.call(state.days, iso);
    });
  }

  function renderBanner(result) {
    var missing = staleDays(result);
    if (!missing.length) {
      els.staleBanner.hidden = true;
      return;
    }
    var today = todayISO();
    els.staleText.textContent = "Today is " + pretty(today, true) +
      ", and your average stops on " + pretty(state.asOf, true) + ". " +
      dayCount(missing.length, "day", "days") +
      " in between " + (missing.length === 1 ? "is" : "are") +
      " not logged, so " + (missing.length === 1 ? "it is" : "they are") +
      " still part of the pace. Log " + (missing.length === 1 ? "it" : "them") +
      ", or move the current date and update the average.";
    els.staleBanner.hidden = false;
  }

  function renderHero(result) {
    var bits = heroBits(result);
    els.heroKicker.textContent = bits.kicker;
    els.heroNum.textContent = bits.num;
    els.heroSub.textContent = bits.sub;
    els.avgNum.textContent = result.averageSoFar == null ? "—" : formatSteps(result.averageSoFar);
    els.avgSub.textContent = result.averageSoFar == null ? "Not enough yet" : "through " + pretty(state.asOf);
    var showMeter = result.averageSoFar != null && result.target > 0;
    els.meter.hidden = !showMeter;
    if (showMeter) {
      var ratio = result.averageSoFar / result.target;
      els.meterNow.textContent = formatSteps(result.averageSoFar) + " now";
      els.meterGoal.textContent = formatSteps(result.target) + " target";
      els.meterFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
      els.meterFill.classList.toggle("over", ratio >= 1);
    }
    els.sentence.textContent = sentence(result);
    els.headerSub.textContent = rangeLabel(result) + " · through " + pretty(state.asOf);
  }

  function renderStats(result) {
    var logged = result.loggedElapsedCount + result.loggedUpcomingCount;
    els.statTarget.textContent = formatSteps(result.target);
    els.statLeft.textContent = result.bounds ? String(result.openCount) : "—";
    els.statGap.textContent = result.status === "need-target" || result.status === "need-baseline"
      ? "—"
      : formatSteps(result.gapSteps);
    els.statLogged.textContent = String(logged);
  }

  function renderPeriods() {
    document.querySelectorAll("[data-period]").forEach(function (button) {
      var on = button.getAttribute("data-period") === state.period;
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
    els.weekHint.hidden = state.period !== "week";
    var noun = periodNoun(state.period);
    els.baselineLabel.textContent = "Average so far this " + noun;
    els.targetLabel.textContent = noun.charAt(0).toUpperCase() + noun.slice(1) + " target, steps per day";
  }

  function renderChart(model) {
    var result = model.result;
    var buckets = model.buckets;
    els.chartTitle.textContent = result.period === "year"
      ? (result.asOf ? result.asOf.slice(0, 4) : "Year")
      : rangeLabel(result);
    if (!buckets.length) {
      els.chart.innerHTML = "";
      els.chartCaption.textContent = "";
      return;
    }
    var pace = result.status === "need-pace" ? result.paceSteps : null;
    var max = C.niceMax(buckets.map(function (bucket) { return bucket.average; }).concat([result.target, pace]));
    var width = 320;
    var height = 172;
    var left = 44;
    var top = 12;
    var plotW = 268;
    var plotH = 128;
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + chartLabel(result, buckets) + '">');
    [0, 0.5, 1].forEach(function (t) {
      var value = max * t;
      var y = top + plotH - plotH * t;
      parts.push('<line x1="' + left + '" y1="' + y + '" x2="' + (left + plotW) + '" y2="' + y + '" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>');
      parts.push('<text x="' + (left - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="#8e8e93" font-size="9">' + compactSteps(value) + "</text>");
    });
    function lineY(value) {
      return top + plotH - (value / max) * plotH;
    }
    if (result.target > 0) {
      var targetY = lineY(result.target);
      parts.push('<line x1="' + left + '" y1="' + targetY + '" x2="' + (left + plotW) + '" y2="' + targetY + '" stroke="rgba(255,255,255,0.55)" stroke-dasharray="3 3" stroke-width="1.25"/>');
    }
    if (pace && result.target && Math.abs(pace - result.target) > result.target * 0.02) {
      var paceY = lineY(pace);
      parts.push('<line x1="' + left + '" y1="' + paceY + '" x2="' + (left + plotW) + '" y2="' + paceY + '" stroke="#ff6a00" stroke-dasharray="3 3" stroke-width="1.5"/>');
    }
    var slot = plotW / buckets.length;
    buckets.forEach(function (bucket, index) {
      var showLabel = result.period !== "month" || index === 0 || Number(bucket.label) % 5 === 0 || index === buckets.length - 1;
      if (showLabel) {
        parts.push('<text x="' + (left + slot * index + slot / 2) + '" y="' + (height - 4) + '" text-anchor="middle" fill="#8e8e93" font-size="10">' + bucket.label + "</text>");
      }
      if (bucket.average == null) return;
      var barW = Math.max(2, Math.min(18, slot * 0.62));
      var barH = Math.max(2, (bucket.average / max) * plotH);
      var x = left + slot * index + (slot - barW) / 2;
      var y = top + plotH - barH;
      var fill = bucket.logged > 0 ? "#ff6a00" : "#7a3a12";
      parts.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + barH.toFixed(2) + '" rx="2" fill="' + fill + '"/>');
    });
    parts.push("</svg>");
    els.chart.innerHTML = parts.join("");
    var caption = "Bars are days you have logged.";
    if (result.baseline != null) {
      caption = "Dim bars use your average.";
      if (result.target != null) caption += " White dashes are the " + formatSteps(result.target) + " target.";
      if (pace && result.target && Math.abs(pace - result.target) > result.target * 0.02) {
        caption += " Orange dashes are the " + formatSteps(pace) + " pace still needed.";
      }
    }
    els.chartCaption.textContent = caption;
  }

  function chartLabel(result, buckets) {
    var known = buckets.filter(function (bucket) { return bucket.average != null; });
    if (!known.length) return "No steps charted yet";
    return "Step averages for " + rangeLabel(result);
  }

  function inRange(iso, start, end) {
    return iso >= start && iso <= end;
  }

  function renderCalendar(result) {
    var monthDate = C.parseISO(state.calMonth + "-01");
    els.calTitle.textContent = MONTHS[monthDate.getMonth()] + " " + monthDate.getFullYear();
    var gridStart = C.formatISO(C.addDays(monthDate, -monthDate.getDay()));
    var monthEnd = C.formatISO(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
    var monthEndDate = C.parseISO(monthEnd);
    var gridEnd = C.formatISO(C.addDays(monthEndDate, 6 - monthEndDate.getDay()));
    var today = todayISO();
    els.calGrid.replaceChildren();
    C.eachDay(gridStart, gridEnd).forEach(function (iso) {
      var date = C.parseISO(iso);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "day";
      button.setAttribute("data-date", iso);
      var inMonth = iso.slice(0, 7) === state.calMonth;
      var inPeriod = result.bounds && inRange(iso, result.bounds.start, result.bounds.end);
      var logged = Object.prototype.hasOwnProperty.call(state.days, iso);
      if (!inMonth) button.classList.add("other-month");
      if (inPeriod) button.classList.add("in-period");
      else button.classList.add("outside");
      if (logged) button.classList.add("logged");
      else if (inPeriod && result.baseline != null && iso <= state.asOf) button.classList.add("assumed");
      if (iso === state.asOf) button.classList.add("asof");
      if (iso === today && iso !== state.asOf) button.classList.add("real-today");

      var num = document.createElement("span");
      num.className = "day-num";
      num.textContent = String(date.getDate());
      var steps = document.createElement("span");
      steps.className = "day-steps";
      steps.textContent = logged ? compactSteps(state.days[iso]) : "";
      button.appendChild(num);
      button.appendChild(steps);

      var label = prettyLong(iso);
      if (logged) label += ", " + formatSteps(state.days[iso]) + " steps";
      else if (button.classList.contains("assumed")) label += ", using your average";
      else label += ", not logged";
      button.setAttribute("aria-label", label);
      els.calGrid.appendChild(button);
    });
    els.legend.innerHTML = "<strong>Orange number</strong> is a day you logged. A dot uses your average. The ring is the current date.";
  }

  function render() {
    var model = C.chartSeries(activeInput());
    renderPeriods();
    renderBanner(model.result);
    renderHero(model.result);
    renderStats(model.result);
    renderChart(model);
    renderCalendar(model.result);
  }

  function setError(node, message) {
    node.hidden = !message;
    node.textContent = message || "";
  }

  function readStepsField(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return { empty: true, steps: null };
    var steps = C.cleanSteps(trimmed);
    if (steps == null) return { empty: false, steps: null, error: "Use a whole number from 0 to 250,000." };
    return { empty: false, steps: steps };
  }

  function commitSettings() {
    var date = els.asOfInput.value;
    if (!C.isRealISO(date)) {
      setError(els.settingsError, "Choose a real date.");
      return false;
    }
    var baseline = readStepsField(els.baselineInput.value);
    var target = readStepsField(els.targetInput.value);
    if (baseline.error || target.error) {
      setError(els.settingsError, baseline.error || target.error);
      return false;
    }
    state.asOf = date;
    state.baselines[state.period] = baseline.empty ? null : baseline.steps;
    state.targets[state.period] = target.empty ? null : target.steps;
    if (state.calMonth !== date.slice(0, 7) && !editingISO) {
      /* Keep the calendar where they left it. */
    }
    setError(els.settingsError, "");
    save();
    render();
    return true;
  }

  function fillSettings() {
    els.asOfInput.value = state.asOf;
    els.baselineInput.value = state.baselines[state.period] == null ? "" : String(state.baselines[state.period]);
    els.targetInput.value = state.targets[state.period] == null ? "" : String(state.targets[state.period]);
    setError(els.settingsError, "");
    renderPeriods();
  }

  function openSettings() {
    fillSettings();
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  }

  function setPeriod(period) {
    if (period === state.period) return;
    if (els.settingsDialog.open && !commitSettings()) return;
    state.period = period;
    save();
    render();
    if (els.settingsDialog.open) fillSettings();
  }

  function dayNote(iso) {
    var result = C.compute(activeInput());
    var logged = Object.prototype.hasOwnProperty.call(state.days, iso);
    if (!result.bounds || !inRange(iso, result.bounds.start, result.bounds.end)) {
      return "Outside this " + periodNoun(state.period) + ". The number is saved, and it counts when that period includes this day.";
    }
    if (logged && iso <= state.asOf) return "Logged. This replaces your average for this day.";
    if (logged) return "Logged. This day is no longer part of the remaining pace.";
    if (iso <= state.asOf && result.baseline != null) {
      return "Left blank, this day counts as " + formatSteps(result.baseline) + ", your average.";
    }
    if (iso <= state.asOf) return "This day is inside the average window. Log it, or set an average in Settings.";
    return "Still ahead. Until you log it, this day is part of the pace.";
  }

  function openDay(iso) {
    editingISO = iso;
    els.dayTitle.textContent = prettyLong(iso);
    els.dayNote.textContent = dayNote(iso);
    els.daySteps.value = Object.prototype.hasOwnProperty.call(state.days, iso) ? String(state.days[iso]) : "";
    els.dayClear.hidden = !Object.prototype.hasOwnProperty.call(state.days, iso);
    setError(els.dayError, "");
    if (!els.dayDialog.open) els.dayDialog.showModal();
    els.daySteps.focus();
    els.daySteps.select();
  }

  function closeDay() {
    editingISO = null;
    if (els.dayDialog.open) els.dayDialog.close();
  }

  function saveDay(event) {
    event.preventDefault();
    if (!editingISO) return;
    var read = readStepsField(els.daySteps.value);
    if (read.empty) {
      delete state.days[editingISO];
    } else if (read.error) {
      setError(els.dayError, read.error);
      return;
    } else {
      state.days[editingISO] = read.steps;
    }
    save();
    closeDay();
    render();
  }

  function clearDay() {
    if (!editingISO) return;
    delete state.days[editingISO];
    save();
    closeDay();
    render();
  }

  function shiftMonth(delta) {
    var date = C.parseISO(state.calMonth + "-01");
    var next = new Date(date.getFullYear(), date.getMonth() + delta, 1);
    state.calMonth = C.formatISO(next).slice(0, 7);
    save();
    render();
  }

  function toast(message) {
    els.toast.hidden = false;
    els.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2400);
  }

  function exportJson() {
    if (els.settingsDialog.open && !commitSettings()) return;
    var payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      data: state,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "steps-" + todayISO() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported steps");
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read that file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Steps data in that file");
            return;
          }
        } else if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) {
          slice = parsed.data;
        }
        state = sanitize(slice);
        save();
        fillSettings();
        render();
        toast("Imported steps");
      } catch (e) {
        toast("That file is not a Steps backup");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function cacheEls() {
    [
      "headerSub", "settingsBtn", "staleBanner", "staleText", "staleSettings",
      "heroKicker", "heroNum", "heroSub", "avgNum", "avgSub", "meter", "meterNow",
      "meterGoal", "meterFill", "sentence", "statTarget", "statLeft", "statGap",
      "statLogged", "chartTitle", "chart", "chartCaption", "calTitle", "calGrid",
      "legend", "prevMonth", "nextMonth", "settingsDialog", "settingsForm",
      "settingsDone", "asOfInput", "useToday", "settingsPeriod", "weekHint",
      "baselineLabel", "baselineInput", "baselineHint", "targetLabel", "targetInput",
      "settingsError", "exportBtn", "importFile", "dayDialog", "dayForm", "dayTitle",
      "dayCancel", "dayNote", "daySteps", "dayError", "dayClear", "toast",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function wire() {
    els.settingsBtn.addEventListener("click", openSettings);
    els.staleSettings.addEventListener("click", openSettings);
    els.settingsDone.addEventListener("click", function () {
      if (commitSettings()) els.settingsDialog.close();
    });
    els.settingsForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (commitSettings()) els.settingsDialog.close();
    });
    els.asOfInput.addEventListener("change", commitSettings);
    els.baselineInput.addEventListener("change", commitSettings);
    els.targetInput.addEventListener("change", commitSettings);
    els.useToday.addEventListener("click", function () {
      els.asOfInput.value = todayISO();
      commitSettings();
    });
    document.querySelectorAll(".segment").forEach(function (segment) {
      segment.addEventListener("click", function (event) {
        var button = event.target.closest("[data-period]");
        if (!button || !segment.contains(button)) return;
        setPeriod(button.getAttribute("data-period"));
      });
    });
    els.prevMonth.addEventListener("click", function () { shiftMonth(-1); });
    els.nextMonth.addEventListener("click", function () { shiftMonth(1); });
    els.calGrid.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-date]");
      if (!button) return;
      openDay(button.getAttribute("data-date"));
    });
    els.dayForm.addEventListener("submit", saveDay);
    els.dayCancel.addEventListener("click", closeDay);
    els.dayClear.addEventListener("click", clearDay);
    els.exportBtn.addEventListener("click", exportJson);
    els.importFile.addEventListener("change", function () {
      importJson(els.importFile.files && els.importFile.files[0]);
    });
    els.settingsDialog.addEventListener("click", function (event) {
      if (event.target !== els.settingsDialog) return;
      if (commitSettings()) els.settingsDialog.close();
    });
    els.settingsDialog.addEventListener("cancel", function (event) {
      if (!commitSettings()) event.preventDefault();
    });
    els.dayDialog.addEventListener("click", function (event) {
      if (event.target === els.dayDialog) els.dayDialog.close();
    });
  }

  function init() {
    state = load();
    cacheEls();
    wire();
    save();
    render();
  }

  init();
})();
