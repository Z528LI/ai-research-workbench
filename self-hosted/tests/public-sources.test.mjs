import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPublicSources } from '../lib/public-sources.mjs';

const now = new Date('2026-11-07T15:00:00Z');
const treasuryHeader = 'observation_date,DGS3MO,DGS2,DGS10,DGS30';
const treasuryCsv = [treasuryHeader, '2026-11-06,4.1,3.9,4.3,4.9', '2026-11-05,4.2,3.9,4.2,4.8', '2026-11-04,.,,,'].join('\n');
const secUserAgent = 'Research operator operator@example.com';
const issuers = [{ cik: '320193', symbol: 'aapl' }];

function laborPayload() {
  return {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M10', value: '4.1' }, { year: '2026', period: 'M09', value: '4.2' }] },
        { seriesID: 'CUUR0000SA0', data: [
          { year: '2026', period: 'M09', value: '336.940' },
          { year: '2025', period: 'M13', value: '321.943' },
          { year: '2025', period: 'M10', value: '-', footnotes: [{ code: 'X', text: 'Data unavailable.' }] },
        ] },
      ],
    },
  };
}

function filingsPayload() {
  return {
    cik: '0000320193', name: 'Example Issuer', tickers: ['AAPL'],
    filings: {
      recent: {
        accessionNumber: ['0000320193-26-000111', '0000320193-26-000110', '0000320193-26-000112'],
        filingDate: ['2026-11-05', '2026-11-06', '2026-11-06'],
        reportDate: ['2026-11-05', '2026-09-26', ''],
        form: ['8-K', '10-K', '4'],
        primaryDocument: ['earnings.htm', 'annual.htm', 'xslF345X05/filing.xml'],
        items: ['2.02,9.01', '', ''],
      },
    },
  };
}

function mock({ treasury = treasuryCsv, labor = laborPayload(), sec = filingsPayload() } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://fred.stlouisfed.org/')) {
      return treasury instanceof Response ? treasury : new Response(treasury, { headers: { 'content-type': 'application/csv' } });
    }
    if (url.startsWith('https://api.bls.gov/')) {
      return labor instanceof Response ? labor : Response.json(labor);
    }
    if (url.startsWith('https://data.sec.gov/')) return Response.json(sec);
    throw new Error('Unexpected endpoint');
  };
  return { calls, fetchImpl };
}

test('loads official series in date order and retains publication lags and missing months', async () => {
  const { calls, fetchImpl } = mock();
  const result = await loadPublicSources({ now, fetchImpl });
  assert.deepEqual(result.treasury.observations, [
    { date: '2026-11-05', month3: 4.2, year2: 3.9, year10: 4.2, year30: 4.8 },
    { date: '2026-11-06', month3: 4.1, year2: 3.9, year10: 4.3, year30: 4.9 },
  ]);
  assert.deepEqual(result.labor.unemployment, [{ date: '2026-09-01', value: 4.2 }, { date: '2026-10-01', value: 4.1 }]);
  assert.deepEqual(result.labor.cpi, [{ date: '2026-09-01', value: 336.94 }]);
  assert.equal(result.filings, null);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.init.signal instanceof AbortSignal && call.init.redirect === 'error'));
  const labor = calls.find(call => call.url.startsWith('https://api.bls.gov/'));
  assert.deepEqual(JSON.parse(labor.init.body), { seriesid: ['LNS14000000', 'CUUR0000SA0'], startyear: '2024', endyear: '2026' });
});

test('SEC metadata joins only the declared issuer and links the intended SEC documents', async () => {
  const { calls, fetchImpl } = mock();
  const result = await loadPublicSources({ now, issuers, secUserAgent, fetchImpl });
  assert.equal(result.filings.issuers[0].symbol, 'AAPL');
  assert.deepEqual(result.filings.issuers[0].filings.map(({ form, items }) => ({ form, items })), [
    { form: '10-K', items: [] }, { form: '8-K', items: ['2.02', '9.01'] },
  ]);
  assert.equal(result.filings.issuers[0].filings[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000110/annual.htm');
  const call = calls.find(({ url }) => url.startsWith('https://data.sec.gov/'));
  assert.equal(call.url, 'https://data.sec.gov/submissions/CIK0000320193.json');
  assert.equal(call.init.headers['user-agent'], secUserAgent);
  assert.doesNotMatch(JSON.stringify(result), /operator@example\.com/);
});

test('rejects invalid SEC configuration before fetching any source', async () => {
  const { calls, fetchImpl } = mock();
  await assert.rejects(loadPublicSources({ now, issuers, secUserAgent: 'invalid\r\nname a@example.com', fetchImpl }), /declared name/);
  await assert.rejects(loadPublicSources({ now, issuers: [{ cik: '1/other', symbol: 'AAPL' }], secUserAgent, fetchImpl }), /Invalid SEC CIK/);
  await assert.rejects(loadPublicSources({ now, issuers: [...issuers, { cik: '0000320193', symbol: 'OTHER' }], secUserAgent, fetchImpl }), /Duplicate SEC issuer/);
  assert.equal(calls.length, 0);
});

test('fails closed on Treasury response errors, oversized streams, bad CSV and stale data', async () => {
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(769 * 1024)); controller.close(); } });
  for (const [treasury, pattern] of [
    [new Response('private upstream message', { status: 403 }), /^Error: Treasury yields returned HTTP 403$/],
    [new Response(treasuryCsv, { headers: { 'content-type': 'text/html' } }), /unexpected content type/],
    [new Response(streamed, { headers: { 'content-type': 'application/csv' } }), /exceeds the size limit/],
    [treasuryCsv.replace('DGS10', 'OTHER'), /unexpected series/],
    [`${treasuryCsv}\n2026-11-06,4.1,3.9,4.3,4.9`, /duplicate date/],
    [`${treasuryHeader}\n2026-11-31,4.1,3.9,4.3,4.9`, /invalid or duplicate date/],
    [`${treasuryHeader}\n2026-11-06,4.1,3.9,Infinity,4.9`, /invalid value/],
    [`${treasuryHeader}\n2026-10-23,4.1,3.9,4.3,4.9`, /no sufficiently recent/],
  ]) {
    await assert.rejects(loadPublicSources({ now, fetchImpl: mock({ treasury }).fetchImpl }), pattern);
  }
});

test('rejects bad BLS identity, duplicate period, future period and unqualified missing values', async () => {
  for (const [mutate, pattern] of [
    [series => { series[0].seriesID = 'another'; }, /unexpected series identities/],
    [series => { series[0].data.push({ ...series[0].data[0] }); }, /future or duplicate month/],
    [series => { series[0].data[0].period = 'M11'; }, /future or duplicate month/],
    [series => { series[0].data[0].value = '-'; }, /invalid value/],
    [series => { series[1].data[0].value = '0'; }, /invalid value/],
  ]) {
    const labor = laborPayload();
    mutate(labor.Results.series);
    await assert.rejects(loadPublicSources({ now, fetchImpl: mock({ labor }).fetchImpl }), pattern);
  }
});

test('fails closed when an enabled SEC issuer has the wrong identity, skewed columns or an unsafe path', async () => {
  for (const [mutate, pattern] of [
    [sec => { sec.tickers = ['WRONG']; }, /unexpected issuer identity/],
    [sec => { sec.filings.recent.items.pop(); }, /inconsistent filing arrays/],
    [sec => { sec.filings.recent.primaryDocument[0] = '../other'; }, /unsafe filing document path/],
    [sec => { sec.filings.recent.filingDate[0] = '2026-11-08'; }, /invalid filing date/],
  ]) {
    const sec = filingsPayload();
    mutate(sec);
    await assert.rejects(loadPublicSources({ now, issuers, secUserAgent, fetchImpl: mock({ sec }).fetchImpl }), pattern);
  }
});
