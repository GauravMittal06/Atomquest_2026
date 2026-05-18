#!/usr/bin/env python3
"""
One-time migration: goal_sheets with status APPROVED → LOCKED.

Run from backend/:
  python migrate_approved_to_locked.py
  python migrate_approved_to_locked.py --dry-run

Uses MONGODB_URL and DATABASE_NAME from .env (via config.settings).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime

from database import COLLECTION_GOAL_SHEETS, connect_db, close_db, get_database


async def run(dry_run: bool) -> int:
    await connect_db()
    db = get_database()
    coll = db[COLLECTION_GOAL_SHEETS]

    cursor = coll.find({"status": "APPROVED"})
    docs = await cursor.to_list(length=None)
    count = len(docs)

    if count == 0:
        print("No goal_sheets with status APPROVED found.")
        await close_db()
        return 0

    print(f"Found {count} goal_sheet(s) with status APPROVED.")
    for doc in docs:
        print(f"  - {doc['_id']} (employee_id={doc.get('employee_id')})")

    if dry_run:
        print("Dry-run: no documents updated.")
        await close_db()
        return 0

    now = datetime.utcnow()
    result = await coll.update_many(
        {"status": "APPROVED"},
        {"$set": {"status": "LOCKED", "updated_at": now}},
    )
    print(f"Updated {result.modified_count} document(s) to LOCKED.")
    await close_db()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate APPROVED goal sheets to LOCKED")
    parser.add_argument("--dry-run", action="store_true", help="List matches without updating")
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(run(args.dry_run)))
    except Exception as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
