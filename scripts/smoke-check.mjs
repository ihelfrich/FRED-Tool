import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "styles.css",
  "app.js",
  "config/providers.config.json",
  "scripts/fetch-provider-snapshots.mjs",
  ".github/workflows/deploy-pages.yml",
  "dist/index.html",
  "dist/styles.css",
  "dist/app.js"
];

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  for (const rel of required) {
    const p = resolve(root, rel);
    if (!(await exists(p))) {
      throw new Error(`Missing required file: ${rel}`);
    }
  }

  const html = await readFile(resolve(root, "dist/index.html"), "utf8");
  const js = await readFile(resolve(root, "dist/app.js"), "utf8");

  const htmlChecks = [
    'id="chart"',
    'id="formulaInput"',
    'id="sqlInput"',
    'id="blsApiKey"',
    'id="fredV2ReleaseId"',
    'id="externalCsvUrl"',
    'id="sceneBg"',
    "three.min.js",
    "alasql"
  ];

  for (const token of htmlChecks) {
    if (!html.includes(token)) {
      throw new Error(`dist/index.html missing token: ${token}`);
    }
  }

  const jsChecks = [
    "function initThreeScene()",
    "function applyFormulas()",
    "function runSqlQuery()",
    "function loadFredV2Bulk()",
    "function fetchBlsSeries(",
    "function fetchExternalCsvSeries(",
    "function plotData()"
  ];
  for (const token of jsChecks) {
    if (!js.includes(token)) {
      throw new Error(`dist/app.js missing token: ${token}`);
    }
  }

  console.log("Smoke checks passed.");
}

run().catch((err) => {
  console.error("Smoke check failed:", err.message);
  process.exit(1);
});
