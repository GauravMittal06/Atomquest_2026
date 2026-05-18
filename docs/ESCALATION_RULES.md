# Escalation Rules

## Triggers
1. **Goal Submission Delay:** If an Employee's Goal Sheet remains in 'Draft' status for more than 7 days after the Phase 1 window opens (May 1st).
2. **Approval Delay:** If a Goal Sheet remains in 'Submitted' status for more than 5 days without Manager Approval or Return for Rework.
3. **Check-in Delay:** If an active Quarterly Check-in window (Q1, Q2, Q3, Q4) closes and an Employee has not logged actuals.

## Escalation Chain
- **Level 1:** Auto-flag to Employee & Manager.
- **Level 2:** If unresolved after 3 additional days, auto-flag to Admin/HR.

## Data Schema (MongoDB)
- `escalation_id`: UUID
- `goal_sheet_id`: Reference
- `employee_id`: Reference
- `manager_id`: Reference
- `trigger_type`: string (Submission | Approval | Check-in)
- `level`: integer (1 or 2)
- `status`: string (Active | Resolved)
- `created_at`: Timestamp