# Validation Rules

## 1. Thrust Area

| Rule | Detail |
|---|---|
| **Required** | Every goal must have exactly one Thrust Area |
| **Allowed values** | Must be one of the 8 master Thrust Areas defined in `BRD.md §6` |
| **Custom values** | Not permitted; Admin manages the master list |

Valid values (enum):
```
INNOVATION_TECHNOLOGY
QUALITY_PROCESS_EXCELLENCE
CUSTOMER_SATISFACTION
DELIVERY_TIMELINESS
PEOPLE_DEVELOPMENT
BUSINESS_GROWTH
SAFETY_COMPLIANCE
COST_OPTIMISATION
```

---

## 2. UoM Type

| Rule | Detail |
|---|---|
| **Required** | Every goal must specify a UoM Type |
| **Allowed values** | `QUANTITATIVE` or `QUALITATIVE` |

### 2a. Quantitative Goals
- `target_value` must be a **positive finite number** (float, up to 4 decimal places).
- `unit_of_measure` must be a non-empty string (e.g., `%`, `₹ Lakh`, `Number`, `Days`).
- Achievement is recorded as a numeric value.
- Score = `(Actual / Target) × Weightage`, capped at `Weightage` (no over-achievement bonus by default).

### 2b. Qualitative Goals
- `target_value` must be a **non-empty string** describing the expected outcome.
- `unit_of_measure` defaults to `Milestone` if not specified.
- Achievement is recorded as a milestone description or `YES / NO`.
- Score = `Weightage × self_rating_factor` where `self_rating_factor ∈ {0.0, 0.25, 0.50, 0.75, 1.0}`.

---

## 3. Target

| Rule | Detail |
|---|---|
| **Quantitative** | Positive number; must be > 0 |
| **Qualitative** | Non-empty text; max 500 characters |
| **Immutable after approval** | Target cannot be changed once Goal Sheet is `Approved` or `Locked` |

---

## 4. Weightage

| Rule | Detail |
|---|---|
| **Type** | Positive integer or decimal, stored as float |
| **Per goal minimum** | 5 % |
| **Per goal maximum** | 50 % |
| **Sheet total** | Must equal exactly **100 %** (sum of all goal weightages) |
| **Immutable after approval** | Weightage cannot be changed once Goal Sheet is `Approved` or `Locked` |
| **Shared goals** | Each employee sets their own weightage for shared goals; the constraint still applies individually |

---

## 5. Goal Sheet

| Rule | Detail |
|---|---|
| **Min goals** | 3 |
| **Max goals** | 10 |
| **One active sheet per period** | An employee may have only one non-`Draft` sheet per appraisal period |
| **Period** | Must reference a valid, open appraisal period |
| **Duplicate detection** | Two goals with identical Thrust Area + Description are rejected |

---

## 6. User Fields

| Field | Rule |
|---|---|
| `email` | Valid email format; unique in the system |
| `employee_id` | Alphanumeric, 3–20 chars; unique |
| `role` | One of `EMPLOYEE`, `MANAGER`, `ADMIN` |
| `manager_id` | Required for `EMPLOYEE` role; must reference a user with `MANAGER` role |
| `name` | 2–100 characters |
| `department` | Non-empty string |

---

## 7. Check-in Fields

| Field | Rule |
|---|---|
| `period_label` | Non-empty (e.g., `Q1`, `Mid-Year`, `Year-End`) |
| `actual_value` | Numeric for Quantitative goals; text for Qualitative |
| `remarks` | Optional; max 1000 characters |
| `check_in_date` | Must be within the appraisal period dates |
| **Frequency** | At most **one check-in per goal per period_label** |
| **State gate** | Check-ins only allowed when Goal Sheet status is `APPROVED` or `LOCKED` |

---

## 8. Scoring

| Metric | Formula |
|---|---|
| Goal Score | See §2a / §2b above |
| Overall Sheet Score | `Σ (Goal Score)` across all goals |
| Max possible | 100 (= total weightage) |
| Rating Band | Configurable by Admin; default bands: 0–40 (Needs Improvement), 40–60 (Meets Expectations), 60–80 (Exceeds Expectations), 80–100 (Outstanding) |
