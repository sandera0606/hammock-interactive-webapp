# hammock-plot-interactive-webapp

Interactive (plotly.js) frontend for the [`hammock_plot`](../../hammock_plot) library. Renders hover/zoom/pan hammock plots instead of static PNGs.

- **Why & what:** GOAL.md
- **How it works internally (architecture, capture shim, gotchas):** CLAUDE.md
- **Milestones & status:** ROADMAP.md

Deployed as a multi-user webapp: **one Docker image** (FastAPI serves the built SPA + API) on **Google Cloud Run** (free tier). The backend is stateless.

## Structure
```
backend/    FastAPI; capture shim turns hammock_plot's matplotlib geometry into Scene-Graph JSON
frontend/   Vite + React + TS; renders the Scene-Graph with plotly.js + the options GUI
vendor/hammock_plot   git submodule, SHA-pinned, installed editable (never edited)
Dockerfile  multi-stage: build the SPA, then one Python process serves SPA + /api (Cloud Run)
```

## Run (Windows / PowerShell)
```powershell
# backend
$env:MPLBACKEND="Agg"
uvicorn app.main:app --reload --port 8000   # from backend/, in its venv

# frontend (separate terminal)
npm run dev                                  # from frontend/, vite :5173 -> proxies /api to :8000
```
Tests: `pytest backend/tests/`

**Single process (prod shape), one origin:** `cd frontend && npm run build`, then start the backend — it auto-serves `frontend/dist` at `/`. Open http://localhost:8000.

## Deploy (Cloud Run)
```powershell
git submodule update --init        # ensure vendor/hammock_plot is present in the upload
docker build -t hammock-webapp .   # local check (serves on :8080)
gcloud run deploy --source .       # build + deploy; returns a live URL
```
One image serves the SPA and `/api`; it listens on `$PORT`. Cloud Run's free tier scales to zero (first hit after idle pays the matplotlib cold-start). Bump `HAMMOCK_PIN` in the `Dockerfile` when the submodule pin changes. Run Cloud Run with **concurrency=1 per instance** — the capture shim serializes per process. See CLAUDE.md "Deployment & concurrency".

## How it works (one paragraph)
The backend monkey-patches recording subclasses into `hammock_plot` at call time, runs `plot(display_figure=False)` headless, and captures the computed polygon geometry + semantic metadata into a **Scene-Graph JSON** (the stable contract). The React frontend renders that JSON as interactive plotly traces with hover tooltips. The library is never modified; it's SHA-pinned and guarded by a golden-scene test. Details in CLAUDE.md.
