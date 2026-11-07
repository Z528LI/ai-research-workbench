import {
  byDate, capability, check, choice, date, flag, group, key, link, number, positive, record, rows, symbol, text, unique
} from './market-inputs.mjs';

const DAY = '2025-02-03';
const NEXT = '2025-02-04';
const researchOnly = true;

function shadow({ decisions, context = [], outcomes = [] }) {
  const proposals = rows(decisions, 'decisions').map(row => ({ id: text(row.id, 'id'), date: date(row.date),
    symbol: symbol(row.symbol), action: choice(row.action, 'action', ['long', 'short', 'watch', 'skip']) }));
  unique(proposals, row => row.id, 'decisions');
  const lookup = new Map(proposals.map(row => [row.id, row]));
  const briefs = rows(context, 'context', 0).map(row => {
    const id = text(row.id, 'id');
    const when = date(row.date);
    check(lookup.has(id) && when <= lookup.get(id).date, 'Context must reference an existing decision and be available by its date.');
    return { id, date: when, kind: choice(row.kind, 'kind', ['brief', 'earnings', 'market', 'thesis']), summary: text(row.summary, 'summary') };
  }).sort(byDate);
  const results = rows(outcomes, 'outcomes', 0).map(row => {
    const id = text(row.id, 'id');
    const when = date(row.date);
    check(lookup.has(id) && when > lookup.get(id).date, 'Outcome must follow its associated decision.');
    return { id, date: when, return: number(row.return, 'return') };
  });
  unique(results, row => key(row.id, row.date), 'outcomes').sort(byDate);
  const briefIndex = group(briefs, row => row.id);
  const outcomeIndex = group(results, row => row.id);
  return { researchOnly, rows: proposals.sort(byDate).map(row => ({ ...row, context: briefIndex.get(row.id) ?? [],
    outcomes: outcomeIndex.get(row.id) ?? [], reviewState: outcomeIndex.has(row.id) ? 'outcome-observed' : 'awaiting-outcome' })) };
}

function decisionContext(input) {
  const factors = ['behavior', 'market', 'news', 'thesis', 'valuation'];
  const evidence = rows(input.evidence, 'evidence').map(row => ({
    factor: choice(row.factor, 'factor', factors), stance: choice(row.stance, 'stance', ['supporting', 'contrary', 'neutral']),
    summary: text(row.summary, 'summary'), url: row.url == null ? null : link(row.url)
  }));
  const grouped = group(evidence, row => row.factor);
  return { researchOnly, date: date(input.date), symbol: symbol(input.symbol),
    supporting: evidence.filter(row => row.stance === 'supporting').length,
    contrary: evidence.filter(row => row.stance === 'contrary').length,
    factors: factors.map(factor => {
      const observations = grouped.get(factor) ?? [];
      const stances = new Set(observations.map(row => row.stance));
      return { factor, observations, state: stances.size === 0 ? 'uncovered' : stances.size === 1 ? [...stances][0] : 'mixed' };
    }) };
}

function traderState({ criteria }) {
  const items = rows(criteria, 'criteria').map(row => ({ name: text(row.name, 'name'), met: flag(row.met, 'met'),
    required: row.required === undefined ? true : flag(row.required, 'required') }));
  unique(items, row => row.name, 'criteria');
  const required = items.filter(row => row.required);
  check(required.length > 0, 'At least one process criterion must be required.');
  const openRequired = required.filter(row => !row.met).map(row => row.name);
  return { researchOnly, state: openRequired.length ? 'review-needed' : 'criteria-met',
    openRequired, met: items.filter(row => row.met).length, total: items.length, criteria: items };
}

function scenarioWeights({ scenarios }) {
  const alternatives = rows(scenarios, 'scenarios', 2, 100).map(row => ({ name: text(row.name, 'name'),
    weight: number(row.weight, 'weight', 0, 1e8), lowReturn: number(row.lowReturn, 'lowReturn', -1, 100),
    highReturn: number(row.highReturn, 'highReturn', -1, 100) })).sort((a, b) => a.lowReturn - b.lowReturn);
  unique(alternatives, row => row.name, 'scenarios');
  for (const [i, row] of alternatives.entries()) {
    check(row.highReturn > row.lowReturn && (i === 0 || row.lowReturn >= alternatives[i - 1].highReturn),
      'Scenario return intervals must be ordered and non-overlapping.');
  }
  const total = alternatives.reduce((sum, row) => sum + row.weight, 0);
  check(total > 0, 'At least one scenario weight must be positive.');
  const distribution = alternatives.map(({ name, weight, lowReturn, highReturn }) => ({
    name, lowReturn, highReturn, probability: weight / total
  }));
  return { researchOnly, method: 'operator-weighted scenarios', scenarios: distribution,
    weightedMidpoint: distribution.reduce((sum, row) => sum + (row.lowReturn + row.highReturn) / 2 * row.probability, 0) };
}

function planGate({ plan, checks, humanApproved = false }) {
  record(plan, 'plan');
  const side = choice(plan.side, 'side', ['long', 'short']);
  const entry = positive(plan.entry, 'entry');
  const stop = positive(plan.stop, 'stop');
  const target = positive(plan.target, 'target');
  const quantity = positive(plan.quantity, 'quantity');
  const maxLoss = positive(plan.maxLoss, 'maxLoss');
  check(side === 'long' ? stop < entry && target > entry : target < entry && stop > entry, 'Entry, stop and target must match the stated side.');
  const proposedLoss = Math.abs(entry - stop) * quantity;
  const proposedReward = Math.abs(target - entry) * quantity;
  const rules = rows(checks, 'checks').map(row => ({ name: text(row.name, 'name'), passed: flag(row.passed, 'passed') }));
  unique(rules, row => row.name, 'checks');
  const approved = flag(humanApproved, 'humanApproved');
  const blocked = proposedLoss > maxLoss || rules.some(row => !row.passed);
  return { researchOnly, symbol: symbol(plan.symbol), side, proposedLoss, proposedReward,
    rewardToRisk: proposedReward / proposedLoss, riskBudgetMet: proposedLoss <= maxLoss, checks: rules,
    humanApproved: approved, state: blocked ? 'blocked' : approved ? 'reviewed' : 'awaiting-human-review' };
}

function positions(input, includeSector) {
  const holdings = rows(input, 'positions').map(row => {
    const quantity = number(row.quantity, 'quantity');
    check(Math.abs(quantity) >= 1e-12, 'Position quantity must be at least 0.000000000001 in absolute value.');
    return { symbol: symbol(row.symbol), quantity, price: positive(row.price, 'price'),
      ...(includeSector ? { sector: text(row.sector, 'sector') } : { entry: positive(row.entry, 'entry') }) };
  });
  return unique(holdings, row => row.symbol, 'positions');
}

function awareness({ positions: input, maxWeight = 0.25 }) {
  number(maxWeight, 'maxWeight', 0, 1);
  const holdings = positions(input, true).map(row => ({ symbol: row.symbol, sector: row.sector, exposure: row.quantity * row.price }));
  const gross = holdings.reduce((sum, row) => sum + Math.abs(row.exposure), 0);
  const net = holdings.reduce((sum, row) => sum + row.exposure, 0);
  const members = holdings.map(row => ({ ...row, grossWeight: Math.abs(row.exposure) / gross, concentrated: Math.abs(row.exposure) / gross > maxWeight }))
    .sort((a, b) => b.grossWeight - a.grossWeight || a.symbol.localeCompare(b.symbol));
  const sectors = [...group(members, row => row.sector)].map(([sector, items]) => ({ sector,
    grossWeight: items.reduce((sum, row) => sum + row.grossWeight, 0), netExposure: items.reduce((sum, row) => sum + row.exposure, 0) }));
  return { researchOnly, gross, net, maxWeight, positions: members, sectors };
}

function sleevePlan({ capital, scenario, sleeves, maxGross = 1 }) {
  positive(capital, 'capital');
  const context = text(scenario, 'scenario');
  number(maxGross, 'maxGross', 0, 3);
  const inputs = rows(sleeves, 'sleeves').map(row => ({ sleeve: text(row.sleeve, 'sleeve'),
    baseWeight: number(row.baseWeight, 'baseWeight', 0, 1), scenarioMultiplier: number(row.scenarioMultiplier, 'scenarioMultiplier', 0, 5) }));
  unique(inputs, row => row.sleeve, 'sleeves');
  const requested = inputs.reduce((sum, row) => sum + row.baseWeight * row.scenarioMultiplier, 0);
  const scale = requested > maxGross ? maxGross / requested : 1;
  return { researchOnly, scenario: context, maxGross, requested, gross: requested * scale,
    sleeves: inputs.map(row => ({ ...row, targetWeight: row.baseWeight * row.scenarioMultiplier * scale,
      targetExposure: capital * row.baseWeight * row.scenarioMultiplier * scale })) };
}

function executionConstraints({ constraints }) {
  const rules = rows(constraints, 'constraints').map(row => {
    const limit = number(row.limit, 'limit');
    const current = number(row.current, 'current');
    const comparison = choice(row.comparison, 'comparison', ['maximum', 'minimum']);
    const headroom = comparison === 'maximum' ? limit - current : current - limit;
    return { name: text(row.name, 'name'), limit, current, comparison, headroom, meets: headroom >= 0 };
  });
  unique(rules, row => row.name, 'constraints');
  return { researchOnly, allMet: rules.every(row => row.meets), constraints: rules };
}

function positionMonitor({ date: observed, positions: input, watchlist = [] }) {
  const holdings = positions(input, false).map(row => ({ symbol: row.symbol, exposure: row.price * row.quantity,
    unrealized: (row.price - row.entry) * row.quantity, underlyingReturn: row.price / row.entry - 1 }));
  const watches = rows(watchlist, 'watchlist', 0).map(row => {
    const price = positive(row.price, 'price');
    const threshold = positive(row.threshold, 'threshold');
    const condition = choice(row.condition, 'condition', ['above', 'below']);
    return { symbol: symbol(row.symbol), condition, threshold, matched: condition === 'above' ? price >= threshold : price <= threshold };
  });
  unique(watches, row => key(row.symbol, row.condition, row.threshold), 'watchlist');
  return { researchOnly, date: date(observed), unrealized: holdings.reduce((total, row) => total + row.unrealized, 0),
    positions: holdings, watchlist: watches };
}

export const decisionCapabilities = {
  'trade-shadow-integration-router': capability('{decisions:[{id,date,symbol,action}],context?:[{id,date,kind,summary}],outcomes?:[{id,date,return:number}]}',
    { decisions: [{ id: 'd1', date: DAY, symbol: 'ATLAS', action: 'watch' }],
      context: [{ id: 'd1', date: DAY, kind: 'earnings', summary: 'Illustrative statement review' }],
      outcomes: [{ id: 'd1', date: NEXT, return: 0.03 }] }, shadow),
  'trade-decision-router': capability('{date,symbol,evidence:[{factor,stance,summary,url?:https}]}',
    { date: DAY, symbol: 'ATLAS', evidence: [{ factor: 'market', stance: 'contrary', summary: 'Illustrative contraction in participation' },
      { factor: 'thesis', stance: 'supporting', summary: 'Illustrative improvement in operating margin' }] }, decisionContext),
  'trader-state-router': capability('{criteria:[{name,met:boolean,required?:boolean}]}',
    { criteria: [{ name: 'Written evidence review', met: true }, { name: 'Peer check', met: false, required: false }] }, traderState),
  'scenario-probability-router': capability('{scenarios:[{name,weight:number,lowReturn:number,highReturn:number}]} using fraction return bounds and operator weights',
    { scenarios: [{ name: 'Weak', weight: 1, lowReturn: -0.15, highReturn: 0 },
      { name: 'Firm', weight: 2, lowReturn: 0, highReturn: 0.12 }] }, scenarioWeights),
  'trade-plan-gate-router': capability('{plan:{symbol,side,entry:number,stop:number,target:number,quantity:number,maxLoss:number},checks:[{name,passed:boolean}],humanApproved?:boolean}',
    { plan: { symbol: 'ATLAS', side: 'long', entry: 100, stop: 94, target: 112, quantity: 10, maxLoss: 75 },
      checks: [{ name: 'Evidence reviewed', passed: true }] }, planGate),
  'position-awareness-router': capability('{positions:[{symbol,quantity:number,price:number,sector}],maxWeight?:number} using one reporting currency',
    { positions: [{ symbol: 'ATLAS', quantity: 10, price: 100, sector: 'Storage' }, { symbol: 'CEDAR', quantity: -2, price: 45, sector: 'Sensors' }] }, awareness),
  'portfolio-sleeve-router': capability('{capital:number,scenario,sleeves:[{sleeve,baseWeight:number,scenarioMultiplier:number}],maxGross?:number}',
    { capital: 10000, scenario: 'Illustrative contraction', maxGross: 0.75,
      sleeves: [{ sleeve: 'Defensive', baseWeight: 0.4, scenarioMultiplier: 1.5 }, { sleeve: 'Growth', baseWeight: 0.4, scenarioMultiplier: 0.5 }] }, sleevePlan),
  'personal-execution-overlay-router': capability('{constraints:[{name,limit:number,current:number,comparison:"maximum"|"minimum"}]}',
    { constraints: [{ name: 'Review time in minutes', limit: 30, current: 45, comparison: 'minimum' }] }, executionConstraints),
  'position-monitor': capability('{date,positions:[{symbol,quantity:number,price:number,entry:number}],watchlist?:[{symbol,price:number,threshold:number,condition}]} using one reporting currency',
    { date: DAY, positions: [{ symbol: 'ATLAS', quantity: 10, price: 102, entry: 100 }],
      watchlist: [{ symbol: 'CEDAR', price: 52, threshold: 50, condition: 'above' }] }, positionMonitor)
};
