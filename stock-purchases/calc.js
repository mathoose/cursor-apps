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

  function txSide(lot) {
    var side = lot && lot.side;
    if (side === "sell" || side === "dividend" || side === "split") return side;
    return "buy";
  }

  function cashAmount(lot) {
    var amount = asNumber(lot && lot.amount);
    if (amount != null) return Math.abs(amount);
    var shares = Number(lot && lot.shares);
    var price = Number(lot && lot.price);
    if (isFinite(shares) && isFinite(price)) return Math.abs(shares * price);
    return 0;
  }

  function orderedLots(lots) {
    return (lots || []).slice().sort(function (a, b) {
      if (!a || !b) return 0;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var seq = (Number(a.seq) || 0) - (Number(b.seq) || 0);
      if (seq) return seq;
      return String(a.id || "") < String(b.id || "") ? -1 : 1;
    });
  }

  function splitsFor(lots, quote) {
    var byDate = {};
    ((quote && quote.splits) || []).forEach(function (split) {
      if (split && split.date) byDate[split.date] = split;
    });
    (lots || []).forEach(function (lot) {
      if (txSide(lot) !== "split" || !lot.date || byDate[lot.date]) return;
      byDate[lot.date] = {
        date: lot.date,
        numerator: Number(lot.numerator) || 1,
        denominator: Number(lot.denominator) || 1,
      };
    });
    return Object.keys(byDate).sort().map(function (date) { return byDate[date]; });
  }

  function hasImportedDividends(lots) {
    return (lots || []).some(function (lot) { return txSide(lot) === "dividend"; });
  }

  function signedShares(lot, splits) {
    var side = txSide(lot);
    if (side === "dividend" || side === "split") return 0;
    var sign = side === "sell" ? -1 : 1;
    return sign * adjustedShares(lot.shares, splits, lot.date);
  }

  function sharesHeld(lots, splits, asOf, strictBefore) {
    var held = 0;
    orderedLots(lots).forEach(function (lot) {
      if (!lot || !lot.date) return;
      if (strictBefore ? !(lot.date < asOf) : lot.date > asOf) return;
      held += signedShares(lot, splits);
    });
    if (Math.abs(held) < 1e-6) return 0;
    return held;
  }

  function positionAt(lots, quote, asOf) {
    var splits = splitsFor(lots, quote);
    var held = 0;
    var basis = 0;
    var bought = 0;
    var sold = 0;
    var importedDiv = 0;
    orderedLots(lots).forEach(function (lot) {
      if (!lot || lot.date > asOf) return;
      var side = txSide(lot);
      if (side === "split") return;
      if (side === "dividend") {
        importedDiv += cashAmount(lot);
        return;
      }
      var adj = Math.abs(signedShares(lot, splits));
      var cash = cashAmount(lot);
      if (side === "sell") {
        sold += cash;
        if (held > 1e-8) basis -= basis * Math.min(1, adj / held);
        held -= adj;
        if (held < 1e-6) {
          held = 0;
          basis = 0;
        }
        return;
      }
      bought += cash;
      held += adj;
      basis += cash;
    });
    var price = null;
    if (quote) {
      var live = asNumber(quote.regularMarketPrice);
      if (live != null && asOf >= (quote.liveDate || "9999-99-99")) price = live;
      if (price == null) price = closeOn(quote.bars, asOf);
    }
    var dividends = importedDiv;
    if (!hasImportedDividends(lots) && quote) {
      dividends = 0;
      (quote.dividends || []).forEach(function (div) {
        if (!div || div.date > asOf || !isFinite(Number(div.amount))) return;
        dividends += sharesHeld(lots, splits, div.date, true) * Number(div.amount);
      });
    }
    var value = null;
    if (held === 0) value = 0;
    else if (price != null) value = held * price;
    return {
      shares: held,
      basis: basis,
      cashBasis: bought - sold,
      bought: bought,
      sold: sold,
      dividends: dividends,
      price: price,
      value: value,
    };
  }

  function attributeLots(lots, quote, asOf) {
    var splits = splitsFor(lots, quote);
    var days = {};
    function day(date) {
      if (!days[date]) days[date] = { divCash: 0, yahooPerShare: 0, trades: [] };
      return days[date];
    }
    orderedLots(lots).forEach(function (lot) {
      if (!lot || !lot.date || lot.date > asOf) return;
      var side = txSide(lot);
      if (side === "split") return;
      if (side === "dividend") day(lot.date).divCash += cashAmount(lot);
      else day(lot.date).trades.push(lot);
    });
    if (!hasImportedDividends(lots) && quote) {
      (quote.dividends || []).forEach(function (div) {
        if (!div || div.date > asOf || !isFinite(Number(div.amount))) return;
        day(div.date).yahooPerShare += Number(div.amount);
      });
    }
    var open = [];
    var byId = {};
    Object.keys(days).sort().forEach(function (date) {
      var info = days[date];
      var eligible = [];
      var totalShares = 0;
      open.forEach(function (row) {
        if (row.remaining <= 1e-8) return;
        eligible.push(row);
        totalShares += row.remaining;
      });
      if (totalShares > 1e-8 && info.divCash) {
        eligible.forEach(function (row) {
          row.dividends += info.divCash * (row.remaining / totalShares);
        });
      }
      if (totalShares > 1e-8 && info.yahooPerShare) {
        eligible.forEach(function (row) {
          row.dividends += row.remaining * info.yahooPerShare;
        });
      }
      orderedLots(info.trades).forEach(function (lot) {
        var adj = Math.abs(signedShares(lot, splits));
        if (txSide(lot) === "buy") {
          var row = { id: lot.id, adjusted: adj, remaining: adj, cost: cashAmount(lot), dividends: 0 };
          open.push(row);
          byId[lot.id] = row;
          return;
        }
        var left = adj;
        for (var i = 0; i < open.length && left > 1e-8; i++) {
          if (open[i].remaining <= 1e-8) continue;
          var take = Math.min(open[i].remaining, left);
          open[i].remaining -= take;
          left -= take;
        }
      });
    });
    var price = null;
    if (quote) {
      var live = asNumber(quote.regularMarketPrice);
      if (live != null && asOf >= (quote.liveDate || "9999-99-99")) price = live;
      if (price == null) price = closeOn(quote.bars, asOf);
    }
    Object.keys(byId).forEach(function (id) {
      var row = byId[id];
      if (row.remaining < 1e-6) row.remaining = 0;
      row.value = price == null ? null : row.remaining * price;
    });
    return byId;
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

  function symbolsOf(lots) {
    var seen = {};
    var list = [];
    (lots || []).forEach(function (lot) {
      if (!lot || !lot.symbol || seen[lot.symbol]) return;
      seen[lot.symbol] = true;
      list.push(lot.symbol);
    });
    return list;
  }

  function buildValueSeries(lots, quotes, start, end) {
    var dates = {};
    var first = "";
    (lots || []).forEach(function (lot) {
      if (!lot || txSide(lot) === "split") return;
      if (!first || lot.date < first) first = lot.date;
      if (lot.date >= start && lot.date <= end) dates[lot.date] = true;
    });
    symbolsOf(lots).forEach(function (symbol) {
      (quoteFor(quotes, symbol).bars || []).forEach(function (bar) {
        if (!bar || bar.date < start || bar.date > end || (first && bar.date < first)) return;
        dates[bar.date] = true;
      });
    });
    return Object.keys(dates).sort().map(function (date) {
      var value = 0;
      var dividends = 0;
      var cost = 0;
      var haveValue = false;
      var rows = [];
      symbolsOf(lots).forEach(function (symbol) {
        var symbolLots = (lots || []).filter(function (lot) { return lot && lot.symbol === symbol; });
        var quote = quoteFor(quotes, symbol);
        var pos = positionAt(symbolLots, quote, date);
        if (pos.value != null) {
          value += pos.value;
          haveValue = true;
        }
        dividends += pos.dividends;
        cost += pos.basis;
        rows.push({
          id: symbol,
          symbol: symbol,
          date: date,
          shares: pos.shares,
          value: pos.value,
          dividends: pos.dividends,
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
    var bought = 0;
    var sold = 0;
    var basis = 0;
    var value = 0;
    var dividends = 0;
    var shares = 0;
    var haveValue = false;
    var missingPrice = false;
    var currencies = {};
    var active = 0;
    symbolsOf(lots).forEach(function (symbol) {
      var symbolLots = (lots || []).filter(function (lot) { return lot && lot.symbol === symbol && lot.date <= asOf; });
      if (!symbolLots.length) return;
      active += symbolLots.length;
      var quote = quotes && quotes[symbol];
      if (quote) currencies[quote.currency || "USD"] = true;
      var pos = positionAt(symbolLots, quote, asOf);
      bought += pos.bought;
      sold += pos.sold;
      basis += pos.basis;
      dividends += pos.dividends;
      shares += pos.shares;
      if (pos.shares > 1e-6 && pos.price == null) missingPrice = true;
      if (pos.value != null) {
        value += pos.value;
        haveValue = true;
      }
    });
    var currencyKeys = Object.keys(currencies);
    var openValue = haveValue && !missingPrice ? value : (haveValue && missingPrice ? null : (shares === 0 ? 0 : null));
    return {
      cost: basis,
      pricedCost: basis,
      bought: bought,
      sold: sold,
      shares: shares,
      cashBasis: bought - sold,
      value: openValue,
      dividends: dividends,
      priced: missingPrice ? 0 : 1,
      active: active,
      currency: currencyKeys.length === 1 ? currencyKeys[0] : (currencyKeys.length ? null : "USD"),
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
    txSide: txSide,
    positionAt: positionAt,
    attributeLots: attributeLots,
    cashAmount: cashAmount,
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
