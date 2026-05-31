"""FastAPI backend for the interactive hammock webapp.

M0 scaffolding: only GET /api/health, which surfaces the pinned hammock_plot
SHA and whether the library imports — the install/version tripwire that later
milestones (engine, scene capture) build on top of.
"""
from __future__ import annotations

import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .version import get_hammock_pin

app = FastAPI(title="hammock-plot-interactive", version="0.0.0")

# Dev frontend runs on Vite (:5173). The Vite proxy makes same-origin calls in
# practice, but allow the direct origin too for standalone testing.
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
