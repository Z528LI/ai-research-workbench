# Companies and Valuation

These four views track company events, earnings, valuation and research coverage. The links open reviewed snapshots in the English Research Workbench. Dates on the pages identify the underlying reports and evidence.

## Company News and Events

- **Sources** — Public company announcements and news, collected against the securities in a fixed version of the published Frontier research pool.
- **Processing** — The stock-news monitor matches items to securities and indexes dated events. Selected events can receive a source-document review. Where eligible, reviewed evidence can also inform Theme Replay and support Earnings Alpha research.
- **Validation** — The job verifies the pool version and security identities before collection. It tracks planned and scanned securities, securities with events, and source failures separately.
- **Published view** — [Company News and Events](https://ai-research-workbench-z528li-20261106.quaintpartridge1.chatgpt.site/news/index.html) renders the accepted dated event records as a searchable company and event index. The report date and collection time describe different parts of the daily workflow.

## Earnings Alpha

- **Sources** — Earnings calendars, reported revenue and earnings, available estimates and analyst revisions, and historical prices for the earnings research universe.
- **Processing** — The scheduled job produces a baseline earnings report by aligning releases and revisions with trading sessions and measuring subsequent price moves. A separate research stage can add eligible company evidence, including reviewed news, alongside the baseline results.
- **Validation** — The engine checks event-date confidence, the availability of results and revisions, and alignment of returns to trading days. Those checks determine how each record can be used in research.
- **Published view** — [Earnings Alpha](https://ai-research-workbench-z528li-20261106.quaintpartridge1.chatgpt.site/earnings/index.html) renders the dated earnings results, revisions and evidence coverage, with supplemental research distinguished from the baseline. The dashboard date and research-universe version are tracked separately.

## Core60 Valuation

- **Sources** — Completed-session closing prices for verified Core60 listings, reviewed valuation materials, and separately dated company research.
- **Processing** — The native monitor tracks prices and model eligibility separately. The publication step uses the verified monitor to render the investor view, including separately identified historical and conditional research.
- **Validation** — Checks cover the exact listing and completed session, the provenance of accepted inputs, and eligibility of the model for the price date. Publication uses the dated report associated with the verified monitor.
- **Published view** — [Core60 Valuation](https://ai-research-workbench-z528li-20261106.quaintpartridge1.chatgpt.site/valuation/index.html) shows the company-level reading, with price dates, model status and dated valuation references. The monitor has a daily price-maintenance workflow. Model adoption requires a separate review.

## Frontier Stock Pool

- **Sources** — The accepted version of the research pool, the company research register, and reviewed reports and primary company disclosures.
- **Processing** — Researchers screen candidates and review company evidence for possible inclusion. The publishing workflow records accepted membership, which the company reading layer uses to assemble company pages and the browsable pool. The daily news job uses a fixed version of this pool to set its own coverage.
- **Validation** — Reviewers check security and issuer identities, duplicate research, and evidence coverage before accepting changes. The reading layer verifies the pool and source bindings separately from the membership decision.
- **Published view** — [Frontier Stock Pool](https://ai-research-workbench-z528li-20261106.quaintpartridge1.chatgpt.site/frontier/index.html) is a versioned company research library. Pool membership changes through reviewed updates, with underlying company evidence retaining its own dates.
