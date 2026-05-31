"""Capture-shim error types.

The shim couples to a handful of `hammock_plot` internals (module-level
`Rectangle`/`Parallelogram`/`Figure`, `FigureBase.plot`, and the matplotlib
primitives a real Axes always provides). When the vendored library is bumped to
a SHA whose shape no longer matches, we want a *loud, specific* failure here —
not a silently-wrong scene downstream. `IncompatibleHammockVersion` is that
tripwire; `scene_capture` raises it from its defensive signature asserts.
"""
from __future__ import annotations


class IncompatibleHammockVersion(RuntimeError):
    """Raised when the vendored hammock_plot no longer matches the shim's
    assumptions (missing injection point or changed `FigureBase.plot`
    signature). Carries an actionable message naming what drifted."""
