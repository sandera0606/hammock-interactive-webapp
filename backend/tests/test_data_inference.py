"""Unit tests for column inference (M2) — pure functions, no FastAPI.

These pin the behavior we ported from the Streamlit source-of-truth
(`utils.get_uni_type` / `get_formatted_values`, `upload_modify_df`).
"""
import numpy as np
import pandas as pd

from app import data_inference as di


def test_infer_dtype():
    assert di.infer_dtype(pd.Series([1, 2, 3])) == "numeric"
    assert di.infer_dtype(pd.Series([1.5, 2.5])) == "numeric"
    assert di.infer_dtype(pd.Series(["a", "b"])) == "categorical"
    assert di.infer_dtype(pd.Series([True, False])) == "categorical"
    # int column with a missing value becomes float, still numeric
    assert di.infer_dtype(pd.Series([1, 2, np.nan])) == "numeric"


def test_format_values_integers_preserve_first_seen_order():
    assert di.format_values(pd.Series([3, 1, 2, 1])) == ["3", "1", "2"]


def test_format_values_whole_floats_render_as_ints():
    assert di.format_values(pd.Series([1.0, 2.0])) == ["1", "2"]


def test_format_values_fractional_floats_two_dp():
    assert di.format_values(pd.Series([1.5, 2.25])) == ["1.50", "2.25"]


def test_format_values_scientific_thresholds():
    assert di.format_values(pd.Series([2_000_000.0])) == ["2.00e+06"]
    assert di.format_values(pd.Series([0.005])) == ["5.00e-03"]


def test_format_values_strings_passthrough_and_drop_na():
    assert di.format_values(pd.Series(["female", "male", None])) == ["female", "male"]


def test_format_values_empty():
    assert di.format_values(pd.Series([np.nan, np.nan])) == []


def test_is_weight_candidate():
    assert di.is_weight_candidate(pd.Series([1, 2, 3])) is True
    assert di.is_weight_candidate(pd.Series([1.0, 0.5])) is True
    assert di.is_weight_candidate(pd.Series([0, 1, 2])) is False  # zero not allowed
    assert di.is_weight_candidate(pd.Series([-1, 2])) is False  # negative not allowed
    assert di.is_weight_candidate(pd.Series([1, np.nan])) is False  # NaN not allowed
    assert di.is_weight_candidate(pd.Series(["a", "b"])) is False  # not numeric
    assert di.is_weight_candidate(pd.Series([True, True])) is False  # bool not a weight


def test_column_metadata_shape():
    df = pd.DataFrame({"g": ["x", "y"], "w": [1.0, 2.0]})
    meta = {m["name"]: m for m in di.column_metadata(df)}
    assert meta["g"]["dtype"] == "categorical"
    assert meta["g"]["uniqueValues"] == ["x", "y"]
    assert meta["g"]["weightCandidate"] is False
    assert meta["w"]["dtype"] == "numeric"
    assert meta["w"]["weightCandidate"] is True


def test_dataframe_to_records_nan_to_none():
    df = pd.DataFrame({"a": [1.0, np.nan]})
    assert di.dataframe_to_records(df) == [{"a": 1.0}, {"a": None}]
