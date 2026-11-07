const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const DAY_MS = 86_400_000;
const DIMENSIONS = ['macro', 'liquidity', 'style', 'valuation', 'trend'];
const STAGES = ['lab', 'pilot', 'commercial'];

function records(value, label, max = 5000) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be an array with at most ${max} entries.`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error(`${label} must be nonempty text.`);
  return value.trim();
}

function finite(value, label, min = -1e18, max = 1e18) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a number in the supported range.`);
  return value;
}

function optionalNumber(value, label, min, max) {
  return value == null ? null : finite(value, label, min, max);
}

function positive(value, label) {
  return finite(value, label, 1e-12);
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return finite(value, label, min, max);
}

function day(value, label = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a real date.`);
  return value;
}

function symbol(value) {
  const normalized = text(value, 'symbol').toUpperCase();
  if (!SYMBOL.test(normalized)) throw new Error('Invalid security symbol.');
  return normalized;
}

function url(value) {
  try {
    const parsed = new URL(text(value, 'source URL'));
    const credentialParameter = [...parsed.searchParams.keys()].some((name) => /token|api[-_]?key|credential|password|secret|signature|^auth$/i.test(name));
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && !credentialParameter &&
      /\.[a-z]{2,63}$/i.test(parsed.hostname) && !/\.(?:internal|local|localhost|lan|test|invalid)$/i.test(parsed.hostname)) {
      parsed.hash = '';
      return parsed.href;
    }
  } catch {
    // Reuse the safe error below without echoing the input.
  }
  throw new Error('A source URL must use public HTTPS.');
}

function unique(rows, key, label) {
  const seen = new Set();
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) throw new Error(`Duplicate ${label}.`);
    seen.add(id);
  }
  return rows;
}

function evidenceRows(value, asOf = null) {
  const result = new Map();
  for (const item of records(value ?? [], 'evidence', 100)) {
    const row = { title: text(item.title, 'source title'), url: url(item.url), date: day(item.date, 'source date') };
    if (asOf && row.date > asOf) continue;
    result.set(JSON.stringify([row.url, row.date]), row);
  }
  return [...result.values()].sort((a, b) => b.date.localeCompare(a.date) || a.url.localeCompare(b.url));
}

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function mean(values) {
  return values.length ? total(values) / values.length : null;
}

function relativeChange(value, base) {
  return value == null || base == null || base === 0 ? null : (value - base) / Math.abs(base);
}

function groupedPrices(prices) {
  const rows = unique(records(prices, 'prices', 50_000).map((row) => ({
    symbol: symbol(row.symbol), date: day(row.date), close: positive(row.close, 'close'),
  })), (row) => `${row.symbol}/${row.date}`, 'price observation');
  const groups = new Map();
  for (const row of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!groups.has(row.symbol)) groups.set(row.symbol, []);
    groups.get(row.symbol).push(row);
  }
  return groups;
}

function resolveUniverse(input) {
  const asOf = day(input.asOf, 'asOf');
  const universe = new Map(unique(records(input.universe, 'universe').map((row) => {
    if (typeof row.active !== 'boolean') throw new Error('Universe active flags must be boolean.');
    return { symbol: symbol(row.symbol), active: row.active };
  }), (row) => row.symbol, 'universe listing').map((row) => [row.symbol, row]));
  const rows = unique(records(input.shortlist, 'shortlist').map((row) => {
    const ticker = symbol(row.symbol);
    const date = day(row.date, 'shortlist date');
    const listing = universe.get(ticker);
    const state = date > asOf ? 'future_record' : !listing ? 'outside_universe' : listing.active ? 'eligible_for_review' : 'inactive_listing';
    return { symbol: ticker, date, state };
  }), (row) => row.symbol, 'shortlist symbol');
  return { asOf, universeSize: universe.size, rows };
}

function dueDiligence(input) {
  const asOf = day(input.asOf, 'asOf');
  const areas = ['business', 'financials', 'competition', 'governance', 'valuation'];
  const rows = areas.map((area) => {
    const evidence = evidenceRows(input.evidence?.[area], asOf);
    return { area, status: evidence.length ? 'evidence_available' : 'evidence_needed', evidence };
  });
  return { symbol: symbol(input.symbol), asOf, rows, missingAreas: rows.filter((row) => !row.evidence.length).map((row) => row.area) };
}

function enrich(input) {
  const companies = unique(records(input.companies, 'companies').map((row) => {
    const revenue = optionalNumber(row.revenue, 'revenue', 0);
    const marketCap = optionalNumber(row.marketCap, 'marketCap', 0);
    const segments = records(row.segments ?? [], 'segments', 100).map((segment) => {
      const value = finite(segment.revenue, 'segment revenue', 0);
      return { name: text(segment.name, 'segment name'), revenue: value, revenueShare: revenue ? value / revenue : null };
    });
    const segmentTotal = total(segments.map((segment) => segment.revenue));
    if (revenue != null && segmentTotal - revenue > Math.max(revenue * 1e-6, 1e-9)) throw new Error('Segment revenues exceed consolidated revenue.');
    const operatingIncome = optionalNumber(row.operatingIncome, 'operatingIncome');
    const operatingYears = optionalNumber(row.operatingYears, 'operatingYears', 0, 500);
    return {
      symbol: symbol(row.symbol), asOf: day(row.asOf, 'company asOf'), revenue, marketCap, operatingYears, segments,
      operatingMargin: revenue && operatingIncome != null ? operatingIncome / revenue : null,
      marketCapToRevenue: revenue && marketCap != null ? marketCap / revenue : null,
      unallocatedRevenue: revenue != null && segments.length ? Math.max(0, revenue - segmentTotal) : null,
    };
  }), (row) => row.symbol, 'company');
  return { rows: companies };
}

function attentionScreen(input) {
  const focus = new Set(records(input.themes, 'themes', 100).map((theme) => text(theme, 'theme').toLowerCase()));
  const rows = unique(records(input.candidates, 'candidates').map((row) => {
    const themes = [...new Set(records(row.themes, 'candidate themes', 100).map((theme) => text(theme, 'theme').toLowerCase()))];
    const matchedThemes = themes.filter((theme) => focus.has(theme));
    const attentionRank = integer(row.attentionRank, 'attentionRank', 1, 1_000_000);
    const evidence = evidenceRows(row.evidence);
    return { symbol: symbol(row.symbol), attentionRank, matchedThemes, evidence, needsPrimaryEvidence: evidence.length === 0 };
  }), (row) => row.symbol, 'candidate');
  rows.sort((a, b) => b.matchedThemes.length - a.matchedThemes.length || a.attentionRank - b.attentionRank || a.symbol.localeCompare(b.symbol));
  return { rows, researchQuestions: ['Which disclosures establish commercial exposure?', 'Which milestones would confirm or weaken the thesis?'] };
}

function breakthrough(input) {
  const asOf = day(input.asOf, 'asOf');
  const rows = unique(records(input.advances, 'advances').map((row) => {
    if (!STAGES.includes(row.stage)) throw new Error('Stage must be lab, pilot or commercial.');
    const evidence = evidenceRows(row.evidence, asOf);
    return {
      id: text(row.id, 'advance ID'), theme: text(row.theme, 'theme'), title: text(row.title, 'title'), stage: row.stage,
      evidence, evidenceCount: evidence.length, latestEvidenceDate: evidence[0]?.date ?? null,
      stageEvidence: evidence.length ? 'sources_linked' : 'unverified',
    };
  }), (row) => row.id, 'advance');
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, rows.filter((row) => row.stage === stage && row.evidenceCount).length]));
  return { asOf, rows, stageCounts };
}

function frontierPool(input) {
  const asOf = input.asOf == null ? null : day(input.asOf, 'asOf');
  const companies = unique(records(input.companies, 'companies').map((row) => ({
    symbol: symbol(row.symbol), name: text(row.name, 'company name'), revenue: optionalNumber(row.revenue, 'revenue', 0),
    marketCap: optionalNumber(row.marketCap, 'marketCap', 0),
    exposures: unique(records(row.exposures, 'exposures', 100), (exposure) => text(exposure.theme, 'theme').toLowerCase(), 'company theme'),
  })), (row) => row.symbol, 'company');
  const rows = companies.flatMap((company) => company.exposures.map((exposure) => {
    const revenueShare = optionalNumber(exposure.revenueShare, 'revenueShare', 0, 1);
    const evidence = evidenceRows(exposure.evidence, asOf);
    return {
      symbol: company.symbol, name: company.name, theme: text(exposure.theme, 'theme'), revenueShare,
      exposedRevenue: company.revenue == null || revenueShare == null ? null : company.revenue * revenueShare,
      marketCapToRevenue: company.revenue && company.marketCap != null ? company.marketCap / company.revenue : null,
      evidenceCount: evidence.length, evidence,
    };
  }));
  rows.sort((a, b) => b.evidenceCount - a.evidenceCount || (b.revenueShare ?? -1) - (a.revenueShare ?? -1));
  return { asOf, companyCount: companies.length, rows };
}

function admission(input) {
  const asOf = day(input.asOf, 'asOf');
  const minSources = integer(input.minSources ?? 2, 'minSources', 1, 20);
  const requiredThemes = new Set(records(input.requiredThemes ?? [], 'requiredThemes', 100).map((theme) => text(theme, 'theme').toLowerCase()));
  const rows = unique(records(input.candidates, 'candidates').map((row) => {
    const evidence = evidenceRows(row.evidence, asOf);
    const sourceHosts = [...new Set(evidence.map((item) => new URL(item.url).hostname.replace(/^www\./, '')))].sort();
    const themes = records(row.themes, 'themes', 100).map((theme) => text(theme, 'theme').toLowerCase());
    const gaps = [];
    if (sourceHosts.length < minSources) gaps.push('source_host_coverage');
    if (requiredThemes.size && !themes.some((theme) => requiredThemes.has(theme))) gaps.push('required_theme_exposure');
    if (row.disqualifyingRisk === true) gaps.push('disqualifying_risk');
    return { symbol: symbol(row.symbol), evidence, sourceHosts, gaps, status: gaps.length ? 'criteria_unmet' : 'eligible_for_review' };
  }), (row) => row.symbol, 'candidate');
  return { asOf, minSources, rows };
}

function researchPlan(input) {
  const asOf = day(input.asOf, 'asOf');
  const batchSize = integer(input.batchSize ?? 5, 'batchSize', 1, 50);
  const rows = unique(records(input.candidates, 'candidates').map((row) => {
    const evidence = evidenceRows(row.evidence, asOf);
    return {
      symbol: symbol(row.symbol), priority: finite(row.priority, 'priority', 0), evidence,
      questions: records(row.questions ?? [], 'questions', 100).map((question) => text(question, 'research question')),
    };
  }), (row) => row.symbol, 'candidate').sort((a, b) => b.priority - a.priority || a.symbol.localeCompare(b.symbol));
  const batches = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push({ batch: batches.length + 1, candidates: rows.slice(index, index + batchSize) });
  }
  return { asOf, candidateCount: rows.length, batches };
}

function researchAudit(input) {
  const asOf = day(input.asOf, 'asOf');
  const maxAgeDays = integer(input.maxAgeDays ?? 180, 'maxAgeDays', 1, 3650);
  const reportRows = unique(records(input.reports, 'reports').map((report) => {
    const reportDate = day(report.date, 'report date');
    return {
      symbol: symbol(report.symbol), date: reportDate, readable: report.readable === true,
      evidence: evidenceRows(report.evidence, reportDate < asOf ? reportDate : asOf),
    };
  }), (report) => `${report.symbol}/${report.date}`, 'research report');
  const reports = new Map();
  for (const report of reportRows.sort((a, b) => b.date.localeCompare(a.date))) {
    const existing = reports.get(report.symbol);
    if (!existing || existing.date > asOf) reports.set(report.symbol, report);
  }
  const rows = [...new Set(records(input.symbols, 'symbols').map(symbol))].map((ticker) => {
    const report = reports.get(ticker);
    const gaps = [];
    if (!report) gaps.push('missing_report');
    if (report) {
      if (report.date > asOf) gaps.push('future_report');
      if ((Date.parse(asOf) - Date.parse(report.date)) / DAY_MS > maxAgeDays) gaps.push('stale_report');
      if (!report.readable) gaps.push('unreadable_report');
      if (!report.evidence.length) gaps.push('missing_evidence');
    }
    return { symbol: ticker, reportDate: report?.date ?? null, gaps };
  }).sort((a, b) => b.gaps.length - a.gaps.length || a.symbol.localeCompare(b.symbol));
  return { asOf, readyCount: rows.filter((row) => !row.gaps.length).length, rows };
}

function resonance(input) {
  const weights = Object.fromEntries(DIMENSIONS.map((key) => [key, finite(input.weights?.[key] ?? 1, `${key} weight`, 0)]));
  const rows = unique(records(input.candidates, 'candidates').map((row) => {
    const observations = DIMENSIONS.flatMap((key) => row[key] == null ? [] : [{ dimension: key, score: finite(row[key], key, -1, 1), weight: weights[key] }]);
    const scored = observations.filter((row) => row.weight > 0);
    const denominator = total(scored.map((row) => row.weight));
    const score = scored.length >= 2 ? total(scored.map((row) => row.score * row.weight)) / denominator : null;
    return { symbol: symbol(row.symbol), score, observations, supporting: scored.filter((row) => row.score > 0).length, opposing: scored.filter((row) => row.score < 0).length };
  }), (row) => row.symbol, 'candidate');
  return { rows: rows.sort((a, b) => (b.score ?? -2) - (a.score ?? -2)) };
}

function returns(series) {
  return series.slice(1).map((row, index) => row.close / series[index].close - 1);
}

function turningPoints(series) {
  return series.slice(1, -1).flatMap((row, index) => {
    const left = series[index].close;
    const right = series[index + 2].close;
    if (row.close > left && row.close > right) return [{ date: row.date, kind: 'peak' }];
    if (row.close < left && row.close < right) return [{ date: row.date, kind: 'trough' }];
    return [];
  });
}

function structureSimilarity(input) {
  const benchmark = symbol(input.reference);
  const lookback = integer(input.lookback ?? 20, 'lookback', 3, 250);
  const timeframe = text(input.timeframe ?? 'daily', 'timeframe');
  const groups = groupedPrices(input.prices);
  const reference = groups.get(benchmark)?.slice(-lookback) ?? [];
  if (reference.length !== lookback) throw new Error('Reference needs a complete lookback.');
  const referenceReturns = returns(reference);
  const referenceNorm = Math.hypot(...referenceReturns);
  const rows = [...groups].filter(([ticker]) => ticker !== benchmark).map(([ticker, series]) => {
    const recent = series.slice(-lookback);
    const changes = returns(recent);
    const denominator = referenceNorm * Math.hypot(...changes);
    const similarity = recent.length === lookback && denominator > 0
      ? Math.max(-1, Math.min(1, total(changes.map((change, index) => change * referenceReturns[index])) / denominator)) : null;
    return { symbol: ticker, observations: recent.length, similarity, turns: turningPoints(recent) };
  });
  return {
    reference: benchmark, timeframe, lookback, referenceTurns: turningPoints(reference),
    rows: rows.sort((a, b) => (b.similarity ?? -2) - (a.similarity ?? -2)),
  };
}

function stockCharacter(input) {
  const lookback = integer(input.lookback ?? 20, 'lookback', 2, 250);
  const rows = [...groupedPrices(input.prices)].map(([ticker, series]) => {
    const changes = returns(series);
    const upDays = changes.filter((change) => change > 0).length;
    const upWithNext = changes.slice(0, -1).flatMap((change, index) => change > 0 ? [changes[index + 1]] : []);
    let breakouts = 0;
    let reversals = 0;
    for (let i = lookback; i < series.length - 1; i++) {
      if (series[i].close <= Math.max(...series.slice(i - lookback, i).map((row) => row.close))) continue;
      breakouts++;
      if (series[i + 1].close < series[i].close) reversals++;
    }
    return {
      symbol: ticker, observations: series.length, upDayRate: changes.length ? upDays / changes.length : null,
      followThroughRate: upWithNext.length ? upWithNext.filter((change) => change > 0).length / upWithNext.length : null,
      followThroughSample: upWithNext.length, breakouts, breakoutReversalRate: breakouts ? reversals / breakouts : null,
    };
  });
  return { lookback, rows };
}

function newsMonitor(input) {
  const asOf = day(input.asOf, 'asOf');
  const selection = input.symbols == null ? null : new Set(records(input.symbols, 'symbols').map(symbol));
  const rows = new Map();
  for (const event of records(input.events, 'events')) {
    const ticker = symbol(event.symbol);
    const date = day(event.date);
    if (date > asOf || (selection && !selection.has(ticker))) continue;
    const row = { symbol: ticker, title: text(event.title, 'event title'), url: url(event.url), date, type: text(event.type, 'event type') };
    rows.set(JSON.stringify([ticker, date, row.url, row.title]), row);
  }
  const events = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol));
  const eventCounts = new Map();
  for (const row of events) eventCounts.set(row.symbol, (eventCounts.get(row.symbol) ?? 0) + 1);
  const coverage = [...(selection ?? eventCounts.keys())].sort().map((ticker) => ({ symbol: ticker, eventCount: eventCounts.get(ticker) ?? 0 }));
  return { asOf, rows: events, coverage };
}

function fuseNews(input) {
  const asOf = day(input.asOf, 'asOf');
  const lookbackDays = integer(input.lookbackDays ?? 30, 'lookbackDays', 1, 365);
  const candidates = unique(records(input.candidates, 'candidates').map((row) => ({
    symbol: symbol(row.symbol), technicalScore: finite(row.technicalScore, 'technicalScore'),
  })), (row) => row.symbol, 'candidate');
  const news = newsMonitor({ asOf, symbols: candidates.map((row) => row.symbol), events: input.events }).rows;
  const byTicker = new Map();
  for (const item of news) {
    if ((Date.parse(asOf) - Date.parse(item.date)) / DAY_MS >= lookbackDays) continue;
    if (!byTicker.has(item.symbol)) byTicker.set(item.symbol, []);
    byTicker.get(item.symbol).push(item);
  }
  return { asOf, lookbackDays, rows: candidates.map((row) => {
    const evidence = byTicker.get(row.symbol) ?? [];
    return { ...row, evidence, eventCount: evidence.length, latestEvidenceDate: evidence[0]?.date ?? null };
  }).sort((a, b) => b.technicalScore - a.technicalScore) };
}

function priceAlert(input) {
  const ticker = symbol(input.symbol);
  const close = positive(input.close, 'close');
  const below = input.thresholds?.below == null ? null : positive(input.thresholds.below, 'below threshold');
  const above = input.thresholds?.above == null ? null : positive(input.thresholds.above, 'above threshold');
  if (below != null && above != null && below >= above) throw new Error('The below threshold must be lower than the above threshold.');
  const priceConditions = [];
  if (below != null) priceConditions.push({ condition: 'at_or_below', threshold: below, triggered: close <= below });
  if (above != null) priceConditions.push({ condition: 'at_or_above', threshold: above, triggered: close >= above });
  if (!priceConditions.length && !input.valuation) throw new Error('Supply a price threshold or DCF assumptions.');
  const valuation = [];
  if (input.valuation) {
    const { baseFcff, years, discountRate, terminalGrowth, netDebt, shares, growthRates } = input.valuation;
    finite(baseFcff, 'baseFcff');
    integer(years, 'years', 1, 30);
    finite(discountRate, 'discountRate', 0.0001, 2);
    finite(terminalGrowth, 'terminalGrowth', -0.99, 1);
    finite(netDebt, 'netDebt');
    positive(shares, 'shares');
    if (discountRate <= terminalGrowth) throw new Error('The discount rate must exceed terminal growth.');
    let previousGrowth = -Infinity;
    for (const scenario of ['bear', 'base', 'bull']) {
      const growth = finite(growthRates?.[scenario], `${scenario} growth`, -0.99, 3);
      if (growth < previousGrowth) throw new Error('Growth assumptions must be ordered bear, base, bull.');
      previousGrowth = growth;
      let fcff = baseFcff;
      let enterpriseValue = 0;
      for (let year = 1; year <= years; year++) {
        fcff *= 1 + growth;
        enterpriseValue += fcff / (1 + discountRate) ** year;
      }
      const terminalValue = fcff * (1 + terminalGrowth) / (discountRate - terminalGrowth);
      enterpriseValue += terminalValue / (1 + discountRate) ** years;
      const equityValue = enterpriseValue - netDebt;
      const valuePerShare = equityValue / shares;
      valuation.push({ scenario, growth, enterpriseValue, equityValue, valuePerShare, upside: valuePerShare / close - 1 });
    }
  }
  return { symbol: ticker, close, priceConditions, valuation };
}

function earningsReview(input) {
  const asOf = day(input.date);
  const rows = ['revenue', 'eps'].map((measure) => {
    const actual = optionalNumber(input.actual?.[measure], `actual ${measure}`);
    const expected = optionalNumber(input.expected?.[measure], `expected ${measure}`);
    return { measure, actual, expected, difference: actual == null || expected == null ? null : actual - expected, surprise: relativeChange(actual, expected) };
  });
  const commentary = records(input.commentary ?? [], 'commentary', 100).map((row) => ({
    topic: text(row.topic, 'commentary topic'), statement: text(row.statement, 'commentary statement'),
    evidence: evidenceRows(row.evidence, asOf),
  }));
  return { symbol: symbol(input.symbol), date: asOf, rows, commentary };
}

function dailyVolatility(series) {
  const changes = series.slice(1).flatMap((row, index) => {
    const previous = series[index];
    return row && previous ? [row.close / previous.close - 1] : [];
  });
  const observations = changes.length;
  if (observations < 2) return { value: null, observations };
  const average = mean(changes);
  const value = Math.sqrt(total(changes.map((change) => (change - average) ** 2)) / (observations - 1));
  return { value, observations };
}

function firstSessionOnOrAfter(series, date) {
  let left = 0;
  let right = series.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (series[middle].date < date) left = middle + 1;
    else right = middle;
  }
  return left;
}

function earningsAlpha(input) {
  const horizons = [...new Set(records(input.horizons ?? [1, 5, 20], 'horizons', 10).map((value) => integer(value, 'horizon', 1, 250)))].sort((a, b) => a - b);
  if (!horizons.length) throw new Error('Supply at least one earnings horizon.');
  const prices = groupedPrices(input.prices);
  const calendar = input.sessions === undefined ? null
    : unique(records(input.sessions, 'sessions', 50_000).map((value) => day(value, 'session date')), (value) => value, 'session date')
      .sort().map((date) => ({ date }));
  if (calendar && !calendar.length) throw new Error('Supply at least one session date.');
  const pricesByDate = calendar && new Map([...prices].map(([ticker, series]) => [
    ticker, new Map(series.map((row) => [row.date, row])),
  ]));
  const events = unique(records(input.events, 'events').map((event) => ({
    ...event, symbol: symbol(event.symbol), date: day(event.date),
  })), (event) => `${event.symbol}/${event.date}`, 'earnings event');
  const rows = events.map((event) => {
    const series = calendar ?? prices.get(event.symbol) ?? [];
    const tickerPrices = pricesByDate?.get(event.symbol);
    const priceAt = calendar ? (session) => tickerPrices?.get(session.date) : (row) => row;
    const cutoff = firstSessionOnOrAfter(series, event.date);
    const firstAfter = series[cutoff]?.date === event.date ? cutoff + 1 : cutoff;
    const before = series.slice(Math.max(0, cutoff - 21), cutoff).map(priceAt);
    const after = series.slice(firstAfter, firstAfter + Math.max(21, horizons.at(-1))).map(priceAt);
    const base = before.at(-1);
    const preVolatility = dailyVolatility(before);
    const postVolatility = dailyVolatility(after.slice(0, 21));
    const actualEps = optionalNumber(event.actualEps, 'actualEps');
    const expectedEps = optionalNumber(event.expectedEps, 'expectedEps');
    const priorEstimate = optionalNumber(event.priorEstimate, 'priorEstimate');
    const revisedEstimate = optionalNumber(event.revisedEstimate, 'revisedEstimate');
    return {
      symbol: event.symbol, date: event.date, baseDate: base?.date ?? null,
      actualEps, expectedEps, epsSurprise: relativeChange(actualEps, expectedEps),
      estimateRevision: relativeChange(revisedEstimate, priorEstimate),
      evidence: evidenceRows(event.evidence, event.date),
      returns: horizons.map((sessions) => ({
        sessions, date: after[sessions - 1]?.date ?? null,
        return: base && after[sessions - 1] ? after[sessions - 1].close / base.close - 1 : null,
      })),
      preVolatility: preVolatility.value, postVolatility: postVolatility.value,
      preVolatilityObservations: preVolatility.observations, postVolatilityObservations: postVolatility.observations,
    };
  });
  return { horizons, rows };
}

function crossCheck(input) {
  const tolerance = finite(input.tolerance ?? 0.01, 'tolerance', 0);
  const rows = unique(records(input.reports, 'reports').map((report) => {
    const period = day(report.period, 'period');
    const consolidated = finite(report.consolidated, 'consolidated');
    const lines = unique(records(report.lines, 'lines', 100).map((line) => ({
      name: text(line.name, 'line name'), value: finite(line.value, 'line value'), evidence: evidenceRows(line.evidence, report.asOf ? day(report.asOf, 'asOf') : null),
    })), (line) => line.name.toLowerCase(), 'business line');
    const reconciled = total(lines.map((line) => line.value)) + finite(report.eliminations ?? 0, 'eliminations');
    const difference = reconciled - consolidated;
    return {
      period, consolidated, reconciled, difference, matches: Math.abs(difference) <= tolerance, lines,
      unsupportedLines: lines.filter((line) => !line.evidence.length).map((line) => line.name),
    };
  }), (row) => row.period, 'report period').sort((a, b) => a.period.localeCompare(b.period));
  return { measure: text(input.measure, 'measure'), tolerance, rows: rows.map((row, index) => ({
    ...row, periodChange: index ? relativeChange(row.consolidated, rows[index - 1].consolidated) : null,
  })) };
}

function profitabilityCycle(input) {
  const tolerance = finite(input.tolerance ?? 0.005, 'tolerance', 0, 1);
  const companies = unique(records(input.companies, 'companies').map((company) => {
    const periods = unique(records(company.periods, 'periods', 100).map((row) => {
      const revenue = positive(row.revenue, 'revenue');
      const operatingIncome = finite(row.operatingIncome, 'operatingIncome');
      return { date: day(row.date), revenue, operatingIncome, margin: operatingIncome / revenue };
    }), (row) => row.date, 'profitability period').sort((a, b) => a.date.localeCompare(b.date));
    const last = periods.at(-1);
    const prior = periods.at(-2);
    const marginChange = last && prior ? last.margin - prior.margin : null;
    const phase = marginChange == null ? 'insufficient_history'
      : Math.abs(marginChange) <= tolerance ? 'stable'
      : marginChange > 0 ? (last.margin < 0 ? 'loss_narrowing' : 'expanding') : (last.margin < 0 ? 'loss_deepening' : 'contracting');
    return { symbol: symbol(company.symbol), industry: text(company.industry, 'industry'), phase, marginChange, periods };
  }), (row) => row.symbol, 'company');
  const industryGroups = new Map();
  for (const company of companies) {
    if (!industryGroups.has(company.industry)) industryGroups.set(company.industry, []);
    if (company.marginChange != null) industryGroups.get(company.industry).push(company.marginChange);
  }
  const industries = [...industryGroups].map(([industry, changes]) => ({ industry, companiesWithHistory: changes.length, meanMarginChange: mean(changes) }));
  return { tolerance, rows: companies, industries };
}

function linkedStatements(input) {
  const opening = {};
  for (const field of ['cash', 'receivables', 'inventory', 'ppe', 'payables', 'debt', 'equity']) {
    opening[field] = finite(input.opening?.[field], `opening ${field}`, field === 'equity' ? -1e18 : 0);
  }
  const beginningAssets = opening.cash + opening.receivables + opening.inventory + opening.ppe;
  const beginningLiabilities = opening.payables + opening.debt;
  const openingImbalance = beginningAssets - beginningLiabilities - opening.equity;
  const periods = unique(records(input.periods, 'periods', 100).map((row) => ({ ...row, period: day(row.period, 'period') })), (row) => row.period, 'forecast period')
    .sort((a, b) => a.period.localeCompare(b.period));
  let prior = opening;
  const rows = periods.map((row) => {
    const forecast = {};
    for (const field of ['revenue', 'cogs', 'opex', 'depreciation', 'interest', 'taxes', 'capex', 'receivables', 'inventory', 'payables', 'netBorrowing', 'dividends']) {
      forecast[field] = finite(row[field], field, ['taxes', 'netBorrowing'].includes(field) ? -1e18 : 0);
    }
    const { revenue, cogs, opex, depreciation, interest, taxes, capex, receivables, inventory, payables, netBorrowing, dividends } = forecast;
    const grossProfit = revenue - cogs;
    const operatingIncome = grossProfit - opex - depreciation;
    const netIncome = operatingIncome - interest - taxes;
    const operating = netIncome + depreciation - (receivables - prior.receivables) - (inventory - prior.inventory) + (payables - prior.payables);
    const investing = -capex;
    const financing = netBorrowing - dividends;
    const netChange = operating + investing + financing;
    const cash = prior.cash + netChange;
    const ppe = prior.ppe + capex - depreciation;
    const debt = prior.debt + netBorrowing;
    const equity = prior.equity + netIncome - dividends;
    const totalAssets = cash + receivables + inventory + ppe;
    const totalLiabilities = payables + debt;
    const imbalance = totalAssets - totalLiabilities - equity;
    const balanced = Math.abs(imbalance) <= Math.max(1e-7, Math.max(Math.abs(totalAssets), Math.abs(totalLiabilities), Math.abs(equity)) * 1e-10);
    const flags = Object.entries({ cash, ppe, debt }).filter(([, value]) => value < 0).map(([field]) => `negative_${field}`);
    prior = { cash, receivables, inventory, ppe, payables, debt, equity };
    return {
      period: row.period, income: { revenue, cogs, grossProfit, opex, depreciation, operatingIncome, interest, taxes, netIncome },
      balance: { ...prior, totalAssets, totalLiabilities, imbalance, balanced, flags },
      cashFlow: { operating, investing, financing, netChange },
    };
  });
  return { openingImbalance, rows };
}

const AS_OF = '2025-02-10';
const SOURCE = { title: 'Illustrative company disclosure', url: 'https://example.com/company-disclosure', date: '2025-02-03' };
const STUDY = { title: 'Illustrative technical study', url: 'https://example.org/technical-study', date: '2025-01-24' };
const PRICES = [
  ['2025-02-03', 100, 40], ['2025-02-04', 104, 41], ['2025-02-05', 102, 39],
  ['2025-02-06', 106, 42], ['2025-02-07', 108, 42.5], ['2025-02-10', 105, 43],
].flatMap(([date, demo, test]) => [{ symbol: 'DEMO', date, close: demo }, { symbol: 'TEST', date, close: test }]);
const EVENT = { symbol: 'DEMO', title: SOURCE.title, url: SOURCE.url, date: SOURCE.date, type: 'company_disclosure' };

export const companyCapabilities = {
  'source-to-trade-universe-resolver': {
    inputs: 'asOf YYYY-MM-DD, universe[{symbol,active:boolean}], shortlist[{symbol,date}].',
    example: { asOf: AS_OF, universe: [{ symbol: 'DEMO', active: true }], shortlist: [{ symbol: 'DEMO', date: '2025-02-07' }, { symbol: 'TEST', date: '2025-02-07' }] },
    run: resolveUniverse,
  },
  'company-due-diligence-router': {
    inputs: 'symbol, asOf YYYY-MM-DD, evidence keyed by business, financials, competition, governance, valuation with [{title,url,date}].',
    example: { symbol: 'DEMO', asOf: AS_OF, evidence: { business: [SOURCE], competition: [STUDY] } },
    run: dueDiligence,
  },
  'a-share-civilization-enrichment': {
    inputs: 'companies[{symbol,asOf,revenue?,marketCap?,operatingIncome?,operatingYears?,segments?:[{name,revenue}]}], monetary amounts in consistent units.',
    example: { companies: [{ symbol: 'DEMO', asOf: AS_OF, revenue: 1000, marketCap: 2700, operatingIncome: 125, operatingYears: 9, segments: [{ name: 'Industrial equipment', revenue: 620 }, { name: 'Services', revenue: 270 }] }] },
    run: enrich,
  },
  'openai-civilization-research-router': {
    inputs: 'themes:string[], candidates[{symbol,attentionRank:positive integer,themes:string[],evidence?:[{title,url,date}]}].',
    example: { themes: ['Grid automation'], candidates: [{ symbol: 'DEMO', attentionRank: 12, themes: ['Grid automation'], evidence: [SOURCE] }, { symbol: 'TEST', attentionRank: 4, themes: ['Software'] }] },
    run: attentionScreen,
  },
  'frontier-breakthrough-detector': {
    inputs: 'asOf YYYY-MM-DD, advances[{id,theme,title,stage:lab|pilot|commercial,evidence?:[{title,url,date}]}].',
    example: { asOf: AS_OF, advances: [{ id: 'example-pilot', theme: 'Grid automation', title: 'Illustrative grid controller pilot', stage: 'pilot', evidence: [STUDY] }] },
    run: breakthrough,
  },
  'frontier-stock-pool': {
    inputs: 'asOf? YYYY-MM-DD, companies[{symbol,name,revenue?,marketCap?,exposures:[{theme,revenueShare?:fraction,evidence?:[{title,url,date}]}]}].',
    example: { asOf: AS_OF, companies: [{ symbol: 'DEMO', name: 'Illustrative Equipment Co.', revenue: 1000, marketCap: 2700, exposures: [{ theme: 'Grid automation', revenueShare: 0.26, evidence: [SOURCE] }] }] },
    run: frontierPool,
  },
  'civilization-admission-gate': {
    inputs: 'asOf YYYY-MM-DD, minSources?:integer distinct source hosts, requiredThemes?:string[], candidates[{symbol,themes:string[],disqualifyingRisk?:boolean,evidence?:[{title,url,date}]}].',
    example: { asOf: AS_OF, minSources: 2, requiredThemes: ['Grid automation'], candidates: [{ symbol: 'DEMO', themes: ['Grid automation'], evidence: [SOURCE, STUDY] }, { symbol: 'TEST', themes: ['Software'], evidence: [SOURCE] }] },
    run: admission,
  },
  'civilization-stock-research-orchestrator': {
    inputs: 'asOf YYYY-MM-DD, batchSize?:integer, candidates[{symbol,priority:number,questions?:string[],evidence?:[{title,url,date}]}].',
    example: { asOf: AS_OF, batchSize: 1, candidates: [{ symbol: 'DEMO', priority: 8, questions: ['What share of revenue is tied to new installations?'], evidence: [SOURCE] }, { symbol: 'TEST', priority: 2, questions: ['Which sources substantiate the thesis?'] }] },
    run: researchPlan,
  },
  'civilization-ai-trading-system-review': {
    inputs: 'asOf YYYY-MM-DD, maxAgeDays?:integer, symbols:string[], reports[{symbol,date,readable:boolean,evidence?:[{title,url,date}]}].',
    example: { asOf: AS_OF, maxAgeDays: 30, symbols: ['DEMO', 'TEST'], reports: [{ symbol: 'DEMO', date: '2025-02-05', readable: true, evidence: [SOURCE] }] },
    run: researchAudit,
  },
  'resonance-stock-router': {
    inputs: 'candidates[{symbol,macro?,liquidity?,style?,valuation?,trend?}] with scores from −1 to 1, weights?:object keyed by dimension.',
    example: { candidates: [{ symbol: 'DEMO', macro: 0.25, liquidity: 0.4, trend: 0.65 }, { symbol: 'TEST', style: -0.6, trend: 0.2 }], weights: { macro: 1, trend: 2 } },
    run: resonance,
  },
  'chan-fractal-similarity-router': {
    inputs: 'reference symbol, timeframe?:string, lookback?:integer, prices[{symbol,date,close:number}]. Compare complete, equal-length windows from the same timeframe.',
    example: { reference: 'DEMO', timeframe: 'daily', lookback: 5, prices: PRICES },
    run: structureSimilarity,
  },
  'stock-character-router': {
    inputs: 'lookback?:integer for breakout comparison, prices[{symbol,date,close:number}] with one observation per session.',
    example: { lookback: 2, prices: PRICES },
    run: stockCharacter,
  },
  'stock-news-monitor-router': {
    inputs: 'asOf YYYY-MM-DD, symbols?:string[], events[{symbol,title,url,date,type}].',
    example: { asOf: AS_OF, symbols: ['DEMO', 'TEST'], events: [EVENT] },
    run: newsMonitor,
  },
  'candidate-news-fusion-router': {
    inputs: 'asOf YYYY-MM-DD, lookbackDays?:integer, candidates[{symbol,technicalScore:number}], events[{symbol,title,url,date,type}].',
    example: { asOf: AS_OF, lookbackDays: 10, candidates: [{ symbol: 'DEMO', technicalScore: 0.72 }, { symbol: 'TEST', technicalScore: 0.61 }], events: [EVENT] },
    run: fuseNews,
  },
  'price-alert-router': {
    inputs: 'symbol, close:number, thresholds?:{below?,above?}, valuation?:{baseFcff,years,discountRate,terminalGrowth,netDebt,shares,growthRates:{bear,base,bull}}. Rates are fractions.',
    example: { symbol: 'DEMO', close: 28, thresholds: { below: 25, above: 32 }, valuation: { baseFcff: 140, years: 5, discountRate: 0.10, terminalGrowth: 0.025, netDebt: 125, shares: 85, growthRates: { bear: 0.015, base: 0.05, bull: 0.09 } } },
    run: priceAlert,
  },
  'earnings-review': {
    inputs: 'symbol, date YYYY-MM-DD, actual:{revenue?,eps?}, expected:{revenue?,eps?}, commentary?:[{topic,statement,evidence?:[{title,url,date}]}].',
    example: { symbol: 'DEMO', date: AS_OF, actual: { revenue: 145, eps: 0.52 }, expected: { revenue: 140, eps: 0.5 }, commentary: [{ topic: 'Capacity', statement: 'Illustrative management comment on new installations.', evidence: [SOURCE] }] },
    run: earningsReview,
  },
  'earnings-alpha-engine': {
    inputs: 'events[{symbol,date,actualEps?,expectedEps?,priorEstimate?,revisedEstimate?,evidence?:[{title,url,date}]}], prices[{symbol,date,close}], horizons?:positive session counts, sessions?:benchmark session dates. With a calendar, use exact pre- and post-event sessions.',
    example: { events: [{ symbol: 'DEMO', date: '2025-02-05', actualEps: 0.52, expectedEps: 0.5, priorEstimate: 0.51, revisedEstimate: 0.54 }], prices: PRICES, horizons: [1, 2, 5], sessions: [...new Set(PRICES.map((row) => row.date))] },
    run: earningsAlpha,
  },
  'agent-cross-penetration-review': {
    inputs: 'measure:string, tolerance?:number, reports[{period,asOf?,consolidated,eliminations?,lines:[{name,value,evidence?:[{title,url,date}]}]}].',
    example: { measure: 'Revenue', tolerance: 0.01, reports: [{ period: '2024-12-31', asOf: AS_OF, consolidated: 245, eliminations: -5, lines: [{ name: 'Equipment', value: 170, evidence: [SOURCE] }, { name: 'Services', value: 80, evidence: [SOURCE] }] }] },
    run: crossCheck,
  },
  'profitability-cycle': {
    inputs: 'tolerance?:fractional margin difference, companies[{symbol,industry,periods:[{date,revenue,operatingIncome}]}].',
    example: { companies: [{ symbol: 'DEMO', industry: 'Equipment', periods: [{ date: '2024-09-30', revenue: 120, operatingIncome: 9 }, { date: '2024-12-31', revenue: 145, operatingIncome: 17 }] }] },
    run: profitabilityCycle,
  },
  '3-statements-ultra': {
    inputs: 'opening:{cash,receivables,inventory,ppe,payables,debt,equity}, periods:[{period,revenue,cogs,opex,depreciation,interest,taxes,capex,receivables,inventory,payables,netBorrowing,dividends}]. Use consistent monetary units.',
    example: { opening: { cash: 30, receivables: 25, inventory: 20, ppe: 125, payables: 25, debt: 75, equity: 100 }, periods: [{ period: '2025-03-31', revenue: 100, cogs: 55, opex: 18, depreciation: 5, interest: 4, taxes: 4, capex: 7, receivables: 28, inventory: 22, payables: 27, netBorrowing: -3, dividends: 2 }] },
    run: linkedStatements,
  },
};
