# AtomQuest Goal Tracking Portal — Submission

## Overview

**Live Demo**: https://atomquest-2026-git-main-gauravmittal06s-projects.vercel.app/  
**GitHub Repository**: https://github.com/GauravMittal06/Atomquest_2026.git  
**Backend API**: https://atomquest-2026-si4h.onrender.com  

AtomQuest is a digital goal-setting and tracking portal that enables employees to create aligned goals, managers to review and approve them, and admins to track organizational performance across the organization.

---

## Tech Stack

- **Frontend**: React · Vite · TypeScript · Tailwind · shadcn/ui (Vercel)
- **Backend**: FastAPI · Python · Motor async MongoDB (Render)
- **Database**: MongoDB Atlas
- **Authentication**: JWT Bearer tokens with role-based access control

---

## Features Implemented

### Must-Have Features ✅

- **Goal Creation & Submission**: Employees create goal sheets with thrust areas, descriptions, targets, and weightages
- **Validation Rules**: Total weightage = 100%, min 10% per goal, max 8 goals per sheet
- **Manager Approval Workflow**: Managers review, edit targets/weightages, approve (lock), or return for rework
- **Goal Lock Mechanism**: After approval, goals are locked; only Admin can unlock with audit logging
- **Quarterly Check-ins**: Employees log actual achievement, self-rating (0-5), and remarks during active windows
- **Progress Scoring**: Automatic calculation based on 4 UoM types (Numeric, Max, Min, Timeline, Zero)
- **Check-in Window Enforcement**: System enforces quarterly windows (Q1, Q2, MID_YEAR, Q3, Q4, YEAR_END)
- **Manager Check-in Review**: Managers add structured remarks on team member achievement
- **CSV Achievement Export**: Admin can export all goals with planned, actual, and score data
- **Audit Trail**: Logs all post-lock changes with user, timestamp, old value, new value
- **Shared Goals (Departmental KPI)**: Managers/Admins push KPIs to multiple employees; weightage-only adjustment for recipients
- **MongoDB References**: Shared goals use references (not duplication); achievement sync automatic
- **Role-Based Access Control**: Employee, Manager, Admin with distinct permissions enforced at API level
- **Completion Dashboard**: Real-time metrics on goal submission and check-in completion rates

### Bonus Features ✅

- **Analytics Module**: Quarter-on-Quarter (QoQ) achievement trends, goal distribution by thrust area, manager effectiveness dashboard with completion rates
- **Escalation System**: Rule-based auto-escalations for unsubmitted goals (N days overdue) and missed check-in deadlines
- **Real-time Metrics**: Recharts-powered dashboards showing department summaries, employee submission status, and score trends

---

## Demo Credentials

**All accounts share the password**: `AtomQuest@2025`

| Role | Email | Employee ID |
|------|-------|-------------|
| Employee | arjun.nair@atomquest.in | EMP001 |
| Manager | rahul.mehta@atomquest.in | MGR001 |
| Admin | sneha.kapoor@atomquest.in | ADM001 |

**Alternative Test Accounts**:
- Employee: `priya.sharma@atomquest.in` (EMP002) — has completed check-ins
- Employee: `kavya.reddy@atomquest.in` (EMP003) — awaiting manager approval
- Employee: `meera.iyer@atomquest.in` (EMP005) — incomplete draft (60% weightage)

---

## User Journeys

### Employee Workflow
1. **Login** → Dashboard shows cycle status and completion metrics
2. **Create Goal Sheet** → Add 3-8 goals with thrust area, description, target, weightage
3. **Validate & Submit** → System checks 100% weightage; submit for approval
4. **Wait for Approval** → Manager reviews (status: Submitted)
5. **After Approval** → Goal sheet locked; edits disabled
6. **Quarterly Check-in** → During active quarter window, log actual achievement and self-rating
7. **View Progress** → See live score calculation and manager feedback

### Manager Workflow
1. **Login** → Team Overview shows 3 direct reports and approval status
2. **Review Goals** → Approvals tab shows submitted goal sheets
3. **Approve or Rework** → Can inline-edit targets/weightages; approve (lock) or return with feedback
4. **Check-in Review** → During quarter, view team member achievement vs. planned target
5. **Add Remarks** → Document discussion notes; visible on employee dashboard
6. **Push Shared KPI** → (Optional) Assign departmental goal to multiple team members

### Admin Workflow
1. **Login** → Dashboard shows organization metrics and completion rates
2. **View All Goal Sheets** → Filter by department, status, period
3. **Export Reports** → Download CSV of all employee achievements with scores
4. **Manage Audit Trail** → View all post-lock changes; filter by user, goal, date
5. **Unlock Goals** → If needed, unlock goal sheets (logged to audit trail)
6. **Escalation Log** → View auto-triggered escalations for overdue submissions/check-ins
7. **System Settings** → Mock the system date for demo testing

---

## Architecture

### 3-Tier System

```
┌─────────────────────────────────────────────────┐
│ TIER 1: Frontend (React · Vite · Vercel)        │
│ - Role-scoped pages for Employee/Manager/Admin  │
│ - JWT auth, role-based UI rendering             │
│ - Axios client with Bearer token headers        │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS REST + JWT
                      ▼
┌─────────────────────────────────────────────────┐
│ TIER 2: Backend API (FastAPI · Render)          │
│ - 14 REST routers (auth, goals, checkins, etc.) │
│ - JWT validation + role-based middleware        │
│ - Domain services (scoring, escalations)        │
│ - Motor async ODM for MongoDB                   │
└─────────────────────┬───────────────────────────┘
                      │ Motor async I/O
                      ▼
┌─────────────────────────────────────────────────┐
│ TIER 3: Database (MongoDB Atlas)                │
│ - Collections: users, goalsheets, goals,        │
│   checkins, audit_log, shared_kpis, escalations│
└─────────────────────────────────────────────────┘
```

### Data Flow
1. Frontend sends HTTPS REST request with JWT Bearer token
2. FastAPI validates JWT and checks role-based permissions
3. Backend queries MongoDB via Motor (async, non-blocking)
4. Response returned as JSON to frontend
5. Frontend updates UI state and displays to user

### Governance
7 specification files in `docs/` govern the system:
- **BRD.md** — Business requirements
- **VALIDATION_RULES.md** — Goal constraints, scoring formulas
- **ROLE_PERMISSIONS.md** — Employee, Manager, Admin access control
- **WORKFLOWS.md** — Status transitions (Draft → Submitted → Approved → Locked)
- **CHECKIN_RULES.md** — Quarterly window scheduling and enforcement
- **SHARED_GOALS.md** — Departmental KPI synchronization rules
- **REPORTING_REQUIREMENTS.md** — CSV export schema, audit log format

---

## Running Locally

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
# Runs on http://localhost:8000
```

### Seed Demo Data
```bash
cd backend
python seed.py
# Loads 5 employees, 2 managers, 1 admin with realistic KPI data
# Uses: mongodb://localhost:27017 (or set MONGODB_URL in .env)
```

### Environment Variables (.env in backend)
```
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/atomquest
JWT_SECRET=your_secret_key_here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
ALLOWED_ORIGINS=http://localhost:5173
```

---

## Testing the Demo

### Quick Employee Test
1. Login as `arjun.nair@atomquest.in` / `AtomQuest@2025`
2. Go to "My Goal Sheet" → See 6 locked goals with check-ins
3. Go to "Check-ins" → View Q1–YEAR_END check-in data
4. See live progress scores and manager remarks

### Quick Manager Test
1. Login as `rahul.mehta@atomquest.in` / `AtomQuest@2025`
2. Go to "Team Overview" → See 3 direct reports
3. Go to "Approvals" → Review submitted goal sheets
4. Go to "Check-ins" → View team member achievement data

### Quick Admin Test
1. Login as `sneha.kapoor@atomquest.in` / `AtomQuest@2025`
2. Go to "Reports" → Download achievement CSV
3. Go to "Completion Dashboard" → See real-time metrics
4. Go to "Audit Trail" → Search for changes

---

## API Documentation

Swagger UI available at: `[Backend URL]/docs`

**Key Endpoints**:
- `POST /api/auth/token` — Login
- `GET /api/users/me` — Current user profile
- `POST /api/goalsheets/` — Create goal sheet
- `GET /api/goalsheets/{id}` — Fetch goal sheet
- `PATCH /api/goalsheets/{id}/approve` — Manager approval
- `PATCH /api/goalsheets/{id}/return` — Manager return for rework
- `POST /api/goals/` — Create goal
- `POST /api/checkins/` — Log check-in achievement
- `GET /api/admin/dashboard` — Admin metrics
- `GET /api/admin/reports/achievement` — CSV export
- `GET /api/escalations/` — Escalation log

---

## Key Implementation Details

### Validation & Error Handling
- Frontend + backend enforce all rules from docs/VALIDATION_RULES.md
- Clear error messages on form validation failures
- 400 Bad Request for constraint violations; 403 Forbidden for permission denied

### Authentication & Authorization
- JWT tokens issued on login, stored in localStorage
- Bearer token sent in Authorization header on all API requests
- Role-based middleware enforces access control (require_roles decorator)

### Data Integrity
- Shared goals use MongoDB references (not duplication)
- Achievement syncs automatically when primary owner updates
- Audit log captures all post-lock changes: user, timestamp, field, old value, new value

### Progress Scoring Formulas
- **Numeric/Max**: `achievement_pct = min(100, (Actual / Target) × 100)`
- **Min**: Same as Numeric with minimum protection
- **Timeline**: `100% if on/before date, else max(0, 100 - days_late × 5)`
- **Zero**: `100% if Actual == Target, else 0%`
- **Goal Score**: `(achievement_pct / 100) × weightage`
- **Overall Score**: Sum of all goal scores

### Quarterly Windows
Windows are centrally defined in `appraisal_periods` collection:
- Q1, Q2, MID_YEAR, Q3, Q4, YEAR_END
- Each window has open and close dates
- Outside windows, check-in inputs are read-only with banner showing "Window Closed"

---

## Submission Contents

✅ Live frontend demo (Vercel)  
✅ Live backend API (Render)  
✅ GitHub repository with full source code  
✅ Architecture diagram (PNG)  
✅ Login credentials for 3 roles  
✅ This README with setup instructions  
✅ API documentation (Swagger)  
✅ Demo data seeder (seed.py)  

---

## Team

**Team Name**: TechSnatchers  
**Hackathon**: AtomQuest Hackathon 2026

---
