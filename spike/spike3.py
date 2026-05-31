"""
Spike 3 — box/violin (and everything) rendered EXACTLY as hammock_plot draws them.

Pixel-faithful wrapper: we instrument the real matplotlib Axes and record every
drawing primitive the library emits (fill / fill_betweenx / broken_barh / plot /
scatter / text), then replay them as plotly traces. The library computes every
coordinate (weighted KDE, weighted quantiles, fences, scaling) — we reinvent
nothing. Result should look identical to the native PNG, but interactive.

This also DECOUPLES us from library internals: we no longer call any private
method; we only observe the ~6 matplotlib calls it makes.

Run:  python spike/spike3.py  ->  spike/spike3.html
"""

import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgba
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
HAMMOCK_REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "hammock_plot"))
sys.path.insert(0, HAMMOCK_REPO)

import pandas as pd
import hammock_plot

VAR = ["species", "bill_length_mm", "flipper_length_mm"]
DISPLAY = {"bill_length_mm": "box", "flipper_length_mm": "violin"}


def css(c, alpha=None):
    """matplotlib color -> css rgba string, or None for 'none'."""
    if c is None:
        return None
    if isinstance(c, (list, tuple, np.ndarray)) and len(c) and isinstance(c[0], (list, tuple, np.ndarray)):
        c = c[0]  # broken_barh passes facecolors as a sequence
    if isinstance(c, str) and c == "none":
        return None
    try:
        r, g, b, a = to_rgba(c)
    except Exception:
        return None
    if alpha is not None:
        a = alpha
    return f"rgba({int(r*255)},{int(g*255)},{int(b*255)},{a:.3f})"


# ---------------------------------------------------------------------------
# instrument a REAL axes: record the 6 drawing primitives, then delegate
# ---------------------------------------------------------------------------
REC = []        # list of dicts in call order
LIMS = {}
TEXTS = []
_seq = [0]


def _add(kind, **d):
    d["kind"] = kind
    d["seq"] = _seq[0]
    _seq[0] += 1
    REC.append(d)


def instrument(ax):
    o_fill = ax.fill
    o_fbx = ax.fill_betweenx
    o_bbh = ax.broken_barh
    o_plot = ax.plot
    o_scat = ax.scatter
    o_text = ax.text
    o_xlim = ax.set_xlim
    o_ylim = ax.set_ylim

    def fill(*a, **k):
        x, y = a[0], a[1]
        _add("fill", x=[float(v) for v in x], y=[float(v) for v in y],
             color=css(k.get("color"), k.get("alpha")), z=k.get("zorder", 0))
        return o_fill(*a, **k)

    def fill_betweenx(*a, **k):
        y, x1, x2 = a[0], a[1], a[2]
        x2 = np.full(len(y), x2) if np.isscalar(x2) else np.asarray(x2)
        x1 = np.asarray(x1)
        px = list(x1) + list(x2[::-1])
        py = list(y) + list(np.asarray(y)[::-1])
        _add("poly", x=[float(v) for v in px], y=[float(v) for v in py],
             color=css(k.get("color"), k.get("alpha")), z=k.get("zorder", 0))
        return o_fbx(*a, **k)

    def broken_barh(*a, **k):
        xranges, (y0, h) = a[0], a[1]
        face = css(k.get("facecolors"), k.get("alpha"))
        edge = css(k.get("edgecolors")) or "#444444"
        lw = k.get("linewidth", 1)
        for (x0, w) in xranges:
            _add("rect", x0=float(x0), x1=float(x0 + w), y0=float(y0), y1=float(y0 + h),
                 face=face, edge=edge, lw=lw, z=k.get("zorder", 0))
        return o_bbh(*a, **k)

    def plot(*a, **k):
        x, y = a[0], a[1]
        _add("line", x=[float(v) for v in np.atleast_1d(x)], y=[float(v) for v in np.atleast_1d(y)],
             color=css(k.get("color")) or "#444444", lw=k.get("linewidth", 1), z=k.get("zorder", 0))
        return o_plot(*a, **k)

    def scatter(*a, **k):
        x, y = np.atleast_1d(a[0]), np.atleast_1d(a[1])
        _add("markers", x=[float(v) for v in x], y=[float(v) for v in y],
             color=css(k.get("color"), k.get("alpha")) or "#444444",
             size=float(k.get("s", 20)) ** 0.5 + 2, z=k.get("zorder", 3))
        return o_scat(*a, **k)

    def text(*a, **k):
        x, y, s = a[0], a[1], a[2]
        TEXTS.append({"x": float(x), "y": float(y), "s": str(s),
                      "color": css(k.get("color")) or "#000",
                      "size": k.get("fontsize", 10) or 10,
                      "ha": k.get("ha", k.get("horizontalalignment", "center")),
                      "va": k.get("va", k.get("verticalalignment", "center")),
                      "rot": k.get("rotation", 0) or 0})
        return o_text(*a, **k)

    def set_xlim(*a, **k):
        LIMS["x"] = (float(a[0]), float(a[1])) if len(a) >= 2 else tuple(a[0])
        return o_xlim(*a, **k)

    def set_ylim(*a, **k):
        LIMS["y"] = (float(a[0]), float(a[1])) if len(a) >= 2 else tuple(a[0])
        return o_ylim(*a, **k)

    ax.fill, ax.fill_betweenx, ax.broken_barh = fill, fill_betweenx, broken_barh
    ax.plot, ax.scatter, ax.text = plot, scatter, text
    ax.set_xlim, ax.set_ylim = set_xlim, set_ylim
    return ax


_orig_subplots = plt.subplots


def patched_subplots(*a, **k):
    fig, ax = _orig_subplots(*a, **k)
    instrument(ax)
    return fig, ax


# ---------------------------------------------------------------------------
# replay recorded primitives as plotly traces
# ---------------------------------------------------------------------------
def to_plotly():
    traces = []
    for p in sorted(REC, key=lambda r: (r["z"], r["seq"])):
        if p["kind"] in ("fill", "poly"):
            if not p["color"]:
                continue
            traces.append({"type": "scatter", "mode": "lines",
                           "x": p["x"] + [p["x"][0]], "y": p["y"] + [p["y"][0]],
                           "fill": "toself", "fillcolor": p["color"],
                           "line": {"width": 0.4, "color": p["color"]},
                           "hoveron": "fills", "hoverinfo": "skip", "showlegend": False})
        elif p["kind"] == "rect":
            xs = [p["x0"], p["x1"], p["x1"], p["x0"], p["x0"]]
            ys = [p["y0"], p["y0"], p["y1"], p["y1"], p["y0"]]
            traces.append({"type": "scatter", "mode": "lines", "x": xs, "y": ys,
                           "fill": "toself" if p["face"] else "none",
                           "fillcolor": p["face"] or "rgba(0,0,0,0)",
                           "line": {"width": p["lw"], "color": p["edge"]},
                           "hoverinfo": "skip", "showlegend": False})
        elif p["kind"] == "line":
            traces.append({"type": "scatter", "mode": "lines", "x": p["x"], "y": p["y"],
                           "line": {"width": p["lw"], "color": p["color"]},
                           "hoverinfo": "skip", "showlegend": False})
        elif p["kind"] == "markers":
            traces.append({"type": "scatter", "mode": "markers", "x": p["x"], "y": p["y"],
                           "marker": {"size": p["size"], "color": p["color"]},
                           "hoverinfo": "skip", "showlegend": False})
    return traces


def write_html(path):
    import json
    traces = to_plotly()
    annotations = []
    for t in TEXTS:
        annotations.append({"x": t["x"], "y": t["y"], "text": t["s"], "showarrow": False,
                            "font": {"size": t["size"], "color": t["color"]},
                            "xanchor": {"center": "center", "left": "left", "right": "right"}.get(t["ha"], "center"),
                            "yanchor": {"center": "middle", "top": "top", "bottom": "bottom"}.get(t["va"], "middle"),
                            "textangle": -t["rot"]})
    xr = LIMS.get("x", (0, 100))
    yr = LIMS.get("y", (0, 100))
    layout = {"title": "Spike 3 — captured exactly as hammock_plot draws it (interactive)",
              "xaxis": {"range": [xr[0] - 8, xr[1] + 8], "visible": False},
              "yaxis": {"range": yr, "visible": False},
              "annotations": annotations, "hovermode": "closest", "plot_bgcolor": "white",
              "width": 1000, "height": 660, "margin": {"l": 20, "r": 20, "t": 40, "b": 20}}
    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script></head>
<body><div id="p"></div>
<script>Plotly.newPlot('p', {json.dumps(traces)}, {json.dumps(layout)}, {{scrollZoom:true, responsive:true}});</script>
</body></html>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)


def main():
    df = (pd.read_csv(os.path.join(HAMMOCK_REPO, "data", "data_penguins.csv"))
          .dropna(subset=VAR).reset_index(drop=True))
    print(f"rows={len(df)} vars={VAR} display={DISPLAY}")

    plt.subplots = patched_subplots
    try:
        hammock_plot.Hammock(df).plot(var=VAR, display_type=DISPLAY, display_figure=False)
    finally:
        plt.subplots = _orig_subplots

    write_html(os.path.join(HERE, "spike3.html"))

    kinds = {}
    for p in REC:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print("captured primitives:", kinds, f"| texts={len(TEXTS)} | xlim={LIMS.get('x')} ylim={LIMS.get('y')}")
    ok = True

    def check(n, c, d=""):
        nonlocal ok
        ok = ok and c
        print(f"  [{'PASS' if c else 'FAIL'}] {n}{('  ' + d) if d else ''}")

    check("violin body captured (fill_betweenx->poly)", kinds.get("poly", 0) >= 1)
    check("box rectangle captured (broken_barh->rect)", kinds.get("rect", 0) >= 1)
    check("box lines captured (median/whiskers/caps)", kinds.get("line", 0) >= 3)
    check("connectors+unibars captured (fill)", kinds.get("fill", 0) > 100)
    check("axis ranges captured", "x" in LIMS and "y" in LIMS)
    print("\nwrote spike3.html")
    print("RESULT:", "ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
