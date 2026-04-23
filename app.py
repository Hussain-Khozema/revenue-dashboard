"""
Revenue Analytics Dashboard - Flask backend.

Loads the 4 source CSVs once at startup, then serves pre-aggregated metrics
through a small JSON API that powers the interactive dashboard.
"""
from __future__ import annotations

import os

import pandas as pd
from flask import Flask, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def _load_data() -> dict[str, pd.DataFrame]:
    """Load all 4 CSVs and pre-compute a merged order-level frame."""
    orders = pd.read_csv(os.path.join(BASE_DIR, "orders_rev_df.csv"))
    items = pd.read_csv(os.path.join(BASE_DIR, "df_OrderItems.csv"))
    customers = pd.read_csv(os.path.join(BASE_DIR, "df_Customers.csv"))
    products = pd.read_csv(os.path.join(BASE_DIR, "df_Products.csv"))

    # The raw files contain duplicate rows per id — collapse so joins don't fan out.
    customers = customers.drop_duplicates(subset="customer_id", keep="first")
    products = products.drop_duplicates(subset="product_id", keep="first")

    orders["order_purchase_timestamp"] = pd.to_datetime(
        orders["order_purchase_timestamp"], errors="coerce"
    )
    orders = orders.dropna(subset=["order_purchase_timestamp"]).copy()
    orders["order_month"] = orders["order_purchase_timestamp"].dt.to_period("M").astype(str)
    orders["order_year"] = orders["order_purchase_timestamp"].dt.year

    # Order-level revenue (sum of item price + shipping across all line items in the order)
    items["line_total"] = items["price"].fillna(0) + items["shipping_charges"].fillna(0)
    order_revenue = (
        items.groupby("order_id", as_index=False)
        .agg(order_revenue=("line_total", "sum"), item_count=("product_id", "count"))
    )

    orders_enriched = orders.merge(order_revenue, on="order_id", how="left")
    orders_enriched = orders_enriched.merge(
        customers[["customer_id", "customer_city", "customer_state"]],
        on="customer_id",
        how="left",
    )

    return {
        "orders": orders_enriched,
        "items": items,
        "customers": customers,
        "products": products,
    }


DATA = _load_data()


def _filter_by_year(df: pd.DataFrame, year: str | None) -> pd.DataFrame:
    if not year or year == "all":
        return df
    try:
        return df[df["order_year"] == int(year)]
    except ValueError:
        return df


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/meta")
def api_meta():
    """Return the list of years available so the UI can build the filter."""
    years = sorted(DATA["orders"]["order_year"].dropna().unique().astype(int).tolist())
    return jsonify({"years": years})


@app.route("/api/kpis")
def api_kpis():
    """High-level KPI cards."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    total_revenue = float(orders["order_revenue"].sum())
    total_orders = int(orders["order_id"].nunique())
    unique_customers = int(orders["customer_id"].nunique())
    avg_order_value = float(total_revenue / total_orders) if total_orders else 0.0

    return jsonify(
        {
            "total_revenue": round(total_revenue, 2),
            "total_orders": total_orders,
            "unique_customers": unique_customers,
            "avg_order_value": round(avg_order_value, 2),
        }
    )


@app.route("/api/sales-by-month")
def api_sales_by_month():
    """Monthly revenue timeseries."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    monthly = (
        orders.groupby("order_month", as_index=False)["order_revenue"]
        .sum()
        .sort_values("order_month")
    )
    return jsonify(
        {
            "labels": monthly["order_month"].tolist(),
            "values": [round(v, 2) for v in monthly["order_revenue"].tolist()],
        }
    )


@app.route("/api/orders-by-month")
def api_orders_by_month():
    """Monthly distinct order count."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    monthly = (
        orders.groupby("order_month")["order_id"].nunique().reset_index(name="order_count")
        .sort_values("order_month")
    )
    return jsonify(
        {
            "labels": monthly["order_month"].tolist(),
            "values": monthly["order_count"].astype(int).tolist(),
        }
    )


@app.route("/api/top-products")
def api_top_products():
    """Top 10 most-purchased products (by line-item occurrence count)."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    items = DATA["items"].merge(
        orders[["order_id"]], on="order_id", how="inner"
    )

    top = (
        items.groupby("product_id")
        .size()
        .reset_index(name="purchase_count")
        .sort_values("purchase_count", ascending=False)
        .head(10)
    )

    top = top.merge(
        DATA["products"][["product_id", "product_category_name"]],
        on="product_id",
        how="left",
    )
    top["product_category_name"] = top["product_category_name"].fillna("unknown")

    labels = [
        f"{row.product_category_name} ({row.product_id[:6]}…)"
        for row in top.itertuples()
    ]

    return jsonify(
        {
            "labels": labels,
            "values": top["purchase_count"].astype(int).tolist(),
            "product_ids": top["product_id"].tolist(),
            "categories": top["product_category_name"].tolist(),
        }
    )


@app.route("/api/sao-paulo-share")
def api_sao_paulo_share():
    """Percentage of unique customers ordering from Sao Paulo per month."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    orders = orders.copy()
    orders["is_sao_paulo"] = (
        orders["customer_city"].fillna("").str.strip().str.lower() == "sao paulo"
    )

    total_by_month = (
        orders.groupby("order_month")["customer_id"].nunique().rename("total_customers")
    )
    sp_by_month = (
        orders[orders["is_sao_paulo"]]
        .groupby("order_month")["customer_id"]
        .nunique()
        .rename("sp_customers")
    )

    grouped = (
        pd.concat([total_by_month, sp_by_month], axis=1)
        .fillna(0)
        .reset_index()
        .sort_values("order_month")
    )
    grouped["share_pct"] = (
        grouped["sp_customers"] / grouped["total_customers"].replace(0, pd.NA) * 100
    ).fillna(0)

    return jsonify(
        {
            "labels": grouped["order_month"].tolist(),
            "values": [round(v, 2) for v in grouped["share_pct"].tolist()],
            "sp_customers": grouped["sp_customers"].astype(int).tolist(),
            "total_customers": grouped["total_customers"].astype(int).tolist(),
        }
    )


@app.route("/api/revenue-by-state")
def api_revenue_by_state():
    """Revenue and order counts aggregated per Brazilian state (customer_state)."""
    year = request.args.get("year", "all")
    orders = _filter_by_year(DATA["orders"], year)

    by_state = (
        orders.dropna(subset=["customer_state"])
        .groupby("customer_state")
        .agg(
            revenue=("order_revenue", "sum"),
            orders=("order_id", "nunique"),
            customers=("customer_id", "nunique"),
        )
        .reset_index()
        .sort_values("revenue", ascending=False)
    )

    return jsonify(
        {
            "states": by_state["customer_state"].tolist(),
            "revenue": [round(v, 2) for v in by_state["revenue"].tolist()],
            "orders": by_state["orders"].astype(int).tolist(),
            "customers": by_state["customers"].astype(int).tolist(),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
