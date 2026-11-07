import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';

const maxBytes = 3_000_000;
const sections = new Set([
  'market', 'marketCN', 'limits', 'themes', 'publications', 'news', 'earnings',
  'valuation', 'frontier', 'macroChina',
]);

export function httpsLink(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host.includes('.') || isIP(host) || /\.(?:localhost|local|internal|test)\.?$/i.test(host)) return null;
    const privateParameter = [...url.searchParams.keys()].some(key =>
      /^(?:token|key|secret|password|access[_-]?token|api[_-]?key|x-amz-.+)$/i.test(key));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !privateParameter ? url.href : null;
  } catch {
    return null;
  }
}

export function isoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function parseBundle(body, now) {
  let bundle;
  try {
    bundle = JSON.parse(body);
  } catch {
    throw new Error('Research input must be valid JSON.');
  }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) ||
      !isoDay(bundle.asOf) || bundle.asOf > now.toISOString().slice(0, 10) ||
      !bundle.sources || typeof bundle.sources !== 'object' || Array.isArray(bundle.sources)) {
    throw new Error('Research input requires an observation date and a sources object.');
  }
  for (const [section, value] of Object.entries(bundle)) {
    if (section === 'asOf' || section === 'sources') continue;
    if (!sections.has(section) || !httpsLink(bundle.sources[section])) {
      throw new Error('Every research input section requires a supported name and an HTTPS source link.');
    }
    const rows = section === 'market' || section === 'marketCN' ? value?.prices : value;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20_000) {
      throw new Error(`Provide between 1 and 20,000 observations in ${section}.`);
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !isoDay(row.date) || row.date > bundle.asOf) {
        throw new Error(`Research input has a missing or future observation date in ${section}.`);
      }
    }
  }
  return bundle;
}

export async function loadResearchBundle({ path, url, now, fetchImpl }) {
  if (!path && !url) return {};
  if (path && url) throw new Error('Choose one local file or one public research input URL.');
  let body;
  if (path) {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > maxBytes) throw new Error('Research input must be a regular file of at most 3 MB.');
    const handle = await readFile(path);
    if (handle.length > maxBytes) throw new Error('Research input exceeds 3 MB.');
    body = handle.toString('utf8');
  } else {
    const parsed = httpsLink(url) && new URL(url);
    if (!parsed || parsed.hostname !== 'raw.githubusercontent.com' || parsed.search || parsed.hash ||
        !/^\/[\w.-]+\/[\w.-]+\/[\w./-]+\.json$/.test(parsed.pathname)) {
      throw new Error('Use a public raw.githubusercontent.com JSON URL for scheduled research inputs.');
    }
    let response;
    try {
      response = await fetchImpl(parsed.href, {
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        headers: { accept: 'application/json, text/plain' },
      });
    } catch {
      throw new Error('The public research input could not be downloaded.');
    }
    if (!response.ok || !response.body) throw new Error('The public research input returned an unsuccessful response.');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error('Research input exceeds 3 MB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    body = Buffer.concat(chunks, bytes).toString('utf8');
  }
  return parseBundle(body, now);
}

export async function loadPublicResearch(now, fetchImpl) {
  const from = new Date(+now - 120 * 86_400_000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const url = new URL('https://api.crossref.org/works');
  url.search = new URLSearchParams({
    'query.bibliographic': 'semiconductor photonics energy storage materials',
    filter: `from-pub-date:${from},until-pub-date:${to},type:journal-article`,
    select: 'DOI,title,published',
    rows: '20',
  });
  let response;
  try {
    response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new Error('The Crossref public research request failed.');
  }
  if (!response.ok) throw new Error('The Crossref public research request returned an unsuccessful response.');
  const result = await response.json();
  if (!Array.isArray(result?.message?.items) || result.message.items.length > 20) {
    throw new Error('Crossref returned an unexpected publication list.');
  }
  const seen = new Set();
  const publications = [];
  for (const item of result.message.items) {
    const [year, month, day] = item?.published?.['date-parts']?.[0] ?? [];
    if (![year, month, day].every(Number.isInteger)) continue;
    const date = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
    const title = item?.title?.[0];
    const doi = item?.DOI;
    if (!isoDay(date) || date > to || date < from || typeof title !== 'string' || !title.trim() ||
        typeof doi !== 'string' || doi.length > 240 || !/^10\.\d{4,9}\/\S+$/.test(doi)) continue;
    if (seen.has(doi.toLowerCase())) continue;
    seen.add(doi.toLowerCase());
    const topic = /photon|optic/i.test(title) ? 'Photonics'
      : /batter|storage/i.test(title) ? 'Energy storage'
        : /semiconductor|transistor/i.test(title) ? 'Semiconductors' : 'Materials';
    publications.push({ date, title: title.trim().slice(0, 220), topic, url: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` });
  }
  if (!publications.length) throw new Error('Crossref provided no eligible dated publications.');
  return publications;
}
