"""Resolve the checked-out commit of the vendored hammock_plot submodule.

The pinned SHA is the resilience tripwire (CLAUDE.md): the backend reports it
from GET /api/health so an unexpected library bump is visible immediately.
Resolution is dependency-free and tries, in order:
  1. the HAMMOCK_PIN env var — set by the Docker image, since the deployed
     container has neither git nor the submodule's gitdir;
  2. `git rev-parse` against the submodule (local dev);
  3. reading the submodule's gitdir HEAD pointer directly (local fallback).
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

# version.py -> app -> backend -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
SUBMODULE_DIR = REPO_ROOT / "vendor" / "hammock_plot"


def _sha_via_git() -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(SUBMODULE_DIR), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    sha = out.stdout.strip()
    return sha if out.returncode == 0 and sha else None


def _sha_via_gitdir() -> str | None:
    """Read HEAD from the submodule's real git directory.

    A submodule's working tree has a `.git` *file* (not dir) containing
    `gitdir: <path>`; that directory holds HEAD, which for a detached pin is
    the raw SHA (or `ref: <ref>` we then resolve one hop).
    """
    dot_git = SUBMODULE_DIR / ".git"
    try:
        if dot_git.is_file():
            line = dot_git.read_text(encoding="utf-8").strip()
            gitdir = (SUBMODULE_DIR / line.split("gitdir:", 1)[1].strip()).resolve()
        elif dot_git.is_dir():
            gitdir = dot_git
        else:
            return None

        head = (gitdir / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref:"):
            ref = head.split("ref:", 1)[1].strip()
            head = (gitdir / ref).read_text(encoding="utf-8").strip()
        return head or None
    except (OSError, IndexError):
        return None


def get_hammock_pin() -> dict | None:
    """Return {"sha": <full>, "short": <7>} for the vendored library, or None."""
    sha = os.environ.get("HAMMOCK_PIN", "").strip() or _sha_via_git() or _sha_via_gitdir()
    if not sha:
        return None
    return {"sha": sha, "short": sha[:7]}
