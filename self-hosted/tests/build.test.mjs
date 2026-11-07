import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildWorkbench } from '../build.mjs';
import { demoInputs } from '../lib/demo-inputs.mjs';

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

const expectedPages = [
  'macro', 'regime', 'us-rebound', 'limit-history', 'rebound', 'precrash', 'beta',
  'daily5', 'serenity', 'themes', 'limit-features', 'news', 'earnings', 'valuation', 'frontier',
];

async function assertPages(output, html, mode) {
  const links = [...html.matchAll(/href="(reports\/(?:[a-f0-9-]+|current)\/([a-z0-9-]+)\/index.html)"/g)];
  assert.deepEqual(links.map(match => match[2]), expectedPages);
  for (const [, link] of links) {
    const view = await readFile(join(output, link), 'utf8');
    assert.match(view, new RegExp(`SELF-HOSTED WORKBENCH ${mode}`));
    assert.match(view, /href="..\/..\/..\/index.html"/);
    assert.doesNotMatch(view, /<script|<link[^>]+rel="stylesheet"|WORKBENCH_STYLE/);
    if (mode === 'demo') {
      assert.doesNotMatch(view, /Connect a data source/);
      assert.match(view, /Synthetic example data/);
    }
  }
  return links.map(match => match[1]);
}

test('one offline command generates all 15 linked research pages', async t => {
  const output = await outputDirectory(t);
  const { destination, hasMarket, hasFilings, connected } = await buildWorkbench({
    mode: 'demo', output, now, env: {}, fetchImpl: () => assert.fail('Demo accessed the network.'),
  });
  assert.equal(hasMarket, true);
  assert.equal(hasFilings, true);
  assert.equal(connected, 15);
  const html = await readFile(destination, 'utf8');
  assert.match(html, /SELF-HOSTED WORKBENCH demo/);
  assert.match(html, /<style>/);
  await assertPages(output, html, 'demo');
  assert.deepEqual((await readdir(output)).sort(), ['index.html', 'reports']);
});

test('live render preserves observation dates and a failed refresh preserves the prior linked snapshot', async t => {
  const output = await outputDirectory(t);
  const options = { mode: 'live', output, now, env: {} };
  const { destination, hasMarket, hasFilings, connected } = await buildWorkbench({ ...options, fetchImpl: publicSources });
  assert.equal(hasMarket, false);
  assert.equal(hasFilings, false);
  assert.equal(connected, 1);
  const page = await readFile(destination, 'utf8');
  assert.match(page, /SELF-HOSTED WORKBENCH live/);
  const links = await assertPages(output, page, 'live');
  const macro = await readFile(join(output, links[0]), 'utf8');
  assert.match(macro, /Oct 5, 2026/);
  assert.match(macro, /Sep 2026/);
  assert.doesNotMatch(page, /Fictional Example Industries|SAMPLE-02/);
  const prior = await readdir(join(output, 'reports'));
  await assert.rejects(
    buildWorkbench({ ...options, fetchImpl: () => new Response('', { status: 503 }) }),
    /returned HTTP 503/,
  );
  await assert.rejects(
    buildWorkbench({ ...options, env: { WORKBENCH_REQUIRE_FULL_COVERAGE: 'true' }, fetchImpl: publicSources }),
    /Connect the required sources/,
  );
  assert.equal(await readFile(destination, 'utf8'), page);
  assert.deepEqual(await readdir(join(output, 'reports')), prior);
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


test('a configured public bundle connects all 15 pages through the real-input build path', async t => {
  const output = await outputDirectory(t);
  const bundle = demoInputs();
  bundle.sources = Object.fromEntries(
    Object.keys(bundle).filter(key => !['asOf', 'sources'].includes(key)).map(key => [key, 'https://example.org/input']),
  );
  for (const publication of bundle.publications) publication.url = 'https://example.org/paper';
  const url = 'https://raw.githubusercontent.com/example/public-inputs/main/research.json';
  const env = { WORKBENCH_PUBLIC_INPUT_URL: url, WORKBENCH_REQUIRE_FULL_COVERAGE: 'true' };
  const fetchImpl = resource => resource === url ? Response.json(bundle) : publicSources(resource);
  const { connected, destination } = await buildWorkbench({ mode: 'live', output, now, env, fetchImpl });
  assert.equal(connected, 15);
  const html = await readFile(destination, 'utf8');
  await assertPages(output, html, 'live');
  assert.doesNotMatch(html, /Connect a source|Synthetic example data/);

  bundle.valuation[0].date = '2099-01-01';
  await assert.rejects(buildWorkbench({ mode: 'live', output, now, env, fetchImpl }), /future observation date/);
  assert.equal(await readFile(destination, 'utf8'), html);
});


test('the Pages staging build gives each report a stable path', async t => {
  const output = await outputDirectory(t);
  const options = { mode: 'live', output, now, env: {}, fetchImpl: publicSources, stableLinks: true };
  const { destination } = await buildWorkbench(options);
  const html = await readFile(destination, 'utf8');
  const links = await assertPages(output, html, 'live');
  assert.ok(links.every(link => link.startsWith('reports/current/')));
  await assert.rejects(buildWorkbench(options), /new staging directory/);
  assert.equal(await readFile(destination, 'utf8'), html);
});
