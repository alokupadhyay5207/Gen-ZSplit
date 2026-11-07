"""Supabase connection and small query helpers for Gen-ZSplit.

Every database call in the app goes through the helpers below, so the rest of
the code never touches the Supabase client directly.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

_client = None
_PAGE = 1000  # Supabase/PostgREST returns at most 1000 rows per request


class DuplicateKeyError(Exception):
    """Raised when an insert violates a UNIQUE constraint (Postgres code 23505)."""


def get_db():
    """Return one shared Supabase client (created on first use)."""
    global _client
    if _client is None:
        url = (os.environ.get("SUPABASE_URL") or "").strip()
        key = (os.environ.get("SUPABASE_KEY") or "").strip()
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in your .env file.")
        from supabase import create_client
        _client = create_client(url, key)
    return _client


def close_db(_exc=None) -> None:
    """Flask teardown hook. The client is shared, so nothing to close."""
    return None


def _is_duplicate(exc: Exception) -> bool:
    text = str(exc).lower()
    return getattr(exc, "code", None) == "23505" or "23505" in text or "duplicate key" in text


def _apply(query, where):
    """Apply equality filters. None -> IS NULL, list/tuple/set -> IN (...)."""
    for column, value in (where or {}).items():
        if value is None:
            query = query.is_(column, "null")
        elif isinstance(value, (list, tuple, set)):
            query = query.in_(column, list(value))
        else:
            query = query.eq(column, value)
    return query


def fetch(db, table, where=None, *, columns="*", order=None, limit=None, extra=None):
    """Return a list of rows.

    where   dict of equality filters (see _apply)
    order   list of (column, descending) tuples
    limit   maximum number of rows
    extra   optional function(query) -> query for range/ilike filters
    Pages through results automatically, so more than 1000 rows still works.
    """
    rows, start = [], 0
    while True:
        stop = start + _PAGE - 1
        if limit is not None:
            stop = min(stop, limit - 1)
        query = _apply(db.table(table).select(columns), where)
        if extra:
            query = extra(query)
        for column, descending in (order or []):
            query = query.order(column, desc=descending)
        batch = query.range(start, stop).execute().data or []
        rows.extend(batch)
        if len(batch) < stop - start + 1 or (limit is not None and len(rows) >= limit):
            break
        start = stop + 1
    return rows


def get_one(db, table, where, *, columns="*"):
    """Return the first matching row, or None."""
    rows = _apply(db.table(table).select(columns), where).limit(1).execute().data or []
    return rows[0] if rows else None


def count(db, table, where=None, *, column="id"):
    res = _apply(db.table(table).select(column, count="exact"), where).limit(1).execute()
    return int(res.count or 0)


def insert(db, table, data):
    """Insert a row (dict) or rows (list). Returns the stored row / rows."""
    try:
        res = db.table(table).insert(data).execute()
    except Exception as exc:  # noqa: BLE001
        if _is_duplicate(exc):
            raise DuplicateKeyError(str(exc)) from exc
        raise
    rows = res.data or []
    if isinstance(data, list):
        return rows
    return rows[0] if rows else {}


def update(db, table, where, values):
    if not where:
        raise ValueError("update() needs a where clause")
    return _apply(db.table(table).update(values), where).execute().data or []


def delete(db, table, where):
    if not where:
        raise ValueError("delete() needs a where clause")
    return _apply(db.table(table).delete(), where).execute().data or []


def upsert(db, table, data, on_conflict):
    return db.table(table).upsert(data, on_conflict=on_conflict).execute().data or []


__all__ = ["DuplicateKeyError", "get_db", "close_db", "fetch", "get_one", "count",
           "insert", "update", "delete", "upsert"]