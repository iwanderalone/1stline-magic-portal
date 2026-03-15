"""Database models — expanded with groups, shift config, telegram chats, user profiles."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, ForeignKey,
    Text, Enum as SAEnum, Date, Time, UniqueConstraint, Table, Float, Uuid,
)
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


def utcnow():
    return datetime.now(timezone.utc)


# ─── Enums ───────────────────────────────────────────────

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    ENGINEER = "engineer"

class ShiftType(str, enum.Enum):
    DAY = "day"
    NIGHT = "night"
    OFFICE = "office"

class WorkLocation(str, enum.Enum):
    ONSITE = "onsite"
    REMOTE = "remote"

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

class TelegramChatType(str, enum.Enum):
    PERSONAL = "personal"
    GROUP = "group"
    CHANNEL = "channel"


# ─── Association Tables ──────────────────────────────────

user_groups = Table(
    "user_groups", Base.metadata,
    Column("user_id", Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", Uuid(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)


# ─── Groups ──────────────────────────────────────────────

class Group(Base):
    __tablename__ = "groups"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), default="#6366f1")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    members = relationship("User", secondary=user_groups, back_populates="groups")


# ─── Users ───────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.ENGINEER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Profile customization
    avatar_url = Column(String(500), nullable=True)
    name_color = Column(String(7), default="#2563eb")

    # OTP
    otp_secret = Column(String(32), nullable=True)
    otp_enabled = Column(Boolean, default=False, nullable=False)

    # Telegram — personal
    telegram_chat_id = Column(String(50), nullable=True)
    telegram_username = Column(String(100), nullable=True)
    telegram_link_code = Column(String(20), nullable=True)
    telegram_notify_shifts = Column(Boolean, default=True)
    telegram_notify_reminders = Column(Boolean, default=True)

    # Timezone (IANA, e.g. "Europe/Moscow")
    timezone = Column(String(50), default="UTC", nullable=False)

    # Schedule rules
    min_shift_gap_days = Column(Integer, default=2)
    max_shifts_per_week = Column(Integer, default=3)

    # Availability pattern: JSON like {"cycle_days": 4, "work_days": [2,3,4], "blocked_weekdays": []}
    # cycle_days=4 means a repeating 4-day cycle
    # work_days=[2,3,4] means days 2,3,4 of the cycle are available (1-indexed)
    # So "works 24h then 3 days available" = cycle_days:4, work_days:[2,3,4]
    # blocked_weekdays: list of 0-6 (Mon=0) the person can NEVER work
    # If null, person is available every day (default)
    availability_pattern = Column(Text, nullable=True)  # JSON string
    availability_anchor_date = Column(Date, nullable=True)  # cycle starts from this date

    # Allowed shift types: JSON list like ["day", "night"] — null means all types allowed
    allowed_shift_types = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    groups = relationship("Group", secondary=user_groups, back_populates="members")
    shifts = relationship("Shift", back_populates="user")
    time_off_requests = relationship("TimeOffRequest", back_populates="user")
    reminders = relationship("Reminder", back_populates="user")


# ─── Shift Configuration ────────────────────────────────

class ShiftConfig(Base):
    __tablename__ = "shift_configs"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_type = Column(SAEnum(ShiftType), unique=True, nullable=False)
    label = Column(String(50), nullable=False)
    duration_hours = Column(Float, nullable=False, default=12)
    default_start_time = Column(Time, nullable=True)
    default_end_time = Column(Time, nullable=True)
    color = Column(String(7), default="#3b82f6")
    emoji = Column(String(4), default="☀️")
    requires_location = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


# ─── Schedule ────────────────────────────────────────────

class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = (
        UniqueConstraint("user_id", "date", "shift_type", name="uq_user_date_type"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    shift_type = Column(SAEnum(ShiftType), nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    location = Column(SAEnum(WorkLocation), nullable=True)
    notes = Column(Text, nullable=True)
    is_published = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="shifts")


class TimeOffRequest(Base):
    __tablename__ = "time_off_requests"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
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

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    remind_at = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(SAEnum(ReminderStatus), default=ReminderStatus.ACTIVE, nullable=False)
    is_recurring = Column(Boolean, default=False)
    recurrence_minutes = Column(Integer, nullable=True)
    notify_telegram = Column(Boolean, default=True)
    notify_in_app = Column(Boolean, default=True)
    telegram_target = Column(String(10), default="personal")  # none | personal | groups | both
    created_at = Column(DateTime(timezone=True), default=utcnow)
    fired_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="reminders")


# ─── Notifications ───────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)


# ─── Activity Log ────────────────────────────────────────

class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username = Column(String(50), nullable=True)   # denormalized — survives user deletion
    action = Column(String(100), nullable=False, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


# ─── Telegram Chats ──────────────────────────────────────

class TelegramChat(Base):
    __tablename__ = "telegram_chats"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    chat_type = Column(SAEnum(TelegramChatType), nullable=False, default=TelegramChatType.GROUP)
    topic_id = Column(String(50), nullable=True)  # Forum topic ID inside groups
    is_active = Column(Boolean, default=True)

    notify_day_shift_start = Column(Boolean, default=False)
    notify_night_shift_start = Column(Boolean, default=False)
    notify_office_roster = Column(Boolean, default=False)
    notify_reminders = Column(Boolean, default=False)
    notify_general = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
