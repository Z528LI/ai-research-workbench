import { httpsLink } from './inputs.mjs';

const SETUP = 'https://github.com/Z528LI/ai-research-workbench/blob/main/self-hosted/README.md';
const MARKET_LAB = 'https://z528li.github.io/ai-research-workbench/';
const SEC_HOSTS = new Set(['sec.gov', 'www.sec.gov', 'data.sec.gov']);
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const INTEGER = new Intl.NumberFormat('en-US');
const MATURITIES = [
  { key: 'month3', label: '3 months' },
  { key: 'year2', label: '2 years' },
  { key: 'year10', label: '10 years' },
  { key: 'year30', label: '30 years' },
];
const VIEWS = [
  ['treasury', '01', 'Treasury Curve'],
  ['macro', '02', 'Macro Pulse'],
  ['breadth', '03', 'Market Breadth'],
  ['relative-risk', '04', 'Relative Risk'],
  ['technical-screen', '05', 'Technical Screen'],
  ['company-filings', '06', 'Company Filings'],
  ['earnings-filings', '07', 'Earnings Filings'],
];

function escape(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
}

function dateLabel(date, format = DATE) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(date)) return '—';
  const value = new Date(date.length === 7 ? date + '-01' : date);
  if (!Number.isFinite(value.valueOf()) || !value.toISOString().startsWith(date)) return '—';
  return format.format(value);
}

function sourceLabel(source, fallback) {
  const label = typeof source === 'string' ? source : source?.label ?? source?.name;
  return label && !/^https?:\/\//i.test(label) ? label : fallback;
}

function number(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  const rounded = value.toFixed(digits);
  return Number(rounded) === 0 ? (0).toFixed(digits) : rounded.replace(/^-/, '−');
}

function percent(value, digits = 1) {
  return Number.isFinite(value) ? number(value, digits) + '%' : '—';
}

function signed(value, suffix) {
  return Number.isFinite(value) ? (value >= 0.05 ? '+' : '') + number(value) + suffix : '—';
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? INTEGER.format(value) : '—';
}

function ratio(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0 || numerator > denominator) return null;
  return numerator / denominator * 100;
}

function latest(rows) {
  return rows.at(-1);
}

function ordered(rows) {
  return [...(rows ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

function recentMonths(rows) {
  if (!rows.length) return [];
  const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const byMonth = new Map(rows.map(({ date, value }) => [monthIndex(date), value]));
  const end = monthIndex(latest(rows).date);
  const start = Math.max(monthIndex(rows[0].date), end - 23);
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const month = start + index;
    const date = `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`;
    return { date, value: byMonth.get(month) };
  });
}

function stat(label, value, context = '') {
  return `<div class="stat"><dt>${escape(label)}</dt><dd>${escape(value)}</dd>${context ? `<dd class="stat-note">${escape(context)}</dd>` : ''}</div>`;
}

function details(title, html) {
  return `<details class="detail"><summary>${escape(title)}</summary>${html}</details>`;
}

function table(label, headings, rows) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(label)}">
    <table aria-label="${escape(label)}">
      <thead><tr>${headings.map((heading) => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((cells) => `<tr><th scope="row">${cells[0]}</th>${cells.slice(1).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function lineChart({ id, label, points, format, caption, color = 'teal' }) {
  const valid = points.filter((point) => Number.isFinite(point.value));
  if (!valid.length) return '';
  const width = 600;
  const height = 208;
  const left = 70;
  const right = 25;
  const top = 16;
  const bottom = 37;
  const dataMin = Math.min(...valid.map((point) => point.value));
  const dataMax = Math.max(...valid.map((point) => point.value));
  const padding = (dataMax - dataMin) * 0.16 || Math.max(Math.abs(dataMax) * 0.025, 0.1);
  const min = dataMin - padding;
  const max = dataMax + padding;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (index) => left + (points.length === 1 ? chartWidth / 2 : chartWidth * index / (points.length - 1));
  const y = (value) => top + chartHeight * (max - value) / (max - min);
  const grid = [0, 1, 2, 3].map((index) => {
    const value = max - (max - min) * index / 3;
    return `<line class="grid-line" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 11}" y="${y(value) + 5}" text-anchor="end">${escape(format(value))}</text>`;
  }).join('');
  const coordinates = points.map((point, index) => Number.isFinite(point.value) ? [x(index), y(point.value)] : null);
  const path = coordinates.map((point, index) => point ? `${coordinates[index - 1] ? 'L' : 'M'}${point[0]},${point[1]}` : '').join(' ');
  const marks = coordinates.map((point, index) => point
    ? `<circle cx="${point[0]}" cy="${point[1]}" r="${points.length <= 8 || index === points.length - 1 ? 5 : 2.5}"><title>${escape(points[index].label)}: ${escape(format(points[index].value))}</title></circle>`
    : '').join('');
  const tickIndexes = points.length <= 4 ? points.map((_, index) => index) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const ticks = tickIndexes.map((index) => {
    const alignment = index === 0 && points.length > 1 ? 'start' : index === points.length - 1 && points.length > 1 ? 'end' : 'middle';
    return `<text x="${x(index)}" y="${height - 13}" text-anchor="${alignment}">${escape(points[index].label)}</text>`;
  }).join('');
  return `<figure class="chart chart-${color}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-label">
      <title id="${id}-label">${escape(label)}</title>
      ${grid}<path class="plot-line" d="${path}"/>${marks}${ticks}
    </svg>
    <figcaption>${escape(caption)}</figcaption>
  </figure>`;
}

function meter(label, numerator, denominator) {
  const value = ratio(numerator, denominator);
  return `<div class="meter">
    <div class="meter-line"><span>${escape(label)}</span><strong>${escape(percent(value))}</strong></div>
    ${value === null ? '' : `<progress aria-label="${escape(label)}" max="100" value="${value}"></progress>`}
    <div class="fine">${escape(count(numerator))} of ${escape(count(denominator))} eligible symbols</div>
  </div>`;
}

function unavailable(label) {
  return `<div class="empty"><p>${escape(label)}</p><a href="${SETUP}">View setup instructions <span aria-hidden="true">↗</span></a></div>`;
}

function panel(view, lead, body, provenance) {
  const [id, index, title] = view;
  return `<section class="panel" id="${id}" aria-labelledby="${id}-title">
    <div class="panel-header"><span class="panel-index" aria-hidden="true">${index}</span><div>
      <h2 id="${id}-title">${title}</h2><p>${escape(lead)}</p>
    </div></div>
    <div class="panel-content">${body}</div>
    ${provenance ? `<div class="provenance">${escape(provenance)}</div>` : ''}
  </section>`;
}

function renderTreasury(treasury, demo) {
  const rows = ordered(treasury?.observations);
  const current = latest(rows);
  if (!current) return panel(VIEWS[0], 'U.S. government yields across four maturities.', '<p class="fine">This snapshot contains no Treasury observations.</p>');
  const spread = Number.isFinite(current.year10) && Number.isFinite(current.year2) ? (current.year10 - current.year2) * 100 : null;
  const curve = lineChart({
    id: 'curve-chart',
    label: 'Treasury yield curve across four maturities',
    points: MATURITIES.map(({ key, label }) => ({ label, value: current[key] })),
    format: (value) => percent(value, 2),
    caption: 'Constant-maturity yields for ' + dateLabel(current.date) + '. Maturities are equally spaced.',
  });
  const recentYields = lineChart({
    id: 'yield-history-chart',
    label: 'Recent daily 10-year Treasury yields',
    points: rows.slice(-24).map((row) => ({ label: dateLabel(row.date, SHORT_DATE), value: row.year10 })),
    format: (value) => percent(value, 2),
    caption: '10-year yield across recent observations.',
    color: 'blue',
  });
  const historicalRows = rows.slice(-12).reverse().map((row) => [dateLabel(row.date), ...MATURITIES.map(({ key }) => percent(row[key], 2))].map(escape));
  return panel(VIEWS[0], 'U.S. government yields across four maturities.', `
    <dl class="stats">
      ${stat('2-year yield', percent(current.year2, 2))}
      ${stat('10-year yield', percent(current.year10, 2))}
      ${stat('10-year minus 2-year', signed(spread, ' bp'))}
    </dl>
    <div class="series-grid">${curve}${recentYields}</div>
    ${details('Recent daily observations', table('Recent Treasury yields', ['Observation date', '3 months', '2 years', '10 years', '30 years'], historicalRows))}
  `, sourceLabel(treasury.source, demo ? 'Example Treasury series' : 'Federal Reserve H.15 via FRED') + ' · ' + dateLabel(current.date));
}

function macroSeries(id, title, rows, format, unit, color) {
  const current = latest(rows);
  const recent = recentMonths(rows);
  const chart = lineChart({
    id,
    label: title + ' over the latest reported months',
    points: recent.map(({ date, value }) => ({ label: dateLabel(date, MONTH), value })),
    format,
    caption: unit,
    color,
  });
  const history = table(title + ' monthly observations', ['Observation month', 'Value'], recent.slice().reverse().map((row) => [dateLabel(row.date, MONTH), format(row.value)].map(escape)));
  return `<div class="series">
    <h3>${title}</h3><div class="series-value">${escape(format(current?.value))}</div>
    <p class="fine">${current ? escape(dateLabel(current.date, MONTH)) : 'No observation in this snapshot'}</p>
    ${chart}${recent.length ? details('Monthly observations', history) : ''}
  </div>`;
}

function renderMacro(labor, demo) {
  const unemployment = ordered(labor?.unemployment);
  const cpi = ordered(labor?.cpi);
  return panel(VIEWS[1], 'U.S. unemployment and consumer prices, with separate observation months.', `<div class="series-grid">
    ${macroSeries('unemployment-chart', 'Unemployment rate', unemployment, percent, 'Percent of the civilian labor force.', 'teal')}
    ${macroSeries('cpi-chart', 'Consumer price index', cpi, number, 'CPI-U index level (1982–84 = 100).', 'blue')}
  </div>`, sourceLabel(labor?.source, demo ? 'Example labor series' : 'U.S. Bureau of Labor Statistics') + ' · Monthly observations');
}

function marketProvenance(market, demo) {
  return sourceLabel(market.source, demo ? 'Example market observations' : 'Market observations') + ' · ' + dateLabel(market.asOf);
}

function renderBreadth(market, demo) {
  const lead = 'Participation across the selected stock universe.';
  if (!market) return panel(VIEWS[2], lead, unavailable('Connect a market source to measure how widely gains are shared.'));
  const breadth = market.breadth;
  return panel(VIEWS[2], lead, `
    <dl class="stats two">
      ${stat('Universe', count(market.universeSize), 'Excludes the benchmark')}
      ${stat('Sessions', count(market.sessions), dateLabel(market.firstSession) + ' to ' + dateLabel(market.asOf))}
    </dl>
    <div class="meter-grid">
      ${meter('Advancing stocks', breadth.advancing, breadth.dailyEligible)}
      ${meter('Above 20-session average', breadth.aboveAverage, breadth.averageEligible)}
    </div>
    <p class="fine">Daily change compares the sessions ending ${escape(dateLabel(breadth.previousSession))} and ${escape(dateLabel(market.asOf))}. Each measure uses its own eligible universe.</p>
  `, marketProvenance(market, demo));
}

function renderRelative(market, demo) {
  const lead = 'Benchmark sensitivity and matched stock returns.';
  if (!market) return panel(VIEWS[3], lead, unavailable('Connect a market source to compare stocks with a benchmark.'));
  const relative = market.relative;
  const covered = relative.rows.filter((row) => Number.isFinite(row.excess)).length;
  const rows = relative.rows.map((row) => [
    row.symbol,
    Number.isFinite(row.return) ? percent(row.return * 100) : '—',
    Number.isFinite(row.benchmarkReturn) ? percent(row.benchmarkReturn * 100) : '—',
    signed(Number.isFinite(row.excess) ? row.excess * 100 : null, ' pp'),
    number(row.beta, 2),
    count(row.betaPairs),
  ].map(escape));
  return panel(VIEWS[3], lead, `
    <dl class="stats">
      ${stat('Benchmark', market.benchmark)}
      ${stat('Return window', count(relative.windowSessions) + ' sessions')}
      ${stat('Matched stocks', count(covered) + ' / ' + count(market.universeSize))}
    </dl>
    <p class="fine">Return window: ${escape(dateLabel(relative.start))} to ${escape(dateLabel(relative.end))}. Beta uses paired daily returns over up to ${escape(count(relative.betaWindowSessions))} sessions. A dash marks insufficient history.</p>
    ${rows.length ? table('Matched returns and benchmark sensitivity', ['Symbol', 'Stock return', 'Benchmark return', 'Excess return', 'Beta', 'Beta pairs'], rows) : ''}
  `, marketProvenance(market, demo));
}

function flag(value) {
  if (value === true) return '<span class="flag up">Above</span>';
  if (value === false) return '<span class="flag neutral">At or below</span>';
  return '<span class="fine" aria-label="Insufficient history">—</span>';
}

function renderTechnical(market, demo) {
  const lead = 'Price relative to each stock’s 20- and 50-session moving averages.';
  if (!market) return panel(VIEWS[4], lead, unavailable('Connect a market source to compare stocks with their moving averages.'));
  const rows = market.technical.rows;
  const qualifies = (row, key) => row[key] === true || row[key] === false;
  return panel(VIEWS[4], lead, `
    <div class="meter-grid">
      ${meter('Above 20-session average', rows.filter((row) => row.above20 === true).length, rows.filter((row) => qualifies(row, 'above20')).length)}
      ${meter('Above 50-session average', rows.filter((row) => row.above50 === true).length, rows.filter((row) => qualifies(row, 'above50')).length)}
    </div>
    ${rows.length ? table('Technical screen by stock', ['Symbol', '20 sessions', '50 sessions'], rows.map((row) => [escape(row.symbol), flag(row.above20), flag(row.above50)])) : ''}
  `, marketProvenance(market, demo));
}

function filingLink(value) {
  try {
    const url = new URL(value);
    const filingPath = /^\/Archives\/edgar\/data\/\d+\/\d{18}(?:\/[a-z0-9_][a-z0-9._-]*)+$/i;
    return url.protocol === 'https:' && SEC_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port &&
      !url.search && !url.hash && filingPath.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

export function isEarnings(filing) {
  const form = String(filing.form).toUpperCase().replace(/\/A$/, '');
  if (form === '10-Q' || form === '10-K') return true;
  const items = Array.isArray(filing.items) ? filing.items : String(filing.items ?? '').split(/[\s,;]+/);
  return form === '8-K' && items.some((item) => String(item).trim() === '2.02');
}

function filingRows(issuers, filter) {
  return issuers.flatMap((issuer) => issuer.filings.filter(filter).map((filing) => ({ issuer, filing })))
    .sort((a, b) => String(b.filing.filed).localeCompare(String(a.filing.filed)));
}

function renderFilings(filings, demo, earnings = false) {
  const view = VIEWS[earnings ? 6 : 5];
  const lead = earnings ? 'Quarterly and annual reports, plus 8-K filings with earnings disclosures.' : 'SEC submissions for the issuers selected for this snapshot.';
  if (!filings) return panel(view, lead, unavailable('Configure SEC issuers to include company filings.'));
  const entries = filingRows(filings.issuers, earnings ? isEarnings : () => true);
  const issuerNames = filings.issuers.map((issuer) => issuer.name || issuer.symbol || issuer.cik).join(', ');
  const rows = entries.map(({ issuer, filing }) => {
    const url = demo ? null : filingLink(filing.url);
    const items = Array.isArray(filing.items) ? filing.items.join(', ') : filing.items;
    return [
      escape(issuer.symbol || issuer.name || issuer.cik),
      escape(filing.form),
      escape(dateLabel(filing.filed)),
      escape(dateLabel(filing.period)),
      escape(items || '—'),
      url ? `<a href="${escape(url)}">Open filing<span class="sr-only"> ${escape(filing.accession)}</span></a>` : escape(filing.accession || '—'),
    ];
  });
  return panel(view, lead, `
    <dl class="stats two">
      ${stat('Selected issuers', count(filings.issuers.length), issuerNames)}
      ${stat(earnings ? 'Earnings-related filings' : 'Filings in snapshot', count(rows.length))}
    </dl>
    ${rows.length
      ? table(view[2], ['Issuer', 'Form', 'Filed', 'Report period', 'Items', 'Filing reference'], rows)
      : '<p class="fine">No matching filings in this snapshot.</p>'}
  `, sourceLabel(filings.source, demo ? 'Example filing records' : 'SEC EDGAR') + (entries.length ? ' · Latest filing ' + dateLabel(entries[0].filing.filed) : ''));
}

function shell({ title, lead, eyebrow, date, dateTitle, home, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A self-hosted workbench for market, macro and company research.">
  <title>${escape(title)} | Source-to-Trade</title>
  <!-- WORKBENCH_STYLE -->
</head>
<body>
  <a class="skip" href="#views">Skip to content</a>
  <header class="hero">
    <div class="wrap">
      <div class="masthead">
        <a class="brand" href="${escape(home)}"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>Source-to-Trade</a>
        <div class="header-links"><a href="${MARKET_LAB}">Market Lab</a><a href="${SETUP}">Setup guide</a></div>
      </div>
      <div class="hero-content" id="top">
        <div><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1><p class="hero-lead">${escape(lead)}</p></div>
        ${date ? `<div class="build-date"><span>${escape(dateTitle)}</span><strong><time datetime="${escape(date)}">${escape(dateLabel(date.slice(0, 10)))}</time></strong></div>` : ''}
      </div>
    </div>
  </header>
  <main class="wrap" id="views">${body}</main>
  <footer class="wrap footer"><span>Source-to-Trade Research Workbench</span><a href="${escape(home)}">Research views ↑</a></footer>
</body>
</html>
`;
}

const legacyAnchors = {
  macro: 'treasury', regime: 'breadth', beta: 'relative-risk', daily5: 'technical-screen',
  news: 'company-filings', earnings: 'earnings-filings',
};

const demoBanner = '<aside class="demo"><strong>Synthetic example data</strong><span>Illustrative observations across 15 research views.</span></aside>';

export function renderWorkbench(report, snapshot) {
  const demo = report.mode === 'demo';
  const groups = [...new Set(report.views.map(view => view.group))];
  const body = `${demo ? demoBanner : ''}
  ${groups.map((group, index) => `
  <nav class="view-nav" aria-labelledby="group-${index}">
    <h2 id="group-${index}">${escape(group)}</h2>
    <ul>${report.views.filter(view => view.group === group).map(view => `
      <li id="${view.id}">${legacyAnchors[view.id] ? `<span id="${legacyAnchors[view.id]}" class="sr-only"></span>` : ''}
        <a href="reports/${snapshot}/${view.id}/index.html">
          <span class="nav-title">${escape(view.title)}</span>
          <span class="nav-description">${escape(view.description)}</span>
          <span class="nav-state">${view.data ? (view.data.usable === false ? 'More history needed' : view.data.asOf ? escape(dateLabel(view.data.asOf)) : 'Source connected') : 'Connect a source'}</span>
        </a>
      </li>`).join('')}
    </ul>
  </nav>`).join('')}`;
  return shell({
    title: 'Research Workbench', lead: 'Fifteen research views for market conditions, security selection and company evidence.',
    eyebrow: demo ? 'Self-hosted example' : 'Self-hosted research', date: report.generatedAt,
    dateTitle: 'Snapshot generated (UTC)', home: '#top', body,
  });
}

function tableCell(cell) {
  if (cell && typeof cell === 'object') {
    const url = httpsLink(cell.url);
    return url ? `<a href="${escape(url)}">${escape(cell.text)}</a>` : escape(cell.text);
  }
  return escape(cell ?? '—');
}

export function renderResearchPage(report, view) {
  const demo = report.mode === 'demo';
  const content = view.data;
  const parts = {
    treasury: () => renderTreasury(report.treasury, demo),
    macro: () => renderMacro(report.labor, demo),
    breadth: () => renderBreadth(report.market, demo),
    relative: () => renderRelative(report.market, demo),
    technical: () => renderTechnical(report.market, demo),
    filings: () => renderFilings(report.filings, demo),
    earnings: () => renderFilings(report.filings, demo, true),
  };
  const sources = demo ? [] : [...new Set((content?.sources ?? []).map(httpsLink).filter(Boolean))];
  const sourceLinks = sources.map((url, index) =>
    `<a href="${escape(url)}">Data reference ${index + 1}</a>`).join(' · ');
  const body = `${demo ? demoBanner : ''}
  <p class="view-back"><a href="../../../index.html">← All research views</a></p>
  <div class="panels">
    ${content ? `
      ${content.panels.map(id => parts[id]()).join('')}
      ${content.tables.map(({ title, columns, rows }) => `
      <section class="panel">
        <header class="panel-header"><h2>${escape(title)}</h2></header>
        <div class="panel-content">${rows.length ? table(title, columns, rows.map(row => row.map(tableCell)))
          : '<p class="fine">No eligible records in this observation window.</p>'}</div>
      </section>`).join('')}
      ${sourceLinks ? `<p class="fine">${sourceLinks}</p>` : ''}
    ` : `
      <section class="panel">
        <header class="panel-header"><h2>Connect a data source</h2></header>
        <div class="panel-content"><p>This view accepts ${escape(view.input)}.</p><p><a href="${SETUP}">Set up your research inputs</a></p></div>
      </section>`}
  </div>`;
  return shell({
    title: view.title, lead: view.description, eyebrow: view.group,
    date: content?.asOf, dateTitle: 'Latest observation', home: '../../../index.html', body,
  });
}
