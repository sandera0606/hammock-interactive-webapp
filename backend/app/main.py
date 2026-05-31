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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .version import get_hammock_pin

# version.py -> app -> backend -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]

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


# Serve the built SPA last so /api/* routes above take precedence. Only mount if
# a build exists — absent in dev/test (Vite serves the SPA then), present in the
# Docker image. FRONTEND_DIST lets the image point at its copy location.
_frontend_dist = Path(os.environ.get("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="spa")
