# AtomQuest Goal Tracking Portal — Submission

## Overview

**Live Demo**: [atomquest-2026-git-main-gauravmittal06s-projects.vercel.app]  
**Backend API**: [Backend URL]

AtomQuest is a digital goal-setting and tracking portal that enables employees to create aligned goals, managers to review and approve them, and admins to track organizational performance.

---

## Tech Stack

- **Frontend**: React · Vite · TypeScript · Tailwind · shadcn/ui (Vercel)
- **Backend**: FastAPI · Python · Motor async MongoDB (Render)
- **Database**: MongoDB Atlas
- **Authentication**: JWT Bearer tokens

---

## Features Implemented

### Must-Have
✅ Employee goal creation with weightage validation (100% total, 10% min, 8 max)  
✅ Manager approval workflow with inline editing  
✅ Goal lock after approval  
✅ Quarterly check-in tracking with achievement logging  
✅ Progress scoring (Numeric, Max, Min, Timeline, Zero UoM types)  
✅ CSV export of achievement reports  
✅ Audit trail (all post-lock changes logged)  
✅ Completion dashboard (real-time metrics)  
✅ Shared goals (departmental KPI sync via MongoDB references)  
✅ Role-based access control (Employee, Manager, Admin)  

### Bonus
✅ Analytics dashboard (QoQ trends, goal distribution, completion rates)  
✅ Escalation module (rule-based auto-escalations)  

---

## User Roles & Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Employee | priya@atomquest.com | demo123 |
| Manager | rahul@atomquest.com | demo123 |
| Admin | sneha@atomquest.com | demo123 |

*Use the role switcher (top-right) to demo different roles without re-login.*

---

## User Journeys

### Employee
1. Login → Dashboard
2. Create Goal Sheet (select thrust area, set target, weightage)
3. Submit for approval
4. Wait for manager approval (status: Locked)
5. During quarterly window: Log actual achievement & remarks
6. View progress score (live calculation)
7. See manager feedback

### Manager
1. Login → Team Overview
2. Review submitted goal sheets
3. Approve (lock) or return for rework
4. During check-in window: Add remarks on team member achievement
5. Push departmental KPI to multiple employees (optional)

### Admin
1. Login → All Goal Sheets
2. View organization-wide metrics
3. Export achievement report (CSV)
4. View audit trail (all post-lock changes)
5. Unlock goal sheets if needed
6. Manage users and cycles

---

## Setup & Run Locally

### Frontend
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
# http://localhost:8000
```

### Environment Variables (.env in backend)
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_secret_key
JWT_ALGORITHM=HS256

### Seed Demo Data
```bash
python seed.py
```

---

## Architecture

**3-Tier System**:
1. **Frontend** (Vercel): React app with role-scoped pages
2. **Backend** (Render): FastAPI with 14 REST routers
3. **Database** (MongoDB Atlas): 10 collections (users, goalsheets, goals, checkins, audit_log, shared_kpis, checkin_comments, escalations, appraisal_periods, system)

**API**: HTTPS REST with JWT Bearer authentication  
**Database**: Motor async ODM for non-blocking MongoDB operations

See `AtomQuest_Architecture_Diagram.png` for visual reference.

---

## API Documentation

Available at `[Backend URL]/docs` (Swagger UI)

**Key Routers**:
- `/api/auth` — Login, token issuance
- `/api/goalsheets` — Create, approve, unlock goal sheets
- `/api/goals` — CRUD goals, submit sheets
- `/api/checkins` — Create/update check-ins, log achievements
- `/api/manager` — Manager-specific operations
- `/api/admin` — Admin dashboards, reports, escalations
- `/api/shared-kpis` — Push departmental KPIs
- `/api/system` — Cycle status, mock dates

---

## Key Implementation Details

### Validation
- Frontend + backend enforce all rules from docs/VALIDATION_RULES.md
- Weightage total = 100%, min 10% per goal, max 8 goals
- Quarterly windows prevent out-of-window edits

### Authentication
- JWT tokens stored in localStorage
- Role-based middleware on all API routes
- `require_roles()` decorator enforces access control

### Data Integrity
- Shared goals use MongoDB references (not duplication)
- Achievement sync automatic via references
- Audit log captures all post-lock changes with old/new values

### Progress Scoring
- **Numeric/Max**: (Actual / Target) × 100%
- **Min**: (Actual / Target) × 100% with minimum protection
- **Timeline**: Date comparison (on-time / late)
- **Zero**: Binary (Yes/No)
- Goal Score = Achievement% × Weightage%
- Overall Score = Sum of all goal scores

---

## Testing the Demo

### Employee Workflow
1. Login as Employee
2. Go to "My Goal Sheet" → Create 3 goals with different thrust areas
3. Set targets and ensure weightage totals 100%
4. Submit for approval
5. Switch to Manager role via dropdown
6. Go to Approvals → Approve the goals (status → Locked)
7. During Q4 (if in check-in window): Switch back to Employee
8. Go to Check-ins → Log actual achievements
9. View live progress scores update

### Admin Workflow
1. Login as Admin
2. Go to "Reports" → Download achievement CSV
3. View "Completion Dashboard" → See real-time metrics
4. Go to "Audit Trail" → Search for changes (none visible if not unlocked)
5. Unlock a goal sheet → New audit entry appears
6. View "Escalations" → See any auto-triggered escalations

---

## Submission Contents

- ✅ Live frontend demo (Vercel)
- ✅ Live backend API (Render)
- ✅ GitHub repository with full source code
- ✅ Architecture diagram (PNG)
- ✅ Login credentials (3 roles)
- ✅ README (this file)
- ✅ Environment setup instructions
- ✅ API documentation (Swagger)

---

## Known Limitations

- Microsoft Entra ID SSO not implemented (email/password auth only)
- Email notifications are mocked (no actual emails sent)
- Escalation auto-triggering requires manual review

---

**Team**: TexhSnatxhers 
**Hackathon**: AtomQuest Hackathon 1.0
