# Research input bundle

Supply an ordinary JSON object to `npm run workbench:refresh -- --inputs research-inputs.json`. Use dates in `YYYY-MM-DD` format and keep the bundle under 3 MB. Include a genuine HTTPS source link for each populated section. A GitHub fork can load the same format from an explicitly configured public raw GitHub URL. The workbench reads the bundle and publishes derived tables and links. Use only data you are allowed to publish on Pages.

This minimal example connects Theme Replay. Its values are illustrative.

```json
{
  "asOf": "2026-01-02",
  "sources": { "themes": "https://example.org/published-theme-data" },
  "themes": [
    { "date": "2026-01-02", "symbol": "EXAMPLE", "theme": "Photonics", "return": 0.013 }
  ]
}
```

Add any of these sections with a matching key in `sources`.

| Key | Fields |
| --- | --- |
| `market`, `marketCN` | Object with `benchmark` and `prices`. Each price row is `{date, symbol, close}`. Supply comparable positive closing prices from completed sessions, at least two benchmark sessions and at least one peer with prices on both latest sessions. Keep symbols uppercase. |
| `limits` | Rows with `date, symbol, eligible, high, close, limitUp, group, theme`. Use actual unadjusted prices and the official date- and security-specific limit for every eligible session. Use `eligible:false` for an explicitly ineligible observation. |
| `themes` | Rows with `date, symbol, theme, return`. Returns are fractions, such as `0.02` for 2%. Use dated membership records. |
| `publications` | Rows with `date, title, topic, url`. The URL points to the publication or DOI. |
| `news` | Rows with `date, symbol, title, type, url`. Use a source document link. |
| `earnings` | Rows with `date, symbol` and optional `actualEps, expectedEps, priorEstimate, revisedEstimate`. Matching U.S. prices are needed for forward returns. |
| `valuation` | Rows with `date, symbol, currency, close, valuation`. The scenario object contains `baseFcff, years, discountRate, terminalGrowth, netDebt, shares, growthRates`. The `growthRates` object contains `bear, base, bull`. Use fractional rates and consistent currency and share units. |
| `frontier` | Rows with `date, symbol, name, revenue, marketCap, exposures`. Each exposure has `theme, revenueShare, evidence`; each evidence record has `title, url, date`. |
| `macroChina` | Rows with `date, series, value, unit`. Use a source that documents the observation period and units. |

`asOf` is the latest allowable observation date. Every row needs a valid date on or before it. A daily job can read a new bundle at the same URL after your data producer updates it. The renderer keeps source dates distinct from the page generation date. If you provide both a local price CSV and a U.S. price section, the local CSV takes precedence for U.S. price calculations.
