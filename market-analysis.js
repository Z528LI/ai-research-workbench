/* Source-to-Trade Market Lab. Dependency-free market calculations. */
(function (root) {
  "use strict";

  const MAX_ROWS = 150000;
  const MAX_SYMBOLS = 300;
  const MIN_BETA_PAIRS = 20;
  const mean = values => values.reduce((total, value) => total + value, 0) / values.length;

  function readCsv(text) {
    const records = [];
    let row = [], field = "", quoted = false, afterQuote = false;
    function endField() {
      row.push(field);
      field = "";
      afterQuote = false;
    }
    function endRecord() {
      endField();
      if (row.some(value => value.trim())) records.push(row);
      row = [];
      if (records.length > MAX_ROWS + 1) throw new Error("Use a CSV with up to 150,000 data rows.");
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') field += char;
        else if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
        continue;
      }
      if (char === "," || char === "\n" || char === "\r") {
        if (char === ",") endField();
        else {
          if (char === "\r" && text[i + 1] === "\n") i++;
          endRecord();
        }
      } else if (afterQuote) {
        if (!/[ \t]/.test(char)) throw new Error("Unexpected text after a closing CSV quote.");
      } else if (char === '"') {
        if (field) throw new Error("An opening CSV quote must begin a field.");
        quoted = true;
      } else field += char;
    }
    if (quoted) throw new Error("A quoted CSV field is unfinished.");
    endRecord();
    return records;
  }

  function parsePrices(text) {
    const [header, ...rows] = readCsv(text.replace(/^\uFEFF/, ""));
    if (!header) throw new Error("Choose a CSV containing date, symbol, and close columns.");
    const keys = header.map(value => value.trim().toLowerCase());
    const required = ["date", "symbol", "close"];
    if (!required.every(key => keys.filter(value => value === key).length === 1)) {
      throw new Error("Use one column each for date, symbol, and close.");
    }
    const [dateIndex, symbolIndex, closeIndex] = required.map(key => keys.indexOf(key));
    const prices = new Map();
    for (const [i, row] of rows.entries()) {
      const date = (row[dateIndex] ?? "").trim();
      const symbol = (row[symbolIndex] ?? "").trim().toUpperCase();
      const value = (row[closeIndex] ?? "").trim();
      const parsed = new Date(date + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error(`Data row ${i + 1} needs a valid date in YYYY-MM-DD format.`);
      }
      if (!/^[A-Z0-9^][A-Z0-9.^_:/=+\-]{0,23}$/.test(symbol)) {
        throw new Error(`Data row ${i + 1} needs a ticker of up to 24 characters.`);
      }
      const close = Number(value);
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || close < 1e-12 || close > 1e12) {
        throw new Error(`Data row ${i + 1} needs a numeric close between 0.000000000001 and 1 trillion.`);
      }
      if (!prices.has(symbol)) {
        if (prices.size >= MAX_SYMBOLS) throw new Error("Use a CSV with up to 300 tickers.");
        prices.set(symbol, new Map());
      }
      const series = prices.get(symbol);
      if (series.has(date)) throw new Error(`Data row ${i + 1} repeats the same ticker and date.`);
      series.set(date, close);
    }
    if (prices.size < 2 || ![...prices.values()].some(series => series.size > 1)) {
      throw new Error("Include a benchmark and at least one stock with price history.");
    }
    return prices;
  }

  function observationWindow(benchmark, periods) {
    const dates = [...benchmark.keys()].sort();
    return periods ? dates.slice(-(periods + 1)) : dates;
  }

  function pairedReturns(stock, benchmark, dates) {
    const result = [];
    for (let i = 1; i < dates.length; i++) {
      const previous = dates[i - 1];
      const date = dates[i];
      if (!stock.has(previous) || !stock.has(date)) continue;
      const x = benchmark.get(date) / benchmark.get(previous) - 1;
      const y = stock.get(date) / stock.get(previous) - 1;
      if (Number.isFinite(x) && Number.isFinite(y)) result.push({ date, x, y });
    }
    return result;
  }

  // Benchmark regression and Bartlett-weighted Newey–West interval.
  function regression(pairs, minimum = MIN_BETA_PAIRS) {
    const n = pairs.length;
    const empty = { n, beta: null, low: null, high: null, r2: null };
    if (n < Math.max(3, minimum)) return empty;
    const meanX = mean(pairs.map(row => row.x));
    const meanY = mean(pairs.map(row => row.y));
    let xx = 0, xy = 0, yy = 0;
    for (const { x, y } of pairs) {
      xx += (x - meanX) ** 2;
      xy += (x - meanX) * (y - meanY);
      yy += (y - meanY) ** 2;
    }
    if (xx < 1e-14) return empty;
    const beta = xy / xx;
    const intercept = meanY - beta * meanX;
    const residualProducts = pairs.map(({ x, y }) => (x - meanX) * (y - intercept - beta * x));
    const lags = Math.min(n - 1, Math.floor(4 * (n / 100) ** (2 / 9)));
    let variance = residualProducts.reduce((sum, value) => sum + value ** 2, 0);
    for (let lag = 1; lag <= lags; lag++) {
      let autocovariance = 0;
      for (let i = lag; i < n; i++) autocovariance += residualProducts[i] * residualProducts[i - lag];
      variance += 2 * (1 - lag / (lags + 1)) * autocovariance;
    }
    const se = Math.sqrt(Math.max(0, variance * n / (n - 2))) / xx;
    return {
      n, beta, low: beta - 1.96 * se, high: beta + 1.96 * se,
      r2: yy > 1e-14 ? Math.min(1, Math.max(0, xy ** 2 / (xx * yy))) : null
    };
  }

  function capture(pairs, direction) {
    const subset = pairs.filter(row => direction * row.x > 0);
    const average = mean(subset.map(row => row.x));
    return {
      n: subset.length,
      value: subset.length >= 5 && Math.abs(average) > 1e-12 ? mean(subset.map(row => row.y)) / average : null
    };
  }

  function describeStock(stock, benchmark, dates) {
    const common = dates.filter(date => stock.has(date));
    const [start, end] = [common[0], common.at(-1)];
    const targetReturn = common.length > 1 ? stock.get(end) / stock.get(start) - 1 : null;
    const benchmarkReturn = common.length > 1 ? benchmark.get(end) / benchmark.get(start) - 1 : null;
    const pairs = pairedReturns(stock, benchmark, dates);
    return {
      start, end, observations: common.length, targetReturn, benchmarkReturn,
      excess: targetReturn === null ? null : targetReturn - benchmarkReturn,
      fit: regression(pairs),
      up: capture(pairs, 1), down: capture(pairs, -1)
    };
  }

  function breadth(prices, benchmarkSymbol, dates) {
    const today = dates.at(-1);
    const previous = dates.at(-2);
    const recent = dates.slice(-20);
    let advancing = 0, dailyEligible = 0, aboveAverage = 0, averageEligible = 0;
    for (const [symbol, stock] of prices) {
      if (symbol === benchmarkSymbol) continue;
      if (previous && stock.has(previous) && stock.has(today)) {
        dailyEligible++;
        if (stock.get(today) > stock.get(previous)) advancing++;
      }
      if (recent.length === 20 && recent.every(date => stock.has(date))) {
        averageEligible++;
        if (stock.get(today) > mean(recent.map(date => stock.get(date)))) aboveAverage++;
      }
    }
    return { today, previous, advancing, dailyEligible, aboveAverage, averageEligible };
  }

  function analyze(prices, { symbol, benchmark, peer, sessions }) {
    const index = prices.get(benchmark);
    const stock = prices.get(symbol);
    if (!index || !stock || symbol === benchmark) throw new Error("Choose a stock and a different benchmark.");
    const dates = observationWindow(index, sessions);
    const series = [symbol, benchmark, ...(peer && peer !== benchmark && peer !== symbol ? [peer] : [])];
    const shared = dates.filter(date => series.every(ticker => prices.get(ticker)?.has(date)));
    const points = shared.map(date => ({
      date,
      levels: series.map(ticker => 100 * prices.get(ticker).get(date) / prices.get(ticker).get(shared[0]))
    }));
    const ranking = [...prices]
      .filter(([ticker]) => ticker !== benchmark)
      .map(([ticker, values]) => ({ ticker, ...describeStock(values, index, dates) }))
      .sort((a, b) => (b.excess ?? -Infinity) - (a.excess ?? -Infinity) || a.ticker.localeCompare(b.ticker));
    return {
      dates, series, points, ranking,
      selected: ranking.find(row => row.ticker === symbol),
      breadth: breadth(prices, benchmark, dates)
    };
  }

  function exampleCsv() {
    const symbols = ["MARKET", "ATLAS", "CEDAR", "HARBOR", "LUMEN", "SUMMIT", "VERDE", "NORTH"];
    const scale = [1, 1.37, 0.64, 0.37, 1.22, 0.82, 0.54, 1.05];
    const prices = symbols.map((_, i) => 78 + i * 8);
    const rows = ["date,symbol,close"];
    const date = new Date("2025-01-02T00:00:00Z");
    for (let day = 0, t = 0; day < 383; day++, date.setUTCDate(date.getUTCDate() + 1)) {
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      const market = 0.0007 + 0.0068 * Math.sin(t * 0.63) + 0.0042 * Math.cos(t * 0.15);
      for (let i = 0; i < symbols.length; i++) {
        const residual = i ? 0.0038 * Math.sin(t * (0.37 + i * 0.07) + i) + (i - 2) * 0.00015 : 0;
        prices[i] *= 1 + scale[i] * market + residual;
        rows.push(`${date.toISOString().slice(0, 10)},${symbols[i]},${prices[i].toFixed(6)}`);
      }
      t++;
    }
    return rows.join("\n") + "\n";
  }

  const api = { parsePrices, observationWindow, pairedReturns, regression, capture, analyze, exampleCsv };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarketAnalysis = Object.freeze(api);
})(globalThis);
