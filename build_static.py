"""
Build a fully static version of the dashboard into ./dist/.

Pre-computes every JSON payload the Flask API would return (for each year filter),
copies the HTML/CSS/JS shell, and drops everything into `dist/` ready to be
uploaded to GitHub Pages, Netlify, Cloudflare Pages, etc.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from flask import Flask
from app import app as flask_app  # reuse the live endpoints

ROOT = Path(__file__).parent
# GitHub Pages can serve directly from /docs on main, so build there.
DIST = ROOT / "docs"
DATA_DIR = DIST / "data"


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def main() -> None:
    # Fresh build
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    DATA_DIR.mkdir()

    client = flask_app.test_client()

    # Discover available years and statuses from the meta endpoint
    meta = client.get("/api/meta").get_json()
    years = ["all"] + [str(y) for y in meta["years"]]
    statuses = ["all"] + [s["value"] for s in meta["statuses"]]
    _write(DATA_DIR / "meta.json", meta)

    endpoints = [
        "kpis",
        "sales-by-month",
        "orders-by-month",
        "top-products",
        "sao-paulo-share",
        "revenue-by-state",
    ]
    count = 0
    for ep in endpoints:
        for year in years:
            for status in statuses:
                resp = client.get(f"/api/{ep}?year={year}&status={status}").get_json()
                _write(DATA_DIR / f"{ep}-{year}-{status}.json", resp)
                count += 1
    print(f"wrote {count} endpoint JSON files across {len(years)} years × {len(statuses)} statuses")

    # Copy the static assets & rendered index.html
    shutil.copytree(ROOT / "static", DIST / "static")
    # Render the index template (no Jinja vars to substitute beyond url_for)
    with flask_app.test_request_context():
        from flask import render_template
        html = render_template("index.html")

    # Use relative asset paths so the site works on GitHub Pages subpaths.
    html = html.replace('href="/static/', 'href="static/')
    html = html.replace('src="/static/', 'src="static/')
    html = html.replace(
        "<!-- STATIC_MODE_INJECTION -->",
        "<script>window.DASHBOARD_STATIC = true;</script>",
    )
    (DIST / "index.html").write_text(html)

    # A tiny .nojekyll so GitHub Pages doesn't strip the `_` prefixed files (none here,
    # but it also skips Jekyll processing which is unnecessary).
    (DIST / ".nojekyll").write_text("")

    print(f"\nBuilt static site at {DIST}")
    print(f"Files:")
    for p in sorted(DIST.rglob("*")):
        if p.is_file():
            rel = p.relative_to(DIST)
            print(f"  {rel}  ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
