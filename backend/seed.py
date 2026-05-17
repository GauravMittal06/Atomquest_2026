#!/usr/bin/env python3
"""
backend/seed.py — AtomQuest Goal Tracking Portal development data seeder.

Seeds realistic corporate KPI data following ALL rules in docs/:
  ROLE_PERMISSIONS.md  → roles, manager_id constraints
  WORKFLOWS.md         → status values, audit log transitions
  VALIDATION_RULES.md  → Thrust Areas, UoM types, target rules, weightage
  CHECKIN_RULES.md     → period labels, state gate, uniqueness, scoring

╔══════════════════════════╦══════════════╦══════════════════════════════════╗
║ User                     ║ Sheet Status ║ Notes                            ║
╠══════════════════════════╬══════════════╬══════════════════════════════════╣
║ Arjun Nair       EMP001  ║ LOCKED       ║ Full Q1→YEAR_END check-in history║
║ Priya Sharma     EMP002  ║ APPROVED     ║ Q1–Q3 check-ins; Q4 pending      ║
║ Kavya Reddy      EMP003  ║ SUBMITTED    ║ Awaiting manager review          ║
║ Siddharth Joshi  EMP004  ║ RETURNED     ║ Manager return comment included  ║
║ Meera Iyer       EMP005  ║ DRAFT        ║ Still being authored             ║
╠══════════════════════════╬══════════════╩══════════════════════════════════╣
║ Rahul Mehta      MGR001  ║ Manager — Engineering & Technology             ║
║ Ananya Krishnan  MGR002  ║ Manager — Operations & Strategy                ║
║ Sneha Kapoor     ADM001  ║ Administrator                                  ║
╚══════════════════════════╩════════════════════════════════════════════════╝

Password for all seeded users: AtomQuest@2025

Usage
-----
    cd backend && python seed.py
    python seed.py --uri "mongodb+srv://user:pass@cluster/"
    python seed.py --db staging_atomquest
    python seed.py --dry-run        # print document counts without writing
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Force UTF-8 output on Windows so Unicode symbols render correctly
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import bcrypt as _bcrypt_lib
from bson import ObjectId
from pymongo import MongoClient

# ── Load .env (optional; python-dotenv may not be installed globally) ────────
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

# ── Defaults ─────────────────────────────────────────────────────────────────
DEFAULT_URI = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DEFAULT_DB  = os.getenv("DATABASE_NAME", "atomquest")
SEED_PWD    = "AtomQuest@2025"

# ── Collection names (mirror database.py) -------------------------------------
COL_USERS    = "users"
COL_SHEETS   = "goal_sheets"
COL_GOALS    = "goals"
COL_CHECKINS = "checkins"
COL_PERIODS  = "appraisal_periods"


def _ok(msg: str)   -> None: print(f"  [OK]   {msg}")
def _info(msg: str) -> None: print(f"  [..]   {msg}")
def _warn(msg: str) -> None: print(f"  [!!]   {msg}")
def _head(msg: str) -> None: print(f"\n{'=' * 60}\n  {msg}\n{'=' * 60}")


# ═════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═════════════════════════════════════════════════════════════════════════════

def hp(plain: str) -> str:
    """Bcrypt-hash a plain-text password (VALIDATION_RULES.md §6).

    Uses the bcrypt package directly to avoid passlib/bcrypt compatibility
    issues on Python 3.13+. The $2b$ hash format is identical to what
    passlib emits, so auth.py's verify_password() continues to work.
    """
    return _bcrypt_lib.hashpw(plain.encode("utf-8"), _bcrypt_lib.gensalt()).decode("utf-8")


def utc(year: int, month: int, day: int,
        hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


def quant_score(actual: float, target: float, weightage: float) -> tuple[float, float]:
    """
    QUANTITATIVE scoring (CHECKIN_RULES.md §6):
      achievement_pct = (actual / target) × 100
      goal_score      = min(achievement_pct, 100) × (weightage / 100)
    """
    ach   = round((actual / target) * 100, 2)
    score = round(min(ach, 100.0) * (weightage / 100.0), 4)
    return ach, score


def qual_score(self_rating: float, weightage: float) -> float:
    """
    QUALITATIVE scoring (CHECKIN_RULES.md §6):
      factor = self_rating / 5  →  goal_score = factor × weightage
    """
    return round((self_rating / 5.0) * weightage, 4)


def sid() -> str:
    """Stringify a new ObjectId."""
    return str(ObjectId())


# ═════════════════════════════════════════════════════════════════════════════
# PRE-GENERATED IDs — deterministic cross-references
# ═════════════════════════════════════════════════════════════════════════════

_R: dict[str, ObjectId] = {k: ObjectId() for k in [
    "admin", "mgr1", "mgr2",
    "emp1", "emp2", "emp3", "emp4", "emp5",
    "period",
    "sh1", "sh2", "sh3", "sh4", "sh5",
]}

# 6 goals for emp1/emp2; 5 goals for emp3/emp4/emp5
_G: dict[str, list[ObjectId]] = {
    "emp1": [ObjectId() for _ in range(6)],
    "emp2": [ObjectId() for _ in range(6)],
    "emp3": [ObjectId() for _ in range(5)],
    "emp4": [ObjectId() for _ in range(5)],
    "emp5": [ObjectId() for _ in range(5)],
}

# Check-in timestamps — all within period review windows (CHECKIN_RULES.md §3)
_CI_DATES: dict[str, datetime] = {
    "Q1":       utc(2025, 6, 27, 14, 30),
    "Q2":       utc(2025, 9, 26, 11,  0),
    "MID_YEAR": utc(2025, 10, 17, 15, 45),
    "Q3":       utc(2025, 12, 28, 10, 30),
    "Q4":       utc(2026, 3,  15, 16,  0),
    "YEAR_END": utc(2026, 3,  28,  9,  0),
}


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Appraisal Period
# ═════════════════════════════════════════════════════════════════════════════

def build_period() -> dict:
    return {
        "_id": _R["period"],
        "label": "FY 2025-26",
        "start_date": utc(2025, 4, 1),
        "end_date":   utc(2026, 3, 31),
        "is_active":  True,
        "review_windows": {
            "Q1":       {"open": utc(2025, 6, 15), "close": utc(2025, 6, 30)},
            "Q2":       {"open": utc(2025, 9, 15), "close": utc(2025, 9, 30)},
            "MID_YEAR": {"open": utc(2025, 10, 1), "close": utc(2025, 10, 31)},
            "Q3":       {"open": utc(2025, 12, 15), "close": utc(2025, 12, 31)},
            "Q4":       {"open": utc(2026, 3,  1),  "close": utc(2026, 3, 20)},
            "YEAR_END": {"open": utc(2026, 3, 21),  "close": utc(2026, 3, 31)},
        },
        "created_by": str(_R["admin"]),
        "created_at": utc(2025, 3, 15, 10, 0),
    }


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Users (roles per ROLE_PERMISSIONS.md)
# ═════════════════════════════════════════════════════════════════════════════

def build_users() -> list[dict]:
    _hpwd = hp(SEED_PWD)
    base  = utc(2025, 3, 20, 9, 0)

    def _user(uid, eid, name, email, role, dept, phone, mgr=None) -> dict:
        return {
            "_id":             uid,
            "employee_id":     eid,
            "name":            name,
            "email":           email,
            "role":            role,
            "department":      dept,
            "phone":           phone,
            "profile_picture": None,
            "manager_id":      str(mgr) if mgr else None,
            "is_active":       True,
            "hashed_password": _hpwd,
            "created_at":      base,
            "updated_at":      base,
        }

    return [
        _user(_R["admin"], "ADM001", "Sneha Kapoor",
              "sneha.kapoor@atomquest.in",    "ADMIN",    "HR & Administration",        "+91-98765-00001"),
        _user(_R["mgr1"],  "MGR001", "Rahul Mehta",
              "rahul.mehta@atomquest.in",     "MANAGER",  "Engineering & Technology",   "+91-98765-00002"),
        _user(_R["mgr2"],  "MGR002", "Ananya Krishnan",
              "ananya.krishnan@atomquest.in", "MANAGER",  "Operations & Strategy",      "+91-98765-00003"),
        # Employees under MGR001
        _user(_R["emp1"],  "EMP001", "Arjun Nair",
              "arjun.nair@atomquest.in",      "EMPLOYEE", "Engineering & Technology",   "+91-98765-10001", _R["mgr1"]),
        _user(_R["emp2"],  "EMP002", "Priya Sharma",
              "priya.sharma@atomquest.in",    "EMPLOYEE", "Engineering & Technology",   "+91-98765-10002", _R["mgr1"]),
        _user(_R["emp5"],  "EMP005", "Meera Iyer",
              "meera.iyer@atomquest.in",      "EMPLOYEE", "Engineering & Technology",   "+91-98765-10005", _R["mgr1"]),
        # Employees under MGR002
        _user(_R["emp3"],  "EMP003", "Kavya Reddy",
              "kavya.reddy@atomquest.in",     "EMPLOYEE", "Operations & Strategy",      "+91-98765-10003", _R["mgr2"]),
        _user(_R["emp4"],  "EMP004", "Siddharth Joshi",
              "siddharth.joshi@atomquest.in", "EMPLOYEE", "Operations & Strategy",      "+91-98765-10004", _R["mgr2"]),
    ]


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Goal + Check-in raw definitions
#
# Each goal dict contains:
#   Standard GoalInDB fields  +
#   "_ci": dict[period_label → {actual, remarks[, self_rating, manager_remark]}]
#
# _ci is stripped before inserting into the goals collection.
# Quantitative check-ins use "actual" (numeric).
# Qualitative check-ins use "actual" (text) + "self_rating" (0-5 int).
# ═════════════════════════════════════════════════════════════════════════════

def _goal(gid, sheet_id, owner_id,
          thrust, desc, uom, unit, target, weightage,
          checkins: dict | None = None) -> dict:
    """Build a goal document, embedding _ci check-in data for later extraction."""
    return {
        "_id":            gid,
        "goal_sheet_id":  str(sheet_id),
        "owner_id":       str(owner_id),
        "thrust_area":    thrust,
        "description":    desc,
        "uom_type":       uom,
        "unit_of_measure": unit,
        "target_value":   target,
        "weightage":      float(weightage),
        "shared_goal_ref": {"is_shared": False},
        # Score fields populated later from _ci
        "latest_actual_value": None,
        "achievement_pct":     None,
        "goal_score":          None,
        # Hidden key — extracted when building check-in documents
        "_ci": checkins or {},
    }


# ─── EMP1: Arjun Nair — LOCKED (full Q1→YEAR_END) ──────────────────────────

def _goals_emp1() -> list[dict]:
    sh, ow = _R["sh1"], _R["emp1"]
    gs = _G["emp1"]
    return [
        _goal(gs[0], sh, ow,
              "BUSINESS_GROWTH",
              "Increase Q3 net sales revenue by 15 %",
              "Numeric", "%", 15.0, 25,
              checkins={
                  "Q1":       {"actual": 3.2,  "remarks": "Pipeline strong. Three new accounts signed in April."},
                  "Q2":       {"actual": 7.8,  "remarks": "Seasonal uptick in July. Bulk order from key account closed."},
                  "MID_YEAR": {"actual": 9.5,  "remarks": "Slightly below mid-year 10 % milestone; root-cause action plan activated."},
                  "Q3":       {"actual": 12.1, "remarks": "Recovered. Q3 enterprise deals closed ahead of schedule."},
                  "Q4":       {"actual": 14.3, "remarks": "Year-end sprint underway. Three pending deals in final negotiation."},
                  "YEAR_END": {"actual": 16.2, "remarks": "Exceeded target. New client acquisitions in Nov–Jan drove outperformance.",
                               "manager_remark": "Outstanding result — 8 % above target. Featured in Q4 executive review."},
              }),
        _goal(gs[1], sh, ow,
              "SAFETY_COMPLIANCE",
              "Achieve zero Lost Time Incidents across all project sites for FY 2025-26",
              "Timeline", "Milestone",
              "Zero LTI and near-misses recorded in the HSE register throughout FY 2025-26",
              20,
              checkins={
                  "Q1":       {"actual": "Two near-misses reported and closed within 24 h. Zero LTI.",      "self_rating": 4, "remarks": "Near-miss investigation reports filed. Corrective actions verified."},
                  "Q2":       {"actual": "Zero incidents Q2. Safety awareness campaign completed.",          "self_rating": 4, "remarks": "Toolbox talks conducted weekly. No incidents."},
                  "MID_YEAR": {"actual": "HSE mid-year audit passed with zero non-conformances.",            "self_rating": 5, "remarks": "External auditor confirmed zero open findings."},
                  "Q3":       {"actual": "Zero incidents for 6 consecutive months. Streak maintained.",      "self_rating": 5, "remarks": "Recognition plaque issued to site team."},
                  "Q4":       {"actual": "Continued zero-incident streak through Q4. No near-misses.",       "self_rating": 5, "remarks": "Induction training updated for new joiners."},
                  "YEAR_END": {"actual": "Full FY 2025-26 completed with zero LTI and zero near-misses.",   "self_rating": 5, "remarks": "HSE award received at company annual day.",
                               "manager_remark": "Exemplary safety culture. Site now a best-practice benchmark."},
              }),
        _goal(gs[2], sh, ow,
              "DELIVERY_TIMELINESS",
              "Reduce average service request turnaround time (TAT) by 20 %",
              "Numeric", "% reduction", 20.0, 20,
              checkins={
                  "Q1":       {"actual": 5.0,  "remarks": "Baseline TAT measured. Quick wins from queue-management tool."},
                  "Q2":       {"actual": 10.5, "remarks": "Process re-engineering at Tier-1 support yielding results."},
                  "MID_YEAR": {"actual": 12.0, "remarks": "50 % of annual target achieved at mid-year. On track."},
                  "Q3":       {"actual": 16.3, "remarks": "Automation of repeat requests accelerating reduction."},
                  "Q4":       {"actual": 19.1, "remarks": "Near target. Final bottleneck (Level-2 escalation SLA) under review."},
                  "YEAR_END": {"actual": 21.5, "remarks": "Exceeded 20 % reduction target by 1.5 pp. L2 SLA renegotiated.",
                               "manager_remark": "Solid delivery. Reduction methodology to be shared with other teams."},
              }),
        _goal(gs[3], sh, ow,
              "QUALITY_PROCESS_EXCELLENCE",
              "Achieve ≥ 95 % first-time quality pass rate in manufacturing inspection",
              "Numeric", "%", 95.0, 15,
              checkins={
                  "Q1":       {"actual": 88.0, "remarks": "Baseline established. Inspector training programme commenced."},
                  "Q2":       {"actual": 90.5, "remarks": "Updated inspection checklist deployed; defect rate falling."},
                  "MID_YEAR": {"actual": 91.8, "remarks": "Steady improvement. Root-cause analysis on repeat failures ongoing."},
                  "Q3":       {"actual": 92.7, "remarks": "Primary failure mode eliminated. Closing in on 95 %."},
                  "Q4":       {"actual": 93.8, "remarks": "Very close. Final pre-production audit scheduled."},
                  "YEAR_END": {"actual": 93.2, "remarks": "Narrowly missed 95 % target; 1.8 pp gap due to supplier component variance.",
                               "manager_remark": "Good progress from 88 % baseline. Supplier corrective action plan to carry into next FY."},
              }),
        _goal(gs[4], sh, ow,
              "CUSTOMER_SATISFACTION",
              "Maintain CSAT score of ≥ 4.5 / 5 across all enterprise accounts",
              "Numeric", "Score / 5", 4.5, 10,
              checkins={
                  "Q1":       {"actual": 4.2,  "remarks": "Feedback indicates quick-win improvements in response time."},
                  "Q2":       {"actual": 4.4,  "remarks": "Response time SLA improved. Customers noting positive change."},
                  "MID_YEAR": {"actual": 4.5,  "remarks": "Hit 4.5 for the first time. Exceeded mid-year target."},
                  "Q3":       {"actual": 4.6,  "remarks": "Sustained above target. Proactive escalation process praised."},
                  "Q4":       {"actual": 4.7,  "remarks": "Customer feedback very positive. Renewal conversations positive."},
                  "YEAR_END": {"actual": 4.7,  "remarks": "Consistent ≥ 4.5 maintained throughout H2. Three accounts gave 5 / 5.",
                               "manager_remark": "Consistently above target. Nominating Arjun for CX Excellence award."},
              }),
        _goal(gs[5], sh, ow,
              "PEOPLE_DEVELOPMENT",
              "Complete ISO 9001 Lead Auditor certification by December 2025",
              "Timeline", "Milestone",
              "ISO 9001 Lead Auditor certificate from an accredited body obtained and submitted to HR",
              10,
              checkins={
                  "Q1":       {"actual": "Enrolled in CQI-IRCA accredited Lead Auditor training programme.",  "self_rating": 1, "remarks": "Training scheduled for July–Aug 2025."},
                  "Q2":       {"actual": "Completed 5-day classroom training. Exam scheduled for Sep 2025.",   "self_rating": 2, "remarks": "Part 1 of audit practical submitted."},
                  "MID_YEAR": {"actual": "Written exam passed (score 81 %). Practical audit witness phase commenced.", "self_rating": 3, "remarks": "Two internal audits observed as trainee."},
                  "Q3":       {"actual": "Practical audit completed. Certificate issuance pending from body.",          "self_rating": 4, "remarks": "Certificate expected by end of Nov 2025."},
                  "Q4":       {"actual": "ISO 9001 Lead Auditor certificate received on 18 Nov 2025.",                 "self_rating": 5, "remarks": "Certificate uploaded to HR records."},
                  "YEAR_END": {"actual": "Led first internal ISO 9001 surveillance audit successfully.",               "self_rating": 5, "remarks": "Audit report accepted by MR. Three minor observations raised.",
                               "manager_remark": "Excellent progression. Assigned as Lead Auditor for next year's re-certification."},
              }),
    ]


# ─── EMP2: Priya Sharma — APPROVED (Q1–Q3 check-ins) ───────────────────────

def _goals_emp2() -> list[dict]:
    sh, ow = _R["sh2"], _R["emp2"]
    gs = _G["emp2"]
    return [
        _goal(gs[0], sh, ow,
              "INNOVATION_TECHNOLOGY",
              "Launch AI-assisted code review pipeline reducing average review time by 30 %",
              "Numeric", "% reduction", 30.0, 25,
              checkins={
                  "Q1":       {"actual": 5.0,  "remarks": "PoC completed. Three tools evaluated; LLM-based tool selected."},
                  "Q2":       {"actual": 12.0, "remarks": "Pilot live on 2 repositories. 40 % of annual target reached."},
                  "MID_YEAR": {"actual": 17.0, "remarks": "Rolled out to 5 repositories. Mid-year target exceeded."},
                  "Q3":       {"actual": 22.0, "remarks": "Scale-out to 10 repos ongoing. Targeting 30 % by Q4.",
                               "manager_remark": "Good progress. Accelerate adoption — share Q4 repo coverage plan."},
              }),
        _goal(gs[1], sh, ow,
              "DELIVERY_TIMELINESS",
              "Reduce sprint carryover by 5 percentage points (baseline: 9.8 %)",
              "Numeric", "pp reduction", 5.0, 20,
              checkins={
                  "Q1":       {"actual": 1.5, "remarks": "Sprint planning improvements and DoR enforcement implemented."},
                  "Q2":       {"actual": 3.0, "remarks": "Carryover reduced further via structured backlog grooming."},
                  "MID_YEAR": {"actual": 3.8, "remarks": "On track. Story-splitting process yielding consistent results."},
                  "Q3":       {"actual": 4.2, "remarks": "0.8 pp short of target. Dependency blockers the main cause."},
              }),
        _goal(gs[2], sh, ow,
              "QUALITY_PROCESS_EXCELLENCE",
              "Achieve and maintain > 85 % automated test coverage across all production services",
              "Numeric", "%", 85.0, 20,
              checkins={
                  "Q1":       {"actual": 72.0, "remarks": "Coverage baseline established. Gap analysis across 18 services done."},
                  "Q2":       {"actual": 78.5, "remarks": "New CI pipeline enforces coverage gates on every PR."},
                  "MID_YEAR": {"actual": 80.0, "remarks": "Steady progress. 5 pp gap remains. Focus on legacy services next."},
                  "Q3":       {"actual": 81.0, "remarks": "Slight slowdown due to major feature sprint. Legacy service coverage tackled in Q4."},
              }),
        _goal(gs[3], sh, ow,
              "PEOPLE_DEVELOPMENT",
              "Mentor two junior engineers to mid-level competency within FY 2025-26",
              "Timeline", "Milestone",
              "Both mentees rated 'Meets Expectations' or promoted at mid-year / year-end review",
              15,
              checkins={
                  "Q1":       {"actual": "Mentorship structure established. Weekly 1:1s and learning plans created.",              "self_rating": 2, "remarks": "Both mentees onboarded to mentorship programme."},
                  "Q2":       {"actual": "Both mentees assigned solo feature tasks. First PR reviews completed.",                  "self_rating": 3, "remarks": "Progress ahead of schedule for one mentee."},
                  "MID_YEAR": {"actual": "Mentee A delivered a mid-complexity feature independently. Mentee B on track.",          "self_rating": 4, "remarks": "Mid-year performance calibration reflects strong growth."},
                  "Q3":       {"actual": "Both mentees demonstrating ownership. Mentee B leading first sprint planning.",          "self_rating": 4, "remarks": "Final readiness assessment scheduled for Q4.",
                               "manager_remark": "Good mentoring outcomes. Confirm year-end evaluation dates with HR."},
              }),
        _goal(gs[4], sh, ow,
              "COST_OPTIMISATION",
              "Reduce cloud infrastructure spend by 10 % YoY through rightsizing and Reserved Instances",
              "Numeric", "% reduction", 10.0, 10,
              checkins={
                  "Q1":       {"actual": 2.0, "remarks": "Audit of idle instances and over-provisioned RDS clusters completed."},
                  "Q2":       {"actual": 4.5, "remarks": "Reserved Instance migrations for steady-state workloads started."},
                  "MID_YEAR": {"actual": 5.5, "remarks": "On track at 55 % of annual target. Spot instances for batch jobs next."},
                  "Q3":       {"actual": 7.0, "remarks": "Spot instance adoption and S3 lifecycle policies driving savings."},
              }),
        _goal(gs[5], sh, ow,
              "CUSTOMER_SATISFACTION",
              "Achieve Net Promoter Score ≥ 40 for the platform engineering team",
              "Numeric", "NPS Score", 40.0, 10,
              checkins={
                  "Q1":       {"actual": 31.0, "remarks": "Baseline NPS survey conducted across 12 internal client teams."},
                  "Q2":       {"actual": 35.0, "remarks": "Feature reliability improvements noted in follow-up pulse survey."},
                  "MID_YEAR": {"actual": 36.0, "remarks": "Inching up. Need to close feedback loop faster on detractor issues."},
                  "Q3":       {"actual": 38.0, "remarks": "Near target. Two priority feature requests resolved in Q3 sprint.",
                               "manager_remark": "Closing in. Confirm top 3 detractor themes and action plan for Q4."},
              }),
    ]


# ─── EMP3: Kavya Reddy — SUBMITTED (no check-ins) ───────────────────────────

def _goals_emp3() -> list[dict]:
    sh, ow = _R["sh3"], _R["emp3"]
    gs = _G["emp3"]
    return [
        _goal(gs[0], sh, ow,
              "BUSINESS_GROWTH",
              "Onboard 8 new enterprise clients in FY 2025-26",
              "Numeric", "Number", 8.0, 30),
        _goal(gs[1], sh, ow,
              "CUSTOMER_SATISFACTION",
              "Maintain existing client renewal rate at ≥ 90 %",
              "Numeric", "%", 90.0, 25),
        _goal(gs[2], sh, ow,
              "DELIVERY_TIMELINESS",
              "Deliver all client solution proposals within 5 business days of brief receipt",
              "Numeric", "Business Days", 5.0, 20),
        _goal(gs[3], sh, ow,
              "QUALITY_PROCESS_EXCELLENCE",
              "Complete ISO 27001 gap assessment and submit remediation roadmap to CISO",
              "Timeline", "Milestone",
              "Gap assessment report and prioritised remediation roadmap approved by CISO by Sep 2025",
              15),
        _goal(gs[4], sh, ow,
              "PEOPLE_DEVELOPMENT",
              "Conduct 4 quarterly knowledge-sharing sessions for the operations team",
              "Timeline", "Milestone",
              "4 sessions completed with ≥ 80 % team attendance each; session materials on intranet",
              10),
    ]


# ─── EMP4: Siddharth Joshi — RETURNED (no check-ins) ────────────────────────

def _goals_emp4() -> list[dict]:
    sh, ow = _R["sh4"], _R["emp4"]
    gs = _G["emp4"]
    return [
        _goal(gs[0], sh, ow,
              "INNOVATION_TECHNOLOGY",
              "Automate monthly MIS report generation using RPA to reduce manual effort by 50 %",
              "Numeric", "% effort reduction", 50.0, 25),
        _goal(gs[1], sh, ow,
              "COST_OPTIMISATION",
              "Renegotiate top 5 vendor contracts to achieve aggregate cost saving of 8 %",
              "Numeric", "% cost saving", 8.0, 25),
        _goal(gs[2], sh, ow,
              "QUALITY_PROCESS_EXCELLENCE",
              "Design and deploy an SLA breach early-warning system into production",
              "Timeline", "Milestone",
              "System live in production by Q2 FY 2025-26 with ≥ 95 % alert accuracy verified",
              20),
        _goal(gs[3], sh, ow,
              "DELIVERY_TIMELINESS",
              "Reduce average project milestone delay across all active projects to ≤ 3 days",
              "Numeric", "Days", 3.0, 15),
        _goal(gs[4], sh, ow,
              "SAFETY_COMPLIANCE",
              "Achieve 100 % POSH Act training completion across the Operations department",
              "Numeric", "%", 100.0, 15),
    ]


# ─── EMP5: Meera Iyer — DRAFT (no check-ins) ────────────────────────────────

def _goals_emp5() -> list[dict]:
    sh, ow = _R["sh5"], _R["emp5"]
    gs = _G["emp5"]
    return [
        _goal(gs[0], sh, ow,
              "BUSINESS_GROWTH",
              "Increase upsell and cross-sell revenue from existing accounts by 20 %",
              "Numeric", "% growth", 20.0, 30),
        _goal(gs[1], sh, ow,
              "CUSTOMER_SATISFACTION",
              "Reduce average customer complaint resolution time to ≤ 48 hours",
              "Numeric", "Hours", 48.0, 25),
        _goal(gs[2], sh, ow,
              "PEOPLE_DEVELOPMENT",
              "Build and publish a cross-functional skills matrix for the engineering team",
              "Timeline", "Milestone",
              "Skills matrix published on intranet portal with quarterly update cadence in place by Jun 2025",
              20),
        _goal(gs[3], sh, ow,
              "DELIVERY_TIMELINESS",
              "Achieve 95 % on-time delivery rate across all customer-facing project milestones",
              "Numeric", "%", 95.0, 15),
        _goal(gs[4], sh, ow,
              "COST_OPTIMISATION",
              "Identify and eliminate 3 redundant SaaS tool subscriptions",
              "Numeric", "Number", 3.0, 10),
    ]


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Check-in document builder
# Reads the _ci dict from each goal and emits CheckInInDB-compatible documents.
# Only called for APPROVED and LOCKED sheets (CHECKIN_RULES.md §2).
# ═════════════════════════════════════════════════════════════════════════════

def build_checkins(goals: list[dict], employee_id: ObjectId,
                   manager_id: ObjectId, periods: list[str]) -> list[dict]:
    """
    Build check-in documents for the given period labels.
    Enforces one check-in per goal per period_label (CHECKIN_RULES.md §4).
    """
    checkins: list[dict] = []
    for goal in goals:
        ci_data: dict = goal.get("_ci", {})
        for label, ci in ci_data.items():
            if label not in periods:
                continue
            doc: dict[str, Any] = {
                "_id":            ObjectId(),
                "goal_id":        str(goal["_id"]),
                "goal_sheet_id":  goal["goal_sheet_id"],
                "period_label":   label,
                "actual_value":   ci["actual"],
                "self_rating":    ci.get("self_rating"),
                "remarks":        ci.get("remarks"),
                "manager_remark": ci.get("manager_remark"),
                "manager_id":     str(manager_id) if ci.get("manager_remark") else None,
                "created_by":     str(employee_id),
                "check_in_date":  _CI_DATES[label],
                # All seeded check-ins are historical — not within 24-h grace window
                "is_editable":    False,
            }
            checkins.append(doc)
    return checkins


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 5 — Score computation
# Applies formulas from CHECKIN_RULES.md §6 to the latest check-in per goal.
# ═════════════════════════════════════════════════════════════════════════════

def apply_scores(goals: list[dict], latest_period: str) -> tuple[list[dict], float]:
    """
    Mutate each goal with latest_actual_value, achievement_pct, goal_score.
    Returns the mutated goal list and the overall sheet score.
    """
    total_score = 0.0
    for goal in goals:
        ci = goal.get("_ci", {}).get(latest_period)
        if not ci:
            continue
        wt = goal["weightage"]
        if goal["uom_type"] == "Numeric":
            actual = float(ci["actual"])
            target = float(goal["target_value"])
            ach, gs = quant_score(actual, target, wt)
            goal["latest_actual_value"] = actual
            goal["achievement_pct"]     = ach
            goal["goal_score"]          = gs
            total_score += gs
        else:  # QUALITATIVE
            sr = float(ci.get("self_rating", 0))
            gs = qual_score(sr, wt)
            goal["latest_actual_value"] = ci["actual"]
            goal["achievement_pct"]     = round((sr / 5.0) * 100, 2)
            goal["goal_score"]          = gs
            total_score += gs
    return goals, round(total_score, 2)


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 6 — Audit log builder (WORKFLOWS.md §8)
# ═════════════════════════════════════════════════════════════════════════════

def _al(action: str, actor_id: ObjectId, actor_role: str,
        ts: datetime, comment: str | None = None) -> dict:
    return {
        "action":     action,
        "actor_id":   str(actor_id),
        "actor_role": actor_role,
        "timestamp":  ts,
        "comment":    comment,
    }


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 7 — GoalSheet document builder
# ═════════════════════════════════════════════════════════════════════════════

def build_goal_sheet(sheet_id: ObjectId, employee_id: ObjectId,
                     status: str, audit_log: list[dict],
                     goals: list[dict], overall_score: float | None,
                     reviewed_by: ObjectId | None = None,
                     review_comment: str | None = None,
                     created_at: datetime = utc(2025, 4, 10),
                     updated_at: datetime = utc(2025, 4, 10)) -> dict:
    total_wt   = sum(g["weightage"] for g in goals)
    goal_count = len(goals)
    return {
        "_id":            sheet_id,
        "employee_id":    str(employee_id),
        "period_id":      str(_R["period"]),
        "period_label":   "FY 2025-26",
        "status":         status,
        "goal_count":     goal_count,
        "total_weightage": round(total_wt, 2),  # must be 100.0
        "overall_score":  overall_score,
        "reviewed_by":    str(reviewed_by) if reviewed_by else None,
        "review_comment": review_comment,
        "audit_log":      audit_log,
        "created_at":     created_at,
        "updated_at":     updated_at,
    }


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 8 — Assemble all documents
# ═════════════════════════════════════════════════════════════════════════════

def assemble() -> dict[str, list[dict]]:
    """Return all seed documents grouped by collection name."""

    period  = build_period()
    users   = build_users()

    # ── Goal data (raw, with _ci embedded) ───────────────────────────────────
    raw_g1 = _goals_emp1()
    raw_g2 = _goals_emp2()
    raw_g3 = _goals_emp3()
    raw_g4 = _goals_emp4()
    raw_g5 = _goals_emp5()

    # ── Scores for LOCKED (YEAR_END) and APPROVED (Q3) ───────────────────────
    raw_g1, score1 = apply_scores(raw_g1, "YEAR_END")   # Arjun — LOCKED
    raw_g2, score2 = apply_scores(raw_g2, "Q3")         # Priya — APPROVED

    # ── Check-ins (only APPROVED and LOCKED sheets) ──────────────────────────
    ci_emp1 = build_checkins(raw_g1, _R["emp1"], _R["mgr1"],
                             ["Q1","Q2","MID_YEAR","Q3","Q4","YEAR_END"])
    ci_emp2 = build_checkins(raw_g2, _R["emp2"], _R["mgr1"],
                             ["Q1","Q2","MID_YEAR","Q3"])

    # ── Strip internal _ci before storing goals ───────────────────────────────
    def strip(goals: list[dict]) -> list[dict]:
        return [{k: v for k, v in g.items() if k != "_ci"} for g in goals]

    goals_all = strip(raw_g1) + strip(raw_g2) + strip(raw_g3) + strip(raw_g4) + strip(raw_g5)

    # ── Goal Sheets ───────────────────────────────────────────────────────────
    # EMP1 — LOCKED
    sh1 = build_goal_sheet(
        _R["sh1"], _R["emp1"], "LOCKED",
        audit_log=[
            _al("DRAFT",     _R["emp1"], "EMPLOYEE", utc(2025, 4, 10,  9,  0)),
            _al("SUBMITTED", _R["emp1"], "EMPLOYEE", utc(2025, 4, 18, 11, 30)),
            _al("APPROVED",  _R["mgr1"], "MANAGER",  utc(2025, 4, 25, 14, 15)),
            _al("LOCKED",    _R["mgr1"], "MANAGER",  utc(2026, 3, 30, 16,  0)),
        ],
        goals=raw_g1, overall_score=score1,
        reviewed_by=_R["mgr1"],
        created_at=utc(2025, 4, 10), updated_at=utc(2026, 3, 30),
    )

    # EMP2 — APPROVED
    sh2 = build_goal_sheet(
        _R["sh2"], _R["emp2"], "APPROVED",
        audit_log=[
            _al("DRAFT",     _R["emp2"], "EMPLOYEE", utc(2025, 4, 12, 10,  0)),
            _al("SUBMITTED", _R["emp2"], "EMPLOYEE", utc(2025, 4, 20, 14,  0)),
            _al("APPROVED",  _R["mgr1"], "MANAGER",  utc(2025, 4, 28, 10, 30)),
        ],
        goals=raw_g2, overall_score=score2,
        reviewed_by=_R["mgr1"],
        created_at=utc(2025, 4, 12), updated_at=utc(2025, 4, 28),
    )

    # EMP3 — SUBMITTED
    sh3 = build_goal_sheet(
        _R["sh3"], _R["emp3"], "SUBMITTED",
        audit_log=[
            _al("DRAFT",     _R["emp3"], "EMPLOYEE", utc(2025, 4, 15,  9,  0)),
            _al("SUBMITTED", _R["emp3"], "EMPLOYEE", utc(2025, 5, 10, 15,  0)),
        ],
        goals=raw_g3, overall_score=None,
        created_at=utc(2025, 4, 15), updated_at=utc(2025, 5, 10),
    )

    # EMP4 — RETURNED (with mandatory manager comment per WORKFLOWS.md §3.5b)
    return_comment = (
        "Please revise the RPA automation target — reducing manual effort by 50 % in a single "
        "year is too aggressive given our current tooling maturity level. Establish a baseline "
        "measurement first, then set a target of 25–30 % reduction with quarterly milestones. "
        "Also clarify the vendor renegotiation scope: specify which contracts are in scope and "
        "provide the current annual spend baseline so the 8 % saving can be validated. "
        "Re-submit by 30 May 2025."
    )
    sh4 = build_goal_sheet(
        _R["sh4"], _R["emp4"], "RETURNED",
        audit_log=[
            _al("DRAFT",     _R["emp4"], "EMPLOYEE", utc(2025, 4, 16,  9, 30)),
            _al("SUBMITTED", _R["emp4"], "EMPLOYEE", utc(2025, 5, 12, 11,  0)),
            _al("RETURNED",  _R["mgr2"], "MANAGER",  utc(2025, 5, 18, 16, 45),
                comment=return_comment),
        ],
        goals=raw_g4, overall_score=None,
        reviewed_by=_R["mgr2"], review_comment=return_comment,
        created_at=utc(2025, 4, 16), updated_at=utc(2025, 5, 18),
    )

    # EMP5 — DRAFT
    sh5 = build_goal_sheet(
        _R["sh5"], _R["emp5"], "DRAFT",
        audit_log=[
            _al("DRAFT", _R["emp5"], "EMPLOYEE", utc(2025, 4, 20, 10, 0)),
        ],
        goals=raw_g5, overall_score=None,
        created_at=utc(2025, 4, 20), updated_at=utc(2025, 4, 20),
    )

    return {
        COL_PERIODS:  [period],
        COL_USERS:    users,
        COL_SHEETS:   [sh1, sh2, sh3, sh4, sh5],
        COL_GOALS:    goals_all,
        COL_CHECKINS: ci_emp1 + ci_emp2,
    }


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 9 — Validation (pre-insert sanity checks)
# ═════════════════════════════════════════════════════════════════════════════

def validate(data: dict[str, list[dict]]) -> list[str]:
    """Return a list of validation error strings (empty = all OK)."""
    errors: list[str] = []

    # Weightage totals must be 100 per sheet (VALIDATION_RULES.md §4)
    sheet_wt: dict[str, float] = {}
    for g in data[COL_GOALS]:
        sid_ = g["goal_sheet_id"]
        sheet_wt[sid_] = round(sheet_wt.get(sid_, 0.0) + g["weightage"], 2)
    for sid_, total in sheet_wt.items():
        if total != 100.0:
            errors.append(f"Sheet {sid_}: total_weightage={total} ≠ 100")

    # Min/max weightage per goal
    for g in data[COL_GOALS]:
        wt = g["weightage"]
        if wt < 10.0 or wt > 50.0:
            errors.append(f"Goal '{g['description'][:40]}': weightage {wt} out of 10–50 range")

    # Goal count per sheet (3–10)
    for sh in data[COL_SHEETS]:
        gc = sh["goal_count"]
        if not (3 <= gc <= 8):
            errors.append(f"Sheet {sh['_id']} ({sh['status']}): goal_count={gc} not in 3–10")

    # Check-in state gate — only APPROVED/LOCKED sheets
    approved_locked = {str(s["_id"]) for s in data[COL_SHEETS]
                       if s["status"] in ("APPROVED", "LOCKED")}
    for ci in data[COL_CHECKINS]:
        if ci["goal_sheet_id"] not in approved_locked:
            errors.append(f"Check-in {ci['_id']} on non-APPROVED/LOCKED sheet")

    # Check-in uniqueness: one per goal per period_label
    seen: set[tuple] = set()
    for ci in data[COL_CHECKINS]:
        key = (ci["goal_id"], ci["period_label"])
        if key in seen:
            errors.append(f"Duplicate check-in: goal={ci['goal_id']} period={ci['period_label']}")
        seen.add(key)

    # Audit log — RETURNED entries must have a comment (WORKFLOWS.md §8)
    for sh in data[COL_SHEETS]:
        for entry in sh.get("audit_log", []):
            if entry["action"] == "RETURNED" and not entry.get("comment"):
                errors.append(f"Sheet {sh['_id']}: RETURNED audit entry missing comment")

    # Role constraints (ROLE_PERMISSIONS.md)
    user_roles: dict[str, str] = {str(u["_id"]): u["role"] for u in data[COL_USERS]}
    for u in data[COL_USERS]:
        if u["role"] == "EMPLOYEE" and not u.get("manager_id"):
            errors.append(f"Employee {u['employee_id']} missing manager_id")
        if u.get("manager_id") and user_roles.get(u["manager_id"]) != "MANAGER":
            errors.append(f"Employee {u['employee_id']} manager_id does not reference a MANAGER")

    return errors


# ═════════════════════════════════════════════════════════════════════════════
# SECTION 10 — Summary printer
# ═════════════════════════════════════════════════════════════════════════════

def print_summary(data: dict[str, list[dict]]) -> None:
    _head("Seed data summary")

    # Users
    role_order = {"ADMIN": 0, "MANAGER": 1, "EMPLOYEE": 2}
    role_tag   = {"ADMIN": "[ADM]", "MANAGER": "[MGR]", "EMPLOYEE": "[EMP]"}
    _info(f"Users ({len(data[COL_USERS])})")
    for u in sorted(data[COL_USERS], key=lambda x: role_order[x["role"]]):
        print(f"         {role_tag[u['role']]}  {u['name']:<22} {u['employee_id']:<8} dept: {u['department']}")

    # Goal Sheets
    _info(f"Goal Sheets ({len(data[COL_SHEETS])})")
    uid_name = {str(u["_id"]): u["name"] for u in data[COL_USERS]}
    for sh in data[COL_SHEETS]:
        name  = uid_name.get(sh["employee_id"], "?")
        score = f"score={sh['overall_score']:.2f}" if sh["overall_score"] is not None else "score=n/a"
        print(f"         [{sh['status']:<9}]  {name:<22}  goals={sh['goal_count']}  wt={sh['total_weightage']:.0f}%  {score}")

    # Goals
    _info(f"Goals ({len(data[COL_GOALS])})")
    thrust_counts: dict[str, int] = {}
    uom_counts: dict[str, int] = {}
    for g in data[COL_GOALS]:
        thrust_counts[g["thrust_area"]] = thrust_counts.get(g["thrust_area"], 0) + 1
        uom_counts[g["uom_type"]] = uom_counts.get(g["uom_type"], 0) + 1
    for ta, cnt in sorted(thrust_counts.items()):
        print(f"           {ta:<40} x{cnt}")
    print(f"         UoM -- QUANTITATIVE:{uom_counts.get('QUANTITATIVE',0)}"
          f"  QUALITATIVE:{uom_counts.get('QUALITATIVE',0)}")

    # Check-ins
    _info(f"Check-ins ({len(data[COL_CHECKINS])})")
    period_counts: dict[str, int] = {}
    for ci in data[COL_CHECKINS]:
        period_counts[ci["period_label"]] = period_counts.get(ci["period_label"], 0) + 1
    for p in ["Q1", "Q2", "MID_YEAR", "Q3", "Q4", "YEAR_END"]:
        cnt = period_counts.get(p, 0)
        if cnt:
            print(f"           {p:<12} x{cnt}")


# =============================================================================
# SECTION 11 -- Main
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="AtomQuest development data seeder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--uri",     default=DEFAULT_URI, help="MongoDB connection URI")
    parser.add_argument("--db",      default=DEFAULT_DB,  help="Database name")
    parser.add_argument("--dry-run", action="store_true", help="Validate + print without writing")
    args = parser.parse_args()

    _head("AtomQuest -- Data Seeder")
    _info(f"Database : {args.db}")
    _info(f"URI      : {args.uri[:50]}{'...' if len(args.uri) > 50 else ''}")
    if args.dry_run:
        _warn("DRY-RUN mode -- no data will be written to MongoDB")

    _head("Building seed documents ...")
    data = assemble()

    _head("Running pre-insert validation ...")
    errors = validate(data)
    if errors:
        print(f"\n  [FAIL]  {len(errors)} validation error(s) found:\n")
        for e in errors:
            print(f"          - {e}")
        sys.exit(1)
    _ok("All validation checks passed")

    print_summary(data)

    if args.dry_run:
        _head("Dry-run complete -- exiting without writing.")
        return

    _head("Connecting to MongoDB ...")
    try:
        client = MongoClient(args.uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        _ok("Connected")
    except Exception as exc:
        print(f"\n  [FAIL]  Cannot connect to MongoDB: {exc}")
        sys.exit(1)

    db = client[args.db]

    _head("Clearing existing seed collections ...")
    for col in [COL_PERIODS, COL_USERS, COL_SHEETS, COL_GOALS, COL_CHECKINS]:
        result = db[col].delete_many({})
        _ok(f"{col:<20} -- deleted {result.deleted_count} document(s)")

    _head("Inserting seed data ...")
    for col, docs in data.items():
        if docs:
            db[col].insert_many(docs)
            _ok(f"{col:<20} -- inserted {len(docs)} document(s)")

    client.close()

    _head("Seed complete")
    print(f"\n  Default password for all users:  {SEED_PWD}")
    print(f"\n  Sample credentials:")
    print(f"    Admin    -- sneha.kapoor@atomquest.in  / {SEED_PWD}")
    print(f"    Manager  -- rahul.mehta@atomquest.in   / {SEED_PWD}")
    print(f"    Employee -- arjun.nair@atomquest.in    / {SEED_PWD}\n")


if __name__ == "__main__":
    main()
