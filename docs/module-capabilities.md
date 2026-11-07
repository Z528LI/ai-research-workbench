# Module capability index

This index covers all **88 registered modules** in the private research system as of 7 November 2026. The identifiers match the system registry. The groups below follow how a reader would navigate the system, from acquiring evidence to reviewing decisions and publishing reports.

Some modules collect data, others plan or validate work, and several support private workflows with their own access requirements. The [15 workbench views](pipelines/README.md) combine selected producers and supporting evidence. [Market Lab](https://z528li.github.io/ai-research-workbench/) is the standalone public application.

## Data access and source preparation

| Module | Capability |
| --- | --- |
| `web-pdf-fetcher` | Locates and retrieves issuer reports, investor-relations PDFs and mainland Chinese filings. |
| `reddit-research` | Collects public discussion threads and comments for sentiment and qualitative research. |
| `mediacrawler-router` | Routes supported media-collection jobs and normalizes their results. |
| `cloud-files-router` | Lists and resolves documents in authorized WebDAV storage through a cached index. |
| `bookmark-source-registry-router` | Converts a bookmark collection into a reviewable inventory of research sources. |
| `wechat-history-shortlist-router` | Reviews metadata for supplied historical article candidates and prepares a replay shortlist. |
| `ak-xq-router` | Routes mainland China and Hong Kong equity quotes, history, flows, ownership and related reference data. |
| `a-share-analyst-data-router` | Catalogs reusable A-share price, financial-statement and disclosure inputs for analysts. |
| `eastmoney-hot-rank-router` | Captures and normalizes attention rankings for mainland Chinese, Hong Kong and U.S. equities. |
| `sw-api-router` | Provides Shenwan industry classifications, constituent and index history, and valuation context. |
| `fred-router` | Collects U.S. macroeconomic series, including credit spreads and labor-market indicators. |
| `nbs-router` | Collects Chinese growth, inflation, activity and property indicators using official and secondary series. |
| `openbb-router` | Routes U.S. equity, ETF, index, fundamental and options data through supported adapters. |
| `report-prep-notebooklm` | Assembles a source packet from company filings, reports and user-supplied documents. |

## Market and sector analysis

| Module | Capability |
| --- | --- |
| `hot-stock-ranking-classifier` | Separates attention rankings into market context, watch candidates and research queues. |
| `market-energy-volatility-regime` | Profiles market and volatility conditions across instruments, segments and time horizons. |
| `market-regime-unified-router` | Combines market, macro, style and earnings evidence into level and transition indicators. |
| `macro-insight-router` | Builds U.S.–China macro and cross-asset research from sourced indicators and conditional scenarios. |
| `market-style-cycle` | Compares return leadership across styles, industries and equity groups over multiple horizons. |
| `market-style-stability-router` | Reviews the persistence of style leadership. |
| `market-trend-router` | Summarizes sourced news and topic activity into trend evidence for stocks, industries and themes. |
| `daily-market-pulse-router` | Tracks stock and ETF movers, index contributions and candidate explanations for price moves. |
| `limit-up-microstructure-router` | Profiles A-share limit-up breadth, failed moves, consecutive advances and theme participation. |
| `iv-snapshot` | Records the implied-volatility curve and compares readings with historical ranges. |
| `global-risk-overlay-router` | Combines global macro, liquidity, volatility and event indicators for risk context. |
| `sentiment-cycle` | Classifies stock sentiment stages from financial, news, liquidity and market context. |
| `sector-leading-indicators` | Screens industries for valuation, cycle, reversal and flow evidence. |

## Selection and company research

| Module | Capability |
| --- | --- |
| `source-to-trade-universe-resolver` | Reconciles a daily research shortlist with the broader stock universe and assigns review states. |
| `company-due-diligence-router` | Defines a company-specific evidence inventory and due-diligence plan. |
| `a-share-civilization-enrichment` | Adds business mix, operating maturity, pricing and fundamental context to a company universe. |
| `openai-civilization-research-router` | Prepares AI-assisted company-screening research from attention rankings and business themes. |
| `frontier-breakthrough-detector` | Tracks published scientific or technical advances and their path from experiment to commercialization. |
| `frontier-stock-pool` | Maps emerging-technology exposures to a research universe with fundamental and market context. |
| `civilization-admission-gate` | Reviews company eligibility for the long-horizon research universe. |
| `civilization-stock-research-orchestrator` | Plans company research batches, gathers source evidence and assembles linked company reports. |
| `civilization-ai-trading-system-review` | Audits the company research workflow and prioritizes gaps in coverage, recency and readable evidence. |
| `resonance-stock-router` | Organizes candidates around agreement across macro, liquidity, style, valuation and trend evidence. |
| `chan-fractal-similarity-router` | Compares recurring price structures across equities and time frames. |
| `stock-character-router` | Profiles recurring price behavior such as follow-through, breakout reliability and reversal risk. |
| `stock-news-monitor-router` | Organizes company disclosures and news into event evidence for a covered universe. |
| `candidate-news-fusion-router` | Adds company and industry evidence to technical candidates for review. |
| `price-alert-router` | Tracks technical price conditions and separately monitors research valuation ranges. |
| `earnings-review` | Reviews reported results against expectations and structures management commentary. |
| `earnings-alpha-engine` | Tracks reporting dates, post-earnings moves, volatility changes and revision evidence. |
| `agent-cross-penetration-review` | Cross-checks company reporting across periods, business lines and disclosure measures. |
| `profitability-cycle` | Classifies profitability cycles across companies and industries. |
| `3-statements-ultra` | Builds linked income statement, balance sheet and cash-flow forecasts with consistency checks. |

## Decision support and review

| Module | Capability |
| --- | --- |
| `trade-shadow-integration-router` | Joins shadow decisions with briefing, earnings and forward-outcome evidence for review. |
| `trade-decision-router` | Assembles decision context from stock behavior, market conditions, news and research theses. |
| `trader-state-router` | Assesses readiness against execution-process criteria. |
| `scenario-probability-router` | Describes alternative price paths with scenario probabilities. |
| `trade-plan-gate-router` | Evaluates proposed plans against review criteria and human-approval requirements. |
| `position-awareness-router` | Surfaces concentration and overlooked exposures in supported portfolio inputs. |
| `portfolio-sleeve-router` | Frames target exposures for portfolio sleeves under different market conditions. |
| `personal-execution-overlay-router` | Summarizes private execution constraints for decision review. |
| `position-monitor` | Compiles watchlist and portfolio intelligence reports. |

## Validation, outcomes and calibration

| Module | Capability |
| --- | --- |
| `data-validator` | Checks source identity, freshness, cross-output consistency and downstream dependencies. |
| `data-quality-hardening-router` | Audits local research artifacts for data-quality and evidence gaps. |
| `stock-character-validation-router` | Compares stock-behavior tags with observed forward outcomes. |
| `price-alert-calibration-router` | Reviews alert behavior using outcomes after prior signals. |
| `news-event-impact-feedback-router` | Evaluates how news and event categories relate to later price outcomes. |
| `scenario-probability-calibration-router` | Compares estimated scenarios with subsequently observed price paths. |
| `portfolio-sleeve-review-router` | Reviews outcomes by portfolio sleeve. |
| `signal-outcome-evaluation-router` | Measures forward results from dated signals at multiple horizons. |
| `decision-quality-ledger-router` | Links original proposals, gate decisions, context and subsequent outcomes. |
| `gate-regret-calibration-router` | Reviews the consequences of prior gating decisions. |
| `trade-feedback-router` | Summarizes process adherence, decision errors and lessons from completed cases. |
| `trader-self-iteration-router` | Tracks proposed process changes and their review lifecycle. |

## AI-assisted research and knowledge workflows

| Module | Capability |
| --- | --- |
| `gemini-router` | Breaks down questions, plans parallel AI research and records handoff state. |
| `gemini-deep-research-router` | Tracks long-running AI research jobs and prepares their outputs for synthesis. |
| `target-user-research` | Synthesizes discussion evidence into audience research and recurring themes. |
| `serious-answer` | Structures sourced answers with distinct facts, inferences and unresolved questions. |
| `deep-research-workflow` | Combines sourced findings, notes and quality checks into a research brief. |
| `notebooklm-router-py` | Manages authorized notebooks, source imports, batch questions and transcript search. |
| `onenote-nlm-sync` | Coordinates authorized note, notebook and document-store handoffs. |
| `onenote-quick-research` | Assembles a structured research note with source and numeric cross-checks. |
| `research-wiki-builder` | Plans, checks and builds wiki views over existing research artifacts. |

## Reporting and orchestration

| Module | Capability |
| --- | --- |
| `source-to-trade-data-foundation` | Indexes local research inputs and plans incremental refreshes. |
| `daily-data-refresh` | Schedules dated producer jobs and indexes their outputs and refresh status. |
| `source-to-trade-cockpit` | Selects formal research artifacts and assembles the interactive workbench. |
| `hf-morning-brief` | Assembles pre-open macro, market, volatility and risk context. |
| `visiting-memo` | Structures company-visit findings into a memo and follow-up record. |
| `ic-memo-outliner` | Organizes research, models and evidence checks into an investment committee narrative. |
| `ic-pptx-renderer` | Renders a source-aware first draft from an investment committee outline. |
| `gemini-imagegen` | Prepares illustration requests and imports approved images for reports. |
| `pptx-template-analyzer` | Extracts layout, placeholder, size and theme information from presentation templates. |
| `html5-editor` | Generates an editable HTML workspace for research packets and reports. |
| `skill-creator` | Drafts reusable workflow instructions and evaluation cases. |

[Workbench pipelines](pipelines/README.md) · [Interactive architecture](https://z528li.github.io/ai-research-workbench/docs/architecture.html) · [Repository home](../README.md)
