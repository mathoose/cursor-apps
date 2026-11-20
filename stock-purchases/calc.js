/**
 * Pure math for Stock Purchases.
 *
 * Yahoo daily `close` and dividend `amount` are on today's split basis.
 * A 4-for-1 split after a buy is reported on the old dates already divided by 4,
 * and the pre-split dividend is reported as the post-split amount.
 * Shares bought are multiplied by every split dated after the purchase.
 * Value and dividend cash then use that share count. Cost stays shares × price paid.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.StockCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function asNumber(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && isFinite(Number(value))) return Number(value);
    return null;
  }

  function dateToUtcMs(key) {
    var p = String(key || "").split("-");
    if (p.length !== 3) return NaN;
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function todayKey(now) {
    var d = now || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function addDays(key, days) {
    return formatUtc(dateToUtcMs(key) + days * 86400000);
  }

  function shiftYears(key, years) {
    var p = String(key).split("-");
    var y = Number(p[0]) + years;
    var m = Number(p[1]);
    var d = Number(p[2]);
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > dim) d = dim;
    return y + "-" + pad(m) + "-" + pad(d);
  }

  function windowBounds(windowId, today, earliest) {
    var end = today;
    var start = earliest || today;
    if (windowId === "1M") start = addDays(today, -30);
    else if (windowId === "3M") start = addDays(today, -90);
    else if (windowId === "YTD") start = today.slice(0, 4) + "-01-01";
    else if (windowId === "1Y") start = shiftYears(today, -1);
    else if (windowId === "5Y") start = shiftYears(today, -5);
    else start = earliest || today;
    if (start > end) start = end;
    return { start: start, end: end };
  }

  function splitFactor(splits, purchaseDate) {
    var factor = 1;
    (splits || []).forEach(function (split) {
      if (!split || !(split.date > purchaseDate)) return;
      var den = Number(split.denominator);
      var num = Number(split.numerator);
      if (!isFinite(den) || !isFinite(num) || den === 0) return;
      factor *= num / den;
    });
    return factor;
  }

  function adjustedShares(shares, splits, purchaseDate) {
    return Number(shares) * splitFactor(splits, purchaseDate);
  }

  function dividendsThrough(sharesAfterSplits, dividends, purchaseDate, asOf) {
    var sum = 0;
    (dividends || []).forEach(function (div) {
      if (!div || !(div.date > purchaseDate) || div.date > asOf) return;
      var amount = Number(div.amount);
      if (!isFinite(amount)) return;
      sum += sharesAfterSplits * amount;
    });
    return sum;
  }

  function closeOn(bars, date) {
    var bar = lastBarOn(bars, date);
    return bar ? bar.close : null;
  }

  function lastBarOn(bars, date) {
    var list = bars || [];
    var lo = 0;
    var hi = list.length - 1;
    var ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].date <= date) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return null;
    var close = Number(list[ans].close);
    if (!isFinite(close)) return null;
    return { date: list[ans].date, close: close };
  }

  function tradedClose(adjustedClose, splits, barDate) {
    return Number(adjustedClose) * splitFactor(splits, barDate);
  }

  function quoteFor(quotes, symbol) {
    return (quotes && quotes[symbol]) || { bars: [], dividends: [], splits: [] };
  }

  function lotValue(lot, quote, date) {
    if (!lot || lot.date > date) return null;
    var shares = adjustedShares(lot.shares, quote.splits, lot.date);
    var price = null;
    var live = asNumber(quote.regularMarketPrice);
    if (live != null && date >= (quote.liveDate || "9999-99-99")) price = live;
    if (price == null) price = closeOn(quote.bars, date);
    if (price == null) return null;
    return shares * price;
  }

  function buildValueSeries(lots, quotes, start, end) {
    var dates = {};
    (lots || []).forEach(function (lot) {
      if (!lot) return;
      if (lot.date >= start && lot.date <= end) dates[lot.date] = true;
      var bars = quoteFor(quotes, lot.symbol).bars || [];
      bars.forEach(function (bar) {
        if (!bar || bar.date < start || bar.date > end || bar.date < lot.date) return;
        dates[bar.date] = true;
      });
    });
    return Object.keys(dates).sort().map(function (date) {
      var value = 0;
      var dividends = 0;
      var cost = 0;
      var haveValue = false;
      var rows = [];
      (lots || []).forEach(function (lot) {
        if (!lot || lot.date > date) return;
        var quote = quoteFor(quotes, lot.symbol);
        var shares = adjustedShares(lot.shares, quote.splits, lot.date);
        var lotMarket = lotValue(lot, quote, date);
        var div = dividendsThrough(shares, quote.dividends, lot.date, date);
        if (lotMarket != null) {
          value += lotMarket;
          haveValue = true;
        }
        dividends += div;
        cost += Number(lot.shares) * Number(lot.price);
        rows.push({
          id: lot.id,
          symbol: lot.symbol,
          date: lot.date,
          value: lotMarket,
          dividends: div,
        });
      });
      return {
        date: date,
        value: haveValue ? value : null,
        dividends: dividends,
        cost: cost,
        lots: rows,
      };
    });
  }

  function summarize(lots, quotes, asOf) {
    var cost = 0;
    var pricedCost = 0;
    var value = 0;
    var dividends = 0;
    var priced = 0;
    var currencies = {};
    var active = 0;
    (lots || []).forEach(function (lot) {
      if (!lot || lot.date > asOf) return;
      active += 1;
      var lotCost = Number(lot.shares) * Number(lot.price);
      cost += lotCost;
      var quote = quotes && quotes[lot.symbol];
      if (!quote) return;
      currencies[quote.currency || "USD"] = true;
      var shares = adjustedShares(lot.shares, quote.splits, lot.date);
      var live = asNumber(quote.regularMarketPrice);
      var price = live != null ? live : closeOn(quote.bars, asOf);
      if (price == null) return;
      value += shares * price;
      pricedCost += lotCost;
      priced += 1;
      dividends += dividendsThrough(shares, quote.dividends, lot.date, asOf);
    });
    var currencyKeys = Object.keys(currencies);
    return {
      cost: cost,
      pricedCost: pricedCost,
      value: priced ? value : null,
      dividends: dividends,
      priced: priced,
      active: active,
      currency: currencyKeys.length === 1 ? currencyKeys[0] : null,
      mixed: currencyKeys.length > 1,
    };
  }

  function dateKeyInZone(unixSeconds, timeZone) {
    try {
      var formatted = new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Number(unixSeconds) * 1000));
      if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
    } catch (e) {
      /* fall through */
    }
    return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);
  }

  function eventList(events) {
    if (!events || typeof events !== "object") return [];
    return Object.keys(events).map(function (key) { return events[key]; });
  }

  function parseChart(symbol, payload) {
    var chart = payload && payload.chart;
    var result = chart && chart.result && chart.result[0];
    if (!result) {
      var desc = chart && chart.error && chart.error.description;
      throw new Error(desc || "No price data for " + symbol);
    }
    var meta = result.meta || {};
    var tz = meta.exchangeTimezoneName || "America/New_York";
    var timestamps = result.timestamp || [];
    var closes = (((result.indicators || {}).quote || [])[0] || {}).close || [];
    var byDate = {};
    for (var i = 0; i < timestamps.length; i++) {
      var close = closes[i];
      if (close == null || !isFinite(Number(close))) continue;
      byDate[dateKeyInZone(timestamps[i], tz)] = Number(close);
    }
    var livePrice = asNumber(meta.regularMarketPrice);
    var liveDate = null;
    if (livePrice != null) {
      var liveStamp = meta.regularMarketTime || (meta.currentTradingPeriod && meta.currentTradingPeriod.regular && meta.currentTradingPeriod.regular.end);
      if (liveStamp) liveDate = dateKeyInZone(liveStamp, tz);
      if (liveDate) byDate[liveDate] = livePrice;
    }
    var bars = Object.keys(byDate).sort().map(function (date) {
      return { date: date, close: byDate[date] };
    });
    var dividends = eventList((result.events || {}).dividends).map(function (div) {
      return { date: dateKeyInZone(div.date, tz), amount: Number(div.amount) };
    }).filter(function (div) {
      return /^\d{4}-\d{2}-\d{2}$/.test(div.date) && isFinite(div.amount);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var splits = eventList((result.events || {}).splits).map(function (split) {
      return {
        date: dateKeyInZone(split.date, tz),
        numerator: Number(split.numerator),
        denominator: Number(split.denominator),
      };
    }).filter(function (split) {
      return /^\d{4}-\d{2}-\d{2}$/.test(split.date) && isFinite(split.numerator) && isFinite(split.denominator);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return {
      symbol: symbol,
      currency: meta.currency || "USD",
      timezone: tz,
      shortName: meta.shortName || meta.longName || "",
      regularMarketPrice: livePrice,
      liveDate: liveDate,
      bars: bars,
      dividends: dividends,
      splits: splits,
    };
  }

  return {
    todayKey: todayKey,
    addDays: addDays,
    shiftYears: shiftYears,
    dateToUtcMs: dateToUtcMs,
    windowBounds: windowBounds,
    splitFactor: splitFactor,
    adjustedShares: adjustedShares,
    dividendsThrough: dividendsThrough,
    closeOn: closeOn,
    lastBarOn: lastBarOn,
    tradedClose: tradedClose,
    buildValueSeries: buildValueSeries,
    summarize: summarize,
    dateKeyInZone: dateKeyInZone,
    parseChart: parseChart,
  };
});
