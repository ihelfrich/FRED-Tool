# FRED Tool

Modern macro data studio running on GitHub Pages (deployed via GitHub Actions) with:

- Live FRED pulls by series ID
- FRED catalog search
- FRED API v2 bulk-release pulls with cursor pagination
- BLS integration (live API and static snapshot fallback)
- External CSV integration for other public data sources
- In-browser SQL backend (`fred_data` table)
- Formula engine for custom variables
- WebGL-powered visual modes and chart export

## Live Site

- https://ihelfrich.github.io/FRED-Tool/

## Data Providers

### FRED
- Live per-series pull via `fredgraph.csv`
- Catalog search via FRED API
- Bulk release pull via **FRED API v2** endpoint:
  - `/fred/v2/release/observations`

### BLS
- Live pulls via BLS Public API v2 (`timeseries/data`)
- Optional BLS API key for larger limits

### Snapshot Backend (GitHub Actions)
The deploy workflow can prebuild provider snapshots and publish them with the static site under `data/snapshots/`:

- `data/snapshots/index.json`
- `data/snapshots/fred_v2_release_<id>.json`
- `data/snapshots/bls_bulk.json`

The frontend auto-detects these snapshots and uses them as fast/static fallback.

## Query/Transform Layers

### 1) Algebraic formulas
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

### 2) SQL backend
Run SQL against the in-browser table `fred_data`:

```sql
SELECT DATE, GS10, TB3MS, YC_SPREAD
FROM fred_data
WHERE DATE >= '2000-01-01'
ORDER BY DATE
```

## Visualization Modes

- Line / Scatter / Bar
- Yield Dashboard (rates + spread + inversion shading)
- Correlation Heatmap
- 3D WebGL series stack

Export:
- CSV / Excel
- PNG / SVG

## Keys

### FRED API key
Required for:
- Catalog search
- Live FRED API v2 bulk pulls

Get key:
- https://fred.stlouisfed.org/docs/api/api_key.html

### BLS API key (optional)
Improves BLS request limits.

## GitHub Actions Deployment

Workflow: `.github/workflows/deploy-pages.yml`

Pipeline:
1. Build provider snapshots (`npm run data:build`)
2. Build static site (`npm run build`)
3. Smoke tests (`npm run test:smoke`)
4. Deploy `dist/` to GitHub Pages

The workflow also runs on a daily schedule for snapshot refresh.

### Recommended repository secrets
- `FRED_API_KEY`
- `BLS_API_KEY`

## Local Development

```bash
npm run data:build
npm run build
npm run test:smoke
python3 -m http.server 8080
```

Then open:
- http://localhost:8080

## Tech Stack

- Vanilla HTML/CSS/JS
- Plotly.js
- Three.js
- math.js
- AlaSQL
- PapaParse
- SheetJS
