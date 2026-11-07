import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { demoReport } from './lib/demo.mjs';
import { demoInputs } from './lib/demo-inputs.mjs';
import { loadPublicResearch, loadResearchBundle } from './lib/inputs.mjs';
import { loadMarket, loadMarketCsv } from './lib/market.mjs';
import { loadPublicSources } from './lib/public-sources.mjs';
import { makePages, marketFromBundle } from './lib/pages.mjs';
import { renderResearchPage, renderWorkbench } from './lib/render.mjs';

const editionRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(editionRoot);
const snapshotMarker = '<!-- SELF-HOSTED WORKBENCH';
const maxCsvBytes = 5_000_000;

function configuredIssuers(env) {
  if (!env.WORKBENCH_ISSUERS) return [];
  try {
    const issuers = JSON.parse(env.WORKBENCH_ISSUERS);
    if (Array.isArray(issuers)) return issuers;
  } catch {
    // Report the expected format without echoing the environment value.
  }
  throw new Error('WORKBENCH_ISSUERS must be a JSON array of issuer objects.');
}

async function readPriceCsv(path) {
  const input = await stat(path);
  if (!input.isFile() || input.size > maxCsvBytes) {
    throw new Error('The market CSV must be a regular file of at most 5 MB.');
  }
  const csv = await readFile(path);
  if (csv.length > maxCsvBytes) throw new Error('The market CSV must be at most 5 MB.');
  return csv.toString('utf8');
}

async function loadLiveReport({ now, env, csvPath, inputPath, fetchImpl }) {
  const issuers = configuredIssuers(env);
  const key = env.APCA_API_KEY_ID;
  const secret = env.APCA_API_SECRET_KEY;
  if (!csvPath && Boolean(key) !== Boolean(secret)) {
    throw new Error('Set both Alpaca market data credentials or leave both unset.');
  }

  const [inputs, bundle] = await Promise.all([
    loadPublicSources({ now, secUserAgent: env.SEC_USER_AGENT, issuers, fetchImpl }),
    loadResearchBundle({ path: inputPath, url: env.WORKBENCH_PUBLIC_INPUT_URL, now, fetchImpl }),
  ]);
  if (env.WORKBENCH_CROSSREF === 'true' && !bundle.publications) {
    bundle.publications = await loadPublicResearch(now, fetchImpl);
    bundle.sources = { ...bundle.sources, publications: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/' };
  }
  const us = csvPath
    ? loadMarketCsv(await readPriceCsv(csvPath), { now, benchmark: env.WORKBENCH_BENCHMARK })
    : bundle.market
      ? marketFromBundle(bundle.market)
      : key
        ? await loadMarket({ now, key, secret, symbols: env.WORKBENCH_SYMBOLS, benchmark: env.WORKBENCH_BENCHMARK, fetchImpl })
        : null;
  const viewBundle = csvPath && bundle.sources?.market
    ? { ...bundle, sources: { ...bundle.sources, market: undefined } }
    : bundle;
  return makePages({ mode: 'live', generatedAt: now.toISOString(), ...inputs },
    viewBundle, us, marketFromBundle(bundle.marketCN));
}

async function loadDemoReport(now) {
  const inputs = demoInputs();
  return makePages(demoReport(now), inputs, marketFromBundle(inputs.market), marketFromBundle(inputs.marketCN));
}

async function protectExisting(destination, mode, stableLinks) {
  let previous;
  try {
    previous = await readFile(destination, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  if (stableLinks) throw new Error('Stable report links require a new staging directory.');
  if (!previous.includes(`${snapshotMarker} ${mode} -->`)) {
    throw new Error('The output already contains an index.html for another site or build mode. Choose a different output directory.');
  }
}

function stylePage(html, css, mode) {
  if (!html.startsWith('<!doctype html>') || html.split('<!-- WORKBENCH_STYLE -->').length !== 2 || /<\/style/i.test(css)) {
    throw new Error('The workbench page did not pass the rendering check.');
  }
  return html
    .replace('<!doctype html>', `<!doctype html>\n${snapshotMarker} ${mode} -->`)
    .replace('<!-- WORKBENCH_STYLE -->', () => `<style>\n${css}\n</style>`);
}

async function createSnapshot(report, directory, stableLinks) {
  const css = await readFile(join(editionRoot, 'workbench.css'), 'utf8');
  const snapshot = stableLinks ? 'current' : randomUUID();
  const html = stylePage(renderWorkbench(report, snapshot), css, report.mode);
  if (report.views.length !== 15 || new Set(report.views.map(view => view.id)).size !== 15) {
    throw new Error('The research dashboard must contain 15 unique pages.');
  }
  const reports = join(directory, 'reports');
  const staging = join(reports, `.${randomUUID()}.tmp`);
  await mkdir(reports, { recursive: true });
  await mkdir(staging);
  try {
    for (const view of report.views) {
      const pageDirectory = join(staging, view.id);
      await mkdir(pageDirectory);
      await writeFile(join(pageDirectory, 'index.html'), stylePage(renderResearchPage(report, view), css, report.mode), { flag: 'wx' });
    }
    await rename(staging, join(reports, snapshot));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return html;
}

export async function buildWorkbench({ mode, output, now = new Date(), env = process.env, csvPath, inputPath, stableLinks = false, fetchImpl = fetch }) {
  if (!['demo', 'live'].includes(mode) || (mode === 'demo' && (csvPath || inputPath))) {
    throw new Error('Choose either demo mode or live mode. External inputs can only be used in live mode.');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error('The refresh clock is invalid.');

  const directory = resolve(output ?? join(repositoryRoot, '.workbench', mode));
  const destination = join(directory, 'index.html');
  const lockPath = join(directory, '.refresh.lock');
  await mkdir(directory, { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('This output directory is locked by another refresh.');
    throw error;
  }

  try {
    await protectExisting(destination, mode, stableLinks);
    const report = mode === 'demo' ? await loadDemoReport(now) : await loadLiveReport({ now, env, csvPath, inputPath, fetchImpl });
    if (mode === 'live' && env.WORKBENCH_REQUIRE_FULL_COVERAGE === 'true') {
      const unavailable = report.views.filter(view => !view.data || !view.data.usable).map(view => view.id);
      if (unavailable.length) throw new Error(`Connect the required sources and history for ${unavailable.join(', ')}.`);
    }
    const html = await createSnapshot(report, directory, stableLinks);
    const staging = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
    try {
      const file = await open(staging, 'wx');
      try {
        await file.writeFile(html, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(staging, destination);
    } finally {
      await unlink(staging).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return { destination, mode, hasMarket: Boolean(report.market), hasFilings: Boolean(report.filings),
      views: report.views.length, connected: report.views.filter(view => view.data).length };
  } finally {
    try {
      await lock.close();
    } finally {
      await unlink(lockPath);
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      demo: { type: 'boolean' },
      live: { type: 'boolean' },
      output: { type: 'string' },
      csv: { type: 'string' },
      inputs: { type: 'string' },
      'stable-links': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: node self-hosted/build.mjs (--demo | --live) [--output DIR] [--csv PATH] [--inputs PATH] [--stable-links]');
    return;
  }
  if (Boolean(values.demo) === Boolean(values.live)) throw new Error('Choose --demo or --live.');
  const result = await buildWorkbench({ mode: values.demo ? 'demo' : 'live', output: values.output, csvPath: values.csv, inputPath: values.inputs, stableLinks: values['stable-links'] });
  console.log(`Built ${result.mode} workbench at ${result.destination} (${result.connected}/${result.views} views with connected inputs)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Workbench refresh failed. ${error.message}`);
    process.exitCode = 1;
  });
}
