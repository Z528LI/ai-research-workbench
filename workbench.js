/* Source-to-Trade Market Lab. Browser-local presentation. */
"use strict";

const $ = id => document.getElementById(id);
const symbols = { stock: $("stock"), benchmark: $("benchmark"), peer: $("peer") };
const colors = ["#2153a9", "#47637e", "#008171"];
const svgNamespace = "http://www.w3.org/2000/svg";
let prices, report, chart;
let dataRevision = 0;

function put(id, value) {
  $(id).textContent = value;
}

function number(value, decimals = 2) {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function percent(value) {
  return value == null ? "—" : number(value * 100, 1) + "%";
}

function ratio(count, total) {
  return total ? `${number(count, 0)} / ${number(total, 0)}` : "—";
}

function signed(id, value, formatted) {
  put(id, formatted);
  $(id).classList.toggle("positive", value > 0);
  $(id).classList.toggle("negative", value < 0);
}

function setOptions(select, values, defaultValue) {
  select.replaceChildren(...values.map(value => new Option(value || "None", value)));
  select.value = defaultValue;
}

function setDataset(next, name, isExample) {
  prices = next;
  const tickers = [...prices.keys()].sort();
  const benchmark = ["MARKET", "SPY", "QQQ", "^GSPC", "IWM", "BENCHMARK", "INDEX"]
    .find(value => prices.has(value)) ?? prices.keys().next().value;
  const others = tickers.filter(value => value !== benchmark);
  const stock = isExample && prices.has("ATLAS") ? "ATLAS" : others[0];
  const peer = isExample && prices.has("CEDAR") ? "CEDAR" : "";
  setOptions(symbols.benchmark, tickers, benchmark);
  setOptions(symbols.stock, others, stock);
  setOptions(symbols.peer, ["", ...others.filter(value => value !== stock)], peer);
  put("data-name", name);
  $("reset-data").hidden = isExample;
  render();
}

function alignSymbols() {
  const benchmark = symbols.benchmark.value;
  const available = [...prices.keys()].filter(symbol => symbol !== benchmark).sort();
  const target = available.includes(symbols.stock.value) ? symbols.stock.value : available[0];
  const peer = available.includes(symbols.peer.value) && symbols.peer.value !== target ? symbols.peer.value : "";
  setOptions(symbols.stock, available, target);
  setOptions(symbols.peer, ["", ...available.filter(symbol => symbol !== target)], peer);
  render();
}

function svgNode(name, attributes = {}, text = "") {
  const node = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function plot(result) {
  const svg = $("price-chart");
  const slider = $("chart-date");
  const legend = $("legend");
  const points = result.points;
  svg.replaceChildren();
  legend.replaceChildren();
  svg.toggleAttribute("hidden", points.length < 2);
  $("chart-controls").hidden = points.length < 2;
  $("chart-empty").hidden = points.length >= 2;
  if (points.length < 2) return;

  svg.setAttribute("viewBox", "0 0 900 280");
  for (const [i, symbol] of result.series.entries()) {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.setProperty("--series-color", colors[i]);
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(symbol));
    legend.append(item);
  }
  let low = 100, high = 100;
  for (const point of points) {
    for (const value of point.levels) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const padding = Math.max(1, (high - low) * 0.07);
  low -= padding;
  high += padding;
  const x = i => 56 + (i / (points.length - 1)) * 822;
  const y = value => 240 - (value - low) / (high - low) * 214;

  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    const at = y(value);
    svg.append(svgNode("path", { d: `M56 ${at}H878`, stroke: "#e4ebf4" }));
    const label = Math.abs(value) > 10000 ? value.toExponential(1) : number(value, 1);
    svg.append(svgNode("text", { x: 47, y: at + 4, "text-anchor": "end" }, label));
  }
  const markers = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  for (const [i, pointIndex] of markers.entries()) {
    if (i === 1 && (pointIndex === markers[0] || pointIndex === markers[2])) continue;
    svg.append(svgNode("text", { x: x(pointIndex), y: 263, "text-anchor": ["start", "middle", "end"][i] }, points[pointIndex].date));
  }
  const stride = Math.max(1, Math.ceil(points.length / 850));
  for (const [i, color] of colors.slice(0, result.series.length).entries()) {
    const path = [];
    for (let at = 0; at < points.length; at += stride) {
      path.push(`${at ? "L" : "M"}${x(at).toFixed(2)} ${y(points[at].levels[i]).toFixed(2)}`);
    }
    const final = points.length - 1;
    if (final % stride) path.push(`L${x(final).toFixed(2)} ${y(points[final].levels[i]).toFixed(2)}`);
    svg.append(svgNode("path", { d: path.join(" "), fill: "none", stroke: color, "stroke-width": i === 0 ? 2.5 : 1.7 }));
  }
  const cursor = svgNode("line", { y1: 19, y2: 241, stroke: "#a6b4c5", "stroke-dasharray": "4 4" });
  const dots = result.series.map((_, i) => svgNode("circle", { r: 4.5, fill: colors[i], stroke: "white", "stroke-width": 1.5 }));
  svg.append(cursor, ...dots);
  slider.max = String(points.length - 1);
  slider.value = slider.max;
  chart = { x, y, cursor, dots };
  updateChartDate();
}

function updateChartDate() {
  const index = Number($("chart-date").value);
  const point = report.points[index];
  const at = chart.x(index);
  chart.cursor.setAttribute("x1", at);
  chart.cursor.setAttribute("x2", at);
  chart.dots.forEach((dot, i) => {
    dot.setAttribute("cx", at);
    dot.setAttribute("cy", chart.y(point.levels[i]));
  });
  const summary = report.series.map((symbol, i) => `${symbol} ${number(point.levels[i], 1)}`);
  put("chart-readout", `${point.date} · ${summary.join(" · ")}`);
  $("chart-date").setAttribute("aria-valuetext", point.date);
}

function renderRankings(rows, selected) {
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = document.createElement("tr");
    row.classList.toggle("selected", item.ticker === selected);
    const symbolCell = row.insertCell();
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.ticker;
    button.dataset.symbol = item.ticker;
    button.setAttribute("aria-label", `Compare ${item.ticker}`);
    symbolCell.append(button);
    for (const value of [percent(item.targetReturn), item.excess == null ? "—" : number(item.excess * 100, 1) + " pp",
      number(item.fit.beta), number(item.fit.n, 0), item.end ?? "—"]) row.insertCell().textContent = value;
    fragment.append(row);
  }
  $("rankings").replaceChildren(fragment);
  put("ranking-count", `${rows.length} stocks`);
}

function render() {
  report = MarketAnalysis.analyze(prices, {
    symbol: symbols.stock.value, benchmark: symbols.benchmark.value,
    peer: symbols.peer.value, sessions: Number($("sessions").value)
  });
  const { selected, breadth, dates } = report;
  put("data-range", `${prices.size} symbols · ${dates.at(0)} to ${dates.at(-1)}`);
  signed("stock-return", selected.targetReturn, percent(selected.targetReturn));
  put("return-dates", selected.observations > 1 ? `${selected.start} to ${selected.end}` : "Two shared dates required");
  signed("excess-return", selected.excess, selected.excess == null ? "—" : number(selected.excess * 100, 1) + " pp");
  put("benchmark-return", selected.benchmarkReturn == null ? "Shared dates with benchmark" : `${symbols.benchmark.value} ${percent(selected.benchmarkReturn)}`);
  put("market-beta", number(selected.fit.beta));
  put("beta-sample", selected.fit.beta == null ? `${selected.fit.n} pairs · requires 20 with benchmark variation` :
    `${selected.fit.n} pairs · 95% interval ${number(selected.fit.low)} to ${number(selected.fit.high)}`);
  put("advance-share", breadth.dailyEligible ? percent(breadth.advancing / breadth.dailyEligible) : "—");
  put("breadth-sample", breadth.dailyEligible ? `${ratio(breadth.advancing, breadth.dailyEligible)} eligible stocks` : "Uses matching closes");
  put("advance-count", ratio(breadth.advancing, breadth.dailyEligible));
  put("trend-count", ratio(breadth.aboveAverage, breadth.averageEligible));
  put("breadth-date", `As of ${breadth.today}`);
  put("up-capture", selected.up.value == null ? "—" : number(selected.up.value) + "×");
  put("down-capture", selected.down.value == null ? "—" : number(selected.down.value) + "×");
  put("up-n", `${selected.up.n} rising benchmark sessions`);
  put("down-n", `${selected.down.n} falling benchmark sessions`);
  plot(report);
  renderRankings(report.ranking, selected.ticker);
}

function showStatus(message, invalid = false) {
  put("data-status", message);
  $("data-status").classList.toggle("invalid", invalid);
}

function restoreExample() {
  dataRevision++;
  setDataset(MarketAnalysis.parsePrices(MarketAnalysis.exampleCsv()), "Illustrative dataset", true);
  showStatus("Synthetic prices · CSV files stay in your browser.");
}

$("csv-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  const revision = ++dataRevision;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a CSV of up to 5 MB.");
    const next = MarketAnalysis.parsePrices(await file.text());
    if (revision !== dataRevision) return;
    setDataset(next, file.name, false);
    showStatus("CSV loaded · choose the matching benchmark.");
  } catch (error) {
    if (revision === dataRevision) showStatus(error.message || "The CSV could not be read.", true);
  }
});
$("example-download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([MarketAnalysis.exampleCsv()], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "market-lab-synthetic-prices.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("reset-data").addEventListener("click", restoreExample);
$("chart-date").addEventListener("input", updateChartDate);
$("sessions").addEventListener("change", render);
symbols.benchmark.addEventListener("change", alignSymbols);
symbols.stock.addEventListener("change", alignSymbols);
symbols.peer.addEventListener("change", render);
$("rankings").addEventListener("click", event => {
  const ticker = event.target.closest("[data-symbol]")?.dataset.symbol;
  if (ticker) {
    symbols.stock.value = ticker;
    alignSymbols();
    symbols.stock.focus();
  }
});
document.querySelector(".controls").addEventListener("submit", event => event.preventDefault());
restoreExample();
