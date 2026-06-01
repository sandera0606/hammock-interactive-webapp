import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import HammockPlot from "./components/HammockPlot";
import DataPanel from "./components/DataPanel";
import OptionsRail from "./components/OptionsRail";
import { Toggle } from "./components/controls";
import {
  fetchScene,
  getSample,
  listSamples,
  uploadCsv,
  type DatasetPayload,
  type PlotOptions,
  type SampleInfo,
} from "./lib/api";
import { uiToPlotOptions } from "./lib/optionsToRequest";
import { defaultWidth } from "./lib/defaults";
import {
  applyPreset,
  defaultPerUnibar,
  ensurePerUnibar,
  initialUiState,
  type ColumnMeta,
  type Dataset,
  type PerUnibar,
  type Preset,
  type UiState,
} from "./lib/optionsState";
import type { Scene } from "./lib/scene";

const DEBOUNCE_MS = 400;
const MIN_VARS = 2; // a hammock needs at least two axes to connect

/** Build a starting UiState for a freshly loaded dataset, honouring a sample's
 *  default option config (var selection, display types, highlight) when present. */
function seedUi(ds: Dataset, defaults?: PlotOptions): UiState {
  const ui = initialUiState();
  const metaByName = Object.fromEntries((ds.meta ?? []).map((m) => [m.name, m]));
  const vars = (defaults?.var ?? []).filter((v) => metaByName[v]);
  ui.var = vars;
  ui.perUnibar = {};
  for (const v of vars) ui.perUnibar[v] = defaultPerUnibar(metaByName[v]);
  if (defaults?.display_type) {
    for (const [k, dt] of Object.entries(defaults.display_type)) {
      if (ui.perUnibar[k]) ui.perUnibar[k].displayType = dt;
    }
  }
  if (defaults?.hi_var && metaByName[defaults.hi_var]) {
    ui.highlight = true;
    ui.hiVar = defaults.hi_var;
    if (Array.isArray(defaults.hi_value)) {
      ui.hiType = "labels";
      ui.hiValues = defaults.hi_value.map(String);
    } else if (typeof defaults.hi_value === "string") {
      ui.hiType = "expression";
      ui.hiExpression = defaults.hi_value;
    }
  }
  ui.width = defaultWidth(vars.length);
  return ui;
}

function toDataset(p: DatasetPayload): Dataset {
  return { name: p.label ?? p.name, columns: p.columns, rows: p.data, meta: p.meta };
}

export default function App() {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [ui, setUi] = useState<UiState>(initialUiState);

  const [scene, setScene] = useState<Scene | null>(null);
  const [busy, setBusy] = useState(false); // plot fetch in flight
  const [dataBusy, setDataBusy] = useState(false); // dataset load in flight
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("hammock-theme", next);
      } catch {
        /* ignore storage failures (private mode) */
      }
      return next;
    });
  }, []);

  const metaByName = useMemo<Record<string, ColumnMeta>>(
    () => (dataset?.meta ? Object.fromEntries(dataset.meta.map((m) => [m.name, m])) : {}),
    [dataset],
  );
  const options = useMemo(() => uiToPlotOptions(ui, metaByName), [ui, metaByName]);
  const ready = !!dataset && options.var.length >= MIN_VARS;

  // refs so the imperative fetch always sees the latest values
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const rowsRef = useRef(dataset?.rows ?? []);
  rowsRef.current = dataset?.rows ?? [];
  const plotAbort = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    const opts = optionsRef.current;
    if (opts.var.length < MIN_VARS) return;
    plotAbort.current?.abort();
    const ac = new AbortController();
    plotAbort.current = ac;
    setBusy(true);
    setError("");
    fetchScene(rowsRef.current, opts, ac.signal)
      .then((s) => {
        setScene(s);
        setBusy(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  }, []);

  // discover samples once, then auto-load the first
  useEffect(() => {
    listSamples()
      .then((s) => {
        setSamples(s);
        if (s.length) void loadSample(s[0].name);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSample = async (name: string) => {
    setDataBusy(true);
    setError("");
    setActiveSample(name);
    try {
      const payload = await getSample(name);
      const ds = toDataset(payload);
      setDataset(ds);
      setUi(seedUi(ds, payload.defaults));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
    }
  };

  const handleUpload = async (content: string, filename: string) => {
    setDataBusy(true);
    setError("");
    setActiveSample(null);
    try {
      const payload = await uploadCsv(content, filename);
      const ds = toDataset(payload);
      setDataset(ds);
      setUi(seedUi(ds)); // no defaults: user picks variables
      setScene(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
    }
  };

  // debounced auto-replot
  useEffect(() => {
    if (!auto || !ready) return;
    const t = setTimeout(doFetch, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [options, ready, auto, doFetch]);

  // state updaters threaded to the rail
  const patch = useCallback((p: Partial<UiState>) => setUi((s) => ({ ...s, ...p })), []);
  const patchUnibar = useCallback(
    (name: string, p: Partial<PerUnibar>) =>
      setUi((s) => ({
        ...s,
        perUnibar: { ...s.perUnibar, [name]: { ...s.perUnibar[name], ...p } },
      })),
    [],
  );
  const setVar = useCallback(
    (v: string[]) =>
      setUi((s) => {
        let next = ensurePerUnibar({ ...s, var: v }, metaByName);
        if (!s.widthTouched) next = { ...next, width: defaultWidth(v.length) };
        // keep same_scale / hiVar consistent with the new selection
        next.sameScale = next.sameScale.filter((x) => v.includes(x));
        return next;
      }),
    [metaByName],
  );
  const setPreset = useCallback((p: Preset) => setUi((s) => applyPreset(s, p)), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Hammock</h1>
          <span className="tag">interactive studio</span>
        </div>
        <div className="spacer" />
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <Toggle label="Auto-update" checked={auto} onChange={setAuto} />
        <button
          className="btn primary"
          disabled={!ready || busy}
          onClick={doFetch}
          title={ready ? "Redraw now" : "Select at least two variables"}
        >
          {busy ? "Plotting…" : "Apply"}
        </button>
        <span className="pin">pin {scene?.hammockPin?.short ?? "—"}</span>
      </header>

      {scene && scene.warnings.length > 0 && (
        <div className="warnstrip">
          <span className="wlabel">{scene.warnings.length} warning(s):</span>
          <span>{scene.warnings.join(" · ")}</span>
        </div>
      )}

      <div className="body">
        <aside className="rail">
          <div className="section flush">
            <DataPanel
              samples={samples}
              dataset={dataset}
              activeSample={activeSample}
              onPickSample={(n) => void loadSample(n)}
              onUploadText={(c, f) => void handleUpload(c, f)}
              busy={dataBusy}
            />
          </div>

          {dataset && (
            <OptionsRail
              ui={ui}
              meta={dataset.meta}
              patch={patch}
              patchUnibar={patchUnibar}
              setVar={setVar}
              setPreset={setPreset}
            />
          )}
        </aside>

        <main className="stage">
          <div className="plot-card">
            {busy && (
              <div className="updating">
                <span className="spinner" /> updating
              </div>
            )}

            {scene && (
              <div className={"plot-host" + (busy ? " dim" : "")}>
                <HammockPlot scene={scene} />
              </div>
            )}

            {!scene && (
              <div className="overlay">
                <div>
                  <div className="title">
                    {dataBusy ? "Loading data…" : ready ? "Drawing…" : "Build a plot"}
                  </div>
                  <div className="sub">
                    {error
                      ? error
                      : !dataset
                        ? "Pick a sample or drop a CSV in the left panel to begin."
                        : "Select two or more variables to draw your hammock plot."}
                  </div>
                </div>
              </div>
            )}

            {scene && error && (
              <div className="overlay error block">
                <div>
                  <div className="title">Could not redraw</div>
                  <div className="sub">{error}</div>
                  <button className="btn sm" style={{ marginTop: 14 }} onClick={() => setError("")}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
