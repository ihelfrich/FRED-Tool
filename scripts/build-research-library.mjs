import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const cfgPath = resolve(root, "config", "research.config.json");
const presetPath = resolve(root, "data", "research", "report_presets.json");
const outDir = resolve(root, "data", "research");
const outPath = resolve(outDir, "series_library.json");
const fredKey = process.env.FRED_API_KEY || "";

function decodeHtml(value) {
  if (!value) return "";
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, options = undefined) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 (FRED-Tool research builder)",
      ...(options?.headers || {})
    }
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status} for ${url}: ${body.slice(0, 180)}`);
  }
  return resp.text();
}

async function fetchJson(url, options = undefined) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function parseSearchResults(html) {
  const re = /href="\/series\/([A-Z0-9]+)"\s+aria-label="([^"]+)"\s+class="series-title[^\"]*">([\s\S]*?)<\/a>/g;
  const anchors = [...html.matchAll(re)].map((m) => ({
    id: String(m[1] || "").toUpperCase(),
    ariaTitle: decodeHtml(m[2] || "").trim(),
    anchorText: stripTags(m[3] || ""),
    index: m.index || 0
  }));

  const out = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    const next = anchors[i + 1];
    const chunk = html.slice(a.index, next ? next.index : html.length);

    const metaMatch = chunk.match(/<span class="search-result-meta">([\s\S]*?)<\/span>/);
    const datesMatch = chunk.match(/<span class="search-result-meta-dates[^\"]*">([\s\S]*?)<\/span>/);

    const related = [...new Set(
      [...chunk.matchAll(/href="\/series\/([A-Z0-9]+)"/g)]
        .map((m) => String(m[1] || "").toUpperCase())
        .filter((id) => id && id !== a.id)
    )];

    const metaText = stripTags(metaMatch?.[1] || "");
    const parts = metaText.split(",").map((s) => s.trim()).filter(Boolean);

    out.push({
      id: a.id,
      title: a.ariaTitle || a.anchorText || a.id,
      units: parts[0] || "",
      frequency: parts[1] || "",
      seasonal_adjustment: parts[2] || "",
      dates_text: stripTags(datesMatch?.[1] || ""),
      related_formats: related,
      rank: i + 1
    });
  }

  return out;
}

function parseFuzzyDate(token, isEnd = false) {
  if (!token) return "";
  const clean = token.trim();
  if (!clean) return "";

  const monthMap = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };

  let m = clean.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const mm = monthMap[m[1].slice(0, 3)] || "01";
    const dd = isEnd ? "28" : "01";
    return `${m[2]}-${mm}-${dd}`;
  }

  m = clean.match(/^Q([1-4])\s+(\d{4})$/i);
  if (m) {
    const q = Number(m[1]);
    const startMonth = ["01", "04", "07", "10"][q - 1];
    const endMonth = ["03", "06", "09", "12"][q - 1];
    const mm = isEnd ? endMonth : startMonth;
    const dd = isEnd ? "28" : "01";
    return `${m[2]}-${mm}-${dd}`;
  }

  m = clean.match(/^(\d{4})$/);
  if (m) {
    return `${m[1]}-${isEnd ? "12-28" : "01-01"}`;
  }

  m = clean.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return m[1];

  return "";
}

function parseDateRange(dateText) {
  if (!dateText) return { observation_start: "", observation_end: "" };
  const clean = String(dateText).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const parts = clean.split(/\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { observation_start: "", observation_end: "" };
  return {
    observation_start: parseFuzzyDate(parts[0], false),
    observation_end: parseFuzzyDate(parts[1], true)
  };
}

function yearsBetween(start, end) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null;
  const y = (e - s) / (1000 * 60 * 60 * 24 * 365.25);
  return Number(y.toFixed(2));
}

function pairKey(a, b) {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function addConnection(store, a, b, sourceType, weight = 1) {
  if (!a || !b || a === b) return;
  const key = pairKey(a, b);
  if (!store.has(key)) {
    store.set(key, { a: a < b ? a : b, b: a < b ? b : a, weight: 0, query_overlap: 0, preset_overlap: 0 });
  }
  const item = store.get(key);
  item.weight += weight;
  if (sourceType === "query") item.query_overlap += 1;
  if (sourceType === "preset") item.preset_overlap += 1;
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;

  async function runner() {
    while (true) {
      const cur = idx;
      idx += 1;
      if (cur >= items.length) return;
      out[cur] = await worker(items[cur], cur);
    }
  }

  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => runner()));
  return out;
}

async function fetchCsvStats(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
  const text = await fetchText(url);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) {
    return { observation_start: "", observation_end: "", observation_count: 0 };
  }

  let first = "";
  let last = "";
  let count = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma <= 0) continue;
    const date = line.slice(0, comma);
    if (!first) first = date;
    last = date;
    count += 1;
  }

  return {
    observation_start: first,
    observation_end: last,
    observation_count: count
  };
}

async function fetchFredSeriesMeta(id) {
  if (!fredKey) return null;
  const url = `https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(fredKey)}&file_type=json`;
  try {
    const json = await fetchJson(url);
    const s = Array.isArray(json?.seriess) ? json.seriess[0] : null;
    if (!s) return null;
    return {
      title: s.title || "",
      units: s.units_short || s.units || "",
      frequency: s.frequency_short || s.frequency || "",
      seasonal_adjustment: s.seasonal_adjustment_short || s.seasonal_adjustment || "",
      observation_start: s.observation_start || "",
      observation_end: s.observation_end || "",
      popularity: Number.isFinite(Number(s.popularity)) ? Number(s.popularity) : null,
      notes: s.notes || ""
    };
  } catch {
    return null;
  }
}

async function main() {
  const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
  const presets = JSON.parse(await readFile(presetPath, "utf8"));

  const targetN = Number(cfg.target_top_n || 100);
  const pagesPerTerm = Number(cfg.pages_per_term || 2);
  const perTermNet = Number(cfg.per_term_results_for_network || 15);
  const searchTerms = Array.isArray(cfg.search_terms) ? cfg.search_terms : [];
  const fallbackIds = (Array.isArray(cfg.fallback_series_ids) ? cfg.fallback_series_ids : []).map((x) => String(x).toUpperCase());

  const presetSeries = [];
  const presetThemeBySeries = new Map();
  for (const preset of presets) {
    const ids = (preset.series || [])
      .filter((s) => String(s.provider || "fred").toLowerCase() === "fred")
      .map((s) => String(s.id || "").toUpperCase())
      .filter(Boolean);
    presetSeries.push({ id: preset.id, theme: preset.theme || "General", series: ids });

    ids.forEach((id) => {
      if (!presetThemeBySeries.has(id)) presetThemeBySeries.set(id, new Map());
      const m = presetThemeBySeries.get(id);
      m.set(preset.theme || "General", (m.get(preset.theme || "General") || 0) + 1);
    });
  }

  const candidate = new Map();
  const termOrdered = new Map();

  for (const term of searchTerms) {
    const idsForTerm = [];
    for (let page = 1; page <= pagesPerTerm; page += 1) {
      const url = `https://fred.stlouisfed.org/searchresults?st=${encodeURIComponent(term)}&ob=pv&pageID=${page}`;
      let html = "";
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`search fetch failed for term="${term}" page=${page}: ${err.message}`);
        continue;
      }

      const results = parseSearchResults(html);
      results.forEach((row, idx) => {
        const globalRank = (page - 1) * 20 + idx + 1;
        const score = Math.max(0, 45 - globalRank);

        if (!candidate.has(row.id)) {
          candidate.set(row.id, {
            id: row.id,
            title: row.title || row.id,
            units: row.units || "",
            frequency: row.frequency || "",
            seasonal_adjustment: row.seasonal_adjustment || "",
            dates_text: row.dates_text || "",
            popularity_score: 0,
            term_hits: new Set(),
            query_terms: new Set(),
            best_rank: Number.POSITIVE_INFINITY,
            related_formats: new Set()
          });
        }

        const item = candidate.get(row.id);
        if (!item.title && row.title) item.title = row.title;
        if (!item.units && row.units) item.units = row.units;
        if (!item.frequency && row.frequency) item.frequency = row.frequency;
        if (!item.seasonal_adjustment && row.seasonal_adjustment) item.seasonal_adjustment = row.seasonal_adjustment;
        if (!item.dates_text && row.dates_text) item.dates_text = row.dates_text;

        item.popularity_score += score;
        item.term_hits.add(term);
        item.query_terms.add(term);
        item.best_rank = Math.min(item.best_rank, globalRank);
        row.related_formats.forEach((x) => item.related_formats.add(x));

        if (!idsForTerm.includes(row.id)) idsForTerm.push(row.id);
      });
    }
    termOrdered.set(term, idsForTerm);
  }

  const connections = new Map();
  for (const [term, ids] of termOrdered.entries()) {
    const top = ids.slice(0, perTermNet);
    for (let i = 0; i < top.length; i += 1) {
      for (let j = i + 1; j < top.length; j += 1) {
        addConnection(connections, top[i], top[j], "query", 1);
      }
    }
  }

  presetSeries.forEach((p) => {
    const ids = p.series;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addConnection(connections, ids[i], ids[j], "preset", 3);
      }
    }
  });

  const rankedIds = [...candidate.values()]
    .sort((a, b) => {
      if (b.popularity_score !== a.popularity_score) return b.popularity_score - a.popularity_score;
      if (b.term_hits.size !== a.term_hits.size) return b.term_hits.size - a.term_hits.size;
      return a.best_rank - b.best_rank;
    })
    .map((x) => x.id);

  const presetIdsFlat = [...new Set(presetSeries.flatMap((p) => p.series))];
  const finalIds = [];
  const seen = new Set();
  const priority = [...presetIdsFlat, ...rankedIds, ...fallbackIds];

  for (const id of priority) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    finalIds.push(id);
    if (finalIds.length >= targetN) break;
  }

  const csvStats = await mapLimit(finalIds, 6, async (id) => {
    try {
      const stats = await fetchCsvStats(id);
      return { id, ...stats };
    } catch (err) {
      return { id, observation_start: "", observation_end: "", observation_count: 0, csv_error: err.message };
    }
  });
  const csvMap = new Map(csvStats.map((x) => [x.id, x]));

  const apiMetaRows = await mapLimit(finalIds, 6, async (id) => {
    const meta = await fetchFredSeriesMeta(id);
    return { id, meta };
  });
  const apiMetaMap = new Map(apiMetaRows.map((x) => [x.id, x.meta]));

  const titleLookup = new Map();
  for (const id of finalIds) titleLookup.set(id, id);
  for (const [id, c] of candidate.entries()) {
    if (c.title) titleLookup.set(id, c.title);
  }
  presetSeries.forEach((p) => {
    const preset = presets.find((x) => x.id === p.id);
    (preset?.series || []).forEach((s) => {
      const sid = String(s.id || "").toUpperCase();
      if (sid && s.title) titleLookup.set(sid, s.title);
    });
  });
  for (const id of finalIds) {
    const m = apiMetaMap.get(id);
    if (m?.title) titleLookup.set(id, m.title);
  }

  const connectionById = new Map();
  for (const c of connections.values()) {
    if (!connectionById.has(c.a)) connectionById.set(c.a, []);
    if (!connectionById.has(c.b)) connectionById.set(c.b, []);
    connectionById.get(c.a).push({ id: c.b, ...c });
    connectionById.get(c.b).push({ id: c.a, ...c });
  }

  const rankedPos = new Map(rankedIds.map((id, i) => [id, i + 1]));

  const series = finalIds.map((id) => {
    const c = candidate.get(id);
    const apiMeta = apiMetaMap.get(id);
    const csv = csvMap.get(id) || { observation_start: "", observation_end: "", observation_count: 0 };

    const parsed = parseDateRange(c?.dates_text || "");
    const observation_start = apiMeta?.observation_start || csv.observation_start || parsed.observation_start || "";
    const observation_end = apiMeta?.observation_end || csv.observation_end || parsed.observation_end || "";
    const span_years = yearsBetween(observation_start, observation_end);

    const themeMap = presetThemeBySeries.get(id) || new Map();
    const themes = [...themeMap.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);

    const connected = (connectionById.get(id) || [])
      .filter((x) => finalIds.includes(x.id))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map((x) => ({
        id: x.id,
        title: titleLookup.get(x.id) || x.id,
        score: x.weight,
        preset_overlap: x.preset_overlap,
        query_overlap: x.query_overlap
      }));

    return {
      id,
      title: apiMeta?.title || c?.title || titleLookup.get(id) || id,
      units: apiMeta?.units || c?.units || "",
      frequency: apiMeta?.frequency || c?.frequency || "",
      seasonal_adjustment: apiMeta?.seasonal_adjustment || c?.seasonal_adjustment || "",
      observation_start,
      observation_end,
      span_years,
      observation_count: csv.observation_count || null,
      popularity_score: Number((c?.popularity_score || 0).toFixed(2)),
      term_hits: c ? c.term_hits.size : 0,
      best_rank: Number.isFinite(c?.best_rank) ? c.best_rank : null,
      popularity_rank: rankedPos.get(id) || null,
      report_usage_count: presetSeries.filter((p) => p.series.includes(id)).length,
      themes,
      query_terms: c ? [...c.query_terms] : [],
      related_formats: c ? [...c.related_formats].slice(0, 8) : [],
      connected_series: connected
    };
  }).sort((a, b) => {
    if ((b.popularity_score || 0) !== (a.popularity_score || 0)) return (b.popularity_score || 0) - (a.popularity_score || 0);
    if ((b.report_usage_count || 0) !== (a.report_usage_count || 0)) return (b.report_usage_count || 0) - (a.report_usage_count || 0);
    return a.id.localeCompare(b.id);
  });

  const out = {
    generated_at_utc: new Date().toISOString(),
    schema_version: "1.0.0",
    methodology: {
      description: "Series are ranked using FRED web search popularity ordering across policy-relevant macro terms, then constrained to preserve report coverage and dataset continuity.",
      search_terms: searchTerms,
      pages_per_term: pagesPerTerm,
      per_term_results_for_network: perTermNet,
      target_top_n: targetN,
      fred_api_enrichment: Boolean(fredKey),
      connection_rule: "Connections combine co-appearance in report presets (weight 3) and co-appearance in top search results for the same query term (weight 1)."
    },
    summary: {
      preset_count: presets.length,
      unique_preset_fred_series: presetIdsFlat.length,
      candidate_pool_size: candidate.size,
      final_series_count: series.length
    },
    series
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2));

  console.log(`Research library written: ${outPath}`);
  console.log(` - candidate pool: ${candidate.size}`);
  console.log(` - final series: ${series.length}`);
  console.log(` - presets: ${presets.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
