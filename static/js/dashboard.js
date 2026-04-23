/* Revenue Analytics Dashboard front-end.
   Fetches pre-aggregated metrics from the Flask API and renders Chart.js charts. */

const state = {
  year: "all",
  charts: {}, // name -> Chart instance
  data: {},   // name -> last fetched payload
  types: { salesChart: "line", ordersChart: "bar", productsChart: "bar", spChart: "line" },
  mapMetric: "revenue",
  brazilGeo: null,
};

// When hosted on GitHub Pages / Netlify / local file-server, we serve pre-computed
// JSON from /data/*.json. When running `python app.py`, we hit the live Flask API.
// The static build writes `window.DASHBOARD_STATIC = true` into index.html.
const STATIC_MODE = typeof window !== "undefined" && window.DASHBOARD_STATIC === true;

function apiUrl(path) {
  // path is e.g. "/api/kpis?year=2018" or "/api/meta"
  if (!STATIC_MODE) return path;
  const [ep, qs] = path.replace(/^\/api\//, "").split("?");
  if (ep === "meta") return "data/meta.json";
  const params = new URLSearchParams(qs || "");
  const year = params.get("year") || "all";
  return `data/${ep}-${year}.json`;
}

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
const fmtInt = (n) => new Intl.NumberFormat("en-US").format(n);
const fmtPct = (n) => `${n.toFixed(1)}%`;

const loader = document.getElementById("loader");
const showLoader = (on) => loader.classList.toggle("hidden", !on);

async function jget(url) {
  const r = await fetch(apiUrl(url));
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// Chart.js shared config
// ---------------------------------------------------------------------------
Chart.defaults.color = "#93a0c8";
Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
Chart.defaults.font.size = 12;

const gridColor = "rgba(147, 160, 200, 0.12)";
const gridAxis = { grid: { color: gridColor, drawBorder: false }, ticks: { color: "#93a0c8" } };

function makeGradient(ctx, color1, color2) {
  const g = ctx.createLinearGradient(0, 0, 0, 360);
  g.addColorStop(0, color1);
  g.addColorStop(1, color2);
  return g;
}

// ---------------------------------------------------------------------------
// Chart renderers
// ---------------------------------------------------------------------------
function renderLineOrBar(name, type, labels, values, opts) {
  const canvas = document.getElementById(name);
  const ctx = canvas.getContext("2d");

  if (state.charts[name]) {
    state.charts[name].destroy();
  }

  const baseColor = opts.color || "#7c5cff";
  const fillTop = opts.fillTop || "rgba(124, 92, 255, 0.55)";
  const fillBottom = opts.fillBottom || "rgba(124, 92, 255, 0.02)";

  const dataset = {
    label: opts.label,
    data: values,
    borderColor: baseColor,
    backgroundColor:
      type === "line" ? makeGradient(ctx, fillTop, fillBottom) : makeGradient(ctx, fillTop, baseColor),
    borderWidth: 2,
    pointRadius: type === "line" ? 3 : 0,
    pointHoverRadius: 6,
    pointBackgroundColor: baseColor,
    tension: 0.35,
    fill: type === "line",
    borderRadius: type === "bar" ? 8 : 0,
    maxBarThickness: 48,
  };

  state.charts[name] = new Chart(ctx, {
    type,
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f1530",
          borderColor: "#232a55",
          borderWidth: 1,
          padding: 10,
          titleColor: "#e7ecff",
          bodyColor: "#e7ecff",
          callbacks: opts.tooltipCallbacks,
        },
      },
      scales: {
        x: gridAxis,
        y: {
          ...gridAxis,
          ticks: {
            color: "#93a0c8",
            callback: opts.yTickFormatter || ((v) => v),
          },
        },
      },
    },
  });
}

function renderSales() {
  const d = state.data.sales;
  if (!d) return;
  renderLineOrBar("salesChart", state.types.salesChart, d.labels, d.values, {
    label: "Revenue",
    color: "#7c5cff",
    fillTop: "rgba(124, 92, 255, 0.55)",
    fillBottom: "rgba(124, 92, 255, 0.02)",
    yTickFormatter: (v) => fmtMoney(v),
    tooltipCallbacks: {
      label: (ctx) => `  Revenue: ${fmtMoney(ctx.parsed.y)}`,
    },
  });
}

function renderOrders() {
  const d = state.data.orders;
  if (!d) return;
  renderLineOrBar("ordersChart", state.types.ordersChart, d.labels, d.values, {
    label: "Orders",
    color: "#29d6c6",
    fillTop: "rgba(41, 214, 198, 0.55)",
    fillBottom: "rgba(41, 214, 198, 0.02)",
    yTickFormatter: (v) => fmtInt(v),
    tooltipCallbacks: {
      label: (ctx) => `  Orders: ${fmtInt(ctx.parsed.y)}`,
    },
  });
}

function renderTopProducts() {
  const d = state.data.products;
  if (!d) return;
  const canvas = document.getElementById("productsChart");
  const ctx = canvas.getContext("2d");
  if (state.charts.productsChart) state.charts.productsChart.destroy();

  state.charts.productsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: d.labels,
      datasets: [
        {
          label: "Purchases",
          data: d.values,
          backgroundColor: makeGradient(ctx, "rgba(255, 143, 92, 0.85)", "rgba(124, 92, 255, 0.85)"),
          borderRadius: 8,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f1530",
          borderColor: "#232a55",
          borderWidth: 1,
          callbacks: {
            title: (items) => items[0].label.split(" (")[0],
            label: (ctx) => {
              const i = ctx.dataIndex;
              return [
                `Purchases: ${fmtInt(ctx.parsed.x)}`,
                `Category:  ${d.categories[i]}`,
                `Product ID: ${d.product_ids[i]}`,
              ];
            },
          },
        },
      },
      scales: { x: gridAxis, y: gridAxis },
    },
  });
}

function renderSP() {
  const d = state.data.sp;
  if (!d) return;
  renderLineOrBar("spChart", state.types.spChart, d.labels, d.values, {
    label: "São Paulo %",
    color: "#ff8f5c",
    fillTop: "rgba(255, 143, 92, 0.55)",
    fillBottom: "rgba(255, 143, 92, 0.02)",
    yTickFormatter: (v) => `${v}%`,
    tooltipCallbacks: {
      label: (ctx) => {
        const i = ctx.dataIndex;
        return [
          `  São Paulo share: ${fmtPct(ctx.parsed.y)}`,
          `  SP customers:    ${fmtInt(d.sp_customers[i])}`,
          `  Total customers: ${fmtInt(d.total_customers[i])}`,
        ];
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Brazil revenue choropleth (Plotly)
// ---------------------------------------------------------------------------
async function ensureGeoJson() {
  if (state.brazilGeo) return state.brazilGeo;
  const geoPath = STATIC_MODE ? "static/data/brazil-states.geojson" : "/static/data/brazil-states.geojson";
  const r = await fetch(geoPath);
  const geo = await r.json();
  // Plotly locates features via `featureidkey`, so ensure each feature has an id.
  geo.features.forEach((f) => {
    f.id = f.properties.sigla;
  });
  state.brazilGeo = geo;
  return geo;
}

function renderMap() {
  const d = state.data.map;
  const geo = state.brazilGeo;
  if (!d || !geo) return;

  const metric = state.mapMetric;
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const compactMoney = (v) => "R$" + compact.format(Math.max(0, v));
  const compactInt = (v) => compact.format(Math.max(0, v));
  const metricLabels = {
    revenue: { title: "Revenue (R$)", fmt: (v) => fmtMoney(v), fmtShort: compactMoney },
    orders: { title: "Orders", fmt: (v) => fmtInt(v), fmtShort: compactInt },
    customers: { title: "Unique customers", fmt: (v) => fmtInt(v), fmtShort: compactInt },
  };
  const mLabel = metricLabels[metric];

  const raw = d[metric];
  // Log-transform z so a few dominant states don't wash out the rest.
  const zLog = raw.map((v) => Math.log10((v || 0) + 1));
  const zMin = Math.min(...zLog);
  const zMax = Math.max(...zLog);

  // Build tick values in the log-space that display as original-unit labels.
  const tickCount = 5;
  const tickVals = [];
  const tickText = [];
  for (let i = 0; i < tickCount; i++) {
    const t = zMin + ((zMax - zMin) * i) / (tickCount - 1);
    tickVals.push(t);
    const rawVal = Math.pow(10, t) - 1;
    tickText.push(mLabel.fmtShort(rawVal));
  }

  const trace = {
    type: "choropleth",
    geojson: geo,
    featureidkey: "properties.sigla",
    locations: d.states,
    z: zLog,
    zmin: zMin,
    zmax: zMax,
    colorscale: [
      [0, "#1a2146"],
      [0.2, "#2f3a8a"],
      [0.45, "#5b4fd1"],
      [0.75, "#7c5cff"],
      [1, "#29d6c6"],
    ],
    marker: { line: { color: "#0b1020", width: 0.6 } },
    colorbar: {
      title: { text: mLabel.title, font: { color: "#e7ecff", size: 12 } },
      tickfont: { color: "#93a0c8", size: 11 },
      tickvals: tickVals,
      ticktext: tickText,
      outlinewidth: 0,
      thickness: 14,
      x: 1.02,
    },
    customdata: d.states.map((_, i) => [d.revenue[i], d.orders[i], d.customers[i]]),
    hovertemplate:
      "<b>%{location}</b><br>" +
      "Revenue: R$%{customdata[0]:,.0f}<br>" +
      "Orders: %{customdata[1]:,.0f}<br>" +
      "Customers: %{customdata[2]:,.0f}<extra></extra>",
  };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 0, r: 0, t: 0, b: 0 },
    geo: {
      scope: "south america",
      fitbounds: "locations",
      visible: false,
      bgcolor: "rgba(0,0,0,0)",
      showframe: false,
      showcoastlines: false,
      showland: true,
      landcolor: "rgba(35, 42, 85, 0.25)",
    },
    font: { color: "#e7ecff", family: "Inter, sans-serif" },
  };

  Plotly.react("mapChart", [trace], layout, {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "toImage"],
  });
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
function renderKpis(k) {
  document.getElementById("kpiRevenue").textContent = fmtMoney(k.total_revenue);
  document.getElementById("kpiOrders").textContent = fmtInt(k.total_orders);
  document.getElementById("kpiCustomers").textContent = fmtInt(k.unique_customers);
  document.getElementById("kpiAOV").textContent = fmtMoney(k.avg_order_value);
}

// ---------------------------------------------------------------------------
// Data load + UI wiring
// ---------------------------------------------------------------------------
async function loadAll() {
  showLoader(true);
  try {
    const q = `?year=${encodeURIComponent(state.year)}`;
    const [kpis, sales, orders, products, sp, map, _geo] = await Promise.all([
      jget("/api/kpis" + q),
      jget("/api/sales-by-month" + q),
      jget("/api/orders-by-month" + q),
      jget("/api/top-products" + q),
      jget("/api/sao-paulo-share" + q),
      jget("/api/revenue-by-state" + q),
      ensureGeoJson(),
    ]);
    state.data = { kpis, sales, orders, products, sp, map };
    renderKpis(kpis);
    renderSales();
    renderOrders();
    renderTopProducts();
    renderSP();
    renderMap();
  } catch (err) {
    console.error(err);
    alert("Failed to load dashboard data. Check the server logs.");
  } finally {
    showLoader(false);
  }
}

async function initYearFilter() {
  const meta = await jget("/api/meta");
  const sel = document.getElementById("yearFilter");
  sel.innerHTML =
    `<option value="all">All years</option>` +
    meta.years.map((y) => `<option value="${y}">${y}</option>`).join("");
  sel.addEventListener("change", (e) => {
    state.year = e.target.value;
    loadAll();
  });
}

function wireChartToggles() {
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const type = btn.dataset.type;
      state.types[target] = type;

      document
        .querySelectorAll(`.toggle-btn[data-target="${target}"]`)
        .forEach((b) => b.classList.toggle("active", b === btn));

      if (target === "salesChart") renderSales();
      if (target === "ordersChart") renderOrders();
      if (target === "spChart") renderSP();
    });
  });
}

function wireMapToggles() {
  document.querySelectorAll("[data-map-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mapMetric = btn.dataset.mapMetric;
      document
        .querySelectorAll("[data-map-metric]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      renderMap();
    });
  });
}

function wireNav() {
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      a.classList.add("active");
    });
  });
}

document.getElementById("refreshBtn").addEventListener("click", loadAll);

(async function boot() {
  wireChartToggles();
  wireMapToggles();
  wireNav();
  await initYearFilter();
  await loadAll();
})();
