"""Check the Supabase connection, the API key type and that all tables exist.

Run after filling .env and running schema.sql:
    python init_db.py
"""
import base64
import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from db import get_db

TABLES = ["users", "expenses", "budgets", "groups", "group_members",
          "group_expenses", "expense_splits", "settlements", "group_activity"]


def key_role(key):
    key = (key or "").strip()
    if key.startswith("sb_secret_"):
        return "service_role"
    if key.startswith("sb_publishable_"):
        return "anon"
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role")
    except Exception:  # noqa: BLE001
        return None


def main():
    role = key_role(os.environ.get("SUPABASE_KEY"))
    if role == "anon":
        print("WARNING: SUPABASE_KEY is the public anon/publishable key. Tables use Row Level "
              "Security, so reads return nothing and inserts fail. Use the secret / service_role key.")
    elif role == "service_role":
        print("API key: secret / service_role (good).")
    else:
        print("Could not tell which kind of API key this is.")

    try:
        db = get_db()
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED to create the Supabase client: {exc}")
        return 1

    missing = []
    for table in TABLES:
        try:
            db.table(table).select("*").limit(1).execute()
            print(f"  ok       {table}")
        except Exception as exc:  # noqa: BLE001
            missing.append(table)
            print(f"  MISSING  {table}  ({str(exc)[:90]})")
    if missing:
        print("\nRun schema.sql in the Supabase SQL editor, then run this again.")
        return 1
    print("\nSupabase connection and all tables look good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())