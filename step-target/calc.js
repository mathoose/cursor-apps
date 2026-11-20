/* Step target math.
   The average you enter covers each day from the period start through the
   as-of date. A logged day replaces that average for its own date.
   Days after the as-of date stay open until logged, and the pace is the
   average those open days need so the whole period lands on the target.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StepTargetCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STEP_CAP = 250000;

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isISODate(iso) {
    return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);
  }

  function parseISO(iso) {
    if (!isISODate(iso)) return null;
    return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  }

  function formatISO(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function isRealISO(iso) {
    var date = parseISO(iso);
    return !!date && formatISO(date) === iso;
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  function shiftISO(iso, n) {
    var date = parseISO(iso);
    if (!date) return null;
    return formatISO(addDays(date, n));
  }

  function eachDay(startISO, endISO) {
    var out = [];
    if (!isRealISO(startISO) || !isRealISO(endISO) || startISO > endISO) return out;
    var date = parseISO(startISO);
    var guard = 0;
    while (formatISO(date) <= endISO && guard < 4000) {
      out.push(formatISO(date));
      date = addDays(date, 1);
      guard += 1;
    }
    return out;
  }

  function cleanSteps(value) {
    if (value == null || value === "") return null;
    var raw = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
    if (raw === "") return null;
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || n > STEP_CAP) return null;
    return Math.round(n);
  }

  function periodBounds(period, asOf) {
    var date = parseISO(asOf);
    if (!date) return null;
    var year = date.getFullYear();
    var month = date.getMonth();
    if (period === "month") {
      var last = new Date(year, month + 1, 0).getDate();
      return {
        period: "month",
        start: formatISO(new Date(year, month, 1)),
        end: formatISO(new Date(year, month, last)),
      };
    }
    if (period === "week") {
      var start = addDays(date, -date.getDay());
      return {
        period: "week",
        start: formatISO(start),
        end: formatISO(addDays(start, 6)),
      };
    }
    return {
      period: "year",
      start: year + "-01-01",
      end: year + "-12-31",
    };
  }

  function loggedSteps(days, iso) {
    if (!days || !Object.prototype.hasOwnProperty.call(days, iso)) return null;
    return cleanSteps(days[iso]);
  }

  function dayValue(input, iso) {
    var logged = loggedSteps(input.days, iso);
    if (logged != null) return { value: logged, source: "log" };
    var baseline = cleanSteps(input.baseline);
    if (baseline != null && iso <= input.asOf) return { value: baseline, source: "average" };
    return null;
  }

  function paceSteps(gap, openCount) {
    if (!(openCount > 0) || !isFinite(gap)) return null;
    if (gap <= 0.5) return 0;
    var raw = gap / openCount;
    var nearest = Math.round(raw);
    if (Math.abs(raw - nearest) < 1e-4) return nearest;
    return Math.ceil(raw - 1e-9);
  }

  function wholeSteps(n) {
    if (!isFinite(n)) return 0;
    if (n <= 0.5) return 0;
    var nearest = Math.round(n);
    if (Math.abs(n - nearest) < 1e-4) return nearest;
    return Math.ceil(n - 1e-9);
  }

  function compute(input) {
    input = input || {};
    var period = input.period === "week" || input.period === "month" ? input.period : "year";
    var asOf = isRealISO(input.asOf) ? input.asOf : null;
    var bounds = asOf ? periodBounds(period, asOf) : null;
    var empty = {
      period: period,
      asOf: asOf,
      bounds: bounds,
      totalDays: 0,
      elapsedCount: 0,
      upcomingCount: 0,
      openCount: 0,
      loggedElapsedCount: 0,
      loggedUpcomingCount: 0,
      unloggedElapsed: 0,
      knownElapsed: 0,
      knownSteps: 0,
      target: cleanSteps(input.target),
      baseline: cleanSteps(input.baseline),
      targetTotal: 0,
      gap: 0,
      gapSteps: 0,
      pace: null,
      paceSteps: null,
      averageSoFar: null,
      covered: false,
      status: "need-target",
    };
    if (!bounds) return empty;

    var all = eachDay(bounds.start, bounds.end);
    var elapsed = [];
    var upcoming = [];
    all.forEach(function (iso) {
      if (iso <= asOf) elapsed.push(iso);
      else upcoming.push(iso);
    });

    var baseline = cleanSteps(input.baseline);
    var target = cleanSteps(input.target);
    var loggedElapsedSteps = 0;
    var loggedElapsedCount = 0;
    var unloggedElapsed = 0;
    elapsed.forEach(function (iso) {
      var logged = loggedSteps(input.days, iso);
      if (logged == null) unloggedElapsed += 1;
      else {
        loggedElapsedSteps += logged;
        loggedElapsedCount += 1;
      }
    });

    var covered = unloggedElapsed === 0 || baseline != null;
    var knownElapsed = loggedElapsedSteps + (baseline != null ? baseline * unloggedElapsed : 0);

    var loggedUpcomingSteps = 0;
    var loggedUpcomingCount = 0;
    var openCount = 0;
    upcoming.forEach(function (iso) {
      var logged = loggedSteps(input.days, iso);
      if (logged == null) openCount += 1;
      else {
        loggedUpcomingSteps += logged;
        loggedUpcomingCount += 1;
      }
    });

    var knownSteps = knownElapsed + loggedUpcomingSteps;
    var targetTotal = target == null ? 0 : target * all.length;
    var gap = target == null ? 0 : targetTotal - knownSteps;
    var averageSoFar = covered && elapsed.length ? knownElapsed / elapsed.length : null;

    var status = "need-target";
    if (target == null) status = "need-target";
    else if (!covered) status = "need-baseline";
    else if (openCount === 0) status = gap <= 0.5 ? "done" : "short";
    else if (gap <= 0.5) status = "ahead";
    else status = "need-pace";

    var pace = covered && target != null && openCount > 0 ? gap / openCount : null;

    return {
      period: period,
      asOf: asOf,
      bounds: bounds,
      totalDays: all.length,
      elapsedCount: elapsed.length,
      upcomingCount: upcoming.length,
      openCount: openCount,
      loggedElapsedCount: loggedElapsedCount,
      loggedUpcomingCount: loggedUpcomingCount,
      unloggedElapsed: unloggedElapsed,
      knownElapsed: knownElapsed,
      knownSteps: knownSteps,
      target: target,
      baseline: baseline,
      targetTotal: targetTotal,
      gap: gap,
      gapSteps: target == null ? 0 : wholeSteps(gap),
      pace: pace,
      paceSteps: pace == null ? null : paceSteps(gap, openCount),
      averageSoFar: averageSoFar,
      covered: covered,
      status: status,
    };
  }

  function bucketFor(input, start, end, label) {
    var days = eachDay(start, end);
    var sum = 0;
    var known = 0;
    var logged = 0;
    days.forEach(function (iso) {
      var value = dayValue(input, iso);
      if (!value) return;
      sum += value.value;
      known += 1;
      if (value.source === "log") logged += 1;
    });
    return {
      label: label,
      start: start,
      end: end,
      average: known ? sum / known : null,
      known: known,
      logged: logged,
      assumed: known - logged,
      containsAsOf: !!(input.asOf && input.asOf >= start && input.asOf <= end),
    };
  }

  function chartSeries(input) {
    var result = compute(input);
    var buckets = [];
    if (!result.bounds) return { result: result, buckets: buckets };
    var normalized = {
      period: result.period,
      asOf: result.asOf,
      baseline: result.baseline,
      target: result.target,
      days: (input && input.days) || {},
    };
    if (result.period === "year") {
      var year = Number(result.asOf.slice(0, 4));
      var letters = "JFMAMJJASOND";
      for (var month = 0; month < 12; month += 1) {
        var start = formatISO(new Date(year, month, 1));
        var end = formatISO(new Date(year, month + 1, 0));
        buckets.push(bucketFor(normalized, start, end, letters.charAt(month)));
      }
    } else {
      eachDay(result.bounds.start, result.bounds.end).forEach(function (iso) {
        var date = parseISO(iso);
        var label = result.period === "week" ? "SMTWTFS".charAt(date.getDay()) : String(date.getDate());
        buckets.push(bucketFor(normalized, iso, iso, label));
      });
    }
    return { result: result, buckets: buckets };
  }

  function niceMax(values) {
    var max = 0;
    values.forEach(function (value) {
      if (value != null && isFinite(value) && value > max) max = value;
    });
    if (max <= 0) return 10000;
    var padded = max * 1.08;
    var step = padded <= 60000 ? 5000 : padded <= 140000 ? 10000 : 20000;
    return Math.ceil(padded / step) * step;
  }

  return {
    STEP_CAP: STEP_CAP,
    isISODate: isISODate,
    isRealISO: isRealISO,
    parseISO: parseISO,
    formatISO: formatISO,
    addDays: addDays,
    shiftISO: shiftISO,
    eachDay: eachDay,
    cleanSteps: cleanSteps,
    periodBounds: periodBounds,
    dayValue: dayValue,
    paceSteps: paceSteps,
    compute: compute,
    chartSeries: chartSeries,
    niceMax: niceMax,
  };
});
