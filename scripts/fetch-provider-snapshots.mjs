import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const outDir = resolve(root, "data", "snapshots");
const cfgPath = resolve(root, "config", "providers.config.json");

const nowIso = new Date().toISOString();
const fredKey = process.env.FRED_API_KEY || "";
const blsKey = process.env.BLS_API_KEY || "";

const FRED_LIMIT = Number(process.env.FRED_V2_LIMIT || 100000);
const FRED_MAX_PAGES = Number(process.env.FRED_V2_MAX_PAGES || 50);
const FRED_MAX_SERIES = Number(process.env.FRED_V2_MAX_SERIES || 600);

async function readConfig() {
  const txt = await readFile(cfgPath, "utf8");
  return JSON.parse(txt);
}

async function fetchJson(url, options = undefined) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

function fredV2Url(releaseId, key, cursor = "") {
  const p = new URLSearchParams({
    release_id: String(releaseId),
    format: "json",
    api_key: key,
    limit: String(FRED_LIMIT)
  });
  if (cursor) p.set("cursor", cursor);
  return `https://api.stlouisfed.org/fred/v2/release/observations?${p.toString()}`;
}

async function buildFredV2ReleaseSnapshot(releaseId) {
  if (!fredKey) {
    return {
      ok: false,
      reason: "missing_fred_api_key",
      release_id: releaseId
    };
  }

  let cursor = "";
  let page = 0;
  const bySeries = new Map();

  while (true) {
    page += 1;
    const url = fredV2Url(releaseId, fredKey, cursor);
    const json = await fetchJson(url);
    const rows = Array.isArray(json?.data) ? json.data : [];

    rows.forEach((row) => {
      const sid = String(row.series_id || "").toUpperCase();
      if (!sid) return;
      if (!bySeries.has(sid)) {
        if (bySeries.size >= FRED_MAX_SERIES) return;
        bySeries.set(sid, {
          id: sid,
          title: row.series_title || "",
          frequency: row.frequency || "",
          observations: []
        });
      }
      const target = bySeries.get(sid);
      const obs = Array.isArray(row.observations) ? row.observations : [];
      obs.forEach((o) => {
        if (!o?.date) return;
        const value = o.value === "." ? null : Number(o.value);
        target.observations.push({ date: o.date, value: Number.isFinite(value) ? value : null });
      });
    });

    cursor = json?.meta?.next_cursor || "";
    const hasMore = Boolean(json?.meta?.has_more);
    if (!hasMore || !cursor || page >= FRED_MAX_PAGES || bySeries.size >= FRED_MAX_SERIES) break;
  }

  const series = [...bySeries.values()].map((s) => ({
    ...s,
    observations: s.observations.sort((a, b) => a.date.localeCompare(b.date))
  }));

  const snapshot = {
    source: "fred_v2_release_observations",
    release_id: releaseId,
    fetched_at_utc: nowIso,
    pages_fetched: page,
    series_count: series.length,
    series
  };

  const file = `fred_v2_release_${releaseId}.json`;
  await writeFile(resolve(outDir, file), JSON.stringify(snapshot));

  return {
    ok: true,
    provider: "fred_v2",
    release_id: releaseId,
    file,
    series_count: series.length,
    pages_fetched: page
  };
}

async function buildBlsSnapshot(seriesIds, startYear) {
  const currentYear = new Date().getUTCFullYear();
  const windowStart = blsKey ? startYear : Math.max(startYear, currentYear - 9);

  const payload = {
    seriesid: seriesIds,
    startyear: String(windowStart),
    endyear: String(currentYear)
  };
  if (blsKey) payload.registrationkey = blsKey;

  const json = await fetchJson("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (json.status !== "REQUEST_SUCCEEDED") {
    return {
      ok: false,
      provider: "bls",
      reason: (json?.message || []).join(" | ") || "request_failed"
    };
  }

  const out = {
    source: "bls_timeseries_v2",
    fetched_at_utc: nowIso,
    start_year: windowStart,
    end_year: currentYear,
    keyed_request: Boolean(blsKey),
    series: []
  };

  const list = json?.Results?.series || [];
  list.forEach((s) => {
    const obs = (s.data || [])
      .filter((d) => String(d.period).startsWith("M") && d.period !== "M13")
      .map((d) => ({
        date: `${d.year}-${d.period.replace("M", "")}-01`,
        value: d.value === "." ? null : Number(d.value)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    out.series.push({ id: s.seriesID, observations: obs });
  });

  const file = "bls_bulk.json";
  await writeFile(resolve(outDir, file), JSON.stringify(out));

  return {
    ok: true,
    provider: "bls",
    file,
    series_count: out.series.length,
    start_year: windowStart,
    keyed_request: Boolean(blsKey)
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const cfg = await readConfig();

  const releaseIds = Array.isArray(cfg.fred_v2_release_ids) ? cfg.fred_v2_release_ids : [];
  const blsSeries = Array.isArray(cfg.bls_series_ids) ? cfg.bls_series_ids : [];
  const blsStartYear = Number(cfg.bls_start_year || 2000);

  const manifest = {
    generated_at_utc: nowIso,
    fred_v2: [],
    bls: null,
    warnings: []
  };

  for (const rid of releaseIds) {
    try {
      const res = await buildFredV2ReleaseSnapshot(rid);
      if (!res.ok) manifest.warnings.push(`fred_v2_release_${rid}: ${res.reason}`);
      manifest.fred_v2.push(res);
    } catch (err) {
      manifest.fred_v2.push({ ok: false, provider: "fred_v2", release_id: rid, reason: err.message });
      manifest.warnings.push(`fred_v2_release_${rid}: ${err.message}`);
    }
  }

  if (blsSeries.length) {
    try {
      const blsRes = await buildBlsSnapshot(blsSeries, blsStartYear);
      manifest.bls = blsRes;
      if (!blsRes.ok) manifest.warnings.push(`bls: ${blsRes.reason}`);
    } catch (err) {
      manifest.bls = { ok: false, provider: "bls", reason: err.message };
      manifest.warnings.push(`bls: ${err.message}`);
    }
  }

  await writeFile(resolve(outDir, "index.json"), JSON.stringify(manifest));
  console.log("Snapshot manifest written to data/snapshots/index.json");
  if (manifest.warnings.length) {
    console.log("Warnings:");
    manifest.warnings.forEach((w) => console.log(" -", w));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
