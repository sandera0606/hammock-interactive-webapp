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
                    f"{lname}={lv} → {rname}={rv}<br>"
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


def _box_violin_hover(fig: Any, prims: list[dict]) -> dict:
    """Map prim `seq` -> hover payload for box/violin geometry."""
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
        stats = enrich.box_stats(bucket, invert)
        if not stats:
            continue
        hover = {"kind": "box", "axis": name, **stats}
        # Attach to the box rect and (for violins) the largest body polygon, so
        # hovering either the box or the violin envelope shows the stats.
        rects = [p for p in bucket if p["kind"] == "rect"]
        if rects:
            seq_hover[max(rects, key=lambda r: abs(r["y1"] - r["y0"]))["seq"]] = hover
        polys = [p for p in bucket if p["kind"] == "poly"]
        if polys:
            seq_hover[max(polys, key=lambda p: len(p["x"]))["seq"]] = hover
    return seq_hover


def _emit_instrument_marks(recorder: Any, fig: Any) -> list[dict]:
    """Box/violin bodies, rects, lines, fliers — replayed verbatim."""
    seq_hover = _box_violin_hover(fig, recorder.prims)
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
    marks += _emit_instrument_marks(recorder, fig)
    marks.sort(key=lambda m: m["z"])

    warnings_out = [str(w.message) for w in warning_msgs]

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
