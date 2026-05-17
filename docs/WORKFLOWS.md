# Workflows

## 1. Goal Sheet State Machine

### States

| State | Constant | Colour Badge | Description |
|---|---|---|---|
| Draft | `DRAFT` | Grey | Employee is authoring / editing |
| Submitted | `SUBMITTED` | Blue | Awaiting manager review |
| Returned | `RETURNED` | Amber | Sent back by manager; needs revision |
| Approved | `APPROVED` | Green | Manager has approved; check-ins enabled |
| Locked | `LOCKED` | Purple | Final state; no edits allowed |

### Allowed Transitions

```
DRAFT ──[Employee: Submit]──► SUBMITTED
SUBMITTED ──[Manager: Approve]──► APPROVED
SUBMITTED ──[Manager: Return]──► RETURNED
RETURNED ──[Employee: Re-submit]──► SUBMITTED
APPROVED ──[Manager/Admin: Lock]──► LOCKED
DRAFT ──[Employee/Admin: Delete]──► (deleted)
```

No other transitions are permitted. Any attempt to perform an illegal transition must return HTTP 422 with a descriptive error.

---

## 2. Goal Sheet Creation Workflow

```
1. Employee opens "New Goal Sheet" for an active Appraisal Period.
2. System checks: no existing non-DRAFT sheet for this employee + period.
3. Employee adds between 3 and 10 Goals.
4. For each Goal:
   a. Select Thrust Area
   b. Write Description
   c. Choose UoM Type (QUANTITATIVE / QUALITATIVE)
   d. Enter Target Value and Unit of Measure
   e. Assign Weightage %
5. System validates: total weightage == 100 %.
6. Employee clicks "Submit".
7. Goal Sheet transitions DRAFT → SUBMITTED.
8. Manager is notified (future: email/in-app).
```

---

## 3. Manager Review Workflow

```
1. Manager opens "Pending Approvals" list.
2. Manager selects a SUBMITTED Goal Sheet.
3. Manager reviews each goal (description, target, weightage).
4. Decision A — Approve:
   a. Manager clicks "Approve".
   b. Sheet transitions SUBMITTED → APPROVED.
   c. Employee is notified.
5. Decision B — Return:
   a. Manager adds return comment (required, max 1000 chars).
   b. Manager clicks "Return".
   c. Sheet transitions SUBMITTED → RETURNED.
   d. Employee is notified with comments.
```

---

## 4. Employee Re-submission Workflow

```
1. Employee views RETURNED Goal Sheet and reads manager comments.
2. Employee edits goals as required (within validation rules).
3. Employee clicks "Re-submit".
4. Sheet transitions RETURNED → SUBMITTED.
5. Manager is notified again.
```

---

## 5. Check-in Workflow

Triggered once the Goal Sheet reaches `APPROVED` status.

```
1. Employee opens an APPROVED (or LOCKED) Goal Sheet.
2. Employee selects a Goal to check in against.
3. Employee fills:
   - Period Label (Q1 / Q2 / Q3 / Mid-Year / Year-End)
   - Actual Value achieved
   - Remarks (optional)
4. System validates:
   - No duplicate check-in for same goal + period_label
   - check_in_date is within appraisal period
5. Check-in is saved; Achievement % updated on the goal.
```

---

## 6. Lock Workflow

```
1. Manager (or Admin) opens an APPROVED Goal Sheet after the appraisal period closes.
2. Clicks "Lock Sheet".
3. System checks: at least one Year-End check-in exists.
4. Sheet transitions APPROVED → LOCKED.
5. No further edits or check-ins possible.
```

---

## 7. Shared Goal Workflow

See `docs/SHARED_GOALS.md` for the full shared goal workflow.

---

## 8. Audit Trail

Every state transition is recorded in an `audit_log` embedded array on the GoalSheet document:

```json
{
  "action": "SUBMITTED",
  "actor_id": "<user_id>",
  "actor_role": "EMPLOYEE",
  "timestamp": "2025-04-15T10:30:00Z",
  "comment": null
}
```

`comment` is required (non-null) for `RETURNED` actions.
