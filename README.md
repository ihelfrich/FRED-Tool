# FRED Tool

A static web app for live FRED data exploration with:

- Live pulls by series ID from FRED
- FRED catalog search (with API key)
- Custom algebraic formula builder (`NEW_VAR = expression`)
- Yield curve helper formulas and inversion shading
- Charting and image export (PNG/SVG)
- Data export (CSV/Excel)

## Live App

Once GitHub Pages is enabled on this repo, the site deploys from `main` using GitHub Actions.

## Features

1. `Catalog + Series`
- Search FRED catalog by keyword
- Add series from results
- Manually add any series ID
- Assign aliases for formula variables

2. `Formula Builder`
- Use expressions via `math.js`
- Multiple formulas supported (one per line)
- Example:
  - `YC_SPREAD = GS10 - TB3MS`
  - `YC_INVERTED = YC_SPREAD < 0`

3. `Visualization`
- Line, scatter, and bar charts
- Multi-series plotting
- Optional inversion shading when `YC_SPREAD` exists

4. `Export`
- Download merged dataset as CSV or Excel (`.xlsx`)
- Export charts as PNG or SVG

## Setup Notes

### 1) FRED API key (catalog search)
FRED API key is required for catalog search endpoints.

Get one here:
- https://fred.stlouisfed.org/docs/api/api_key.html

You can still pull series by ID without using catalog search.

### 2) Browser CORS
FRED endpoints are proxied for browser compatibility in static hosting.
Default proxy: `api.codetabs.com`.

If you want to use your own proxy, change `PROXY_BASE` in `app.js`.

## Local Run

Because this is a static app, you can open `index.html` directly, but a local static server is recommended:

```bash
python3 -m http.server 8080
```

Then open:
- http://localhost:8080

## Deploy to GitHub Pages

This repo includes:
- `.github/workflows/deploy-pages.yml`

Steps:
1. Push to `main`
2. In GitHub repo settings, ensure Pages is configured for "GitHub Actions"
3. Wait for the "Deploy GitHub Pages" workflow to finish

## Tech Stack

- Vanilla HTML/CSS/JS
- Plotly.js (charting)
- PapaParse (CSV parsing)
- math.js (formula evaluation)
- SheetJS (Excel export)
