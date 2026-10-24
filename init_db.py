"""Initialise or repair the Smart Expense Tracker + Gen-ZSplit database.

    python init_db.py                  create anything missing (safe to re-run)
    python init_db.py --reset-groups   back up, then rebuild ONLY the group tables
                                       (users, personal expenses, budgets are kept)
    python init_db.py --fresh          back up, then delete and rebuild everything
    python init_db.py --check          report integrity problems, change nothing

Add --yes to skip the confirmation prompt.  Every destructive mode writes a
timestamped backup next to the database first.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime

from db import BASE_DIR, DEFAULT_DB_PATH

SCHEMA_FILE = os.path.join(BASE_DIR, "schema.sql")

# Personal-tracker tables, unchanged from the original project.
LEGACY_DDL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    otp TEXT,
    otp_expiry TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    budget_limit REAL NOT NULL CHECK(budget_limit >= 0),
    warning_sent INTEGER DEFAULT 0,
    overflow_sent INTEGER DEFAULT 0,
    UNIQUE(user_id, month),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
"""

# Child -> parent order. Includes tables from the previous (broken) group schema.
GROUP_TABLES = [
    "notifications", "audit_logs", "group_activity", "settlements",
    "expense_participants", "expense_splits", "group_expenses",
    "group_invitations", "group_members", "groups",
]


def tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def columns(conn, table) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def has_legacy_group_schema(conn) -> bool:
    t = tables(conn)
    if t & {"expense_participants", "group_invitations", "audit_logs", "notifications"}:
        return True
    return "groups" in t and "invite_code" not in columns(conn, "groups")


def row_counts(conn) -> dict[str, int]:
    present = tables(conn)
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in GROUP_TABLES if t in present}


def backup(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    dest = f"{path}.bak-{datetime.now():%Y%m%d-%H%M%S}"
    src, dst = sqlite3.connect(path), sqlite3.connect(dest)
    with dst:
        src.backup(dst)  # consistent even if the app is running / WAL is active
    src.close()
    dst.close()
    return dest


def confirm(message: str, assume_yes: bool) -> None:
    print(message)
    if assume_yes:
        return
    if input("Type 'yes' to continue: ").strip().lower() != "yes":
        sys.exit("Aborted. Nothing was changed.")


def build(conn) -> None:
    conn.executescript(LEGACY_DDL)
    # Older databases may predate the OTP columns.
    for col in ("otp", "otp_expiry"):
        if col not in columns(conn, "users"):
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
    with open(SCHEMA_FILE, encoding="utf-8") as fh:
        conn.executescript(fh.read())


def check(conn) -> bool:
    ok = True
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"integrity_check  : {integrity}")
    ok &= integrity == "ok"
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    print(f"foreign_key_check: {len(violations)} violation(s)")
    for v in violations[:10]:
        print("   ", tuple(v))
    ok &= not violations
    if "groups" in tables(conn):
        for table, count in row_counts(conn).items():
            print(f"  {table:<22}{count:>6} rows")
    return bool(ok)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset-groups", action="store_true", help="rebuild only the group tables")
    ap.add_argument("--fresh", action="store_true", help="delete and rebuild the whole database")
    ap.add_argument("--check", action="store_true", help="integrity report only")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument("--db", default=DEFAULT_DB_PATH, help="database path (default: next to app.py)")
    args = ap.parse_args()
    path = args.db
    print(f"Database: {path}")

    if args.check:
        if not os.path.exists(path):
            sys.exit("No database file yet. Run: python init_db.py")
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys = ON")
        sys.exit(0 if check(conn) else 1)

    if args.fresh:
        confirm("This DELETES the whole database (users, personal expenses, budgets, groups).\n"
                "A backup is written first.", args.yes)
        made = backup(path)
        if made:
            print(f"Backup written   : {made}")
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(path + suffix):
                os.remove(path + suffix)

    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = OFF")  # only while dropping/rebuilding
    try:
        if args.reset_groups:
            counts = row_counts(conn)
            summary = ", ".join(f"{t}={n}" for t, n in counts.items() if n) or "no rows"
            confirm("This DROPS and recreates the group tables only "
                    f"(current contents: {summary}).\nUsers, personal expenses and budgets are kept. "
                    "A backup is written first.", args.yes)
            made = backup(path)
            if made:
                print(f"Backup written   : {made}")
            for t in GROUP_TABLES:
                conn.execute(f"DROP TABLE IF EXISTS {t}")
        elif has_legacy_group_schema(conn):
            sys.exit(
                "This database still has the OLD group tables (no invite codes, REAL money, no "
                "enforced foreign keys).\nThey cannot be upgraded in place. Run:\n\n"
                "    python init_db.py --reset-groups\n\n"
                "Your users, personal expenses and budgets are preserved; a backup is written first.")
        build(conn)
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")

    conn.execute("PRAGMA journal_mode = WAL")
    healthy = check(conn)
    conn.close()
    print("\nDone." if healthy else "\nDone, but the checks above reported problems.")
    sys.exit(0 if healthy else 1)


if __name__ == "__main__":
    main()
