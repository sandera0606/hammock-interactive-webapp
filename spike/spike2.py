"""
Spike 2 — box & violin as NATIVE plotly traces, aligned on the hammock axis.

Builds on spike.py. The wrapper captures hammock-native marks (connectors,
categorical unibars) as polygons exactly as before. For box/violin unibars we do
NOT capture matplotlib polygons; instead we reuse the library's OWN data prep
(`_prepare_scaled_data`, `_prepare_weights`, `_weighted_quantile`) on the captured
Figure and emit native `go.Box` (precomputed stats) / `go.Violin` (expanded
points), positioned at the unibar's x so connectors land on them.

Penguins aggregates to per-value occurrence counts, so even this "unweighted"
dataset exercises the WEIGHTED quantile/KDE path.

Run:  python spike/spike2.py   ->  spike/scene2.json , spike/spike2.html
"""

import os
import sys
import json
import html

import matplotlib
matplotlib.use("Agg")
from matplotlib.colors import to_rgb
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
HAMMOCK_REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "hammock_plot"))
DATA_CSV = os.path.join(HAMMOCK_REPO, "data", "data_penguins.csv")
sys.path.insert(0, HAMMOCK_REPO)

import pandas as pd
import hammock_plot
import hammock_plot.figure as figmod
import hammock_plot.main as mainmod
from hammock_plot.shapes import Rectangle, Parallelogram

VAR = ["species", "bill_length_mm", "flipper_length_mm"]
DISPLAY = {"bill_length_mm": "box", "flipper_length_mm": "violin"}
STAT_KINDS = {"box", "violin", "lumpy beanplot", "spiky beanplot"}


def is_white(color):
    try:
        r, g, b = to_rgb(color)
    except Exception:
        return False
    return min(r, g, b) > 0.9


# ---------------------------------------------------------------------------
# capture core (identical mechanism to spike.py)
# ---------------------------------------------------------------------------
PAINTER_CALLS = []


class _RecAx:
    def __init__(self):
        self.fills = []

    def fill(self, *args, **kwargs):
        x, y = args[0], args[1]
        self.fills.append({"vertices": [[float(px), float(py)] for px, py in zip(x, y)],
                           "color": kwargs.get("color", "#000000")})
        return []


def make_recorder(base):
    class _Recording(base):
        def plot(self, ax, alpha, left_center_pts, right_center_pts, heights,
                 colors, weights, orientation="side-by-side", zorder=0,
                 check_overlap=False, unibar_name=None):
            rec = _RecAx()
            super().plot(rec, alpha, left_center_pts, right_center_pts, heights,
                         colors, weights, orientation=orientation, zorder=zorder,
                         check_overlap=False, unibar_name=unibar_name)
            n = len(left_center_pts)
            k = (len(rec.fills) // n) if n else 0
            shapes = []
            for i in range(n):
                shapes.append({"right_y": float(right_center_pts[i][1]), "colors": list(colors),
                               "weights": [float(w) for w in weights[i]],
                               "count": float(sum(weights[i])), "fills": rec.fills[i * k:(i + 1) * k]})
            PAINTER_CALLS.append({"layer": "unibar" if unibar_name is not None else "connector",
                                  "unibar_name": unibar_name, "alpha": float(alpha), "shapes": shapes})
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
    figmod.Rectangle, figmod.Parallelogram = Rectangle, Parallelogram
    figmod.Figure = mainmod.Figure = _OrigFigure


# ---------------------------------------------------------------------------
# box/violin native-trace extraction — reuse the library's own data prep
# ---------------------------------------------------------------------------
def whisker_fences(arr, q1, q3):
    iqr = q3 - q1
    lo = arr[arr >= q1 - 1.5 * iqr].min()
    hi = arr[arr <= q3 + 1.5 * iqr].max()
    fliers = arr[(arr < q1 - 1.5 * iqr) | (arr > q3 + 1.5 * iqr)]
    return float(lo), float(hi), [float(f) for f in fliers]


def real_groups(uni, n_colors):
    """Real (unscaled) numeric values + counts per color, mirroring _prepare_scaled_data."""
    out = [([], []) for _ in range(n_colors)]
    for v in uni.non_missing_vals:
        occs = list(v.occ_by_colour) + [0] * (n_colors - len(v.occ_by_colour))
        for i, occ in enumerate(occs):
            if occ > 0 and v.numeric is not None:
                out[i][0].append(float(v.numeric))
                out[i][1].append(float(occ))
    return out


def stat_traces_for(uni):
    """Emit native-trace specs for a box/violin unibar from the captured Figure."""
    n_colors = len(uni.colors)
    data_per_color, facecolors, _edge = uni._prepare_scaled_data(uni.draw_y_start, uni.draw_y_end)
    weights_per_color = uni._prepare_weights(n_colors)
    reals = real_groups(uni, n_colors)
    specs = []
    for ci, sdata in enumerate(data_per_color):
        if not sdata:
            continue
        sd = np.asarray(sdata, float)
        sw = np.asarray(weights_per_color[ci], float)
        rd = np.asarray(reals[ci][0], float)
        rw = np.asarray(reals[ci][1], float)
        count = float(sw.sum())
        # real-value five-number summary (for hover)
        rq1, rmed, rq3 = (float(q) for q in uni._weighted_quantile(rd, rw, [0.25, 0.5, 0.75]))
        rlo, rhi, _ = whisker_fences(rd, rq1, rq3)
        real = {"min": float(rd.min()), "q1": rq1, "median": rmed, "q3": rq3,
                "max": float(rd.max()), "lo": rlo, "hi": rhi}
        if uni.display_type == "box":
            q1, med, q3 = (float(q) for q in uni._weighted_quantile(sd, sw, [0.25, 0.5, 0.75]))
            lo, hi, fliers = whisker_fences(sd, q1, q3)
            specs.append({"kind": "box", "axis": uni.name, "x": float(uni.pos_x),
                          "width": float(uni.width), "colorGroup": ci, "fill": facecolors[ci],
                          "stats": {"q1": q1, "median": med, "q3": q3, "lowerfence": lo,
                                    "upperfence": hi, "fliers": fliers},
                          "scaledMedian": med, "real": real})
        else:  # violin -> expand points by integer count (library's KDE-input trick)
            counts = np.maximum(np.round(sw / sw.min()).astype(int), 1)
            y = np.repeat(sd, counts)
            specs.append({"kind": "violin", "axis": uni.name, "x": float(uni.pos_x),
                          "width": float(uni.width), "colorGroup": ci, "fill": facecolors[ci],
                          "y": [float(v) for v in y],
                          "scaledMedian": float(uni._weighted_quantile(sd, sw, [0.5])[0]),
                          "real": real})
    return specs


# ---------------------------------------------------------------------------
# scene assembly (polygons for connectors + categorical unibars; statTraces for box/violin)
# ---------------------------------------------------------------------------
def pair_order(df, left_name, right_name, weight_col):
    if weight_col is None:
        grouped = df.groupby([left_name, right_name, "color_index"], observed=True).size().to_dict()
    else:
        grouped = df.groupby([left_name, right_name, "color_index"], observed=True)[weight_col].sum().to_dict()
    from collections import OrderedDict
    pairs = OrderedDict()
    for (lv, rv, _ci), cnt in grouped.items():
        pairs[(lv, rv)] = pairs.get((lv, rv), 0.0) + float(cnt)
    return [(lv, rv) for (lv, rv), t in pairs.items() if t > 0]


def poly_area(verts):
    a = 0.0
    for i in range(len(verts)):
        x1, y1 = verts[i]
        x2, y2 = verts[(i + 1) % len(verts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def build_scene():
    fig = captured["fig"]
    unibars, df, weight_col = fig.unibars, fig.data_df, fig.weights
    uni_by_name = {u.name: u for u in unibars}
    scene = {"coordinateSystem": {"xRange": [0, float(fig.scale_x)], "yRange": [0, float(fig.scale_y)]},
             "axes": [{"name": u.name, "x": float(u.pos_x), "displayType": u.display_type} for u in unibars],
             "polygons": [], "statTraces": [], "notes": []}

    def emit_poly(layer, alpha, fills, hover):
        for f in fills:
            if is_white(f["color"]) or poly_area(f["vertices"]) < 1e-9:
                continue
            scene["polygons"].append({"layer": layer, "vertices": f["vertices"],
                                      "fill": f["color"], "alpha": alpha, "hover": hover})

    connector_idx = 0
    for call in PAINTER_CALLS:
        if call["layer"] == "unibar":
            name = call["unibar_name"]
            uni = uni_by_name.get(name)
            if uni is not None and uni.display_type in STAT_KINDS:
                continue  # box/violin unibars become native traces, not polygons
            for sh in call["shapes"]:
                cat = "?"
                if uni is not None:
                    val = min(uni.values, key=lambda v: abs(float(v.vert_centre) - sh["right_y"]))
                    if abs(float(val.vert_centre) - sh["right_y"]) < 1e-6:
                        cat = str(val.id)
                emit_poly("unibar", call["alpha"], sh["fills"], f"{name} = {cat}<br>count: {sh['count']:g}")
        else:
            li, ri = connector_idx, connector_idx + 1
            connector_idx += 1
            lname, rname = unibars[li].name, unibars[ri].name
            order = pair_order(df, lname, rname, weight_col)
            if len(order) != len(call["shapes"]):
                scene["notes"].append(f"connector {lname}->{rname}: order {len(order)} != shapes {len(call['shapes'])}")
                order = [("?", "?")] * len(call["shapes"])
            for (lv, rv), sh in zip(order, call["shapes"]):
                emit_poly("connector", call["alpha"],
                          sh["fills"], f"{lname}={lv} → {rname}={rv}<br>count: {sh['count']:g}")

    # native box/violin traces
    for uni in unibars:
        if uni.display_type in STAT_KINDS:
            scene["statTraces"].extend(stat_traces_for(uni))
    return scene


# ---------------------------------------------------------------------------
# render: polygons + native go.Box / go.Violin
# ---------------------------------------------------------------------------
def write_html(scene, path):
    traces = []
    for p in scene["polygons"]:
        xs = [v[0] for v in p["vertices"]] + [p["vertices"][0][0]]
        ys = [v[1] for v in p["vertices"]] + [p["vertices"][0][1]]
        traces.append({"type": "scatter", "mode": "lines", "x": xs, "y": ys, "fill": "toself",
                       "fillcolor": p["fill"], "opacity": p["alpha"], "line": {"width": 0.4, "color": p["fill"]},
                       "hoveron": "fills", "text": p["hover"], "hovertemplate": "%{text}<extra></extra>",
                       "showlegend": False})

    for s in scene["statTraces"]:
        r = s["real"]
        if s["kind"] == "box":
            st = s["stats"]
            traces.append({"type": "box", "name": s["axis"], "x0": s["x"], "width": s["width"],
                           "q1": [st["q1"]], "median": [st["median"]], "q3": [st["q3"]],
                           "lowerfence": [st["lowerfence"]], "upperfence": [st["upperfence"]],
                           "fillcolor": s["fill"], "line": {"color": "#444"}, "whiskerwidth": 0.5,
                           "showlegend": False, "hoverinfo": "skip"})
            if st["fliers"]:
                traces.append({"type": "scatter", "mode": "markers",
                               "x": [s["x"]] * len(st["fliers"]), "y": st["fliers"],
                               "marker": {"color": s["fill"], "size": 5}, "showlegend": False,
                               "hovertemplate": f"{s['axis']} outlier<extra></extra>"})
        else:
            traces.append({"type": "violin", "name": s["axis"], "x0": s["x"], "width": s["width"],
                           "y": s["y"], "points": False, "side": "both", "fillcolor": s["fill"],
                           "line": {"color": "#444"}, "meanline": {"visible": True},
                           "showlegend": False, "hoverinfo": "skip", "scalemode": "width", "spanmode": "hard"})
        # real-value hover marker at the (scaled) median
        traces.append({"type": "scatter", "mode": "markers", "x": [s["x"]], "y": [s["scaledMedian"]],
                       "marker": {"size": 14, "color": "rgba(0,0,0,0)"}, "showlegend": False,
                       "hovertemplate": (f"<b>{s['axis']}</b> ({s['kind']})<br>"
                                         f"min {r['min']:.1f} | Q1 {r['q1']:.1f} | median {r['median']:.1f} | "
                                         f"Q3 {r['q3']:.1f} | max {r['max']:.1f}<extra></extra>")})

    shapes, annotations = [], []
    y0, y1 = scene["coordinateSystem"]["yRange"]
    for ax in scene["axes"]:
        shapes.append({"type": "line", "x0": ax["x"], "x1": ax["x"], "y0": y0, "y1": y1,
                       "line": {"color": "#ccc", "width": 1}, "layer": "below"})
        annotations.append({"x": ax["x"], "y": y1, "text": f"<b>{html.escape(ax['name'])}</b><br>{ax['displayType']}",
                            "showarrow": False, "yanchor": "bottom", "font": {"size": 13}})
    layout = {"title": "Spike 2 — native box + violin on the hammock axis (hover them)",
              "xaxis": {"range": [scene["coordinateSystem"]["xRange"][0] - 5,
                                  scene["coordinateSystem"]["xRange"][1] + 5], "visible": False},
              "yaxis": {"range": scene["coordinateSystem"]["yRange"], "visible": False},
              "shapes": shapes, "annotations": annotations, "hovermode": "closest",
              "plot_bgcolor": "white", "width": 1000, "height": 680}
    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script></head>
<body><div id="p"></div>
<script>Plotly.newPlot('p', {json.dumps(traces)}, {json.dumps(layout)}, {{scrollZoom:true, responsive:true}});</script>
</body></html>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)


def main():
    df = pd.read_csv(DATA_CSV).dropna(subset=VAR).reset_index(drop=True)
    n = len(df)
    print(f"dataset: {os.path.basename(DATA_CSV)}  rows(after dropna)={n}  vars={VAR}  display={DISPLAY}")

    patch()
    try:
        hammock_plot.Hammock(df).plot(var=VAR, display_type=DISPLAY, display_figure=False)
    finally:
        unpatch()

    scene = build_scene()
    json.dump(scene, open(os.path.join(HERE, "scene2.json"), "w", encoding="utf-8"), indent=2, default=float)
    write_html(scene, os.path.join(HERE, "spike2.html"))

    print("\n--- box/violin native-trace assertions ---")
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}{('  ' + detail) if detail else ''}")

    sts = scene["statTraces"]
    box = next((s for s in sts if s["kind"] == "box"), None)
    vio = next((s for s in sts if s["kind"] == "violin"), None)
    yr = scene["coordinateSystem"]["yRange"]

    check("a native box trace was produced", box is not None)
    check("a native violin trace was produced", vio is not None)
    if box:
        st, r = box["stats"], box["real"]
        check("box stats ordered q1<=median<=q3", st["q1"] <= st["median"] <= st["q3"],
              f"{st['q1']:.1f}<= {st['median']:.1f} <= {st['q3']:.1f} (scaled)")
        check("box real median within data range", r["min"] <= r["median"] <= r["max"],
              f"median {r['median']:.1f} in [{r['min']:.1f},{r['max']:.1f}] mm")
        check("box positioned at its axis x", any(abs(a["x"] - box["x"]) < 1e-6 and a["name"] == box["axis"]
                                                   for a in scene["axes"]))
        check("box scaled stats within plot y-range", yr[0] <= st["lowerfence"] and st["upperfence"] <= yr[1])
    if vio:
        check("violin has expanded sample points", len(vio["y"]) > 0, f"{len(vio['y'])} pts")
        check("violin points within plot y-range", all(yr[0] <= y <= yr[1] for y in vio["y"]))

    # connectors still captured and land on the box axis
    conn = [p for p in scene["polygons"] if p["layer"] == "connector"]
    check("connectors captured alongside native traces", len(conn) > 0, f"{len(conn)} connector polys")
    check("no enrichment fallbacks", not scene["notes"])

    if scene["notes"]:
        print("  notes:", *scene["notes"], sep="\n    ")
    print(f"\nwrote scene2.json (polys={len(scene['polygons'])}, statTraces={len(sts)}) and spike2.html")
    if box:
        b = box["real"]
        print(f"  box  {box['axis']}: real Q1={b['q1']:.1f} median={b['median']:.1f} Q3={b['q3']:.1f} mm")
    if vio:
        v = vio["real"]
        print(f"  violin {vio['axis']}: real min={v['min']:.1f} median={v['median']:.1f} max={v['max']:.1f} mm")
    print("\nRESULT:", "ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
