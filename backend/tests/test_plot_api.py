"""Endpoint tests for the stateless plot API (M1).

Exercise the real FastAPI surface the SPA calls: sample listing, sample data
round-trip, and /api/plot returning a valid Scene-Graph (incl. error paths).
"""
import os

os.environ.setdefault("MPLBACKEND", "Agg")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_samples():
    r = client.get("/api/samples")
    assert r.status_code == 200
    names = {s["name"] for s in r.json()}
    assert {"asthma", "penguins"} <= names


def test_get_sample_round_trips_to_a_scene():
    sample = client.get("/api/samples/penguins").json()
    assert sample["data"], "sample carries rows for the stateless round-trip"

    r = client.post("/api/plot", json={"data": sample["data"], "options": sample["defaults"]})
    assert r.status_code == 200, r.text
    scene = r.json()
    assert scene["version"] == 1
    assert len(scene["axes"]) == 3
    assert any(m.get("hover", {}).get("kind") == "box" for m in scene["marks"])


def test_unknown_sample_404():
    assert client.get("/api/samples/nope").status_code == 404


def test_plot_rejects_missing_variable():
    r = client.post(
        "/api/plot",
        json={"data": [{"a": 1}], "options": {"var": ["a", "does_not_exist"]}},
    )
    assert r.status_code == 422
    assert "does_not_exist" in r.json()["detail"]
