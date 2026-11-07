# Self-hosted Research Workbench

Generate 15 English research pages and run 88 public research modules from your own clone. The public implementations use independent methods and inputs. The hosted interview Workbench remains a separately reviewed snapshot of the production system.

## Start locally

Install [Node.js 22 or later](https://nodejs.org/). The repository has no package dependencies.

```sh
git clone https://github.com/Z528LI/ai-research-workbench.git
cd ai-research-workbench
npm run workbench:demo
```

Open `.workbench/demo/index.html`. All 15 pages work offline with synthetic examples. The homepage links to a dated set of individual pages under `reports/`.

```sh
npm run workbench:refresh
```

Open `.workbench/live/index.html`. The default live build uses real Treasury yields and U.S. labor and price data. Use `-- --output path/to/site` to set the output directory. Each view shows its latest observation date. Run dates and underlying release or trading dates can differ. On networks that require an HTTP proxy, set `NODE_USE_ENV_PROXY=1` on a supported Node version.

A build validates enabled inputs, writes a complete set of pages, and atomically updates the homepage. A failed refresh leaves the prior homepage and its linked pages in place. Local output retains prior dated sets under `reports/`. Set `WORKBENCH_REQUIRE_FULL_COVERAGE=true` after connecting every view to prevent a refresh from publishing a homepage with an unconnected view or insufficient history for its core calculations.

## The 15 pages and their data

| View | Sources and public calculation |
| --- | --- |
| US and China Macro | FRED H.15 Treasury rates and BLS unemployment and CPI-U by default. Add dated China macro observations through the research input bundle. |
| Market Regime | Daily closes for a benchmark and peers. Compare advancing and declining shares of the same dated universe. |
| US Equity Rotation | U.S. daily closes. Calculate matched 20-session returns and benchmark excess returns. |
| Limit-Up and Hotspot History | A-share session bars with actual eligible price limits and theme tags. Count closes at the limit and intraday tests that failed to hold. |
| A-Share Market Structure | A-share daily closes. Compare short-term and medium-term returns across the supplied universe. |
| Market Stress Indicators | A-share daily closes. Calculate rolling realized volatility and drawdown. |
| Stock Behavior and Peers | Daily closes and a benchmark. Compare matched returns and beta, with coverage shown. |
| Technical Selection and Backtests | Daily closes. Track moving averages and evaluate outcomes after a next-session entry. |
| Thematic Research Library | Optional live Crossref metadata or an input bibliography. Group dated references by topic. |
| Theme Replay | Dated theme members and returns. Aggregate participation and average returns within each session and theme. |
| Limit-Up Research | The same A-share limit data, with listing groups. Compare events across groups and their eligible security-days. |
| Company News and Events | SEC filings or approved event records. Index dated events and link their public source documents. |
| Earnings Alpha | SEC filing index and optional reported and expected EPS plus daily closes. Show the surprise and subsequent observed returns separately. |
| Core60 Valuation | Dated cash-flow and capital inputs for a configured company list. Compare bear, base and bull discounted cash-flow scenarios. |
| Frontier Stock Pool | Dated issuer revenue exposures and evidence. Compare disclosed exposures and retain their source links. |

Live views start with the inputs you connect. The 15-view demo exercises every page. A view with no configured source opens its own setup instructions, and a connected view shows its actual data and coverage. The public edition describes its own universe, calculations and data dates.

[Input schemas and examples](inputs.md) · [H.15](https://www.federalreserve.gov/releases/h15/) · [BLS API](https://www.bls.gov/developers/) · [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

### Connect public data

- Set `WORKBENCH_CROSSREF=true` for the thematic library. It reads titles, dates and DOI links for a bounded research query. Full text remains with the publishers.
- For SEC views, set `WORKBENCH_ISSUERS` to a JSON array of up to five `{"symbol":"AAPL","cik":"0000320193"}` issuer objects. Set `SEC_USER_AGENT` to your application name and a contact email you control. The adapter validates the issuer and keeps the contact out of the report. [SEC access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- For U.S. prices, supply `-- --csv path/to/prices.csv` with `date,symbol,close` and set `WORKBENCH_BENCHMARK` if your benchmark differs from `SPY`. Alternatively, set your own `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` for adjusted Alpaca IEX daily bars. Set `WORKBENCH_SYMBOLS` to change the default universe. This route uses prior New York calendar dates for completed bars. The public Pages workflow keeps local files and Alpaca credentials out of the deployment. [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbars)
- Use the [research input bundle](inputs.md) for authorized public datasets or your own local inputs. Each section carries a source link. The bundle can cover both market universes, limit data, theme members, publications, issuer news, earnings events, scenario inputs and business exposures.

```sh
npm run workbench:refresh -- --inputs path/to/research-inputs.json
```

Schedule the same command locally to use your own datasets and data accounts. Your upstream exporter can update the file before the daily build. A data source's observation date stays visible even when a build runs without a new observation.

## Run any of the 88 modules

```sh
npm run workbench:modules -- list
npm run workbench:modules -- manifest market-regime-unified-router
npm run workbench:modules -- run market-regime-unified-router --demo
npm run workbench:modules -- run market-regime-unified-router --input regime.json
```

Use the manifest for the exact input fields and a synthetic example for that command. The result is JSON. Every module has its own operation. Modules that refer to outside platforms consume compatible exports, produce handoff packets or plan work for a reviewer. The CLI keeps platform authentication and model execution with the operator. Decision and portfolio modules produce research or paper-review outputs.

The daily workbench invokes the modules needed for its connected pages. Operators can schedule other module commands against their own files. The [capability index](../docs/module-capabilities.md) maps the identifiers to their purpose in the broader research system.

## Publish a daily report from your own GitHub fork

1. Fork the repository and enable **Self-hosted Workbench** in GitHub Actions.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions**, set the repository variable `WORKBENCH_ENABLE_PAGES=true`. Add optional SEC and Crossref settings there. For authorized shared research data, set `WORKBENCH_PUBLIC_INPUT_URL` to a public `raw.githubusercontent.com` JSON URL. Keep that input up to date through your own source process and confirm you can share the resulting report.
4. Under **Actions → Self-hosted Workbench**, run the workflow on the default branch with **Publish** selected. Open `/daily/` on your fork's Pages site after the deployment succeeds. Market Lab is available at the site root.

The schedule runs at 23:17 UTC daily. Published view URLs remain stable under `/daily/reports/current/`. GitHub can delay scheduled jobs or disable them on inactive public repositories. The job stages the site only after the build succeeds. On failure the last successful deployment stays available. Leave **Publish** unchecked to run a real-data build without deploying.

[GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Verify

Run `npm test` for the existing Market Lab suite and the self-hosted report and module checks.
