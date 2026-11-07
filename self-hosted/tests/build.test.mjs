import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildWorkbench } from '../build.mjs';

const now = new Date('2026-10-06T22:00:00Z');

async function outputDirectory(t) {
  const output = await mkdtemp(join(tmpdir(), 'public-workbench-test-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  return output;
}

function publicSources(url) {
  if (url.startsWith('https://fred.stlouisfed.org/')) {
    return new Response('observation_date,DGS3MO,DGS2,DGS10,DGS30\n2026-10-05,4.1,4.2,4.3,4.4\n', {
      headers: { 'content-type': 'text/csv' },
    });
  }
  assert.equal(url, 'https://api.bls.gov/publicAPI/v1/timeseries/data/');
  return Response.json({
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M09', value: '4.1' }] },
        { seriesID: 'CUUR0000SA0', data: [{ year: '2026', period: 'M09', value: '329.45' }] },
      ],
    },
  });
}

test('one offline command generates all seven illustrative views in a standalone document', async t => {
  const output = await outputDirectory(t);
  const { destination, hasMarket, hasFilings } = await buildWorkbench({
    mode: 'demo', output, now, env: {}, fetchImpl: () => assert.fail('Demo accessed the network.'),
  });
  assert.equal(hasMarket, true);
  assert.equal(hasFilings, true);
  const html = await readFile(destination, 'utf8');
  assert.match(html, /SELF-HOSTED WORKBENCH demo/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|<link[^>]+rel="stylesheet"|WORKBENCH_(?:STYLE|SCRIPT)/);
  for (const id of ['treasury', 'macro', 'breadth', 'relative-risk', 'technical-screen', 'company-filings', 'earnings-filings']) {
    assert.ok(html.includes(`id="${id}"`), `Missing section ${id}`);
  }
  assert.deepEqual(await readdir(output), ['index.html']);
});

test('live render retains real observation dates, and a failed refresh preserves the prior page', async t => {
  const output = await outputDirectory(t);
  const options = { mode: 'live', output, now, env: {} };
  const { destination, hasMarket, hasFilings } = await buildWorkbench({ ...options, fetchImpl: publicSources });
  assert.equal(hasMarket, false);
  assert.equal(hasFilings, false);
  const page = await readFile(destination, 'utf8');
  assert.match(page, /SELF-HOSTED WORKBENCH live/);
  assert.match(page, /Oct 5, 2026/);
  assert.match(page, /Sep 2026/);
  assert.doesNotMatch(page, /Fictional Example Industries|SAMPLE-02/);
  await assert.rejects(
    buildWorkbench({ ...options, fetchImpl: () => new Response('', { status: 503 }) }),
    /returned HTTP 503/,
  );
  assert.equal(await readFile(destination, 'utf8'), page);
  assert.deepEqual(await readdir(output), ['index.html']);
});

test('concurrent writers and unrelated sites are protected', async t => {
  const output = await outputDirectory(t);
  let requested;
  const started = new Promise(resolve => { requested = resolve; });
  let resume;
  const paused = new Promise(resolve => { resume = resolve; });
  const first = buildWorkbench({
    mode: 'live', output, now, env: {}, fetchImpl: async url => {
      requested();
      await paused;
      return publicSources(url);
    },
  });
  await started;
  try {
    await assert.rejects(buildWorkbench({ mode: 'demo', output, now }), /locked by another refresh/);
  } finally {
    resume();
    await first;
  }
  const destination = join(output, 'index.html');
  await writeFile(destination, '<!doctype html><title>Another site</title>');
  await assert.rejects(buildWorkbench({ mode: 'demo', output, now }), /another site or build mode/);
  assert.equal(await readFile(destination, 'utf8'), '<!doctype html><title>Another site</title>');
});
