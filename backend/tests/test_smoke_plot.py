"""M0 exit criterion: hammock_plot draws headless under the Agg backend.

This mirrors the proven spike invocation (spike/spike.py) — no capture/shim
yet, just confirming the library runs end-to-end from the backend's env so M1
can build the recorder on top.
"""
import os

# Force a non-interactive backend BEFORE matplotlib / the library import it.
os.environ.setdefault("MPLBACKEND", "Agg")

from pathlib import Path

import matplotlib
import pandas as pd
import pytest

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from hammock_plot import Hammock  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_CSV = REPO_ROOT / "vendor" / "hammock_plot" / "data" / "data_asthma.csv"


@pytest.fixture(autouse=True)
def _close_figures():
    yield
    plt.close("all")


def test_hammock_plot_runs_headless():
    df = pd.read_csv(DATA_CSV)
    result = Hammock(df).plot(
        var=["group", "gender", "comorbidities"],
        display_figure=False,
    )
    # With display_figure=False the library draws the full plot, then closes the
    # figure and returns None (main.py:486-490). Reaching that return without
    # raising means the whole headless draw path executed — the M0 criterion.
    assert result is None
