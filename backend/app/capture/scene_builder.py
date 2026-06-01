"""Merge the two recorders' output into the Scene-Graph JSON.

The Scene-Graph is the *insulation boundary*: the only thing the frontend ever
sees of hammock_plot. Library internals reach the UI exclusively through here.
We assemble a unified `marks[]` (drawn in `z` order) from:

  * painter polygons  — connectors (z=10) + unibars (z=20), each one color
    slice, carrying semantic `hover`;
  * instrumentation   — box/violin bodies/rects/lines/fliers (z=30+captured),
    replayed verbatim, with box/violin hover derived in `enrich`;

plus `labels[]` (text -> annotations), `axes[]`, raw `coordinateSystem`
data-coords (so the frontend does zero geometry math), and metadata. Coordinate
ranges come from the captured `set_xlim/ylim` (falling back to the Figure's
scale), keeping the UI faithful to whatever layout the library produced.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from . import enrich

# z bands keep the visual stack faithful: connectors under unibars under
# box/violin internals (whose captured zorder fine-orders body<rect<lines).
_Z_CONNECTOR = 10
_Z_UNIBAR = 20
_Z_PRIM_BASE = 30

# Warning categories that are library/dependency-internal noise, not actionable
# feedback about the user's data or plot. Deprecation/Future/Pending warnings
# (e.g. pandas `is_categorical_dtype is deprecated`, emitted from hammock_plot's
# own code) are for *us* on a pin bump — they must not surface in the user-facing
# scene `warnings[]`. Everything else (UserWarning etc.) still passes through.
_INTERNAL_WARNING_CATEGORIES = (DeprecationWarning, FutureWarning, PendingDeprecationWarning)


def _user_facing_warnings(caught: list) -> list[str]:
    """User-relevant warning texts only; drop dependency deprecation noise."""
    out: list[str] = []
    seen: set[str] = set()
    for w in caught:
        if w.message is None:
            continue
        if isinstance(w.message, _INTERNAL_WARNING_CATEGORIES) or (
            isinstance(w.category, type)
            and issubclass(w.category, _INTERNAL_WARNING_CATEGORIES)
        ):
            continue
        text = str(w.message)
        if text not in seen:  # de-dupe identical messages (one per row otherwise)
            seen.add(text)
            out.append(text)
    return out


def _coordinate_system(recorder: Any, fig: Any) -> dict:
    xr = recorder.lims.get("x")
    yr = recorder.lims.get("y")
    if xr is None:
        xr = (0.0, float(getattr(fig, "scale_x", 0.0)))
    if yr is None:
        yr = (0.0, float(getattr(fig, "scale_y", 0.0)))
    return {
        "xRange": [xr[0], xr[1]],
        "yRange": [yr[0], yr[1]],
        "width": float(getattr(fig, "width", 0.0)),
        "height": float(getattr(fig, "height", 0.0)),
    }


def _axis_dtype(uni: Any) -> str:
    val_type = getattr(uni, "val_type", None)
    try:
        if val_type in (np.integer, np.floating):
            return "numerical"
    except TypeError:
        pass
    return "categorical"


def _build_axes(fig: Any) -> list[dict]:
    axes = []
    for u in getattr(fig, "unibars", []):
        axes.append(
            {
                "name": u.name,
                "x": float(u.pos_x),
                "dtype": _axis_dtype(u),
                "displayType": enrich.unibar_display_type(u),
            }
        )
    return axes


def _emit_painter_marks(recorder: Any, fig: Any, hi_label: str | None) -> list[dict]:
    """Connector + unibar polygons (semantic), one mark per color slice."""
    unibars = list(getattr(fig, "unibars", []))
    by_name = {u.name: u for u in unibars}
    marks: list[dict] = []
    connector_idx = 0

    for call in recorder.painter_calls:
        if call["layer"] == "unibar":
            uni = by_name.get(call["unibar_name"])
            for shape in call["shapes"]:
                cat = enrich.match_unibar_category(uni, shape["right_y"]) or "?"
                hover_text = (
                    f"{call['unibar_name']} = {cat}<br>"
                    f"{enrich.breakdown(shape['colors'], shape['weights'], hi_label)}"
                )
                for fi, f in enumerate(_visible_fills(shape)):
                    marks.append(
                        {
                            "id": f"uni:{call['unibar_name']}={cat}:s{fi}",
                            "type": "polygon",
                            "z": _Z_UNIBAR,
                            "fill": f["color"],
                            "alpha": call["alpha"],
                            "vertices": f["vertices"],
                            "hover": {
                                "kind": "unibar",
                                "axis": call["unibar_name"],
                                "category": cat,
                                "count": shape["count"],
                                "text": hover_text,
                            },
                        }
                    )
        else:  # connector
            li, ri = connector_idx, connector_idx + 1
            connector_idx += 1
            if ri >= len(unibars):
                continue
            lname, rname = unibars[li].name, unibars[ri].name
            order = enrich.replicate_pair_order(fig, lname, rname)
            if len(order) != len(call["shapes"]):
                order = [("?", "?")] * len(call["shapes"])
            for pair_idx, ((lv, rv), shape) in enumerate(zip(order, call["shapes"])):
                hover_text = (
                    f"{lname}={lv} & {rname}={rv}<br>"
                    f"{enrich.breakdown(shape['colors'], shape['weights'], hi_label)}"
                )
                for fi, f in enumerate(_visible_fills(shape)):
                    marks.append(
                        {
                            "id": f"conn:{li}:{lname}={lv}>{rname}={rv}:s{fi}",
                            "type": "polygon",
                            "z": _Z_CONNECTOR,
                            "fill": f["color"],
                            "alpha": call["alpha"],
                            "vertices": f["vertices"],
                            "hover": {
                                "kind": "connector",
                                "leftAxis": lname,
                                "leftCategory": str(lv),
                                "rightAxis": rname,
                                "rightCategory": str(rv),
                                "count": shape["count"],
                                "text": hover_text,
                            },
                        }
                    )
    return marks


def _visible_fills(shape: dict) -> list[dict]:
    """Drop white dividers + zero-area color slivers (library artifacts)."""
    out = []
    for f in shape["fills"]:
        if enrich.is_white(f["color"]) or enrich.polygon_area(f["vertices"]) < 1e-9:
            continue
        out.append(f)
    return out


def _box_violin_hover(fig: Any, prims: list[dict], hi_var: Any, hi_value: Any) -> dict:
    """Map prim `seq` -> hover payload for box/violin geometry.

    Highlighting draws one box per color group side-by-side on an axis. We split
    each unibar's prims into per-box groups (`enrich.split_box_groups`) so every
    box gets its own median/Q1–Q3 hover — not just the widest one — and label
    each box with its highlight group when more than one is present. The hover is
    attached to the box rect (the filled box for `display=box`) and to the
    nearest violin body polygon (the filled envelope for `display=violin`), so
    hovering either surface shows that box's stats.
    """
    buckets = enrich.bucket_prims_by_unibar(fig, prims)
    by_name = {u.name: u for u in getattr(fig, "unibars", [])}
    seq_hover: dict[int, dict] = {}

    for name, bucket in buckets.items():
        uni = by_name.get(name)
        if uni is None or not enrich.is_box_violin(uni):
            continue
        invert = enrich.make_inverter(uni)
        if invert is None:
            continue
        boxes = enrich.split_box_groups(bucket)
        polys = [p for p in bucket if p["kind"] == "poly"]
        multi = len(boxes) > 1
        uni_colors = list(getattr(uni, "colors", []) or [])
        box_centers: list[tuple[float, dict]] = []  # (center_x, hover)

        for box in boxes:
            rect = box["rect"]
            stats = enrich.box_stats([rect, *box["lines"]], invert)
            if not stats:
                continue
            hover = {"kind": "box", "axis": name, **stats}
            if multi:
                idx = enrich.color_group_index(rect.get("face") or rect.get("edge"), uni_colors)
                label = enrich.group_label(idx, hi_var, hi_value)
                if label:
                    hover["group"] = label
            seq_hover[rect["seq"]] = hover
            box_centers.append(((rect["x0"] + rect["x1"]) / 2.0, hover))

        # Attach each violin body polygon to the nearest box's hover (split
        # violins have one body per side; full violins have a single body). The
        # violin inner box is outline-only (face=None), so its group color lives
        # on the filled body polygon — derive the label from the poly here.
        for poly in polys:
            if not poly.get("x") or not box_centers:
                continue
            pcx = (min(poly["x"]) + max(poly["x"])) / 2.0
            _, hover = min(box_centers, key=lambda bc: abs(bc[0] - pcx))
            if multi and "group" not in hover:
                idx = enrich.color_group_index(poly.get("color"), uni_colors)
                label = enrich.group_label(idx, hi_var, hi_value)
                if label:
                    hover["group"] = label
            seq_hover[poly["seq"]] = hover
    return seq_hover


def _emit_instrument_marks(recorder: Any, fig: Any, hi_var: Any, hi_value: Any) -> list[dict]:
    """Box/violin bodies, rects, lines, fliers — replayed verbatim."""
    seq_hover = _box_violin_hover(fig, recorder.prims, hi_var, hi_value)
    marks: list[dict] = []
    for p in recorder.prims:
        z = _Z_PRIM_BASE + float(p.get("z", 0))
        hover = seq_hover.get(p["seq"])
        kind = p["kind"]
        if kind in ("fill", "poly"):
            if not p["color"]:
                continue
            mark = {
                "id": f"mark:{kind}:{p['seq']}", "type": "polygon", "z": z,
                "fill": p["color"], "alpha": 1.0,
                "vertices": [[x, y] for x, y in zip(p["x"], p["y"])],
            }
        elif kind == "rect":
            mark = {
                "id": f"mark:rect:{p['seq']}", "type": "rect", "z": z,
                "face": p["face"], "edge": p["edge"], "lw": p["lw"],
                "x0": p["x0"], "x1": p["x1"], "y0": p["y0"], "y1": p["y1"],
            }
        elif kind == "line":
            mark = {
                "id": f"mark:line:{p['seq']}", "type": "line", "z": z,
                "color": p["color"], "lw": p["lw"], "x": p["x"], "y": p["y"],
            }
        elif kind == "markers":
            mark = {
                "id": f"mark:markers:{p['seq']}", "type": "marker", "z": z,
                "color": p["color"], "size": p["size"], "x": p["x"], "y": p["y"],
            }
        else:  # pragma: no cover - unknown primitive
            continue
        if hover:
            mark["hover"] = hover
        marks.append(mark)
    return marks


def _build_labels(recorder: Any) -> list[dict]:
    return [
        {
            "x": t["x"], "y": t["y"], "text": t["s"], "size": t["size"],
            "color": t["color"], "ha": t["ha"], "va": t["va"], "rot": t["rot"],
        }
        for t in recorder.texts
    ]


def build_scene(
    recorder: Any,
    options: dict,
    warning_msgs: list,
    hammock_pin: dict | None,
) -> dict:
    """Assemble the full Scene-Graph from a completed capture."""
    fig = recorder.figure
    if fig is None:
        raise RuntimeError(
            "capture produced no Figure — hammock_plot.plot() did not run the "
            "instrumented draw path (check display_figure=False and the shim)."
        )

    hi_var = options.get("hi_var")
    hi_value = options.get("hi_value")
    hi_label = None
    if hi_var and hi_value:
        vals = hi_value if isinstance(hi_value, (list, tuple)) else [hi_value]
        hi_label = f"{hi_var}={', '.join(str(v) for v in vals)}"

    marks = _emit_painter_marks(recorder, fig, hi_label)
    marks += _emit_instrument_marks(recorder, fig, hi_var, hi_value)
    marks.sort(key=lambda m: m["z"])

    warnings_out = _user_facing_warnings(warning_msgs)

    return {
        "version": 1,
        "hammockPin": hammock_pin,
        "coordinateSystem": _coordinate_system(recorder, fig),
        "axes": _build_axes(fig),
        "marks": marks,
        "labels": _build_labels(recorder),
        "warnings": warnings_out,
        "meta": {
            "shape": options.get("shape", "rectangle"),
            "weighted": bool(getattr(fig, "weights", None)),
            "highlighted": bool(hi_label),
        },
    }
