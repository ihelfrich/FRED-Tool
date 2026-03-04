(() => {
  const state = {
    apiKey: localStorage.getItem("fred_api_key") || "",
    blsApiKey: localStorage.getItem("bls_api_key") || "",
    selectedSeries: [], // [{id, alias, title}]
    rawSeries: new Map(), // alias -> [{date, value}]
    baseRows: [],
    dataRows: [],
    formulas: [], // [{name, expression}]
    chartReady: false,
    catalogResults: [],
    fredV2Catalog: [],
    fredV2SeriesRows: new Map(), // series_id -> [{date, value}]
    snapshotManifest: null,
    blsSnapshotRows: new Map() // series_id -> rows
  };

  const PROXY_BASE = "https://api.codetabs.com/v1/proxy/?quest=";

  const el = {
    apiKey: document.getElementById("apiKey"),
    blsApiKey: document.getElementById("blsApiKey"),
    saveApiKey: document.getElementById("saveApiKey"),
    catalogQuery: document.getElementById("catalogQuery"),
    catalogLimit: document.getElementById("catalogLimit"),
    catalogSearch: document.getElementById("catalogSearch"),
    catalogStatus: document.getElementById("catalogStatus"),
    catalogTableBody: document.querySelector("#catalogTable tbody"),
    manualSeriesId: document.getElementById("manualSeriesId"),
    manualProvider: document.getElementById("manualProvider"),
    manualAlias: document.getElementById("manualAlias"),
    addManualSeries: document.getElementById("addManualSeries"),
    addYieldCurveSet: document.getElementById("addYieldCurveSet"),
    externalCsvUrl: document.getElementById("externalCsvUrl"),
    externalCsvDateColumn: document.getElementById("externalCsvDateColumn"),
    externalCsvValueColumn: document.getElementById("externalCsvValueColumn"),
    externalCsvAlias: document.getElementById("externalCsvAlias"),
    addExternalCsv: document.getElementById("addExternalCsv"),
    fredV2ReleaseId: document.getElementById("fredV2ReleaseId"),
    fredV2Limit: document.getElementById("fredV2Limit"),
    loadFredV2Bulk: document.getElementById("loadFredV2Bulk"),
    fredV2Status: document.getElementById("fredV2Status"),
    fredV2TableBody: document.querySelector("#fredV2Table tbody"),
    selectedSeries: document.getElementById("selectedSeries"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    fetchData: document.getElementById("fetchData"),
    clearData: document.getElementById("clearData"),
    fetchStatus: document.getElementById("fetchStatus"),
    formulaInput: document.getElementById("formulaInput"),
    applyFormulas: document.getElementById("applyFormulas"),
    addYieldCurveFormula: document.getElementById("addYieldCurveFormula"),
    formulaStatus: document.getElementById("formulaStatus"),
    sqlInput: document.getElementById("sqlInput"),
    runSql: document.getElementById("runSql"),
    resetSql: document.getElementById("resetSql"),
    sqlStatus: document.getElementById("sqlStatus"),
    chartType: document.getElementById("chartType"),
    plotSeries: document.getElementById("plotSeries"),
    shadeInversions: document.getElementById("shadeInversions"),
    plotBtn: document.getElementById("plotBtn"),
    exportPng: document.getElementById("exportPng"),
    exportSvg: document.getElementById("exportSvg"),
    plotStatus: document.getElementById("plotStatus"),
    chart: document.getElementById("chart"),
    statSeries: document.getElementById("statSeries"),
    statRows: document.getElementById("statRows"),
    statVars: document.getElementById("statVars"),
    statFormulas: document.getElementById("statFormulas"),
    varList: document.getElementById("varList"),
    downloadCsv: document.getElementById("downloadCsv"),
    downloadXlsx: document.getElementById("downloadXlsx"),
    previewStatus: document.getElementById("previewStatus"),
    previewTableHead: document.querySelector("#previewTable thead"),
    previewTableBody: document.querySelector("#previewTable tbody")
  };

  function todayISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function safeAlias(value) {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^([^a-zA-Z_])/, "_$1");
  }

  function setStatus(node, message, type = "") {
    node.textContent = message;
    node.classList.remove("ok", "error");
    if (type) node.classList.add(type);
  }

  function cloneRows(rows) {
    return rows.map((r) => ({ ...r }));
  }

  function seriesKey(provider, id) {
    return `${provider}:${id}`;
  }

  function formatCount(n) {
    return new Intl.NumberFormat("en-US").format(n);
  }

  function updateStats() {
    if (el.statSeries) el.statSeries.textContent = formatCount(state.selectedSeries.length);
    if (el.statRows) el.statRows.textContent = formatCount(state.dataRows.length);
    if (el.statVars) el.statVars.textContent = formatCount(getVariableNames().length);
    if (el.statFormulas) el.statFormulas.textContent = formatCount(state.formulas.length);
  }

  function refreshAllViews() {
    refreshVariableUI();
    renderPreview();
    updatePlotSeriesOptions();
    updateStats();
  }

  async function fetchText(url, options = undefined) {
    const method = (options?.method || "GET").toUpperCase();
    const hasCustomHeaders = Boolean(options?.headers && Object.keys(options.headers).length);
    try {
      const direct = await fetch(url, options);
      if (direct.ok) return direct.text();
      if (method !== "GET") {
        throw new Error(`Request failed (${direct.status})`);
      }
      if (hasCustomHeaders) {
        throw new Error(`Request failed (${direct.status}); this endpoint requires authenticated direct access.`);
      }
    } catch (err) {
      // ignore direct failure, try proxy
      if (method !== "GET") {
        throw err;
      }
      if (hasCustomHeaders) {
        throw err;
      }
    }

    const proxyUrl = PROXY_BASE + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      throw new Error(`Fetch failed (${resp.status})`);
    }
    return resp.text();
  }

  async function fetchJson(url, options = undefined) {
    const text = await fetchText(url, options);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("Could not parse JSON response");
    }
  }

  function parseSeriesCsv(csvText, columnName) {
    const parsed = Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true
    });

    if (parsed.errors.length) {
      console.warn("CSV parse errors:", parsed.errors);
    }

    return parsed.data
      .map((row) => ({
        date: row.observation_date,
        value: row[columnName] === "." ? null : Number(row[columnName])
      }))
      .filter((d) => d.date && (!Number.isNaN(d.value) || d.value === null));
  }

  function seriesCsvUrl(seriesId, start, end) {
    const base = "https://fred.stlouisfed.org/graph/fredgraph.csv";
    const params = new URLSearchParams({ id: seriesId });
    if (start) params.set("cosd", start);
    if (end) params.set("coed", end);
    return `${base}?${params.toString()}`;
  }

  function fredCatalogSearchUrl(query, limit, apiKey) {
    const base = "https://api.stlouisfed.org/fred/series/search";
    const params = new URLSearchParams({
      api_key: apiKey,
      search_text: query,
      file_type: "json",
      limit: String(limit),
      order_by: "popularity",
      sort_order: "desc"
    });
    return `${base}?${params.toString()}`;
  }

  function fredV2ReleaseUrl(releaseId, limit, cursor = "") {
    const base = "https://api.stlouisfed.org/fred/v2/release/observations";
    const params = new URLSearchParams({
      release_id: String(releaseId),
      format: "json",
      limit: String(limit)
    });
    if (cursor) params.set("cursor", cursor);
    return `${base}?${params.toString()}`;
  }

  function fredV2AuthHeaders(apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  async function fetchBlsSeries(seriesId, startDate, endDate, blsApiKey = "") {
    const sYear = Number(startDate.slice(0, 4));
    const eYear = Number(endDate.slice(0, 4));
    const windows = [];
    let y = sYear;
    while (y <= eYear) {
      const end = Math.min(y + 19, eYear);
      windows.push([y, end]);
      y = end + 1;
    }

    const all = [];
    for (const [ws, we] of windows) {
      const payload = {
        seriesid: [seriesId],
        startyear: String(ws),
        endyear: String(we)
      };
      if (blsApiKey) payload.registrationkey = blsApiKey;

      const resp = await fetchText("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      let json;
      try {
        json = JSON.parse(resp);
      } catch {
        throw new Error("Invalid JSON response from BLS API.");
      }

      if (json.status !== "REQUEST_SUCCEEDED") {
        const msg = json?.message?.join(" | ") || "BLS request failed.";
        throw new Error(msg);
      }

      const data = json?.Results?.series?.[0]?.data || [];
      data.forEach((d) => {
        if (!String(d.period).startsWith("M")) return;
        if (d.period === "M13") return;
        const mm = d.period.replace("M", "");
        all.push({
          date: `${d.year}-${mm}-01`,
          value: d.value === "." ? null : Number(d.value)
        });
      });
    }

    return all.sort((a, b) => a.date.localeCompare(b.date));
  }

  async function fetchExternalCsvSeries(url, dateColumn, valueColumn, startDate, endDate) {
    const csv = await fetchText(url);
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true
    });

    if (parsed.errors.length) {
      console.warn(parsed.errors);
    }

    const rows = parsed.data
      .map((row) => ({
        date: String(row[dateColumn] || "").slice(0, 10),
        value: row[valueColumn] === "." ? null : Number(row[valueColumn])
      }))
      .filter((r) => r.date && (!Number.isNaN(r.value) || r.value === null))
      .sort((a, b) => a.date.localeCompare(b.date));

    return rows.filter((r) => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate));
  }

  function upsertSeries(id, alias = "", title = "", provider = "fred", meta = null) {
    const normId = provider === "csv" ? id.trim() : id.trim().toUpperCase();
    if (!normId) return;
    const key = seriesKey(provider, normId);
    if (state.selectedSeries.find((s) => s.key === key)) return;

    const finalAlias = safeAlias(alias || normId);
    state.selectedSeries.push({ id: normId, alias: finalAlias, title: title || "", provider, key, meta });
    renderSelectedSeries();
  }

  function removeSeries(key) {
    const target = state.selectedSeries.find((s) => s.key === key);
    state.selectedSeries = state.selectedSeries.filter((s) => s.key !== key);
    if (target) state.rawSeries.delete(target.alias);
    renderSelectedSeries();
  }

  function renderSelectedSeries() {
    el.selectedSeries.innerHTML = "";
    if (!state.selectedSeries.length) {
      el.selectedSeries.innerHTML = '<p class="help">No series selected yet.</p>';
      return;
    }

    state.selectedSeries.forEach((s) => {
      const row = document.createElement("div");
      row.className = "series-item";
      row.innerHTML = `
        <div>
          <div><strong>${s.id}</strong> <span class="series-provider">${s.provider.toUpperCase()}</span></div>
          <div class="series-label">${s.title || "Manual series"}</div>
        </div>
        <input data-series-alias="${s.key}" type="text" value="${s.alias}" />
        <button data-remove-series="${s.key}" class="btn btn-secondary">Remove</button>
      `;
      el.selectedSeries.appendChild(row);
    });

    el.selectedSeries.querySelectorAll("[data-remove-series]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeSeries(btn.getAttribute("data-remove-series"));
      });
    });

    el.selectedSeries.querySelectorAll("[data-series-alias]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.getAttribute("data-series-alias");
        const idx = state.selectedSeries.findIndex((s) => s.key === key);
        if (idx >= 0) {
          state.selectedSeries[idx].alias = safeAlias(input.value || state.selectedSeries[idx].id);
          input.value = state.selectedSeries[idx].alias;
        }
      });
    });

    updateStats();
  }

  async function searchCatalog() {
    const query = el.catalogQuery.value.trim();
    const limit = Number(el.catalogLimit.value) || 30;
    if (!query) {
      setStatus(el.catalogStatus, "Enter a search term.", "error");
      return;
    }
    if (!state.apiKey) {
      setStatus(el.catalogStatus, "Add a FRED API key to search catalog.", "error");
      return;
    }

    setStatus(el.catalogStatus, "Searching catalog...");
    const url = fredCatalogSearchUrl(query, Math.min(limit, 200), state.apiKey);

    try {
      const json = await fetchJson(url);
      if (json.error_message) {
        throw new Error(json.error_message);
      }

      state.catalogResults = json.seriess || [];
      renderCatalog();
      setStatus(el.catalogStatus, `Found ${state.catalogResults.length} result(s).`, "ok");
    } catch (err) {
      setStatus(el.catalogStatus, `Catalog search failed: ${err.message}`, "error");
    }
  }

  function renderCatalog() {
    el.catalogTableBody.innerHTML = "";
    state.catalogResults.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="btn btn-secondary" data-add-catalog="${s.id}">Add</button></td>
        <td>${s.id}</td>
        <td>${s.title || ""}</td>
        <td>${s.frequency_short || ""}</td>
        <td>${s.units_short || ""}</td>
      `;
      el.catalogTableBody.appendChild(tr);
    });

    el.catalogTableBody.querySelectorAll("[data-add-catalog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-add-catalog");
        const s = state.catalogResults.find((x) => x.id === id);
        upsertSeries(id, id, s?.title || "", "fred");
      });
    });
  }

  function renderFredV2Catalog() {
    if (!el.fredV2TableBody) return;
    el.fredV2TableBody.innerHTML = "";
    state.fredV2Catalog.slice(0, 500).forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="btn btn-secondary" data-add-v2="${s.id}">Add</button></td>
        <td>${s.id}</td>
        <td>${s.title || ""}</td>
        <td>${s.frequency || ""}</td>
        <td>${s.obs_count ?? ""}</td>
      `;
      el.fredV2TableBody.appendChild(tr);
    });

    el.fredV2TableBody.querySelectorAll("[data-add-v2]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-add-v2");
        const s = state.fredV2Catalog.find((x) => x.id === id);
        upsertSeries(id, id, s?.title || "FRED v2 series", "fred");
        setStatus(el.fetchStatus, `Added ${id} from FRED v2 bulk catalog.`, "ok");
      });
    });
  }

  async function loadSnapshotManifest() {
    if (state.snapshotManifest) return state.snapshotManifest;
    try {
      const txt = await fetchText("data/snapshots/index.json");
      const manifest = JSON.parse(txt);
      state.snapshotManifest = manifest;
      return manifest;
    } catch (_) {
      return null;
    }
  }

  function applyFredV2SeriesData(seriesArray) {
    state.fredV2Catalog = (seriesArray || []).map((s) => ({
      id: String(s.id || "").toUpperCase(),
      title: s.title || "",
      frequency: s.frequency || "",
      obs_count: Array.isArray(s.observations) ? s.observations.length : 0
    })).filter((s) => s.id);

    state.fredV2SeriesRows.clear();
    (seriesArray || []).forEach((s) => {
      const sid = String(s.id || "").toUpperCase();
      if (!sid) return;
      const rows = (Array.isArray(s.observations) ? s.observations : [])
        .map((o) => ({
          date: o.date,
          value: o.value === "." ? null : Number(o.value)
        }))
        .filter((o) => o.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      state.fredV2SeriesRows.set(sid, rows);
    });
    renderFredV2Catalog();
  }

  async function tryLoadFredV2FromSnapshot(releaseId) {
    const manifest = await loadSnapshotManifest();
    if (!manifest?.fred_v2?.length) return false;
    const hit = manifest.fred_v2.find((x) => x.ok && Number(x.release_id) === Number(releaseId) && x.file);
    if (!hit) return false;

    const txt = await fetchText(`data/snapshots/${hit.file}`);
    const snap = JSON.parse(txt);
    applyFredV2SeriesData(snap.series || []);
    setStatus(el.fredV2Status, `Loaded FRED v2 release ${releaseId} from GitHub Pages snapshot.`, "ok");
    return true;
  }

  async function ensureBlsSnapshotLoaded() {
    if (state.blsSnapshotRows.size) return true;
    const manifest = await loadSnapshotManifest();
    const file = manifest?.bls?.ok && manifest?.bls?.file ? manifest.bls.file : null;
    if (!file) return false;

    const txt = await fetchText(`data/snapshots/${file}`);
    const snap = JSON.parse(txt);
    const series = Array.isArray(snap.series) ? snap.series : [];
    series.forEach((s) => {
      const sid = String(s.id || "").toUpperCase();
      if (!sid) return;
      const rows = (Array.isArray(s.observations) ? s.observations : [])
        .map((o) => ({ date: o.date, value: o.value === "." ? null : Number(o.value) }))
        .filter((o) => o.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      state.blsSnapshotRows.set(sid, rows);
    });
    return state.blsSnapshotRows.size > 0;
  }

  async function loadFredV2Bulk() {
    const releaseId = Number(el.fredV2ReleaseId.value);
    const limit = Math.min(Math.max(Number(el.fredV2Limit.value) || 100000, 1000), 500000);

    if (!Number.isFinite(releaseId) || releaseId <= 0) {
      setStatus(el.fredV2Status, "Enter a valid release ID.", "error");
      return;
    }

    try {
      const fromSnapshot = await tryLoadFredV2FromSnapshot(releaseId);
      if (fromSnapshot) return;
    } catch (_) {
      // no snapshot or snapshot parse issue; continue with live pull
    }

    if (!state.apiKey) {
      setStatus(el.fredV2Status, "No snapshot found and no FRED key set. Add key for live API v2 pull.", "error");
      return;
    }

    setStatus(el.fredV2Status, `Loading FRED v2 release ${releaseId}...`);
    let cursor = "";
    let page = 0;
    const bySeries = new Map();

    try {
      while (true) {
        page += 1;
        const url = fredV2ReleaseUrl(releaseId, limit, cursor);
        const json = await fetchJson(url, { headers: fredV2AuthHeaders(state.apiKey) });
        const data = json?.data || [];

        data.forEach((item) => {
          const sid = String(item.series_id || "").toUpperCase();
          if (!sid) return;
          if (!bySeries.has(sid)) {
            bySeries.set(sid, {
              id: sid,
              title: item.series_title || "",
              frequency: item.frequency || "",
              obs: []
            });
          }
          const obs = Array.isArray(item.observations) ? item.observations : [];
          obs.forEach((o) => {
            bySeries.get(sid).obs.push({
              date: o.date,
              value: o.value === "." ? null : Number(o.value)
            });
          });
        });

        cursor = json?.meta?.next_cursor || "";
        const hasMore = Boolean(json?.meta?.has_more);
        setStatus(el.fredV2Status, `Loaded page ${page}. Series so far: ${bySeries.size}`, "ok");
        if (!hasMore || !cursor || page >= 100) break;
      }

      applyFredV2SeriesData(
        [...bySeries.values()].map((s) => ({
          id: s.id,
          title: s.title,
          frequency: s.frequency,
          observations: s.obs
        }))
      );
      setStatus(el.fredV2Status, `FRED v2 bulk ready: ${state.fredV2Catalog.length} series loaded.`, "ok");
    } catch (err) {
      setStatus(el.fredV2Status, `FRED v2 bulk pull failed: ${err.message}`, "error");
    }
  }

  async function pullSeriesData() {
    if (!state.selectedSeries.length) {
      setStatus(el.fetchStatus, "Add at least one series first.", "error");
      return;
    }

    const start = el.startDate.value;
    const end = el.endDate.value;
    const aliases = state.selectedSeries.map((s) => s.alias);
    const duplicateAlias = aliases.find((a, i) => aliases.indexOf(a) !== i);
    if (duplicateAlias) {
      setStatus(el.fetchStatus, `Alias conflict: ${duplicateAlias}. Each series alias must be unique.`, "error");
      return;
    }
    if (aliases.some((a) => a.toUpperCase() === "DATE")) {
      setStatus(el.fetchStatus, "Alias DATE is reserved. Pick another alias.", "error");
      return;
    }

    setStatus(el.fetchStatus, "Pulling live data from FRED...");

    const fetched = new Map();

    for (const s of state.selectedSeries) {
      try {
        if (s.provider === "fred") {
          const cachedV2 = state.fredV2SeriesRows.get(s.id);
          if (cachedV2 && cachedV2.length) {
            const filtered = cachedV2.filter((r) => (!start || r.date >= start) && (!end || r.date <= end));
            fetched.set(s.alias, filtered);
          } else {
            const url = seriesCsvUrl(s.id, start, end);
            const csv = await fetchText(url);
            const rows = parseSeriesCsv(csv, s.id);
            fetched.set(s.alias, rows);
          }
        } else if (s.provider === "bls") {
          const hasSnapshot = await ensureBlsSnapshotLoaded();
          const snapRows = hasSnapshot ? state.blsSnapshotRows.get(s.id) : null;
          if (snapRows && snapRows.length) {
            const filtered = snapRows.filter((r) => (!start || r.date >= start) && (!end || r.date <= end));
            fetched.set(s.alias, filtered);
          } else {
            const rows = await fetchBlsSeries(s.id, start || "1990-01-01", end || todayISO(), state.blsApiKey);
            fetched.set(s.alias, rows);
          }
        } else if (s.provider === "csv") {
          const url = s.meta?.url;
          const dateColumn = s.meta?.dateColumn || "DATE";
          const valueColumn = s.meta?.valueColumn || "value";
          if (!url) throw new Error("Missing CSV URL metadata.");
          const rows = await fetchExternalCsvSeries(url, dateColumn, valueColumn, start, end);
          fetched.set(s.alias, rows);
        } else {
          throw new Error(`Unsupported provider: ${s.provider}`);
        }
      } catch (err) {
        setStatus(el.fetchStatus, `Failed on ${s.provider.toUpperCase()}:${s.id}: ${err.message}`, "error");
        return;
      }
    }

    state.rawSeries = fetched;
    state.dataRows = mergeSeriesRows(state.rawSeries);
    state.baseRows = cloneRows(state.dataRows);

    setStatus(el.fetchStatus, `Pulled ${state.selectedSeries.length} series with ${state.dataRows.length} date rows.`, "ok");
    setStatus(el.sqlStatus, "SQL backend synced with fresh data.", "ok");
    refreshAllViews();
  }

  function mergeSeriesRows(seriesMap) {
    const dateMap = new Map();

    for (const [alias, rows] of seriesMap.entries()) {
      rows.forEach((r) => {
        if (!dateMap.has(r.date)) dateMap.set(r.date, { DATE: r.date });
        dateMap.get(r.date)[alias] = r.value;
      });
    }

    return [...dateMap.values()].sort((a, b) => a.DATE.localeCompare(b.DATE));
  }

  function getVariableNames() {
    if (!state.dataRows.length) return [];
    const vars = new Set();
    state.dataRows.forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== "DATE") vars.add(k);
      });
    });
    return [...vars];
  }

  function parseFormulaLines(text) {
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("=");
        if (parts.length < 2) {
          throw new Error(`Invalid formula: ${line}`);
        }
        const name = safeAlias(parts.shift().trim());
        const expression = parts.join("=").trim();
        if (!name || !expression) {
          throw new Error(`Invalid formula: ${line}`);
        }
        return { name, expression };
      });
  }

  function syncSqlBackend(rows) {
    if (typeof alasql === "undefined") {
      throw new Error("SQL engine not loaded.");
    }

    alasql("DROP TABLE IF EXISTS fred_data");
    alasql("CREATE TABLE fred_data");
    alasql.tables.fred_data.data = cloneRows(rows);
  }

  function normalizeSqlResult(result) {
    if (!Array.isArray(result)) {
      throw new Error("SQL query must return a table result.");
    }

    return result.map((row, i) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        if (!Object.prototype.hasOwnProperty.call(row, "DATE")) {
          return { DATE: state.dataRows[i]?.DATE ?? String(i + 1), ...row };
        }
        return row;
      }
      return { DATE: state.dataRows[i]?.DATE ?? String(i + 1), value: row };
    });
  }

  function runSqlQuery() {
    if (!state.dataRows.length) {
      setStatus(el.sqlStatus, "Pull data first, then run SQL.", "error");
      return;
    }

    const sql = (el.sqlInput.value || "").trim();
    if (!sql) {
      setStatus(el.sqlStatus, "Add a SQL query.", "error");
      return;
    }

    try {
      syncSqlBackend(state.dataRows);
      const result = alasql(sql);
      const normalized = normalizeSqlResult(result);
      state.dataRows = normalized;
      setStatus(el.sqlStatus, `SQL applied: ${state.dataRows.length} rows in current view.`, "ok");
      refreshAllViews();
    } catch (err) {
      setStatus(el.sqlStatus, `SQL error: ${err.message}`, "error");
    }
  }

  function resetSqlView() {
    if (!state.baseRows.length) {
      setStatus(el.sqlStatus, "No base dataset available to reset.", "error");
      return;
    }
    state.dataRows = cloneRows(state.baseRows);
    setStatus(el.sqlStatus, "Reset to base dataset (pre-SQL).", "ok");
    refreshAllViews();
  }

  function applyFormulas() {
    if (!state.dataRows.length) {
      setStatus(el.formulaStatus, "Pull data first, then apply formulas.", "error");
      return;
    }

    const formulaText = el.formulaInput.value.trim();
    if (!formulaText) {
      setStatus(el.formulaStatus, "Add at least one formula.", "error");
      return;
    }

    let parsed;
    try {
      parsed = parseFormulaLines(formulaText);
    } catch (err) {
      setStatus(el.formulaStatus, err.message, "error");
      return;
    }

    try {
      const target = state.baseRows.length ? cloneRows(state.baseRows) : cloneRows(state.dataRows);

      state.baseRows = target.map((row) => {
        const out = { ...row };
        for (const f of parsed) {
          const scope = { ...out };
          delete scope.DATE;
          let value = math.evaluate(f.expression, scope);
          if (typeof value === "boolean") value = value ? 1 : 0;
          if (value === undefined || value === null || Number.isNaN(Number(value))) {
            out[f.name] = null;
          } else {
            out[f.name] = Number(value);
          }
        }
        return out;
      });

      state.dataRows = cloneRows(state.baseRows);

      state.formulas = parsed;
      setStatus(el.formulaStatus, `Applied ${parsed.length} formula(s).`, "ok");
      setStatus(el.sqlStatus, "SQL view reset to formula-updated base dataset.", "ok");
      refreshAllViews();
    } catch (err) {
      setStatus(el.formulaStatus, `Formula error: ${err.message}`, "error");
    }
  }

  function getSelectedPlotVars() {
    return [...el.plotSeries.selectedOptions].map((o) => o.value);
  }

  function computeInversionShapes(xDates, ySpread) {
    const shapes = [];
    let runStart = null;

    for (let i = 0; i < xDates.length; i++) {
      const inv = ySpread[i] !== null && ySpread[i] < 0;
      if (inv && runStart === null) runStart = xDates[i];
      if (!inv && runStart !== null) {
        shapes.push({
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: runStart,
          x1: xDates[i],
          y0: 0,
          y1: 1,
          fillcolor: "rgba(192,60,60,0.12)",
          line: { width: 0 }
        });
        runStart = null;
      }
    }

    if (runStart !== null && xDates.length) {
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: runStart,
        x1: xDates[xDates.length - 1],
        y0: 0,
        y1: 1,
        fillcolor: "rgba(192,60,60,0.12)",
        line: { width: 0 }
      });
    }

    return shapes;
  }

  function plotData() {
    if (!state.dataRows.length) {
      setStatus(el.plotStatus, "No data loaded.", "error");
      return;
    }

    const selectedVars = getSelectedPlotVars();
    if (!selectedVars.length) {
      setStatus(el.plotStatus, "Select at least one series to plot.", "error");
      return;
    }

    const x = state.dataRows.map((r) => r.DATE);
    const type = el.chartType.value;
    const baseLayout = {
      title: {
        text: "FRED Visualization",
        font: { family: "Fraunces, serif", size: 20, color: "#11334b" }
      },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      margin: { t: 58, r: 26, b: 54, l: 64 },
      xaxis: {
        title: "Date",
        gridcolor: "#e7edf4",
        linecolor: "#bcd0e0",
        tickfont: { color: "#34556e" },
        rangeslider: { visible: true, thickness: 0.06 }
      },
      yaxis: {
        title: "Value",
        gridcolor: "#e7edf4",
        linecolor: "#bcd0e0",
        tickfont: { color: "#34556e" }
      },
      colorway: ["#0a7ea4", "#d07b00", "#206a4b", "#8d4f2b", "#4f6ea5", "#a33d3d"],
      legend: { orientation: "h", y: -0.2 },
      shapes: [],
      uirevision: "static"
    };

    if (type === "corr_heatmap") {
      if (selectedVars.length < 2) {
        setStatus(el.plotStatus, "Select at least 2 variables for correlation heatmap.", "error");
        return;
      }

      const z = selectedVars.map((v1) => {
        return selectedVars.map((v2) => {
          const a = [];
          const b = [];
          state.dataRows.forEach((row) => {
            const x1 = Number(row[v1]);
            const x2 = Number(row[v2]);
            if (Number.isFinite(x1) && Number.isFinite(x2)) {
              a.push(x1);
              b.push(x2);
            }
          });
          if (a.length < 2) return null;
          const ma = a.reduce((p, c) => p + c, 0) / a.length;
          const mb = b.reduce((p, c) => p + c, 0) / b.length;
          let num = 0;
          let da = 0;
          let db = 0;
          for (let i = 0; i < a.length; i += 1) {
            const xa = a[i] - ma;
            const xb = b[i] - mb;
            num += xa * xb;
            da += xa * xa;
            db += xb * xb;
          }
          if (!da || !db) return null;
          return num / Math.sqrt(da * db);
        });
      });

      const heatTrace = {
        type: "heatmap",
        x: selectedVars,
        y: selectedVars,
        z,
        zmin: -1,
        zmax: 1,
        colorscale: "RdBu",
        reversescale: true
      };
      Plotly.newPlot(el.chart, [heatTrace], {
        ...baseLayout,
        title: { ...baseLayout.title, text: "Correlation Heatmap" },
        xaxis: { title: "Variables" },
        yaxis: { title: "Variables" }
      }, { responsive: true, displaylogo: false });
      state.chartReady = true;
      setStatus(el.plotStatus, `Rendered correlation matrix for ${selectedVars.length} variables.`, "ok");
      return;
    }

    if (type === "yield_dashboard") {
      const hasGS10 = selectedVars.includes("GS10") || getVariableNames().includes("GS10");
      const hasTB3MS = selectedVars.includes("TB3MS") || getVariableNames().includes("TB3MS");
      const canUseSpreadVar = getVariableNames().includes("YC_SPREAD");
      if (!canUseSpreadVar && !(hasGS10 && hasTB3MS)) {
        setStatus(el.plotStatus, "Yield dashboard needs YC_SPREAD or both GS10 and TB3MS.", "error");
        return;
      }

      const gs10 = state.dataRows.map((r) => Number.isFinite(Number(r.GS10)) ? Number(r.GS10) : null);
      const tb3 = state.dataRows.map((r) => Number.isFinite(Number(r.TB3MS)) ? Number(r.TB3MS) : null);
      const spread = state.dataRows.map((r, i) => {
        if (Number.isFinite(Number(r.YC_SPREAD))) return Number(r.YC_SPREAD);
        if (Number.isFinite(gs10[i]) && Number.isFinite(tb3[i])) return gs10[i] - tb3[i];
        return null;
      });

      const traces = [];
      if (hasGS10) {
        traces.push({
          type: "scattergl",
          mode: "lines",
          name: "GS10",
          x,
          y: gs10,
          xaxis: "x",
          yaxis: "y",
          line: { width: 2.2 }
        });
      }
      if (hasTB3MS) {
        traces.push({
          type: "scattergl",
          mode: "lines",
          name: "TB3MS",
          x,
          y: tb3,
          xaxis: "x",
          yaxis: "y",
          line: { width: 2.2 }
        });
      }
      traces.push({
        type: "scattergl",
        mode: "lines",
        name: "Yield Spread",
        x,
        y: spread,
        xaxis: "x2",
        yaxis: "y2",
        fill: "tozeroy",
        line: { width: 2.5, color: "#d07b00" }
      });

      const shapes = [
        {
          type: "line",
          xref: "x2",
          yref: "y2",
          x0: x[0],
          x1: x[x.length - 1],
          y0: 0,
          y1: 0,
          line: { color: "#8fa2b3", width: 1, dash: "dot" }
        }
      ];

      if (el.shadeInversions.checked) {
        const invShapes = computeInversionShapes(x, spread).map((s) => ({ ...s, xref: "x2", yref: "paper", y0: 0, y1: 0.4 }));
        shapes.push(...invShapes);
      }

      Plotly.newPlot(el.chart, traces, {
        ...baseLayout,
        title: { ...baseLayout.title, text: "Yield Dashboard (Rates + Spread)" },
        grid: { rows: 2, columns: 1, pattern: "independent", roworder: "top to bottom" },
        xaxis: { ...baseLayout.xaxis, domain: [0, 1], anchor: "y", rangeslider: { visible: false } },
        yaxis: { ...baseLayout.yaxis, domain: [0.46, 1], title: "Rate (%)" },
        xaxis2: { ...baseLayout.xaxis, domain: [0, 1], anchor: "y2", title: "Date", rangeslider: { visible: true, thickness: 0.06 } },
        yaxis2: { ...baseLayout.yaxis, domain: [0, 0.38], title: "GS10 - TB3MS" },
        shapes
      }, { responsive: true, displaylogo: false });
      state.chartReady = true;
      setStatus(el.plotStatus, "Rendered yield dashboard.", "ok");
      return;
    }

    if (type === "webgl_3d") {
      const traces = selectedVars.map((v, idx) => ({
        type: "scatter3d",
        mode: "lines",
        name: v,
        x,
        y: state.dataRows.map((r) => (r[v] === undefined ? null : r[v])),
        z: state.dataRows.map(() => idx + 1),
        line: { width: 4 }
      }));
      Plotly.newPlot(el.chart, traces, {
        ...baseLayout,
        title: { ...baseLayout.title, text: "3D WebGL Time-Series Stack" },
        scene: {
          xaxis: { title: "Date" },
          yaxis: { title: "Value" },
          zaxis: {
            title: "Series Layer",
            tickvals: selectedVars.map((_, i) => i + 1),
            ticktext: selectedVars
          },
          camera: { eye: { x: 1.5, y: 1.15, z: 0.9 } }
        }
      }, { responsive: true, displaylogo: false });
      state.chartReady = true;
      setStatus(el.plotStatus, `Rendered WebGL 3D plot for ${selectedVars.length} series.`, "ok");
      return;
    }

    const mode = type === "line" ? "lines" : type === "scatter" ? "markers" : "lines";

    const traces = selectedVars.map((v) => ({
      type: type === "bar" ? "bar" : "scattergl",
      mode,
      name: v,
      x,
      y: state.dataRows.map((r) => (r[v] === undefined ? null : r[v])),
      line: { width: 2 }
    }));

    const layout = { ...baseLayout };

    if (el.shadeInversions.checked && getVariableNames().includes("YC_SPREAD")) {
      const ySpread = state.dataRows.map((r) => r.YC_SPREAD ?? null);
      layout.shapes = computeInversionShapes(x, ySpread);
    }

    Plotly.newPlot(el.chart, traces, layout, { responsive: true, displaylogo: false });
    state.chartReady = true;
    setStatus(el.plotStatus, `Plotted ${selectedVars.length} series.`, "ok");
  }

  function refreshVariableUI() {
    const vars = getVariableNames();

    el.varList.innerHTML = "";
    vars.forEach((v) => {
      const node = document.createElement("span");
      node.className = "pill";
      node.textContent = v;
      el.varList.appendChild(node);
    });
  }

  function updatePlotSeriesOptions() {
    const vars = getVariableNames();
    el.plotSeries.innerHTML = "";
    vars.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (state.selectedSeries.some((s) => s.alias === v)) {
        opt.selected = true;
      }
      el.plotSeries.appendChild(opt);
    });

    if (vars.includes("YC_SPREAD") && ![...el.plotSeries.options].some((o) => o.selected && o.value === "YC_SPREAD")) {
      [...el.plotSeries.options].forEach((o) => {
        if (o.value === "YC_SPREAD") o.selected = true;
      });
    }
  }

  function renderPreview() {
    if (!state.dataRows.length) {
      el.previewTableHead.innerHTML = "";
      el.previewTableBody.innerHTML = "";
      setStatus(el.previewStatus, "No data rows yet.");
      return;
    }

    const cols = ["DATE", ...getVariableNames()];
    const sample = state.dataRows.slice(0, 120);

    el.previewTableHead.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
    el.previewTableBody.innerHTML = sample
      .map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`)
      .join("");

    setStatus(el.previewStatus, `Showing first ${sample.length} of ${state.dataRows.length} rows.`, "ok");
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    if (!state.dataRows.length) {
      setStatus(el.previewStatus, "No data to export.", "error");
      return;
    }

    const csv = Papa.unparse(state.dataRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob("fred_tool_data.csv", blob);
  }

  function exportXlsx() {
    if (!state.dataRows.length) {
      setStatus(el.previewStatus, "No data to export.", "error");
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(state.dataRows);
    XLSX.utils.book_append_sheet(wb, ws, "FRED_Data");
    XLSX.writeFile(wb, "fred_tool_data.xlsx");
  }

  async function exportChart(format) {
    if (!state.chartReady) {
      setStatus(el.plotStatus, "Plot data before exporting chart.", "error");
      return;
    }

    try {
      const url = await Plotly.toImage(el.chart, {
        format,
        width: 1400,
        height: 800
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `fred_tool_chart.${format}`;
      a.click();
    } catch (err) {
      setStatus(el.plotStatus, `Chart export failed: ${err.message}`, "error");
    }
  }

  function clearAll() {
    state.rawSeries = new Map();
    state.baseRows = [];
    state.dataRows = [];
    state.formulas = [];
    state.chartReady = false;
    el.formulaInput.value = "";
    if (el.sqlInput) el.sqlInput.value = "SELECT * FROM fred_data ORDER BY DATE";
    el.plotSeries.innerHTML = "";
    el.varList.innerHTML = "";
    el.previewTableHead.innerHTML = "";
    el.previewTableBody.innerHTML = "";
    Plotly.purge(el.chart);
    setStatus(el.fetchStatus, "Cleared loaded data.", "ok");
    setStatus(el.formulaStatus, "");
    setStatus(el.sqlStatus, "");
    setStatus(el.plotStatus, "");
    setStatus(el.previewStatus, "No data rows yet.");
    updateStats();
  }

  function initThreeScene() {
    const canvas = document.getElementById("sceneBg");
    if (!canvas || typeof window.THREE === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 8.4);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    const dotsGeometry = new THREE.SphereGeometry(2.15, 52, 52);
    const dotsMaterial = new THREE.PointsMaterial({
      color: 0x0a7ea4,
      size: 0.028,
      transparent: true,
      opacity: 0.72
    });
    const dots = new THREE.Points(dotsGeometry, dotsMaterial);
    globeGroup.add(dots);

    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0xd07b00,
        wireframe: true,
        transparent: true,
        opacity: 0.11
      })
    );
    globeGroup.add(wire);

    const starCount = 900;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions[i * 3] = (Math.random() - 0.5) * 34;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 22;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0x9fc8df,
        size: 0.02,
        transparent: true,
        opacity: 0.6
      })
    );
    scene.add(stars);

    let rafId = null;
    const animate = () => {
      globeGroup.rotation.y += 0.0018;
      globeGroup.rotation.x += 0.00035;
      stars.rotation.y -= 0.00016;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener("resize", onResize);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!rafId) {
        animate();
      }
    });
  }

  function wireEvents() {
    el.endDate.value = todayISO();
    el.apiKey.value = state.apiKey;
    if (el.blsApiKey) el.blsApiKey.value = state.blsApiKey;
    if (el.sqlInput) el.sqlInput.value = "SELECT * FROM fred_data ORDER BY DATE";

    el.saveApiKey.addEventListener("click", () => {
      state.apiKey = el.apiKey.value.trim();
      state.blsApiKey = el.blsApiKey?.value.trim() || "";
      localStorage.setItem("fred_api_key", state.apiKey);
      localStorage.setItem("bls_api_key", state.blsApiKey);
      const bits = [];
      bits.push(state.apiKey ? "FRED key saved" : "FRED key cleared");
      bits.push(state.blsApiKey ? "BLS key saved" : "BLS key cleared");
      setStatus(el.catalogStatus, `${bits.join(" | ")}.`, "ok");
    });

    el.catalogSearch.addEventListener("click", searchCatalog);

    el.addManualSeries.addEventListener("click", () => {
      const provider = el.manualProvider?.value || "fred";
      const id = el.manualSeriesId.value.trim().toUpperCase();
      const alias = el.manualAlias.value.trim();
      if (!id) {
        setStatus(el.fetchStatus, "Enter a series ID.", "error");
        return;
      }
      upsertSeries(id, alias || id, "Manual series", provider);
      el.manualSeriesId.value = "";
      el.manualAlias.value = "";
      setStatus(el.fetchStatus, `Added ${provider.toUpperCase()}:${id}.`, "ok");
    });

    el.addYieldCurveSet.addEventListener("click", () => {
      upsertSeries("TB3MS", "TB3MS", "3-Month Treasury Bill", "fred");
      upsertSeries("GS10", "GS10", "10-Year Treasury Note", "fred");
      setStatus(el.fetchStatus, "Added TB3MS and GS10.", "ok");
    });

    if (el.addExternalCsv) {
      el.addExternalCsv.addEventListener("click", () => {
        const url = el.externalCsvUrl.value.trim();
        const dateColumn = (el.externalCsvDateColumn.value || "DATE").trim();
        const valueColumn = (el.externalCsvValueColumn.value || "value").trim();
        const alias = (el.externalCsvAlias.value || valueColumn || "external_value").trim();
        if (!url) {
          setStatus(el.fetchStatus, "Enter an external CSV URL.", "error");
          return;
        }
        const id = `CSV_${Date.now()}`;
        upsertSeries(
          id,
          alias,
          `External CSV (${valueColumn})`,
          "csv",
          { url, dateColumn, valueColumn }
        );
        setStatus(el.fetchStatus, `Added external CSV source for ${valueColumn}.`, "ok");
      });
    }

    if (el.loadFredV2Bulk) {
      el.loadFredV2Bulk.addEventListener("click", loadFredV2Bulk);
    }

    el.fetchData.addEventListener("click", pullSeriesData);
    el.clearData.addEventListener("click", clearAll);

    el.applyFormulas.addEventListener("click", applyFormulas);
    el.runSql.addEventListener("click", runSqlQuery);
    el.resetSql.addEventListener("click", resetSqlView);

    el.addYieldCurveFormula.addEventListener("click", () => {
      const snippet = "YC_SPREAD = GS10 - TB3MS\nYC_INVERTED = YC_SPREAD < 0";
      el.formulaInput.value = el.formulaInput.value.trim()
        ? `${el.formulaInput.value.trim()}\n${snippet}`
        : snippet;
    });

    el.plotBtn.addEventListener("click", plotData);

    el.downloadCsv.addEventListener("click", exportCsv);
    el.downloadXlsx.addEventListener("click", exportXlsx);
    el.exportPng.addEventListener("click", () => exportChart("png"));
    el.exportSvg.addEventListener("click", () => exportChart("svg"));

    loadSnapshotManifest().then((manifest) => {
      if (!manifest) {
        setStatus(el.fredV2Status, "No static provider snapshot found. Live API mode ready.");
        return;
      }
      const fredCount = (manifest.fred_v2 || []).filter((x) => x.ok).length;
      const hasBls = Boolean(manifest.bls?.ok);
      const msg = `Snapshot backend loaded (${fredCount} FRED v2 release snapshot${fredCount === 1 ? "" : "s"}${hasBls ? ", BLS included" : ""}).`;
      setStatus(el.fredV2Status, msg, "ok");
    });
  }

  wireEvents();
  initThreeScene();
  renderSelectedSeries();
  renderPreview();
  updateStats();
})();
