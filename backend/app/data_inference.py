"""Column inference for uploaded / sample datasets (M2).

The GUI needs, per column: a coarse dtype (numeric vs categorical), the formatted
unique values (for value-order pickers and highlight label lists), and whether the
column is a valid weight variable. This mirrors the Streamlit source-of-truth
exactly so the two front-ends agree:

  * dtype          -> `utils.get_uni_type`            (int/float => numeric, else categorical)
  * formatted vals -> `utils.get_formatted_values` / `get_formatted_label`
  * weight check   -> `upload_modify_df.update_uniquevals_weightvars`
                      (numeric, no NaN, no value <= 0)

These are pure functions over a DataFrame/Series so they unit-test without FastAPI.
The backend stays stateless: `dataframe_to_records` returns rows the client keeps
and ships back on every /api/plot call.
"""
from __future__ import annotations

from typing import Any, Literal

import numpy as np
import pandas as pd

Dtype = Literal["numeric", "categorical"]


def infer_dtype(series: pd.Series) -> Dtype:
    """'numeric' for integer/float columns, 'categorical' otherwise.

    Mirrors `utils.get_uni_type` (which drops NA before checking dtype).
    """
    dtype = series.dropna().dtype
    if pd.api.types.is_bool_dtype(dtype):
        return "categorical"
    if pd.api.types.is_numeric_dtype(dtype):
        return "numeric"
    return "categorical"


def _format_label(kind: str, value: Any) -> str:
    """Format a single value the way the Streamlit app does (`get_formatted_label`)."""
    if kind == "str":
        return str(value)
    value = float(value)
    # scientific notation for very large / very small magnitudes
    if abs(value) >= 1_000_000 or 0 < abs(value) < 0.01:
        return f"{value:.2e}"
    if kind == "integer":
        return str(int(value))
    return f"{value:.2f}"  # floating -> 2 decimal places


def format_values(series: pd.Series) -> list[str]:
    """Formatted unique non-NA values, preserving first-seen order.

    Mirrors `utils.get_formatted_values` applied to the column's unique values:
    integer columns (and float columns that are all whole numbers) render as
    plain ints; other floats render to 2dp; strings pass through.
    """
    raw = series.dropna()
    uniq = pd.unique(raw)
    if len(uniq) == 0:
        return []

    dtype = series.dropna().dtype
    if pd.api.types.is_bool_dtype(dtype):
        kind = "str"
    elif pd.api.types.is_integer_dtype(dtype):
        kind = "integer"
    elif pd.api.types.is_float_dtype(dtype):
        # floats that happen to be whole numbers display as ints (matches source)
        kind = "integer" if np.all(uniq == uniq.astype(int)) else "floating"
    else:
        kind = "str"

    return [_format_label(kind, v) for v in uniq]


def is_weight_candidate(series: pd.Series) -> bool:
    """A valid weight variable: numeric, no missing values, no value <= 0.

    Mirrors `upload_modify_df.update_uniquevals_weightvars`.
    """
    if pd.api.types.is_bool_dtype(series.dtype):
        return False
    if not pd.api.types.is_numeric_dtype(series.dtype):
        return False
    if series.isna().any():
        return False
    return not (series <= 0).any()


def column_metadata(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Per-column metadata the GUI binds to: name, dtype, unique values, weight flag."""
    return [
        {
            "name": str(col),
            "dtype": infer_dtype(df[col]),
            "uniqueValues": format_values(df[col]),
            "weightCandidate": is_weight_candidate(df[col]),
        }
        for col in df.columns
    ]


def dataframe_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Rows as JSON-safe dicts (NaN -> None, so the payload is valid JSON).

    Cast to object first: on a native float column `where(..., None)` re-coerces
    None back to NaN, which is not valid JSON. Object dtype keeps None as None.
    """
    return df.astype(object).where(pd.notnull(df), None).to_dict(orient="records")
