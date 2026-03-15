"""Audit logging service — write activity logs inline with request transactions."""
from app.models.models import ActivityLog, User


async def log_action(db, user: User, action: str, details: str = None):
    """Add an activity log entry to the current DB session (committed with the route's transaction)."""
    entry = ActivityLog(
        user_id=user.id,
        username=user.username,
        action=action,
        details=details,
    )
    db.add(entry)
