export function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function record(value, field = 'input') {
  check(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object.`);
  return value;
}

export function list(value, field, minimum = 1, maximum = 20000) {
  check(Array.isArray(value) && value.length >= minimum && value.length <= maximum,
    `${field} must contain ${minimum} to ${maximum} items.`);
  return value;
}

export function rows(value, field, minimum, maximum) {
  return list(value, field, minimum, maximum).map(row => record(row, field));
}

export function number(value, field, min = -1e12, max = 1e12) {
  check(Number.isFinite(value) && value >= min && value <= max, `${field} must be a number between ${min} and ${max}.`);
  return value;
}

export function integer(value, field, min = 0, max = 20000) {
  check(Number.isInteger(value), `${field} must be an integer.`);
  return number(value, field, min, max);
}

export function text(value, field) {
  check(typeof value === 'string' && value.trim() && value.length <= 400 && !/[\u0000-\u001f\u007f]/.test(value),
    `${field} must be nonempty text of at most 400 characters.`);
  return value.trim();
}

export function symbol(value) {
  const ticker = text(value, 'symbol').toUpperCase();
  check(/^[A-Z0-9^][A-Z0-9.^_:/=+\-]{0,23}$/.test(ticker), 'symbol must be a valid ticker.');
  return ticker;
}

export function date(value, field = 'date') {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${field} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  check(Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value, `${field} must be a valid calendar date.`);
  return value;
}

export function flag(value, field) {
  check(typeof value === 'boolean', `${field} must be true or false.`);
  return value;
}

export function choice(value, field, allowed) {
  check(allowed.includes(value), `${field} must be one of ${allowed.join(', ')}.`);
  return value;
}

export function link(value, field = 'url') {
  const raw = text(value, field);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${field} must be an HTTPS link.`); }
  check(url.protocol === 'https:' && !url.username && !url.password, `${field} must be an HTTPS link without credentials.`);
  return raw;
}

export function sources(value = []) {
  return rows(value, 'evidence', 0, 100).map(row => ({ title: text(row.title, 'title'), url: link(row.url) }));
}

export function unique(items, key, field) {
  check(new Set(items.map(key)).size === items.length, `${field} contains duplicates.`);
  return items;
}

export function group(items, key) {
  const groups = new Map();
  for (const row of items) {
    const name = key(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

export function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function sd(values) {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export const byDate = (a, b) => a.date.localeCompare(b.date);
export const daysBetween = (first, last) => (Date.parse(last) - Date.parse(first)) / 86400000;
export const positive = (value, field) => number(value, field, 1e-12, 1e12);
export const key = (...parts) => JSON.stringify(parts);

export function prices(value, field = 'prices') {
  const points = rows(value, field).map(row => ({ date: date(row.date), symbol: symbol(row.symbol), close: positive(row.close, 'close') }));
  return unique(points, row => key(row.symbol, row.date), field).sort(byDate);
}

export function capability(inputs, example, calculate) {
  return { inputs, example, run: input => calculate(record(input)) };
}
