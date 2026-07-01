(function () {
  'use strict';

  var STORAGE_KEY = 'times-tables-v1';
  var APP_ID = 'times-tables';
  var EXPORT_FORMAT = 'times-tables-scores';
  var QUESTIONS_PER_LEVEL = 10;

  var LEVELS = {
    1: { min: 1, max: 12, label: 'Level 1' },
    2: { min: 13, max: 14, label: 'Level 2' },
    3: { min: 15, max: 50, label: 'Level 3' },
  };

  var state = {
    view: 'play',
    chartFilter: 'all',
    data: { version: 1, scores: [] },
    session: null,
    pendingResult: null,
    savedThisResult: false,
  };

  var timerInterval = null;
  var toastTimer = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return { version: 1, scores: [] };
  }

  function normalizeScore(s) {
    if (!s || !s.id || !s.date) return null;
    return {
      id: s.id,
      date: s.date,
      mode: s.mode === 'speed' ? 'speed' : 'level',
      level: [1, 2, 3].indexOf(s.level) >= 0 ? s.level : 1,
      durationMs: typeof s.durationMs === 'number' ? s.durationMs : 0,
      correct: typeof s.correct === 'number' ? s.correct : 0,
      total: typeof s.total === 'number' ? s.total : 0,
      speedSeconds: s.speedSeconds == null ? null : s.speedSeconds,
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : defaultData();
    data.version = 1;
    if (!Array.isArray(data.scores)) data.scores = [];
    data.scores = data.scores
      .map(normalizeScore)
      .filter(Boolean)
      .sort(function (a, b) {
        return new Date(a.date) - new Date(b.date);
      });
    return data;
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomProblem(level) {
    var cfg = LEVELS[level] || LEVELS[1];
    return {
      a: randomInt(cfg.min, cfg.max),
      b: randomInt(cfg.min, cfg.max),
      answer: null,
      correct: null,
      skipped: false,
      submitted: false,
    };
  }

  function formatTimer(ms, countdown) {
    if (ms < 0) ms = 0;
    var totalSec = ms / 1000;
    var min = Math.floor(totalSec / 60);
    var sec = Math.floor(totalSec % 60);
    var tenths = Math.floor((ms % 1000) / 100);
    if (countdown || min > 0) {
      return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenths;
    }
    return '00:' + String(sec).padStart(2, '0') + '.' + tenths;
  }

  function formatDuration(ms) {
    return formatTimer(ms, false);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (e) {
      return iso;
    }
  }

  function formatShortDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  /* ——— Session ——— */

  function createSession(opts) {
    var level = opts.level;
    var mode = opts.mode;
    var speedSeconds = opts.speedSeconds || null;
    var history = [randomProblem(level)];

    return {
      mode: mode,
      level: level,
      speedSeconds: speedSeconds,
      history: history,
      index: 0,
      input: '',
      startedAt: Date.now(),
      elapsedMs: 0,
      finished: false,
      flashTimeout: null,
    };
  }

  function currentItem(session) {
    return session.history[session.index];
  }

  function product(item) {
    return item.a * item.b;
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer(session) {
    stopTimer();
    timerInterval = setInterval(function () {
      if (!session || session.finished) return;
      renderGame();
    }, 100);
  }

  function sessionElapsed(session) {
    if (session.mode === 'speed' && session.speedSeconds) {
      var remaining = session.speedSeconds * 1000 - (Date.now() - session.startedAt);
      return { display: remaining, countdown: true, remaining: remaining };
    }
    var elapsed = Date.now() - session.startedAt;
    return { display: elapsed, countdown: false, remaining: null };
  }

  function countAnswered(session) {
    var correct = 0;
    var total = 0;
    session.history.forEach(function (item) {
      if (item.submitted || item.skipped) {
        total++;
        if (item.correct) correct++;
      }
    });
    return { correct: correct, total: total };
  }

  function levelProgress(session) {
    var answered = countAnswered(session).total;
    var current = Math.min(answered + 1, QUESTIONS_PER_LEVEL);
    return current + ' / ' + QUESTIONS_PER_LEVEL;
  }

  function finishSession(session) {
    session.finished = true;
    stopTimer();
    var stats = countAnswered(session);
    var elapsed = session.mode === 'speed'
      ? (session.speedSeconds || 0) * 1000
      : Date.now() - session.startedAt;

    state.pendingResult = {
      mode: session.mode,
      level: session.level,
      durationMs: elapsed,
      correct: stats.correct,
      total: session.mode === 'level' ? QUESTIONS_PER_LEVEL : stats.total,
      speedSeconds: session.speedSeconds,
    };
    state.savedThisResult = false;
    showScreen('results');
    renderResults();
  }

  function checkLevelComplete(session) {
    if (session.mode !== 'level') return false;
    return countAnswered(session).total >= QUESTIONS_PER_LEVEL;
  }

  function submitAnswer() {
    var session = state.session;
    if (!session || session.finished) return;

    var item = currentItem(session);
    if (!session.input && session.input !== '0') return;

    var ans = parseInt(session.input, 10);
    if (isNaN(ans)) return;

    item.answer = ans;
    item.correct = ans === product(item);
    item.skipped = false;
    item.submitted = true;

    flashLcd(item.correct ? 'correct' : 'wrong');

    setTimeout(function () {
      if (!state.session || state.session !== session || session.finished) return;

      if (checkLevelComplete(session)) {
        finishSession(session);
        return;
      }

      if (session.mode === 'speed') {
        var rem = sessionElapsed(session).remaining;
        if (rem != null && rem <= 0) {
          finishSession(session);
          return;
        }
        session.history.push(randomProblem(session.level));
        session.index = session.history.length - 1;
        session.input = '';
      } else if (session.index < session.history.length - 1) {
        session.index++;
        var next = currentItem(session);
        session.input = next.answer != null ? String(next.answer) : '';
      } else {
        session.history.push(randomProblem(session.level));
        session.index = session.history.length - 1;
        session.input = '';
      }

      renderGame();
    }, 400);
  }

  function skipQuestion() {
    var session = state.session;
    if (!session || session.finished) return;

    var item = currentItem(session);
    item.skipped = true;
    item.submitted = true;
    item.correct = false;
    item.answer = null;

    if (checkLevelComplete(session)) {
      finishSession(session);
      return;
    }

    if (session.mode === 'speed') {
      var rem = sessionElapsed(session).remaining;
      if (rem != null && rem <= 0) {
        finishSession(session);
        return;
      }
    }

    if (session.index < session.history.length - 1) {
      session.index++;
    } else {
      session.history.push(randomProblem(session.level));
      session.index = session.history.length - 1;
    }
    session.input = '';
    renderGame();
  }

  function goBack() {
    var session = state.session;
    if (!session || session.finished || session.index <= 0) return;

    session.index--;
    var item = currentItem(session);
    session.input = item.answer != null ? String(item.answer) : '';
    renderGame();
  }

  function flashLcd(kind) {
    var lcd = document.getElementById('lcd');
    if (!lcd) return;
    lcd.classList.remove('flash-correct', 'flash-wrong');
    void lcd.offsetWidth;
    lcd.classList.add(kind === 'correct' ? 'flash-correct' : 'flash-wrong');
    if (state.session && state.session.flashTimeout) clearTimeout(state.session.flashTimeout);
    if (state.session) {
      state.session.flashTimeout = setTimeout(function () {
        lcd.classList.remove('flash-correct', 'flash-wrong');
      }, 350);
    }
  }

  /* ——— Screens ——— */

  function showScreen(name) {
    document.getElementById('screenHome').hidden = name !== 'home';
    document.getElementById('screenGame').hidden = name !== 'game';
    document.getElementById('screenResults').hidden = name !== 'results';
  }

  function startLevel(level) {
    state.session = createSession({ mode: 'level', level: level });
    showScreen('game');
    startTimer(state.session);
    renderGame();
  }

  function startSpeed(level, seconds) {
    state.session = createSession({ mode: 'speed', level: level, speedSeconds: seconds });
    showScreen('game');
    startTimer(state.session);
    renderGame();
  }

  function quitSession() {
    if (state.session && !state.session.finished) {
      if (!confirm('Quit this run? Progress will be lost.')) return;
    }
    stopTimer();
    state.session = null;
    state.pendingResult = null;
    showScreen('home');
  }

  function renderGame() {
    var session = state.session;
    if (!session) return;

    if (session.mode === 'speed') {
      var rem = sessionElapsed(session).remaining;
      if (rem != null && rem <= 0 && !session.finished) {
        finishSession(session);
        return;
      }
    }

    var item = currentItem(session);
    var timeInfo = sessionElapsed(session);
    var cfg = LEVELS[session.level];

    document.getElementById('lcdMode').textContent =
      session.mode === 'speed'
        ? cfg.label + ' · Speed'
        : cfg.label;
    document.getElementById('lcdProgress').textContent =
      session.mode === 'speed'
        ? countAnswered(session).correct + ' correct'
        : levelProgress(session);
    document.getElementById('lcdTimer').textContent = formatTimer(timeInfo.display, timeInfo.countdown);
    document.getElementById('lcdProblem').textContent = item.a + ' × ' + item.b + ' = ?';

    var inputEl = document.getElementById('lcdInput');
    inputEl.textContent = session.input;
    inputEl.classList.toggle('has-value', !!session.input);

    document.getElementById('btnBack').disabled = session.index <= 0;
  }

  function renderResults() {
    var r = state.pendingResult;
    if (!r) return;

    var timeLabel = r.mode === 'speed'
      ? formatDuration(r.durationMs) + ' run'
      : formatDuration(r.durationMs);

    document.getElementById('resultTime').textContent = timeLabel;
    document.getElementById('resultDetail').textContent =
      r.correct + ' / ' + r.total + ' correct · ' + (LEVELS[r.level] || LEVELS[1]).label;

    var saveBtn = document.getElementById('btnSaveScore');
    saveBtn.textContent = state.savedThisResult ? 'Saved ✓' : 'Save score';
    saveBtn.disabled = state.savedThisResult;
  }

  function saveCurrentScore() {
    var r = state.pendingResult;
    if (!r || state.savedThisResult) return;

    var score = {
      id: uid(),
      date: new Date().toISOString(),
      mode: r.mode,
      level: r.level,
      durationMs: r.durationMs,
      correct: r.correct,
      total: r.total,
      speedSeconds: r.speedSeconds,
    };

    state.data.scores.push(score);
    state.data.scores.sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    saveData(state.data);
    state.savedThisResult = true;
    renderResults();
    renderStats();
    toast('Score saved');
  }

  /* ——— Stats & chart ——— */

  function filterScores(filter) {
    var scores = state.data.scores.slice();
    if (filter === 'all') return scores;
    if (filter === 'speed') return scores.filter(function (s) { return s.mode === 'speed'; });
    var level = parseInt(filter.replace('level-', ''), 10);
    return scores.filter(function (s) {
      return s.mode === 'level' && s.level === level;
    });
  }

  function scoreChartValue(score, filter) {
    if (filter === 'speed' || score.mode === 'speed') {
      return score.correct;
    }
    return score.durationMs / 1000;
  }

  function renderChart() {
    var canvas = document.getElementById('progressChart');
    var empty = document.getElementById('chartEmpty');
    var yLabel = document.getElementById('chartYLabel');
    if (!canvas) return;

    var filter = state.chartFilter;
    var allScores = filterScores(filter);
    var scores = allScores;
    var chartMode = filter;

    if (filter === 'all') {
      var levelOnly = allScores.filter(function (s) { return s.mode === 'level'; });
      var speedOnly = allScores.filter(function (s) { return s.mode === 'speed'; });
      if (levelOnly.length) {
        scores = levelOnly;
        chartMode = 'level';
      } else if (speedOnly.length) {
        scores = speedOnly;
        chartMode = 'speed';
      }
    }

    yLabel.textContent = filter === 'speed' || chartMode === 'speed'
      ? 'Correct answers — higher is better'
      : filter === 'all' && allScores.some(function (s) { return s.mode === 'speed'; }) && allScores.some(function (s) { return s.mode === 'level'; })
        ? 'Level run time (seconds) — speed runs in list below'
        : 'Time (seconds) — lower is better';

    if (!scores.length) {
      canvas.hidden = true;
      empty.hidden = false;
      canvas._points = [];
      return;
    }

    canvas.hidden = false;
    empty.hidden = true;

    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(rect.width, 300);
    var h = 280;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var pad = { top: 20, right: 16, bottom: 36, left: 44 };
    var plotW = w - pad.left - pad.right;
    var plotH = h - pad.top - pad.bottom;

    var values = scores.map(function (s) {
      return scoreChartValue(s, chartMode === 'speed' ? 'speed' : filter);
    });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    if (minV === maxV) {
      minV = minV * 0.9;
      maxV = maxV * 1.1 || 1;
    }
    var range = maxV - minV || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#faf8f4';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#e4ddd2';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.top + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();

      var val = maxV - (range * g) / 4;
      ctx.fillStyle = '#6b7264';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        chartMode === 'speed' ? Math.round(val) : val.toFixed(1),
        pad.left - 6,
        gy + 3
      );
    }

    var points = scores.map(function (s, i) {
      var x = pad.left + (scores.length === 1 ? plotW / 2 : (plotW * i) / (scores.length - 1));
      var v = scoreChartValue(s, chartMode === 'speed' ? 'speed' : filter);
      var y = pad.top + plotH - ((v - minV) / range) * plotH;
      return { x: x, y: y, score: s };
    });
    canvas._points = points;

    if (points.length > 1) {
      ctx.strokeStyle = '#c45c2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    points.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.score.mode === 'speed' ? '#3d7a3d' : '#c45c2a';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    ctx.fillStyle = '#6b7264';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    var labelStep = Math.max(1, Math.ceil(scores.length / 6));
    scores.forEach(function (s, i) {
      if (i % labelStep !== 0 && i !== scores.length - 1) return;
      var x = pad.left + (scores.length === 1 ? plotW / 2 : (plotW * i) / (scores.length - 1));
      ctx.fillText(formatShortDate(s.date), x, h - 10);
    });
  }

  function renderScoreList() {
    var list = document.getElementById('scoreList');
    var empty = document.getElementById('statsEmpty');
    var scores = filterScores(state.chartFilter).slice().reverse();

    if (!scores.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.innerHTML = scores.map(function (s) {
      var modeLabel = s.mode === 'speed'
        ? 'Speed ' + (s.speedSeconds === 180 ? '3 min' : '1 min')
        : 'Level ' + s.level;
      var value = s.mode === 'speed'
        ? s.correct + ' correct'
        : formatDuration(s.durationMs);
      return (
        '<li class="score-item">' +
          '<div>' +
            '<div>' + escapeHtml(modeLabel) + '</div>' +
            '<div class="score-item-meta">' + escapeHtml(formatDate(s.date)) + ' · ' + s.correct + '/' + s.total + '</div>' +
          '</div>' +
          '<div class="score-item-value">' + escapeHtml(value) + '</div>' +
        '</li>'
      );
    }).join('');
  }

  function renderStats() {
    renderChart();
    renderScoreList();
  }

  function handleChartTap(ev) {
    var canvas = document.getElementById('progressChart');
    var tooltip = document.getElementById('chartTooltip');
    if (!canvas || !canvas._points || !canvas._points.length) return;

    var rect = canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;
    var hit = null;
    var best = 24;

    canvas._points.forEach(function (p) {
      var d = Math.hypot(p.x - x, p.y - y);
      if (d < best) {
        best = d;
        hit = p;
      }
    });

    if (!hit) {
      tooltip.hidden = true;
      return;
    }

    var s = hit.score;
    var detail = s.mode === 'speed'
      ? s.correct + ' correct in ' + (s.speedSeconds === 180 ? '3' : '1') + ' min'
      : formatDuration(s.durationMs) + ' · ' + s.correct + '/' + s.total;
    tooltip.innerHTML = escapeHtml(formatDate(s.date)) + '<br>' + escapeHtml(detail);
    tooltip.hidden = false;
    tooltip.style.left = hit.x + 'px';
    tooltip.style.top = (hit.y - 8) + 'px';
  }

  /* ——— Navigation ——— */

  function setView(view) {
    state.view = view;
    document.body.className = 'view-' + view;
    document.querySelectorAll('.view').forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var on = btn.dataset.view === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'stats') {
      renderStats();
    }
  }

  /* ——— Import / export ——— */

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function exportJson() {
    var payload = {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      scores: state.data.scores,
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'times-tables-scores.json'
    );
    toast('Exported');
  }

  function mergeScores(existing, incoming) {
    var ids = {};
    var out = (existing || []).slice();
    out.forEach(function (s) { ids[s.id] = true; });
    (incoming || []).forEach(function (s) {
      var n = normalizeScore(s);
      if (n && !ids[n.id]) {
        out.push(n);
        ids[n.id] = true;
      }
    });
    out.sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    return out;
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;

        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast('No Times Tables data in that backup');
            return;
          }
        }

        var incoming = [];
        if (slice.format === EXPORT_FORMAT || Array.isArray(slice.scores)) {
          incoming = slice.scores || [];
        } else if (AppsBackup && AppsBackup.APP_REGISTRY && AppsBackup.APP_REGISTRY[APP_ID] && AppsBackup.APP_REGISTRY[APP_ID].isLegacy(slice)) {
          incoming = slice.scores || [];
        } else {
          toast('Unrecognized file format');
          return;
        }

        state.data.scores = mergeScores(state.data.scores, incoming);
        saveData(state.data);
        renderStats();
        toast('Imported ' + incoming.length + ' record(s)');
      } catch (e) {
        toast('Could not read file');
      }
    };
    reader.readAsText(file);
  }

  /* ——— Events ——— */

  function handleKey(key) {
    var session = state.session;
    if (!session || session.finished) return;

    if (key === 'clear') {
      session.input = '';
    } else if (key === 'enter') {
      submitAnswer();
      return;
    } else {
      if (session.input.length >= 6) return;
      session.input += key;
    }
    renderGame();
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.dataset.view);
      });
    });

    document.querySelectorAll('[data-action="start-level"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startLevel(parseInt(btn.dataset.level, 10));
      });
    });

    document.querySelectorAll('[data-action="start-speed"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var level = parseInt(document.getElementById('speedLevel').value, 10);
        startSpeed(level, parseInt(btn.dataset.seconds, 10));
      });
    });

    document.getElementById('keypad').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-key]');
      if (!btn) return;
      handleKey(btn.dataset.key);
    });

    document.getElementById('btnBack').addEventListener('click', goBack);
    document.getElementById('btnSkip').addEventListener('click', skipQuestion);
    document.getElementById('btnQuit').addEventListener('click', quitSession);
    document.getElementById('btnSaveScore').addEventListener('click', saveCurrentScore);
    document.getElementById('btnPlayAgain').addEventListener('click', function () {
      var r = state.pendingResult;
      if (!r) { showScreen('home'); return; }
      if (r.mode === 'speed') {
        startSpeed(r.level, r.speedSeconds || 60);
      } else {
        startLevel(r.level);
      }
    });
    document.getElementById('btnHome').addEventListener('click', function () {
      state.session = null;
      state.pendingResult = null;
      showScreen('home');
    });

    document.querySelectorAll('#chartFilters .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#chartFilters .chip').forEach(function (c) {
          c.classList.toggle('active', c === chip);
        });
        state.chartFilter = chip.dataset.filter;
        renderStats();
      });
    });

    var chart = document.getElementById('progressChart');
    chart.addEventListener('click', handleChartTap);
    chart.addEventListener('touchend', function (ev) {
      if (ev.changedTouches && ev.changedTouches[0]) {
        handleChartTap(ev.changedTouches[0]);
      }
    });

    window.addEventListener('resize', function () {
      if (state.view === 'stats') renderChart();
    });

    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonFile').addEventListener('change', function (ev) {
      importJsonFile(ev.target.files && ev.target.files[0]);
      ev.target.value = '';
    });

    document.getElementById('clearScoresBtn').addEventListener('click', function () {
      if (!confirm('Delete all saved scores?')) return;
      state.data.scores = [];
      saveData(state.data);
      renderStats();
      toast('Scores cleared');
    });

    document.addEventListener('keydown', function (ev) {
      if (state.view !== 'play' || !state.session || state.session.finished) return;
      if (document.getElementById('screenGame').hidden) return;

      if (ev.key >= '0' && ev.key <= '9') {
        ev.preventDefault();
        handleKey(ev.key);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        handleKey('enter');
      } else if (ev.key === 'Backspace') {
        ev.preventDefault();
        state.session.input = state.session.input.slice(0, -1);
        renderGame();
      } else if (ev.key === 'Escape') {
        quitSession();
      }
    });
  }

  function init() {
    state.data = loadData();
    showScreen('home');
    bindEvents();
    setView('play');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
