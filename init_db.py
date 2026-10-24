"""Check the configured MongoDB Atlas connection and initialize indexes.

Run after setting MONGODB_URI and MONGODB_DB_NAME in .env:
    python init_db.py
This command does not delete data or modify existing documents.
"""
from dotenv import load_dotenv

load_dotenv()

from db import get_db


def main():
    db = get_db()
    db.command("ping")
    print(f"MongoDB connection successful. Database: {db.name}")
    print("Collections are initialized lazily when first used; indexes are ready.")


if __name__ == "__main__":
    main()
