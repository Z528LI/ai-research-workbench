import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMarket, loadMarketCsv, loadSyntheticMarket, summarizeMarket } from '../lib/market.mjs';

const credentials = { key: 'test-id', secret: 'test-secret' };
const now = new Date('2026-11-03T02:00:00Z'); // November 2 in New York.
const friday = '2026-10-30T04:00:00Z';
const thursday = '2026-10-29T04:00:00Z';
const monday = '2026-11-02T05:00:00Z';
const bar = (t, c) => ({ t, c });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('reads adjusted IEX pages from the fixed endpoint and uses completed New York dates', async () => {
  const pages = [
    { bars: { SPY: [bar(friday, 105), bar(thursday, 100), bar(monday, 130)] }, next_page_token: 'more==' },
    { bars: { QQQ: [bar(thursday, 100), bar(friday, 108), bar(monday, 90)] }, next_page_token: null }
  ];
  const seen = [];
  const market = await loadMarket({
    ...credentials, now, symbols: 'qqq,xlf',
    fetchImpl(url, options) {
      assert.equal(`${url.origin}${url.pathname}`, 'https://data.alpaca.markets/v2/stocks/bars');
      assert.equal(url.searchParams.get('adjustment'), 'all');
      assert.equal(url.searchParams.get('feed'), 'iex');
      assert.equal(url.searchParams.get('timeframe'), '1Day');
      assert.equal(url.searchParams.get('end'), '2026-11-02T00:00:00Z');
      assert.equal(url.searchParams.get('symbols'), 'QQQ,SPY,XLF');
      assert.equal(options.headers['APCA-API-KEY-ID'], credentials.key);
      assert.equal(options.headers['APCA-API-SECRET-KEY'], credentials.secret);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      seen.push(url.searchParams.get('page_token'));
      return json(pages.shift());
    }
  });
  assert.deepEqual(seen, [null, 'more==']);
  assert.deepEqual([...market.prices.get('SPY')], [['2026-10-29', 100], ['2026-10-30', 105]]);
  const report = summarizeMarket(market);
  assert.equal(report.asOf, '2026-10-30');
  assert.equal(report.universeSize, 2);
  assert.equal(report.breadth.dailyEligible, 1);
  assert.equal(report.breadth.advancing, 1);
  assert.equal(report.relative.rows.find(row => row.symbol === 'XLF').betaPairs, 0);
  assert.doesNotMatch(JSON.stringify(report), /test-secret|test-id|"prices"|"close"/);
});

test('refuses malformed responses, foreign symbols, invalid closes and duplicate sessions', async () => {
  const badCases = [
    [{ bars: [], next_page_token: null }, /invalid historical bars/],
    [{ bars: { OTHER: [] }, next_page_token: null }, /invalid set/],
    [{ bars: { SPY: [bar('2026-02-30T05:00:00Z', 100)] }, next_page_token: null }, /timestamp/],
    [{ bars: { SPY: [bar('2026-10-30T13:30:00Z', 100)] }, next_page_token: null }, /daily timestamp/],
    [{ bars: { SPY: [bar(friday, '100')] }, next_page_token: null }, /invalid date or close/],
    [{ bars: { SPY: [bar(friday, 100), bar(friday, 101)] }, next_page_token: null }, /duplicate/]
  ];
  for (const [payload, error] of badCases) {
    await assert.rejects(loadMarket({ ...credentials, now, fetchImpl: () => json(payload) }), error);
  }
});

test('bounds pagination and reports authentication or missing benchmarks without provider text', async () => {
  let attempts = 0;
  const fetchImpl = () => json({ bars: {}, next_page_token: String(++attempts) });
  await assert.rejects(loadMarket({ ...credentials, now, fetchImpl }), /page limit/);
  assert.equal(attempts, 8);
  await assert.rejects(loadMarket({
    ...credentials, now, fetchImpl: () => json({ bars: {}, next_page_token: 'duplicate' })
  }), /pagination/);
  await assert.rejects(loadMarket({
    ...credentials, now, fetchImpl: () => json({ message: credentials.secret }, 403)
  }), error => /rejected the credentials/.test(error.message) && !error.message.includes(credentials.secret));
  await assert.rejects(loadMarket({
    ...credentials, now, fetchImpl: () => json({ bars: {}, next_page_token: null })
  }), /benchmark needs closing prices/);
});

test('CSV preserves actual dates and rejects unsupported recent comparison coverage', () => {
  const input = [
    'date,symbol,close',
    '2026-11-02,SPY,130', '2026-10-30,SPY,101', '2026-10-29,SPY,100',
    '2026-10-28,QQQ,101', '2026-10-29,QQQ,102', '2026-10-30,QQQ,103'
  ].join('\n');
  const market = loadMarketCsv(input, { now, benchmark: 'spy' });
  assert.deepEqual([...market.prices.get('SPY').keys()], ['2026-10-29', '2026-10-30']);
  assert.equal(summarizeMarket(market).breadth.previousSession, '2026-10-29');
  assert.throws(() => loadMarketCsv(input.replace('2026-10-30,QQQ,103', '2026-11-02,QQQ,103'), { now }), /No comparison ticker/);
  assert.throws(() => loadMarketCsv(input, { now, benchmark: 'IWM' }), /benchmark needs closing prices/);
});

test('computes aligned analytics and makes missing windows explicit', () => {
  const source = { kind: 'csv' };
  const benchmark = 'SPY';
  const dates = Array.from({ length: 61 }, (_, day) => new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10));
  let benchmarkClose = 100;
  let targetClose = 70;
  const index = new Map();
  const target = new Map();
  for (const [offset, date] of dates.entries()) {
    const daily = offset % 2 ? -0.01 : 0.02;
    benchmarkClose *= 1 + daily;
    targetClose *= 1 + 2 * daily;
    index.set(date, benchmarkClose);
    target.set(date, targetClose);
  }
  const sparse = new Map([[dates.at(-2), 500], [dates.at(-1), 400]]);
  const flat = new Map(dates.map(date => [date, 1.1]));
  const prices = new Map([[benchmark, index], ['FULL', target], ['SPARSE', sparse], ['FLAT', flat]]);
  const report = summarizeMarket({ source, benchmark, prices });
  const [full, , missing] = report.relative.rows;
  assert.equal(report.asOf, dates.at(-1));
  assert.equal(report.relative.start, dates.at(-21));
  assert.equal(full.symbol, 'FULL');
  assert.equal(full.betaPairs, 60);
  assert.ok(Math.abs(full.beta - 2) < 1e-10);
  assert.equal(full.observations, 21);
  assert.ok(Math.abs(full.excess - (full.return - full.benchmarkReturn)) < 1e-10);
  assert.equal(missing.symbol, 'SPARSE');
  assert.equal(missing.return, null);
  assert.equal(missing.beta, null);
  assert.equal(missing.betaPairs, 1);
  assert.deepEqual(report.breadth, {
    previousSession: dates.at(-2), advancing: 1, dailyEligible: 3, aboveAverage: 1, averageEligible: 2
  });
  assert.deepEqual(report.technical.rows, [
    { symbol: 'FLAT', above20: false, above50: false },
    { symbol: 'FULL', above20: true, above50: true },
    { symbol: 'SPARSE', above20: null, above50: null }
  ]);
});

test('deterministic illustrative dataset works offline and is clearly labeled', () => {
  const a = summarizeMarket(loadSyntheticMarket());
  const b = summarizeMarket(loadSyntheticMarket());
  assert.deepEqual(a, b);
  assert.equal(a.source.kind, 'synthetic');
  assert.equal(a.benchmark, 'MARKET');
  assert.equal(a.breadth.dailyEligible, a.universeSize);
  assert.ok(a.asOf > a.firstSession);
});
