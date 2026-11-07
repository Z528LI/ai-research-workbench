import {
  byDate, capability, check, choice, date, daysBetween, flag, group, integer, key, link, list, mean,
  number, positive, prices, rows, sd, sources, symbol, text, unique
} from './market-inputs.mjs';
import { decisionCapabilities } from './market-decisions.mjs';
import { validationCapabilities } from './market-validation.mjs';

const EXAMPLE_DATE = '2025-02-03';
const EXAMPLE_SOURCE = 'https://example.org/illustrative';
const EXAMPLE_EVIDENCE = [{ title: 'Illustrative source note', url: EXAMPLE_SOURCE }];
const closes = Array.from({ length: 63 }, (_, day) => new Date(Date.UTC(2025, 1, 3 + day)))
  .filter(day => day.getUTCDay() >= 1 && day.getUTCDay() <= 5)
  .map((day, i) => ({ symbol: 'ATLAS', date: day.toISOString().slice(0, 10), close: 100 + i * 0.35 + Math.sin(i) }));

const normalized = (value, field) => number(value, field, -1, 1);
const rate = (points, n) => points.length > n ? points.at(-1) / points.at(-(n + 1)) - 1 : null;

function drawdown(points) {
  let peak = points[0];
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point);
    worst = Math.min(worst, point / peak - 1);
  }
  return worst;
}

function hotRanking({ rankings, researchThrough = 10, watchThrough = 30 }) {
  integer(researchThrough, 'researchThrough', 1);
  integer(watchThrough, 'watchThrough', researchThrough);
  const observations = rows(rankings, 'rankings').map(row => ({
    date: date(row.date), market: text(row.market, 'market'), symbol: symbol(row.symbol),
    rank: integer(row.rank, 'rank', 1), topics: (row.topics === undefined ? [] : rowsOfText(row.topics, 'topics'))
  }));
  unique(observations, row => key(row.date, row.market, row.symbol), 'rankings');
  return { groups: [...group(observations, row => key(row.date, row.market)).values()].map(bucket => {
    const result = { date: bucket[0].date, market: bucket[0].market, research: [], watch: [], context: [] };
    for (const row of bucket.sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol))) {
      const category = row.rank <= researchThrough ? 'research' : row.rank <= watchThrough ? 'watch' : 'context';
      result[category].push({ symbol: row.symbol, rank: row.rank, topics: row.topics });
    }
    return result;
  }) };
}

function rowsOfText(values, field) {
  check(Array.isArray(values) && values.length <= 100, `${field} must be an array of at most 100 items.`);
  return values.map(value => text(value, field));
}

function sessionDates(observed, supplied) {
  const dates = supplied === undefined ? [...new Set(observed)].sort() :
    unique(list(supplied, 'sessions').map(value => date(value)), value => value, 'sessions').sort();
  const index = new Map(dates.map((day, i) => [day, i]));
  check(observed.every(day => index.has(day)), 'Every observation date must be present in sessions.');
  return { dates, index };
}

function realizedVolatility(window) {
  if (window.length !== 21 || window.some(value => value === undefined)) return null;
  const logReturns = window.slice(1).map((value, i) => Math.log(value / window[i]));
  return sd(logReturns) * Math.sqrt(252);
}

function volatility({ closes: input, sessions }) {
  const points = prices(input, 'closes');
  const { dates, index } = sessionDates(points.map(row => row.date), sessions);
  return { rows: [...group(points, row => row.symbol)].map(([symbol, series]) => {
    const asOf = series.at(-1).date;
    const end = index.get(asOf) + 1;
    const closes = new Map(series.map(row => [row.date, row.close]));
    const values = dates.slice(Math.max(0, end - 141), end).map(day => closes.get(day));
    const recent = values.slice(-21);
    const five = values.slice(-6);
    const volatility20 = realizedVolatility(recent);
    const historical = [];
    for (let i = 21; i < values.length; i++) {
      const volatility = realizedVolatility(values.slice(i - 21, i));
      if (volatility !== null) historical.push(volatility);
    }
    const percentile = volatility20 !== null && historical.length >= 20
      ? historical.reduce((rank, value) => rank + (value < volatility20 ? 1 : value === volatility20 ? 0.5 : 0), 0) / historical.length
      : null;
    return { symbol, asOf, observations: series.length, return5: five.includes(undefined) ? null : rate(five, 5),
      return20: volatility20 === null ? null : rate(recent, 20), volatility20,
      drawdown20: volatility20 === null ? null : drawdown(recent), historyWindows: historical.length,
      volatilityPercentile: percentile,
      volatilityRegime: percentile === null ? null : percentile >= 2 / 3 ? 'elevated' : percentile <= 1 / 3 ? 'subdued' : 'typical' };
  }) };
}

function regime({ observations }) {
  const dates = rows(observations, 'observations').map(row => {
    const components = { market: normalized(row.market, 'market') };
    for (const name of ['macro', 'style', 'earnings']) {
      components[name] = row[name] == null ? null : normalized(row[name], name);
    }
    const covered = Object.keys(components).filter(name => components[name] !== null);
    return { date: date(row.date), components, covered, level: mean(covered.map(name => components[name])) };
  });
  unique(dates, row => row.date, 'observations').sort(byDate);
  const history = dates.map((row, i) => {
    const previous = dates[i - 1];
    const comparable = previous && row.covered.join(',') === previous.covered.join(',');
    return { ...row, transition: comparable ? row.level - previous.level : null };
  });
  return { latest: history.at(-1), history };
}

function macro({ indicators, scenarios = [] }) {
  const facts = rows(indicators, 'indicators').map(row => ({
    id: text(row.id, 'id'), region: text(row.region, 'region'), date: date(row.date),
    value: number(row.value, 'value'), unit: text(row.unit, 'unit'), source: link(row.source, 'source')
  }));
  unique(facts, row => key(row.region, row.id, row.date), 'indicators').sort(byDate);
  const current = [...group(facts, row => key(row.region, row.id)).values()].map(series => {
    const latest = series.at(-1);
    const previous = series.at(-2);
    return { ...latest, previousDate: previous?.date ?? null,
      change: previous?.unit === latest.unit ? latest.value - previous.value : null };
  });
  const currentById = new Map(current.map(row => [key(row.region, row.id), row]));
  const cases = rows(scenarios, 'scenarios', 0, 100).map(row => {
    const name = text(row.name, 'name');
    const id = text(row.id, 'id');
    const region = text(row.region, 'region');
    const operator = choice(row.operator, 'operator', ['>', '>=', '<', '<=']);
    const threshold = number(row.threshold, 'threshold');
    const latest = currentById.get(key(region, id));
    const value = latest?.value ?? null;
    const tests = { '>': value > threshold, '>=': value >= threshold, '<': value < threshold, '<=': value <= threshold };
    return { name, id, region, operator, threshold, met: value === null ? null : tests[operator], observationDate: latest?.date ?? null };
  });
  return { asOf: facts.at(-1).date, rows: current, scenarios: cases };
}

function styleCycle({ groups }) {
  const observations = rows(groups, 'groups').map(row => ({
    group: text(row.group, 'group'), date: date(row.date), level: positive(row.level, 'level')
  }));
  unique(observations, row => key(row.group, row.date), 'groups');
  const dates = [...new Set(observations.map(row => row.date))].sort();
  const result = [...group(observations, row => row.group)].map(([group, series]) => {
    const points = new Map(series.map(row => [row.date, row.level]));
    const aligned = n => {
      const window = dates.slice(-(n + 1));
      return window.length === n + 1 && window.every(day => points.has(day)) ? rate(window.map(day => points.get(day)), n) : null;
    };
    return { group, return5: aligned(5), return20: aligned(20), rank5: null, rank20: null };
  });
  for (const horizon of [5, 20]) {
    const value = `return${horizon}`;
    const rank = `rank${horizon}`;
    const eligible = result.filter(row => row[value] !== null).sort((a, b) => b[value] - a[value]);
    for (const [i, row] of eligible.entries()) row[rank] = i > 0 && eligible[i - 1][value] === row[value] ? eligible[i - 1][rank] : i + 1;
  }
  return { asOf: dates.at(-1), rows: result.sort((a, b) => a.group.localeCompare(b.group)) };
}

function styleStability({ observations }) {
  const ranks = rows(observations, 'observations').map(row => ({
    date: date(row.date), group: text(row.group, 'group'), rank: integer(row.rank, 'rank', 1)
  }));
  unique(ranks, row => key(row.group, row.date), 'observations').sort(byDate);
  const bySession = [...group(ranks, row => row.date)];
  const leaders = bySession.map(([date, points]) => {
    const minimum = Math.min(...points.map(row => row.rank));
    return { date, groups: points.filter(row => row.rank === minimum).map(row => row.group).sort() };
  });
  const appearances = new Map();
  for (const row of leaders) for (const leader of row.groups) appearances.set(leader, (appearances.get(leader) ?? 0) + 1);
  const leadershipChanges = leaders.slice(1).filter((row, i) => key(...row.groups) !== key(...leaders[i].groups)).length;
  return { observations: bySession.length, leaders, leadershipChanges,
    groups: [...group(ranks, row => row.group)].map(([group, series]) => ({ group, observed: series.length,
      meanRank: mean(series.map(row => row.rank)), leadingShare: (appearances.get(group) ?? 0) / series.length,
      rankVolatility: sd(series.map(row => row.rank)) })) };
}

function marketTrend({ articles, asOf }) {
  const evidence = rows(articles, 'articles').map(row => ({ date: date(row.date), topic: text(row.topic, 'topic'),
    title: text(row.title, 'title'), url: link(row.url) }));
  unique(evidence, row => key(row.topic, row.url), 'articles').sort(byDate);
  const end = asOf === undefined ? evidence.at(-1).date : date(asOf, 'asOf');
  check(evidence.every(row => row.date <= end), 'Article dates cannot be later than asOf.');
  return { asOf: end, topics: [...group(evidence, row => row.topic)].map(([topic, items]) => {
    const recent = items.filter(row => daysBetween(row.date, end) < 7);
    const previous = items.filter(row => { const age = daysBetween(row.date, end); return age >= 7 && age < 14; });
    return { topic, recentCount: recent.length, previousCount: previous.length, change: recent.length - previous.length,
      publishers: [...new Set(recent.map(row => new URL(row.url).hostname))].sort(), evidence: recent };
  }).sort((a, b) => b.recentCount - a.recentCount || a.topic.localeCompare(b.topic)) };
}

function marketPulse({ rows: input }) {
  const observations = rows(input, 'rows').map(row => ({ date: date(row.date), symbol: symbol(row.symbol),
    return: positive(row.close, 'close') / positive(row.previousClose, 'previousClose') - 1,
    weight: row.weight == null ? null : number(row.weight, 'weight', 0, 1), evidence: sources(row.evidence) }));
  unique(observations, row => key(row.date, row.symbol), 'rows').sort(byDate);
  const asOf = observations.at(-1).date;
  const current = observations.filter(row => row.date === asOf);
  const coveredWeight = current.reduce((total, row) => total + (row.weight ?? 0), 0);
  check(coveredWeight <= 1 + 1e-9, 'Latest basket weights must sum to at most 1.');
  const advancing = current.filter(row => row.return > 0).length;
  const declining = current.filter(row => row.return < 0).length;
  return { asOf, advancing, declining, unchanged: current.length - advancing - declining, coveredWeight,
    rows: current.map(row => ({ symbol: row.symbol, return: row.return,
      contribution: row.weight === null ? null : row.weight * row.return, evidence: row.evidence }))
      .sort((a, b) => b.return - a.return || a.symbol.localeCompare(b.symbol)) };
}

function limitMicrostructure({ bars, sessions }) {
  const points = rows(bars, 'bars').map(row => {
    const eligible = flag(row.eligible, 'eligible');
    const high = positive(row.high, 'high');
    const close = positive(row.close, 'close');
    const limitUp = eligible ? positive(row.limitUp, 'limitUp') : null;
    check(close <= high && (!eligible || high <= limitUp + 1e-8), 'Prices conflict with the reported high or official limit-up price.');
    const touched = eligible && Math.abs(high - limitUp) < 1e-8;
    const closed = touched && Math.abs(close - limitUp) < 1e-8;
    const status = !eligible ? 'ineligible' : closed ? 'closed' : touched ? 'failed' : 'below';
    return { date: date(row.date), symbol: symbol(row.symbol), eligible, status,
      theme: row.theme == null ? null : text(row.theme, 'theme') };
  });
  unique(points, row => key(row.date, row.symbol), 'bars').sort(byDate);
  const bySession = group(points, row => row.date);
  const { index: sessionIndex } = sessionDates([...bySession.keys()], sessions);
  const streaks = new Map();
  const history = [...bySession].map(([date, rows]) => {
    const index = sessionIndex.get(date);
    const participants = rows.map(row => {
      const previous = streaks.get(row.symbol);
      const streak = row.status === 'closed' ? (previous?.index === index - 1 ? previous.streak + 1 : 1) : 0;
      streaks.set(row.symbol, { index, streak });
      return { symbol: row.symbol, theme: row.theme, status: row.status, streak };
    });
    return { date, eligible: rows.filter(row => row.eligible).length, closed: participants.filter(row => row.status === 'closed').length,
      failed: participants.filter(row => row.status === 'failed').length, maxStreak: Math.max(...participants.map(row => row.streak)),
      themes: [...group(participants.filter(row => row.theme && row.status === 'closed'), row => row.theme)]
        .map(([theme, members]) => ({ theme, closed: members.length })), rows: participants };
  });
  return { asOf: history.at(-1).date, sessionBasis: sessions === undefined ? 'submitted dates' : 'supplied trading calendar', history };
}

function ivSnapshot({ observations }) {
  const values = rows(observations, 'observations').map(row => ({ date: date(row.date),
    tenorDays: integer(row.tenorDays, 'tenorDays', 1, 3650), iv: number(row.iv, 'iv', 0, 10) }));
  unique(values, row => key(row.date, row.tenorDays), 'observations').sort(byDate);
  const asOf = values.at(-1).date;
  const curve = [...group(values, row => row.tenorDays)].flatMap(([tenorDays, series]) => {
    const latest = series.at(-1);
    if (latest.date !== asOf) return [];
    const history = series.slice(0, -1);
    return [{ tenorDays, iv: latest.iv, historyCount: history.length, historyMean: mean(history.map(row => row.iv)),
      percentile: history.length ? history.filter(row => row.iv <= latest.iv).length / history.length : null }];
  }).sort((a, b) => a.tenorDays - b.tenorDays);
  return { asOf, curve, termSpread: curve.length >= 2 ? curve.at(-1).iv - curve[0].iv : null };
}

function globalRisk({ indicators }) {
  const observations = rows(indicators, 'indicators').map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    category: choice(row.category, 'category', ['macro', 'liquidity', 'volatility', 'event']),
    risk: normalized(row.risk, 'risk'), source: link(row.source, 'source') }));
  unique(observations, row => key(row.category, row.id, row.date), 'indicators').sort(byDate);
  const latest = [...group(observations, row => key(row.category, row.id)).values()].map(series => series.at(-1));
  const categories = [...group(latest, row => row.category)].map(([category, indicators]) => ({ category,
    score: mean(indicators.map(row => row.risk)), indicators }));
  return { asOf: observations.at(-1).date, score: mean(categories.map(row => row.score)), coveredCategories: categories.length, categories };
}

function sentiment({ observations }) {
  const items = rows(observations, 'observations').map(row => {
    const scores = Object.fromEntries(['financial', 'news', 'liquidity', 'market'].map(field => [field, normalized(row[field], field)]));
    const score = mean(Object.values(scores));
    const stage = score < -0.35 ? 'depressed' : score < 0 ? 'weak' : score < 0.35 ? 'balanced' : 'strong';
    return { date: date(row.date), symbol: symbol(row.symbol), scores, score, stage };
  });
  unique(items, row => key(row.symbol, row.date), 'observations').sort(byDate);
  return { rows: [...group(items, row => row.symbol)].map(([symbol, history]) => ({ symbol,
    latest: history.at(-1), previousStage: history.at(-2)?.stage ?? null, history })) };
}

function sectorScreen({ sectors }) {
  const observations = rows(sectors, 'sectors').map(row => ({ sector: text(row.sector, 'sector'), date: date(row.date),
    valuationPercentile: number(row.valuationPercentile, 'valuationPercentile', 0, 1),
    cycleChange: normalized(row.cycleChange, 'cycleChange'), reversalReturn: number(row.reversalReturn, 'reversalReturn', -1, 100),
    netFlowShare: normalized(row.netFlowShare, 'netFlowShare') }));
  unique(observations, row => key(row.sector, row.date), 'sectors').sort(byDate);
  const asOf = observations.at(-1).date;
  const current = observations.filter(row => row.date === asOf);
  const fields = ['valuationPercentile', 'cycleChange', 'reversalReturn', 'netFlowShare'];
  const ranks = new Map(fields.map(field => {
    const values = [...group(current, row => row[field])].sort(([a], [b]) => field === 'valuationPercentile' ? b - a : a - b);
    const percentiles = new Map();
    let weaker = 0;
    for (const [value, tied] of values) {
      percentiles.set(value, (weaker + tied.length / 2) / current.length);
      weaker += tied.length;
    }
    return [field, percentiles];
  }));
  return { asOf, universeSize: current.length, rows: current.map(row => {
    const percentiles = Object.fromEntries(fields.map(field => [field, ranks.get(field).get(row[field])]));
    return { ...row, percentiles, score: mean(Object.values(percentiles)) };
  }).sort((a, b) => b.score - a.score || a.sector.localeCompare(b.sector)) };
}

export const marketCapabilities = {
  'hot-stock-ranking-classifier': capability('{rankings:[{date,symbol,market,rank,topics?:string[]}],researchThrough?:integer,watchThrough?:integer}',
    { rankings: [{ date: EXAMPLE_DATE, symbol: 'ATLAS', market: 'Illustrative', rank: 8, topics: ['Battery materials'] }] }, hotRanking),
  'market-energy-volatility-regime': capability('{closes:[{date,symbol,close:number}],sessions?:date[]} using daily closes in one session order',
    { closes }, volatility),
  'market-regime-unified-router': capability('{observations:[{date,market:number,macro?:number,style?:number,earnings?:number}]} using normalized scores -1 to 1',
    { observations: [{ date: EXAMPLE_DATE, market: 0.2, macro: -0.1 }, { date: '2025-02-04', market: 0.3, macro: -0.15 }] }, regime),
  'macro-insight-router': capability('{indicators:[{id,date,value:number,region,unit,source:https}],scenarios?:[{name,id,region,operator,threshold:number}]}',
    { indicators: [{ id: 'example-growth', date: EXAMPLE_DATE, value: 2.1, region: 'US', unit: 'percent', source: EXAMPLE_SOURCE }],
      scenarios: [{ name: 'Above 2 percent', id: 'example-growth', region: 'US', operator: '>', threshold: 2 }] }, macro),
  'market-style-cycle': capability('{groups:[{group,date,level:number}]} using comparable daily index levels',
    { groups: closes.flatMap(({ date, close }, i) => [{ group: 'Growth', date, level: close }, { group: 'Value', date, level: 100 + i / 2 }]) }, styleCycle),
  'market-style-stability-router': capability('{observations:[{date,group,rank:integer}]}',
    { observations: [{ date: EXAMPLE_DATE, group: 'Growth', rank: 1 }, { date: EXAMPLE_DATE, group: 'Value', rank: 2 },
      { date: '2025-02-04', group: 'Growth', rank: 2 }, { date: '2025-02-04', group: 'Value', rank: 1 }] }, styleStability),
  'market-trend-router': capability('{articles:[{date,topic,title,url:https}],asOf?:date}',
    { articles: [{ date: EXAMPLE_DATE, topic: 'Battery materials', ...EXAMPLE_EVIDENCE[0] }] }, marketTrend),
  'daily-market-pulse-router': capability('{rows:[{date,symbol,close:number,previousClose:number,weight?:number,evidence?:[{title,url:https}]}]}',
    { rows: [{ date: EXAMPLE_DATE, symbol: 'ATLAS', close: 103, previousClose: 100, weight: 0.3, evidence: EXAMPLE_EVIDENCE },
      { date: EXAMPLE_DATE, symbol: 'CEDAR', close: 98, previousClose: 100, weight: 0.2 }] }, marketPulse),
  'limit-up-microstructure-router': capability('{bars:[{date,symbol,eligible:boolean,high:number,close:number,limitUp?:number,theme?:string}],sessions?:date[]} with official limitUp for each eligible bar',
    { bars: [{ date: EXAMPLE_DATE, symbol: 'ATLAS', eligible: true, high: 11, close: 11, limitUp: 11, theme: 'Storage' },
      { date: EXAMPLE_DATE, symbol: 'CEDAR', eligible: true, high: 12, close: 11, limitUp: 12, theme: 'Sensors' }] }, limitMicrostructure),
  'iv-snapshot': capability('{observations:[{date,tenorDays:integer,iv:number}]} with IV as a fraction',
    { observations: [{ date: '2025-01-31', tenorDays: 30, iv: 0.23 }, { date: EXAMPLE_DATE, tenorDays: 30, iv: 0.25 },
      { date: EXAMPLE_DATE, tenorDays: 90, iv: 0.29 }] }, ivSnapshot),
  'global-risk-overlay-router': capability('{indicators:[{id,date,category,risk:number,source:https}]} with normalized risk -1 to 1',
    { indicators: [{ id: 'illustrative-spread', date: EXAMPLE_DATE, category: 'liquidity', risk: 0.4, source: EXAMPLE_SOURCE },
      { id: 'illustrative-vol', date: EXAMPLE_DATE, category: 'volatility', risk: -0.1, source: EXAMPLE_SOURCE }] }, globalRisk),
  'sentiment-cycle': capability('{observations:[{date,symbol,financial:number,news:number,liquidity:number,market:number}]} with normalized components -1 to 1',
    { observations: [{ date: EXAMPLE_DATE, symbol: 'ATLAS', financial: 0.5, news: 0.2, liquidity: -0.2, market: 0.15 }] }, sentiment),
  'sector-leading-indicators': capability('{sectors:[{date,sector,valuationPercentile:number,cycleChange:number,reversalReturn:number,netFlowShare:number}]}',
    { sectors: [{ date: EXAMPLE_DATE, sector: 'Storage', valuationPercentile: 0.35, cycleChange: 0.2, reversalReturn: 0.04, netFlowShare: 0.01 },
      { date: EXAMPLE_DATE, sector: 'Sensors', valuationPercentile: 0.61, cycleChange: -0.1, reversalReturn: 0.01, netFlowShare: 0.02 }] }, sectorScreen),
  ...decisionCapabilities,
  ...validationCapabilities
};
