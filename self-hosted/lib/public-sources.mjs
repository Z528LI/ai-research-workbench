const TREASURY_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS3MO,DGS2,DGS10,DGS30';
const BLS_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const SEC_URL = 'https://data.sec.gov/submissions/';
const UNEMPLOYMENT = 'LNS14000000';
const CPI_U = 'CUUR0000SA0';
const MS_PER_DAY = 86_400_000;
const MAX_ISSUERS = 5;
const MAX_FILINGS = 8;
const FILINGS_FORM = /^(?:10-K|10-Q|8-K|20-F|40-F|6-K)(?:\/A)?$/;
const EASTERN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

function requireValid(valid, message) {
  if (!valid) throw new Error(message);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function datedAscending(a, b) {
  return a.date.localeCompare(b.date);
}

function numberInRange(raw, min, max, label) {
  const value = typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  requireValid(Number.isFinite(value) && value >= min && value <= max, `${label} contains an invalid value`);
  return value;
}

function checkLatest(rows, today, days, label) {
  const latest = rows.at(-1);
  requireValid(latest && Date.parse(today) - Date.parse(latest.date) <= days * MS_PER_DAY,
    `${label} has no sufficiently recent observations`);
}

async function readBody(response, maxBytes, label) {
  const length = response.headers.get('content-length');
  requireValid(length === null || (/^\d+$/.test(length) && Number(length) <= maxBytes), `${label} response exceeds the size limit`);
  requireValid(response.body, `${label} response is empty`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  let done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      if (done) break;
      size += chunk.value.byteLength;
      requireValid(size <= maxBytes, `${label} response exceeds the size limit`);
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function request(fetchImpl, url, label, contentTypes, maxBytes, init) {
  const signal = AbortSignal.timeout(12_000);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal, redirect: 'error' });
  } catch {
    throw new Error(`${label} request failed or timed out`);
  }
  try {
    requireValid(response.ok, `${label} returned HTTP ${response.status}`);
    requireValid(!response.redirected && (!response.url || response.url === url), `${label} returned an unexpected URL`);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    requireValid(contentTypes.includes(contentType), `${label} returned an unexpected content type`);
    return await readBody(response, maxBytes, label);
  } catch (error) {
    if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
    if (error?.message?.startsWith(`${label} `)) throw error;
    throw new Error(`${label} response could not be read`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function loadTreasury(fetchImpl, today) {
  const label = 'Treasury yields';
  const body = await request(fetchImpl, TREASURY_URL, label, ['application/csv', 'text/csv'], 768 * 1024);
  const [header, ...lines] = body.trimEnd().split(/\r?\n/);
  requireValid(header === 'observation_date,DGS3MO,DGS2,DGS10,DGS30', `${label} returned unexpected series`);
  const cutoff = new Date(Date.parse(today) - 90 * MS_PER_DAY).toISOString().slice(0, 10);
  const dates = new Set();
  const observations = [];
  for (const line of lines) {
    const [date, ...rates] = line.split(',');
    requireValid(isDate(date) && date <= today && rates.length === 4 && !dates.has(date), `${label} contains an invalid or duplicate date row`);
    dates.add(date);
    if (date < cutoff) continue;
    // FRED's empty cells and dots indicate unavailable observations, including market holidays.
    const values = rates.map(rate => rate === '' || rate === '.' ? null : numberInRange(rate, -10, 100, label));
    if (values.includes(null)) continue;
    const [month3, year2, year10, year30] = values;
    observations.push({ date, month3, year2, year10, year30 });
  }
  observations.sort(datedAscending);
  checkLatest(observations, today, 7, label);
  return { source: TREASURY_URL, observations };
}

function laborObservations(data, today, startYear, seriesId) {
  const label = seriesId === UNEMPLOYMENT ? 'BLS unemployment' : 'BLS CPI-U';
  const firstMonth = `${today.slice(0, 7)}-01`;
  requireValid(Array.isArray(data) && data.length <= 39, `${label} returned unexpected observations`);
  const dates = new Set();
  const rows = [];
  for (const entry of data) {
    requireValid(typeof entry?.year === 'string' && /^\d{4}$/.test(entry.year) && Number(entry.year) >= startYear && entry.year <= today.slice(0, 4),
      `${label} contains an invalid year`);
    if (entry.period === 'M13') continue;
    requireValid(typeof entry.period === 'string' && /^M(?:0[1-9]|1[0-2])$/.test(entry.period), `${label} contains an invalid month`);
    const date = `${entry.year}-${entry.period.slice(1)}-01`;
    requireValid(date < firstMonth && !dates.has(date), `${label} contains a future or duplicate month`);
    dates.add(date);
    // BLS publishes '-' with an explanatory footnote for some unavailable months.
    if (entry.value === '-' && Array.isArray(entry.footnotes) && entry.footnotes.some(note => typeof note?.text === 'string' && note.text.trim())) continue;
    const value = seriesId === UNEMPLOYMENT
      ? numberInRange(entry.value, 0, 100, label)
      : numberInRange(entry.value, Number.MIN_VALUE, 10_000, label);
    rows.push({ date, value });
  }
  rows.sort(datedAscending);
  checkLatest(rows, today, seriesId === UNEMPLOYMENT ? 65 : 80, label);
  return rows;
}

async function loadLabor(fetchImpl, today) {
  const endYear = Number(today.slice(0, 4));
  const startYear = endYear - 2;
  const label = 'BLS';
  const body = await request(fetchImpl, BLS_URL, label, ['application/json'], 96 * 1024, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ seriesid: [UNEMPLOYMENT, CPI_U], startyear: String(startYear), endyear: String(endYear) }),
  });
  const data = parseJson(body, label);
  const series = data?.Results?.series;
  requireValid(data?.status === 'REQUEST_SUCCEEDED' && Array.isArray(series) && series.length === 2,
    'BLS did not return both requested series');
  const unemployment = series.find(row => row?.seriesID === UNEMPLOYMENT);
  const cpi = series.find(row => row?.seriesID === CPI_U);
  requireValid(unemployment && cpi, 'BLS returned unexpected series identities');
  return {
    source: BLS_URL,
    unemployment: laborObservations(unemployment.data, today, startYear, UNEMPLOYMENT),
    cpi: laborObservations(cpi.data, today, startYear, CPI_U),
  };
}

function validateIssuers(issuers, secUserAgent) {
  requireValid(Array.isArray(issuers) && issuers.length <= MAX_ISSUERS, `Configure no more than ${MAX_ISSUERS} SEC issuers`);
  if (!issuers.length) return [];
  requireValid(typeof secUserAgent === 'string' && secUserAgent.length <= 160 && /^[\x20-\x7e]+$/.test(secUserAgent)
    && /^\S.*\s[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secUserAgent), 'Set SEC_USER_AGENT to a declared name and contact email');
  const ciks = new Set();
  const symbols = new Set();
  return issuers.map(issuer => {
    const cikInput = typeof issuer?.cik === 'number' && Number.isSafeInteger(issuer.cik) ? String(issuer.cik) : issuer?.cik;
    requireValid(typeof cikInput === 'string' && /^\d{1,10}$/.test(cikInput) && Number(cikInput) > 0, 'Invalid SEC CIK');
    requireValid(typeof issuer.symbol === 'string' && /^[A-Za-z][A-Za-z0-9.-]{0,15}$/.test(issuer.symbol), 'Invalid SEC symbol');
    const cik = cikInput.padStart(10, '0');
    const symbol = issuer.symbol.toUpperCase();
    requireValid(!ciks.has(cik) && !symbols.has(symbol), 'Duplicate SEC issuer identity');
    ciks.add(cik);
    symbols.add(symbol);
    return { cik, symbol };
  });
}

function safeDocument(path) {
  return typeof path === 'string' && path.length <= 240 && path.split('/').every(segment => /^[a-z0-9_][a-z0-9._-]*$/i.test(segment));
}

async function loadIssuer(fetchImpl, today, secUserAgent, issuer) {
  const { cik, symbol } = issuer;
  const label = 'SEC filings';
  const body = await request(fetchImpl, `${SEC_URL}CIK${cik}.json`, label, ['application/json'], 2 * 1024 * 1024,
    { headers: { 'user-agent': secUserAgent, accept: 'application/json' } });
  const data = parseJson(body, label);
  requireValid(String(data?.cik).padStart(10, '0') === cik && Array.isArray(data?.tickers) && data.tickers.includes(symbol),
    'SEC returned an unexpected issuer identity');
  const name = data.name;
  requireValid(typeof name === 'string' && name.trim() && name.length <= 240 && !/[\x00-\x1f\x7f]/.test(name), 'SEC returned an invalid issuer name');
  const recent = data.filings?.recent;
  const fields = ['accessionNumber', 'filingDate', 'reportDate', 'form', 'primaryDocument', 'items'];
  const count = recent?.form?.length;
  requireValid(Number.isInteger(count) && count <= 10_000 && fields.every(field => Array.isArray(recent[field]) && recent[field].length === count),
    'SEC returned inconsistent filing arrays');
  const filings = [];
  const accessions = new Set();
  for (let i = 0; i < count; i++) {
    const form = recent.form[i];
    requireValid(typeof form === 'string', 'SEC returned an invalid form');
    if (!FILINGS_FORM.test(form)) continue;
    const filed = recent.filingDate[i];
    const period = recent.reportDate[i];
    const accession = recent.accessionNumber[i];
    const document = recent.primaryDocument[i];
    const itemText = recent.items[i];
    requireValid(isDate(filed) && filed <= today && (period === '' || isDate(period)), 'SEC returned an invalid filing date');
    requireValid(typeof accession === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(accession) && !accessions.has(accession),
      'SEC returned an invalid or duplicate accession');
    requireValid(safeDocument(document), 'SEC returned an unsafe filing document path');
    requireValid(typeof itemText === 'string' && itemText.length <= 200, 'SEC returned invalid filing items');
    const items = itemText ? itemText.split(',').map(item => item.trim()) : [];
    requireValid(items.every(item => /^\d{1,2}(?:\.\d{2})?$/.test(item)), 'SEC returned invalid filing items');
    accessions.add(accession);
    // Some reports omit the reference period. Keep the output limited to dated reports.
    if (!period) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${document}`;
    filings.push({ form, filed, period, accession, url, items });
  }
  filings.sort((a, b) => b.filed.localeCompare(a.filed) || b.accession.localeCompare(a.accession));
  return { name, symbol, cik, filings: filings.slice(0, MAX_FILINGS) };
}

export async function loadPublicSources({ now = new Date(), secUserAgent, issuers = [], fetchImpl = fetch } = {}) {
  requireValid(now instanceof Date && Number.isFinite(now.getTime()), 'Invalid refresh clock');
  const today = EASTERN_DAY.format(now);
  requireValid(isDate(today), 'Could not determine the U.S. observation date');
  const configured = validateIssuers(issuers, secUserAgent);
  const [treasury, labor, ...filingIssuers] = await Promise.all([
    loadTreasury(fetchImpl, today),
    loadLabor(fetchImpl, today),
    ...configured.map(issuer => loadIssuer(fetchImpl, today, secUserAgent, issuer)),
  ]);
  return { treasury, labor, filings: configured.length ? { source: SEC_URL, issuers: filingIssuers } : null };
}
