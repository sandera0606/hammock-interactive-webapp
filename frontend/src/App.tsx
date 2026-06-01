import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import HammockPlot from "./components/HammockPlot";
import DataPanel from "./components/DataPanel";
import DataEditor from "./components/DataEditor";
import OptionsRail from "./components/OptionsRail";
import { Toggle } from "./components/controls";
import {
  fetchScene,
  getSample,
  listSamples,
  reinferData,
  uploadCsv,
  type DatasetPayload,
  type PlotOptions,
  type Row,
  type SampleInfo,
} from "./lib/api";
import { uiToPlotOptions } from "./lib/optionsToRequest";
import { defaultWidth } from "./lib/defaults";
import {
  applyPreset,
  defaultPerUnibar,
  ensurePerUnibar,
  initialUiState,
  reconcileUiToMeta,
  type ColumnMeta,
  type Dataset,
  type DataSource,
  type PerUnibar,
  type Preset,
  type UiState,
} from "./lib/optionsState";
import type { Scene } from "./lib/scene";

const DEBOUNCE_MS = 400;
const MIN_VARS = 2; // a hammock needs at least two axes to connect

// Bounds for the drag-resizable control rail (px).
const RAIL_MIN = 280;
const RAIL_MAX = 720;
const RAIL_DEFAULT = 420;

function loadRailWidth(): number {
  try {
    const v = Number(localStorage.getItem("hammock-rail-w"));
    if (Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX) return v;
  } catch {
    /* ignore storage failures (private mode) */
  }
  return RAIL_DEFAULT;
}

function loadDataOpen(): boolean {
  try {
    const v = localStorage.getItem("hammock-data-open");
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore storage failures (private mode) */
  }
  return true; // first run: the data card is open (you need it to load data)
}

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

function toDataset(p: DatasetPayload, source: DataSource): Dataset {
  return { name: p.label ?? p.name, columns: p.columns, rows: p.data, meta: p.meta, source };
}

export default function App() {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [ui, setUi] = useState<UiState>(initialUiState);

  const [scene, setScene] = useState<Scene | null>(null);
  const [busy, setBusy] = useState(false); // plot fetch in flight
  const [dataBusy, setDataBusy] = useState(false); // dataset load in flight
  const [editorOpen, setEditorOpen] = useState(false); // data editor modal
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );

  const [dataOpen, setDataOpen] = useState<boolean>(loadDataOpen);
  const [railWidth, setRailWidth] = useState<number>(loadRailWidth);
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Full-screen splash on first open: stays up until the first plot is drawn
  // (or the boot sequence settles into an error), then fades out. A safety
  // timeout guarantees it never hangs if the auto-load stalls.
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    if (scene || error) setBooting(false);
  }, [scene, error]);
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 8000);
    return () => clearTimeout(t);
  }, []);

  // Drag the rail's right border to resize it; persist the chosen width.
  const startResize = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const left = bodyRef.current?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX - left));
      setRailWidth(w);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX - left));
      try {
        localStorage.setItem("hammock-rail-w", String(Math.round(w)));
      } catch {
        /* ignore storage failures (private mode) */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const toggleData = useCallback(() => {
    setDataOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem("hammock-data-open", next ? "1" : "0");
      } catch {
        /* ignore storage failures (private mode) */
      }
      return next;
    });
  }, []);

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
      const ds = toDataset(payload, "sample");
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
      const ds = toDataset(payload, "upload");
      setDataset(ds);
      setUi(seedUi(ds)); // no defaults: user picks variables
      setScene(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
    }
  };

  // Commit hand-edits from the data editor: re-infer dtypes/metadata on the
  // server (so a fresh upload and an edit agree), then reconcile the option
  // state against the new metadata before the auto-replot fires.
  const applyDataEdits = async (rows: Row[], columns: string[]) => {
    setDataBusy(true);
    setError("");
    try {
      const payload = await reinferData(rows, columns);
      setDataset((prev) =>
        prev
          ? {
              ...prev,
              columns: payload.columns,
              rows: payload.data,
              meta: payload.meta,
              edited: true,
            }
          : prev,
      );
      const metaByName = Object.fromEntries(payload.meta.map((m) => [m.name, m]));
      setUi((s) => reconcileUiToMeta(s, metaByName));
      setEditorOpen(false);
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
      <div className={"splash" + (booting ? "" : " hide")} aria-hidden={!booting}>
        <div className="splash-inner">
          <div className="splash-mark">
            <span className="splash-spinner" />
          </div>
          <div className="splash-title">Hammock Plot</div>
          <div className="splash-sub">Loading…</div>
        </div>
      </div>

      <header className="topbar">
        <div className="brand">
          <h1>Hammock Plot</h1>
        </div>
        <div className="spacer" />
        <a
          className="topbar-link"
          href="https://github.com/TianchengY/hammock_plot"
          target="_blank"
          rel="noopener noreferrer"
          title="View hammock_plot on GitHub"
          aria-label="View hammock_plot on GitHub"
        >
          <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.4" fill="currentColor" />
              <g
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                {Array.from({ length: 8 }).map((_, i) => {
                  const a = (i * Math.PI) / 4;
                  const c = Math.cos(a);
                  const s = Math.sin(a);
                  return (
                    <line
                      key={i}
                      x1={12 + c * 7}
                      y1={12 + s * 7}
                      x2={12 + c * 9.4}
                      y2={12 + s * 9.4}
                    />
                  );
                })}
              </g>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              {/* solid crescent moon */}
              <path
                fill="currentColor"
                d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
              />
            </svg>
          )}
        </button>
      </header>

      {scene && scene.warnings.length > 0 && (
        <div className="warnstrip">
          <span className="wlabel">{scene.warnings.length} warning(s):</span>
          <span>{scene.warnings.join(" · ")}</span>
        </div>
      )}

      <div className={"body" + (resizing ? " resizing" : "")} ref={bodyRef}>
        <aside className="rail" style={{ flexBasis: railWidth, width: railWidth }}>
          {(() => {
            // The card is collapsible only once a dataset is loaded — before
            // that you need it open to load data, so no toggle is offered.
            const dataCollapsed = !!dataset && !dataOpen;
            return (
              <section className={"data-card" + (dataCollapsed ? " collapsed" : "")}>
                <header
                  className={"data-card-head" + (dataset ? " clickable" : "")}
                  role={dataset ? "button" : undefined}
                  tabIndex={dataset ? 0 : undefined}
                  aria-expanded={dataset ? !dataCollapsed : undefined}
                  onClick={dataset ? toggleData : undefined}
                  onKeyDown={
                    dataset
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleData();
                          }
                        }
                      : undefined
                  }
                  title={dataset ? (dataCollapsed ? "Show data source" : "Hide data source") : undefined}
                >
                  <span className="step">1</span>
                  <div className="data-card-title">
                    <span className="label">Data source</span>
                    <span className="sub">
                      {dataCollapsed
                        ? `${dataset!.name} · ${dataset!.rows.length.toLocaleString()} rows · ${dataset!.columns.length} cols`
                        : "Pick a sample or drop your own CSV"}
                    </span>
                  </div>
                  {dataset && (
                    <span className="chev" aria-hidden="true">
                      ▸
                    </span>
                  )}
                </header>
                {!dataCollapsed && (
                  <DataPanel
                    samples={samples}
                    dataset={dataset}
                    activeSample={activeSample}
                    onPickSample={(n) => void loadSample(n)}
                    onUploadText={(c, f) => void handleUpload(c, f)}
                    onEditData={() => setEditorOpen(true)}
                    busy={dataBusy}
                  />
                )}
              </section>
            );
          })()}

          {dataset && (
            <div className="rail-config">
              <header className="config-head">
                <span className="step">2</span>
                <span className="label">Configure plot</span>
              </header>
              <OptionsRail
                ui={ui}
                meta={dataset.meta}
                patch={patch}
                patchUnibar={patchUnibar}
                setVar={setVar}
                setPreset={setPreset}
              />
            </div>
          )}
        </aside>

        <div
          className="rail-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize control panel"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setRailWidth(RAIL_DEFAULT);
            try {
              localStorage.setItem("hammock-rail-w", String(RAIL_DEFAULT));
            } catch {
              /* ignore */
            }
          }}
          title="Drag to resize · double-click to reset"
        />

        <main className="stage">
          <div className="plot-card">
            <div className="plot-toolbar">
              <div className="plot-toolbar-left">
                {dataset && (
                  <span className="plot-title">
                    {dataset.name}
                    {options.var.length > 0 && (
                      <span className="plot-title-meta">
                        {" · "}
                        {options.var.length} {options.var.length === 1 ? "axis" : "axes"}
                      </span>
                    )}
                  </span>
                )}
                {busy && (
                  <span className="plot-status">
                    <span className="spinner" /> updating
                  </span>
                )}
              </div>
              <div className="plot-toolbar-right">
                <Toggle label="Auto-update" checked={auto} onChange={setAuto} />
                <button
                  className="btn primary"
                  disabled={!ready || busy}
                  onClick={doFetch}
                  title={ready ? "Redraw now" : "Select at least two variables"}
                >
                  {busy ? "Plotting…" : "Apply"}
                </button>
              </div>
            </div>

            <div className="plot-body">
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
          </div>
        </main>
      </div>

      {editorOpen && dataset && (
        <DataEditor
          dataset={dataset}
          busy={dataBusy}
          onApply={(rows, columns) => void applyDataEdits(rows, columns)}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
