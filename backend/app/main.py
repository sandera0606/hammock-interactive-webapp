"""FastAPI backend for the interactive hammock webapp.

M0 scaffolding: GET /api/health surfaces the pinned hammock_plot SHA and whether
the library imports — the install/version tripwire that later milestones (engine,
scene capture) build on top of.

Deployment: one process serves both. When a built frontend exists (in the Docker
image, or after `vite build` locally), it is mounted at `/` via StaticFiles so a
single Cloud Run container serves the SPA and the API. In dev there is no build,
so nothing is mounted and Vite's dev server proxies /api here instead.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .capture import IncompatibleHammockVersion, capture_scene
from .schemas import PlotRequest
from .version import get_hammock_pin

# version.py -> app -> backend -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "vendor" / "hammock_plot" / "data"

# Bundled sample datasets so the SPA has data to round-trip through the
# stateless /api/plot. M2 replaces/extends this with real upload + inference.
SAMPLES: dict[str, dict] = {
    "asthma": {
        "label": "Asthma (categorical)",
        "csv": "data_asthma.csv",
        "defaults": {
            "var": ["group", "gender", "comorbidities"],
            "hi_var": "gender",
            "hi_value": ["female"],
        },
    },
    "penguins": {
        "label": "Penguins (box + violin)",
        "csv": "data_penguins.csv",
        "dropna": ["species", "bill_length_mm", "flipper_length_mm"],
        "defaults": {
            "var": ["species", "bill_length_mm", "flipper_length_mm"],
            "display_type": {"bill_length_mm": "box", "flipper_length_mm": "violin"},
        },
    },
}

app = FastAPI(title="hammock-plot-interactive", version="0.0.0")

# Dev frontend runs on Vite (:5173). The Vite proxy makes same-origin calls in
# practice, but allow the direct origin too for standalone testing. In the
# single-process deployment the SPA is same-origin, so CORS is moot there.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _hammock_importable() -> bool:
    try:
        import hammock_plot  # noqa: F401
        return True
    except Exception:
        return False


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "hammockPin": get_hammock_pin(),
        "hammockImportable": _hammock_importable(),
        "python": sys.version,
    }


@app.get("/api/samples")
def list_samples() -> list[dict]:
    return [{"name": k, "label": v["label"]} for k, v in SAMPLES.items()]


@app.get("/api/samples/{name}")
def get_sample(name: str) -> dict:
    """Return a bundled dataset's rows + a sensible default option config.

    The SPA keeps these rows and ships them back on each /api/plot call, so the
    backend stays stateless (no server-side dataset store).
    """
    sample = SAMPLES.get(name)
    if sample is None:
        raise HTTPException(status_code=404, detail=f"unknown sample: {name}")
    df = pd.read_csv(DATA_DIR / sample["csv"])
    if sample.get("dropna"):
        df = df.dropna(subset=sample["dropna"]).reset_index(drop=True)
    # NaN -> None so the JSON is valid (NaN is not valid JSON).
    data = df.where(pd.notnull(df), None).to_dict(orient="records")
    return {
        "name": name,
        "label": sample["label"],
        "columns": list(df.columns),
        "data": data,
        "defaults": sample["defaults"],
    }


@app.post("/api/plot")
def plot(req: PlotRequest) -> dict:
    """Run hammock_plot headlessly and return the Scene-Graph for the frontend.

    Stateless: the request carries both the data rows and the options. The
    capture is serialized process-wide (see `scene_capture`), so deploy with
    Cloud Run concurrency=1 and scale by instances, not threads.
    """
    df = pd.DataFrame(req.data)
    missing_vars = [v for v in req.options.var if v not in df.columns]
    if missing_vars:
        raise HTTPException(
            status_code=422,
            detail=f"variables not found in data: {missing_vars}",
        )
    try:
        return capture_scene(df, req.options.to_plot_kwargs(), get_hammock_pin())
    except IncompatibleHammockVersion as exc:
        # The shim's tripwire fired: the vendored library drifted from what the
        # capture layer assumes. Surface it as a server-config error, not a 500.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ValueError, KeyError, TypeError) as exc:
        # Bad option combination / data shape the library rejected.
        raise HTTPException(status_code=422, detail=f"plot failed: {exc}") from exc


# Serve the built SPA last so /api/* routes above take precedence. Only mount if
# a build exists — absent in dev/test (Vite serves the SPA then), present in the
# Docker image. FRONTEND_DIST lets the image point at its copy location.
_frontend_dist = Path(os.environ.get("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="spa")
