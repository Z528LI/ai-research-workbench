import {
  byDate, capability, check, choice, date, daysBetween, flag, group, integer, key, link, list,
  mean, number, prices, record, rows, sd, sources, symbol, text, unique
} from './market-inputs.mjs';

const DAY = '2025-02-03';
const NEXT = '2025-02-04';
const SOURCE = 'https://example.org/illustrative';
const tagList = (input, name) => unique(list(input, name, 0, 100).map(value => text(value, name)), value => value, name);

function validateData({ asOf, artifacts, datePairs = [], maxAgeDays = 7 }) {
  const end = date(asOf, 'asOf');
  integer(maxAgeDays, 'maxAgeDays', 0, 3650);
  const manifest = rows(artifacts, 'artifacts').map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    source: link(row.source, 'source'), expectedSource: row.expectedSource == null ? null : link(row.expectedSource, 'expectedSource'),
    dependencies: tagList(row.dependencies ?? [], 'dependencies') }));
  unique(manifest, row => row.id, 'artifacts');
  const index = new Map(manifest.map(row => [row.id, row]));
  const findings = [];
  const children = new Map();
  const indegrees = new Map();
  for (const item of manifest) {
    const age = daysBetween(item.date, end);
    if (age < 0 || age > maxAgeDays) findings.push({ id: item.id, issue: age < 0 ? 'future-date' : 'stale', ageDays: age });
    if (item.expectedSource && item.source !== item.expectedSource) findings.push({ id: item.id, issue: 'source-mismatch' });
    let count = 0;
    for (const dependency of item.dependencies) {
      const upstream = index.get(dependency);
      if (!upstream) {
        findings.push({ id: item.id, issue: 'missing-dependency', dependency });
        continue;
      }
      if (!children.has(dependency)) children.set(dependency, []);
      children.get(dependency).push(item.id);
      count++;
      if (upstream.date > item.date) findings.push({ id: item.id, issue: 'dependency-newer-than-artifact', dependency });
    }
    indegrees.set(item.id, count);
  }
  const ready = manifest.filter(row => indegrees.get(row.id) === 0).map(row => row.id);
  for (let i = 0; i < ready.length; i++) {
    for (const child of children.get(ready[i]) ?? []) {
      const pending = indegrees.get(child) - 1;
      indegrees.set(child, pending);
      if (pending === 0) ready.push(child);
    }
  }
  if (ready.length !== manifest.length) findings.push({ issue: 'cyclic-dependencies', unresolved: manifest.filter(row => indegrees.get(row.id) > 0).map(row => row.id) });
  for (const pair of rows(datePairs, 'datePairs', 0)) {
    const left = text(pair.left, 'left');
    const right = text(pair.right, 'right');
    if (!index.has(left) || !index.has(right)) findings.push({ issue: 'missing-date-comparison', left, right });
    else if (index.get(left).date !== index.get(right).date) findings.push({ issue: 'cross-output-date-mismatch', left, right });
  }
  return { asOf: end, checked: manifest.length, passed: findings.length === 0, findings, dependencyOrder: ready };
}

function hardenQuality({ datasets, minimumCoverage = 0.95 }) {
  number(minimumCoverage, 'minimumCoverage', 0, 1);
  const quality = rows(datasets, 'datasets').map(row => {
    const name = text(row.name, 'name');
    const expectedRows = integer(row.expectedRows, 'expectedRows', 1, 1e9);
    const observedRows = integer(row.observedRows, 'observedRows', 0, 1e9);
    const duplicateRows = integer(row.duplicateRows, 'duplicateRows', 0, observedRows);
    const checkedFields = integer(row.checkedFields, 'checkedFields', 1, 1000);
    const missingCells = integer(row.missingCells, 'missingCells', 0, observedRows * checkedFields);
    const evidence = sources(row.evidence);
    const coverage = Math.min(1, (observedRows - duplicateRows) / expectedRows);
    const issues = [];
    if (coverage < minimumCoverage) issues.push('coverage-below-target');
    if (observedRows - duplicateRows > expectedRows) issues.push('unexpected-extra-rows');
    if (duplicateRows) issues.push('duplicate-rows');
    if (missingCells) issues.push('missing-cells');
    if (!evidence.length) issues.push('evidence-unlinked');
    return { name, coverage, missingCellRate: observedRows ? missingCells / (observedRows * checkedFields) : null,
      expectedRows, observedRows, duplicateRows, evidence, issues };
  });
  unique(quality, row => row.name, 'datasets');
  return { minimumCoverage, checked: quality.length, flagged: quality.filter(row => row.issues.length).length, datasets: quality };
}

function characterValidation({ samples }) {
  const points = rows(samples, 'samples').map(row => {
    const signalDate = date(row.signalDate, 'signalDate');
    const outcomeDate = date(row.outcomeDate, 'outcomeDate');
    check(outcomeDate > signalDate, 'Character validation outcomes must follow their signal dates.');
    return { tag: text(row.tag, 'tag'), symbol: symbol(row.symbol), signalDate, outcomeDate,
      forwardReturn: number(row.forwardReturn, 'forwardReturn', -1, 100) };
  });
  unique(points, row => key(row.tag, row.symbol, row.signalDate, row.outcomeDate), 'samples');
  return { observations: points.length, sampleMean: mean(points.map(row => row.forwardReturn)),
    groups: [...group(points, row => row.tag)].map(([tag, series]) => {
      const returns = series.map(row => row.forwardReturn);
      return { tag, observations: returns.length, meanReturn: mean(returns),
        positiveShare: returns.filter(value => value > 0).length / returns.length, dispersion: sd(returns) };
    }) };
}

function alertCalibration({ alerts, minimumMove = 0 }) {
  number(minimumMove, 'minimumMove', 0, 100);
  const items = rows(alerts, 'alerts').map(row => ({ id: text(row.id, 'id'), triggered: flag(row.triggered, 'triggered'),
    direction: choice(row.direction, 'direction', ['up', 'down']),
    returnAfter: row.returnAfter == null ? null : number(row.returnAfter, 'returnAfter', -1, 100) }));
  unique(items, row => row.id, 'alerts');
  const confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  let pending = 0;
  for (const row of items) {
    if (row.returnAfter === null) { pending++; continue; }
    const move = (row.direction === 'up' ? 1 : -1) * row.returnAfter;
    const qualified = move > 0 && move >= minimumMove;
    if (row.triggered) confusion[qualified ? 'truePositive' : 'falsePositive']++;
    else confusion[qualified ? 'falseNegative' : 'trueNegative']++;
  }
  const { truePositive, falsePositive, falseNegative } = confusion;
  return { minimumMove, pending, assessed: items.length - pending, ...confusion,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null };
}

function eventFeedback({ events }) {
  const results = rows(events, 'events').map(row => {
    const eventDate = date(row.eventDate, 'eventDate');
    const outcomeDate = row.outcomeDate == null ? null : date(row.outcomeDate, 'outcomeDate');
    const observed = row.return == null && row.benchmarkReturn == null && outcomeDate === null ? null
      : number(row.return, 'return', -1, 100) - number(row.benchmarkReturn, 'benchmarkReturn', -1, 100);
    check(observed === null || (outcomeDate && outcomeDate > eventDate), 'Event outcomes require a date after the event.');
    return { id: text(row.id, 'id'), symbol: symbol(row.symbol), category: text(row.category, 'category'), eventDate, outcomeDate, excessReturn: observed };
  });
  unique(results, row => row.id, 'events');
  return { events: results, categories: [...group(results, row => row.category)].map(([category, series]) => {
    const values = series.map(row => row.excessReturn).filter(value => value !== null);
    return { category, observed: values.length, pending: series.length - values.length, meanExcess: mean(values),
      positiveShare: values.length ? values.filter(value => value > 0).length / values.length : null };
  }) };
}

function scenarioCalibration({ forecasts }) {
  const assessments = rows(forecasts, 'forecasts').map(row => {
    const issuedOn = date(row.issuedOn, 'issuedOn');
    const resolvedOn = date(row.resolvedOn, 'resolvedOn');
    check(resolvedOn > issuedOn, 'Scenario resolution must follow the forecast.');
    const actual = text(row.actual, 'actual');
    const distribution = Object.entries(record(row.probabilities, 'probabilities'));
    check(distribution.length >= 2 && distribution.length <= 100 && Object.hasOwn(row.probabilities, actual), 'Probabilities must include at least two scenarios and the observed outcome.');
    const total = distribution.reduce((sum, [name, probability]) => {
      text(name, 'scenario');
      return sum + number(probability, 'probability', 0, 1);
    }, 0);
    check(Math.abs(total - 1) < 1e-8, 'Scenario probabilities must sum to 1.');
    const observedProbability = row.probabilities[actual];
    const brier = distribution.reduce((sum, [name, probability]) => sum + (probability - Number(name === actual)) ** 2, 0);
    return { id: text(row.id, 'id'), issuedOn, resolvedOn, actual, observedProbability, brier,
      logLoss: observedProbability === 0 ? null : -Math.log(observedProbability) };
  });
  unique(assessments, row => row.id, 'forecasts');
  const finite = assessments.filter(row => row.logLoss !== null);
  return { observations: assessments.length, meanBrier: mean(assessments.map(row => row.brier)),
    meanFiniteLogLoss: mean(finite.map(row => row.logLoss)), zeroProbabilityOutcomes: assessments.length - finite.length, rows: assessments };
}

function sleeveReview({ periods }) {
  const results = rows(periods, 'periods').map(row => {
    const startValue = number(row.startValue, 'startValue', 1e-12, 1e12);
    const endValue = number(row.endValue, 'endValue', 0, 1e12);
    const netFlow = number(row.netFlow, 'netFlow');
    const benchmarkReturn = number(row.benchmarkReturn, 'benchmarkReturn', -1, 100);
    const adjustedGain = endValue - startValue - netFlow;
    const returnOnStartingCapital = adjustedGain / startValue;
    return { sleeve: text(row.sleeve, 'sleeve'), date: date(row.date), adjustedGain, returnOnStartingCapital,
      benchmarkReturn, excess: returnOnStartingCapital - benchmarkReturn };
  });
  unique(results, row => key(row.sleeve, row.date), 'periods').sort(byDate);
  return { method: 'simple net-flow-adjusted return on starting capital', periods: results,
    sleeves: [...group(results, row => row.sleeve)].map(([sleeve, series]) => ({ sleeve, observations: series.length,
      meanReturn: mean(series.map(row => row.returnOnStartingCapital)), meanExcess: mean(series.map(row => row.excess)),
      adjustedGain: series.reduce((sum, row) => sum + row.adjustedGain, 0) })) };
}

function signalEvaluation({ signals, prices: input, horizons = [1, 5, 20], sessions }) {
  const observations = prices(input);
  const period = unique(list(horizons, 'horizons', 1, 20).map(value => integer(value, 'horizon', 1, 252)), value => value, 'horizons').sort((a, b) => a - b);
  const reference = sessions === undefined ? [...new Set(observations.map(row => row.date))] :
    unique(list(sessions, 'sessions').map(value => date(value)), value => value, 'sessions').sort();
  const positions = new Map(reference.map((day, index) => [day, index]));
  check(observations.every(row => positions.has(row.date)), 'Every price date must be present in sessions.');
  const closes = new Map(observations.map(row => [key(row.symbol, row.date), row.close]));
  const items = rows(signals, 'signals', 1, 5000).map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    symbol: symbol(row.symbol), direction: choice(row.direction ?? 'up', 'direction', ['up', 'down', 'long', 'short']) }));
  unique(items, row => row.id, 'signals').sort(byDate);
  const results = items.map(row => {
    const offset = positions.get(row.date);
    const initial = closes.get(key(row.symbol, row.date));
    const sign = row.direction === 'up' || row.direction === 'long' ? 1 : -1;
    return { ...row, outcomes: period.map(sessions => {
      const target = offset === undefined ? null : reference[offset + sessions] ?? null;
      const ending = target === null ? undefined : closes.get(key(row.symbol, target));
      const move = initial === undefined || ending === undefined ? null : ending / initial - 1;
      return { sessions, date: target, return: move, directionalReturn: move === null ? null : sign * move };
    }) };
  });
  const summary = period.map((sessions, i) => {
    const values = results.map(row => row.outcomes[i].directionalReturn).filter(value => value !== null);
    return { sessions, observed: values.length, mean: mean(values), hitRate: values.length ? values.filter(value => value > 0).length / values.length : null };
  });
  return { horizons: period, rows: results, summary, sessionBasis: sessions === undefined ? 'submitted price dates' : 'supplied trading calendar' };
}

function decisionLedger({ proposals, gates = [], outcomes = [] }) {
  const items = rows(proposals, 'proposals').map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    symbol: symbol(row.symbol), thesis: text(row.thesis, 'thesis') }));
  unique(items, row => row.id, 'proposals').sort(byDate);
  const proposalsById = new Map(items.map(row => [row.id, row]));
  const checks = rows(gates, 'gates', 0).map(row => {
    const id = text(row.id, 'id');
    const day = date(row.date);
    check(proposalsById.has(id) && day >= proposalsById.get(id).date, 'Gate must follow its associated proposal.');
    return { id, date: day, status: choice(row.status, 'status', ['allowed', 'blocked', 'deferred']), reason: text(row.reason, 'reason') };
  });
  unique(checks, row => row.id, 'gates');
  const checksById = new Map(checks.map(row => [row.id, row]));
  const results = rows(outcomes, 'outcomes', 0).map(row => {
    const id = text(row.id, 'id');
    const day = date(row.date);
    check(proposalsById.has(id) && day > (checksById.get(id)?.date ?? proposalsById.get(id).date), 'Outcome must follow its proposal and any associated gate.');
    return { id, date: day, return: number(row.return, 'return', -1, 100) };
  });
  unique(results, row => key(row.id, row.date), 'outcomes').sort(byDate);
  const byProposal = group(results, row => row.id);
  return { proposals: items.length, reviewed: checks.length, outcomes: results.length,
    ledger: items.map(row => ({ ...row, gate: checksById.get(row.id) ?? null, outcomes: byProposal.get(row.id) ?? [] })) };
}

function gateRegret({ cases, opportunityThreshold = 0 }) {
  number(opportunityThreshold, 'opportunityThreshold', 0, 100);
  const assessments = rows(cases, 'cases').map(row => {
    const gate = choice(row.gate, 'gate', ['allowed', 'blocked']);
    const outcomeReturn = row.outcomeReturn == null ? null : number(row.outcomeReturn, 'outcomeReturn', -100, 100);
    let classification = 'unresolved';
    if (outcomeReturn !== null) {
      if (Math.abs(outcomeReturn) <= opportunityThreshold) classification = 'within-threshold';
      else if (gate === 'blocked') classification = outcomeReturn > 0 ? 'missed-positive' : 'avoided-negative';
      else classification = outcomeReturn > 0 ? 'allowed-positive' : 'allowed-negative';
    }
    return { id: text(row.id, 'id'), gate, outcomeReturn, classification, counterfactual: gate === 'blocked' };
  });
  unique(assessments, row => row.id, 'cases');
  return { opportunityThreshold, cases: assessments,
    counts: Object.fromEntries([...group(assessments, row => row.classification)].map(([name, items]) => [name, items.length])) };
}

function tradeFeedback({ cases }) {
  const results = rows(cases, 'cases').map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    adhered: flag(row.adhered, 'adhered'), outcomeReturn: number(row.outcomeReturn, 'outcomeReturn', -100, 100),
    errors: tagList(row.errors ?? [], 'errors'), lesson: row.lesson == null ? null : text(row.lesson, 'lesson') }));
  unique(results, row => row.id, 'cases').sort(byDate);
  const patterns = new Map();
  for (const row of results) for (const error of row.errors) patterns.set(error, (patterns.get(error) ?? 0) + 1);
  return { observations: results.length, adherenceRate: results.filter(row => row.adhered).length / results.length,
    cohorts: [true, false].map(adhered => {
      const returns = results.filter(row => row.adhered === adhered).map(row => row.outcomeReturn);
      return { adhered, observations: returns.length, meanReturn: mean(returns) };
    }), errors: [...patterns].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count || a.error.localeCompare(b.error)),
    lessons: results.filter(row => row.lesson).map(row => ({ id: row.id, lesson: row.lesson })) };
}

function selfIteration({ proposals, reviews = [] }) {
  const items = rows(proposals, 'proposals').map(row => {
    const baseline = number(row.baseline, 'baseline');
    const target = number(row.target, 'target');
    check(baseline !== target, 'A review target must differ from its baseline.');
    return { id: text(row.id, 'id'), date: date(row.date), hypothesis: text(row.hypothesis, 'hypothesis'),
      metric: text(row.metric, 'metric'), baseline, target };
  });
  unique(items, row => row.id, 'proposals').sort(byDate);
  const lookup = new Map(items.map(row => [row.id, row]));
  const log = rows(reviews, 'reviews', 0).map(row => {
    const id = text(row.id, 'id');
    const proposal = lookup.get(id);
    const day = date(row.date);
    check(proposal && day >= proposal.date, 'A review must reference an existing proposal and follow its proposal date.');
    const state = choice(row.state, 'state', ['testing', 'accepted', 'rejected']);
    const observed = row.observed == null ? null : number(row.observed, 'observed');
    const targetMet = observed === null ? null : proposal.target > proposal.baseline ? observed >= proposal.target : observed <= proposal.target;
    check(state !== 'accepted' || targetMet === true, 'An accepted change must have a measured result that meets its target.');
    return { id, date: day, state, observed, targetMet };
  });
  unique(log, row => key(row.id, row.date), 'reviews').sort(byDate);
  const byProposal = group(log, row => row.id);
  return { researchOnly: true, proposals: items.map(row => {
    const history = byProposal.get(row.id) ?? [];
    check(history.slice(0, -1).every(review => review.state === 'testing'), 'A terminal process review must be the last review for its proposal.');
    return { ...row, state: history.at(-1)?.state ?? 'proposed', reviews: history };
  }) };
}

export const validationCapabilities = {
  'data-validator': capability('{asOf,artifacts:[{id,date,source:https,expectedSource?:https,dependencies?:string[]}],datePairs?:[{left,right}],maxAgeDays?:integer}',
    { asOf: NEXT, artifacts: [{ id: 'input', date: DAY, source: SOURCE }, { id: 'report', date: DAY, source: SOURCE, dependencies: ['input'] }] }, validateData),
  'data-quality-hardening-router': capability('{datasets:[{name,expectedRows:integer,observedRows:integer,duplicateRows:integer,checkedFields:integer,missingCells:integer,evidence?:[{title,url:https}]}],minimumCoverage?:number}',
    { datasets: [{ name: 'Illustrative price panel', expectedRows: 100, observedRows: 99, duplicateRows: 1, checkedFields: 5, missingCells: 2,
      evidence: [{ title: 'Illustrative provenance', url: SOURCE }] }] }, hardenQuality),
  'stock-character-validation-router': capability('{samples:[{tag,symbol,signalDate,outcomeDate,forwardReturn:number}]}',
    { samples: [{ tag: 'follow-through', symbol: 'ATLAS', signalDate: DAY, outcomeDate: NEXT, forwardReturn: 0.03 }] }, characterValidation),
  'price-alert-calibration-router': capability('{alerts:[{id,triggered:boolean,direction:"up"|"down",returnAfter?:number}],minimumMove?:number}',
    { minimumMove: 0.02, alerts: [{ id: 'a1', triggered: true, direction: 'up', returnAfter: 0.03 },
      { id: 'a2', triggered: false, direction: 'down', returnAfter: -0.04 }] }, alertCalibration),
  'news-event-impact-feedback-router': capability('{events:[{id,symbol,category,eventDate,outcomeDate?:date,return?:number,benchmarkReturn?:number}]}',
    { events: [{ id: 'e1', symbol: 'ATLAS', category: 'results', eventDate: DAY, outcomeDate: NEXT, return: 0.04, benchmarkReturn: 0.01 }] }, eventFeedback),
  'scenario-probability-calibration-router': capability('{forecasts:[{id,issuedOn,resolvedOn,probabilities:{scenario:number},actual}]}',
    { forecasts: [{ id: 'f1', issuedOn: DAY, resolvedOn: NEXT, probabilities: { weak: 0.3, firm: 0.7 }, actual: 'firm' }] }, scenarioCalibration),
  'portfolio-sleeve-review-router': capability('{periods:[{sleeve,date,startValue:number,endValue:number,netFlow:number,benchmarkReturn:number}]}',
    { periods: [{ sleeve: 'Defensive', date: NEXT, startValue: 200, endValue: 226, netFlow: 20, benchmarkReturn: 0.02 }] }, sleeveReview),
  'signal-outcome-evaluation-router': capability('{signals:[{id,date,symbol,direction?:"up"|"down"|"long"|"short"}],prices:[{date,symbol,close:number}],horizons?:integer[],sessions?:date[]}',
    { signals: [{ id: 's1', date: DAY, symbol: 'ATLAS', direction: 'up' }],
      prices: [{ date: DAY, symbol: 'ATLAS', close: 100 }, { date: NEXT, symbol: 'ATLAS', close: 103 }], horizons: [1, 5] }, signalEvaluation),
  'decision-quality-ledger-router': capability('{proposals:[{id,date,symbol,thesis}],gates?:[{id,date,status,reason}],outcomes?:[{id,date,return:number}]}',
    { proposals: [{ id: 'p1', date: DAY, symbol: 'ATLAS', thesis: 'Illustrative demand improvement' }],
      gates: [{ id: 'p1', date: DAY, status: 'deferred', reason: 'Awaiting source review' }], outcomes: [{ id: 'p1', date: NEXT, return: 0.01 }] }, decisionLedger),
  'gate-regret-calibration-router': capability('{cases:[{id,gate:"allowed"|"blocked",outcomeReturn?:number}],opportunityThreshold?:number}',
    { cases: [{ id: 'g1', gate: 'blocked', outcomeReturn: 0.03 }, { id: 'g2', gate: 'allowed', outcomeReturn: -0.01 }] }, gateRegret),
  'trade-feedback-router': capability('{cases:[{id,date,adhered:boolean,outcomeReturn:number,errors?:string[],lesson?:string}]}',
    { cases: [{ id: 't1', date: DAY, adhered: false, outcomeReturn: -0.02, errors: ['late review'], lesson: 'Review evidence earlier' }] }, tradeFeedback),
  'trader-self-iteration-router': capability('{proposals:[{id,date,hypothesis,metric,baseline:number,target:number}],reviews?:[{id,date,state,observed?:number}]}',
    { proposals: [{ id: 'r1', date: DAY, hypothesis: 'Reduce overdue reviews', metric: 'overdue share', baseline: 0.2, target: 0.1 }],
      reviews: [{ id: 'r1', date: NEXT, state: 'testing', observed: 0.15 }] }, selfIteration)
};
