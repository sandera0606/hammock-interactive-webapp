# CLAUDE.md — agent working notes

Purpose, scope, and milestones live in GOAL.md / ROADMAP.md. This file is the **technical load-bearing knowledge** for implementing the engine. Read it before touching capture code.

## The core trick: pure-wrapper capture (run the library, record what it draws)

We must NOT edit `hammock_plot`. We run its **real** drawing code and replay the exact matplotlib primitives it emits as plotly traces — pixel-faithful, no geometry/stat reinvention. Verified against `../../hammock_plot/hammock_plot/` and proven in `spike/spike.py` + `spike/spike3.py`.

`Hammock(df).plot(..., display_figure=False)` runs the full layout, draws, returns `None`. The library draws via only ~6 Axes primitives, captured **two composing ways**:

**1. Painter recorder (semantic) — for connectors, rugplot/stacked/bar unibars, beanplot spikes.**
These funnel through `FigureBase.plot(ax, alpha, left_center_pts, right_center_pts, heights, colors, weights, orientation, zorder, check_overlap, unibar_name)` in `shapes.py` → which segments by color and calls `ax.fill(poly_x_slice, poly_y_slice, color=...)`.
- `figure.py:4` `from hammock_plot.shapes import Rectangle, Parallelogram`; `figure.py:86` `self.fig_painter = Rectangle()/Parallelogram()`; `main.py:5` `from hammock_plot.figure import Figure`.
- → Patch `figure.Rectangle`, `figure.Parallelogram`, `main.Figure` before `plot()`. The recording painter overrides `plot()` to run **`super().plot(rec_ax, ...)`** into a stand-in `_RecAx` that captures the real `ax.fill` calls (final, perimeter-ordered, color-sliced). **DO call `super().plot`** — do NOT re-derive from `get_coordinates` (that produced a self-intersecting "bowtie"; the bug we already hit). Chunk fills by shape (`len(colors)` fills/shape, grouped), tag with `unibar_name` + `right_center` y + per-color `weights`. Drop white-divider + zero-area slices.

**2. Axes instrumentation (pixel-faithful) — for box, violin, and all text labels.**
These draw straight onto the real Axes (`ax.fill_betweenx` = violin body, `ax.broken_barh` = box/inner-box rect, `ax.plot` = median/whisker/cap lines, `ax.scatter` = fliers, `ax.text` = labels), bypassing the painter.
- → Patch `pyplot.subplots` to return a **real** Agg Axes whose `fill`/`fill_betweenx`/`broken_barh`/`plot`/`scatter`/`text`/`set_xlim`/`set_ylim` are wrapped to **record-then-delegate**. Replay verbatim → identical to the PNG. Calls **zero** library internals.
- No double-capture: the painter recorder routes its fills to its own `_RecAx`, so painter fills never reach the instrumented real Axes.

`RecordingFigure(Figure).__init__` stashes the `Figure` for enrichment + box/violin hover scale-inversion.

### Semantic hover (painter args / primitives lack identity)
- **Connectors** need `(leftCategory, rightCategory)`. k-th connector painter call == adjacent pair `(unibars[k], unibars[k+1])`; recover per-shape `(lv,rv)` by replicating `pairs.items()` order — `groupby([left,right,"color_index"]).size/sum` on `fig.data_df` (mirrors `figure.py` ~431-480), keep total>0, zip to shapes. Prefer regroup-from-`data_df` over call-order reliance.
- **Unibar rectangles** — match to `Value`s by `unibar_name` + `right_center` y ≈ `Value.vert_centre` (tol 1e-6); category = `Value.id`, counts = `Value.occ_by_colour`.
- **Box/violin** — derive hover from captured geometry (box rect → Q1/Q3, median line → median) and invert the y-scale to real units via `uni.range` + `uni.draw_y_start/end`.

### Defensive injection
Before patching, assert the target names exist and `FigureBase.plot` + the 6 primitives have expected signatures (`inspect`). On mismatch raise a clear "incompatible hammock_plot version" rather than a silently-wrong scene. Restore all patches (incl. `pyplot.subplots`) in `finally`. Run under `MPLBACKEND=Agg`; `plt.close('all')` in `finally`; capture `warnings.catch_warnings(record=True)`.

## Scene-Graph JSON = the insulation boundary
The **only** thing the frontend knows. Library internals never reach the UI except through `scene_builder`/`enrich`. Full shape is in the plan file (`~/.claude/plans/foamy-sauteeing-scone.md`); essentials:
- `coordinateSystem.{xRange,yRange,width,height}` — raw library data-coords; frontend sets plotly axis ranges to these → **no client-side geometry math** (library layout changes flow through transparently).
- `axes[]` — name, x (`pos_x`), dtype, displayType.
- `marks[]` — unified, drawn in `z` order; `type` ∈ `polygon|rect|line|marker`. polygons = connectors/unibars (one per color slice) + violin bodies; rects/lines/markers = box & violin internals (verbatim). Each carries style (`fill`/`face`/`edge`/`color`/`lw`/`alpha`) + stable `id` + optional `hover` (`kind`: connector→{leftAxis,leftCategory,rightAxis,rightCategory,count}; unibar→{axis,category,count}; box→{axis,median,q1,q3}).
- `labels[]` — text → plotly annotations. `warnings[]`, `meta`, `version`, `hammockPin`.
Stable `id`s later enable editor mode "a" (clicked mark → option delta).

## Resilience to upstream changes (the user's key worry)
**Decision: shim now, hook later.** Build on the in-app shim; once the scene contract settles, add an additive `to_scene()` export to `hammock_plot` and switch the backend to it (replaces internal coupling with a stable public API). Pixel-faithful capture already shrank coupling to: module names (`figure.Rectangle/Parallelogram`, `main.Figure`), `FigureBase.plot`→`ax.fill`, `pyplot.subplots` + the 6 primitives, and (box/violin hover only) `uni.range`/`draw_y_start/end`. No `_weighted_quantile`/`_prepare_*` dependency.
1. `hammock_plot` is a **git submodule pinned to a SHA** (`vendor/hammock_plot`, current ref `deae4c2`, bumped from `925520b` on 2026-05-31), installed `-e`. Bump = deliberate checkout + rerun golden tests. Expose the SHA from `GET /api/health`. **Note:** the `deae4c2` bump renamed the display-type strings (`rugplot→rug`, `bar chart→bar`, `stacked bar→stacked_bar`) — the frontend `optionsState.ts` display-type constants must track the library's accepted set or `/api/plot` 422s. (Library-internal attribute names the capture layer reads were unchanged.)
2. **Golden-scene test** (`backend/tests/test_golden_scene.py`): fixed dataset+option configs → assert Scene == stored golden (float tol) + smoke asserts (≥1 connector, ≥1 unibar, axis count == len(var), populated `customdata`). This is the tripwire. Regenerate goldens only behind `--update-golden` after human review.
3. All library-internal coupling lives in `backend/app/capture/` ONLY. Fix drift in one place.

## Frontend rendering notes
- Each `mark` → one plotly `scatter`, in `z` order: `polygon`/`rect`→`fill:'toself'` (rect = closed 5-pt path; outline-only if no face); `line`→`mode:'lines'`; `marker`→`mode:'markers'`. Hover via `text`/`customdata` + `hovertemplate` + `hoveron:'fills'` (proven per-polygon in the spike, one trace per hoverable mark; batch non-hover marks later for perf).
- `labels[]` → annotations; axis name annotations at bottom; `xaxis/yaxis.visible:false`, ranges = scene `coordinateSystem`; `scrollZoom` + pan.
- Box/violin are pixel-faithful marks (NOT native go.Box/go.Violin) — see `spike/spike3.py` for the exact mark→trace mapping. A `native` mode is a possible future toggle.
- Options GUI mirrors `../hammock-plot-webapp/hammock_settings.py` + `utils.py` exactly (full param set, presets, `/100` conversions for alpha/fills, omit highlight fields when off). `optionsToRequest.ts` is the analog of `utils.plot(...)`.
- Drag-reorder axes = reorder `var` + refetch (whole pipeline reused).

## Library API quick ref (`Hammock(df).plot(...)`)
Params to expose: `var, weights, value_order, numerical_var_levels, display_type` (rugplot|box|violin|stacked bar|bar chart), `missing, missing_placeholder, label, unibar, hi_var, hi_value, hi_box, hi_missing, colors, default_color, connector_color, uni_vfill, connector_fraction, uni_hfill, label_options, height, width, min_bar_height, alpha, shape` (rectangle|parallelogram), `same_scale, violin_bw_method`. Always pass `display_figure=False`. Data = pandas DataFrame. Deps incl. `scipy` (imported at module top for `gaussian_kde`).

## Deployment & concurrency
**Target: one Docker image on Google Cloud Run (free tier).** `Dockerfile` is multi-stage — node builds the SPA, then `python:3.13-slim` installs the backend (`-e ./vendor/hammock_plot` + `scipy`, which the pin's `pyproject.toml` omits) and serves both. `main.py` mounts the built SPA via `StaticFiles` at `/` **only when `FRONTEND_DIST` exists** (set in the image; absent in dev/test, where Vite serves the SPA and proxies `/api`). `/api/*` routes register before the mount, so they win.
- **Listen on `$PORT`** (Cloud Run sets it; default 8080), host `0.0.0.0`. `MPLBACKEND=Agg` in the image.
- **Pinned SHA in the container:** no git inside the image, so `version.py` reads `HAMMOCK_PIN` (env, set in the `Dockerfile`) first, then falls back to `git`/gitdir for local dev. Bump it in the `Dockerfile` when the submodule pin moves.
- **Capture is NOT concurrency-safe** (the user's deployed-webapp constraint): the shim patches **global** module state (`figure.Rectangle/Parallelogram`, `main.Figure`, `pyplot.subplots`) and Agg isn't thread-safe. Two captures in one process collide. → **Serialize each capture with a per-process lock**, run **Cloud Run concurrency=1 per instance**, and scale out by instances/worker processes, never threads.
- **Backend stays stateless** — the SPA sends `data + options` on every `/api/plot` call; no server-side dataset store (multi-user + horizontally scalable). Large-dataset object-storage upload is a later seam.
- Deploy: `git submodule update --init` (so the upload has the lib) → `gcloud run deploy --source .`. `.gcloudignore`/`.dockerignore` keep `.venv`/`node_modules`/`dist`/`.git`/`spike` out of the build.

## Dev commands (Windows / PowerShell)
- Backend: `$env:MPLBACKEND="Agg"; uvicorn app.main:app --reload --port 8000`
- Frontend: `npm run dev` (vite :5173, proxy `/api → :8000`)
- Tests: `pytest backend/tests/`
- `dev.ps1` launches both for hot-reload dev.
- **Single-process (prod-shape) locally:** `cd frontend; npm run build`, then run the backend — it auto-serves `frontend/dist` at `/`. One origin, no Vite.
- **Container:** `docker build -t hammock-webapp .` → `docker run -p 8080:8080 hammock-webapp` → open `http://localhost:8080`.

## Reference files
- READ-ONLY shim targets: `../../hammock_plot/hammock_plot/{shapes,figure,unibar,main}.py`.
- GUI control source of truth: `../hammock-plot-webapp/{hammock_settings,utils,upload_modify_df}.py`.
- Full plan: `~/.claude/plans/foamy-sauteeing-scone.md`.
