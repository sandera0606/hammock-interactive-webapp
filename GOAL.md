# Goal

Build a webapp that wraps the `hammock_plot` Python library and produces **interactive** hammock plots (hover, zoom/pan, drag) instead of the library's static matplotlib PNGs.

## Problem
- Core lib (`../../hammock_plot`) is pure matplotlib → static images only.
- Existing Streamlit app (`../hammock-plot-webapp`) exposes ~every option but still only renders PNGs. Interactivity is the missing piece users actually want.

## What we're building
A shared **interactive rendering engine** + UIs on top:
- **Engine** (build first): capture the library's computed geometry non-invasively, emit a Scene-Graph JSON, render it with plotly.js.
- **Mode "b" — options GUI** (build second): slick React UI mirroring every `plot()` parameter (the Streamlit app's full control set).
- **Mode "a" — editor** (future): direct-manipulation canvas that maps edits → option deltas. Reuses the engine; see ROADMAP.

## Locked decisions
- Stack: **React + FastAPI + plotly.js** (plotly.js is free/MIT). Slicker than Streamlit.
- **Never edit `hammock_plot`.** Capture geometry via a monkey-patch shim in our backend; stay resilient to upstream changes via SHA-pinning + golden tests. See CLAUDE.md.
- Interactivity priority: **hover tooltips first**, zoom/pan free, **drag-to-reorder axes = stretch**.
- **This is a deployed, multi-user webapp** (not a local tool). Ships as **one Docker image** (FastAPI serves the built SPA + the API) on **Google Cloud Run** (free tier; scales to zero). The backend is **stateless** — the frontend sends data + options with each plot request — so it scales horizontally. See CLAUDE.md "Deployment & concurrency".

## Success criteria
- M1: one dataset renders interactively with correct hover on connectors + unibars.
- M2: full options GUI reaches visual parity with the Streamlit app for the same settings.
- Engine stays correct when `hammock_plot` is upgraded (golden test is the tripwire).

## Out of scope (v1)
- Native plotly `go.Box`/`go.Violin` mode (a possible future toggle). Default box/violin are **pixel-faithful** — captured via Axes instrumentation to look exactly like the library (proven in `spike/spike3.py` / `compare3.html`).
- **Auth / accounts** and server-side persistence of user data. The webapp is multi-user but anonymous: datasets live client-side and ride along on each request (stateless backend). Object-storage upload for large datasets is a later seam.
