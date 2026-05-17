# Check-in Rules

## 1. Definition

A **Check-in** is a point-in-time record of an Employee's actual achievement against a specific Goal, recorded during a named review period within the appraisal cycle.

---

## 2. Eligibility Gate

| Rule | Detail |
|---|---|
| **Goal Sheet status** | Check-ins may only be added when the parent Goal Sheet is `APPROVED` or `LOCKED` |
| **Goal Sheet status — LOCKED** | Check-ins are read-only; no new check-ins can be added to a LOCKED sheet |

> Note: A LOCKED sheet means the sheet itself is finalized; existing check-ins are preserved but no new ones are created.

---

## 3. Period Labels

Valid `period_label` values for a standard annual cycle:

| Label | Typical Timing |
|---|---|
| `Q1` | April – June |
| `Q2` | July – September |
| `MID_YEAR` | October (mid-year review) |
| `Q3` | October – December |
| `Q4` | January – March |
| `YEAR_END` | March (final review) |

- Admin may configure custom period labels per Appraisal Period.
- Only period labels that are **open** (current date is within the review window) are available for new check-ins.

---

## 4. Uniqueness Constraint

- **One check-in per Goal per Period Label** — a duplicate check-in (same `goal_id` + `period_label`) must be rejected with HTTP 422.
- Employees may **update** an existing check-in on the same day it was created (grace edit window: 24 hours). After 24 hours the check-in is immutable unless an Admin overrides.

---

## 5. Field Rules

| Field | Type | Rules |
|---|---|---|
| `goal_id` | ObjectId ref | Must belong to the current employee's approved sheet |
| `period_label` | String enum | Must be a valid, open period label |
| `actual_value` | String or Number | Numeric for QUANTITATIVE goals; text for QUALITATIVE goals |
| `self_rating` | Float (0–5) | Optional; 0.5 increments; used for qualitative scoring |
| `remarks` | String | Optional; max 1 000 characters |
| `check_in_date` | Date | Auto-set to server UTC date; must fall within appraisal period |
| `created_by` | ObjectId ref | Auto-set to authenticated user |

---

## 6. Achievement Calculation

### Quantitative Goal
```
achievement_pct = (actual_value / target_value) × 100
goal_score      = min(achievement_pct, 100) × (weightage / 100)
```

### Qualitative Goal
```
# self_rating_factor maps self_rating (0–5) to a factor:
# 0 → 0.0 | 1 → 0.2 | 2 → 0.4 | 3 → 0.6 | 4 → 0.8 | 5 → 1.0
goal_score = self_rating_factor × weightage
```

At **Year-End**, the latest check-in values are used for final scoring.

---

## 7. Mid-Year Check-in (Special Rules)

- Mid-year check-ins are **recommended but not mandatory** for QUANTITATIVE goals.
- Mid-year check-ins are **mandatory** for goals with weightage ≥ 20 %.
- Missing a mandatory mid-year check-in generates a system warning but does not block the workflow.

---

## 8. Manager Visibility

- Managers can view all check-ins for their direct reports.
- Managers can add a **manager remark** to any check-in (max 500 characters).
- Manager remarks are separate from employee remarks and do not overwrite them.

---

## 9. Shared Goal Check-ins

- Each employee logs their own check-in for shared goals independently.
- The shared counterpart's check-in is visible in read-only mode.
