"""Main application entry point."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings
from app.core.database import engine, Base
from app.core.security import hash_password
from app.api import auth, users, schedule, reminders, notifications
from app.workers.reminder_worker import check_and_fire_reminders

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()

scheduler = AsyncIOScheduler()


async def create_default_admin():
    """Create default admin user if none exists."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionFactory
    from app.models.models import User, UserRole

    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(User).where(User.role == UserRole.ADMIN).limit(1)
        )
        if result.scalar_one_or_none() is None:
            admin = User(
                username="admin",
                display_name="Admin",
                hashed_password=hash_password("admin123"),
                role=UserRole.ADMIN,
            )
            db.add(admin)

            # Create a few demo engineers
            for i, name in enumerate(["Alice", "Bob", "Carol", "Dave", "Eve"]):
                eng = User(
                    username=name.lower(),
                    display_name=name,
                    hashed_password=hash_password("engineer123"),
                    role=UserRole.ENGINEER,
                    min_shift_gap_days=2,
                    max_shifts_per_week=3,
                )
                db.add(eng)

            await db.commit()
            logger.info("Created default admin and demo engineers")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await create_default_admin()

    # Start reminder worker
    scheduler.add_job(check_and_fire_reminders, "interval", seconds=30)
    scheduler.start()
    logger.info("Reminder worker started (30s interval)")

    yield

    # Shutdown
    scheduler.shutdown()
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
