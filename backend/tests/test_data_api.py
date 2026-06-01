"""Endpoint tests for the M2 data + validation routes."""
import os

os.environ.setdefault("MPLBACKEND", "Agg")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_upload_csv_returns_rows_and_meta():
    csv = "group,weight\na,1\nb,2\na,3\n"
    r = client.post("/api/data/upload", json={"content": csv, "filename": "t.csv"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["group", "weight"]
    assert body["data"] == [
        {"group": "a", "weight": 1},
        {"group": "b", "weight": 2},
        {"group": "a", "weight": 3},
    ]
    meta = {m["name"]: m for m in body["meta"]}
    assert meta["group"]["dtype"] == "categorical"
    assert meta["group"]["uniqueValues"] == ["a", "b"]
    assert meta["weight"]["dtype"] == "numeric"
    assert meta["weight"]["weightCandidate"] is True


def test_upload_empty_content_422():
    r = client.post("/api/data/upload", json={"content": ""})
    assert r.status_code == 422  # min_length on the model


def test_upload_header_only_422():
    r = client.post("/api/data/upload", json={"content": "a,b\n"})
    assert r.status_code == 422
    assert "no rows" in r.json()["detail"]


def test_validate_expression_true_false():
    assert client.post("/api/validate-expression", json={"expr": "x>1 and x<5"}).json() == {
        "valid": True
    }
    assert client.post("/api/validate-expression", json={"expr": "female"}).json() == {
        "valid": True
    }
    # unbalanced bracket: invalid as a numeric range AND invalid regex
    assert client.post("/api/validate-expression", json={"expr": "["}).json() == {
        "valid": False
    }


def test_sample_now_carries_meta():
    body = client.get("/api/samples/penguins").json()
    assert "meta" in body and body["meta"]
    first = body["meta"][0]
    assert {"name", "dtype", "uniqueValues", "weightCandidate"} <= set(first)
