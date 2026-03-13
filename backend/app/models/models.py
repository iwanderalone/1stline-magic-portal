"""Database models."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, ForeignKey,
    Text, Enum as SAEnum, Date, Time, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    ENGINEER = "engineer"


class ShiftType(str, enum.Enum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    NIGHT = "night"


class TimeOffStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class TimeOffType(str, enum.Enum):
    DAY_OFF = "day_off"
    VACATION = "vacation"
    SICK_LEAVE = "sick_leave"


class ReminderStatus(str, enum.Enum):
    ACTIVE = "active"
    FIRED = "fired"
    CANCELLED = "cancelled"


def utcnow():
    return datetime.now(timezone.utc)


# ─── Users ───────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.ENGINEER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # OTP
    otp_secret = Column(String(32), nullable=True)
    otp_enabled = Column(Boolean, default=False, nullable=False)

    # Telegram
    telegram_chat_id = Column(String(50), nullable=True)
    telegram_username = Column(String(100), nullable=True)
    telegram_link_code = Column(String(20), nullable=True)

    # Schedule rules
    min_shift_gap_days = Column(Integer, default=2)
    max_shifts_per_week = Column(Integer, default=3)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    shifts = relationship("Shift", back_populates="user")
    time_off_requests = relationship("TimeOffRequest", back_populates="user")
    reminders = relationship("Reminder", back_populates="user")


# ─── Schedule ────────────────────────────────────────────

class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_user_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    shift_type = Column(SAEnum(ShiftType), nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    notes = Column(Text, nullable=True)
    is_published = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="shifts")


class TimeOffRequest(Base):
    __tablename__ = "time_off_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    off_type = Column(SAEnum(TimeOffType), nullable=False)
    status = Column(SAEnum(TimeOffStatus), default=TimeOffStatus.PENDING, nullable=False)
    comment = Column(Text, nullable=True)
    admin_comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="time_off_requests")


# ─── Reminders ───────────────────────────────────────────

class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    remind_at = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(SAEnum(ReminderStatus), default=ReminderStatus.ACTIVE, nullable=False)
    is_recurring = Column(Boolean, default=False)
    recurrence_minutes = Column(Integer, nullable=True)
    notify_telegram = Column(Boolean, default=True)
    notify_in_app = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    fired_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="reminders")


# ─── Notifications (in-app) ─────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
