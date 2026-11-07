import analysis from '../../market-analysis.js';

import { runCapability } from './capabilities.mjs';
import { httpsLink, isoDay } from './inputs.mjs';
import { summarizeMarket } from './market.mjs';
import { isEarnings } from './render.mjs';

export const pageCatalog = [
  ['macro', 'Market Environment', 'US and China Macro', 'Track rates, labor and prices by observation date.', 'FRED, BLS and optional China macro observations'],
  ['regime', 'Market Environment', 'Market Regime', 'Measure directional participation and changes in market breadth.', 'Completed daily closes'],
  ['us-rebound', 'Market Environment', 'US Equity Rotation', 'Compare market leadership with a common benchmark.', 'US daily closes'],
  ['limit-history', 'Market Environment', 'Limit-Up and Hotspot History', 'Review the daily history of limit-up closes and failed tests.', 'A-share bars with official security-level price limits'],
  ['rebound', 'Market Environment', 'A-Share Market Structure', 'Compare recent trends across the configured A-share universe.', 'A-share daily closes'],
  ['precrash', 'Market Environment', 'Market Stress Indicators', 'Monitor recent losses, drawdowns and realized volatility.', 'A-share daily closes'],
  ['beta', 'Selection and Comparison', 'Stock Behavior and Peers', 'Compare benchmark-relative performance and beta.', 'Daily closes and a benchmark'],
  ['daily5', 'Selection and Comparison', 'Technical Selection and Backtests', 'Track moving-average states and evaluate dated signals.', 'Daily closes and a benchmark'],
  ['serenity', 'Selection and Comparison', 'Thematic Research Library', 'Browse dated publications and their research topics.', 'Crossref or approved publication metadata'],
  ['themes', 'Selection and Comparison', 'Theme Replay', 'Replay published theme membership and aggregate returns by session.', 'Dated theme members and returns'],
  ['limit-features', 'Selection and Comparison', 'Limit-Up Research', 'Compare events and close rates across listing groups.', 'A-share bars, listing groups and official limits'],
  ['news', 'Companies and Valuation', 'Company News and Events', 'Follow dated issuer events and source documents.', 'SEC issuers or approved public event records'],
  ['earnings', 'Companies and Valuation', 'Earnings Alpha', 'Review filings, reported surprises and post-event returns.', 'SEC issuers or reported results and daily closes'],
  ['valuation', 'Companies and Valuation', 'Core60 Valuation', 'Compare three cash-flow scenarios for a configured company list.', 'Dated public or user-supplied financial inputs'],
  ['frontier', 'Companies and Valuation', 'Frontier Stock Pool', 'Review reported business exposures and the evidence behind them.', 'Dated issuer exposure and source records'],
];

const symbolPattern = /^[A-Z0-9^][A-Z0-9._:+/=\-]{0,23}$/;
const lastDate = rows => rows.map(row => row.date).sort().at(-1) ?? null;
const latestDate = (...dates) => dates.filter(Boolean).sort().at(-1) ?? null;
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
const decimal = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const table = (title, columns, rows) => ({ title, columns, rows });
const href = (title, url) => ({ text: title, url });
const page = (asOf, { panels = [], tables = [], sources = [], usable = true } = {}) => ({ asOf, panels, tables, sources, usable });
const marketSources = (market, url) => url ? [url] : [market?.source?.url].filter(Boolean);

function required(condition, message) {
  if (!condition) throw new Error(message);
}

export function marketFromBundle(value) {
  if (!value) return null;
  required(symbolPattern.test(value.benchmark) && typeof value.benchmark === 'string',
    'Research price input needs an uppercase benchmark symbol.');
  const rows = value.prices.map(({ date, symbol, close }) => {
    required(isoDay(date) && typeof symbol === 'string' && symbolPattern.test(symbol) &&
      Number.isFinite(close) && close >= 1e-12 && close <= 1e12, 'Research price input contains an invalid close.');
    return `${date},${symbol},${close}`;
  });
  return { benchmark: value.benchmark, prices: analysis.parsePrices(['date,symbol,close', ...rows].join('\n')), source: { kind: 'csv' } };
}

function closes(market) {
  return Array.from(market.prices, ([symbol, series]) =>
    Array.from(series, ([date, close]) => ({ date, symbol, close }))).flat();
}

function grouped(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

async function marketRegime(market, source) {
  if (!market) return null;
  const prices = market.prices;
  const indexDates = [...prices.get(market.benchmark).keys()].sort().slice(-61);
  const observations = indexDates.slice(1).flatMap((date, i) => {
    const previous = indexDates[i];
    const changes = [...prices].filter(([symbol, series]) => symbol !== market.benchmark && series.has(date) && series.has(previous))
      .map(([, series]) => Math.sign(series.get(date) - series.get(previous)));
    return changes.length ? [{ date, market: changes.reduce((sum, value) => sum + value, 0) / changes.length, eligible: changes.length }] : [];
  });
  const result = await runCapability('market-regime-unified-router', { observations });
  const references = new Map(observations.map((row, index) => [row.date, {
    eligible: row.eligible, previous: observations[index - 1]?.date,
  }]));
  return page(result.latest.date, {
    panels: ['breadth'], sources: marketSources(market, source),
    tables: [table('Net participation and change', ['Session', 'Eligible peers', 'Breadth score', 'Change vs. prior covered date', 'Prior date'], result.history.slice(-25).reverse()
      .map(row => [row.date, references.get(row.date).eligible, decimal(row.level), decimal(row.transition), references.get(row.date).previous]))],
  });
}

function rotation(market, summary, source) {
  if (!market) return null;
  return page(summary.asOf, {
    sources: marketSources(market, source), usable: summary.relative.rows.some(row => Number.isFinite(row.excess)),
    tables: [table(`Leadership vs. ${market.benchmark}`, ['Symbol', '20-session return', 'Benchmark return', 'Excess return'], summary.relative.rows
      .map(row => [row.symbol, percent(row.return), percent(row.benchmarkReturn), percent(row.excess)]))],
  });
}

async function marketStructure(market, source) {
  if (!market) return [null, null];
  const { rows } = await runCapability('market-energy-volatility-regime', { closes: closes(market) });
  const asOf = latestDate(...rows.map(row => row.asOf));
  const sources = marketSources(market, source);
  return [
    page(asOf, { sources, tables: [table('Price trends by security', ['Symbol', 'Session', '5-day return', '20-day return', 'Observations'],
      rows.slice(0, 100).map(row => [row.symbol, row.asOf, percent(row.return5), percent(row.return20), row.observations]))] }),
    page(asOf, { sources, usable: rows.some(row => Number.isFinite(row.volatility20) && Number.isFinite(row.drawdown20)), tables: [table('Stress measures by security', ['Symbol', 'Session', '20-day return', 'Realized volatility', '20-day drawdown'],
      [...rows].sort((a, b) => (a.drawdown20 ?? Infinity) - (b.drawdown20 ?? Infinity))
        .slice(0, 100).map(row => [row.symbol, row.asOf, percent(row.return20), percent(row.volatility20), percent(row.drawdown20)]))] }),
  ];
}

async function priceLimits(rows, source) {
  if (!rows) return [null, null];
  const history = await runCapability('limit-up-microstructure-router', { bars: rows });
  const latest = history.history.at(-1);
  const bySecurityDate = new Map(rows.map(row => [`${row.date}|${row.symbol}`, row]));
  const groupEvents = [];
  for (const session of history.history) {
    for (const row of session.rows) {
      const input = bySecurityDate.get(`${session.date}|${row.symbol}`);
      if (input?.eligible) groupEvents.push({ group: input.group || 'Unclassified', status: row.status });
    }
  }
  const groups = [...grouped(groupEvents, row => row.group)].map(([group, members]) => [
    group, members.length, ...['closed', 'failed'].map(status => members.filter(row => row.status === status).length),
  ]);
  return [
    page(history.asOf, { sources: [source], tables: [
      table('Completed sessions', ['Date', 'Eligible', 'Closed at limit', 'Failed tests', 'Longest streak'],
        history.history.slice(-40).reverse().map(row => [row.date, row.eligible, row.closed, row.failed, row.maxStreak])),
      table('Latest session tests', ['Symbol', 'Theme', 'Status', 'Streak'], latest.rows.filter(row => ['closed', 'failed'].includes(row.status))
        .slice(0, 100).map(row => [row.symbol, row.theme || '—', row.status, row.streak])),
    ] }),
    page(history.asOf, { sources: [source], tables: [
      table('Events by listing group', ['Group', 'Eligible security-days', 'Limit closes', 'Failed tests'], groups),
    ] }),
  ];
}

async function technical(market, summary, source) {
  if (!market) return null;
  const dates = [...market.prices.get(market.benchmark).keys()].sort();
  const sessions = new Set(dates);
  const prices = closes(market).filter(row => sessions.has(row.date));
  const signals = [];
  for (const [symbol, series] of market.prices) {
    if (symbol === market.benchmark) continue;
    let prior = null;
    for (let index = Math.max(19, dates.length - 60); index < dates.length; index++) {
      const window = dates.slice(index - 19, index + 1);
      const values = window.map(date => series.get(date));
      if (values.some(value => value === undefined)) {
        prior = null;
        continue;
      }
      const above = values.at(-1) > values.reduce((a, b) => a + b) / values.length;
      const nextSession = dates[index + 1];
      if (above && prior === false && nextSession && series.has(nextSession)) {
        signals.push({ id: `${symbol}-${nextSession}`, date: nextSession, symbol });
      }
      prior = above;
    }
  }
  const evaluated = signals.length
    ? await runCapability('signal-outcome-evaluation-router', { signals, prices, horizons: [1, 5, 20], sessions: dates })
    : { summary: [] };
  return page(summary.asOf, { panels: ['technical'], sources: marketSources(market, source), usable: summary.breadth.averageEligible > 0, tables: [
    table('Historical outcomes after next-session entry', ['Horizon (sessions)', 'Observed', 'Mean return', 'Positive share'],
      evaluated.summary.map(row => [row.sessions, row.observed, percent(row.mean), percent(row.hitRate)])),
  ] });
}

function researchLibrary(rows, source, demo) {
  if (!rows) return null;
  for (const row of rows) {
    required(typeof row.title === 'string' && row.title.trim() && row.title.length <= 240 &&
      typeof row.topic === 'string' && row.topic.trim() && row.topic.length <= 100 && (demo || httpsLink(row.url)),
    'A research publication requires a short title, topic and HTTPS URL.');
  }
  return page(lastDate(rows), { sources: [source], tables: [
    table('Research catalog', ['Published', 'Topic', 'Reference'], [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100)
      .map(row => [row.date, row.topic, demo ? row.title : href(row.title, row.url)])),
  ] });
}

function themesReplay(rows, source) {
  if (!rows) return null;
  const identities = new Set();
  for (const row of rows) {
    const key = `${row.date}|${row.symbol}|${row.theme}`;
    required(typeof row.theme === 'string' && row.theme.trim() && row.theme.length <= 100 &&
      typeof row.symbol === 'string' && symbolPattern.test(row.symbol) &&
      Number.isFinite(row.return) && row.return >= -1 && !identities.has(key),
    'Theme records require unique dates, symbols, themes and finite returns.');
    identities.add(key);
  }
  const groups = [...grouped(rows, row => `${row.date}|${row.theme}`)].map(([, members]) => [
    members[0].date, members[0].theme, members.length,
    members.filter(row => row.return > 0).length,
    percent(members.reduce((sum, row) => sum + row.return, 0) / members.length),
  ]).sort((a, b) => b[0].localeCompare(a[0]));
  return page(lastDate(rows), { sources: [source], tables: [
    table('Theme participation by date', ['Session', 'Theme', 'Members', 'Advancing', 'Mean return'], groups.slice(0, 120)),
  ] });
}

async function companyNews(rows, filings, source, asOf, demo) {
  if (!rows && !filings) return null;
  const { rows: events } = rows ? await runCapability('stock-news-monitor-router', { events: rows, asOf }) : { rows: [] };
  return page(latestDate(lastDate(events), lastFiling(filings)), {
    panels: filings ? ['filings'] : [], sources: [source], tables: events.length ? [
      table('Dated issuer events', ['Date', 'Symbol', 'Type', 'Source'], events.slice(0, 100)
        .map(row => [row.date, row.symbol, row.type, demo ? row.title : href(row.title, row.url)])),
    ] : [],
  });
}

function lastFiling(filings, filter = () => true) {
  return latestDate(...(filings?.issuers.flatMap(row => row.filings.filter(filter).map(filing => filing.filed)) ?? []));
}

async function companyEarnings(rows, filings, market, source, priceSource) {
  if (!rows && !filings) return null;
  const sessions = market ? [...market.prices.get(market.benchmark).keys()].sort() : undefined;
  const sessionDates = new Set(sessions);
  const symbols = new Set(rows?.map(row => String(row.symbol ?? '').toUpperCase()) ?? []);
  const prices = rows && market ? closes(market).filter(row => symbols.has(row.symbol) && sessionDates.has(row.date)) : [];
  const evaluated = rows ? await runCapability('earnings-alpha-engine', {
    events: rows, prices, sessions, horizons: [1, 5, 20],
  }) : { rows: [] };
  const displayed = [...evaluated.rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  const outcomeDates = displayed.flatMap(row => row.returns.filter(outcome => Number.isFinite(outcome.return)).map(outcome => outcome.date));
  return page(latestDate(lastDate(displayed), lastFiling(filings, isEarnings), ...outcomeDates), {
    panels: filings ? ['earnings'] : [], sources: [source, ...marketSources(market, priceSource)], tables: displayed.length ? [
      table('Reported surprises and observed post-event returns', ['Event', 'Symbol', 'Surprise', 'Pre-event reference', '1 session', '5 sessions', '20 sessions'],
        displayed.map(row => [
          row.date, row.symbol, percent(row.epsSurprise), row.baseDate,
          ...row.returns.map(outcome => outcome.date && Number.isFinite(outcome.return)
            ? `${percent(outcome.return)} · ${outcome.date}` : '—'),
        ])),
    ] : [],
  });
}

async function valuations(rows, source) {
  if (!rows) return null;
  const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const results = [];
  const seen = new Set();
  for (const row of ordered) {
    required(typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) && row.valuation,
      'Valuation inputs require an ISO currency and dated scenario assumptions.');
    const key = `${row.date}|${row.symbol}`;
    required(!seen.has(key), 'Valuation inputs contain a duplicate symbol and date.');
    seen.add(key);
    const result = await runCapability('price-alert-router', row);
    if (results.length >= 300) continue;
    results.push(...result.valuation.map(item => [
      row.date, row.symbol, row.currency, item.scenario, decimal(row.close),
      decimal(item.valuePerShare), percent(item.upside),
    ]));
  }
  return page(ordered[0].date, { sources: [source], tables: [
    table('Discounted cash-flow scenarios', ['Input date', 'Symbol', 'Currency', 'Scenario', 'Reference close', 'Value per share', 'Difference'], results),
  ] });
}

async function frontierPool(rows, source, demo, asOf) {
  if (!rows) return null;
  const result = await runCapability('frontier-stock-pool', { companies: rows, asOf });
  const dates = new Map(rows.map(row => [String(row.symbol).toUpperCase(), row.date]));
  const displayed = result.rows.map(row => ({ ...row, date: dates.get(row.symbol) }))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  return page(lastDate(displayed), { sources: [source], tables: [
    table('Reported revenue exposure', ['Input date', 'Symbol', 'Company', 'Theme', 'Revenue share', 'Market cap / revenue', 'Evidence'], displayed
      .map(row => [row.date, row.symbol, row.name, row.theme, percent(row.revenueShare), decimal(row.marketCapToRevenue),
        demo ? `${row.evidenceCount} example reference(s)` : href(`${row.evidenceCount} reference(s)`, row.evidence[0]?.url)])),
  ] });
}

export async function makePages(report, bundle, us, cn) {
  const sources = bundle.sources ?? {};
  const usSummary = us ? summarizeMarket(us) : null;
  const cnSummary = cn ? summarizeMarket(cn) : null;
  const primary = cn ?? us;
  const primarySummary = cnSummary ?? usSummary;
  const primarySource = cn ? sources.marketCN : sources.market;
  const demo = report.mode === 'demo';
  const [regime, limitPages, structure, backtests, news, earnings, valuation, frontier] = await Promise.all([
    marketRegime(primary, primarySource), priceLimits(bundle.limits, sources.limits),
    marketStructure(cn, sources.marketCN), technical(primary, primarySummary, primarySource),
    companyNews(bundle.news, report.filings, sources.news, bundle.asOf, demo),
    companyEarnings(bundle.earnings, report.filings, us, sources.earnings, sources.market),
    valuations(bundle.valuation, sources.valuation), frontierPool(bundle.frontier, sources.frontier, demo, bundle.asOf),
  ]);

  for (const row of bundle.macroChina ?? []) {
    required(typeof row.series === 'string' && row.series.length <= 100 && Number.isFinite(row.value) &&
      typeof row.unit === 'string' && row.unit.length <= 40, 'China macro observations require series, numeric value and unit.');
  }
  const contents = {
    macro: page(latestDate(lastDate(report.treasury.observations), lastDate(report.labor.unemployment),
      lastDate(report.labor.cpi), lastDate(bundle.macroChina ?? [])), {
      panels: ['treasury', 'macro'], sources: [sources.macroChina],
      tables: bundle.macroChina ? [table('China macro observations', ['Period', 'Series', 'Value', 'Unit'],
        [...bundle.macroChina].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100).map(row => [row.date, row.series, row.value, row.unit]))] : [],
    }),
    regime,
    'us-rebound': rotation(us, usSummary, sources.market),
    'limit-history': limitPages[0],
    rebound: structure[0],
    precrash: structure[1],
    beta: primarySummary ? page(primarySummary.asOf, { panels: ['relative'], sources: marketSources(primary, primarySource),
      usable: primarySummary.relative.rows.some(row => Number.isFinite(row.beta) || Number.isFinite(row.excess)) }) : null,
    daily5: backtests,
    serenity: researchLibrary(bundle.publications, sources.publications, demo),
    themes: themesReplay(bundle.themes, sources.themes),
    'limit-features': limitPages[1],
    news, earnings, valuation, frontier,
  };
  return {
    ...report, market: primarySummary,
    views: pageCatalog.map(([id, group, title, description, input]) => ({ id, group, title, description, input, data: contents[id] })),
  };
}
