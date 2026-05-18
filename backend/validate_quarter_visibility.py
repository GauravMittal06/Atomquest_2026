"""
Quarter Visibility Resolution Validation Script

Validates the centralized quarter visibility resolution system:
- Future quarters remain hidden
- Active quarters use live scoring
- Frozen quarters remain visible with snapshot values
- Mock-date rollback does NOT erase frozen historical quarters

Run this script to verify correct implementation:
    python validate_quarter_visibility.py
"""

import asyncio
from datetime import date, datetime
from typing import Any, Dict

from database import get_database, COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, COLLECTION_CHECKINS
from services import (
    set_mock_date_override,
    freeze_snapshot_for_quarter,
    resolve_all_quarters_visibility,
    resolve_quarter_state,
    resolve_quarter_visibility,
    QuarterState,
    quarter_snapshot_exists,
    read_quarter_snapshot,
)
from bson import ObjectId


class ValidationError(Exception):
    """Raised when validation fails."""
    pass


def assert_equal(actual: Any, expected: Any, message: str):
    """Assert with helpful error message."""
    if actual != expected:
        raise ValidationError(
            f"[FAIL] {message}\n"
            f"   Expected: {expected}\n"
            f"   Got:      {actual}"
        )
    print(f"[PASS] {message}")


def assert_true(condition: bool, message: str):
    """Assert condition is true."""
    if not condition:
        raise ValidationError(f"[FAIL] {message}")
    print(f"[PASS] {message}")


async def setup_test_data(db) -> tuple[str, str]:
    """
    Create minimal test data for validation.
    
    Returns:
        (sheet_id, employee_id)
    """
    print("\n[SETUP] Setting up test data...")
    
    # Create test user/employee
    employee_id = "test_employee_visibility_001"
    
    # Create goal sheet
    sheet_doc = {
        "employee_id": employee_id,
        "manager_id": "test_manager_001",
        "status": "APPROVED",
        "quarter_snapshots": [],  # Start empty
    }
    result = await db[COLLECTION_GOAL_SHEETS].insert_one(sheet_doc)
    sheet_id = str(result.inserted_id)
    
    # Create goals
    goals = [
        {
            "goal_sheet_id": sheet_id,
            "kpi_id": "KPI001",
            "kpi_name": "Test KPI 1",
            "target_value": 100,
            "uom_type": "Max",
            "weightage": 50,
        },
        {
            "goal_sheet_id": sheet_id,
            "kpi_id": "KPI002",
            "kpi_name": "Test KPI 2",
            "target_value": 200,
            "uom_type": "Max",
            "weightage": 50,
        },
    ]
    
    goal_ids = []
    for goal_data in goals:
        result = await db[COLLECTION_GOALS].insert_one(goal_data)
        goal_ids.append(str(result.inserted_id))
    
    # Create Q1 check-ins
    q1_checkins = [
        {
            "goal_sheet_id": sheet_id,
            "goal_id": goal_ids[0],
            "period_label": "Q1",
            "actual_value": 80,
            "check_in_date": datetime(2025, 7, 15),
        },
        {
            "goal_sheet_id": sheet_id,
            "goal_id": goal_ids[1],
            "period_label": "Q1",
            "actual_value": 160,
            "check_in_date": datetime(2025, 7, 15),
        },
    ]
    
    for checkin in q1_checkins:
        await db[COLLECTION_CHECKINS].insert_one(checkin)
    
    print(f"[PASS] Created test sheet: {sheet_id}")
    print(f"[PASS] Created {len(goal_ids)} goals")
    print(f"[PASS] Created {len(q1_checkins)} Q1 check-ins")
    
    return sheet_id, employee_id


async def cleanup_test_data(db, sheet_id: str):
    """Remove test data."""
    print("\n[CLEANUP] Cleaning up test data...")
    await db[COLLECTION_CHECKINS].delete_many({"goal_sheet_id": sheet_id})
    await db[COLLECTION_GOALS].delete_many({"goal_sheet_id": sheet_id})
    await db[COLLECTION_GOAL_SHEETS].delete_one({"_id": ObjectId(sheet_id)})
    print("[PASS] Test data cleaned up")


async def validate_future_quarter_hidden(db, sheet_id: str):
    """
    VALIDATION 1: Future quarters remain hidden.
    
    Scenario:
    - Set mock date to July (Q1 window)
    - Q2, Q3, Q4 have no snapshots
    - Q2, Q3, Q4 windows are not yet open
    
    Expected:
    - Q2, Q3, Q4 should be FUTURE state → hidden
    """
    print("\n" + "="*70)
    print("TEST 1: Future Quarters Remain Hidden")
    print("="*70)
    
    # Set mock date to July (Q1 window)
    set_mock_date_override(date(2025, 7, 15))
    
    # Resolve visibility
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Q1 should be active (window open)
    q1_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q1")
    assert_equal(q1_vis.state, QuarterState.ACTIVE, "Q1 should be ACTIVE during July")
    assert_true(q1_vis.is_visible, "Q1 should be visible during its window")
    assert_true(q1_vis.use_live_scoring, "Q1 should use live scoring when active")
    
    # Q2, Q3, Q4 should be future (hidden)
    for quarter_label in ["Q2", "Q3", "Q4"]:
        vis = next(q for q in visibility_set.quarters if q.quarter_label == quarter_label)
        assert_equal(
            vis.state,
            QuarterState.FUTURE,
            f"{quarter_label} should be FUTURE when window not yet open"
        )
        assert_true(not vis.is_visible, f"{quarter_label} should be hidden (future)")
        assert_true(not vis.use_snapshot, f"{quarter_label} should not use snapshot")
        assert_true(not vis.use_live_scoring, f"{quarter_label} should not use live scoring")
    
    print("[PASS] Future quarters correctly hidden")


async def validate_active_quarter_live_scoring(db, sheet_id: str):
    """
    VALIDATION 2: Active quarter uses live scoring.
    
    Scenario:
    - Set mock date to October (Q2 window)
    - Q2 has check-ins but no snapshot
    
    Expected:
    - Q2 should be ACTIVE state → visible with live scoring
    """
    print("\n" + "="*70)
    print("TEST 2: Active Quarter Uses Live Scoring")
    print("="*70)
    
    # Create Q2 check-ins
    goals = []
    async for goal in db[COLLECTION_GOALS].find({"goal_sheet_id": sheet_id}):
        goals.append(goal)
    
    q2_checkins = [
        {
            "goal_sheet_id": sheet_id,
            "goal_id": str(goals[0]["_id"]),
            "period_label": "Q2",
            "actual_value": 90,
            "check_in_date": datetime(2025, 10, 15),
        },
        {
            "goal_sheet_id": sheet_id,
            "goal_id": str(goals[1]["_id"]),
            "period_label": "Q2",
            "actual_value": 180,
            "check_in_date": datetime(2025, 10, 15),
        },
    ]
    
    for checkin in q2_checkins:
        await db[COLLECTION_CHECKINS].insert_one(checkin)
    
    # Set mock date to October (Q2 window)
    set_mock_date_override(date(2025, 10, 15))
    
    # Resolve visibility
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Q2 should be active (window open)
    q2_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q2")
    assert_equal(q2_vis.state, QuarterState.ACTIVE, "Q2 should be ACTIVE during October")
    assert_true(q2_vis.is_visible, "Q2 should be visible during its window")
    assert_true(q2_vis.use_live_scoring, "Q2 should use live scoring when active")
    assert_true(not q2_vis.use_snapshot, "Q2 should not use snapshot (not frozen yet)")
    
    # Q1 should be closed without snapshot (hidden)
    q1_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q1")
    assert_equal(
        q1_vis.state,
        QuarterState.CLOSED_NO_SNAPSHOT,
        "Q1 should be CLOSED_NO_SNAPSHOT (window closed, no snapshot)"
    )
    assert_true(not q1_vis.is_visible, "Q1 should be hidden (no snapshot)")
    
    print("[PASS] Active quarter correctly uses live scoring")


async def validate_frozen_quarter_visible(db, sheet_id: str):
    """
    VALIDATION 3: Frozen quarters remain visible with snapshot values.
    
    Scenario:
    - Freeze Q1 snapshot
    - Verify Q1 becomes visible and uses snapshot
    
    Expected:
    - Q1 should be FROZEN state → visible with snapshot values
    """
    print("\n" + "="*70)
    print("TEST 3: Frozen Quarters Remain Visible with Snapshots")
    print("="*70)
    
    # Freeze Q1 snapshot
    await freeze_snapshot_for_quarter(db, sheet_id, "Q1", "test_admin")
    
    # Verify snapshot exists
    exists = await quarter_snapshot_exists(db, sheet_id, "Q1")
    assert_true(exists, "Q1 snapshot should exist after freezing")
    
    # Read snapshot
    snapshot = await read_quarter_snapshot(db, sheet_id, "Q1")
    assert_true(snapshot is not None, "Q1 snapshot should be readable")
    assert_true(snapshot.overall_score > 0, "Q1 snapshot should have positive score")
    
    # Resolve visibility (still in October)
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Q1 should now be frozen (visible with snapshot)
    q1_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q1")
    assert_equal(q1_vis.state, QuarterState.FROZEN, "Q1 should be FROZEN after snapshot")
    assert_true(q1_vis.is_visible, "Q1 should be visible (frozen)")
    assert_true(q1_vis.use_snapshot, "Q1 should use snapshot values")
    assert_true(not q1_vis.use_live_scoring, "Q1 should not use live scoring (frozen)")
    assert_true(q1_vis.snapshot_exists, "Q1 snapshot_exists flag should be True")
    
    print("[PASS] Frozen quarters correctly visible with snapshot values")


async def validate_mock_date_rollback_preserves_frozen(db, sheet_id: str):
    """
    VALIDATION 4: Mock-date rollback does NOT erase frozen historical quarters.
    
    CRITICAL TEST: This ensures snapshot existence controls historical visibility,
    not just the current mock date.
    
    Scenario:
    - Q1 is frozen (snapshot exists)
    - Roll back mock date to July (Q1 window)
    - Q1 should STILL be visible with snapshot (not live)
    
    Expected:
    - Q1 should remain FROZEN state → visible with snapshot
    - Q1 should NOT switch back to ACTIVE/live scoring
    """
    print("\n" + "="*70)
    print("TEST 4: Mock-Date Rollback Does NOT Erase Frozen Quarters")
    print("="*70)
    
    # Roll back mock date to July (Q1 window)
    set_mock_date_override(date(2025, 7, 15))
    
    # Resolve visibility
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Q1 should STILL be frozen (not active!)
    q1_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q1")
    assert_equal(
        q1_vis.state,
        QuarterState.FROZEN,
        "Q1 should remain FROZEN even during its window (snapshot exists)"
    )
    assert_true(q1_vis.is_visible, "Q1 should remain visible (frozen)")
    assert_true(q1_vis.use_snapshot, "Q1 should still use snapshot values")
    assert_true(not q1_vis.use_live_scoring, "Q1 should NOT revert to live scoring")
    
    # Verify snapshot is unchanged
    snapshot = await read_quarter_snapshot(db, sheet_id, "Q1")
    assert_true(snapshot is not None, "Q1 snapshot should persist after mock-date change")
    
    print("[PASS] Frozen quarters persist correctly after mock-date rollback")
    print("[PASS] CRITICAL: Historical snapshots remain stable across mock-date changes")


async def validate_between_windows_behavior(db, sheet_id: str):
    """
    VALIDATION 5: Between windows behavior.
    
    Scenario:
    - Set mock date to June (between Goal Setting and Q1)
    - Q1 has frozen snapshot
    
    Expected:
    - Q1 should remain FROZEN → visible with snapshot
    """
    print("\n" + "="*70)
    print("TEST 5: Between Windows Behavior")
    print("="*70)
    
    # Set mock date to June (between windows)
    set_mock_date_override(date(2025, 6, 15))
    
    # Resolve visibility
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Q1 should still be frozen
    q1_vis = next(q for q in visibility_set.quarters if q.quarter_label == "Q1")
    assert_equal(
        q1_vis.state,
        QuarterState.FROZEN,
        "Q1 should remain FROZEN between windows (snapshot exists)"
    )
    assert_true(q1_vis.is_visible, "Q1 should be visible (frozen)")
    
    print("[PASS] Between windows behavior correct")


async def run_validation():
    """Run all validation tests."""
    print("\n" + "="*70)
    print("QUARTER VISIBILITY RESOLUTION VALIDATION")
    print("="*70)
    
    # Initialize database connection
    from database import connect_db, close_db
    await connect_db()
    
    db = get_database()
    sheet_id = None
    
    try:
        # Setup
        sheet_id, employee_id = await setup_test_data(db)
        
        # Run tests in order
        await validate_future_quarter_hidden(db, sheet_id)
        await validate_active_quarter_live_scoring(db, sheet_id)
        await validate_frozen_quarter_visible(db, sheet_id)
        await validate_mock_date_rollback_preserves_frozen(db, sheet_id)
        await validate_between_windows_behavior(db, sheet_id)
        
        # Summary
        print("\n" + "="*70)
        print("[SUCCESS] ALL VALIDATIONS PASSED")
        print("="*70)
        print("\nVerified behaviors:")
        print("  [PASS] Future quarters remain hidden")
        print("  [PASS] Active quarters use live scoring")
        print("  [PASS] Frozen quarters remain visible with snapshots")
        print("  [PASS] Mock-date rollback preserves frozen quarters")
        print("  [PASS] Between windows behavior correct")
        print("\n[SUCCESS] Centralized quarter visibility resolution working correctly!")
        
    except ValidationError as e:
        print(f"\n{e}")
        print("\n[FAILED] VALIDATION FAILED")
        return False
        
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        # Cleanup
        if sheet_id:
            await cleanup_test_data(db, sheet_id)
        
        # Clear mock date
        set_mock_date_override(None)
        
        # Close database connection
        from database import close_db
        await close_db()
    
    return True


if __name__ == "__main__":
    success = asyncio.run(run_validation())
    exit(0 if success else 1)
