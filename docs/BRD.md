# AtomQuest Goal Tracking Portal — Business Requirements Document

## 1. Purpose

AtomQuest is an enterprise goal-tracking portal that enables organisations to define, track, and evaluate employee performance goals across a structured annual cycle. The system supports collaborative goal-setting, manager review workflows, period check-ins, and multi-level reporting.

---

## 2. Scope

| In Scope | Out of Scope |
|---|---|
| Goal Sheet creation & submission | Payroll integration |
| Manager approval / return workflow | Learning Management |
| Periodic check-ins | 360-degree feedback |
| Shared goals between employees | Third-party SSO |
| Reports & dashboards | Mobile native app |

---

## 3. User Roles

| Role | Description |
|---|---|
| **Employee** | Creates and manages their own Goal Sheet, submits for approval, logs check-ins |
| **Manager** | Reviews team Goal Sheets, approves/returns them, locks final sheets |
| **Admin** | Manages users, configures Thrust Areas, oversees all Goal Sheets, generates reports |

---

## 4. Goal Sheet Lifecycle

```
Draft ──► Submitted ──► Approved ──► Locked
              │               │
              ▼               ▼
           Returned ◄──────────
```

- **Draft**: Employee is actively editing the Goal Sheet.
- **Submitted**: Employee has submitted for Manager review. No edits allowed.
- **Returned**: Manager sent back with comments. Employee may edit and re-submit.
- **Approved**: Manager has approved. Check-ins can now be logged.
- **Locked**: Admin or Manager has locked the sheet at year-end. No further changes.

---

## 5. Goal Structure

Each **Goal Sheet** belongs to one Employee and covers one appraisal **Period** (e.g., FY 2025-26).

Each **Goal** within a sheet has:
- Thrust Area (from master list)
- Goal Description
- UoM Type (Quantitative / Qualitative)
- Unit of Measure (e.g., %, Number, Yes/No)
- Target Value
- Weightage (%)
- Achievement (populated via Check-ins)
- Score (computed)

**Constraints:**
- Total weightage of all goals in a sheet **must equal 100 %**.
- Minimum goals per sheet: **3**; Maximum: **10**.
- Individual goal weightage: min **5 %**, max **50 %**.

---

## 6. Thrust Areas (Master List)

1. Innovation & Technology
2. Quality & Process Excellence
3. Customer Satisfaction
4. Delivery & Timeliness
5. People Development & Collaboration
6. Business Growth & Revenue
7. Safety, Compliance & Risk
8. Cost Optimisation

---

## 7. Appraisal Periods

- Configurable by Admin.
- Default cycle: **Annual (April – March)**.
- Mid-year review window (October) triggers optional mid-cycle check-ins.

---

## 8. Shared Goals

- An Employee may link a goal to another Employee as a **Shared Goal**.
- Both employees carry the shared goal in their respective sheets.
- Each employee assigns their own weightage to the shared goal.
- See `docs/SHARED_GOALS.md` for full rules.

---

## 9. Notifications (future scope)

- Email/in-app notification when a Goal Sheet is submitted, approved, returned, or locked.
- Reminder notifications for pending check-ins.

---

## 10. Non-Functional Requirements

| Attribute | Requirement |
|---|---|
| Availability | 99.5 % uptime |
| Response Time | < 2 s for all API calls |
| Security | Role-based access control on every endpoint |
| Data Retention | 5 years of Goal Sheet history |
| Audit Trail | All state changes recorded with timestamp & actor |
