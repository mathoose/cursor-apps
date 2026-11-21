(function () {
  "use strict";

  var STORAGE_KEY = "stock-purchases-v1";
  var QUOTE_KEY = "stock-purchases-quotes-v1";
  var APP_ID = "stock-purchases";
  var EXPORT_FORMAT = "stock-purchases";
  var CACHE_MS = 6 * 60 * 60 * 1000;
  var HOLD_MS = 400;
  var LINE_VALUE = "#34d399";
  var LINE_DIV = "#fbbf24";
  var LINE_COST = "rgba(167, 176, 192, 0.9)";
  var SYMBOL_COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#fb7185", "#a78bfa", "#fb923c", "#2dd4bf", "#e879f9", "#f472b6", "#a3e635"];
  var PLOT_H = 260;
  var STEM_H = 200;

  var data = { version: 1, hideDividends: false, purchases: [] };
  var quotes = {};
  var quoteErrors = {};
  var ui = { loading: false, windowId: "all", hiddenSymbols: {}, editingId: null, formSide: "buy" };
  var pendingName = "";
  var pickedSymbol = "";
  var deleteArmed = false;
  var searchTimer = null;
  var searchSeq = 0;
  var hintSeq = 0;
  var hintTimer = null;
  var inflight = {};
  var toastTimer = null;
  var resizeTimer = null;
  var inspect = { active: false, timer: null, pointerId: null };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function newId() {
    return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeSymbol(value) {
    return String(value || "").trim().toUpperCase().replace(/^\$/, "");
  }

  function validSymbol(symbol) {
    return /^[A-Z0-9.^=-]{1,15}$/.test(symbol);
  }

  function normalizePurchase(raw) {
    if (!raw || typeof raw !== "object") return null;
    var symbol = normalizeSymbol(raw.symbol);
    var date = String(raw.date || "");
    var side = raw.side === "sell" || raw.side === "dividend" || raw.side === "split" ? raw.side : "buy";
    var shares = Number(raw.shares);
    var price = Number(raw.price);
    var amount = Number(raw.amount);
    if (!validSymbol(symbol)) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var numerator = Number(raw.numerator);
    var denominator = Number(raw.denominator);
    if (side === "dividend") {
      if (!isFinite(amount) || amount === 0) return null;
      shares = 0;
      price = 0;
    } else if (side === "split") {
      if (!isFinite(numerator) || !isFinite(denominator) || numerator <= 0 || denominator <= 0) return null;
      shares = 0;
      price = 0;
    } else {
      if (!isFinite(shares) || shares <= 0) return null;
      if (!isFinite(price) || price < 0) return null;
    }
    var lot = {
      id: String(raw.id || newId()),
      symbol: symbol,
      name: String(raw.name || "").slice(0, 80),
      date: date,
      side: side,
      shares: shares,
      price: price,
      note: String(raw.note || "").slice(0, 200),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
    if (side === "dividend" || (isFinite(amount) && amount !== 0)) lot.amount = Math.abs(amount);
    if (raw.orderType === "market" || raw.orderType === "limit") lot.orderType = raw.orderType;
    if (side === "split") {
      lot.numerator = numerator;
      lot.denominator = denominator;
    }
    if (isFinite(Number(raw.seq))) lot.seq = Number(raw.seq);
    return lot;
  }

  function normalizeData(raw) {
    var purchases = [];
    var seen = {};
    ((raw && raw.purchases) || []).forEach(function (row) {
      var lot = normalizePurchase(row);
      if (!lot || seen[lot.id]) return;
      seen[lot.id] = true;
      purchases.push(lot);
    });
    return {
      version: 1,
      hideDividends: !!(raw && raw.hideDividends),
      purchases: purchases,
    };
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2400);
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        hideDividends: !!data.hideDividends,
        purchases: data.purchases,
      }));
    } catch (e) {
      toast("Couldn't save on this device");
    }
  }

  function saveQuotes() {
    try {
      localStorage.setItem(QUOTE_KEY, JSON.stringify(quotes));
    } catch (e) {
      /* The purchase list is the source of truth. A full price cache can be fetched again. */
    }
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var next = normalizeData(JSON.parse(raw));
      data.hideDividends = next.hideDividends;
      data.purchases = next.purchases;
    } catch (e) {
      data.purchases = [];
    }
  }

  function loadQuotes() {
    try {
      var raw = localStorage.getItem(QUOTE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") quotes = parsed;
    } catch (e) {
      quotes = {};
    }
  }

  function formatDate(key) {
    var ms = StockCalc.dateToUtcMs(key);
    if (!isFinite(ms)) return "";
    return new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function formatAxisDate(key, start, end) {
    var ms = StockCalc.dateToUtcMs(key);
    if (!isFinite(ms)) return "";
    var date = new Date(ms);
    var month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    if (start && end && start.slice(0, 4) === end.slice(0, 4)) return month + " " + date.getUTCDate();
    return month + " '" + String(date.getUTCFullYear()).slice(2);
  }

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function money(n, currency) {
    if (!isNum(n)) return "—";
    var cur = currency || "USD";
    var digits = Math.abs(n) > 0 && Math.abs(n) < 1 ? 4 : 2;
    try {
      return n.toLocaleString("en-US", {
        style: "currency",
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: digits,
      });
    } catch (e) {
      return cur + " " + n.toFixed(2);
    }
  }

  function signedMoney(n, currency) {
    if (!isNum(n)) return "—";
    var body = money(Math.abs(n), currency);
    if (n > 0) return "+" + body;
    if (n < 0) return "−" + body;
    return body;
  }

  function formatPct(part, whole) {
    if (!isNum(part) || !isNum(whole) || !whole) return "";
    var pct = (part / whole) * 100;
    return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  function formatShares(n) {
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  function symbolColor(symbol) {
    var hash = 0;
    var text = String(symbol || "");
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return SYMBOL_COLORS[hash % SYMBOL_COLORS.length];
  }

  function symbolsInUse() {
    var list = [];
    var seen = {};
    data.purchases.forEach(function (lot) {
      if (seen[lot.symbol]) return;
      seen[lot.symbol] = true;
      list.push(lot.symbol);
    });
    return list;
  }

  function selectedLots() {
    return data.purchases.filter(function (lot) { return !ui.hiddenSymbols[lot.symbol]; });
  }

  function earliestDate(lots) {
    var earliest = "";
    (lots || data.purchases).forEach(function (lot) {
      if (!earliest || lot.date < earliest) earliest = lot.date;
    });
    return earliest;
  }

  function quoteCurrency(symbol) {
    return (quotes[symbol] && quotes[symbol].currency) || "USD";
  }

  function selectionCurrency(lots) {
    var currency = null;
    for (var i = 0; i < lots.length; i++) {
      var quote = quotes[lots[i].symbol];
      if (!quote) continue;
      var next = quote.currency || "USD";
      if (!currency) currency = next;
      else if (currency !== next) return null;
    }
    return currency || "USD";
  }

  function dayMove(quote) {
    var bars = (quote && quote.bars) || [];
    if (bars.length < 2) return null;
    var last = bars[bars.length - 1].close;
    var prev = bars[bars.length - 2].close;
    if (!isFinite(last) || !isFinite(prev) || !prev) return null;
    return { last: last, pct: (last - prev) / prev };
  }

  function yahoo(path) {
    return "https://proxy.cors.dev/https://query1.finance.yahoo.com" + path;
  }

  function chartUrl(symbol, period1, period2) {
    return yahoo("/v8/finance/chart/" + encodeURIComponent(symbol) +
      "?period1=" + period1 + "&period2=" + period2 + "&interval=1d&events=div%2Csplit");
  }

  function rangeFor(earliest) {
    var startKey = earliest && /^\d{4}-\d{2}-\d{2}$/.test(earliest) ? StockCalc.addDays(earliest, -14) : StockCalc.addDays(StockCalc.todayKey(), -30);
    return {
      period1: Math.floor(StockCalc.dateToUtcMs(startKey) / 1000),
      period2: Math.floor(Date.now() / 1000) + 86400,
    };
  }

  function fetchJson(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("Price request failed (" + res.status + ")");
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") throw new Error("Price request timed out");
      throw new Error("Couldn't reach price data");
    });
  }

  function needsFetch(quote, earliest) {
    if (!quote || !quote.fetchedAt || !quote.bars || !quote.bars.length) return true;
    if (Date.now() - quote.fetchedAt > CACHE_MS) return true;
    if (earliest && quote.requestedFrom && earliest < quote.requestedFrom) return true;
    return false;
  }

  function fetchSymbol(symbol, earliest) {
    var key = symbol + "|" + (earliest || "");
    if (inflight[key]) return inflight[key];
    var range = rangeFor(earliest);
    var promise = fetchJson(chartUrl(symbol, range.period1, range.period2)).then(function (payload) {
      var quote = StockCalc.parseChart(symbol, payload);
      quote.fetchedAt = Date.now();
      quote.requestedFrom = earliest || StockCalc.todayKey();
      if (!quote.bars.length && quote.regularMarketPrice == null) throw new Error("No price data for " + symbol);
      return quote;
    });
    inflight[key] = promise;
    promise.then(function () { delete inflight[key]; }, function () { delete inflight[key]; });
    return promise;
  }

  function mapPool(items, limit, fn) {
    var index = 0;
    function worker() {
      if (index >= items.length) return Promise.resolve();
      var item = items[index++];
      return Promise.resolve().then(function () { return fn(item); }).then(worker, worker);
    }
    var jobs = [];
    var count = Math.min(limit, items.length);
    for (var i = 0; i < count; i++) jobs.push(worker());
    return Promise.all(jobs);
  }

  function jobsFor(force) {
    var earliestBySymbol = {};
    data.purchases.forEach(function (lot) {
      if (!earliestBySymbol[lot.symbol] || lot.date < earliestBySymbol[lot.symbol]) earliestBySymbol[lot.symbol] = lot.date;
    });
    return Object.keys(earliestBySymbol).filter(function (symbol) {
      return force || needsFetch(quotes[symbol], earliestBySymbol[symbol]);
    }).map(function (symbol) {
      return { symbol: symbol, earliest: earliestBySymbol[symbol] };
    });
  }

  function refreshQuotes(force) {
    var jobs = jobsFor(!!force);
    if (!jobs.length) {
      ui.loading = false;
      renderStatus();
      return Promise.resolve();
    }
    ui.loading = true;
    renderStatus();
    els.refreshBtn.disabled = true;
    return mapPool(jobs, 3, function (job) {
      return fetchSymbol(job.symbol, job.earliest).then(function (quote) {
        quotes[job.symbol] = quote;
        delete quoteErrors[job.symbol];
        var named = false;
        data.purchases.forEach(function (lot) {
          if (lot.symbol === job.symbol && !lot.name && quote.shortName) {
            lot.name = quote.shortName;
            named = true;
          }
        });
        if (named) saveData();
        saveQuotes();
        render();
      }, function (err) {
        quoteErrors[job.symbol] = (err && err.message) || "Couldn't load price";
        render();
      });
    }).then(function () {
      ui.loading = false;
      els.refreshBtn.disabled = false;
      render();
    });
  }

  function activeBounds() {
    var lots = selectedLots();
    return StockCalc.windowBounds(ui.windowId, StockCalc.todayKey(), earliestDate(lots));
  }

  function renderStatus() {
    if (!data.purchases.length) {
      els.status.textContent = "Add a purchase to load prices for that stock.";
      els.status.classList.remove("error");
      return;
    }
    if (ui.loading) {
      els.status.textContent = "Updating prices…";
      els.status.classList.remove("error");
      return;
    }
    var failed = symbolsInUse().filter(function (symbol) { return quoteErrors[symbol]; });
    if (failed.length) {
      els.status.textContent = failed.map(function (symbol) { return symbol + ": " + quoteErrors[symbol]; }).join(" ");
      els.status.classList.add("error");
      return;
    }
    var oldest = 0;
    symbolsInUse().forEach(function (symbol) {
      var quote = quotes[symbol];
      if (quote && quote.fetchedAt && (!oldest || quote.fetchedAt < oldest)) oldest = quote.fetchedAt;
    });
    els.status.classList.remove("error");
    if (!oldest) {
      els.status.textContent = "Prices load for symbols you add.";
      return;
    }
    var when = new Date(oldest).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    els.status.textContent = "Prices as of " + when + " · Yahoo Finance, only for stocks you added";
  }

  function renderSummary() {
    var lots = selectedLots();
    if (!lots.length) {
      els.summary.innerHTML = data.purchases.length
        ? '<p class="summary-note">Choose a stock to see its totals.</p>'
        : "";
      return;
    }
    var sum = StockCalc.summarize(lots, quotes, StockCalc.todayKey());
    if (sum.mixed) {
      els.summary.innerHTML = '<p class="summary-note">These stocks use different currencies, so they are not added together. Tap one symbol.</p>';
      return;
    }
    var currency = sum.currency || "USD";
    var gain = null;
    if (sum.value != null) {
      gain = sum.value + sum.sold - sum.bought;
      if (!data.hideDividends) gain += sum.dividends;
    }
    var gainClass = gain > 0 ? "up" : gain < 0 ? "down" : "";
    var html = "";
    html += stat("Bought", money(sum.bought, currency), "");
    if (sum.sold > 0) html += stat("Sold", money(sum.sold, currency), "Cash received");
    html += stat("Value", sum.value == null ? "—" : money(sum.value, currency), sum.value == null ? "Partial" : "");
    html += stat(data.hideDividends ? "Gain" : "Gain + dividends", signedMoney(gain, currency), formatPct(gain, sum.bought), gainClass);
    if (!data.hideDividends) html += stat("Dividends", money(sum.dividends, currency), "Cash received");
    els.summary.innerHTML = html;
  }

  function stat(label, value, detail, klass) {
    return '<article class="stat ' + (klass || "") + '"><span>' + escapeHtml(label) + "</span><strong>" +
      escapeHtml(value) + "</strong>" + (detail ? "<em>" + escapeHtml(detail) + "</em>" : "") + "</article>";
  }

  function renderWindows() {
    var buttons = els.windows.querySelectorAll("[data-window]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-selected", buttons[i].getAttribute("data-window") === ui.windowId ? "true" : "false");
    }
  }

  function renderChips() {
    var symbols = symbolsInUse();
    if (!symbols.length) {
      els.symbolChips.innerHTML = "";
      return;
    }
    var allOn = symbols.every(function (symbol) { return !ui.hiddenSymbols[symbol]; });
    var html = '<button type="button" class="chip' + (allOn ? " on" : "") + '" data-symbol="*">All</button>';
    symbols.forEach(function (symbol) {
      var on = !ui.hiddenSymbols[symbol];
      html += '<button type="button" class="chip' + (on ? " on" : " off") + '" data-symbol="' + escapeHtml(symbol) + '">' +
        '<i style="background:' + symbolColor(symbol) + '"></i>' + escapeHtml(symbol) + "</button>";
    });
    els.symbolChips.innerHTML = html;
  }

  function renderLots() {
    var symbols = symbolsInUse();
    els.emptyState.hidden = symbols.length > 0;
    els.lotList.hidden = symbols.length === 0;
    if (!symbols.length) {
      els.lotList.innerHTML = "";
      return;
    }
    var asOf = StockCalc.todayKey();
    symbols.sort(function (a, b) {
      return symbolValue(b, asOf) - symbolValue(a, asOf);
    });
    var html = "";
    symbols.forEach(function (symbol) {
      var lots = data.purchases.filter(function (lot) { return lot.symbol === symbol; })
        .sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return (Number(b.seq) || 0) - (Number(a.seq) || 0);
        });
      var quote = quotes[symbol];
      var currency = quoteCurrency(symbol);
      var name = "";
      lots.forEach(function (lot) { if (!name && lot.name) name = lot.name; });
      if (!name && quote && quote.shortName) name = quote.shortName;
      var move = dayMove(quote);
      var bars = (quote && quote.bars) || [];
      var price = quote && isNum(quote.regularMarketPrice) ? quote.regularMarketPrice : (bars.length ? bars[bars.length - 1].close : null);
      var pos = StockCalc.positionAt(lots, quote, asOf);
      html += '<section class="group">';
      html += '<div class="group-head"><h3>' + escapeHtml(symbol) + (name ? "<small>" + escapeHtml(name) + "</small>" : "") + "</h3>";
      html += '<div class="group-price">';
      if (price == null) html += "<strong>—</strong>";
      else {
        html += "<strong>" + escapeHtml(money(price, currency)) + "</strong>";
        if (move) {
          var klass = move.pct > 0 ? "up" : move.pct < 0 ? "down" : "";
          html += '<span class="' + klass + '">' + escapeHtml(formatPct(move.pct, 1)) + "</span>";
        }
      }
      html += "</div></div>";
      html += '<p class="group-hold">' + escapeHtml(formatShares(pos.shares) + " shares held" +
        (pos.value != null && pos.shares > 0 ? " · " + money(pos.value, currency) : "")) + "</p>";
      if (quoteErrors[symbol]) html += '<p class="group-error">' + escapeHtml(quoteErrors[symbol]) + "</p>";
      lots.forEach(function (lot) {
        var side = StockCalc.txSide(lot);
        if (data.hideDividends && side === "dividend") return;
        var cash = StockCalc.cashAmount(lot);
        var signed = side === "buy" ? -cash : cash;
        var cashClass = side === "sell" || side === "dividend" ? "up" : side === "buy" ? "down" : "";
        var cashText = side === "split" ? (lot.numerator || 1) + ":" + (lot.denominator || 1) : signedMoney(signed, currency);
        html += '<button type="button" class="lot' + (ui.hiddenSymbols[symbol] ? " dim" : "") + '" data-id="' + escapeHtml(lot.id) + '">';
        html += '<div class="lot-top"><span>' + escapeHtml(formatDate(lot.date)) + "</span><span class=\"" + cashClass + "\">" +
          escapeHtml(cashText) + "</span></div>";
        html += '<div class="lot-line"><span>' + escapeHtml(activityTitle(lot)) + "</span><span>" +
          escapeHtml(activityDetail(lot, currency)) + "</span></div>";
        if (lot.note) html += '<p class="lot-note">' + escapeHtml(lot.note) + "</p>";
        html += "</button>";
      });
      html += "</section>";
    });
    els.lotList.innerHTML = html;
  }

  function symbolValue(symbol, asOf) {
    var lots = data.purchases.filter(function (lot) { return lot.symbol === symbol; });
    var pos = StockCalc.positionAt(lots, quotes[symbol], asOf);
    return pos.value || 0;
  }

  function activityTitle(lot) {
    var side = StockCalc.txSide(lot);
    if (side === "dividend") return "Dividend";
    if (side === "split") return (Number(lot.numerator) < Number(lot.denominator) ? "Reverse split" : "Split");
    var order = lot.orderType === "limit" ? "Limit " : lot.orderType === "market" ? "Market " : "";
    return order + (side === "sell" ? "sell" : "buy");
  }

  function activityDetail(lot, currency) {
    var side = StockCalc.txSide(lot);
    if (side === "split") return (lot.numerator || 1) + "-for-" + (lot.denominator || 1);
    if (side === "dividend") return "Cash dividend";
    var count = Number(lot.shares);
    return formatShares(count) + (count === 1 ? " share at " : " shares at ") + money(lot.price, currency);
  }

  function sizeCanvas(canvas, cssHeight) {
    var wrap = canvas.parentElement;
    var width = wrap.clientWidth || 320;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = width + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._dpr = dpr;
    return { ctx: ctx, w: width, h: cssHeight };
  }

  function drawCharts() {
    drawValueChart();
    drawStemChart();
  }

  function chartModel() {
    var lots = selectedLots();
    var bounds = activeBounds();
    var currency = selectionCurrency(lots);
    var mixed = false;
    var seen = null;
    lots.forEach(function (lot) {
      var quote = quotes[lot.symbol];
      if (!quote) return;
      var next = quote.currency || "USD";
      if (!seen) seen = next;
      else if (seen !== next) mixed = true;
    });
    var points = mixed ? [] : StockCalc.buildValueSeries(lots, quotes, bounds.start, bounds.end);
    return { lots: lots, bounds: bounds, currency: currency || "USD", mixed: mixed, points: points };
  }

  function drawValueChart() {
    var canvas = els.graphCanvas;
    var sized = sizeCanvas(canvas, PLOT_H);
    sizeCanvas(els.graphChartOverlay, PLOT_H);
    var ctx = sized.ctx;
    ctx.clearRect(0, 0, sized.w, sized.h);
    var model = chartModel();
    var priced = model.points.filter(function (point) { return point.value != null; });
    var pad = { l: 54, r: 12, t: 16, b: 28 };
    var meta = {
      pad: pad,
      plotW: Math.max(0, sized.w - pad.l - pad.r),
      plotH: Math.max(0, sized.h - pad.t - pad.b),
      w: sized.w,
      h: sized.h,
      start: model.bounds.start,
      end: model.bounds.end,
      points: model.points,
      currency: model.currency,
    };
    canvas._inspect = meta;
    els.valueLegend.innerHTML = "";
    if (!data.purchases.length) {
      els.valueHint.textContent = "The line starts when you add a buy.";
      return;
    }
    if (!model.lots.length || model.mixed) {
      els.valueHint.textContent = model.mixed
        ? "Select one currency to draw a combined value."
        : "Choose a stock to draw its value.";
      return;
    }
    if (!priced.length) {
      var waiting = model.lots.some(function (lot) { return !quotes[lot.symbol] && !quoteErrors[lot.symbol]; });
      els.valueHint.textContent = ui.loading || waiting ? "Updating prices…" : "No prices in this window yet.";
      return;
    }
    els.valueHint.textContent = "Press and hold the chart to read a date. Dots are buys and sells. The line is shares still held.";
    var domain = yDomain(priced);
    drawGrid(ctx, meta, domain, model.currency);
    strokeSeries(ctx, meta, priced, function (point) { return point.cost; }, LINE_COST, [5, 4]);
    if (!data.hideDividends) {
      strokeSeries(ctx, meta, priced, function (point) { return point.value + point.dividends; }, LINE_DIV, []);
    }
    strokeSeries(ctx, meta, priced, function (point) { return point.value; }, LINE_VALUE, []);
    drawPurchaseDots(ctx, meta, model.lots);
    var legend = '<span><i style="background:' + LINE_VALUE + '"></i>Market value</span>';
    if (!data.hideDividends) legend += '<span><i style="background:' + LINE_DIV + '"></i>Value + dividends</span>';
    legend += '<span><i class="dashed"></i>Cost</span>';
    els.valueLegend.innerHTML = legend;
    canvas.setAttribute("aria-label", "Value over time. Latest market value " + money(priced[priced.length - 1].value, model.currency) + ". Press and hold to inspect a date.");
  }

  function yDomain(points) {
    var min = Infinity;
    var max = -Infinity;
    points.forEach(function (point) {
      var values = [point.value, point.cost];
      if (!data.hideDividends && point.value != null) values.push(point.value + point.dividends);
      values.forEach(function (value) {
        if (!isFinite(value)) return;
        if (value < min) min = value;
        if (value > max) max = value;
      });
    });
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      var pad = Math.abs(min) * 0.08 || 1;
      return { min: min - pad, max: max + pad };
    }
    var span = max - min;
    return { min: min - span * 0.08, max: max + span * 0.1 };
  }

  function xForDate(date, meta) {
    var t0 = StockCalc.dateToUtcMs(meta.start);
    var t1 = StockCalc.dateToUtcMs(meta.end);
    var t = StockCalc.dateToUtcMs(date);
    if (!isFinite(t0) || !isFinite(t1) || t1 === t0) return meta.pad.l + meta.plotW / 2;
    var ratio = (t - t0) / (t1 - t0);
    return meta.pad.l + Math.max(0, Math.min(1, ratio)) * meta.plotW;
  }

  function yFor(value, domain, meta) {
    var span = domain.max - domain.min || 1;
    var ratio = (value - domain.min) / span;
    return meta.pad.t + (1 - ratio) * meta.plotH;
  }

  function axisMoney(n) {
    var abs = Math.abs(n);
    var sign = n < 0 ? "−" : "";
    if (abs >= 1000000) return sign + "$" + (abs / 1000000).toFixed(1) + "M";
    if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + "k";
    return sign + "$" + Math.round(abs);
  }

  function drawGrid(ctx, meta, domain, currency) {
    ctx.save();
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var i = 0; i < 4; i++) {
      var value = domain.min + ((domain.max - domain.min) * i) / 3;
      var y = yFor(value, domain, meta);
      ctx.beginPath();
      ctx.moveTo(meta.pad.l, y);
      ctx.lineTo(meta.pad.l + meta.plotW, y);
      ctx.stroke();
      ctx.fillText(axisMoney(value), meta.pad.l - 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var labels = [meta.start, midDate(meta.start, meta.end), meta.end];
    labels.forEach(function (date, index) {
      if (!date) return;
      var x = xForDate(date, meta);
      if (index === 0) ctx.textAlign = "left";
      else if (index === 2) ctx.textAlign = "right";
      else ctx.textAlign = "center";
      ctx.fillText(formatAxisDate(date, meta.start, meta.end), x, meta.pad.t + meta.plotH + 8);
    });
    ctx.restore();
    void currency;
  }

  function midDate(start, end) {
    var t0 = StockCalc.dateToUtcMs(start);
    var t1 = StockCalc.dateToUtcMs(end);
    if (!isFinite(t0) || !isFinite(t1)) return start;
    return new Date(t0 + (t1 - t0) / 2).toISOString().slice(0, 10);
  }

  function strokeSeries(ctx, meta, points, valueOf, color, dash) {
    var domain = yDomain(points);
    ctx.save();
    ctx.beginPath();
    ctx.rect(meta.pad.l, meta.pad.t, meta.plotW, meta.plotH);
    ctx.clip();
    ctx.beginPath();
    var drawing = false;
    var drawn = [];
    points.forEach(function (point) {
      var value = valueOf(point);
      if (!isFinite(value)) {
        drawing = false;
        return;
      }
      var x = xForDate(point.date, meta);
      var y = yFor(value, domain, meta);
      drawn.push({ x: x, y: y });
      if (!drawing) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      drawing = true;
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.stroke();
    if (drawn.length === 1) {
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(drawn[0].x, drawn[0].y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPurchaseDots(ctx, meta, lots) {
    var domain = yDomain(meta.points.filter(function (point) { return point.value != null; }));
    ctx.save();
    lots.forEach(function (lot) {
      var side = StockCalc.txSide(lot);
      if (side !== "buy" && side !== "sell") return;
      if (lot.date < meta.start || lot.date > meta.end) return;
      var point = null;
      meta.points.forEach(function (candidate) {
        if (candidate.date === lot.date) point = candidate;
      });
      if (!point || point.value == null) return;
      var x = xForDate(lot.date, meta);
      var y = yFor(point.value, domain, meta);
      ctx.beginPath();
      ctx.fillStyle = symbolColor(lot.symbol);
      ctx.strokeStyle = "#042f2e";
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawStemChart() {
    var canvas = els.stemCanvas;
    var sized = sizeCanvas(canvas, STEM_H);
    var ctx = sized.ctx;
    ctx.clearRect(0, 0, sized.w, sized.h);
    var lots = selectedLots();
    var bounds = activeBounds();
    var buys = lots.filter(function (lot) {
      var side = StockCalc.txSide(lot);
      return (side === "buy" || side === "sell") && lot.date >= bounds.start && lot.date <= bounds.end;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    els.stemCount.textContent = buys.length ? String(buys.length) : "";
    els.stemEmpty.hidden = buys.length > 0 || !data.purchases.length;
    if (!buys.length) {
      canvas.setAttribute("aria-label", "No buys or sells in this window");
      return;
    }
    var pad = { l: 54, r: 12, t: 22, b: 28 };
    var meta = {
      pad: pad,
      plotW: Math.max(0, sized.w - pad.l - pad.r),
      plotH: Math.max(0, sized.h - pad.t - pad.b),
      start: bounds.start,
      end: bounds.end,
    };
    var maxCost = 0;
    buys.forEach(function (lot) {
      var cost = StockCalc.cashAmount(lot);
      if (cost > maxCost) maxCost = cost;
    });
    if (!maxCost) maxCost = 1;
    var domain = { min: 0, max: maxCost * 1.12 };
    drawGrid(ctx, meta, domain, "USD");
    var groups = {};
    buys.forEach(function (lot) {
      if (!groups[lot.date]) groups[lot.date] = [];
      groups[lot.date].push(lot);
    });
    var baseline = yFor(0, domain, meta);
    ctx.save();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    Object.keys(groups).forEach(function (date) {
      var group = groups[date];
      group.forEach(function (lot, index) {
        var cost = StockCalc.cashAmount(lot);
        var x = xForDate(date, meta) + (index - (group.length - 1) / 2) * 12;
        var y = yFor(cost, domain, meta);
        var color = StockCalc.txSide(lot) === "sell" ? "#fb7185" : "#34d399";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, baseline);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (buys.length <= 8) {
          ctx.fillStyle = color;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(StockCalc.txSide(lot) === "sell" ? "Sell" : "Buy", x + 8, y);
        }
      });
    });
    ctx.restore();
    var buyCount = 0;
    var sellCount = 0;
    buys.forEach(function (lot) {
      if (StockCalc.txSide(lot) === "sell") sellCount += 1;
      else buyCount += 1;
    });
    canvas.setAttribute("aria-label", buyCount + " buys and " + sellCount + " sells in this window");
  }

  function render() {
    els.hideDividends.checked = !!data.hideDividends;
    els.refreshBtn.disabled = !!ui.loading;
    renderStatus();
    renderSummary();
    renderWindows();
    renderChips();
    renderLots();
    drawCharts();
    if (!els.formOverlay.hidden) updateHint();
  }

  function clearTextSelection() {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  }

  function localX(event) {
    var rect = els.graphCanvas.getBoundingClientRect();
    return event.clientX - rect.left;
  }

  function graphInspectAtPlotX(plotX) {
    var meta = els.graphCanvas._inspect;
    if (!meta || !meta.points || !meta.points.length || !meta.plotW) return null;
    var t0 = StockCalc.dateToUtcMs(meta.start);
    var t1 = StockCalc.dateToUtcMs(meta.end);
    var ratio = (plotX - meta.pad.l) / meta.plotW;
    ratio = Math.max(0, Math.min(1, ratio));
    var target = t0 + ((t1 - t0) || 0) * ratio;
    var best = null;
    var bestDist = Infinity;
    meta.points.forEach(function (point) {
      if (point.value == null) return;
      var dist = Math.abs(StockCalc.dateToUtcMs(point.date) - target);
      if (dist < bestDist) {
        best = point;
        bestDist = dist;
      }
    });
    return best;
  }

  function drawGraphInspectLine(x) {
    var overlay = els.graphChartOverlay;
    var meta = els.graphCanvas._inspect;
    if (!overlay || !meta) return;
    var ctx = overlay.getContext("2d");
    ctx.setTransform(overlay._dpr || 1, 0, 0, overlay._dpr || 1, 0, 0);
    ctx.clearRect(0, 0, meta.w, meta.h);
    var clamped = Math.max(meta.pad.l, Math.min(x, meta.pad.l + meta.plotW));
    ctx.save();
    ctx.strokeStyle = "rgba(120, 120, 120, 0.42)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(clamped, meta.pad.t);
    ctx.lineTo(clamped, meta.pad.t + meta.plotH);
    ctx.stroke();
    ctx.restore();
  }

  function hideInspect() {
    inspect.active = false;
    els.valuePlot.classList.remove("graph-inspecting");
    els.graphChartTooltip.hidden = true;
    var overlay = els.graphChartOverlay;
    var meta = els.graphCanvas._inspect;
    if (!overlay || !meta) return;
    var ctx = overlay.getContext("2d");
    ctx.setTransform(overlay._dpr || 1, 0, 0, overlay._dpr || 1, 0, 0);
    ctx.clearRect(0, 0, meta.w, meta.h);
  }

  function showInspect(x) {
    var point = graphInspectAtPlotX(x);
    if (!point) return;
    drawGraphInspectLine(x);
    var meta = els.graphCanvas._inspect;
    var currency = meta.currency || "USD";
    var rows = [];
    rows.push(tipRow(LINE_VALUE, "Market value", money(point.value, currency)));
    if (!data.hideDividends) {
      rows.push(tipRow(LINE_DIV, "Dividends", money(point.dividends, currency)));
      rows.push(tipRow(LINE_DIV, "Value + dividends", money(point.value + point.dividends, currency)));
    }
    rows.push(tipRow("#94a3b8", "Cost", money(point.cost, currency)));
    (point.lots || []).forEach(function (lot, index) {
      if (index >= 6) return;
      var text = lot.value == null ? "—" : money(lot.value, currency);
      if (!data.hideDividends && lot.dividends) text += " · div " + money(lot.dividends, currency);
      rows.push(tipRow(symbolColor(lot.symbol), lot.symbol + " · " + formatDate(lot.date), text));
    });
    if (point.lots && point.lots.length > 6) {
      rows.push('<p class="tip-more">+' + (point.lots.length - 6) + " more</p>");
    }
    els.graphChartTooltip.innerHTML = '<p class="tip-date">' + escapeHtml(formatDate(point.date)) + "</p>" + rows.join("");
    els.graphChartTooltip.hidden = false;
  }

  function tipRow(color, label, value) {
    return '<p class="tip-row"><span><i class="swatch" style="background:' + color + '"></i>' +
      escapeHtml(label) + "</span><span>" + escapeHtml(value) + "</span></p>";
  }

  function bindInspect() {
    var touch = els.graphChartTouch;
    els.graphCanvas.draggable = false;
    els.graphCanvas.setAttribute("draggable", "false");
    els.graphChartOverlay.draggable = false;
    function block(event) { event.preventDefault(); }
    ["contextmenu", "dragstart", "selectstart"].forEach(function (type) {
      touch.addEventListener(type, block);
    });
    els.graphCanvas.addEventListener("dragstart", block);
    touch.addEventListener("touchstart", function (event) { event.preventDefault(); }, { passive: false });
    touch.addEventListener("touchmove", function (event) {
      if (inspect.active) event.preventDefault();
    }, { passive: false });
    touch.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      inspect.pointerId = event.pointerId;
      var x = localX(event);
      try { touch.setPointerCapture(event.pointerId); } catch (err) { /* pointer already released */ }
      clearTimeout(inspect.timer);
      inspect.timer = setTimeout(function () {
        inspect.active = true;
        els.valuePlot.classList.add("graph-inspecting");
        clearTextSelection();
        showInspect(x);
      }, HOLD_MS);
    });
    touch.addEventListener("pointermove", function (event) {
      if (!inspect.active || event.pointerId !== inspect.pointerId) return;
      event.preventDefault();
      clearTextSelection();
      showInspect(localX(event));
    }, { passive: false });
    function endInspect(event) {
      if (inspect.pointerId != null && event.pointerId !== inspect.pointerId) return;
      clearTimeout(inspect.timer);
      inspect.timer = null;
      if (inspect.active) hideInspect();
      inspect.pointerId = null;
    }
    touch.addEventListener("pointerup", endInspect);
    touch.addEventListener("pointercancel", endInspect);
  }

  function openForm(id) {
    var lot = null;
    data.purchases.forEach(function (item) { if (item.id === id) lot = item; });
    ui.editingId = lot ? lot.id : null;
    deleteArmed = false;
    pendingName = lot ? lot.name : "";
    pickedSymbol = lot ? lot.symbol : "";
    ui.formSide = lot ? StockCalc.txSide(lot) : "buy";
    els.formTitle.textContent = lot ? "Edit activity" : "Add activity";
    els.symbolInput.value = lot ? lot.symbol : "";
    els.purchaseDate.value = lot ? lot.date : StockCalc.todayKey();
    els.purchaseDate.max = StockCalc.todayKey();
    els.sharesInput.value = lot && lot.shares ? String(lot.shares) : "";
    els.priceInput.value = lot && lot.price ? String(lot.price) : "";
    els.amountInput.value = lot && lot.amount ? String(lot.amount) : "";
    els.noteInput.value = lot ? lot.note : "";
    applyFormSide();
    els.symbolName.textContent = pendingName;
    els.deleteBtn.hidden = !lot;
    els.deleteBtn.textContent = "Delete";
    els.suggestions.innerHTML = "";
    els.priceHint.textContent = "";
    els.formOverlay.hidden = false;
    document.body.classList.add("sheet-open");
    if (lot) updateHint();
    else els.symbolInput.focus();
  }

  function closeForm() {
    els.formOverlay.hidden = true;
    document.body.classList.remove("sheet-open");
    ui.editingId = null;
    deleteArmed = false;
  }

  function applyFormSide() {
    var side = ui.formSide === "sell" || ui.formSide === "dividend" || ui.formSide === "split" ? ui.formSide : "buy";
    ui.formSide = side;
    var buttons = els.sideRow ? els.sideRow.querySelectorAll("[data-side]") : [];
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-selected", buttons[i].getAttribute("data-side") === side ? "true" : "false");
    }
    var dividend = side === "dividend";
    var split = side === "split";
    els.tradeFields.hidden = dividend || split;
    els.dividendFields.hidden = !dividend;
    els.sideRow.hidden = split;
    els.splitNote.hidden = !split;
    if (side === "sell") els.priceLabel.textContent = "Price you received, per share";
    else els.priceLabel.textContent = "Price you paid, per share";
  }

  function readForm() {
    var symbol = normalizeSymbol(els.symbolInput.value);
    var date = els.purchaseDate.value;
    var side = ui.formSide;
    if (!validSymbol(symbol)) return "Enter a symbol like AAPL.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a date.";
    if (date > StockCalc.todayKey()) return "Date can't be in the future.";
    var name = pendingName || ((quotes[symbol] && quotes[symbol].shortName) || "");
    var lot = {
      id: ui.editingId || newId(),
      symbol: symbol,
      name: String(name).slice(0, 80),
      date: date,
      side: side,
      shares: 0,
      price: 0,
      note: els.noteInput.value.trim().slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    if (side === "split") {
      var current = null;
      data.purchases.forEach(function (item) { if (item.id === ui.editingId) current = item; });
      if (!current) return "A split is already recorded with the imported history.";
      lot.numerator = current.numerator;
      lot.denominator = current.denominator;
      lot.seq = current.seq;
      return lot;
    }
    if (side === "dividend") {
      var amount = Number(els.amountInput.value);
      if (!isFinite(amount) || amount === 0) return "Enter the cash dividend.";
      lot.amount = Math.abs(amount);
      return lot;
    }
    var shares = Number(els.sharesInput.value);
    var price = Number(els.priceInput.value);
    if (!isFinite(shares) || shares <= 0) return "Enter the number of shares.";
    if (!isFinite(price) || price < 0) return side === "sell" ? "Enter the price you received per share." : "Enter the price you paid per share.";
    lot.shares = shares;
    lot.price = price;
    lot.amount = Math.abs(shares * price);
    return lot;
  }

  function saveForm() {
    var result = readForm();
    if (typeof result === "string") {
      toast(result);
      return;
    }
    var replaced = false;
    data.purchases.forEach(function (lot, index) {
      if (lot.id === result.id) {
        data.purchases[index] = result;
        replaced = true;
      }
    });
    if (!replaced) data.purchases.push(result);
    delete ui.hiddenSymbols[result.symbol];
    saveData();
    closeForm();
    render();
    refreshQuotes(false);
  }

  function deletePurchase(id) {
    data.purchases = data.purchases.filter(function (lot) { return lot.id !== id; });
    var still = {};
    data.purchases.forEach(function (lot) { still[lot.symbol] = true; });
    Object.keys(ui.hiddenSymbols).forEach(function (symbol) {
      if (!still[symbol]) delete ui.hiddenSymbols[symbol];
    });
    saveData();
    closeForm();
    render();
  }

  function showHintText(quote, date) {
    var bar = StockCalc.lastBarOn(quote.bars, date);
    if (!bar) {
      els.priceHint.textContent = "No market close on or before that date.";
      return;
    }
    var traded = StockCalc.tradedClose(bar.close, quote.splits, bar.date);
    var label = bar.date === date ? "Market close that day was " : "Closest close (" + formatDate(bar.date) + ") was ";
    var extra = "";
    if (Math.abs(StockCalc.splitFactor(quote.splits, bar.date) - 1) > 0.0001) {
      extra = " This is the price before later splits.";
    }
    els.priceHint.textContent = label + money(traded, quote.currency) + "." + extra;
  }

  function scheduleHint() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(updateHint, 400);
  }

  function updateHint() {
    if (els.formOverlay.hidden) return;
    var seq = ++hintSeq;
    var symbol = normalizeSymbol(els.symbolInput.value);
    var date = els.purchaseDate.value;
    if (!validSymbol(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      els.priceHint.textContent = "";
      return;
    }
    var quote = quotes[symbol];
    if (needsFetch(quote, date)) {
      els.priceHint.textContent = "Looking up the close…";
      fetchSymbol(symbol, date).then(function (next) {
        quotes[symbol] = next;
        delete quoteErrors[symbol];
        saveQuotes();
        if (!pendingName && next.shortName && normalizeSymbol(els.symbolInput.value) === symbol) {
          pendingName = next.shortName;
          pickedSymbol = symbol;
          els.symbolName.textContent = next.shortName;
        }
        if (seq !== hintSeq) return;
        if (data.purchases.some(function (lot) { return lot.symbol === symbol; })) render();
        else showHintText(next, date);
      }, function (err) {
        if (seq !== hintSeq) return;
        els.priceHint.textContent = (err && err.message) || "Couldn't look up that symbol";
      });
      return;
    }
    showHintText(quote, date);
  }

  function renderSuggestions(items) {
    if (!items.length) {
      els.suggestions.innerHTML = "";
      return;
    }
    els.suggestions.innerHTML = items.map(function (item) {
      return '<button type="button" class="suggestion" data-symbol="' + escapeHtml(item.symbol) + '" data-name="' + escapeHtml(item.name) + '"><b>' +
        escapeHtml(item.symbol) + "</b><small>" + escapeHtml(item.name || item.exchange || "") + "</small></button>";
    }).join("");
  }

  function onSymbolInput() {
    var query = els.symbolInput.value.trim();
    if (normalizeSymbol(query) !== pickedSymbol) {
      pendingName = "";
      els.symbolName.textContent = "";
    }
    var seq = ++searchSeq;
    clearTimeout(searchTimer);
    if (query.length < 1) {
      renderSuggestions([]);
      return;
    }
    searchTimer = setTimeout(function () {
      fetchJson(yahoo("/v1/finance/search?q=" + encodeURIComponent(query))).then(function (payload) {
        if (seq !== searchSeq) return;
        var quotesFound = (payload && payload.quotes) || [];
        var items = [];
        quotesFound.forEach(function (quote) {
          if (!quote || !quote.symbol) return;
          if (quote.quoteType !== "EQUITY" && quote.quoteType !== "ETF" && quote.quoteType !== "MUTUALFUND") return;
          items.push({
            symbol: String(quote.symbol).toUpperCase(),
            name: quote.shortname || quote.longname || "",
            exchange: quote.exchDisp || "",
          });
        });
        items.sort(function (a, b) {
          return (a.symbol.indexOf(".") >= 0) - (b.symbol.indexOf(".") >= 0);
        });
        renderSuggestions(items.slice(0, 6));
      }, function () {
        if (seq === searchSeq) renderSuggestions([]);
      });
    }, 280);
  }

  function openSettings() {
    els.settingsOverlay.hidden = false;
    document.body.classList.add("sheet-open");
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
    if (els.formOverlay.hidden) document.body.classList.remove("sheet-open");
  }

  function exportJson() {
    var payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      data: {
        version: 1,
        hideDividends: !!data.hideDividends,
        purchases: data.purchases,
      },
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "stock-purchases-" + StockCalc.todayKey() + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported purchases");
  }

  function extractImport(parsed) {
    if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
      return AppsBackup.getAppSlice(parsed, APP_ID);
    }
    if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) return parsed.data;
    if (parsed && Array.isArray(parsed.purchases)) return parsed;
    return null;
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = extractImport(parsed);
        if (!slice) {
          toast("No Stock Purchases data in that file");
          return;
        }
        var incoming = normalizeData(slice);
        var reg = typeof AppsBackup !== "undefined" && AppsBackup.APP_REGISTRY && AppsBackup.APP_REGISTRY[APP_ID];
        var merged = reg && reg.mergeSlice ? reg.mergeSlice(normalizeData(data), incoming) : incoming;
        merged = normalizeData(merged);
        data.hideDividends = merged.hideDividends;
        data.purchases = merged.purchases;
        saveData();
        closeSettings();
        render();
        refreshQuotes(false);
        toast("Imported " + merged.purchases.length + " entries");
      } catch (e) {
        toast("That file isn't Stock Purchases JSON");
      } finally {
        els.importJsonFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function bind() {
    els.refreshBtn.addEventListener("click", function () { refreshQuotes(true); });
    els.settingsBtn.addEventListener("click", openSettings);
    els.settingsCloseBtn.addEventListener("click", closeSettings);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonFile.addEventListener("change", function () {
      importJsonFile(els.importJsonFile.files && els.importJsonFile.files[0]);
    });
    els.sideRow.addEventListener("click", function (event) {
      var button = event.target.closest("[data-side]");
      if (!button) return;
      ui.formSide = button.getAttribute("data-side");
      applyFormSide();
    });
    els.addBtn.addEventListener("click", function () { openForm(null); });
    els.emptyAddBtn.addEventListener("click", function () { openForm(null); });
    els.cancelBtn.addEventListener("click", closeForm);
    els.saveBtn.addEventListener("click", saveForm);
    els.deleteBtn.addEventListener("click", function () {
      if (!ui.editingId) return;
      if (!deleteArmed) {
        deleteArmed = true;
        els.deleteBtn.textContent = "Tap again to delete";
        return;
      }
      deletePurchase(ui.editingId);
    });
    els.hideDividends.addEventListener("change", function () {
      data.hideDividends = els.hideDividends.checked;
      saveData();
      render();
    });
    els.windows.addEventListener("click", function (event) {
      var button = event.target.closest("[data-window]");
      if (!button) return;
      ui.windowId = button.getAttribute("data-window");
      render();
    });
    els.symbolChips.addEventListener("click", function (event) {
      var button = event.target.closest("[data-symbol]");
      if (!button) return;
      var symbol = button.getAttribute("data-symbol");
      if (symbol === "*") ui.hiddenSymbols = {};
      else if (ui.hiddenSymbols[symbol]) delete ui.hiddenSymbols[symbol];
      else ui.hiddenSymbols[symbol] = true;
      render();
    });
    els.lotList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-id]");
      if (!button) return;
      openForm(button.getAttribute("data-id"));
    });
    els.symbolInput.addEventListener("input", function () {
      onSymbolInput();
      scheduleHint();
    });
    els.symbolInput.addEventListener("change", scheduleHint);
    els.purchaseDate.addEventListener("change", scheduleHint);
    els.suggestions.addEventListener("click", function (event) {
      var button = event.target.closest(".suggestion");
      if (!button) return;
      pickedSymbol = button.getAttribute("data-symbol");
      pendingName = button.getAttribute("data-name") || "";
      els.symbolInput.value = pickedSymbol;
      els.symbolName.textContent = pendingName;
      renderSuggestions([]);
      updateHint();
    });
    els.formOverlay.addEventListener("click", function (event) {
      if (event.target === els.formOverlay) closeForm();
    });
    els.settingsOverlay.addEventListener("click", function (event) {
      if (event.target === els.settingsOverlay) closeSettings();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!els.formOverlay.hidden) closeForm();
      else if (!els.settingsOverlay.hidden) closeSettings();
    });
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawCharts, 120);
    });
    bindInspect();
  }

  function cacheEls() {
    [
      "status", "summary", "hideDividends", "windows", "symbolChips", "valueHint", "valueLegend",
      "valuePlot", "graphCanvas", "graphChartTouch", "graphChartOverlay", "graphChartTooltip",
      "stemCanvas", "stemCount", "stemEmpty", "lotList", "emptyState", "addBtn", "emptyAddBtn",
      "refreshBtn", "settingsBtn", "formOverlay", "formTitle", "symbolInput", "symbolName",
      "suggestions", "purchaseDate", "sharesInput", "priceInput", "noteInput", "priceHint",
      "saveBtn", "cancelBtn", "deleteBtn", "settingsOverlay", "exportJsonBtn", "importJsonFile",
      "settingsCloseBtn", "toast", "sideRow", "tradeFields", "dividendFields", "amountInput",
      "priceLabel", "splitNote",
    ].forEach(function (id) { els[id] = $(id); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    cacheEls();
    loadData();
    loadQuotes();
    bind();
    render();
    refreshQuotes(false);
  });
})();
