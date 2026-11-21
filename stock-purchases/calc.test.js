"use strict";

var assert = require("assert");
var calc = require("./calc.js");

function approx(actual, expected, eps) {
  assert.ok(Math.abs(actual - expected) < (eps || 1e-6), actual + " ~= " + expected);
}

var splits = [{ date: "2020-08-31", numerator: 4, denominator: 1 }];
var dividends = [
  { date: "2020-07-01", amount: 0.5 },
  { date: "2020-08-01", amount: 0.82 },
  { date: "2020-08-07", amount: 0.205 },
];
var bars = [
  { date: "2020-07-31", close: 106 },
  { date: "2020-08-03", close: 125 },
  { date: "2020-09-01", close: 130 },
];
var quote = {
  currency: "USD",
  regularMarketPrice: 131,
  liveDate: "2020-09-02",
  bars: bars,
  dividends: dividends,
  splits: splits,
};
var lot = { id: "a", symbol: "AAPL", date: "2020-08-01", shares: 10, price: 500 };
var later = { id: "b", symbol: "AAPL", date: "2020-09-01", shares: 2, price: 130 };

assert.strictEqual(calc.splitFactor(splits, "2020-08-01"), 4);
assert.strictEqual(calc.splitFactor(splits, "2020-08-31"), 1);
assert.strictEqual(calc.splitFactor(splits, "2020-09-01"), 1);
assert.strictEqual(calc.adjustedShares(10, splits, "2020-08-01"), 40);
approx(calc.tradedClose(125, splits, "2020-08-03"), 500);
approx(calc.dividendsThrough(40, dividends, "2020-08-01", "2020-08-03"), 0);
approx(calc.dividendsThrough(40, dividends, "2020-08-01", "2020-09-01"), 8.2);
approx(calc.dividendsThrough(40, dividends, "2020-08-07", "2020-09-01"), 0);

var series = calc.buildValueSeries([lot, later], { AAPL: quote }, "2020-07-01", "2020-09-02");
var aug3 = series.filter(function (p) { return p.date === "2020-08-03"; })[0];
var sep1 = series.filter(function (p) { return p.date === "2020-09-01"; })[0];
assert.ok(series.every(function (p) { return p.date >= "2020-08-01"; }));
approx(aug3.value, 5000);
approx(aug3.cost, 5000);
approx(aug3.dividends, 0);
approx(sep1.value, 5200 + 260);
approx(sep1.cost, 5000 + 260);
approx(sep1.dividends, 8.2);

var bounds = calc.windowBounds("1M", "2026-11-20", "2020-08-01");
assert.strictEqual(bounds.start, "2026-10-21");
assert.strictEqual(bounds.end, "2026-11-20");
assert.strictEqual(calc.windowBounds("YTD", "2026-11-20").start, "2026-01-01");
assert.strictEqual(calc.windowBounds("1Y", "2026-11-20").start, "2025-11-20");
assert.strictEqual(calc.windowBounds("5Y", "2026-11-20").start, "2021-11-20");
assert.strictEqual(calc.windowBounds("all", "2026-11-20", "2020-08-01").start, "2020-08-01");

var sum = calc.summarize([lot, later], { AAPL: quote }, "2020-09-02");
approx(sum.value, 42 * 131);
approx(sum.cost, 5260);
approx(sum.dividends, 8.2);
assert.strictEqual(sum.currency, "USD");

var noLive = {
  currency: "USD",
  regularMarketPrice: null,
  liveDate: null,
  bars: bars,
  dividends: [],
  splits: splits,
};
var fromBars = calc.summarize([later], { AAPL: noLive }, "2020-09-01");
approx(fromBars.value, 260);

var missingPrice = calc.parseChart("X", {
  chart: {
    result: [{
      meta: { currency: "USD", exchangeTimezoneName: "America/New_York" },
      timestamp: [1600000000],
      indicators: { quote: [{ close: [10] }] },
    }],
  },
});
assert.strictEqual(missingPrice.regularMarketPrice, null);
assert.strictEqual(missingPrice.bars.length, 1);

var parsed = calc.parseChart("AAPL", {
  chart: {
    result: [{
      meta: {
        currency: "USD",
        exchangeTimezoneName: "America/New_York",
        shortName: "Apple",
        regularMarketPrice: 130.5,
        regularMarketTime: 1598990400,
      },
      timestamp: [1596465600, 1598976000],
      indicators: { quote: [{ close: [125.25, null] }] },
      events: {
        dividends: { d1: { amount: 0.205, date: 1596807000 } },
        splits: { s1: { date: 1598880600, numerator: 4, denominator: 1 } },
      },
    }],
  },
});
assert.strictEqual(parsed.shortName, "Apple");
assert.ok(parsed.bars.length >= 2);
assert.strictEqual(parsed.splits[0].numerator, 4);
approx(parsed.dividends[0].amount, 0.205);
assert.strictEqual(parsed.regularMarketPrice, 130.5);

function live() {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?period1=1593561600&period2=1609459200&interval=1d&events=div,split";
  return fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    .then(function (res) {
      if (!res.ok) throw new Error("Yahoo " + res.status);
      return res.json();
    })
    .then(function (payload) {
      var quoteLive = calc.parseChart("AAPL", payload);
      var split = quoteLive.splits.filter(function (s) { return s.date.indexOf("2020-08") === 0 && s.numerator === 4; })[0];
      var div = quoteLive.dividends.filter(function (d) { return d.date.indexOf("2020-08") === 0; })[0];
      assert.ok(split, "missing Aug 2020 split");
      assert.ok(div, "missing Aug 2020 dividend");
      approx(div.amount, 0.205, 0.0001);
      var pre = quoteLive.bars.filter(function (b) { return b.date === "2020-08-28"; })[0];
      assert.ok(pre && pre.close > 90 && pre.close < 180, "close should be split-adjusted, got " + (pre && pre.close));
      var held = calc.adjustedShares(10, quoteLive.splits, "2020-08-01");
      assert.strictEqual(held, 40);
      approx(calc.tradedClose(pre.close, quoteLive.splits, pre.date), pre.close * 4);
      console.log("live AAPL split", split.date, "dividend", div.date, div.amount, "unwound close", (pre.close * 4).toFixed(2));
    });
}

var roundTrip = [
  { id: "b1", symbol: "TEST", date: "2026-01-02", side: "buy", shares: 10, price: 10, amount: 100 },
  { id: "s1", symbol: "TEST", date: "2026-01-05", side: "sell", shares: 10, price: 12, amount: 120, seq: 1 },
];
var flat = calc.positionAt(roundTrip, { bars: [], splits: [], dividends: [] }, "2026-01-05");
assert.strictEqual(flat.shares, 0);
assert.strictEqual(flat.basis, 0);
approx(flat.bought, 100);
approx(flat.sold, 120);
approx(flat.value, 0);
var closed = calc.buildValueSeries(roundTrip, { TEST: { bars: [], splits: [], dividends: [] } }, "2026-01-01", "2026-01-06");
var closedDay = closed.filter(function (p) { return p.date === "2026-01-05"; })[0];
approx(closedDay.value, 0);
approx(closedDay.cost, 0);

var splitLots = [
  { id: "b", symbol: "TEST", date: "2026-02-01", side: "buy", shares: 10, price: 5, amount: 50 },
  { id: "sp", symbol: "TEST", date: "2026-02-10", side: "split", numerator: 1, denominator: 5 },
  { id: "d", symbol: "TEST", date: "2026-02-15", side: "dividend", amount: 2 },
];
var afterSplit = calc.positionAt(splitLots, { bars: [], splits: [], dividends: [] }, "2026-02-15");
approx(afterSplit.shares, 2);
approx(afterSplit.dividends, 2);
approx(afterSplit.bought, 50);

live().then(function () {
  console.log("calc.test.js ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
