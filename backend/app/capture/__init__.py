"""Capture shim package — the anti-corruption layer over hammock_plot.

`capture_scene(df, options)` is the one public entry: it runs the library's
real `Hammock(df).plot(..., display_figure=False)` inside the recording context
manager and returns the Scene-Graph dict. Everything coupling to library
internals lives in this package and nowhere else (CLAUDE.md), so upstream drift
is fixed in exactly one place.
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from .errors import IncompatibleHammockVersion
from .recorder import scene_capture
from .scene_builder import build_scene

__all__ = ["capture_scene", "IncompatibleHammockVersion"]


def capture_scene(
    df: pd.DataFrame,
    options: dict[str, Any],
    hammock_pin: dict | None = None,
) -> dict:
    """Run hammock_plot headlessly and return the Scene-Graph for the frontend.

    `options` is a plain dict of `Hammock.plot` kwargs (already None-pruned by
    the caller). `display_figure` is forced False — we never want the library to
    show or save anything; we only record what it draws.
    """
    import hammock_plot

    plot_kwargs = {k: v for k, v in options.items() if v is not None}
    plot_kwargs["display_figure"] = False
    shape = plot_kwargs.get("shape", "rectangle")

    with scene_capture(shape=shape) as (recorder, caught):
        hammock_plot.Hammock(df).plot(**plot_kwargs)

    return build_scene(recorder, options, caught, hammock_pin)
