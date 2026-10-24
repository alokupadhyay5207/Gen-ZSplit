"""Small, dependency-free request hardening for the group module."""
from __future__ import annotations

import hmac
import secrets
import time
from collections import defaultdict, deque

from flask import request, session


# ---------------------------------------------------------------- CSRF
def csrf_token() -> str:
    """Per-session token, embedded in every POST form via the csrf_field macro."""
    token = session.get("_csrf")
    if not token:
        token = session["_csrf"] = secrets.token_urlsafe(32)
    return token


def verify_csrf() -> bool:
    sent = request.form.get("csrf_token", "")
    expected = session.get("_csrf", "")
    return bool(expected) and hmac.compare_digest(sent, expected)


# ------------------------------------------------------- failure throttle
class FailureThrottle:
    """Sliding-window limiter for guessable secrets (group passwords).

    In-memory and per-process: right for a single-process SQLite deployment.
    Move to Redis (or similar) if this ever runs on several workers.
    """

    def __init__(self, limit: int = 5, window_seconds: int = 600):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def _prune(self, key: str) -> deque:
        q, cutoff = self._hits[key], time.monotonic() - self.window
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int:
        q = self._prune(key)
        if len(q) < self.limit:
            return 0
        return max(1, int(q[0] + self.window - time.monotonic()))

    def record_failure(self, key: str) -> None:
        self._prune(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


join_throttle = FailureThrottle(limit=5, window_seconds=600)
