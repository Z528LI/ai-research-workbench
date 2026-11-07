export const exampleLink = 'https://example.org/research/issuer-report.pdf';

export function text(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} must be nonempty text of at most ${max} characters`);
  return value.trim();
}

export function number(value, field, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${field} must be a finite number in range`);
  return value;
}

export function array(value, field, max = 500, min = 1) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${field} must contain ${min} to ${max} rows`);
  return value;
}

export function list(value, field, max = 100, min = 1) {
  return array(value, field, max, min).map(item => text(item, field));
}

export function date(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be a YYYY-MM-DD date`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`${field} must be a real calendar date`);
  return value;
}

export function https(value, field = 'url') {
  let url;
  try { url = new URL(text(value, field, 2000)); } catch { throw new Error(`${field} must be an HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) throw new Error(`${field} must be an HTTPS URL without credentials or a custom port`);
  return url.href;
}

export function unique(rows, key, field = 'identity') {
  const ids = new Set();
  for (const row of rows) {
    const id = key(row);
    if (ids.has(id)) throw new Error(`Duplicate ${field}`);
    ids.add(id);
  }
  return rows;
}

export function html(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function evidence(rows) {
  return unique(array(rows, 'sources', 100).map(row => ({ id: text(row?.id, 'source id', 80), title: text(row?.title, 'source title', 240), url: https(row?.url) })), row => row.id, 'source ID');
}

export function cited(value, sources) {
  const id = text(value, 'sourceId', 80);
  if (!sources.some(source => source.id === id)) throw new Error('Unknown source ID');
  return id;
}

export function byDate(a, b) {
  return a.date.localeCompare(b.date);
}

export function capability(inputs, example, run) {
  return { inputs, example, run };
}
