"""The capture shim: run hammock_plot's real drawing code, record what it draws.

This is the load-bearing M1 module — a faithful lift of `spike/spike.py`
(painter recorder, semantic) and `spike/spike3.py` (Axes instrumentation,
pixel-faithful), unified behind one `scene_capture(...)` context manager.

Two recorders compose WITHOUT double-drawing:

  1. Painter recorder (semantic). Connectors, rugplot/stacked/bar unibars and
     beanplot spikes funnel through `FigureBase.plot(...)` -> `ax.fill(...)` in
     shapes.py. We subclass `Rectangle`/`Parallelogram` and override `plot` to
     run `super().plot(rec_ax, ...)` into a stand-in `_RecAx` that records the
     library's FINAL, perimeter-ordered, color-sliced `ax.fill` polygons. We
     reinvent no geometry. Because those fills land on `_RecAx` (not the real
     Axes), they are never double-captured by the instrumentation below.

  2. Axes instrumentation (pixel-faithful). Box/violin internals and every text
     label draw straight onto the real Axes (`fill_betweenx`, `broken_barh`,
     `plot`, `scatter`, `text`). We patch `pyplot.subplots` to hand back a real
     Agg Axes whose primitives are wrapped to record-then-delegate. Replayed
     verbatim, they are identical to the library's PNG.

All recorded state lives on a `SceneRecorder` instance (no module globals), so
the buffers can't leak between captures. Concurrency safety is enforced by the
process-wide `_CAPTURE_LOCK`: the patches mutate global module state and
matplotlib's Agg backend is not thread-safe, so only one capture runs at a time
in a process (scale out via worker processes / Cloud Run instances, never
threads — see CLAUDE.md).
"""
from __future__ import annotations

import contextlib
import inspect
import threading
import warnings
from typing import Any, Iterator

import matplotlib

matplotlib.use("Agg")  # headless; must precede any pyplot use
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import to_rgba  # noqa: E402

import hammock_plot.figure as figmod  # noqa: E402
import hammock_plot.main as mainmod  # noqa: E402
from hammock_plot.shapes import FigureBase, Parallelogram, Rectangle  # noqa: E402

from .errors import IncompatibleHammockVersion

# Only one capture per process: patches are global + Agg isn't thread-safe.
_CAPTURE_LOCK = threading.Lock()

# The painter `FigureBase.plot` parameters the recorder relies on. If a bump
# drops or renames any of these, fail loud here rather than mis-record.
_PAINTER_PLOT_PARAMS = {
    "ax", "alpha", "left_center_pts", "right_center_pts", "heights",
    "colors", "weights", "orientation", "zorder", "check_overlap", "unibar_name",
}


def _css(color: Any, alpha: float | None = None) -> str | None:
    """matplotlib color -> "rgba(r,g,b,a)" css string, or None for 'none'.

    broken_barh hands facecolors as a sequence-of-sequences; unwrap one level.
    """
    if color is None:
        return None
    if (
        isinstance(color, (list, tuple, np.ndarray))
        and len(color)
        and isinstance(color[0], (list, tuple, np.ndarray))
    ):
        color = color[0]
    if isinstance(color, str) and color == "none":
        return None
    try:
        r, g, b, a = to_rgba(color)
    except (ValueError, TypeError):
        return None
    if alpha is not None:
        a = alpha
    return f"rgba({int(r * 255)},{int(g * 255)},{int(b * 255)},{a:.3f})"


class _RecAx:
    """Stand-in Axes whose only job is to record `ax.fill(x, y, color=...)`.

    The painter's `super().plot()` draws into this, so we capture its FINAL
    polygons (correct perimeter order + color slicing) and reinvent nothing.
    """

    def __init__(self) -> None:
        self.fills: list[dict] = []

    def fill(self, *args: Any, **kwargs: Any) -> list:
        x, y = args[0], args[1]
        self.fills.append(
            {
                "vertices": [[float(px), float(py)] for px, py in zip(x, y)],
                "color": kwargs.get("color", "#000000"),
            }
        )
        return []


class SceneRecorder:
    """Owns every buffer a single capture writes into.

    Painter polygons (semantic) accumulate in `painter_calls`; the Axes
    instrumentation's verbatim primitives in `prims`; text labels in `texts`;
    axis limits in `lims`. `figure` is the live `Figure` instance, stashed for
    enrichment + box/violin scale inversion.
    """

    def __init__(self) -> None:
        self.painter_calls: list[dict] = []
        self.prims: list[dict] = []
        self.texts: list[dict] = []
        self.lims: dict[str, tuple[float, float]] = {}
        self.figure: Any = None
        self._seq = 0

    def _add_prim(self, kind: str, **d: Any) -> None:
        d["kind"] = kind
        d["seq"] = self._seq
        self._seq += 1
        self.prims.append(d)

    # -- painter recorder (semantic) ---------------------------------------
    def make_painter(self, base: type) -> type:
        recorder = self

        class _RecordingPainter(base):  # type: ignore[valid-type, misc]
            def plot(
                self,
                ax: Any,
                alpha: float,
                left_center_pts: list,
                right_center_pts: list,
                heights: list,
                colors: list,
                weights: list,
                orientation: str = "side-by-side",
                zorder: int = 0,
                check_overlap: bool = False,
                unibar_name: str | None = None,
            ) -> Any:
                rec = _RecAx()
                # Run the library's real drawing into the recording axes.
                # check_overlap=False: it only emits warnings + Path math, never
                # affects the captured fills, and is costly.
                super().plot(
                    rec, alpha, left_center_pts, right_center_pts, heights,
                    colors, weights, orientation=orientation, zorder=zorder,
                    check_overlap=False, unibar_name=unibar_name,
                )
                n = len(left_center_pts)
                k = (len(rec.fills) // n) if n else 0  # fills/shape == len(colors)
                shapes = []
                for i in range(n):
                    shapes.append(
                        {
                            "right_y": float(right_center_pts[i][1]),
                            "colors": list(colors),
                            "weights": [float(w) for w in weights[i]],
                            "count": float(sum(weights[i])),
                            "fills": rec.fills[i * k : (i + 1) * k],
                        }
                    )
                recorder.painter_calls.append(
                    {
                        "layer": "unibar" if unibar_name is not None else "connector",
                        "unibar_name": unibar_name,
                        "alpha": float(alpha),
                        "zorder": int(zorder),
                        "shapes": shapes,
                    }
                )
                return ax

        _RecordingPainter.__name__ = f"Recording{base.__name__}"
        return _RecordingPainter

    # -- Axes instrumentation (pixel-faithful) -----------------------------
    def instrument(self, ax: Any) -> Any:
        recorder = self
        o_fill, o_fbx, o_bbh = ax.fill, ax.fill_betweenx, ax.broken_barh
        o_plot, o_scat, o_text = ax.plot, ax.scatter, ax.text
        o_xlim, o_ylim = ax.set_xlim, ax.set_ylim

        def fill(*a: Any, **k: Any) -> Any:
            x, y = a[0], a[1]
            recorder._add_prim(
                "fill",
                x=[float(v) for v in x], y=[float(v) for v in y],
                color=_css(k.get("color"), k.get("alpha")), z=k.get("zorder", 0),
            )
            return o_fill(*a, **k)

        def fill_betweenx(*a: Any, **k: Any) -> Any:
            y, x1, x2 = a[0], a[1], a[2]
            x2 = np.full(len(y), x2) if np.isscalar(x2) else np.asarray(x2)
            x1 = np.asarray(x1)
            px = list(x1) + list(x2[::-1])
            py = list(y) + list(np.asarray(y)[::-1])
            recorder._add_prim(
                "poly",
                x=[float(v) for v in px], y=[float(v) for v in py],
                color=_css(k.get("color"), k.get("alpha")), z=k.get("zorder", 0),
            )
            return o_fbx(*a, **k)

        def broken_barh(*a: Any, **k: Any) -> Any:
            xranges, (y0, h) = a[0], a[1]
            face = _css(k.get("facecolors"), k.get("alpha"))
            edge = _css(k.get("edgecolors")) or "#444444"
            lw = k.get("linewidth", 1)
            for (x0, w) in xranges:
                recorder._add_prim(
                    "rect",
                    x0=float(x0), x1=float(x0 + w), y0=float(y0), y1=float(y0 + h),
                    face=face, edge=edge, lw=lw, z=k.get("zorder", 0),
                )
            return o_bbh(*a, **k)

        def plot(*a: Any, **k: Any) -> Any:
            x, y = a[0], a[1]
            recorder._add_prim(
                "line",
                x=[float(v) for v in np.atleast_1d(x)],
                y=[float(v) for v in np.atleast_1d(y)],
                color=_css(k.get("color")) or "#444444",
                lw=k.get("linewidth", 1), z=k.get("zorder", 0),
            )
            return o_plot(*a, **k)

        def scatter(*a: Any, **k: Any) -> Any:
            x, y = np.atleast_1d(a[0]), np.atleast_1d(a[1])
            recorder._add_prim(
                "markers",
                x=[float(v) for v in x], y=[float(v) for v in y],
                color=_css(k.get("color"), k.get("alpha")) or "#444444",
                size=float(k.get("s", 20)) ** 0.5 + 2, z=k.get("zorder", 3),
            )
            return o_scat(*a, **k)

        def text(*a: Any, **k: Any) -> Any:
            x, y, s = a[0], a[1], a[2]
            recorder.texts.append(
                {
                    "x": float(x), "y": float(y), "s": str(s),
                    "color": _css(k.get("color")) or "#000",
                    "size": k.get("fontsize", 10) or 10,
                    "ha": k.get("ha", k.get("horizontalalignment", "center")),
                    "va": k.get("va", k.get("verticalalignment", "center")),
                    "rot": k.get("rotation", 0) or 0,
                }
            )
            return o_text(*a, **k)

        def set_xlim(*a: Any, **k: Any) -> Any:
            recorder.lims["x"] = (float(a[0]), float(a[1])) if len(a) >= 2 else tuple(a[0])
            return o_xlim(*a, **k)

        def set_ylim(*a: Any, **k: Any) -> Any:
            recorder.lims["y"] = (float(a[0]), float(a[1])) if len(a) >= 2 else tuple(a[0])
            return o_ylim(*a, **k)

        ax.fill, ax.fill_betweenx, ax.broken_barh = fill, fill_betweenx, broken_barh
        ax.plot, ax.scatter, ax.text = plot, scatter, text
        ax.set_xlim, ax.set_ylim = set_xlim, set_ylim
        return ax


def _assert_compatible() -> None:
    """Defensive signature/attribute asserts (CLAUDE.md "Defensive injection").

    Verify the shim's injection points still exist and `FigureBase.plot` still
    accepts the parameters we depend on, BEFORE patching. Raise a clear
    "incompatible version" error instead of producing a silently-wrong scene.
    """
    for mod, name in (
        (figmod, "Rectangle"),
        (figmod, "Parallelogram"),
        (figmod, "Figure"),
        (mainmod, "Figure"),
    ):
        if not hasattr(mod, name):
            raise IncompatibleHammockVersion(
                f"hammock_plot.{mod.__name__.split('.')[-1]}.{name} is missing — "
                "the capture shim's injection point no longer exists. "
                "The vendored library has drifted; rerun golden tests after a deliberate pin bump."
            )

    try:
        params = set(inspect.signature(FigureBase.plot).parameters)
    except (ValueError, TypeError) as exc:  # pragma: no cover - exotic
        raise IncompatibleHammockVersion(
            f"could not introspect FigureBase.plot signature: {exc}"
        ) from exc
    missing = _PAINTER_PLOT_PARAMS - params
    if missing:
        raise IncompatibleHammockVersion(
            "FigureBase.plot signature changed — the painter recorder depends on "
            f"parameters {sorted(missing)} which are no longer present. "
            "Incompatible hammock_plot version."
        )


@contextlib.contextmanager
def scene_capture(shape: str = "rectangle") -> Iterator[tuple[SceneRecorder, list[warnings.WarningMessage]]]:
    """Patch hammock_plot's drawing seams, yield a recorder, restore on exit.

    Serialized by `_CAPTURE_LOCK` (global module patches + Agg are not
    concurrency-safe). Captures library `warnings` non-invasively so callers can
    surface them in `scene.warnings`. All patches — including `pyplot.subplots`
    — are restored in `finally`, and `plt.close("all")` prevents figure leaks.

    `shape` ("rectangle" | "parallelogram") only gates the defensive asserts;
    the actual painter shape is chosen by the library from the plot options.
    """
    _assert_compatible()

    recorder = SceneRecorder()
    orig_rect = figmod.Rectangle
    orig_para = figmod.Parallelogram
    orig_fig_figmod = figmod.Figure
    orig_fig_mainmod = mainmod.Figure
    orig_subplots = plt.subplots

    def _recording_figure(base: type) -> type:
        class _RecordingFigure(base):  # type: ignore[valid-type, misc]
            def __init__(self, *a: Any, **k: Any) -> None:
                super().__init__(*a, **k)
                recorder.figure = self

        _RecordingFigure.__name__ = "RecordingFigure"
        return _RecordingFigure

    def _patched_subplots(*a: Any, **k: Any) -> Any:
        fig, ax = orig_subplots(*a, **k)
        recorder.instrument(ax)
        return fig, ax

    with _CAPTURE_LOCK:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                figmod.Rectangle = recorder.make_painter(orig_rect)
                figmod.Parallelogram = recorder.make_painter(orig_para)
                rec_fig = _recording_figure(orig_fig_figmod)
                figmod.Figure = rec_fig
                mainmod.Figure = rec_fig
                plt.subplots = _patched_subplots
                yield recorder, caught
            finally:
                figmod.Rectangle = orig_rect
                figmod.Parallelogram = orig_para
                figmod.Figure = orig_fig_figmod
                mainmod.Figure = orig_fig_mainmod
                plt.subplots = orig_subplots
                plt.close("all")
