# Workbench data pipelines

The [English Research Workbench](https://ai-research-workbench-z528li-20261106.quaintpartridge1.chatgpt.site/) presents 15 interactive research views. Each entry below describes its sources, transformations, verification and published page. The [88-module capability index](../module-capabilities.md) covers the wider research system, including shared services and tools that do not have their own page.

## Explore the 15 views

| Group | Page and pipeline |
| --- | --- |
| Market Environment | [US and China Macro](market-environment.md#us-and-china-macro) |
| Market Environment | [Market Regime](market-environment.md#market-regime) |
| Market Environment | [US Equity Rotation](market-environment.md#us-equity-rotation) |
| Market Environment | [Limit-Up and Hotspot History](market-environment.md#limit-up-and-hotspot-history) |
| Market Environment | [A-Share Market Structure](market-environment.md#a-share-market-structure) |
| Market Environment | [Market Stress Indicators](market-environment.md#market-stress-indicators) |
| Selection and Comparison | [Stock Behavior and Peers](selection-and-comparison.md#stock-behavior-and-peers) |
| Selection and Comparison | [Technical Selection and Backtests](selection-and-comparison.md#technical-selection-and-backtests) |
| Selection and Comparison | [Thematic Research Library](selection-and-comparison.md#thematic-research-library) |
| Selection and Comparison | [Theme Replay](selection-and-comparison.md#theme-replay) |
| Selection and Comparison | [Limit-up Research](selection-and-comparison.md#limit-up-research) |
| Companies and Valuation | [Company News and Events](companies-and-valuation.md#company-news-and-events) |
| Companies and Valuation | [Earnings Alpha](companies-and-valuation.md#earnings-alpha) |
| Companies and Valuation | [Core60 Valuation](companies-and-valuation.md#core60-valuation) |
| Companies and Valuation | [Frontier Stock Pool](companies-and-valuation.md#frontier-stock-pool) |

## How a report reaches the Workbench

1. **Prepare inputs.** Source adapters and producers identify the series, issuer or listing and record the observation date, trading session or reporting period. Where a workflow uses shared inputs, it can reuse a verified snapshot.
2. **Run the relevant producer.** Market, selection and company jobs compute their own research outputs. Schedules vary by data and workflow. Some pages are reference studies or research libraries.
3. **Verify and render.** Checks are specific to the report. They can cover input identity, comparable dates, evidence eligibility and expected coverage. For workflows with artifact receipts, the receipt ties the input version to the generated report. Reports retain their coverage and evidence qualifications.
4. **Select and publish.** The private Cockpit resolves each formal report and its date. The English public edition serves reviewed pages and the assets needed for charts, filters and navigation. An archived report may keep an earlier observation date, and a preview requires a separate adoption decision.

Two shared flows matter for interpreting the company and theme pages. A version of the Frontier pool defines coverage for the Company News job. Reviewed company-news evidence can then feed Theme Replay or enrich Earnings Alpha. Earnings facts and metrics still come from the earnings workflow.

**Reading dates.** A market session, financial reporting period, report generation time and public publication date describe different events. Check the dates and coverage displayed on each view before comparing results.

[Interactive architecture](https://z528li.github.io/ai-research-workbench/docs/architecture.html) · [Launch Market Lab](https://z528li.github.io/ai-research-workbench/) · [Repository home](../../README.md)
