"""GET /api/health surfaces the pinned SHA and library importability."""
from fastapi.testclient import TestClient

from app.main import app

EXPECTED_PIN = "925520b"

client = TestClient(app)


def test_health_ok():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["hammockImportable"] is True


def test_health_reports_pinned_sha():
    body = client.get("/api/health").json()
    pin = body["hammockPin"]
    assert pin is not None, "submodule SHA could not be resolved"
    assert pin["short"] == EXPECTED_PIN
    assert pin["sha"].startswith(EXPECTED_PIN)
