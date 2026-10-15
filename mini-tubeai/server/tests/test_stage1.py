import pytest
from fastapi.testclient import TestClient

from tubeai import config
from tubeai.auth import load_or_create_token
from tubeai.main import create_app

TOKEN = "test-token-123"


@pytest.fixture
def client():
    return TestClient(create_app(token=TOKEN))


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_ask_echoes_with_valid_token(client):
    r = client.post("/ask", json={"question": "what is a monad?"}, headers={"X-Tube-Token": TOKEN})
    assert r.status_code == 200
    assert r.json() == {"answer": "Echo: what is a monad?", "sources": []}


@pytest.mark.parametrize("headers", [{}, {"X-Tube-Token": ""}, {"X-Tube-Token": "wrong"}])
def test_missing_or_wrong_token_is_401(client, headers):
    r = client.post("/ask", json={"question": "hi"}, headers=headers)
    assert r.status_code == 401


def test_empty_question_rejected(client):
    r = client.post("/ask", json={"question": ""}, headers={"X-Tube-Token": TOKEN})
    assert r.status_code == 422


def test_cors_allows_only_the_extension_origin(client):
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-tube-token,content-type"}
    ok = client.options("/ask", headers={"Origin": config.EXTENSION_ORIGIN, **pre})
    assert ok.headers.get("access-control-allow-origin") == config.EXTENSION_ORIGIN
    bad = client.options("/ask", headers={"Origin": "https://evil.example", **pre})
    assert "access-control-allow-origin" not in bad.headers


def test_token_created_once_and_reused(tmp_path):
    path = tmp_path / "sub" / "token.txt"
    first = load_or_create_token(path)
    assert len(first) >= 40
    assert load_or_create_token(path) == first
    assert oct(path.stat().st_mode & 0o777) == "0o600"
