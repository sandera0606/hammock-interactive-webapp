# Roadmap

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done. Technical detail for each item is in CLAUDE.md; this is the sequencing + checklist.

## Spikes (DONE)
- [x] `spike.py` — painter recorder + enrich + per-polygon hover (asthma + highlight)
- [x] `spike2.py` — native go.Box/go.Violin (rejected after `compare2.html`)
- [x] `spike3.py` — **pixel-faithful** box/violin via Axes instrumentation (chosen; `compare3.html`)
- [x] Decisions locked: box/violin = pixel-faithful default; resilience = shim now, hook later

## M0 — Scaffolding
- [ ] Repo layout (`backend/`, `frontend/`, `vendor/`)
- [ ] `hammock_plot` as git submodule pinned to SHA `925520b`, `-e` install
- [ ] FastAPI skeleton; `GET /api/health` returns the pinned SHA
- [ ] Vite + React + TS skeleton with `/api` proxy → :8000
- [ ] Confirm `Hammock(df).plot(display_figure=False)` runs headless under `MPLBACKEND=Agg` from the backend

## M1 — Engine (lift spikes into backend)
- [ ] `RecordingRectangle/Parallelogram` (painter recorder) + Axes instrumentation (`pyplot.subplots` patch, 6 primitives) + `RecordingFigure`
- [ ] `scene_capture` context manager (all patches; defensive signature asserts; restore in `finally`)
- [ ] `enrich.py` — connector `(left/rightCategory)` via regroup of `fig.data_df`; unibar category via `Value` matching; box/violin hover via geometry + scale-inversion
- [ ] `scene_builder.py` — merge semantic polygons + faithful marks + labels → unified `marks[]` Scene-Graph
- [ ] `POST /api/plot` returns a Scene (one categorical + one numeric/box/violin dataset)
- [ ] Frontend renders `marks[]` + labels; **hover works**; **box/violin match the library PNG**; zoom/pan
- [ ] First golden-scene test green
- **Exit:** categorical + numeric datasets interactive; box/violin pixel-faithful; correct hover

## M2 — Full options GUI ("b")
- [ ] Pydantic `PlotOptions` (every `plot()` param) + `optionsToRequest.ts`
- [ ] `POST /api/data/upload` (dtype + weight-var inference), `GET /api/datasets`, sample loader, preview table
- [ ] Option tabs mirroring `hammock_settings.py`: Presets, Variables, General, Highlighting, Weights, Unibar-Specific
- [ ] Highlighting / weights / value_order / missing / same_scale / shape / label_options end-to-end
- [ ] `/api/validate-expression` (reuse library `validate_expression`)
- [ ] Debounced auto-replot + explicit Apply; keep last good scene while recomputing
- [ ] All display types end-to-end: rugplot / stacked bar / bar chart / box / violin / beanplots (all captured already)
- [ ] Golden tests extended (snapshot + numeric/box/violin configs)
- **Exit:** visual parity with the Streamlit app for matching settings

## M3 — Polish + stretch
- [ ] Drag-to-reorder axes (`@dnd-kit`) → reorder `var` → refetch
- [ ] Warnings toasts, export (PNG/SVG/HTML), loading/error/empty states
- [ ] Perf pass: trace batching, debounce tuning, in-flight cancellation
- [ ] (Optional) `native` box/violin toggle (go.Box/go.Violin, per `spike2.py`)

## Upstream hook (after contract settles)
- [ ] Add additive `to_scene()` export to `hammock_plot` (no behavior change); switch backend to call it → stable public API instead of internal coupling.

## Future — editor mode "a"
Direct-manipulation canvas. Plugs into the existing engine: stable mark `id`s + semantic metadata let canvas edits map to `PlotOptions` deltas (drag category → `value_order`; recolor → `colors`; reorder axes → `var`) and refetch. Arbitrary per-mark nudges → client-side override layer keyed on `id`. No new capture work.
