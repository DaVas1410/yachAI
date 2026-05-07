import time
from collections import deque, defaultdict

from app.api.chat import _check_rate_limit


def _make_buckets() -> dict:
    return defaultdict(deque)


def test_allows_requests_under_limit():
    buckets = _make_buckets()
    assert _check_rate_limit(buckets, "1.2.3.4") is True
    assert _check_rate_limit(buckets, "1.2.3.4") is True
    assert _check_rate_limit(buckets, "1.2.3.4") is True


def test_blocks_request_at_limit():
    buckets = _make_buckets()
    # Fill up to the real limit (10)
    for _ in range(10):
        _check_rate_limit(buckets, "1.2.3.4")
    assert _check_rate_limit(buckets, "1.2.3.4") is False


def test_different_ips_are_independent():
    buckets = _make_buckets()
    for _ in range(10):
        _check_rate_limit(buckets, "1.1.1.1")
    assert _check_rate_limit(buckets, "1.1.1.1") is False
    assert _check_rate_limit(buckets, "2.2.2.2") is True


def test_old_timestamps_expire(monkeypatch):
    buckets = _make_buckets()
    base = 0.0
    calls = [base]

    def mock_monotonic():
        return calls[0]

    monkeypatch.setattr("app.api.chat.time.monotonic", mock_monotonic)

    # Fill up to limit at t=0
    for _ in range(10):
        _check_rate_limit(buckets, "1.2.3.4")
    assert _check_rate_limit(buckets, "1.2.3.4") is False

    # Advance time past the window (60s + 1s)
    calls[0] = 61.0
    assert _check_rate_limit(buckets, "1.2.3.4") is True
