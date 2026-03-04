# FRED Tool

Modern FRED data studio with live pulls, in-browser SQL backend, custom algebraic transforms, WebGL visualization, and export.

## Live Site

- https://ihelfrich.github.io/FRED-Tool/

## What It Does

- Pull live FRED series by ID
- Search the FRED catalog (with your API key)
- Build derived variables with algebraic formulas
- Run SQL queries on the in-browser dataset table (`fred_data`)
- Yield-curve workflow (`TB3MS`, `GS10`, spread, inversion)
- Visualization modes:
  - Line / Scatter / Bar
  - Yield Dashboard (rates + spread + inversion shading)
  - Correlation Heatmap
  - 3D WebGL series stack
- Export dataset to CSV or Excel
- Export visuals to PNG or SVG

## Visual + Accessibility Layer

- Clean academic layout with high contrast and motion-safe defaults
- Three.js ambient scene with reduced-motion auto-disable
- Keyboard-visible focus states
- Live status regions via `aria-live`
- Mobile-responsive layout

## Formula Syntax

One formula per line:

```text
NEW_VAR = expression
```

Examples:

```text
YC_SPREAD = GS10 - TB3MS
YC_INVERTED = YC_SPREAD < 0
RISK_RATIO = BAMLH0A3HYCEY / BAMLC0A1CAAAEY
```

## SQL Backend

Use SQL directly in the app against `fred_data`:

```sql
SELECT DATE, GS10, TB3MS, YC_SPREAD
FROM fred_data
WHERE DATE >= '2000-01-01'
ORDER BY DATE
```

## FRED API Key

FRED API key is required for catalog search endpoints.

- https://fred.stlouisfed.org/docs/api/api_key.html

You can still pull any series directly by ID without using catalog search.

## Build + Deploy (GitHub Actions)

Deployment is Actions-driven.

Workflow:
1. `npm run build` (creates `dist/`)
2. `npm run test:smoke`
3. Deploy `dist/` to GitHub Pages

Main workflow file:
- `.github/workflows/deploy-pages.yml`

## Local Development

```bash
npm run build
npm run test:smoke
python3 -m http.server 8080
```

Then open:
- http://localhost:8080

## Tech Stack

- Vanilla HTML/CSS/JS
- Plotly.js (charts + WebGL modes)
- math.js (formula engine)
- AlaSQL (in-browser SQL backend)
- PapaParse (CSV parsing)
- SheetJS (Excel export)
- Three.js (ambient WebGL scene)
