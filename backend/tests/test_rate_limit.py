import time
from collections import deque, defaultdict

import pytest


def _make_check(rate_limit: int, rate_window: float):
    """Factory returning a fresh _check_rate_limit closure with its own bucket dict."""
    ip_buckets: dict[str, deque] = defaultdict(deque)

    def check(ip: str) -> bool:
        now = time.monotonic()
        bucket = ip_buckets[ip]
        while bucket and bucket[0] < now - rate_window:
            bucket.popleft()
        if len(bucket) >= rate_limit:
            return False
        bucket.append(now)
        return True

    return check


def test_allows_requests_under_limit():
    check = _make_check(rate_limit=3, rate_window=60.0)
    assert check("1.2.3.4") is True
    assert check("1.2.3.4") is True
    assert check("1.2.3.4") is True


def test_blocks_request_at_limit():
    check = _make_check(rate_limit=3, rate_window=60.0)
    check("1.2.3.4")
    check("1.2.3.4")
    check("1.2.3.4")
    assert check("1.2.3.4") is False


def test_different_ips_are_independent():
    check = _make_check(rate_limit=2, rate_window=60.0)
    check("1.1.1.1")
    check("1.1.1.1")
    assert check("1.1.1.1") is False
    assert check("2.2.2.2") is True


def test_old_timestamps_expire():
    check = _make_check(rate_limit=2, rate_window=0.05)
    check("1.2.3.4")
    check("1.2.3.4")
    assert check("1.2.3.4") is False
    time.sleep(0.06)
    assert check("1.2.3.4") is True
