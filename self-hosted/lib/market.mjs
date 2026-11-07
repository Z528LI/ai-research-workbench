import analysis from '../../market-analysis.js';

export const DEFAULT_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'IWM', 'XLF', 'XLK', 'XLE']);
const SYMBOL = /^[A-Z0-9^][A-Z0-9.^_:/=+\-]{0,23}$/;
const ALPACA_SYMBOL = /^[A-Z][A-Z0-9.\-]{0,11}$/;
const ALPACA_BARS = 'https://data.alpaca.markets/v2/stocks/bars';
const PAGE_SIZE = 1000;
const MAX_PAGES = 8;
const DAY = 86400000;
const RETURN_WINDOW = 20;
const BETA_WINDOW = 60;
const SOURCES = Object.freeze({
  alpaca: Object.freeze({
    kind: 'alpaca', label: 'Alpaca IEX daily bars, adjusted',
    url: 'https://docs.alpaca.markets/us/reference/stockbars'
  }),
  csv: Object.freeze({ kind: 'csv', label: 'User-supplied closing prices' }),
  synthetic: Object.freeze({ kind: 'synthetic', label: 'Illustrative market data' })
});

const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function newYorkParts(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Use a valid date for the market data cutoff.');
  }
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    newYork.formatToParts(date).map(({ type, value }) => [type, value])
  );
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:${second}` };
}

function ticker(value, pattern = SYMBOL) {
  const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!pattern.test(symbol)) throw new Error('Use a valid ticker for each symbol and the benchmark.');
  return symbol;
}

function coveredDates(prices, benchmark) {
  const index = prices.get(benchmark);
  if (!index || index.size < 2) {
    throw new Error('The benchmark needs closing prices for at least two completed sessions.');
  }
  const dates = analysis.observationWindow(index);
  const [previous, latest] = dates.slice(-2);
  const hasPair = [...prices].some(([symbol, values]) => (
    symbol !== benchmark && values.has(previous) && values.has(latest)
  ));
  if (!hasPair) {
    throw new Error('No comparison ticker has closes on both of the last two benchmark sessions.');
  }
  return dates;
}

function checkedMarket(source, benchmark, prices, cutoff) {
  const sorted = new Map([...prices].map(([symbol, series]) => [
    symbol,
    new Map([...series].filter(([date]) => !cutoff || date < cutoff)
      .sort(([left], [right]) => left.localeCompare(right)))
  ]));
  coveredDates(sorted, benchmark);
  return { source, benchmark, prices: sorted };
}

export function loadMarketCsv(csv, { now = new Date(), benchmark = 'SPY' } = {}) {
  return checkedMarket(SOURCES.csv, ticker(benchmark), analysis.parsePrices(csv), newYorkParts(now).date);
}

export function loadSyntheticMarket() {
  return checkedMarket(SOURCES.synthetic, 'MARKET', analysis.parsePrices(analysis.exampleCsv()));
}

function barDate(timestamp) {
  const match = typeof timestamp === 'string' && timestamp.match(
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.0{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
  );
  if (!match) throw new Error('Alpaca returned an invalid daily bar timestamp.');
  const utcDay = new Date(`${match[1]}T00:00:00Z`);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(+utcDay) || utcDay.toISOString().slice(0, 10) !== match[1] || !Number.isFinite(+parsed)) {
    throw new Error('Alpaca returned an invalid daily bar timestamp.');
  }
  const { date, time } = newYorkParts(parsed);
  if (time !== '00:00:00') throw new Error('Alpaca returned a bar outside the daily timestamp convention.');
  return date;
}

async function requestBars(url, headers, signal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers, redirect: 'error', signal });
  } catch {
    throw new Error('The Alpaca historical data request failed or timed out.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Alpaca rejected the credentials or IEX market data access.');
    }
    if (response.status === 429) throw new Error('Alpaca rate-limited the historical data request.');
    throw new Error('Alpaca historical data returned an unsuccessful response.');
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Alpaca historical data returned an unreadable response.');
  }
}

export async function loadMarket({
  now = new Date(), key, secret, symbols = DEFAULT_SYMBOLS, benchmark = 'SPY', fetchImpl = fetch
} = {}) {
  if (typeof key !== 'string' || !key.trim() || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('Set both APCA_API_KEY_ID and APCA_API_SECRET_KEY to use Alpaca data.');
  }
  const index = ticker(benchmark, ALPACA_SYMBOL);
  const supplied = typeof symbols === 'string' ? symbols.split(',') : symbols;
  if (!Array.isArray(supplied)) throw new Error('Provide a comma-separated list of stock tickers.');
  const names = [...new Set([index, ...supplied.map(value => ticker(value, ALPACA_SYMBOL))])].sort();
  if (names.length < 2 || names.length > 20) {
    throw new Error('Use between 2 and 20 distinct symbols, including the benchmark.');
  }

  const today = newYorkParts(now).date;
  const start = newYorkParts(new Date(+now - 160 * DAY)).date;
  const prices = new Map(names.map(symbol => [symbol, new Map()]));
  const headers = { 'APCA-API-KEY-ID': key.trim(), 'APCA-API-SECRET-KEY': secret.trim() };
  const url = new URL(ALPACA_BARS);
  url.search = new URLSearchParams({
    symbols: names.join(','), timeframe: '1Day', start: `${start}T00:00:00Z`, end: `${today}T00:00:00Z`,
    limit: String(PAGE_SIZE), adjustment: 'all', feed: 'iex', sort: 'asc', currency: 'USD'
  });
  const seen = new Set();
  const signal = AbortSignal.timeout(20000);

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await requestBars(new URL(url), headers, signal, fetchImpl);
    const bars = body?.bars;
    if (!bars || typeof bars !== 'object' || Array.isArray(bars) || (body.currency && body.currency !== 'USD')) {
      throw new Error('Alpaca returned an invalid historical bars response.');
    }
    let rows = 0;
    for (const [symbol, values] of Object.entries(bars)) {
      if (!prices.has(symbol) || !Array.isArray(values) || (rows += values.length) > PAGE_SIZE) {
        throw new Error('Alpaca returned an invalid set of daily bars.');
      }
      const series = prices.get(symbol);
      for (const bar of values) {
        const date = barDate(bar?.t);
        if (date < start || date > today || !Number.isFinite(bar.c) || bar.c < 1e-12 || bar.c > 1e12) {
          throw new Error('Alpaca returned a daily bar with an invalid date or close.');
        }
        if (date === today) continue;
        if (series.has(date)) throw new Error('Alpaca returned duplicate bars for a symbol and session.');
        series.set(date, bar.c);
      }
    }

    const token = body.next_page_token;
    if (token === null) return checkedMarket(SOURCES.alpaca, index, prices);
    if (typeof token !== 'string' || !token || token.length > 1024 || seen.has(token)) {
      throw new Error('Alpaca returned invalid historical bars pagination.');
    }
    seen.add(token);
    url.searchParams.set('page_token', token);
  }
  throw new Error('Alpaca historical data exceeded the supported page limit.');
}

function aboveAverage(series, dates, window) {
  const recent = dates.slice(-window);
  if (recent.length < window || !recent.every(date => series.has(date))) return null;
  const latest = series.get(recent.at(-1));
  const differences = recent.reduce((total, date) => total + (latest - series.get(date)), 0);
  return differences > 0;
}

export function summarizeMarket({ source, benchmark, prices }) {
  if (!Object.hasOwn(SOURCES, source?.kind)) throw new Error('Choose a supported market data source.');
  const dates = coveredDates(prices, benchmark);
  const index = prices.get(benchmark);
  const target = [...prices.keys()].find(symbol => symbol !== benchmark);
  const analysisWindow = analysis.analyze(prices, { symbol: target, benchmark, sessions: RETURN_WINDOW });
  const { advancing, dailyEligible, previous } = analysisWindow.breadth;
  const betaDates = dates.slice(-(BETA_WINDOW + 1));
  const relativeRows = analysisWindow.ranking.map(row => {
    const complete = row.observations === RETURN_WINDOW + 1;
    const pairs = analysis.pairedReturns(prices.get(row.ticker), index, betaDates);
    const { beta, n } = analysis.regression(pairs);
    return {
      symbol: row.ticker, observations: row.observations,
      return: complete ? row.targetReturn : null,
      benchmarkReturn: complete ? row.benchmarkReturn : null,
      excess: complete ? row.excess : null,
      beta, betaPairs: n
    };
  }).sort((left, right) => (
    (right.excess ?? -Infinity) - (left.excess ?? -Infinity) || left.symbol.localeCompare(right.symbol)
  ));
  const technicalRows = [...prices].filter(([symbol]) => symbol !== benchmark)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, series]) => ({
      symbol, above20: aboveAverage(series, dates, 20), above50: aboveAverage(series, dates, 50)
    }));
  const asOf = dates.at(-1);
  return {
    source: SOURCES[source.kind], benchmark, asOf, firstSession: dates[0], sessions: dates.length,
    universeSize: technicalRows.length,
    breadth: {
      previousSession: previous, advancing, dailyEligible,
      aboveAverage: technicalRows.filter(row => row.above20 === true).length,
      averageEligible: technicalRows.filter(row => row.above20 !== null).length
    },
    relative: {
      windowSessions: RETURN_WINDOW, betaWindowSessions: BETA_WINDOW,
      start: dates.at(-(RETURN_WINDOW + 1)) ?? null, end: asOf, rows: relativeRows
    },
    technical: { windows: [20, 50], rows: technicalRows }
  };
}
