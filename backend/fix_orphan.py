#!/usr/bin/env python3
"""
One-time cleanup: delete orphan DRAFT goal sheets when a LOCKED sheet
exists for the same employee + period_label (FY).

Run from backend/:
  python fix_orphan.py
  python fix_orphan.py --dry-run

Uses MONGODB_URL and DATABASE_NAME from .env (via config.settings).
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from bson import ObjectId

from database import (
    COLLECTION_GOALS,
    COLLECTION_GOAL_SHEETS,
    COLLECTION_USERS,
    connect_db,
    close_db,
    get_database,
)
from models.goal_sheet import GoalSheetStatus


async def _orphan_draft_ids(db) -> list[str]:
    """Return _id strings of DRAFT sheets superseded by a LOCKED sheet (same employee + FY)."""
    sheets = [s async for s in db[COLLECTION_GOAL_SHEETS].find({})]

    locked_keys: set[tuple[str, str]] = set()
    for s in sheets:
        if s.get("status") == GoalSheetStatus.LOCKED:
            locked_keys.add((s["employee_id"], s.get("period_label", "")))

    orphan_ids: list[str] = []
    for s in sheets:
        if s.get("status") != GoalSheetStatus.DRAFT:
            continue
        key = (s["employee_id"], s.get("period_label", ""))
        if key in locked_keys:
            orphan_ids.append(str(s["_id"]))
    return orphan_ids


async def run(dry_run: bool) -> int:
    await connect_db()
    db = get_database()

    orphan_ids = await _orphan_draft_ids(db)
    if not orphan_ids:
        print("No orphan DRAFT goal sheets found.")
        await close_db()
        return 0

    print(f"Found {len(orphan_ids)} orphan DRAFT goal sheet(s):")
    for sid in orphan_ids:
        doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sid)})
        if doc:
            user = await db[COLLECTION_USERS].find_one({"_id": ObjectId(doc["employee_id"])})
            hr_id = user.get("employee_id", doc["employee_id"]) if user else doc["employee_id"]
            print(
                f"  - {sid} (employee={hr_id}, fy={doc.get('period_label')}, status={doc.get('status')})"
            )

    if dry_run:
        print("Dry-run: no documents deleted.")
        await close_db()
        return 0

    goals_result = await db[COLLECTION_GOALS].delete_many({"goal_sheet_id": {"$in": orphan_ids}})
    sheets_result = await db[COLLECTION_GOAL_SHEETS].delete_many(
        {"_id": {"$in": [ObjectId(sid) for sid in orphan_ids]}}
    )
    print(f"Deleted {goals_result.deleted_count} goal(s) and {sheets_result.deleted_count} sheet(s).")

    # Verify EMP005
    user = await db[COLLECTION_USERS].find_one({"employee_id": "EMP005"})
    if user:
        oid = str(user["_id"])
        remaining = [
            s async for s in db[COLLECTION_GOAL_SHEETS].find(
                {"employee_id": oid, "period_label": "FY 2025-26"}
            )
        ]
        print(f"\nEMP005 + FY 2025-26: {len(remaining)} sheet(s) remaining")
        for s in remaining:
            print(f"  - {s['_id']} status={s.get('status')}")

    await close_db()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete orphan DRAFT goal sheets")
    parser.add_argument("--dry-run", action="store_true", help="List matches without deleting")
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(run(args.dry_run)))
    except Exception as exc:
        print(f"Cleanup failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
