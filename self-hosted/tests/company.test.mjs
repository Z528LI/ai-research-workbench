import assert from 'node:assert/strict';
import test from 'node:test';

import { companyCapabilities } from '../lib/capabilities/company.mjs';

const runEarnings = companyCapabilities['earnings-alpha-engine'].run;
const symbol = 'EXAMPLE';
const sessions = [
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
];
const prices = [
  ['2026-10-01', 100],
  ['2026-10-02', 999],
  ['2026-10-06', 110],
  ['2026-10-08', 121],
  ['2026-10-09', 122],
].map(([date, close]) => ({ date, close, symbol }));

test('earnings outcomes use exact calendar sessions and exclude the event date', () => {
  const input = { events: [{ symbol, date: '2026-10-02' }], prices, horizons: [1, 2, 3] };
  const aligned = runEarnings({ ...input, sessions: [...sessions].reverse() }).rows[0];
  assert.equal(aligned.baseDate, '2026-10-01');
  assert.deepEqual(aligned.returns[0], { sessions: 1, date: null, return: null });
  assert.equal(aligned.returns[1].date, '2026-10-06');
  assert.ok(Math.abs(aligned.returns[1].return - 0.1) < 1e-10);
  assert.deepEqual(aligned.returns[2], { sessions: 3, date: null, return: null });
  assert.equal(aligned.postVolatilityObservations, 1);
  assert.equal(aligned.postVolatility, null);

  const unaligned = runEarnings(input).rows[0];
  assert.equal(unaligned.returns[0].date, '2026-10-06');
  assert.equal(unaligned.postVolatilityObservations, 2);
});

test('earnings requires the exact pre-event close for a calendar-aligned base', () => {
  const aligned = runEarnings({
    events: [{ symbol, date: '2026-10-05' }],
    prices: prices.filter(row => row.date !== '2026-10-02'),
    horizons: [1],
    sessions,
  }).rows[0];
  assert.equal(aligned.baseDate, null);
  assert.deepEqual(aligned.returns[0], { sessions: 1, date: '2026-10-06', return: null });
  assert.throws(() => runEarnings({ events: [], prices, sessions: [sessions[0], sessions[0]] }), /Duplicate session date/);
});
