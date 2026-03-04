# FRED Tool

Modern FRED data studio with live pulls, custom algebraic transforms, charting, and export.

## Live Site

- https://ihelfrich.github.io/FRED-Tool/

## What It Does

- Pull live FRED series by ID
- Search the FRED catalog (with your API key)
- Build derived variables with algebraic formulas
- Quick yield-curve workflow (`TB3MS`, `GS10`, spread, inversion)
- Plot multiple series (line, scatter, bar)
- Shade inversion windows when `YC_SPREAD < 0`
- Export dataset to CSV or Excel
- Export visuals to PNG or SVG

## UI/UX Notes

- Clean academic layout with high-contrast controls
- Three.js ambient background layer (auto-disabled for reduced-motion users)
- Keyboard-focus styles and status regions with `aria-live`

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
- Plotly.js
- math.js
- PapaParse
- SheetJS
- Three.js
