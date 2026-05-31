"""Request/response models for the plot API.

`PlotOptions` mirrors the `Hammock.plot(...)` parameter contract (main.py). M1
exposes the full set the engine needs to render any display type; the M2 GUI
binds the same fields. `display_figure`/`save_path` are intentionally absent —
the backend always captures headlessly and never writes files.

The backend is **stateless** (CLAUDE.md): the SPA ships `data` (parsed rows)
alongside `options` on every request, so there is no server-side dataset store.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class PlotOptions(BaseModel):
    # General
    var: list[str] = Field(..., min_length=1)
    weights: str | None = None
    value_order: dict[str, list[str]] | None = None
    numerical_var_levels: dict[str, int] | None = None
    display_type: dict[str, str] | None = None
    missing: bool = False
    missing_placeholder: str | None = None
    label: bool = True
    unibar: bool = True

    # Highlighting
    hi_var: str | None = None
    hi_value: Any | None = None
    hi_box: str | None = None
    hi_missing: bool = False
    colors: list[str] | None = None
    default_color: str | None = None
    connector_color: str | None = None

    # Layout
    uni_vfill: float | None = None
    connector_fraction: float | None = None
    uni_hfill: float | None = None
    label_options: dict[str, Any] | None = None
    height: float = 10
    width: float = 15
    min_bar_height: float | None = None
    alpha: float | None = None

    # Other
    shape: str = "rectangle"
    same_scale: list[str] | None = None
    violin_bw_method: float | str | None = None

    def to_plot_kwargs(self) -> dict[str, Any]:
        """Dict of plot() kwargs with unset (None) fields dropped, so the
        library's own defaults apply — matching `utils.plot(...)`."""
        return self.model_dump(exclude_none=True)


class PlotRequest(BaseModel):
    """Stateless plot request: rows + options ride together."""

    data: list[dict[str, Any]] = Field(..., min_length=1)
    options: PlotOptions

    @field_validator("data")
    @classmethod
    def _non_empty_rows(cls, v: list[dict]) -> list[dict]:
        if not v or not v[0]:
            raise ValueError("data must contain at least one non-empty row")
        return v
