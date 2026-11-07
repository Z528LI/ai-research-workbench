import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { demoReport } from './lib/demo.mjs';
import { loadMarket, loadMarketCsv, summarizeMarket } from './lib/market.mjs';
import { loadPublicSources } from './lib/public-sources.mjs';
import { renderWorkbench } from './lib/render.mjs';

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

async function loadLiveReport({ now, env, csvPath, fetchImpl }) {
  const issuers = configuredIssuers(env);
  const key = env.APCA_API_KEY_ID;
  const secret = env.APCA_API_SECRET_KEY;
  if (!csvPath && Boolean(key) !== Boolean(secret)) {
    throw new Error('Set both Alpaca market data credentials or leave both unset.');
  }

  const inputs = await loadPublicSources({ now, secUserAgent: env.SEC_USER_AGENT, issuers, fetchImpl });
  const market = csvPath
    ? loadMarketCsv(await readPriceCsv(csvPath), { now, benchmark: env.WORKBENCH_BENCHMARK })
    : key
      ? await loadMarket({ now, key, secret, symbols: env.WORKBENCH_SYMBOLS, benchmark: env.WORKBENCH_BENCHMARK, fetchImpl })
      : null;

  return { mode: 'live', generatedAt: now.toISOString(), ...inputs, market: market ? summarizeMarket(market) : null };
}

async function protectExisting(destination, mode) {
  let previous;
  try {
    previous = await readFile(destination, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  if (!previous.includes(`${snapshotMarker} ${mode} -->`)) {
    throw new Error('The output already contains an index.html for another site or build mode. Choose a different output directory.');
  }
}

async function createSnapshot(report) {
  const css = await readFile(join(editionRoot, 'workbench.css'), 'utf8');
  const html = renderWorkbench(report);
  if (!html.startsWith('<!doctype html>') || html.split('<!-- WORKBENCH_STYLE -->').length !== 2 || /<\/style/i.test(css)) {
    throw new Error('The workbench page did not pass the rendering check.');
  }
  return html
    .replace('<!doctype html>', `<!doctype html>\n${snapshotMarker} ${report.mode} -->`)
    .replace('<!-- WORKBENCH_STYLE -->', () => `<style>\n${css}\n</style>`)
    .replace('<!-- WORKBENCH_SCRIPT -->', '');
}

export async function buildWorkbench({ mode, output, now = new Date(), env = process.env, csvPath, fetchImpl = fetch }) {
  if (!['demo', 'live'].includes(mode) || (mode === 'demo' && csvPath)) {
    throw new Error('Choose either demo mode or live mode. A CSV can only be used in live mode.');
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
    await protectExisting(destination, mode);
    const report = mode === 'demo' ? demoReport(now) : await loadLiveReport({ now, env, csvPath, fetchImpl });
    const html = await createSnapshot(report);
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
    return { destination, mode, hasMarket: Boolean(report.market), hasFilings: Boolean(report.filings) };
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
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: node self-hosted/build.mjs (--demo | --live) [--output DIR] [--csv PATH]');
    return;
  }
  if (Boolean(values.demo) === Boolean(values.live)) throw new Error('Choose --demo or --live.');
  const result = await buildWorkbench({ mode: values.demo ? 'demo' : 'live', output: values.output, csvPath: values.csv });
  console.log(`Built ${result.mode} workbench at ${result.destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Workbench refresh failed. ${error.message}`);
    process.exitCode = 1;
  });
}
