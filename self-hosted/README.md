# Self-hosted Research Workbench

Build and refresh your own research dashboard. This edition uses public sources and independent calculations. It provides seven views when all inputs are configured. The production Cockpit, private datasets and 15 published interview views have a separate release process.

## Build a sample in one command

Clone the repository and run the demo with [Node.js 22 or later](https://nodejs.org/). There are no packages to install.

```sh
git clone https://github.com/Z528LI/ai-research-workbench.git
cd ai-research-workbench
npm run workbench:demo
```

Open `.workbench/demo/index.html` in your browser. The example is synthetic and works offline. It includes all seven views.

## Refresh with live public data

```sh
npm run workbench:refresh
```

Open `.workbench/live/index.html`. The default refresh fetches U.S. Treasury constant maturity yields and U.S. employment and price indicators. Add `-- --output path/to/site` to choose a directory. The command validates inputs and renders one self-contained HTML file. A failed build leaves any prior page in that directory available. On a network that uses an HTTP proxy, enable Node's environment-proxy support with `NODE_USE_ENV_PROXY=1` on a supported Node version.

| View | Data and method |
| --- | --- |
| Treasury Curve | Federal Reserve H.15 rates from FRED. Compare 3-month, 2-year, 10-year and 30-year yields and their dated histories. |
| Macro Pulse | BLS unemployment rate and all-items CPI-U. Each series keeps its own observation period. CPI-U is an index. |
| Market Breadth | Count advancing names and those above their 20-session average using eligible observations on benchmark dates. |
| Relative Risk | Compare 20-session matched returns and estimate beta on matched daily returns over up to 60 benchmark sessions. |
| Technical Screen | Compare each name's close with its trailing 20- and 50-session averages where the window is complete. |
| Company Filings | View dated SEC filing metadata and primary-document links for a configured issuer list. |
| Earnings Filings | Filter periodic reports and 8-K earnings disclosures from the same SEC source. |

Treasury and Macro are on by default. Configure SEC for the two filing views and provide prices for the three market views. The dashboard distinguishes observed dates from generation time. Monthly indicators change as releases arrive. A weekday or weekend run can carry forward an earlier valid observation.

[H.15 release](https://www.federalreserve.gov/releases/h15/) · [BLS public API](https://www.bls.gov/developers/) · [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

### Add SEC filings

Set `WORKBENCH_ISSUERS` to a JSON array with up to five entries, each containing a ticker and SEC CIK. Set `SEC_USER_AGENT` to an organization or application name and a contact email you control, as required by SEC fair-access guidance. The email is used in requests and is kept out of the report.

```sh
export WORKBENCH_ISSUERS='[{"symbol":"AAPL","cik":"0000320193"}]'
export SEC_USER_AGENT='Your Research App contact@example.com'
npm run workbench:refresh
```

Use your own contact in place of the example. The adapter confirms issuer identity and links to primary documents. Earnings Filings is a filing index. Financial statements and estimated earnings surprises are outside this edition's scope. [SEC fair-access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

### Add market analytics locally

Use a recent, consistent daily-price CSV with `date,symbol,close`. Set `WORKBENCH_BENCHMARK` if the benchmark symbol differs from `SPY`.

```sh
WORKBENCH_BENCHMARK=INDEX npm run workbench:refresh -- --csv /path/to/prices.csv
```

For automated price retrieval, set your own `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` in your local environment and run `npm run workbench:refresh`. The adapter requests adjusted historical daily bars from Alpaca's IEX feed. The default universe is SPY, QQQ, IWM, XLF, XLK and XLE. Set `WORKBENCH_SYMBOLS` to your own comma-separated symbols and `WORKBENCH_BENCHMARK` to your benchmark. Each price input should use a consistent adjustment convention. Data coverage reflects the feed and instruments you select.

Schedule the same refresh command on your machine for a private daily workbench with market data. For example, add the following line to your local crontab after adjusting the paths. Supply any credentials to the job through your local environment or secret manager.

```cron
17 23 * * * cd /absolute/path/to/ai-research-workbench && /absolute/path/to/node self-hosted/build.mjs --live
```

This schedule uses your machine's timezone. Alpaca bars use prior New York calendar dates so the latest day's bar cannot be mistaken for a completed session. Local builds keep data and credentials on the machine. Follow the redistribution terms of the price source before sharing a report. The public Pages workflow runs the Treasury, BLS and optional SEC path. [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbars) · [Market data terms](https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf)

## Publish a daily report from your own GitHub fork

1. Fork the repository and enable GitHub Actions on your fork. Enable the **Self-hosted Workbench** workflow if GitHub disabled it.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions → Variables**, create `WORKBENCH_ENABLE_PAGES` with value `true`. For optional SEC views, add the `WORKBENCH_ISSUERS` variable and a `SEC_USER_AGENT` repository secret.
4. Under **Actions → Self-hosted Workbench**, choose **Run workflow** on the default branch and select **Publish**. After success, open `/daily/` on your fork's Pages site. The site root still opens Market Lab.

The workflow is scheduled for 23:17 UTC daily on the default branch. GitHub can delay scheduled jobs and disables them on inactive public repositories after 60 days. Check the Actions log for the build result and the observation dates shown on the page. Each deployment is staged only after the enabled sources and generated page pass validation. If the refresh fails, the prior Pages deployment stays available. To run a live build check without publishing, leave **Publish** unchecked.

[GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Verify locally

```sh
npm test
```

The tests cover Market Lab and the self-hosted builders. The [production pipeline notes](../docs/pipelines/README.md) document the separate interview Workbench.
