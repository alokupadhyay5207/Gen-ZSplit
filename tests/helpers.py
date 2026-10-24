import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db  # noqa: E402
import init_db  # noqa: E402


def fresh_db():
    """Brand-new database built by the real init_db.build(); returns (conn, path)."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    raw = sqlite3.connect(path)
    init_db.build(raw)
    raw.commit()
    raw.close()
    return db.connect(path, manual_transactions=True), path


def add_users(conn, *names):
    ids = []
    for n in names:
        cur = conn.execute("INSERT INTO users (name, email, password) VALUES (?,?,?)",
                           (n, f"{n.lower()}@example.com", "x"))
        ids.append(cur.lastrowid)
    return ids


def counts(conn):
    tables = ["groups", "group_members", "group_expenses", "expense_splits", "settlements", "group_activity"]
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
