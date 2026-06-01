# Roadmap

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done. Technical detail for each item is in CLAUDE.md; this is the sequencing + checklist.

## Spikes (DONE)
- [x] `spike.py` — painter recorder + enrich + per-polygon hover (asthma + highlight)
- [x] `spike2.py` — native go.Box/go.Violin (rejected after `compare2.html`)
- [x] `spike3.py` — **pixel-faithful** box/violin via Axes instrumentation (chosen; `compare3.html`)
- [x] Decisions locked: box/violin = pixel-faithful default; resilience = shim now, hook later

## M0 — Scaffolding (DONE)
- [x] Repo layout (`backend/`, `frontend/`, `vendor/`)
- [x] `hammock_plot` as git submodule pinned to SHA `deae4c2` (bumped from `925520b` on 2026-05-31), `-e` install. (`deae4c2`'s `pyproject.toml` now declares `scipy`; `backend/requirements.txt` also lists it explicitly so it's pinned independently of submodule bumps.)
- [x] FastAPI skeleton; `GET /api/health` returns the pinned SHA (`HAMMOCK_PIN` env override for containers without git)
- [x] Vite + React + TS skeleton with `/api` proxy → :8000; health page renders the pin
- [x] Confirm `Hammock(df).plot(display_figure=False)` runs headless under `MPLBACKEND=Agg` from the backend
- [x] Single-process serve mode: FastAPI mounts the built SPA via `StaticFiles` when present
- [x] `Dockerfile` (multi-stage: build SPA → python serves SPA+API) + `.dockerignore`/`.gcloudignore` for Cloud Run

## M1 — Engine (lift spikes into backend)
- [x] `RecordingRectangle/Parallelogram` (painter recorder) + Axes instrumentation (`pyplot.subplots` patch, 6 primitives) + `RecordingFigure` — `backend/app/capture/recorder.py` (`SceneRecorder` owns all buffers; no module globals)
- [x] `scene_capture` context manager (all patches; defensive signature asserts via `inspect`; restore in `finally`; `plt.close('all')`; `warnings.catch_warnings`). **Serialized with a per-process `threading.Lock`** — patches global module state and Agg isn't thread-safe. Scale via worker processes / Cloud Run instances, not threads.
- [x] `enrich.py` — connector `(left/rightCategory)` via regroup of `fig.data_df`; unibar category via `Value.vert_centre` matching; box/violin hover via geometry + scale-inversion (`uni.range` + `draw_y_start/end`)
- [x] `scene_builder.py` — merge semantic polygons (z=10 connectors / z=20 unibars) + faithful marks (z=30+captured) + labels → unified `marks[]` Scene-Graph, sorted by z
- [x] `POST /api/plot` returns a Scene (stateless: SPA ships data+options). Bonus: `GET /api/samples[/{name}]` serves bundled asthma (categorical) + penguins (box/violin) so the SPA has data to round-trip
- [x] Frontend renders `marks[]` + labels (`lib/sceneToTraces.ts` → plotly via thin `HammockPlot` wrapper over `plotly.js-dist-min`); hover wired (`hoveron:'fills'` + hovertemplate); zoom/pan/scrollZoom. **Visual confirm of box/violin-vs-PNG + hover is the user's step (run `dev.ps1`)** — rendering mirrors the confirmed `compare3.html` mapping.
- [x] First golden-scene test green — `backend/tests/test_golden_scene.py` (float-tol deep compare vs stored goldens + smoke asserts; `--update-golden` to regenerate). 11/11 backend tests pass.
- **Exit:** categorical + numeric datasets interactive; box/violin pixel-faithful; correct hover — engine + API + golden tests done; **awaiting user's browser confirmation of the render.**

## M2 — Full options GUI ("b")
- [x] Pydantic `PlotOptions` (every `plot()` param) + `optionsToRequest.ts` (the analog of `utils.plot(...)`: `/100` fill/alpha conversions, omit highlight fields when off) — `frontend/src/lib/{defaults,optionsState,optionsToRequest}.ts`
- [x] `POST /api/data/upload` (CSV sent as text → dtype + weight-var inference via `backend/app/data_inference.py`), sample loader (now returns `meta`), preview table — **stateless**: parsed data returns to the client and rides along on each `/api/plot` request (no server-side dataset store). Large-dataset object-storage upload is a later seam.
- [x] Options GUI — **design-led, not a Streamlit clone** (user's call): plot-as-hero split layout, data-first column chips with dtype glyphs, presets segmented control, progressive-disclosure sections (Variables · Appearance · Highlighting · Weights · Advanced) with reveal-on-enable, per-variable settings in context. Same control set/semantics as `hammock_settings.py`. "Scientific studio" theme (Fraunces/Hanken Grotesk/IBM Plex Mono; warm paper + plum accent; native controls, no new deps).
- [x] Highlighting / weights / value_order / missing / same_scale / shape / label_options end-to-end
- [x] `/api/validate-expression` (reuses library `validate_expression` via `backend/app/validation.py`); wired to the highlight expression field (debounced)
- [x] Debounced auto-replot (~400ms) + explicit Apply + Auto-update toggle; keep last good scene while recomputing
- [x] All display types end-to-end: rugplot / stacked bar / bar chart / box / violin (golden-tested)
- [x] Golden tests extended: `asthma_bar`, `asthma_snapshot`, `penguins_rug`, `penguins_expr_highlight` (32/32 backend tests pass)
- **Exit:** visual parity with the Streamlit app for matching settings — engine/API/tests done; **awaiting user's browser confirmation of the GUI** (run `dev.ps1`, or `uvicorn app.main:app` to serve the built SPA at `:8000`).

## M3 — Polish + stretch
- [ ] Drag-to-reorder axes (`@dnd-kit`) → reorder `var` → refetch
- [ ] Warnings toasts, export (PNG/SVG/HTML), loading/error/empty states
- [ ] Loading bar / progress indicator during plot capture — cold-start instances pay the ~3–8s matplotlib import (concurrency=1 → each new user may wait on a fresh instance), so a visible progress bar matters for perceived latency, not just the current "Rendering…" text overlay
- [ ] Perf pass: trace batching, debounce tuning, in-flight cancellation
- [ ] (Optional) `native` box/violin toggle (go.Box/go.Violin, per `spike2.py`)

## Deployment — Cloud Run (free tier)
Target: **one Docker image**, FastAPI serves the built SPA + API, on **Google Cloud Run** (scales to zero → free at low traffic). Image build pipeline is done (M0); the rest lands alongside M1.
- [x] `Dockerfile` + single-process serve mode + ignore files (M0)
- [ ] First deploy: `gcloud run deploy --source .` → live URL; verify `/` (SPA) and `/api/health` (pin + importable). Submodule must be `--init`'d so it's in the upload.
- [ ] Concurrency safety in the deployed app: serialized capture lock (see M1) verified under parallel requests; set Cloud Run **concurrency=1 per instance** (each capture owns the process) and let Cloud Run scale out instances.
- [ ] Cold-start note: free tier scales to zero → first hit pays the matplotlib import (~3–8s). Add a **min-instance=1** only if/when latency matters (leaves the free tier).
- [ ] Bump `HAMMOCK_PIN` in the `Dockerfile` whenever the submodule pin changes (container has no git; golden test is the tripwire).

## Upstream hook (after contract settles)
- [ ] Add additive `to_scene()` export to `hammock_plot` (no behavior change); switch backend to call it → stable public API instead of internal coupling.

## Future — editor mode "a"
Direct-manipulation canvas. Plugs into the existing engine: stable mark `id`s + semantic metadata let canvas edits map to `PlotOptions` deltas (drag category → `value_order`; recolor → `colors`; reorder axes → `var`) and refetch. Arbitrary per-mark nudges → client-side override layer keyed on `id`. No new capture work.
