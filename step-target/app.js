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

  function todayStory() {
    var today = todayISO();
    var steps = Object.prototype.hasOwnProperty.call(state.days, today) ? state.days[today] : null;
    return C.storyFor(activeInput(), today, steps);
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
    var story = todayStory();
    var todayTarget = story.goal > 0 ? story.goal : result.paceSteps;
    var sub = "next " + dayCount(result.openCount, "day", "days");
    if (story.steps != null && story.remainPace != null) {
      sub = formatSteps(story.remainPace) + " for the next " + dayCount(result.openCount, "day", "days");
    }
    return {
      kicker: "Today's target",
      num: formatSteps(todayTarget),
      sub: sub,
    };
  }

  function dayMark(result) {
    if (result.status === "need-pace" && result.paceSteps > 0) {
      return { steps: result.paceSteps, name: "pace" };
    }
    if (result.target > 0) return { steps: result.target, name: "goal" };
    return null;
  }

  function renderToday(result) {
    var today = todayISO();
    var logged = Object.prototype.hasOwnProperty.call(state.days, today);
    var steps = logged ? state.days[today] : null;
    var story = todayStory();
    var mark = story.goal > 0 ? { steps: story.goal, name: story.goalName || "pace" } : dayMark(result);
    els.todayDate.textContent = prettyLong(today);
    els.todaySave.textContent = logged ? "Update" : "Save";
    if (document.activeElement !== els.todaySteps) {
      els.todaySteps.value = steps == null ? "" : String(steps);
    }
    els.todayCard.classList.remove("met", "short");
    els.todayStatus.classList.remove("met", "short");
    els.todayFill.classList.remove("met", "short");
    if (!mark) {
      els.todayMeter.hidden = true;
      els.todayStatus.textContent = steps == null
        ? "Enter today’s steps. Set a daily target to see if the day is on pace."
        : formatSteps(steps) + " saved for today.";
      return;
    }
    els.todayMeter.hidden = false;
    var ratio = steps == null ? 0 : steps / mark.steps;
    var width = Math.max(0, Math.min(100, ratio * 100));
    els.todayFill.style.width = width + "%";
    var noun = mark.name === "pace" ? "pace" : "goal";
    if (steps == null) {
      els.todayStatus.textContent = "No steps yet. Today’s " + noun + " is " + formatSteps(mark.steps) + ".";
      return;
    }
    var ahead = steps - mark.steps;
    var pct = Math.round(ratio * 100);
    if (ahead >= 0) {
      els.todayCard.classList.add("met");
      els.todayStatus.classList.add("met");
      els.todayFill.classList.add("met");
      var doneWord = ahead > 0
        ? formatSteps(ahead) + " ahead."
        : (mark.name === "pace" ? "On pace." : "Goal met.");
      els.todayStatus.textContent = pct + "% of the " + formatSteps(mark.steps) + " " + noun + ". " + doneWord;
      return;
    }
    els.todayCard.classList.add("short");
    els.todayStatus.classList.add("short");
    els.todayFill.classList.add("short");
    els.todayStatus.textContent = formatSteps(steps) + " of " + formatSteps(mark.steps) +
      " · " + pct + "% · short " + formatSteps(-ahead) + ".";
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

  function ordinal(n) {
    var teen = n % 100;
    if (teen >= 11 && teen <= 13) return n + "th";
    if (n % 10 === 1) return n + "st";
    if (n % 10 === 2) return n + "nd";
    if (n % 10 === 3) return n + "rd";
    return n + "th";
  }

  function prettyOrd(iso) {
    var date = C.parseISO(iso);
    if (!date) return iso || "";
    return MONTHS_SHORT[date.getMonth()] + " " + ordinal(date.getDate());
  }

  function targetPhrase(result) {
    var amount = compactSteps(result.target);
    if (result.period === "year") return amount + " for " + result.bounds.start.slice(0, 4);
    if (result.period === "month") return amount + " for " + MONTHS[C.parseISO(result.bounds.start).getMonth()];
    return amount + " for this week";
  }

  function rangePhrase(start, end, count) {
    if (!start || !end || !(count > 0) || start > end) return "";
    var noun = count === 1 ? "day" : "days";
    var tally = "(" + count + "\u00a0" + noun + ")";
    if (start === end) return "on " + prettyOrd(start) + " " + tally;
    return "from " + prettyOrd(start) + " to " + prettyOrd(end) + " " + tally;
  }

  function remainRange(story) {
    var count = story.blank ? story.openAfter + story.holesBefore : story.after.openCount;
    return rangePhrase(story.from, story.to, count);
  }

  function storyCopy(story) {
    var after = story.after;
    if (!story.inPeriod) {
      return {
        kicker: "",
        pace: "",
        line: "This day sits outside the current " + periodNoun(state.period) + ". The number is saved, and it counts when that period includes it.",
      };
    }
    if (after.target == null) {
      return { kicker: "", pace: "", line: "Set a daily target in Settings to see the remaining pace." };
    }
    if (!after.covered) {
      return { kicker: "", pace: "", line: "Set your average so far in Settings. Then this day can update the pace." };
    }
    if (story.blank) {
      var waitingRange = remainRange(story);
      var waiting = waitingRange
        ? "Add this day’s steps. The average " + waitingRange + " updates from there."
        : "Add this day’s steps to update what’s left.";
      return { kicker: "", pace: "", line: waiting };
    }
    var phrase = targetPhrase(after);
    if (after.status === "ahead" || after.status === "done" || story.remainPace === 0) {
      var aheadRange = remainRange(story);
      var aheadLine = aheadRange
        ? aheadRange.charAt(0).toUpperCase() + aheadRange.slice(1) + " you don’t have to make any of it up."
        : "You don’t have to make any of it up on the days still open.";
      return { kicker: "You’re already set", pace: "", line: "to average " + phrase + ". " + aheadLine };
    }
    if (story.remainPace == null) {
      return { kicker: "Short", pace: "", line: "Every day is logged, and the average finished under " + phrase + "." };
    }
    return {
      kicker: "You’ll need to average",
      pace: formatSteps(story.remainPace) + " steps",
      line: remainRange(story) + " to average " + phrase + ".",
    };
  }

  function gaugeScale(goal, steps) {
    var value = steps == null ? 0 : steps;
    if (!(goal > 0)) {
      return { max: Math.max(value, 10000), goalT: null, percent: null, endPercent: null };
    }
    var ratio = value / goal;
    var percent = Math.round(ratio * 100);
    if (ratio <= 1) {
      return { max: goal, goalT: 1, percent: percent, endPercent: 100 };
    }
    var endPercent = Math.ceil((percent - 1e-9) / 10) * 10;
    if (endPercent <= 100) endPercent = 110;
    return {
      max: goal * (endPercent / 100),
      goalT: 100 / endPercent,
      percent: percent,
      endPercent: endPercent,
    };
  }

  function formatPercent(percent) {
    return percent + "%";
  }

  function gaugePoint(cx, cy, radius, t) {
    var theta = Math.PI * (1 - t);
    return [cx + radius * Math.cos(theta), cy - radius * Math.sin(theta)];
  }

  function gaugeArc(cx, cy, radius, t0, t1) {
    var start = gaugePoint(cx, cy, radius, t0);
    var commands = ["M " + start[0].toFixed(2) + " " + start[1].toFixed(2)];
    var span = t1 - t0;
    var steps = Math.max(1, Math.ceil(span / 0.45));
    var i;
    for (i = 1; i <= steps; i += 1) {
      var end = gaugePoint(cx, cy, radius, t0 + span * (i / steps));
      commands.push("A " + radius + " " + radius + " 0 0 1 " + end[0].toFixed(2) + " " + end[1].toFixed(2));
    }
    return commands.join(" ");
  }

  function renderGauge(steps, goal) {
    var value = steps == null ? 0 : steps;
    var scale = gaugeScale(goal, value);
    var width = 400;
    var height = 198;
    var cx = 200;
    var cy = 146;
    var radius = 104;
    var tNeedle = scale.max > 0 ? Math.max(0, Math.min(1, value / scale.max)) : 0;
    var label = steps == null ? "No steps yet" : formatSteps(steps) + " steps";
    if (scale.percent != null) label += ", " + formatPercent(scale.percent) + " of the goal";
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + label + '">');
    parts.push('<path d="' + gaugeArc(cx, cy, radius, 0, 1) + '" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="18" stroke-linecap="round"/>');
    if (tNeedle > 0.012) {
      parts.push('<path d="' + gaugeArc(cx, cy, radius, 0, tNeedle) + '" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>');
    }
    var tick;
    for (tick = 0; tick <= 8; tick += 1) {
      var outer = gaugePoint(cx, cy, radius - 16, tick / 8);
      var inner = gaugePoint(cx, cy, radius - 28, tick / 8);
      parts.push('<line x1="' + outer[0].toFixed(2) + '" y1="' + outer[1].toFixed(2) + '" x2="' + inner[0].toFixed(2) + '" y2="' + inner[1].toFixed(2) + '" stroke="rgba(255,255,255,0.9)" stroke-width="' + (tick % 2 ? 2 : 3) + '" stroke-linecap="round"/>');
    }
    if (scale.goalT != null && scale.goalT < 0.98) {
      var markOut = gaugePoint(cx, cy, radius + 8, scale.goalT);
      var markIn = gaugePoint(cx, cy, radius - 18, scale.goalT);
      parts.push('<line x1="' + markOut[0].toFixed(2) + '" y1="' + markOut[1].toFixed(2) + '" x2="' + markIn[0].toFixed(2) + '" y2="' + markIn[1].toFixed(2) + '" stroke="#fff" stroke-width="6" stroke-linecap="round"/>');
    }
    if (goal > 0 && scale.goalT != null) {
      var goalWhere = scale.goalT > 0.98 ? 1 : scale.goalT;
      var goalText = formatSteps(goal) + " steps";
      var goalAnchor = "middle";
      var goalX;
      var goalY;
      if (goalWhere > 0.98) {
        var goalSpot = gaugePoint(cx, cy, radius + 28, 1);
        goalX = Math.max(70, Math.min(width - 70, goalSpot[0]));
        goalY = cy + 22;
      } else {
        var goalOuter = gaugePoint(cx, cy, radius + 18, goalWhere);
        goalAnchor = goalWhere < 0.5 ? "end" : "start";
        goalX = goalOuter[0] + (goalAnchor === "end" ? -4 : 6);
        goalY = goalOuter[1] - 2;
      }
      parts.push('<text x="' + goalX.toFixed(1) + '" y="' + goalY.toFixed(1) + '" text-anchor="' + goalAnchor + '" fill="#fff" font-size="15" font-weight="700">' + goalText + "</text>");
    }
    if (steps != null && scale.percent != null) {
      var readSpot = gaugePoint(cx, cy, radius + 26, tNeedle);
      var readAnchor = tNeedle < 0.4 ? "end" : "start";
      var readX = readSpot[0] + (readAnchor === "end" ? -2 : 2);
      var readY = Math.max(20, readSpot[1] - 4);
      parts.push('<text x="' + readX.toFixed(1) + '" y="' + readY.toFixed(1) + '" text-anchor="' + readAnchor + '" fill="#fff" font-size="15" font-weight="700">');
      parts.push('<tspan x="' + readX.toFixed(1) + '">' + formatSteps(steps) + " steps</tspan>");
      parts.push('<tspan x="' + readX.toFixed(1) + '" dy="16">' + formatPercent(scale.percent) + "</tspan>");
      parts.push("</text>");
    }
    var tip = gaugePoint(cx, cy, radius - 40, tNeedle);
    parts.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + tip[0].toFixed(2) + '" y2="' + tip[1].toFixed(2) + '" stroke="#fff" stroke-width="6" stroke-linecap="round"/>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="#fff"/>');
    parts.push("</svg>");
    els.gauge.innerHTML = parts.join("");
    return scale;
  }

  function renderStory() {
    if (!editingISO) return;
    var date = C.parseISO(editingISO);
    els.storyWeekday.textContent = date ? WEEKDAYS[date.getDay()] : "";
    els.storyDate.textContent = date ? MONTHS_SHORT[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear() : "";
    var read = readStepsField(els.daySteps.value);
    var logged = Object.prototype.hasOwnProperty.call(state.days, editingISO);
    var editing = document.activeElement === els.daySteps;
    els.dayClear.hidden = !editing || (!logged && (read.empty || !!read.error));
    if (read.error) {
      setError(els.dayError, read.error);
      return;
    }
    setError(els.dayError, "");
    var story = C.storyFor(activeInput(), editingISO, read.steps);
    var copy = storyCopy(story);
    renderGauge(story.steps, story.goal);
    els.storyVersus.textContent = "";
    els.storyKicker.textContent = copy.kicker;
    els.storyPace.textContent = copy.pace;
    els.storyLine.textContent = copy.line;
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
      var dayGoal = null;
      if (logged) {
        var dayStory = iso === today ? todayStory() : C.storyFor(activeInput(), iso, state.days[iso]);
        if (dayStory.goal > 0) dayGoal = dayStory.goal;
      }
      if (logged) {
        button.classList.add("logged");
        if (dayGoal != null) button.classList.add(state.days[iso] >= dayGoal ? "met" : "short");
      } else if (inPeriod && result.baseline != null && iso <= state.asOf) button.classList.add("assumed");
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
      if (logged) {
        label += ", " + formatSteps(state.days[iso]) + " steps";
        if (button.classList.contains("met")) label += ", met the day";
        if (button.classList.contains("short")) label += ", short of the day";
      } else if (button.classList.contains("assumed")) label += ", using your average";
      else label += ", not logged";
      button.setAttribute("aria-label", label);
      els.calGrid.appendChild(button);
    });
    if (result.status === "need-target" || result.status === "need-baseline") {
      els.legend.textContent = "Logged days show their step count. A dot uses your average. The ring is the average date.";
    } else {
      els.legend.textContent = "Green met that day's target. Red is short of it. A dot uses your average. The ring is the average date.";
    }
  }

  function render() {
    var result = C.compute(activeInput());
    renderPeriods();
    renderToday(result);
    renderHero(result);
    renderStats(result);
    renderCalendar(result);
    if (els.dayDialog.open && editingISO) renderStory();
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

  function openDay(iso) {
    editingISO = iso;
    els.daySteps.value = Object.prototype.hasOwnProperty.call(state.days, iso) ? String(state.days[iso]) : "";
    setError(els.dayError, "");
    if (!els.dayDialog.open) els.dayDialog.showModal();
    renderStory();
    if (!els.daySteps.value) els.daySteps.focus();
  }

  function commitDay() {
    if (!editingISO) return true;
    var read = readStepsField(els.daySteps.value);
    if (read.error) {
      setError(els.dayError, read.error);
      return false;
    }
    if (read.empty) delete state.days[editingISO];
    else state.days[editingISO] = read.steps;
    save();
    return true;
  }

  function closeDay() {
    if (!commitDay()) return;
    editingISO = null;
    if (els.dayDialog.open) els.dayDialog.close();
    render();
  }

  function saveToday(event) {
    event.preventDefault();
    var today = todayISO();
    var read = readStepsField(els.todaySteps.value);
    if (read.error) {
      setError(els.todayError, read.error);
      return;
    }
    setError(els.todayError, "");
    if (read.empty) delete state.days[today];
    else state.days[today] = read.steps;
    if (today.slice(0, 7) !== state.calMonth) state.calMonth = today.slice(0, 7);
    save();
    render();
  }

  function saveDay(event) {
    event.preventDefault();
    if (!commitDay()) return;
    els.daySteps.blur();
    render();
  }

  function clearDay() {
    if (!editingISO) return;
    els.daySteps.value = "";
    delete state.days[editingISO];
    setError(els.dayError, "");
    save();
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
      "headerSub", "settingsBtn", "todayCard", "todayDate", "todayForm", "todaySteps",
      "todaySave", "todayError", "todayMeter", "todayFill", "todayStatus",
      "heroKicker", "heroNum", "heroSub", "avgNum", "avgSub", "meter", "meterNow",
      "meterGoal", "meterFill", "sentence", "statTarget", "statLeft", "statGap",
      "statLogged", "calTitle", "calGrid",
      "legend", "prevMonth", "nextMonth", "settingsDialog", "settingsForm",
      "settingsDone", "asOfInput", "useToday", "settingsPeriod", "weekHint",
      "baselineLabel", "baselineInput", "baselineHint", "targetLabel", "targetInput",
      "settingsError", "exportBtn", "importFile", "dayDialog", "dayForm",
      "storyWeekday", "storyDate", "gauge", "storyVersus", "storyKicker", "storyPace",
      "storyLine", "dayCancel", "daySteps", "dayError", "dayClear", "toast",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function wire() {
    els.settingsBtn.addEventListener("click", openSettings);
    els.todayForm.addEventListener("submit", saveToday);
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
    els.gauge.addEventListener("click", function () {
      els.daySteps.focus();
      els.daySteps.select();
    });
    els.daySteps.addEventListener("input", renderStory);
    els.daySteps.addEventListener("focus", renderStory);
    els.daySteps.addEventListener("blur", renderStory);
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
      if (event.target === els.dayDialog) closeDay();
    });
    els.dayDialog.addEventListener("cancel", function (event) {
      if (!commitDay()) event.preventDefault();
      else editingISO = null;
    });
    els.dayDialog.addEventListener("close", function () {
      if (!editingISO) render();
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
