# Revenue Analytics Dashboard

Interactive dashboard for the VP of Revenue, built on top of four source datasets:

- `orders_rev_df.csv` – order header (timestamps, status, customer)
- `df_OrderItems.csv` – order line items (price + shipping)
- `df_Customers.csv` – customer location (city, state)
- `df_Products.csv` – product category + dimensions

`df_Payments.csv` is intentionally **not** used.

## What it shows

1. **Sales by month** – total revenue (item price + shipping) per purchase month.
2. **Order volume by month** – distinct orders per month.
3. **Top 10 products** – most frequently purchased product IDs with category.
4. **São Paulo customer share** – % of unique customers per month whose city is `sao paulo`.
5. **Revenue map (Brazilian states)** – choropleth of revenue / orders / customers by `customer_state`, rendered on a log scale so mid-tier states remain distinguishable next to São Paulo.

Plus KPI cards (total revenue, orders, unique customers, avg order value) and a year filter that updates every chart — including the map.

## Run it locally (Flask + live API)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open <http://127.0.0.1:5050/>.

## Build a static version for deployment

```bash
python build_static.py
```

This pre-computes every API response into `docs/data/*.json` and produces a
fully static site in `docs/` that can be served from GitHub Pages, Netlify,
Cloudflare Pages, or any static host. No Python runtime required.

Serve it locally to test:

```bash
cd docs && python3 -m http.server 8000
```

## Stack

- **Flask** serves the HTML shell and a JSON API under `/api/*`.
- **pandas** loads the CSVs once at startup and computes all aggregations.
- **Chart.js** renders the bar/line/area charts (with line/bar toggles).
- **Plotly.js** renders the Brazilian-states choropleth (GeoJSON served from `static/data/`).
- Custom dark theme — no external UI framework.
