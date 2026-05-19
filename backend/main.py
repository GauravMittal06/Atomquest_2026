"""
AtomQuest Goal Tracking Portal — FastAPI entry point.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import close_db, connect_db, ensure_indexes, get_database
from routers import (
    admin_router,
    admin_dashboard_router,
    auth_router,
    checkin_comments_router,
    checkins_router,
    employee_dashboard_router,
    escalations_router,
    goal_sheets_router,
    goals_router,
    manager_router,
    shared_kpis_router,
    system_router,
    cycles_router,
    users_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_ready = False
    try:
        await connect_db()
        await ensure_indexes()
        app.state.db_ready = True
    except Exception:
        app.state.db_ready = False
    yield
    await close_db()


app = FastAPI(
    title="AtomQuest Goal Tracking Portal",
    description="Enterprise goal-tracking API — Roles: Employee | Manager | Admin",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=True,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://atomquest-2026-git-main-gauravmittal06s-projects.vercel.app",
        "https://atomquest-2026-gilt.vercel.app",
        # "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(goal_sheets_router)
app.include_router(goals_router)
app.include_router(checkins_router)
app.include_router(checkin_comments_router)
app.include_router(shared_kpis_router)
app.include_router(system_router)
app.include_router(cycles_router)
app.include_router(escalations_router)
app.include_router(admin_router)
app.include_router(admin_dashboard_router)
app.include_router(employee_dashboard_router)
app.include_router(manager_router)


@app.get("/api/health", tags=["Health"])
async def health():
    if not getattr(app.state, "db_ready", False):
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        db = get_database()
        await db.command("ping")
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ok", "service": "AtomQuest API", "db": "connected"}