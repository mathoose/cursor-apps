(function () {
  'use strict';

  var STORAGE_KEY = 'stride-flow-v1';
  var APP_ID = 'stride-flow';
  var MAX_ACTIVE_GOALS = 3;
  var toastTimer = null;

  var BLOCK_TYPES = {
    work: { label: 'Work', color: '#7eb8d8' },
    commute: { label: 'Commute', color: '#b8b0a8' },
    family: { label: 'Family', color: '#8cc48c' },
    energy: { label: 'Low energy', color: '#e8a86a' },
    sleep: { label: 'Sleep', color: '#b8a0d8' },
    fitness: { label: 'Goals', color: '#e88a8a' },
    goal: { label: '+ Goals', color: '#e8a86a' },
    social: { label: 'Family', color: '#8cc48c' },
  };

  var ui = {
    view: 'chat',
    calendarPeriod: 'today',
    selectedDate: null,
    weekOffset: 0,
    editingGoalId: null,
    activeListId: null,
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function startOfWeek(d) {
    var x = new Date(d);
    var day = x.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function parseDateKey(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function formatTime(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    var am = h < 12;
    var hr = h % 12;
    if (hr === 0) hr = 12;
    return hr + (m ? ':' + pad(m) : '') + (am ? 'am' : 'pm');
  }

  function formatTimeRange(start, end) {
    return formatTime(start) + ' – ' + formatTime(end);
  }

  function formatDayLong(d) {
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function formatDayShort(d) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 3);
  }

  function minutesToDuration(start, end) {
    var mins = end - start;
    if (mins >= 60) {
      var h = Math.floor(mins / 60);
      var r = mins % 60;
      return r ? h + 'h ' + r + 'm' : h + 'h';
    }
    return mins + ' min';
  }

  function defaultData() {
    var today = new Date();
    var mon = startOfWeek(today);
    var g1 = uid();
    var g2 = uid();
    var g3 = uid();
    var g4 = uid();
    var list1 = uid();

    function blockDay(dayOffset, title, type, start, end, goalId, isGoal) {
      var d = new Date(mon);
      d.setDate(d.getDate() + dayOffset);
      return {
        id: uid(),
        title: title,
        type: type,
        date: dateKey(d),
        startMin: start,
        endMin: end,
        goalId: goalId || null,
        isGoal: !!isGoal,
        done: false,
      };
    }

    return {
      version: 1,
      goals: [
        {
          id: g1,
          title: 'NYC Marathon Nov 2027',
          color: '#6db86d',
          status: 'Ongoing',
          target: null,
          pace: 'balanced',
          frequency: '3-5/wk',
          anchors: 'evenings + weekends',
          description: 'Build endurance without overloading weekdays.',
          order: 0,
        },
        {
          id: g2,
          title: 'Build a consistent routine',
          color: '#9b7ed8',
          status: 'Target',
          target: 'Dec 31, 2026',
          pace: 'steady',
          frequency: 'daily anchors',
          anchors: 'school run M–F 08:00',
          description: 'Morning school run and evening wind-down.',
          order: 1,
        },
        {
          id: g3,
          title: 'Grow at work',
          color: '#d86d6d',
          status: 'Target',
          target: 'Aug 31, 2026',
          pace: 'focused',
          frequency: '2 deep blocks/wk',
          anchors: 'office hours',
          description: 'Focus, visibility, and skills.',
          order: 2,
        },
        {
          id: g4,
          title: 'Learn Spanish 3×/week',
          color: '#e8a050',
          status: 'Ongoing',
          target: null,
          pace: 'light',
          frequency: '3/wk',
          anchors: null,
          description: 'Waiting for a quieter season.',
          order: 3,
        },
      ],
      blocks: [
        blockDay(0, 'Work 9–5', 'work', 540, 1020),
        blockDay(0, 'Commute 5–6pm', 'commute', 1020, 1080),
        blockDay(0, 'Low energy 6–8pm', 'energy', 1080, 1200),
        blockDay(0, 'Run 7–7:45pm', 'fitness', 1140, 1185, g1, true),
        blockDay(0, 'Sleep 11pm–7am', 'sleep', 1380, 420),
        blockDay(1, 'Work 9–5', 'work', 540, 1020),
        blockDay(1, 'Commute 5–6pm', 'commute', 1020, 1080),
        blockDay(1, 'Family time 6–8pm', 'family', 1080, 1200),
        blockDay(1, 'Deep work 6–8pm', 'goal', 1080, 1200, g3, true),
        blockDay(1, 'Sleep 11pm–7am', 'sleep', 1380, 420),
        blockDay(2, 'Work 9–5', 'work', 540, 1020),
        blockDay(2, 'Commute 5–6pm', 'commute', 1020, 1080),
        blockDay(2, 'Course lesson', 'goal', 1080, 1140, g4, true),
        blockDay(2, 'Sleep 11pm–7am', 'sleep', 1380, 420),
        blockDay(0, 'Morning school run', 'family', 480, 540),
        blockDay(1, 'Morning school run', 'family', 480, 540),
        blockDay(2, 'Morning school run', 'family', 480, 540),
        blockDay(3, 'Morning school run', 'family', 480, 540),
        blockDay(4, 'Morning school run', 'family', 480, 540),
        blockDay(1, 'Office hours', 'work', 600, 660),
        blockDay(2, 'Easy Evening Run', 'fitness', 1170, 1200, g1, true),
        blockDay(4, 'Easy Evening Run', 'fitness', 1170, 1200, g1, true),
      ],
      lists: [
        {
          id: list1,
          title: 'Healthy week groceries',
          icon: '🛒',
          goalId: g1,
          items: [
            { id: uid(), text: 'Oats', done: false },
            { id: uid(), text: 'Bananas', done: false },
            { id: uid(), text: 'Greek yogurt', done: false },
            { id: uid(), text: 'Spinach', done: false },
            { id: uid(), text: 'Chicken breast', done: false },
            { id: uid(), text: 'Brown rice', done: false },
            { id: uid(), text: 'Almonds', done: false },
            { id: uid(), text: 'Berries', done: false },
            { id: uid(), text: 'Sweet potatoes', done: false },
            { id: uid(), text: 'Eggs', done: false },
          ],
        },
      ],
      chat: [
        {
          role: 'assistant',
          text: 'Hi — I\'m StrideFlow. Tell me when you\'re tired, busy, or need to move a workout. I\'ll propose changes before saving anything.',
          ts: new Date().toISOString(),
        },
      ],
      proposal: null,
      completions: {},
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === 'object' ? raw : defaultData();
    if (!Array.isArray(data.goals)) data.goals = [];
    if (!Array.isArray(data.blocks)) data.blocks = [];
    if (!Array.isArray(data.lists)) data.lists = [];
    if (!Array.isArray(data.chat)) data.chat = [];
    if (!data.completions || typeof data.completions !== 'object') data.completions = {};
    data.version = 1;
    data.goals.forEach(function (g, i) {
      if (!g.id) g.id = uid();
      if (typeof g.order !== 'number') g.order = i;
      if (!g.color) g.color = '#c05c3d';
    });
    data.goals.sort(function (a, b) { return a.order - b.order; });
    data.blocks.forEach(function (b) {
      if (!b.id) b.id = uid();
    });
    data.lists.forEach(function (l) {
      if (!l.id) l.id = uid();
      if (!Array.isArray(l.items)) l.items = [];
      l.items.forEach(function (it) {
        if (!it.id) it.id = uid();
      });
    });
    return data;
  }

  var data = normalizeData(null);

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        data = defaultData();
        saveData();
        return;
      }
      data = normalizeData(JSON.parse(raw));
    } catch (e) {
      data = defaultData();
      saveData();
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
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
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  function getGoal(id) {
    return data.goals.find(function (g) { return g.id === id; });
  }

  function activeGoals() {
    return data.goals.slice().sort(function (a, b) { return a.order - b.order; }).slice(0, MAX_ACTIVE_GOALS);
  }

  function queuedGoals() {
    return data.goals.slice().sort(function (a, b) { return a.order - b.order; }).slice(MAX_ACTIVE_GOALS);
  }

  function blocksForDate(d) {
    var key = dateKey(d);
    return data.blocks
      .filter(function (b) { return b.date === key; })
      .sort(function (a, b) { return a.startMin - b.startMin; });
  }

  function blockIcon(type) {
    var map = { work: '💼', commute: '🚗', family: '👨‍👩‍👧', energy: '🔋', sleep: '🌙', fitness: '🏃', goal: '✦', social: '👥' };
    return map[type] || '•';
  }

  function toggleBlockDone(id) {
    var b = data.blocks.find(function (x) { return x.id === id; });
    if (!b) return;
    b.done = !b.done;
    var key = b.date;
    if (!data.completions[key]) data.completions[key] = {};
    data.completions[key][id] = b.done;
    saveData();
    renderCalendar();
    toast(b.done ? 'Marked done' : 'Marked not done');
  }

  function renderHeader() {
    var title = document.getElementById('headerTitle');
    var extra = document.getElementById('headerExtra');
    var titles = { chat: 'StrideFlow', calendar: 'Calendar', plan: 'StrideFlow', goals: 'Goals', lists: 'Lists' };
    if (title) title.textContent = titles[ui.view] || 'StrideFlow';
    if (!extra) return;
    if (ui.view === 'calendar') {
      var badges = { today: 'Today', week: 'This week', month: 'This month' };
      extra.hidden = false;
      extra.innerHTML = '<span class="period-badge">' + badges[ui.calendarPeriod] + '</span>';
    } else {
      extra.hidden = true;
      extra.innerHTML = '';
    }
  }

  function renderChat() {
    var feed = document.getElementById('chatFeed');
    if (!feed) return;
    feed.innerHTML = data.chat.map(function (msg) {
      if (msg.role === 'user') {
        return '<div class="chat-msg user">' + escapeHtml(msg.text) + '</div>';
      }
      var html = '<div class="chat-msg assistant"><div class="chat-from">STRIDEFLOW</div>' + escapeHtml(msg.text);
      if (msg.bullets && msg.bullets.length) {
        html += '<ul class="chat-bullets">' + msg.bullets.map(function (b) {
          return '<li>' + escapeHtml(b) + '</li>';
        }).join('') + '</ul>';
      }
      html += '</div>';
      return html;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
    renderProposal();
  }

  function renderProposal() {
    var panel = document.getElementById('proposalPanel');
    var changesEl = document.getElementById('proposalChanges');
    if (!panel || !changesEl) return;
    if (!data.proposal) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    changesEl.innerHTML = data.proposal.changes.map(function (c) {
      return '<div class="proposal-change">' +
        '<p class="proposal-change-title">' + escapeHtml(c.title) + '</p>' +
        '<p class="proposal-change-time">' + escapeHtml(c.timeChange) + '</p>' +
        (c.note ? '<p class="proposal-change-note">' + escapeHtml(c.note) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function applyProposal() {
    if (!data.proposal) return;
    data.proposal.changes.forEach(function (c) {
      var b = data.blocks.find(function (x) { return x.id === c.blockId; });
      if (!b) return;
      if (c.newDate) b.date = c.newDate;
      if (typeof c.newStart === 'number') b.startMin = c.newStart;
      if (typeof c.newEnd === 'number') b.endMin = c.newEnd;
    });
    data.chat.push({
      role: 'assistant',
      text: 'Done — your calendar is updated. Tap Calendar to see the new shape of your week.',
      ts: new Date().toISOString(),
    });
    data.proposal = null;
    saveData();
    renderChat();
    renderCalendar();
    renderPlan();
    toast('Changes saved');
  }

  function cancelProposal() {
    data.proposal = null;
    saveData();
    renderProposal();
    toast('Proposal dismissed');
  }

  function findFitnessBlocks() {
    return data.blocks.filter(function (b) {
      return b.type === 'fitness' || (b.isGoal && b.title.toLowerCase().indexOf('run') >= 0);
    });
  }

  function handleChatInput(text) {
    var lower = text.toLowerCase();
    data.chat.push({ role: 'user', text: text, ts: new Date().toISOString() });

    var reply = {
      role: 'assistant',
      text: '',
      bullets: [],
      ts: new Date().toISOString(),
    };

    if (/tired|fatigue|exhausted|can't workout|skip.*(run|workout)|rearrange|move.*(run|workout)/i.test(lower)) {
      var runs = findFitnessBlocks();
      if (!runs.length) {
        reply.text = 'I don\'t see any workouts on your plan yet. Add a fitness block in Calendar, or tell me what you\'d like to schedule.';
      } else {
        var target = runs.find(function (b) {
          var d = parseDateKey(b.date);
          var today = new Date();
          today.setHours(0, 0, 0, 0);
          return d >= today;
        }) || runs[0];

        var oldDate = parseDateKey(target.date);
        var newDate = new Date(oldDate);
        newDate.setDate(newDate.getDate() + 1);
        while (newDate.getDay() === 0 || newDate.getDay() === 6) {
          newDate.setDate(newDate.getDate() + 1);
        }

        var newStart = 1170;
        var newEnd = target.endMin - target.startMin + newStart;

        data.proposal = {
          changes: [{
            blockId: target.id,
            title: target.title,
            timeChange: formatTime(target.startMin) + ' → ' + formatTime(newStart),
            note: 'Moved from ' + formatDayShort(oldDate) + ' — you flagged fatigue, so ' + formatDayShort(newDate) + ' gives you a full rest day before this session.',
            newDate: dateKey(newDate),
            newStart: newStart,
            newEnd: newEnd,
          }],
        };

        reply.text = 'Got it — I\'d move your next workout so you keep rhythm without pushing through low energy. Here\'s the new shape:';
        reply.bullets = [
          formatDayShort(newDate) + ' ' + formatTime(newStart) + ' — ' + target.title + ' · ' + minutesToDuration(newStart, newEnd),
        ];
        if (runs.length > 1) {
          var second = runs.find(function (b) { return b.id !== target.id; });
          if (second) {
            reply.bullets.push(formatDayShort(parseDateKey(second.date)) + ' ' + formatTime(second.startMin) + ' — ' + second.title + ' (unchanged)');
          }
        }
        reply.text += ' Want me to go ahead and update your calendar with this rearrangement? Tap Save below.';
      }
    } else if (/plan|week|schedule|what.*(today|tomorrow)/i.test(lower)) {
      var today = ui.selectedDate || new Date();
      var blocks = blocksForDate(today);
      if (!blocks.length) {
        reply.text = 'Nothing scheduled for ' + formatDayLong(today) + ' yet. Your active goals are: ' +
          activeGoals().map(function (g) { return g.title; }).join(', ') + '.';
      } else {
        reply.text = 'Here\'s ' + formatDayLong(today) + ':';
        reply.bullets = blocks.map(function (b) {
          return formatTimeRange(b.startMin, b.endMin) + ' — ' + b.title;
        });
      }
    } else if (/goal|priority|objective/i.test(lower)) {
      reply.text = 'Your top three active objectives:';
      reply.bullets = activeGoals().map(function (g, i) {
        return '#' + (i + 1) + ' ' + g.title + (g.frequency ? ' · ' + g.frequency : '');
      });
    } else if (/help|what can you/i.test(lower)) {
      reply.text = 'Try: "I\'m too tired to work out tonight — rearrange my week" or "What\'s on my plan today?" I propose changes first; you tap Save to confirm.';
    } else {
      reply.text = 'I hear you. For now I can rearrange workouts when you\'re tired, summarize your day, or list active goals. What would you like to adjust?';
    }

    data.chat.push(reply);
    saveData();
    renderChat();
  }

  function renderCalendar() {
    var body = document.getElementById('calendarBody');
    if (!body) return;
    if (!ui.selectedDate) ui.selectedDate = new Date();

    if (ui.calendarPeriod === 'today') {
      renderCalendarToday(body);
    } else if (ui.calendarPeriod === 'week') {
      renderCalendarWeek(body);
    } else {
      renderCalendarMonth(body);
    }
  }

  function renderMomentum() {
    var levels = [];
    var today = new Date();
    for (var i = 27; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(d.getDate() - i);
      var blocks = blocksForDate(d);
      var done = blocks.filter(function (b) { return b.done; }).length;
      var level = 0;
      if (blocks.length) level = done >= blocks.length ? 3 : done > 0 ? 2 : 1;
      levels.push(level);
    }
    var streak = 0;
    for (var s = 0; s < 28; s++) {
      var dd = new Date(today);
      dd.setDate(dd.getDate() - s);
      var bb = blocksForDate(dd).filter(function (b) { return b.type === 'fitness' || b.isGoal; });
      if (!bb.length) continue;
      if (bb.some(function (b) { return b.done; })) streak++;
      else if (s > 0) break;
    }
    return '<div class="momentum-card">' +
      '<div class="momentum-head">' +
      '<p class="momentum-title">Momentum · Last 4 weeks</p>' +
      '<span class="momentum-streak">' + (streak ? streak + '-day streak 🔥' : 'Start today') + '</span>' +
      '</div>' +
      '<div class="momentum-grid">' +
      levels.map(function (l) {
        return '<div class="momentum-cell' + (l ? ' l' + l : '') + '"></div>';
      }).join('') +
      '</div></div>';
  }

  function renderCalendarToday(body) {
    var sel = ui.selectedDate;
    var strip = [];
    for (var i = -3; i <= 3; i++) {
      var d = new Date(sel);
      d.setDate(d.getDate() + i);
      var active = dateKey(d) === dateKey(sel);
      strip.push('<button type="button" class="date-chip' + (active ? ' active' : '') + '" data-date="' + dateKey(d) + '">' +
        '<div class="dow">' + d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) + '</div>' +
        '<div class="num">' + d.getDate() + '</div></button>');
    }
    var blocks = blocksForDate(sel);
    var doneCount = blocks.filter(function (b) { return b.done; }).length;
    var cards = blocks.length ? blocks.map(function (b) {
      return '<div class="task-card' + (b.done ? ' done' : '') + (b.type === 'fitness' ? ' type-fitness' : '') + '" data-block="' + b.id + '">' +
        '<div class="task-icon">' + blockIcon(b.type) + '</div>' +
        '<div><p class="task-meta">' + escapeHtml(formatTimeRange(b.startMin, b.endMin)) + ' · ' + escapeHtml(minutesToDuration(b.startMin, b.endMin)) + '</p>' +
        '<p class="task-title">' + escapeHtml(b.title) + '</p></div></div>';
    }).join('') : '<div class="empty-state"><p>No blocks today. Ask Chat to rearrange or add goals.</p></div>';

    body.innerHTML = renderMomentum() +
      '<div class="date-strip">' + strip.join('') + '</div>' +
      '<div class="day-header"><h2>' + escapeHtml(formatDayLong(sel)) + '</h2>' +
      '<span class="day-progress">' + doneCount + ' / ' + blocks.length + ' done</span></div>' +
      cards;

    body.querySelectorAll('.date-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.selectedDate = parseDateKey(btn.getAttribute('data-date'));
        renderCalendar();
      });
    });
    body.querySelectorAll('[data-block]').forEach(function (el) {
      el.addEventListener('click', function () {
        toggleBlockDone(el.getAttribute('data-block'));
      });
    });
  }

  function renderCalendarWeek(body) {
    var mon = startOfWeek(new Date());
    mon.setDate(mon.getDate() + ui.weekOffset * 7);
    var sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    var label = mon.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' – ' +
      sun.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

    var rows = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon);
      d.setDate(d.getDate() + i);
      var blocks = blocksForDate(d);
      var isToday = dateKey(d) === dateKey(new Date());
      rows += '<div class="week-day-row' + (isToday ? ' today' : '') + '">' +
        '<div class="week-day-label"><div class="dow">' + formatDayShort(d) + '</div><div class="num">' + d.getDate() + '</div></div>' +
        '<div class="week-day-blocks">' +
        (blocks.length ? blocks.map(function (b) {
          var cls = 'week-chip';
          if (b.type === 'fitness') cls += ' fitness';
          if (b.title.indexOf('Birthday') >= 0) cls += ' event';
          return '<span class="' + cls + '">' + escapeHtml(b.title) + '</span>';
        }).join('') : '<span class="week-chip" style="opacity:0.5">Open</span>') +
        '</div></div>';
    }

    var planGrid = '<div class="plan-hero" style="padding-top:0"><h2 class="plan-title">Here\'s your plan</h2>' +
      '<p class="plan-subtitle">Balanced around your real life.</p></div><div class="week-grid" id="weekGridInline"></div>';

    body.innerHTML = renderMomentum() +
      '<div class="week-nav"><button type="button" id="weekPrev" aria-label="Previous week">‹</button>' +
      '<span>Week ' + escapeHtml(label) + '</span>' +
      '<button type="button" id="weekNext" aria-label="Next week">›</button></div>' +
      planGrid + rows;

    renderPlanGrid(document.getElementById('weekGridInline'), mon);

    var prev = document.getElementById('weekPrev');
    var next = document.getElementById('weekNext');
    if (prev) prev.addEventListener('click', function () { ui.weekOffset--; renderCalendar(); });
    if (next) next.addEventListener('click', function () { ui.weekOffset++; renderCalendar(); });
  }

  function renderCalendarMonth(body) {
    var ref = ui.selectedDate || new Date();
    var year = ref.getFullYear();
    var month = ref.getMonth();
    var first = new Date(year, month, 1);
    var start = new Date(first);
    var dow = first.getDay();
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));

    var dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var html = '<div class="day-header"><h2>' + ref.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</h2></div>';
    html += '<div class="month-grid">' + dows.map(function (d) {
      return '<div class="month-dow">' + d + '</div>';
    }).join('');

    var cur = new Date(start);
    for (var c = 0; c < 42; c++) {
      var inMonth = cur.getMonth() === month;
      var isToday = dateKey(cur) === dateKey(new Date());
      var has = blocksForDate(cur).length > 0;
      html += '<button type="button" class="month-cell' +
        (inMonth ? '' : ' other') + (isToday ? ' today' : '') + (has ? ' has-events' : '') +
        '" data-date="' + dateKey(cur) + '">' + cur.getDate() + '</button>';
      cur.setDate(cur.getDate() + 1);
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('.month-cell').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.selectedDate = parseDateKey(btn.getAttribute('data-date'));
        ui.calendarPeriod = 'today';
        document.querySelectorAll('.period-tab').forEach(function (t) {
          t.classList.toggle('active', t.getAttribute('data-period') === 'today');
        });
        renderHeader();
        renderCalendar();
      });
    });
  }

  function renderPlanGrid(grid, weekStart) {
    if (!grid) return;
    var mon = weekStart || startOfWeek(new Date());
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    var showDays = window.innerWidth >= 500 ? days : days.slice(0, 3);
    grid.innerHTML = showDays.map(function (d) {
      var blocks = blocksForDate(d).filter(function (b) {
        return b.type !== 'family' || b.title.indexOf('school') < 0;
      });
      return '<div class="day-col">' +
        '<div class="day-col-head">' + formatDayShort(d) + '</div>' +
        blocks.map(function (b) {
          return '<div class="time-block type-' + escapeHtml(b.type) + (b.isGoal ? ' has-goal' : '') + '">' +
            escapeHtml(b.title) + '</div>';
        }).join('') +
        '</div>';
    }).join('');
  }

  function renderPlan() {
    var grid = document.getElementById('weekGrid');
    var legend = document.getElementById('legend');
    renderPlanGrid(grid, startOfWeek(new Date()));
    if (legend) {
      var types = ['work', 'commute', 'family', 'energy', 'sleep', 'goal'];
      legend.innerHTML = types.map(function (t) {
        var info = BLOCK_TYPES[t];
        return '<span class="legend-item"><span class="legend-dot" style="background:' + info.color + '"></span>' + info.label + '</span>';
      }).join('');
    }
  }

  function renderGoals() {
    var activeEl = document.getElementById('activeGoals');
    var queuedEl = document.getElementById('queuedGoals');
    var activeCount = document.getElementById('activeGoalCount');
    var queuedCount = document.getElementById('queuedGoalCount');
    if (!activeEl) return;

    var active = activeGoals();
    var queued = queuedGoals();
    if (activeCount) activeCount.textContent = active.length + ' of ' + MAX_ACTIVE_GOALS;
    if (queuedCount) queuedCount.textContent = String(queued.length);

    function goalCard(g, rank) {
      var meta = [g.status === 'Target' && g.target ? 'Target ' + g.target : g.status, g.pace, g.frequency].filter(Boolean).join(' · ');
      return '<div class="goal-card" data-goal="' + g.id + '">' +
        '<div class="goal-accent" style="background:' + escapeHtml(g.color) + '"></div>' +
        '<div class="goal-body">' +
        '<div class="goal-top"><h3 class="goal-title">' + escapeHtml(g.title) + '</h3>' +
        (rank ? '<span class="goal-rank">#' + rank + '</span>' : '') + '</div>' +
        '<p class="goal-meta">' + escapeHtml(meta) + '</p>' +
        (g.anchors ? '<p class="goal-meta">Anchors: ' + escapeHtml(g.anchors) + '</p>' : '') +
        (g.description ? '<p class="goal-desc">' + escapeHtml(g.description) + '</p>' : '') +
        '<div class="goal-actions">' +
        '<button type="button" data-promote="' + g.id + '">↑ Up</button>' +
        '<button type="button" data-demote="' + g.id + '">↓ Down</button>' +
        '</div></div></div>';
    }

    activeEl.innerHTML = active.length ? active.map(function (g, i) { return goalCard(g, i + 1); }).join('') :
      '<div class="empty-state"><p>No active goals yet.</p></div>';
    queuedEl.innerHTML = queued.length ? queued.map(function (g) { return goalCard(g, null); }).join('') :
      '<div class="empty-state"><p>Nothing queued.</p></div>';

    document.querySelectorAll('[data-promote]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        moveGoal(btn.getAttribute('data-promote'), -1);
      });
    });
    document.querySelectorAll('[data-demote]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        moveGoal(btn.getAttribute('data-demote'), 1);
      });
    });
  }

  function moveGoal(id, dir) {
    var sorted = data.goals.slice().sort(function (a, b) { return a.order - b.order; });
    var idx = sorted.findIndex(function (g) { return g.id === id; });
    if (idx < 0) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    var tmp = sorted[idx].order;
    sorted[idx].order = sorted[newIdx].order;
    sorted[newIdx].order = tmp;
    saveData();
    renderGoals();
  }

  function renderLists() {
    var overview = document.getElementById('listOverview');
    var detail = document.getElementById('listDetail');
    if (!overview || !detail) return;

    if (ui.activeListId) {
      overview.hidden = true;
      detail.hidden = false;
      var list = data.lists.find(function (l) { return l.id === ui.activeListId; });
      if (!list) { ui.activeListId = null; renderLists(); return; }
      var goal = list.goalId ? getGoal(list.goalId) : null;
      var done = list.items.filter(function (i) { return i.done; }).length;
      document.getElementById('listDetailIcon').textContent = list.icon || '📋';
      document.getElementById('listDetailTitle').textContent = list.title;
      document.getElementById('listDetailMeta').textContent = 'Checklist · ' + done + '/' + list.items.length + ' done';
      var pill = document.getElementById('listGoalPill');
      if (goal) {
        pill.hidden = false;
        pill.innerHTML = '<span class="goal-pill-dot" style="background:' + escapeHtml(goal.color) + '"></span>' + escapeHtml(goal.title);
      } else {
        pill.hidden = true;
      }
      document.getElementById('checklistCount').textContent = String(list.items.length);
      document.getElementById('checklistItems').innerHTML = list.items.map(function (it) {
        return '<li class="' + (it.done ? 'done' : '') + '" data-item="' + it.id + '">' +
          '<span class="check-circle" role="checkbox" aria-checked="' + it.done + '"></span>' +
          '<span class="check-label">' + escapeHtml(it.text) + '</span></li>';
      }).join('');
      detail.querySelectorAll('[data-item]').forEach(function (li) {
        li.addEventListener('click', function () {
          var itemId = li.getAttribute('data-item');
          var item = list.items.find(function (x) { return x.id === itemId; });
          if (item) {
            item.done = !item.done;
            saveData();
            renderLists();
          }
        });
      });
    } else {
      overview.hidden = false;
      detail.hidden = true;
      var cards = document.getElementById('listCards');
      cards.innerHTML = data.lists.length ? data.lists.map(function (l) {
        var done = l.items.filter(function (i) { return i.done; }).length;
        return '<button type="button" class="list-card" data-list="' + l.id + '">' +
          '<span class="list-card-icon">' + (l.icon || '📋') + '</span>' +
          '<div><p class="list-card-title">' + escapeHtml(l.title) + '</p>' +
          '<p class="list-card-meta">Checklist · ' + done + '/' + l.items.length + ' done</p></div></button>';
      }).join('') : '<div class="empty-state"><p>No lists yet.</p></div>';
      cards.querySelectorAll('[data-list]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          ui.activeListId = btn.getAttribute('data-list');
          renderLists();
        });
      });
    }
  }

  function switchView(view) {
    ui.view = view;
    document.body.className = 'view-' + view;
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-view') === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderHeader();
    if (view === 'chat') renderChat();
    if (view === 'calendar') renderCalendar();
    if (view === 'plan') renderPlan();
    if (view === 'goals') renderGoals();
    if (view === 'lists') { ui.activeListId = null; renderLists(); }
  }

  function openSettings(open) {
    var el = document.getElementById('settingsOverlay');
    if (el) el.hidden = !open;
  }

  function openGoalEditor(goalId) {
    ui.editingGoalId = goalId || null;
    var g = goalId ? getGoal(goalId) : null;
    document.getElementById('goalSheetTitle').textContent = g ? 'Edit goal' : 'Add goal';
    document.getElementById('goalTitle').value = g ? g.title : '';
    document.getElementById('goalDescription').value = g ? (g.description || '') : '';
    document.getElementById('goalPace').value = g ? (g.pace || '') : '';
    document.getElementById('goalFrequency').value = g ? (g.frequency || '') : '';
    document.getElementById('goalOverlay').hidden = false;
  }

  function saveGoal() {
    var title = document.getElementById('goalTitle').value.trim();
    if (!title) { toast('Title required'); return; }
    if (ui.editingGoalId) {
      var g = getGoal(ui.editingGoalId);
      if (g) {
        g.title = title;
        g.description = document.getElementById('goalDescription').value.trim();
        g.pace = document.getElementById('goalPace').value.trim();
        g.frequency = document.getElementById('goalFrequency').value.trim();
      }
    } else {
      data.goals.push({
        id: uid(),
        title: title,
        color: '#c05c3d',
        status: 'Ongoing',
        target: null,
        pace: document.getElementById('goalPace').value.trim(),
        frequency: document.getElementById('goalFrequency').value.trim(),
        anchors: null,
        description: document.getElementById('goalDescription').value.trim(),
        order: data.goals.length,
      });
    }
    document.getElementById('goalOverlay').hidden = true;
    saveData();
    renderGoals();
    toast('Goal saved');
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stride-flow-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) { toast('No StrideFlow data in file'); return; }
        }
        data = normalizeData(slice);
        saveData();
        switchView(ui.view);
        renderChat();
        renderCalendar();
        renderPlan();
        renderGoals();
        renderLists();
        toast('Imported');
      } catch (e) {
        toast('Invalid JSON');
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-view'));
      });
    });

    document.querySelectorAll('.period-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        ui.calendarPeriod = tab.getAttribute('data-period');
        document.querySelectorAll('.period-tab').forEach(function (t) {
          t.classList.toggle('active', t === tab);
        });
        renderHeader();
        renderCalendar();
      });
    });

    var chatInput = document.getElementById('chatInput');
    var chatSend = document.getElementById('chatSendBtn');
    function sendChat() {
      var text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      handleChatInput(text);
    }
    if (chatSend) chatSend.addEventListener('click', sendChat);
    if (chatInput) chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    });

    document.getElementById('proposalSaveBtn').addEventListener('click', applyProposal);
    document.getElementById('proposalCancelBtn').addEventListener('click', cancelProposal);

    document.getElementById('settingsBtn').addEventListener('click', function () { openSettings(true); });
    document.getElementById('settingsCloseBtn').addEventListener('click', function () { openSettings(false); });
    document.getElementById('exportBtn').addEventListener('click', exportJson);
    document.getElementById('importBtn').addEventListener('click', function () {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('resetDemoBtn').addEventListener('click', function () {
      if (confirm('Reset all StrideFlow data to demo content?')) {
        data = defaultData();
        saveData();
        switchView('chat');
        renderChat();
        renderCalendar();
        renderPlan();
        renderGoals();
        renderLists();
        openSettings(false);
        toast('Reset to demo');
      }
    });

    document.getElementById('addGoalBtn').addEventListener('click', function () { openGoalEditor(null); });
    document.getElementById('goalCancelBtn').addEventListener('click', function () {
      document.getElementById('goalOverlay').hidden = true;
    });
    document.getElementById('goalSaveBtn').addEventListener('click', saveGoal);

    document.getElementById('addListBtn').addEventListener('click', function () {
      var title = prompt('List name');
      if (!title || !title.trim()) return;
      data.lists.push({
        id: uid(),
        title: title.trim(),
        icon: '📋',
        goalId: activeGoals()[0] ? activeGoals()[0].id : null,
        items: [],
      });
      saveData();
      renderLists();
      toast('List created');
    });

    document.getElementById('listBackBtn').addEventListener('click', function () {
      ui.activeListId = null;
      renderLists();
    });

    document.getElementById('checklistAddForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('checklistAddInput');
      var text = input.value.trim();
      if (!text || !ui.activeListId) return;
      var list = data.lists.find(function (l) { return l.id === ui.activeListId; });
      if (list) {
        list.items.push({ id: uid(), text: text, done: false });
        saveData();
        input.value = '';
        renderLists();
      }
    });

    window.addEventListener('resize', function () {
      if (ui.view === 'plan') renderPlan();
    });

    var header = document.getElementById('appHeader');
    window.addEventListener('scroll', function () {
      if (header) header.classList.toggle('scrolled', window.scrollY > 8);
    }, { passive: true });
  }

  function init() {
    loadData();
    ui.selectedDate = new Date();
    bindEvents();
    switchView('chat');
    renderPlan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
