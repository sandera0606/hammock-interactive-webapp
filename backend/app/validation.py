"""Highlight-expression validation (M2).

`hi_value` can be either a list of labels or a regex/range expression. The GUI
needs to tell the user whether a typed expression is valid *before* they plot.
We reuse the library's own `validate_expression` — the exact validator the
library applies to `hi_value` (`vendor/hammock_plot/hammock_plot/main.py:336`) —
so the GUI's verdict matches what the plot will actually accept.

This is the single, named import site for that library util outside the capture
layer (CLAUDE.md keeps library coupling localized). It's a pure helper, not
drawing-internals, so reusing it here is safe and avoids reimplementing the
expression grammar.
"""
from __future__ import annotations


def validate_expression(expr: str) -> bool:
    """True if `expr` is a valid highlight expression (regex or numeric range)."""
    from hammock_plot.utils import validate_expression as _validate

    return bool(_validate(expr))
