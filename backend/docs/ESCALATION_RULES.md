# Escalation Rules (Backend Specification)

> **Scope:** This document defines when escalations are created, how they are promoted, and the MongoDB shape for the `escalations` collection. It is a **spec only** — no scheduler, router, or service implementation is implied here.

## Purpose & BRD Alignment

The AtomQuest BRD calls for an enterprise goal portal with **manager approvals**, **quarterly check-ins**, **analytics**, **reporting**, and **admin governance**. In practice, HR and Admin teams lack visibility when workflows stall:

| Pain point | Who is blocked | Escalation trigger |
|------------|----------------|-------------------|
| Employees never submit draft goal sheets | Manager cannot review; cycle cannot progress | `SUBMISSION_DELAY` |
| Managers do not approve or return submitted sheets | Employee goals stay unapproved; locking delayed | `APPROVAL_DELAY` |
| Employees miss quarterly actuals after a window closes | Progress and completion dashboards stay incomplete | `CHECKIN_DELAY` |

Escalations surface these gaps automatically so **Level 1** notifies the employee and their L1 manager, and **Level 2** (after a short grace period) flags **Admin / HR** for intervention — matching the governance intent in `docs/REPORTING_REQUIREMENTS.md` (completion dashboard, audit trail).

**Related docs:** `docs/WORKFLOWS.md`, `docs/CHECKIN_RULES.md`, `docs/VALIDATION_RULES.md`, `backend/services/checkin_window.py` (calendar implementation).

---

## Collection

| Item | Value |
|------|--------|
| Database | Same MongoDB instance as goal sheets / users |
| Collection name | `escalations` |
| Indexes (recommended) | `{ escalation_id: 1 }` unique; `{ goal_sheet_id: 1, trigger_type: 1, status: 1 }`; `{ employee_id: 1, status: 1 }`; `{ status: 1, level: 1, created_at: 1 }` |

---

## Shared Concepts

### Goal sheet lifecycle (reference)

Per `docs/WORKFLOWS.md`:

```
DRAFT → SUBMITTED → RETURNED → APPROVED → LOCKED
```

Status values match `GoalSheetStatus` in `backend/models/goal_sheet.py`.

### Manager resolution

`manager_id` on an escalation document is **denormalized** from the owning employee’s `User.manager_id` at creation time. It is not stored on the goal sheet document today.

### Time basis

All thresholds use **UTC** unless a future admin mock-date override is explicitly applied by the escalation job (same pattern as `backend/services/checkin_window.py` for demos).

| Field | Meaning |
|-------|---------|
| `created_at` (goal sheet) | Anchor for **Submission Delay** |
| `updated_at` or last audit entry with `action == "SUBMITTED"` | Anchor for **Approval Delay** (prefer audit log when present) |
| Last day of the closed quarter window | Anchor for **Check-in Delay** evaluation |

### Idempotency

At most **one ACTIVE** escalation per tuple:

- `(goal_sheet_id, trigger_type)` for `SUBMISSION_DELAY` and `APPROVAL_DELAY`
- `(goal_sheet_id, trigger_type, period_label)` for `CHECKIN_DELAY` (e.g. one per missed `Q2`)

Do not create a duplicate if an ACTIVE record already exists for that tuple. If a prior escalation was `RESOLVED` and the same condition occurs again later (e.g. sheet returned to `DRAFT` and stalls again), a **new** document may be created.

### Notifications (informational)

Level 1: flag employee + manager (in-app badge / dashboard tile; email out of scope for demo).  
Level 2: additionally flag Admin / HR dashboard. Exact channels are a frontend concern; this spec only requires `level` and `status` on the document.

---

## Trigger 1: Submission Delay

### Condition

Create an escalation when **all** of the following are true:

1. Goal sheet `status == "DRAFT"`.
2. `now - goal_sheet.created_at > 7 days`.
3. Goal sheet belongs to the **current appraisal period** (same `period_id` as the active cycle), so historical drafts are not escalated indefinitely.
4. No ACTIVE escalation already exists for `(goal_sheet_id, SUBMISSION_DELAY)`.

**Demo note:** Seven days after creation is a practical demo threshold (faster than a full May goal-setting window) while still reflecting “employee has not submitted.”

### Action

Insert escalation document:

| Field | Value |
|-------|--------|
| `trigger_type` | `"SUBMISSION_DELAY"` |
| `level` | `1` |
| `status` | `"ACTIVE"` |
| `created_at` | Current timestamp |

Append to `audit_log`:

```json
{ "action": "CREATED", "timestamp": "<iso>", "actor_id": "system" }
```

### Auto-resolution (recommended behavior for implementers)

Resolve (`status = "RESOLVED"`, set `resolved_at`) when the goal sheet leaves `DRAFT` (e.g. transitions to `SUBMITTED`). Set `resolution_notes` to e.g. `"Goal sheet submitted."`

---

## Trigger 2: Approval Delay

### Condition

Create an escalation when **all** of the following are true:

1. Goal sheet `status == "SUBMITTED"`.
2. No manager action: sheet has **not** transitioned to `APPROVED` or `RETURNED` since submission.
3. `now - submitted_at > 5 days`, where `submitted_at` is:
   - The `timestamp` of the most recent `audit_log` entry whose `action` is `"SUBMITTED"`, **or**
   - `goal_sheet.updated_at` if no such audit entry exists.
4. No ACTIVE escalation for `(goal_sheet_id, APPROVAL_DELAY)`.

**Manager action** means any workflow transition that changes status away from `SUBMITTED` to `APPROVED` or `RETURNED` per `docs/WORKFLOWS.md` and `ALLOWED_TRANSITIONS` in `backend/models/goal_sheet.py`.

### Action

| Field | Value |
|-------|--------|
| `trigger_type` | `"APPROVAL_DELAY"` |
| `level` | `1` |
| `status` | `"ACTIVE"` |

### Auto-resolution

Resolve when status becomes `APPROVED`, `RETURNED`, or `LOCKED`. Notes example: `"Manager approved goal sheet."` / `"Manager returned goal sheet for rework."`

---

## Trigger 3: Check-in Delay

### Condition

Create an escalation when **all** of the following are true:

1. A **quarterly** check-in window (Q1–Q4 only, not Goal Setting) has **closed** per `docs/CHECKIN_RULES.md` and `QUARTER_WINDOW_SCHEDULE` in `backend/services/checkin_window.py`:

   | Quarter | Window (inclusive) |
   |---------|-------------------|
   | Q1 | July |
   | Q2 | October |
   | Q3 | January |
   | Q4 | March–April |

   Evaluation runs on the **first calendar day after** the window’s closing month ends (e.g. 1 August for Q1).

2. Employee’s goal sheet for the active period is in `LOCKED` status (check-ins apply to approved, locked goals).

3. For the **closed quarter** `period_label` (`Q1` | `Q2` | `Q3` | `Q4`), the employee has **no actuals logged**:
   - No document in `check_ins` with matching `goal_sheet_id`, `period_label`, and `created_by == employee_id`, where `actual_value` is present and non-null for at least one goal on that sheet.
   - Empty string, missing field, or placeholder-only rows do **not** count as logged actuals.

4. No ACTIVE escalation for `(goal_sheet_id, CHECKIN_DELAY, period_label)`.

**Demo note:** One day after window close keeps demo runs testable without waiting months; production could add a short grace period (e.g. 2 days) before firing.

### Action

| Field | Value |
|-------|--------|
| `trigger_type` | `"CHECKIN_DELAY"` |
| `level` | `1` |
| `status` | `"ACTIVE"` |

Store the missed quarter in `resolution_notes` prefix or a future optional `period_label` field; until then, embed in notes at creation: e.g. `"Missed Q2 check-in window."`

### Auto-resolution

Resolve when the employee logs at least one qualifying `actual_value` for that `period_label` on the goal sheet (retroactive entry may be blocked by read-only rules outside windows — Admin unlock / mock date is a separate governance path).

---

## Level 2 Promotion

### Condition

Promote an existing escalation when **all** of the following are true:

1. `status == "ACTIVE"`.
2. `level == 1`.
3. `now - created_at > 3 days` (three days at Level 1 without resolution).

### Action

Update the same document (do not insert a new row):

| Field | Change |
|-------|--------|
| `level` | `2` |
| `audit_log` | Append `{ "action": "PROMOTED_TO_LEVEL_2", "timestamp": "<iso>", "actor_id": "system" }` |

Level 2 escalations remain `ACTIVE` until explicitly or automatically resolved. Do not promote again if `level` is already `2`.

**Demo note:** Three days gives reviewers time to act at Level 1 before HR visibility.

---

## Resolution (manual & automatic)

| Actor | Allowed action |
|-------|----------------|
| Admin / HR | Set `status` to `RESOLVED`, set `resolved_at`, optional `resolution_notes` |
| System | Auto-resolve per trigger sections above |

On any resolution, append to `audit_log`:

```json
{ "action": "RESOLVED", "timestamp": "<iso>", "actor_id": "<user_id|system>" }
```

---

## MongoDB Schema: `escalations` Collection

Each document represents one escalation instance.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | Yes | MongoDB primary key |
| `escalation_id` | `string` (UUID) | Yes | Stable external identifier for APIs and exports |
| `goal_sheet_id` | `string` | Yes | Reference to `goal_sheets._id` |
| `employee_id` | `string` | Yes | Owner of the goal sheet (`goal_sheets.employee_id`) |
| `manager_id` | `string` | Yes | L1 manager from `users.manager_id` at creation |
| `trigger_type` | `string` (enum) | Yes | `SUBMISSION_DELAY` \| `APPROVAL_DELAY` \| `CHECKIN_DELAY` |
| `level` | `int` | Yes | `1` or `2` |
| `status` | `string` (enum) | Yes | `ACTIVE` \| `RESOLVED` |
| `created_at` | `datetime` | Yes | Escalation opened (Level 1 creation or promotion timestamp for level changes recorded in audit only) |
| `resolved_at` | `datetime` | No | Set when `status` becomes `RESOLVED` |
| `resolution_notes` | `string` | No | Free text; max 1000 chars recommended |
| `audit_log` | `array` | Yes | See below |

### `audit_log` entry shape

| Field | Type | Description |
|-------|------|-------------|
| `action` | `string` | e.g. `CREATED`, `PROMOTED_TO_LEVEL_2`, `RESOLVED`, `NOTE_ADDED` |
| `timestamp` | `datetime` | UTC |
| `actor_id` | `string` | User `_id` or `"system"` for automated steps |

### Example document

```json
{
  "_id": "ObjectId(...)",
  "escalation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "goal_sheet_id": "674f1a2b3c4d5e6f7a8b9c0d",
  "employee_id": "674f00000000000000000001",
  "manager_id": "674f00000000000000000002",
  "trigger_type": "APPROVAL_DELAY",
  "level": 1,
  "status": "ACTIVE",
  "created_at": "2026-05-10T09:00:00Z",
  "resolved_at": null,
  "resolution_notes": null,
  "audit_log": [
    {
      "action": "CREATED",
      "timestamp": "2026-05-10T09:00:00Z",
      "actor_id": "system"
    }
  ]
}
```

---

## Scheduled evaluation (future implementation notes)

A background job (cron or FastAPI lifespan task) should run **at least daily** and, in order:

1. Evaluate **Submission Delay** and **Approval Delay** against all in-scope goal sheets.
2. Evaluate **Check-in Delay** only on days following a quarter window close.
3. Promote eligible Level 1 rows to Level 2.
4. Apply auto-resolution rules.

This job is **not** implemented as part of this spec.

---

## Summary Table

| Trigger | Threshold | `trigger_type` | Initial `level` |
|---------|-------------|----------------|-----------------|
| Draft not submitted | > 7 days since `created_at` | `SUBMISSION_DELAY` | 1 |
| Submitted, no manager action | > 5 days since submit | `APPROVAL_DELAY` | 1 |
| Quarter window closed, no actuals | Day after window end | `CHECKIN_DELAY` | 1 |
| Level 1 still active | > 3 days since escalation `created_at` | (same row) | 2 |
