"""
AtomQuest Goal Tracking Portal — FastAPI entry point.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import close_db, connect_db
from routers import auth_router, checkins_router, goal_sheets_router, goals_router, users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title="AtomQuest Goal Tracking Portal",
    description="Enterprise goal-tracking API — Roles: Employee | Manager | Admin",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(goal_sheets_router)
app.include_router(goals_router)
app.include_router(checkins_router)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "AtomQuest API"}
