(() => {
  const state = {
    apiKey: localStorage.getItem("fred_api_key") || "",
    selectedSeries: [], // [{id, alias, title}]
    rawSeries: new Map(), // alias -> [{date, value}]
    dataRows: [],
    formulas: [], // [{name, expression}]
    chartReady: false,
    catalogResults: []
  };

  const PROXY_BASE = "https://api.codetabs.com/v1/proxy/?quest=";

  const el = {
    apiKey: document.getElementById("apiKey"),
    saveApiKey: document.getElementById("saveApiKey"),
    catalogQuery: document.getElementById("catalogQuery"),
    catalogLimit: document.getElementById("catalogLimit"),
    catalogSearch: document.getElementById("catalogSearch"),
    catalogStatus: document.getElementById("catalogStatus"),
    catalogTableBody: document.querySelector("#catalogTable tbody"),
    manualSeriesId: document.getElementById("manualSeriesId"),
    manualAlias: document.getElementById("manualAlias"),
    addManualSeries: document.getElementById("addManualSeries"),
    addYieldCurveSet: document.getElementById("addYieldCurveSet"),
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

  function formatCount(n) {
    return new Intl.NumberFormat("en-US").format(n);
  }

  function updateStats() {
    if (el.statSeries) el.statSeries.textContent = formatCount(state.selectedSeries.length);
    if (el.statRows) el.statRows.textContent = formatCount(state.dataRows.length);
    if (el.statVars) el.statVars.textContent = formatCount(getVariableNames().length);
    if (el.statFormulas) el.statFormulas.textContent = formatCount(state.formulas.length);
  }

  async function fetchText(url) {
    try {
      const direct = await fetch(url);
      if (direct.ok) return direct.text();
    } catch (_) {
      // ignore direct failure, try proxy
    }

    const proxyUrl = PROXY_BASE + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      throw new Error(`Fetch failed (${resp.status})`);
    }
    return resp.text();
  }

  async function fetchJson(url) {
    const text = await fetchText(url);
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

  function upsertSeries(id, alias = "", title = "") {
    const normId = id.trim().toUpperCase();
    if (!normId) return;
    if (state.selectedSeries.find((s) => s.id === normId)) return;

    const finalAlias = safeAlias(alias || normId);
    state.selectedSeries.push({ id: normId, alias: finalAlias, title: title || "" });
    renderSelectedSeries();
  }

  function removeSeries(id) {
    const target = state.selectedSeries.find((s) => s.id === id);
    state.selectedSeries = state.selectedSeries.filter((s) => s.id !== id);
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
          <div><strong>${s.id}</strong></div>
          <div class="series-label">${s.title || "Manual series"}</div>
        </div>
        <input data-series-alias="${s.id}" type="text" value="${s.alias}" />
        <button data-remove-series="${s.id}" class="btn btn-secondary">Remove</button>
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
        const id = input.getAttribute("data-series-alias");
        const idx = state.selectedSeries.findIndex((s) => s.id === id);
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
        upsertSeries(id, id, s?.title || "");
      });
    });
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
      const url = seriesCsvUrl(s.id, start, end);
      try {
        const csv = await fetchText(url);
        const rows = parseSeriesCsv(csv, s.id);
        fetched.set(s.alias, rows);
      } catch (err) {
        setStatus(el.fetchStatus, `Failed on ${s.id}: ${err.message}`, "error");
        return;
      }
    }

    state.rawSeries = fetched;
    state.dataRows = mergeSeriesRows(state.rawSeries);

    setStatus(el.fetchStatus, `Pulled ${state.selectedSeries.length} series with ${state.dataRows.length} date rows.`, "ok");

    refreshVariableUI();
    renderPreview();
    updatePlotSeriesOptions();
    updateStats();
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
    return Object.keys(state.dataRows[0]).filter((k) => k !== "DATE");
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
      state.dataRows = state.dataRows.map((row) => {
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

      state.formulas = parsed;
      setStatus(el.formulaStatus, `Applied ${parsed.length} formula(s).`, "ok");
      refreshVariableUI();
      renderPreview();
      updatePlotSeriesOptions();
      updateStats();
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
    const mode = type === "line" ? "lines" : type === "scatter" ? "markers" : "lines";

    const traces = selectedVars.map((v) => {
      return {
        type: type === "line" ? "scatter" : type,
        mode,
        name: v,
        x,
        y: state.dataRows.map((r) => (r[v] === undefined ? null : r[v]))
      };
    });

    const layout = {
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
        tickfont: { color: "#34556e" }
      },
      yaxis: {
        title: "Value",
        gridcolor: "#e7edf4",
        linecolor: "#bcd0e0",
        tickfont: { color: "#34556e" }
      },
      colorway: ["#0a7ea4", "#d07b00", "#206a4b", "#8d4f2b", "#4f6ea5", "#a33d3d"],
      legend: { orientation: "h", y: -0.2 },
      shapes: []
    };

    if (el.shadeInversions.checked && selectedVars.includes("YC_SPREAD")) {
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
    state.dataRows = [];
    state.formulas = [];
    state.chartReady = false;
    el.formulaInput.value = "";
    el.plotSeries.innerHTML = "";
    el.varList.innerHTML = "";
    el.previewTableHead.innerHTML = "";
    el.previewTableBody.innerHTML = "";
    Plotly.purge(el.chart);
    setStatus(el.fetchStatus, "Cleared loaded data.", "ok");
    setStatus(el.formulaStatus, "");
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

    el.saveApiKey.addEventListener("click", () => {
      state.apiKey = el.apiKey.value.trim();
      localStorage.setItem("fred_api_key", state.apiKey);
      setStatus(el.catalogStatus, state.apiKey ? "API key saved." : "API key cleared.", "ok");
    });

    el.catalogSearch.addEventListener("click", searchCatalog);

    el.addManualSeries.addEventListener("click", () => {
      const id = el.manualSeriesId.value.trim().toUpperCase();
      const alias = el.manualAlias.value.trim();
      if (!id) {
        setStatus(el.fetchStatus, "Enter a series ID.", "error");
        return;
      }
      upsertSeries(id, alias || id, "Manual series");
      el.manualSeriesId.value = "";
      el.manualAlias.value = "";
      setStatus(el.fetchStatus, `Added ${id}.`, "ok");
    });

    el.addYieldCurveSet.addEventListener("click", () => {
      upsertSeries("TB3MS", "TB3MS", "3-Month Treasury Bill");
      upsertSeries("GS10", "GS10", "10-Year Treasury Note");
      setStatus(el.fetchStatus, "Added TB3MS and GS10.", "ok");
    });

    el.fetchData.addEventListener("click", pullSeriesData);
    el.clearData.addEventListener("click", clearAll);

    el.applyFormulas.addEventListener("click", applyFormulas);

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
  }

  wireEvents();
  initThreeScene();
  renderSelectedSeries();
  renderPreview();
  updateStats();
})();
