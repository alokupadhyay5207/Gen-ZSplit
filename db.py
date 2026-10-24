"""MongoDB Atlas connection and shared collection helpers for Gen-ZSplit."""
from __future__ import annotations

import os
from functools import lru_cache

from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Retained only for backwards-compatible imports; no SQLite file is used.
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "mongodb-atlas")

_client = None
_database = None
_indexes_ready = False


def get_db():
    """Return the MongoDB database, connecting lazily for serverless cold starts."""
    global _client, _database, _indexes_ready
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI is missing. Configure it in Vercel Environment Variables.")
    if _client is None:
        _client = MongoClient(
            uri,
            serverSelectionTimeoutMS=8000,
            connectTimeoutMS=8000,
            appname="Gen-ZSplit",
        )
        db_name = os.environ.get("MONGODB_DB_NAME", "").strip()
        if not db_name:
            # Use a database name from the URI path when supplied, else a stable default.
            from urllib.parse import urlparse
            db_name = urlparse(uri).path.strip("/").split("/")[0] or "genzsplit"
        _database = _client[db_name]
    if not _indexes_ready:
        _database.users.create_index([("email", ASCENDING)], unique=True)
        _database.expenses.create_index([("user_id", ASCENDING), ("date", ASCENDING)])
        _database.budgets.create_index([("user_id", ASCENDING), ("month", ASCENDING)], unique=True)
        _database.groups.create_index([("invite_code", ASCENDING)], unique=True)
        _database.group_members.create_index([("group_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
        _database.group_expenses.create_index([("group_id", ASCENDING), ("expense_date", ASCENDING)])
        _database.expense_splits.create_index([("expense_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
        _database.settlements.create_index([("group_id", ASCENDING), ("created_at", ASCENDING)])
        _database.group_activity.create_index([("group_id", ASCENDING), ("id", ASCENDING)])
        _indexes_ready = True
    return _database


def next_id(db, counter_name: str) -> int:
    """Allocate an integer ID to keep existing Flask routes and templates compatible."""
    from pymongo import ReturnDocument
    doc = db.counters.find_one_and_update(
        {"_id": counter_name},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc["value"])


def close_db(_exc=None) -> None:
    """Keep the MongoClient warm between serverless invocations; do not close it per request."""
    return None


__all__ = ["BASE_DIR", "DEFAULT_DB_PATH", "DuplicateKeyError", "get_db", "next_id", "close_db"]
