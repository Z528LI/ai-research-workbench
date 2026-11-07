import { loadSyntheticMarket } from './market.mjs';

export function demoInputs() {
  const market = loadSyntheticMarket();
  const asOf = [...market.prices.get(market.benchmark).keys()].at(-1);
  const dates = [...market.prices.get(market.benchmark).keys()];
  const prices = Array.from(market.prices, ([symbol, series]) =>
    Array.from(series, ([date, close]) => ({ date, symbol, close }))
  ).flat();
  const cnPrices = prices.map(row => ({ ...row, symbol: `CN-${row.symbol}` }));
  const names = [...market.prices.keys()].filter(symbol => symbol !== market.benchmark);
  const [a, b, c] = names;
  const topics = ['Photonics', 'Energy storage', 'Automation'];
  const limits = dates.slice(-18).flatMap((date, index) => names.map((symbol, j) => ({
    date, symbol: `CN-${symbol}`, eligible: (index + j) % 17 !== 0, limitUp: 110,
    close: (index + j) % 5 === 0 ? 110 : 103 + j / 10,
    high: (index + j) % 3 === 0 || (index + j) % 5 === 0 ? 110 : 107,
    group: ['Main board', 'Growth board', 'Innovation board'][j % 3], theme: topics[j % 3],
  })));
  const themes = dates.slice(-10).flatMap((date, index) => names.map((symbol, j) => ({
    date, symbol, theme: topics[j % 3], return: ((index + j) % 11 - 4) / 100,
  })));
  const evidence = { date: dates.at(-12), title: 'Illustrative disclosure', url: 'https://example.org/synthetic' };
  return {
    asOf, sources: {},
    market: { benchmark: market.benchmark, prices },
    marketCN: { benchmark: `CN-${market.benchmark}`, prices: cnPrices },
    limits, themes,
    publications: topics.map((topic, index) => ({
      date: dates.at(-10 - index), title: `Illustrative ${topic.toLowerCase()} study`, topic,
    })),
    news: [a, b, c].map((symbol, index) => ({
      date: dates.at(-4 - index), symbol, title: 'Illustrative issuer update', type: 'Disclosure', url: evidence.url,
    })),
    earnings: [
      { date: dates.at(-14), symbol: a, actualEps: 1.16, expectedEps: 1.05 },
      { date: dates.at(-9), symbol: b, actualEps: 0.84, expectedEps: 0.90 },
    ],
    valuation: [a, b, c].map((symbol, index) => ({
      date: asOf, symbol, close: market.prices.get(symbol).get(asOf), currency: 'USD',
      valuation: {
        baseFcff: 140 + 30 * index, years: 5, discountRate: 0.10,
        terminalGrowth: 0.025, netDebt: 95, shares: 30,
        growthRates: { bear: 0.02, base: 0.08, bull: 0.14 },
      },
    })),
    frontier: [a, b, c].map((symbol, index) => ({
      date: dates.at(-6 - index), symbol, name: `Illustrative issuer ${index + 1}`, revenue: 600, marketCap: 2800,
      exposures: [{ theme: topics[index], revenueShare: 0.12 + index * 0.07, evidence: [evidence] }],
    })),
    macroChina: [{ date: dates.at(-20), series: 'CPI growth', value: 0.7, unit: '%' }],
  };
}
