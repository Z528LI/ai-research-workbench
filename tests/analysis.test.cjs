const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  parsePrices, observationWindow, pairedReturns, regression, capture, analyze, exampleCsv
} = require("../market-analysis.js");

test("CSV accepts BOM, reordered quoted headers, CRLF and optional columns", () => {
  const prices = parsePrices('\ufeff"symbol","note","close","date"\r\nSPY,"A, B",10,2025-03-03\r\nspy,"said ""yes""",11,2025-03-04\r\nAAA,stock,12,2025-03-03\r\n');
  assert.equal(prices.get("SPY").get("2025-03-04"), 11);
  assert.equal(prices.get("AAA").size, 1);
});

test("CSV rejects invalid dates, duplicate price observations and invalid closes", () => {
  const header = "date,symbol,close\n";
  assert.throws(() => parsePrices(header + "2025-02-29,AAA,3"), /valid date/);
  assert.throws(() => parsePrices(header + "2025-01-01,AAA,3\n2025-01-01,aaa,4"), /repeats/);
  assert.throws(() => parsePrices(header + "2025-01-01,AAA,-3"), /numeric close/);
  assert.throws(() => parsePrices(header + "2025-01-01,AAA,1e-312"), /numeric close/);
  assert.throws(() => parsePrices(header + '2025-01-01,"AAA,3'), /unfinished/);
});

test("adjacent benchmark dates prevent an absent stock close from becoming a multi-day return", () => {
  const index = new Map([["2025-03-03", 100], ["2025-03-04", 101], ["2025-03-05", 102], ["2025-03-06", 103]]);
  const stock = new Map([["2025-03-03", 30], ["2025-03-05", 32], ["2025-03-06", 35]]);
  const dates = observationWindow(index, 0);
  assert.deepEqual(observationWindow(index, 2), dates.slice(1));
  assert.deepEqual(pairedReturns(stock, index, dates), [{ date: dates.at(-1), x: 103 / 102 - 1, y: 35 / 32 - 1 }]);
});

test("beta estimates an exact known slope and withholds it for flat or small samples", () => {
  const pairs = Array.from({ length: 30 }, (_, i) => ({ x: (i - 15) / 100, y: 0.003 + 1.4 * (i - 15) / 100 }));
  const fit = regression(pairs);
  assert.ok(Math.abs(fit.beta - 1.4) < 1e-12);
  assert.ok(Math.abs(fit.low - 1.4) < 1e-12);
  assert.ok(Math.abs(fit.high - 1.4) < 1e-12);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-12);
  assert.equal(regression(pairs.slice(0, 19)).beta, null);
  assert.equal(regression(pairs.map(row => ({ ...row, x: 0 }))).beta, null);
});

test("up/down capture qualifies directions independently", () => {
  const pairs = Array.from({ length: 5 }, () => ({ x: 0.01, y: 0.015 }));
  pairs.push({ x: -0.01, y: -0.005 });
  assert.ok(Math.abs(capture(pairs, 1).value - 1.5) < 1e-12);
  assert.deepEqual(capture(pairs, -1), { n: 1, value: null });
});

test("ranking and breadth derive from comparable prices with explicit eligibility", () => {
  const start = new Date("2025-01-01T00:00:00Z");
  const source = ["date,symbol,close"];
  for (let i = 0; i < 22; i++) {
    const date = new Date(+start + i * 86400000).toISOString().slice(0, 10);
    source.push(`${date},INDEX,${100 + i}`, `${date},A,${100 + 2 * i}`, `${date},B,${100 - i}`);
    if (i < 21) source.push(`${date},C,${100 + i}`);
  }
  const report = analyze(parsePrices(source.join("\n")), { symbol: "A", benchmark: "INDEX", peer: "B", sessions: 20 });
  assert.deepEqual(report.series, ["A", "INDEX", "B"]);
  assert.deepEqual(report.points[0].levels, [100, 100, 100]);
  assert.ok(Math.abs(report.selected.excess - (142 / 102 - 121 / 101)) < 1e-12);
  assert.equal(report.ranking[0].ticker, "A");
  assert.equal(report.breadth.advancing, 1);
  assert.equal(report.breadth.dailyEligible, 2);
  assert.equal(report.breadth.aboveAverage, 1);
  assert.equal(report.breadth.averageEligible, 2);
});

test("the one-click synthetic example yields populated chart and statistics", () => {
  const prices = parsePrices(exampleCsv());
  const report = analyze(prices, { symbol: "ATLAS", benchmark: "MARKET", peer: "CEDAR", sessions: 120 });
  assert.equal(prices.size, 8);
  assert.equal(report.points.length, 121);
  assert.equal(report.ranking.length, 7);
  assert.equal(report.selected.fit.n, 120);
  assert.ok(report.selected.fit.beta > 1.2 && report.selected.fit.beta < 1.55);
  assert.ok(report.breadth.dailyEligible === 7 && report.breadth.averageEligible === 7);
});
