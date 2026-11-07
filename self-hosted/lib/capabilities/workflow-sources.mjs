import { array, byDate, capability, date, exampleLink, https, list, mean, number, text, unique } from './workflow-utils.mjs';

const article = { title: 'Quarterly operating review', url: exampleLink, published: '2026-09-29' };
const observation = { series: 'ACTIVITY', date: '2026-09-01', value: 50.2, unit: 'index' };
const quotes = [
  { symbol: 'DEMO', date: '2026-09-28', close: 20, currency: 'USD' },
  { symbol: 'DEMO', date: '2026-09-29', close: 21, currency: 'USD' },
];

function seriesRows(rows) {
  const result = unique(array(rows, 'observations').map(row => ({
    series: text(row?.series, 'series', 60), date: date(row?.date), value: number(row?.value, 'value'), unit: text(row?.unit, 'unit', 40),
  })), row => `${row.series}\n${row.date}`, 'series and observation date');
  const units = new Map();
  for (const row of result) {
    if (units.has(row.series) && units.get(row.series) !== row.unit) throw new Error('Units differ within a series');
    units.set(row.series, row.unit);
  }
  return result.sort(byDate);
}

function quoteRows(rows) {
  return unique(array(rows, 'quotes').map(row => {
    const currency = text(row?.currency, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Use a three-letter currency code');
    return { symbol: text(row?.symbol, 'symbol', 25).toUpperCase(), date: date(row?.date), close: number(row?.close, 'close', Number.MIN_VALUE), currency };
  }), row => `${row.symbol}\n${row.date}`, 'security and quote date').sort(byDate);
}

export const sourceCapabilities = {
  'web-pdf-fetcher': capability('documents: {title,url,kind}[] (HTTPS PDF links or landing pages)', { documents: [{ title: article.title, url: article.url, kind: 'annual-report' }, { title: 'Investor relations', url: 'https://example.org/ir', kind: 'landing-page' }] }, input => {
    const documents = unique(array(input.documents, 'documents').map(row => {
      const url = https(row?.url);
      const title = text(row?.title, 'title', 240);
      const kind = text(row?.kind, 'kind', 80);
      const classification = new URL(url).pathname.toLowerCase().endsWith('.pdf') ? 'direct PDF candidate' : 'document discovery page';
      return { title, url, kind, classification };
    }), row => row.url, 'document URL');
    return { mode: 'Operator document-link inspection', directPdfCount: documents.filter(row => row.classification === 'direct PDF candidate').length, documents };
  }),
  'reddit-research': capability('posts: {url,title,excerpt,score,comments}[]; terms: string[]', { posts: [{ url: 'https://www.reddit.com/r/example/comments/abc123/topic/', title: 'Export history request', excerpt: 'I need the export option for compliance.', score: 4, comments: 2 }], terms: ['export', 'price'] }, input => {
    const terms = [...new Set(list(input.terms, 'terms', 40).map(term => term.toLowerCase()))];
    const matches = [];
    for (const post of array(input.posts, 'posts')) {
      const url = https(post?.url);
      const parsed = new URL(url);
      const subreddit = /^\/r\/([A-Za-z0-9_]+)\/comments\/[A-Za-z0-9]+(?:\/|$)/.exec(parsed.pathname)?.[1];
      if (!['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(parsed.hostname) || !subreddit) throw new Error('Provide Reddit thread URLs');
      const title = text(post.title, 'title');
      const excerpt = text(post.excerpt, 'excerpt');
      const score = number(post.score, 'score');
      const comments = number(post.comments, 'comments', 0);
      const keywords = terms.filter(term => `${title} ${excerpt}`.toLowerCase().includes(term));
      if (keywords.length) matches.push({ url, subreddit, title, keywords, score, comments });
    }
    unique(matches, row => row.url, 'Reddit thread URL');
    return { mode: 'Supplied discussion analysis', matched: matches.sort((a, b) => b.keywords.length - a.keywords.length || b.comments - a.comments), termCoverage: terms.map(term => ({ term, threads: matches.filter(row => row.keywords.includes(term)).length })) };
  }),
  'mediacrawler-router': capability('items: {platform,id,url,title,published,interactions}[]', { items: [{ platform: 'video', id: 'demo1', ...article, interactions: 12 }] }, input => {
    const entries = unique(array(input.items, 'items').map(row => ({ platform: text(row?.platform, 'platform', 40).toLowerCase(), id: text(row?.id, 'media ID', 100), url: https(row?.url), title: text(row?.title, 'title', 240), published: date(row?.published, 'published'), interactions: number(row?.interactions, 'interactions', 0) })), row => `${row.platform}\n${row.id}`, 'platform and media ID');
    return { mode: 'Operator media-export normalization', byPlatform: Object.entries(Object.groupBy(entries, row => row.platform)).map(([platform, rows]) => ({ platform, count: rows.length, interactions: rows.reduce((sum, row) => sum + row.interactions, 0) })), entries: entries.sort((a, b) => b.published.localeCompare(a.published)) };
  }),
  'cloud-files-router': capability('entries: {path,size,modified}[]; directory: string; name: optional substring', { entries: [{ path: '/research/reports/annual.pdf', size: 12345, modified: '2026-09-29' }, { path: '/research/notes.txt', size: 123, modified: '2026-09-29' }], directory: '/research', name: 'annual' }, input => {
    const safePath = (value, label) => {
      const path = text(value, label, 600);
      if (path !== '/' && (!/^\/(?:[^/]+\/)*[^/]+$/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)|[\\\x00-\x1f]/.test(path))) throw new Error(`${label} must be an absolute inventory path without traversal`);
      return path;
    };
    const directory = safePath(input.directory, 'directory');
    const prefix = directory === '/' ? '/' : `${directory}/`;
    const match = input.name === undefined ? '' : text(input.name, 'name', 120).toLowerCase();
    const entries = unique(array(input.entries, 'entries').map(row => ({ path: safePath(row?.path, 'path'), size: number(row?.size, 'size', 0), modified: date(row?.modified, 'modified') })), row => row.path, 'inventory path');
    return { mode: 'Supplied WebDAV inventory lookup', directory, entries: entries.filter(row => row.path.startsWith(prefix) && row.path.slice(prefix.length).toLowerCase().includes(match)), children: [...new Set(entries.filter(row => row.path.startsWith(prefix)).map(row => row.path.slice(prefix.length).split('/')[0]))].sort() };
  }),
  'bookmark-source-registry-router': capability('bookmarks: {title,url,tags:string[]}[]', { bookmarks: [{ title: 'Issuer archive', url: exampleLink, tags: ['filings', 'equities'] }] }, input => {
    const registry = new Map();
    for (const row of array(input.bookmarks, 'bookmarks')) {
      const link = new URL(https(row?.url));
      link.hash = '';
      const title = text(row.title, 'title', 240);
      const tags = list(row.tags, 'tags', 30, 0).map(tag => tag.toLowerCase());
      const existing = registry.get(link.href);
      if (existing) existing.tags = [...new Set([...existing.tags, ...tags])].sort();
      else registry.set(link.href, { url: link.href, title, host: link.hostname, tags: [...new Set(tags)].sort() });
    }
    return { mode: 'Bookmark export index', sources: [...registry.values()], hosts: [...new Set([...registry.values()].map(row => row.host))].sort(), duplicatesMerged: input.bookmarks.length - registry.size };
  }),
  'wechat-history-shortlist-router': capability('articles: {title,url,published,excerpt}[]; start,end: date; keywords: string[]', { articles: [{ title: 'Factory output rises', url: 'https://mp.weixin.qq.com/s/synthetic', published: '2026-09-29', excerpt: 'Factory output grew in August.' }], start: '2026-09-01', end: '2026-09-30', keywords: ['factory'] }, input => {
    const start = date(input.start, 'start');
    const end = date(input.end, 'end');
    if (start > end) throw new Error('start must not follow end');
    const terms = [...new Set(list(input.keywords, 'keywords', 40).map(term => term.toLowerCase()))];
    const reviewed = unique(array(input.articles, 'articles').map(row => {
      const url = https(row?.url);
      if (new URL(url).hostname !== 'mp.weixin.qq.com') throw new Error('Provide WeChat public article URLs');
      const title = text(row.title, 'title', 240);
      const published = date(row.published, 'published');
      const excerpt = text(row.excerpt, 'excerpt');
      return { title, published, url, matches: terms.filter(term => `${title} ${excerpt}`.toLowerCase().includes(term)) };
    }), row => row.url, 'article URL');
    return { mode: 'Historical article metadata review', reviewed: reviewed.length, candidates: reviewed.filter(row => row.published >= start && row.published <= end && row.matches.length).sort((a, b) => b.matches.length - a.matches.length || b.published.localeCompare(a.published)) };
  }),
  'ak-xq-router': capability('quotes: {symbol,date,close,currency}[]; symbol: string', { quotes: quotes.map(row => ({ ...row, symbol: '600000.SS', currency: 'CNY' })), symbol: '600000.SS' }, input => {
    const symbol = text(input.symbol, 'symbol', 25).toUpperCase();
    const rows = quoteRows(input.quotes).filter(row => row.symbol === symbol);
    if (!rows.length || rows.some(row => !['CNY', 'HKD'].includes(row.currency)) || new Set(rows.map(row => row.currency)).size !== 1) throw new Error('Provide one CNY or HKD security history in a single currency');
    const first = rows[0];
    const latest = rows.at(-1);
    return { mode: 'A/H quote-history export', symbol, currency: first.currency, observations: rows, changePct: rows.length > 1 ? (latest.close / first.close - 1) * 100 : null };
  }),
  'a-share-analyst-data-router': capability('documents: {security,kind,periodEnd,title,url}[]', { documents: [{ security: '600000.SH', kind: 'filing', periodEnd: '2026-06-30', title: 'Interim report', url: exampleLink }] }, input => {
    const records = unique(array(input.documents, 'documents').map(row => {
      const security = text(row?.security, 'security', 20).toUpperCase();
      const kind = text(row?.kind, 'kind', 30).toLowerCase();
      if (!/^\d{6}\.(SH|SZ|BJ)$/.test(security) || !['filing', 'prices', 'financials', 'disclosure'].includes(kind)) throw new Error('Use an A-share identity and a supported evidence kind');
      return { security, kind, date: date(row.periodEnd, 'periodEnd'), title: text(row.title, 'title', 240), url: https(row.url) };
    }), row => `${row.security}\n${row.kind}\n${row.date}\n${row.url}`, 'analyst record');
    const bySecurity = Object.entries(Object.groupBy(records, row => row.security)).map(([security, rows]) => ({ security, available: [...new Set(rows.map(row => row.kind))].sort(), latestPeriod: rows.sort(byDate).at(-1).date }));
    return { mode: 'Operator A-share research inventory', bySecurity, records: records.sort(byDate) };
  }),
  'eastmoney-hot-rank-router': capability('entries: {market,symbol,name,rank,date}[]', { entries: [{ market: 'CN', symbol: '600000', name: 'Example Bank', rank: 5, date: '2026-09-29' }, { market: 'CN', symbol: '600000', name: 'Example Bank', rank: 2, date: '2026-09-30' }] }, input => {
    const ranks = unique(array(input.entries, 'entries').map(row => {
      const market = text(row?.market, 'market', 2).toUpperCase();
      const rank = number(row?.rank, 'rank', 1);
      if (!['CN', 'HK', 'US'].includes(market) || !Number.isInteger(rank)) throw new Error('Use CN, HK or US and an integer rank');
      return { market, symbol: text(row.symbol, 'symbol', 25).toUpperCase(), name: text(row.name, 'name', 240), rank, date: date(row.date) };
    }), row => `${row.market}\n${row.symbol}\n${row.date}`, 'market, security and rank date');
    unique(ranks, row => `${row.market}\n${row.rank}\n${row.date}`, 'market, rank and date');
    const changes = Object.values(Object.groupBy(ranks, row => `${row.market}:${row.symbol}`)).map(rows => {
      rows.sort(byDate);
      const latest = rows.at(-1);
      return { ...latest, previousRank: rows.at(-2)?.rank ?? null, positionsGained: rows.length > 1 ? rows.at(-2).rank - latest.rank : null };
    });
    return { mode: 'Operator attention-rank export', latestRanks: changes.sort((a, b) => a.market.localeCompare(b.market) || a.rank - b.rank) };
  }),
  'sw-api-router': capability('industries: {code,name,constituents:string[],valuation:{date,pe}[]}[]', { industries: [{ code: 'SW-DEMO', name: 'Synthetic industry', constituents: ['600000.SH', '000001.SZ'], valuation: [{ date: '2026-08-31', pe: 12 }, { date: '2026-09-30', pe: 14 }] }] }, input => {
    const industries = unique(array(input.industries, 'industries').map(row => {
      const history = unique(array(row?.valuation, 'valuation').map(point => ({ date: date(point?.date), pe: number(point?.pe, 'pe', Number.MIN_VALUE) })), point => point.date, 'valuation date').sort(byDate);
      const latest = history.at(-1);
      return { code: text(row.code, 'code', 30), name: text(row.name, 'name', 180), constituents: [...new Set(list(row.constituents, 'constituents', 500))].sort(), latest, history, empiricalPePercentile: history.filter(point => point.pe <= latest.pe).length / history.length * 100 };
    }), row => row.code, 'industry code');
    return { mode: 'Operator industry and valuation export', industries };
  }),
  'fred-router': capability('observations: {series,date,value,unit}[]; series: string', { observations: [{ ...observation, series: 'CREDIT' }, { ...observation, series: 'CREDIT', date: '2026-10-01', value: 49.8 }], series: 'CREDIT' }, input => {
    const series = text(input.series, 'series', 60);
    const observations = seriesRows(input.observations).filter(row => row.series === series);
    if (!observations.length) throw new Error('Requested series is absent');
    const latest = observations.at(-1);
    const previous = observations.at(-2);
    return { mode: 'Operator FRED series export', series, unit: latest.unit, latest, previous: previous ?? null, change: previous ? latest.value - previous.value : null, observations };
  }),
  'nbs-router': capability('observations: {series,date,value,unit}[]', { observations: [observation, { ...observation, date: '2025-09-01', value: 49.1 }] }, input => {
    const observations = seriesRows(input.observations);
    if (observations.some(row => !row.date.endsWith('-01'))) throw new Error('Use first-of-month dates for monthly statistics');
    return { mode: 'Operator China statistics export', indicators: Object.entries(Object.groupBy(observations, row => row.series)).map(([series, rows]) => {
      const latest = rows.at(-1);
      const previousYear = rows.find(row => row.date === `${String(Number(latest.date.slice(0, 4)) - 1).padStart(4, '0')}${latest.date.slice(4)}`);
      return { series, latest, priorYear: previousYear ?? null, yearOverYearPct: previousYear?.value ? (latest.value / previousYear.value - 1) * 100 : null };
    }) };
  }),
  'openbb-router': capability('quotes: {symbol,date,close,currency}[]; options: optional {symbol,expiry,strike,type,impliedVolatility}[]', { quotes, options: [{ symbol: 'DEMO', expiry: '2026-10-30', strike: 20, type: 'call', impliedVolatility: 0.24 }, { symbol: 'DEMO', expiry: '2026-10-30', strike: 20, type: 'put', impliedVolatility: 0.28 }] }, input => {
    const histories = Object.entries(Object.groupBy(quoteRows(input.quotes), row => row.symbol)).map(([symbol, rows]) => {
      if (new Set(rows.map(row => row.currency)).size !== 1) throw new Error('Currency differs within a security');
      const latest = rows.at(-1);
      return { symbol, latest, high: Math.max(...rows.map(row => row.close)), low: Math.min(...rows.map(row => row.close)) };
    });
    const options = unique(array(input.options ?? [], 'options', 500, 0).map(row => {
      const symbol = text(row?.symbol, 'option symbol', 25).toUpperCase();
      const expiry = date(row?.expiry, 'expiry');
      const type = text(row?.type, 'option type', 4).toLowerCase();
      if (!['call', 'put'].includes(type) || !histories.some(item => item.symbol === symbol)) throw new Error('Option has an unsupported type or no matching security');
      return { symbol, expiry, strike: number(row.strike, 'strike', Number.MIN_VALUE), type, impliedVolatility: number(row.impliedVolatility, 'impliedVolatility', 0, 10) };
    }), row => `${row.symbol}\n${row.expiry}\n${row.type}\n${row.strike}`, 'option contract');
    return { mode: 'Operator market-data and options export', histories, optionSummary: Object.values(Object.groupBy(options, row => `${row.symbol}:${row.expiry}:${row.type}`)).map(rows => ({ symbol: rows[0].symbol, expiry: rows[0].expiry, type: rows[0].type, contracts: rows.length, meanImpliedVolatility: mean(rows.map(row => row.impliedVolatility)) })) };
  }),
  'report-prep-notebooklm': capability('topic: string; documents: {title,url,published,kind}[]; cutoff: date', { topic: 'Quarterly operating drivers', documents: [{ ...article, kind: 'filing' }], cutoff: '2026-09-30' }, input => {
    const topic = text(input.topic, 'topic', 300);
    const cutoff = date(input.cutoff, 'cutoff');
    const documents = unique(array(input.documents, 'documents', 100).map(row => ({ title: text(row?.title, 'title', 240), url: https(row?.url), date: date(row?.published, 'published'), kind: text(row?.kind, 'kind', 40) })), row => row.url, 'packet document URL').sort(byDate);
    const included = documents.filter(row => row.date <= cutoff);
    return { mode: 'Portable notebook import packet', topic, cutoff, included, afterCutoff: documents.filter(row => row.date > cutoff), importUrls: included.map(row => row.url) };
  }),
};
