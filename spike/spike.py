"""
Risk-retiring spike for the interactive hammock webapp.

Proves the two make-or-break risks BEFORE building anything:
  RISK A  Non-invasive capture: let hammock_plot's REAL drawing code run, and
          intercept its actual `ax.fill(...)` calls (the final, correctly-ordered,
          already color-sliced polygons) plus the semantic context. We add ZERO
          geometry/slicing logic of our own and never edit the library -> we are
          a pure wrapper over the library's own rendering.
  RISK B  Interactive hover: render the captured polygons with plotly.js so each
          shape shows its own hover tooltip with a highlight breakdown.

Run:  python spike/spike.py
Output: spike/scene.json , spike/spike.html  (open the html; hover over boxes)
Console prints PASS/FAIL assertions that verify capture correctness.
"""

import os
import sys
import json
import html
from collections import OrderedDict

# headless matplotlib BEFORE importing the library (it imports pyplot at top)
import matplotlib
matplotlib.use("Agg")
from matplotlib.colors import to_rgb

HERE = os.path.dirname(os.path.abspath(__file__))
HAMMOCK_REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "hammock_plot"))
DATA_CSV = os.path.join(HAMMOCK_REPO, "data", "data_asthma.csv")
sys.path.insert(0, HAMMOCK_REPO)

import pandas as pd
import hammock_plot
import hammock_plot.figure as figmod
import hammock_plot.main as mainmod
from hammock_plot.shapes import Rectangle, Parallelogram

VAR = ["group", "gender", "comorbidities"]
HI_VAR = "gender"
HI_VALUE = ["female"]          # demonstrates highlight slicing + breakdown hover


def is_white(color):
    try:
        r, g, b = to_rgb(color)
    except Exception:
        return False
    return min(r, g, b) > 0.9   # drop white divider bars


# ---------------------------------------------------------------------------
# RISK A — capture layer (entirely our code; library untouched)
# ---------------------------------------------------------------------------
PAINTER_CALLS = []


class _RecAx:
    """Stand-in Axes whose only job is to record `ax.fill(x, y, color=...)` calls.
    These are the library's FINAL polygons -- correct perimeter order + color
    slicing -- so we never recompute geometry ourselves."""
    def __init__(self):
        self.fills = []

    def fill(self, *args, **kwargs):
        x, y = args[0], args[1]
        self.fills.append({
            "vertices": [[float(px), float(py)] for px, py in zip(x, y)],
            "color": kwargs.get("color", "#000000"),
        })
        return []


def make_recorder(base):
    class _Recording(base):
        def plot(self, ax, alpha, left_center_pts, right_center_pts, heights,
                 colors, weights, orientation="side-by-side", zorder=0,
                 check_overlap=False, unibar_name=None):
            rec = _RecAx()
            # Run the library's own drawing into our recording axes.
            super().plot(rec, alpha, left_center_pts, right_center_pts, heights,
                         colors, weights, orientation=orientation, zorder=zorder,
                         check_overlap=False, unibar_name=unibar_name)
            n = len(left_center_pts)
            k = (len(rec.fills) // n) if n else 0   # fills per shape == len(colors)
            shapes = []
            for i in range(n):
                shapes.append({
                    "right_y": float(right_center_pts[i][1]),
                    "colors": list(colors),
                    "weights": [float(w) for w in weights[i]],
                    "count": float(sum(weights[i])),
                    "fills": rec.fills[i * k:(i + 1) * k],
                })
            PAINTER_CALLS.append({
                "layer": "unibar" if unibar_name is not None else "connector",
                "unibar_name": unibar_name,
                "alpha": float(alpha),
                "shapes": shapes,
            })
            return ax
    return _Recording


captured = {}
_OrigFigure = figmod.Figure


class _RecordingFigure(_OrigFigure):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        captured["fig"] = self


def patch():
    figmod.Rectangle = make_recorder(Rectangle)
    figmod.Parallelogram = make_recorder(Parallelogram)
    figmod.Figure = _RecordingFigure
    mainmod.Figure = _RecordingFigure


def unpatch():
    figmod.Rectangle = Rectangle
    figmod.Parallelogram = Parallelogram
    figmod.Figure = _OrigFigure
    mainmod.Figure = _OrigFigure


# ---------------------------------------------------------------------------
# Enrichment + hover text
# ---------------------------------------------------------------------------
def pair_order(df, left_name, right_name, weight_col):
    if weight_col is None:
        grouped = df.groupby([left_name, right_name, "color_index"],
                             observed=True).size().to_dict()
    else:
        grouped = df.groupby([left_name, right_name, "color_index"],
                             observed=True)[weight_col].sum().to_dict()
    pairs = OrderedDict()
    for (lv, rv, _ci), cnt in grouped.items():
        pairs[(lv, rv)] = pairs.get((lv, rv), 0.0) + float(cnt)
    return [(lv, rv) for (lv, rv), total in pairs.items() if total > 0]


def breakdown(colors, weights):
    """User-requested hover: a per-highlight-group breakdown."""
    if len(colors) <= 1:
        return f"count: {weights[0]:g}"
    parts = []
    if weights[0] > 0:
        parts.append(f"not highlighted: {weights[0]:g}")
    for k in range(1, len(colors)):
        if weights[k] > 0:
            parts.append(f"highlighted ({', '.join(HI_VALUE)}): {weights[k]:g}")
    return "<br>".join(parts) if parts else "count: 0"


def build_scene():
    fig = captured["fig"]
    unibars, df, weight_col = fig.unibars, fig.data_df, fig.weights
    scene = {
        "coordinateSystem": {"xRange": [0, float(fig.scale_x)],
                             "yRange": [0, float(fig.scale_y)]},
        "axes": [{"name": u.name, "x": float(u.pos_x)} for u in unibars],
        "polygons": [], "notes": [],
    }

    def poly_area(verts):
        a = 0.0
        for i in range(len(verts)):
            x1, y1 = verts[i]
            x2, y2 = verts[(i + 1) % len(verts)]
            a += x1 * y2 - x2 * y1
        return abs(a) / 2.0

    def emit(shape, hover):
        for f in shape["fills"]:
            if is_white(f["color"]) or poly_area(f["vertices"]) < 1e-9:
                continue  # drop white dividers and zero-weight color slivers
            scene["polygons"].append({
                "layer": shape["_layer"], "vertices": f["vertices"],
                "fill": f["color"], "alpha": shape["_alpha"], "hover": hover,
            })

    connector_idx = 0
    for call in PAINTER_CALLS:
        if call["layer"] == "unibar":
            uni = next((u for u in unibars if u.name == call["unibar_name"]), None)
            for sh in call["shapes"]:
                sh["_layer"], sh["_alpha"] = "unibar", call["alpha"]
                cat = "?"
                if uni is not None:
                    val = min(uni.values, key=lambda v: abs(float(v.vert_centre) - sh["right_y"]))
                    if abs(float(val.vert_centre) - sh["right_y"]) < 1e-6:
                        cat = str(val.id)
                emit(sh, f"{call['unibar_name']} = {cat}<br>{breakdown(sh['colors'], sh['weights'])}")
        else:
            li, ri = connector_idx, connector_idx + 1
            connector_idx += 1
            lname = unibars[li].name
            rname = unibars[ri].name
            order = pair_order(df, lname, rname, weight_col)
            if len(order) != len(call["shapes"]):
                scene["notes"].append(f"connector {lname}->{rname}: order {len(order)} != shapes {len(call['shapes'])}")
                order = [("?", "?")] * len(call["shapes"])
            for (lv, rv), sh in zip(order, call["shapes"]):
                sh["_layer"], sh["_alpha"] = "connector", call["alpha"]
                emit(sh, f"{lname}={lv} → {rname}={rv}<br>{breakdown(sh['colors'], sh['weights'])}")
    return scene


# ---------------------------------------------------------------------------
# RISK B — interactive plotly.js (one trace per polygon)
# ---------------------------------------------------------------------------
def write_html(scene, path):
    traces = []
    for p in scene["polygons"]:
        xs = [v[0] for v in p["vertices"]] + [p["vertices"][0][0]]
        ys = [v[1] for v in p["vertices"]] + [p["vertices"][0][1]]
        traces.append({
            "type": "scatter", "mode": "lines", "x": xs, "y": ys,
            "fill": "toself", "fillcolor": p["fill"], "opacity": p["alpha"],
            "line": {"width": 0.4, "color": p["fill"]},
            "hoveron": "fills", "hoverlabel": {"bgcolor": "#222"},
            "text": p["hover"], "hovertemplate": "%{text}<extra></extra>",
            "showlegend": False,
        })
    shapes, annotations = [], []
    y0, y1 = scene["coordinateSystem"]["yRange"]
    for ax in scene["axes"]:
        shapes.append({"type": "line", "x0": ax["x"], "x1": ax["x"], "y0": y0, "y1": y1,
                       "line": {"color": "#bbb", "width": 1}, "layer": "below"})
        annotations.append({"x": ax["x"], "y": y1, "text": f"<b>{html.escape(ax['name'])}</b>",
                            "showarrow": False, "yanchor": "bottom", "font": {"size": 14}})
    layout = {
        "title": f"Hammock capture spike  (highlight: {HI_VAR}={HI_VALUE}) — hover any box",
        "xaxis": {"range": scene["coordinateSystem"]["xRange"], "visible": False},
        "yaxis": {"range": scene["coordinateSystem"]["yRange"], "visible": False},
        "shapes": shapes, "annotations": annotations,
        "hovermode": "closest", "plot_bgcolor": "white", "width": 1000, "height": 650,
    }
    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script></head>
<body><div id="p"></div>
<script>
Plotly.newPlot('p', {json.dumps(traces)}, {json.dumps(layout)}, {{scrollZoom:true, responsive:true}});
</script></body></html>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)


# ---------------------------------------------------------------------------
def main():
    df = pd.read_csv(DATA_CSV)
    print(f"dataset: {os.path.basename(DATA_CSV)}  rows={len(df)}  vars={VAR}  highlight={HI_VAR}={HI_VALUE}")

    patch()
    try:
        hammock_plot.Hammock(df).plot(var=VAR, hi_var=HI_VAR, hi_value=HI_VALUE,
                                      display_figure=False)
    finally:
        unpatch()

    scene = build_scene()
    json.dump(scene, open(os.path.join(HERE, "scene.json"), "w", encoding="utf-8"), indent=2)
    write_html(scene, os.path.join(HERE, "spike.html"))

    print("\n--- capture assertions ---")
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}{('  ' + detail) if detail else ''}")

    polys = scene["polygons"]
    n_conn_calls = sum(1 for c in PAINTER_CALLS if c["layer"] == "connector")
    n_colors = len(captured["fig"].colors)

    check("captured the Figure instance", "fig" in captured)
    check("axis count == len(var)", len(scene["axes"]) == len(VAR), f"{len(scene['axes'])} axes")
    check("connector calls == len(var)-1", n_conn_calls == len(VAR) - 1, f"{n_conn_calls}")
    check("highlight produced >1 color group", n_colors > 1, f"{n_colors} colors")
    check("polygons captured", len(polys) > 0, f"{len(polys)} polygons")

    # every fill is a 4-vertex quad within bounds (the library's real geometry)
    xr, yr = scene["coordinateSystem"]["xRange"], scene["coordinateSystem"]["yRange"]
    geo_ok = all(len(p["vertices"]) == 4 and all(xr[0]-1 <= v[0] <= xr[1]+1 and yr[0]-1 <= v[1] <= yr[1]+1
                 for v in p["vertices"]) for p in polys)
    check("all polygons are 4-vertex quads within bounds", geo_ok)

    # count correctness across highlight groups: pair-1 total flow == row count
    first_conn = [c for c in PAINTER_CALLS if c["layer"] == "connector"][0]
    flow0 = sum(s["count"] for s in first_conn["shapes"])
    expected = df.dropna(subset=VAR[:2]).shape[0]
    check("connector flow (pair 1) == row count", abs(flow0 - expected) < 1e-6, f"flow={flow0:g} expected={expected}")

    # highlight actually split something
    hi_total = sum(s["weights"][1] for c in PAINTER_CALLS if c["layer"] == "connector" for s in c["shapes"])
    check("highlight slice has nonzero flow", hi_total > 0, f"highlighted flow={hi_total:g}")

    n_conn_poly = sum(1 for p in polys if p["layer"] == "connector")
    labelled = sum(1 for p in polys if p["layer"] == "connector" and "=?" not in p["hover"])
    check("all connector polygons got real labels", labelled == n_conn_poly and not scene["notes"], f"{labelled}/{n_conn_poly}")

    if scene["notes"]:
        print("  notes:", *scene["notes"], sep="\n    ")
    print(f"\nwrote scene.json ({len(polys)} polygons) and spike.html  <- open in a browser")
    print("\nsample hovers:")
    for p in (polys[:3] + [p for p in polys if p["layer"] == "connector"][:4]):
        print("   ", p["hover"].replace("<br>", " | ").replace("→", "->"))
    print("\nRESULT:", "ALL CAPTURE CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
