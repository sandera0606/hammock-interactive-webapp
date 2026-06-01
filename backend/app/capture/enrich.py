"""Recover the semantic identity that painter args / raw primitives lack.

The capture layer records geometry faithfully but anonymously: a painter call
is "the k-th connector", a `broken_barh` is "a rectangle at x≈42". This module
re-attaches meaning by mirroring the library's own bookkeeping (validated in
`spike/spike.py`):

  * connectors  — the k-th connector painter call is the adjacent pair
    (unibars[k], unibars[k+1]); per-shape `(leftCategory, rightCategory)` is
    recovered by replicating the library's `pairs.items()` order
    (groupby([left, right, "color_index"]) on `fig.data_df`, keep total>0).
  * unibars     — match a shape to its `Value` by `right_center` y ≈
    `Value.vert_centre` (tol 1e-6); category = `Value.id`.
  * box/violin  — invert the captured y-scale (`uni.range` + draw_y_start/end)
    back to real units, and read Q1/Q3 off the box rect, median off the line.

Everything here is read-only against the live `Figure`; it computes hover
payloads, never geometry.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Callable

import numpy as np
from matplotlib.colors import to_rgb

_BOX_VIOLIN_TYPES = {"box", "violin", "lumpy beanplot", "spiky beanplot"}


def is_white(color: Any) -> bool:
    """White divider bars carry no data — drop them from the scene."""
    try:
        r, g, b = to_rgb(color)
    except (ValueError, TypeError):
        return False
    return min(r, g, b) > 0.9


def polygon_area(verts: list[list[float]]) -> float:
    """Shoelace area; used to drop zero-weight color slivers."""
    a = 0.0
    n = len(verts)
    for i in range(n):
        x1, y1 = verts[i]
        x2, y2 = verts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def replicate_pair_order(fig: Any, left_name: str, right_name: str) -> list[tuple]:
    """Reproduce the order in which the library emits connector shapes.

    Mirrors figure.py `draw_connections`: group `data_df` by
    (left, right, color_index), fold colors into a per-pair total in first-seen
    order, and keep pairs with total flow > 0 — exactly the painter call order.
    """
    weight_col = fig.weights
    df = fig.data_df
    if weight_col is None:
        grouped = df.groupby([left_name, right_name, "color_index"], observed=True).size().to_dict()
    else:
        grouped = (
            df.groupby([left_name, right_name, "color_index"], observed=True)[weight_col]
            .sum()
            .to_dict()
        )
    pairs: "OrderedDict[tuple, float]" = OrderedDict()
    for (lv, rv, _ci), cnt in grouped.items():
        pairs[(lv, rv)] = pairs.get((lv, rv), 0.0) + float(cnt)
    return [(lv, rv) for (lv, rv), total in pairs.items() if total > 0]


def breakdown(colors: list, weights: list[float], hi_label: str | None) -> str:
    """Per-highlight-group count breakdown for a shape's hover."""
    if len(colors) <= 1:
        return f"count: {weights[0]:g}"
    parts = []
    if weights[0] > 0:
        parts.append(f"other: {weights[0]:g}")
    hi = f"highlighted ({hi_label})" if hi_label else "highlighted"
    for k in range(1, len(colors)):
        if k < len(weights) and weights[k] > 0:
            parts.append(f"{hi}: {weights[k]:g}")
    return "<br>".join(parts) if parts else "count: 0"


def match_unibar_category(uni: Any, right_y: float, tol: float = 1e-6) -> str | None:
    """Category id for a unibar shape, by y ≈ Value.vert_centre."""
    if uni is None or not getattr(uni, "values", None):
        return None
    val = min(uni.values, key=lambda v: abs(float(v.vert_centre) - right_y))
    if abs(float(val.vert_centre) - right_y) < tol:
        return str(val.id)
    return None


def make_inverter(uni: Any) -> Callable[[float], float] | None:
    """Return y(draw-coords) -> real value for a numeric unibar, or None.

    Inverts `_prepare_scaled_data.scale_y`:
        y = y_start + (val-min)/(max-min) * (y_end-y_start)
    using `uni.range` (or the unibar's own numeric span) + draw_y_start/end.
    """
    non_missing = getattr(uni, "non_missing_vals", None)
    if not non_missing:
        return None
    nums = [v.numeric for v in non_missing if getattr(v, "numeric", None) is not None]
    if not nums:
        return None
    rng = getattr(uni, "range", None)
    min_val, max_val = rng if rng else (min(nums), max(nums))
    y_start = float(getattr(uni, "draw_y_start", 0.0))
    y_end = float(getattr(uni, "draw_y_end", 0.0))
    if y_end == y_start:
        return None
    span_val = float(max_val) - float(min_val)
    span_y = y_end - y_start

    def invert(y: float) -> float:
        return float(min_val) + (y - y_start) / span_y * span_val

    return invert


def bucket_prims_by_unibar(fig: Any, prims: list[dict], tol_frac: float = 0.6) -> dict:
    """Group instrumentation primitives by the unibar they were drawn at.

    Box/violin internals draw near `uni.pos_x`. Assign each primitive to the
    nearest unibar within `tol_frac * unibar_width` of its center-x.
    """
    unibars = list(getattr(fig, "unibars", []))
    width = float(getattr(fig, "unibar_width", 0.0)) or 1.0
    tol = max(width * tol_frac, 1.0)
    buckets: dict[str, list[dict]] = {u.name: [] for u in unibars}

    def center_x(p: dict) -> float | None:
        if p["kind"] == "rect":
            return (p["x0"] + p["x1"]) / 2.0
        if p.get("x"):
            xs = p["x"]
            return (min(xs) + max(xs)) / 2.0
        return None

    for p in prims:
        cx = center_x(p)
        if cx is None:
            continue
        nearest = min(unibars, key=lambda u: abs(float(u.pos_x) - cx), default=None)
        if nearest is not None and abs(float(nearest.pos_x) - cx) <= tol:
            buckets[nearest.name].append(p)
    return buckets


def _parse_css_rgb(css: Any) -> tuple[int, int, int] | None:
    """Parse a recorder "rgba(r,g,b,a)" string back to integer rgb (alpha dropped)."""
    if not isinstance(css, str) or not css.startswith("rgba("):
        return None
    try:
        parts = css[css.index("(") + 1 : css.index(")")].split(",")
        return (int(float(parts[0])), int(float(parts[1])), int(float(parts[2])))
    except (ValueError, IndexError):
        return None


def color_group_index(css: Any, uni_colors: list, tol: int = 3) -> int | None:
    """Index of a captured box color within `uni.colors` (= [default, hi1, hi2…]).

    The library builds `colors = [default_color] + highlight_colors` (main.py),
    so index 0 is the non-highlighted group and index k≥1 is the k-th highlight
    value. Matching on the rendered rgb (not draw order) is robust to the
    `rotate_left` the box/violin code applies. Returns None if no color matches.
    """
    rgb = _parse_css_rgb(css)
    if rgb is None or not uni_colors:
        return None
    for idx, c in enumerate(uni_colors):
        try:
            lr, lg, lb = (int(v * 255) for v in to_rgb(c))
        except (ValueError, TypeError):
            continue
        if abs(lr - rgb[0]) <= tol and abs(lg - rgb[1]) <= tol and abs(lb - rgb[2]) <= tol:
            return idx
    return None


def group_label(idx: int | None, hi_var: Any, hi_value: Any) -> str | None:
    """Human label for a box's highlight group: 'other' for idx 0, the matched
    highlight value for idx≥1. Returns None when the group can't be identified."""
    if idx is None:
        return None
    if idx == 0:
        return "other"
    vals = list(hi_value) if isinstance(hi_value, (list, tuple)) else [hi_value]
    v = vals[idx - 1] if 0 <= idx - 1 < len(vals) else None
    if v is None:
        return "highlighted"
    return f"{hi_var} = {v}" if hi_var else f"highlighted ({v})"


def split_box_groups(bucket: list[dict]) -> list[dict]:
    """Partition one unibar's box/violin prims into one group per drawn box.

    Highlighting makes `_draw_boxplot`/`_draw_violin` emit N side-by-side boxes,
    each a `broken_barh` rect with its own median/whisker/cap lines stacked over
    the same x-span. Each rect defines a box; a line is assigned to the rect
    whose x-span contains the line's x-center (boxes never overlap in x). Returns
    `[{"rect": <rect prim>, "lines": [<line prims>]}, …]`, one per box.
    """
    rects = [p for p in bucket if p["kind"] == "rect"]
    if not rects:
        return []
    groups = [{"rect": r, "lines": []} for r in rects]

    def owner(cx: float) -> dict | None:
        inside = [
            g for g in groups
            if g["rect"]["x0"] - 1e-9 <= cx <= g["rect"]["x1"] + 1e-9
        ]
        if not inside:
            return None
        return min(inside, key=lambda g: abs((g["rect"]["x0"] + g["rect"]["x1"]) / 2 - cx))

    for p in bucket:
        if p["kind"] != "line" or not p.get("x"):
            continue
        cx = (min(p["x"]) + max(p["x"])) / 2.0
        g = owner(cx)
        if g is not None:
            g["lines"].append(p)
    return groups


def box_stats(bucket: list[dict], invert: Callable[[float], float]) -> dict | None:
    """Derive {median, q1, q3} in real units from a box/violin's primitives.

    The box rect (broken_barh) spans Q1..Q3 in draw coords; the horizontal
    median line sits at the median. Inverted back to data units for hover.
    """
    rects = [p for p in bucket if p["kind"] == "rect"]
    if not rects:
        return None
    # Largest rect = the box body (inner violin boxes are tiny).
    rect = max(rects, key=lambda r: abs(r["y1"] - r["y0"]))
    q1, q3 = sorted((invert(rect["y0"]), invert(rect["y1"])))

    median = None
    h_lines = [
        p for p in bucket
        if p["kind"] == "line" and len(p["y"]) == 2 and abs(p["y"][0] - p["y"][1]) < 1e-9
    ]
    if h_lines:
        # median line spans the box width; pick the one whose y is within the rect.
        inside = [ln for ln in h_lines if rect["y0"] - 1e-6 <= ln["y"][0] <= rect["y1"] + 1e-6]
        chosen = inside[0] if inside else h_lines[0]
        median = invert(chosen["y"][0])

    stats = {"q1": round(q1, 6), "q3": round(q3, 6)}
    if median is not None:
        stats["median"] = round(median, 6)
    return stats


def unibar_display_type(uni: Any) -> str:
    return str(getattr(uni, "display_type", "rugplot"))


def is_box_violin(uni: Any) -> bool:
    return unibar_display_type(uni) in _BOX_VIOLIN_TYPES
