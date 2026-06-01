"""Golden-scene test — the tripwire for upstream hammock_plot drift (M1).

For fixed dataset + option configs we capture the Scene-Graph and assert it
equals a stored golden (float-tolerant), plus structural smoke asserts (axis
count, ≥1 connector, ≥1 unibar, box/violin hover present). If a submodule pin
bump changes the library's geometry, this fails — exactly the signal we want.

Regenerate goldens only after reviewing the diff:
    pytest backend/tests/test_golden_scene.py --update-golden

`hammockPin` is excluded from the comparison (it is environment-derived and a
deliberate bump is expected to change it); the geometry comparison is what
catches real drift.
"""
from __future__ import annotations

import json
import os

os.environ.setdefault("MPLBACKEND", "Agg")

from pathlib import Path

import pandas as pd
import pytest

from app.capture import capture_scene

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "vendor" / "hammock_plot" / "data"
GOLDEN_DIR = Path(__file__).resolve().parent / "golden"

FLOAT_TOL = 1e-6

CONFIGS = {
    "asthma_highlight": {
        "csv": "data_asthma.csv",
        "dropna": ["group", "gender", "comorbidities"],
        "options": {
            "var": ["group", "gender", "comorbidities"],
            "hi_var": "gender",
            "hi_value": ["female"],
        },
    },
    "penguins_box_violin": {
        "csv": "data_penguins.csv",
        "dropna": ["species", "bill_length_mm", "flipper_length_mm"],
        "options": {
            "var": ["species", "bill_length_mm", "flipper_length_mm"],
            "display_type": {"bill_length_mm": "box", "flipper_length_mm": "violin"},
        },
    },
    # --- M2: configs covering the display types / option paths the GUI exposes ---
    # group + gender are categorical; comorbidities is numeric (left at default box).
    "asthma_bar": {
        "csv": "data_asthma.csv",
        "dropna": ["group", "gender", "comorbidities"],
        "options": {
            "var": ["group", "gender", "comorbidities"],
            "display_type": {"group": "stacked_bar", "gender": "bar"},
        },
    },
    "asthma_snapshot": {
        # snapshot preset: unibars only (no connectors), tall/wide bars
        "csv": "data_asthma.csv",
        "dropna": ["group", "gender", "comorbidities"],
        "options": {
            "var": ["group", "gender", "comorbidities"],
            "uni_vfill": 0.95,
            "uni_hfill": 0.85,
            "connector_fraction": 0.0,
        },
    },
    "penguins_rug": {
        "csv": "data_penguins.csv",
        "dropna": ["species", "bill_length_mm", "flipper_length_mm"],
        "options": {
            "var": ["species", "bill_length_mm", "flipper_length_mm"],
            "display_type": {"bill_length_mm": "rug", "flipper_length_mm": "rug"},
        },
    },
    "penguins_expr_highlight": {
        # highlight by a numeric range expression (vs. the categorical-label
        # highlight already covered by asthma_highlight)
        "csv": "data_penguins.csv",
        "dropna": ["species", "bill_length_mm", "flipper_length_mm"],
        "options": {
            "var": ["species", "bill_length_mm", "flipper_length_mm"],
            "display_type": {"bill_length_mm": "box", "flipper_length_mm": "violin"},
            "hi_var": "bill_length_mm",
            "hi_value": "x>45",
        },
    },
}


def _capture(cfg: dict) -> dict:
    df = pd.read_csv(DATA_DIR / cfg["csv"])
    if cfg.get("dropna"):
        df = df.dropna(subset=cfg["dropna"]).reset_index(drop=True)
    scene = capture_scene(df, cfg["options"])
    scene.pop("hammockPin", None)  # environment-derived; excluded from golden
    return scene


def _assert_close(actual, expected, path: str = "") -> None:
    """Recursive deep-equal with float tolerance, reporting the first mismatch."""
    if isinstance(expected, float) or isinstance(actual, float):
        assert isinstance(actual, (int, float)), f"{path}: {actual!r} not numeric"
        assert abs(float(actual) - float(expected)) <= FLOAT_TOL, (
            f"{path}: {actual} != {expected} (tol {FLOAT_TOL})"
        )
    elif isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected dict, got {type(actual)}"
        assert set(actual) == set(expected), (
            f"{path}: keys differ\n  extra={set(actual) - set(expected)}\n"
            f"  missing={set(expected) - set(actual)}"
        )
        for k in expected:
            _assert_close(actual[k], expected[k], f"{path}.{k}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected list, got {type(actual)}"
        assert len(actual) == len(expected), (
            f"{path}: length {len(actual)} != {len(expected)}"
        )
        for i, (a, e) in enumerate(zip(actual, expected)):
            _assert_close(a, e, f"{path}[{i}]")
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


@pytest.mark.parametrize("name", list(CONFIGS))
def test_golden_scene(name: str, update_golden: bool) -> None:
    scene = _capture(CONFIGS[name])
    golden_path = GOLDEN_DIR / f"{name}.json"

    if update_golden:
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(json.dumps(scene, indent=2, sort_keys=True), encoding="utf-8")
        pytest.skip(f"golden regenerated: {golden_path.name}")

    assert golden_path.exists(), (
        f"missing golden {golden_path}; generate with --update-golden"
    )
    expected = json.loads(golden_path.read_text(encoding="utf-8"))
    _assert_close(scene, expected)


def test_smoke_categorical() -> None:
    scene = _capture(CONFIGS["asthma_highlight"])
    assert len(scene["axes"]) == 3, "axis count == len(var)"
    kinds = [m.get("hover", {}).get("kind") for m in scene["marks"]]
    assert kinds.count("connector") >= 1, "≥1 connector mark"
    assert kinds.count("unibar") >= 1, "≥1 unibar mark"
    # highlight produced a second color slice somewhere
    fills = {m["fill"] for m in scene["marks"] if m["type"] == "polygon"}
    assert len(fills) >= 2, "highlight produced multiple colors"


def test_smoke_box_violin() -> None:
    scene = _capture(CONFIGS["penguins_box_violin"])
    display = {a["name"]: a["displayType"] for a in scene["axes"]}
    assert display["bill_length_mm"] == "box"
    assert display["flipper_length_mm"] == "violin"
    box_hovers = [m["hover"] for m in scene["marks"] if m.get("hover", {}).get("kind") == "box"]
    assert box_hovers, "≥1 box/violin hover"
    for h in box_hovers:
        assert h["q1"] <= h["median"] <= h["q3"], f"quantiles ordered: {h}"


def test_highlight_box_violin_per_group_hover() -> None:
    """Highlighting splits each box/violin axis into one box per color group;
    every box must carry its own labeled, distinct hover (not just the widest)."""
    scene = _capture(CONFIGS["penguins_expr_highlight"])
    by_axis: dict[str, set] = {}
    for m in scene["marks"]:
        h = m.get("hover")
        if not h or h.get("kind") != "box":
            continue
        assert h.get("group"), f"highlighted box hover lacks a group label: {h}"
        assert h["q1"] <= h["median"] <= h["q3"], f"quantiles ordered: {h}"
        by_axis.setdefault(h["axis"], set()).add((h.get("group"), h["median"], h["q1"], h["q3"]))

    # Each highlighted box/violin axis exposes ≥2 groups with distinct stats,
    # and both the "other" and the highlighted group are labeled.
    for axis, groups in by_axis.items():
        labels = {g[0] for g in groups}
        assert len(groups) >= 2, f"{axis}: expected ≥2 per-group box hovers, got {groups}"
        assert "other" in labels, f"{axis}: missing 'other' group, got {labels}"
        assert any(l != "other" for l in labels), f"{axis}: missing highlighted group, got {labels}"
