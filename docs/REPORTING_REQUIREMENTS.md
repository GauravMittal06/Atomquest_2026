# Reporting Requirements

## 1. Report Access Levels

| Report | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| My Goal Achievement | ✅ Own | ✅ Own | ✅ All |
| Team Summary | ❌ | ✅ Direct reports | ✅ All |
| Thrust Area Distribution | ❌ | ✅ Team | ✅ Org-wide |
| Goal Sheet Status Overview | ❌ | ✅ Team | ✅ All |
| Score Distribution (bell curve) | ❌ | ✅ Team | ✅ All |
| Check-in Compliance | ❌ | ✅ Team | ✅ All |
| Shared Goals Report | ✅ Own | ✅ Team | ✅ All |
| Audit Trail Report | ❌ | ❌ | ✅ |

---

## 2. Report Specifications

### 2.1 My Goal Achievement
**Audience:** Employee  
**Data:** All goals in the current period's approved/locked Goal Sheet with:
- Goal description, Thrust Area, Weightage
- Target vs Actual (latest check-in value)
- Achievement %
- Goal Score
- Overall Sheet Score

**Visualisation:** Horizontal bar chart (Recharts `BarChart`) with colour coding by achievement band.

---

### 2.2 Team Summary
**Audience:** Manager  
**Data:** One row per direct report:
- Employee name, department
- Goal Sheet status badge
- Number of goals, total weightage confirmed (100 %)
- Overall score (if Approved/Locked)
- Check-in compliance %

**Visualisation:** Data table with sortable columns + sparkline score column.

---

### 2.3 Thrust Area Distribution
**Audience:** Manager (team), Admin (org-wide)  
**Data:** Count and average score of goals grouped by Thrust Area.  
**Visualisation:** Recharts `PieChart` / `RadarChart`.

---

### 2.4 Goal Sheet Status Overview
**Audience:** Manager, Admin  
**Data:** Count of sheets by status (Draft, Submitted, Returned, Approved, Locked).  
**Visualisation:** Recharts `BarChart` (stacked) or status count cards.

---

### 2.5 Score Distribution
**Audience:** Manager, Admin  
**Data:** Distribution of overall scores across employees in the selected scope.  
**Visualisation:** Recharts `AreaChart` / histogram approximated with `BarChart`.

---

### 2.6 Check-in Compliance
**Audience:** Manager, Admin  
**Data:** Per employee, per period label — did they submit a check-in? Yes/No.  
**Visualisation:** Heat-map style table; colour = green (compliant), red (missing), grey (not yet due).

---

### 2.7 Audit Trail Report
**Audience:** Admin only  
**Data:** All state transitions across all Goal Sheets, filterable by:
- Date range
- Employee
- Action (SUBMITTED, APPROVED, RETURNED, LOCKED)

**Export:** CSV with columns: `timestamp, actor_name, actor_role, sheet_id, employee_name, action, comment`

---

## 3. Export Formats

| Format | Availability |
|---|---|
| **CSV** | Manager (team), Admin (all) |
| **PDF** | Admin only (future scope) |
| **On-screen** | All roles (within access level) |

---

## 4. Filters Common to All Reports

- **Appraisal Period** (required)
- **Department** (Manager/Admin only)
- **Employee** (Admin only)
- **Thrust Area** (optional)
- **Status** (optional)

---

## 5. Real-time vs. Snapshot

- All reports are **real-time** (query MongoDB on demand) in the MVP.
- Future: scheduled nightly snapshots for performance on large datasets.

---

## 6. Dashboard KPI Cards

Each role dashboard must display the following summary cards:

### Employee Dashboard
| Card | Value |
|---|---|
| Goals Defined | Count of goals in active sheet |
| Weightage Confirmed | `100 %` or `X % (incomplete)` |
| Check-ins Logged | Count / required count |
| Current Score | Computed overall score |

### Manager Dashboard
| Card | Value |
|---|---|
| Team Size | Count of direct reports |
| Pending Approvals | Count of SUBMITTED sheets |
| Approved Sheets | Count |
| Avg Team Score | Mean overall score (Approved/Locked only) |

### Admin Dashboard
| Card | Value |
|---|---|
| Total Employees | Count of active users |
| Sheets by Status | Breakdown counts |
| Overall Org Score | Mean score (Approved/Locked sheets) |
| Check-in Compliance | Org-wide % |
