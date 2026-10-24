"""Database plumbing shared by the legacy routes and the groupsplit package.

Why this module exists
----------------------
SQLite ships with foreign-key enforcement **off** on every new connection.
The previous code never turned it on, so every ``ON DELETE CASCADE`` in the
schema was decorative and deleting a group left orphaned members, expenses and
activity behind.  Everything now goes through :func:`connect`, which enables
it, and the path is absolute so the app can never silently create a second,
empty database just because it was launched from another directory.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager

from flask import current_app, g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, "expense_tracker.db")


def connect(path: str | None = None, *, manual_transactions: bool = False) -> sqlite3.Connection:
    """Open a connection with the pragmas this app depends on.

    ``manual_transactions=True`` puts the driver in autocommit mode so that
    :func:`transaction` can issue an explicit ``BEGIN IMMEDIATE``.  The legacy
    personal-expense routes keep the stdlib default (implicit transactions +
    ``conn.commit()``) so they behave exactly as before.
    """
    conn = sqlite3.connect(
        path or DEFAULT_DB_PATH,
        timeout=10,
        isolation_level=None if manual_transactions else "",
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    # WAL lets readers proceed while a writer is active (fewer "database is locked").
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_db() -> sqlite3.Connection:
    """Request-scoped connection for the group module (closed automatically)."""
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"], manual_transactions=True)
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection):
    """Atomic write block: ``BEGIN IMMEDIATE`` ... ``COMMIT`` or full ``ROLLBACK``.

    IMMEDIATE takes the write lock up-front, so "read balances, then insert a
    settlement" cannot interleave with another request and overspend a debt.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
