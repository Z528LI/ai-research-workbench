export function demoReport(now) {
  const source = 'Synthetic example';
  const yields = Array.from({ length: 20 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 2)).toISOString().slice(0, 10),
    month3: 4.35 + Math.sin(index / 5) / 12,
    year2: 4.08 + Math.sin(index / 6) / 9,
    year10: 4.36 + Math.sin(index / 7) / 7,
    year30: 4.56 + Math.sin(index / 8) / 6,
  }));
  const months = Array.from({ length: 24 }, (_, index) =>
    new Date(Date.UTC(2023, index, 1)).toISOString().slice(0, 10));

  return {
    mode: 'demo',
    generatedAt: now.toISOString(),
    treasury: { source, observations: yields },
    labor: {
      source,
      unemployment: months.map((date, index) => ({ date, value: 3.6 + index / 55 + Math.sin(index / 3) / 12 })),
      cpi: months.map((date, index) => ({ date, value: 292 + index * 0.68 + Math.sin(index / 3) / 5 })),
    },
    filings: {
      source,
      issuers: [
        {
          name: 'Fictional Example Industries',
          symbol: 'EXAMPLE',
          cik: '0000000000',
          filings: [
            { form: '8-K', filed: '2025-01-14', period: '2025-01-14', accession: 'SAMPLE-02', url: '', items: ['2.02'] },
            { form: '10-Q', filed: '2024-11-12', period: '2024-09-30', accession: 'SAMPLE-01', url: '', items: [] },
          ],
        },
      ],
    },
  };
}
