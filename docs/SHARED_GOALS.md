# Shared Goals

## 1. Definition

A **Shared Goal** is a goal that two employees agree to work on jointly. Both employees carry an independent copy of the goal in their respective Goal Sheets, each with their own weightage and achievement tracking.

---

## 2. Eligibility Rules

| Rule | Detail |
|---|---|
| **Same organisation** | Both employees must belong to the same organisation |
| **Same Thrust Area** | Shared goals must have identical Thrust Area |
| **Active Goal Sheets** | Both employees must have an active (non-LOCKED) Goal Sheet for the same Appraisal Period |
| **Max shared goals per sheet** | Up to 3 shared goals per Goal Sheet |
| **Self-sharing** | An employee cannot share a goal with themselves |
| **Cross-role sharing** | Employee ↔ Manager sharing is permitted; Admin sharing is not permitted |

---

## 3. Initiation Workflow

```
1. Employee A creates a goal in their DRAFT Goal Sheet.
2. Employee A clicks "Mark as Shared" and searches for Employee B.
3. System validates eligibility rules (same org, same Thrust Area, etc.).
4. A "share request" is created with status PENDING.
5. Employee B receives a notification.
6. Employee B opens the share request and either:
   a. Accepts → A copy of the goal is added to B's Draft Goal Sheet
                  with the shared metadata populated.
   b. Declines → Request is marked DECLINED; goal remains unshared on A's sheet.
```

---

## 4. Data Model

Each shared goal carries a `shared_goal_ref` object:

```json
{
  "shared_goal_ref": {
    "is_shared": true,
    "originator_id": "<user_id of Employee A>",
    "partner_id":    "<user_id of Employee B>",
    "request_status": "ACCEPTED",   // PENDING | ACCEPTED | DECLINED
    "link_id": "<common UUID linking the two goal copies>"
  }
}
```

Both goal copies (on A's sheet and B's sheet) carry the same `link_id`.

---

## 5. Weightage Rules for Shared Goals

- Each employee assigns **their own weightage** to the shared goal.
- The 100 % total weightage rule applies **individually** to each employee's sheet.
- There is no requirement for both employees to assign the same weightage.

---

## 6. Target & Description Sync

| Attribute | Sync Behaviour |
|---|---|
| `thrust_area` | Synced; must match on both copies |
| `description` | Synced (changing on one propagates to the other while both sheets are DRAFT) |
| `uom_type` | Synced |
| `target_value` | Synced |
| `unit_of_measure` | Synced |
| `weightage` | **Not synced** — each employee sets independently |
| `actual_value` (check-ins) | **Not synced** — each employee logs independently |

Sync is blocked once either employee's sheet is `SUBMITTED` or beyond.

---

## 7. Un-sharing a Goal

- Un-sharing is permitted only while **both** sheets are in `DRAFT` or `RETURNED` state.
- When un-shared:
  - The `shared_goal_ref.is_shared` flag is set to `false` on both copies.
  - Both employees retain their own copy of the goal independently.
  - The `link_id` is preserved for audit purposes.

---

## 8. Display Rules

- On the Goal Sheet view, shared goals display a "Shared" badge and the partner employee's name.
- The partner's achievement is visible in read-only mode next to the current user's achievement.

---

## 9. Scoring Impact

- Shared goals contribute to each employee's overall score **independently**.
- There is no penalty or bonus for having shared goals.
- Each employee is scored against their own target and weightage.
