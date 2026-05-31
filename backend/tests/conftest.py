"""Pytest config: the --update-golden flag for regenerating golden scenes.

Goldens are the upstream-drift tripwire (CLAUDE.md / ROADMAP M1). They are only
rewritten deliberately, behind this flag, after a human has reviewed the diff —
never silently. A normal `pytest` run asserts against the stored goldens.
"""
from __future__ import annotations

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--update-golden",
        action="store_true",
        default=False,
        help="Regenerate stored golden scenes instead of asserting against them.",
    )


@pytest.fixture
def update_golden(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--update-golden"))
