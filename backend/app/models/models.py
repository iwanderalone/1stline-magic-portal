"""Database models — expanded with groups, shift config, telegram chats, user profiles."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, ForeignKey,
    Text, Enum as SAEnum, Date, Time, UniqueConstraint, Table, Float, Uuid, Index, JSON,
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

class ContainerCommandType(str, enum.Enum):
    START   = "start"
    STOP    = "stop"
    RESTART = "restart"

class ContainerCommandStatus(str, enum.Enum):
    PENDING   = "pending"
    EXECUTING = "executing"
    DONE      = "done"
    FAILED    = "failed"


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
        Index("ix_shifts_date", "date"),
        Index("ix_shifts_user_id", "user_id"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
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
    __table_args__ = (
        Index("ix_reminders_remind_at", "remind_at"),
        Index("ix_reminders_user_id", "user_id"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    remind_at = Column(DateTime(timezone=True), nullable=False)
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


# ─── Mail Reporter ────────────────────────────────────────

class MailboxConfig(Base):
    __tablename__ = "mailbox_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password = Column(String(500), nullable=False)
    subject_filter = Column(String(200), default="NONE", nullable=False)
    telegram_target = Column(String(200), default="", nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    monitor_since = Column(Date, nullable=True)  # None = use today at first poll

    # Runtime status (updated after each poll)
    last_poll_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    consecutive_failures = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    logs = relationship("EmailLog", back_populates="mailbox", cascade="all, delete-orphan")


class ShiftNotificationLog(Base):
    """Tracks which (date, shift_type) notifications have already been sent."""
    __tablename__ = "shift_notification_logs"
    __table_args__ = (UniqueConstraint("date", "shift_type"),)

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False)
    shift_type = Column(SAEnum(ShiftType), nullable=False)
    sent_at = Column(DateTime(timezone=True), default=utcnow)


class MailRoutingRule(Base):
    """Configurable routing rules for the mail reporter.

    Built-in rules (is_builtin=True) are seeded automatically and cannot be deleted.
    They control display config (label, color, hashtag, mentions) for hardcoded categories.
    User rules are checked first (by priority), then built-in classification runs as fallback.
    """
    __tablename__ = "mail_routing_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    is_builtin = Column(Boolean, default=False, nullable=False)
    builtin_key = Column(String(50), nullable=True, unique=True)  # matches classify_email() output

    # Match conditions — only used for non-builtin rules
    match_type = Column(String(20), nullable=True)   # keyword | subject_keyword | sender | sender_domain
    match_values = Column(Text, nullable=True)        # comma-separated values to match

    # Display config — editable for all rules including built-ins
    label = Column(String(100), nullable=False)        # e.g. "🔴 Adobe"
    color = Column(String(7), default="#6b7280")       # hex color for badge
    hashtag = Column(String(200), nullable=True)       # e.g. "#adobe"
    mention_users = Column(String(200), nullable=True) # e.g. "@wanderalone @itsupport_viory"
    include_body = Column(Boolean, default=True)

    # Optional Telegram target override (empty = use mailbox target)
    telegram_target = Column(String(200), nullable=True)

    # Optional mailbox scope — NULL means applies to ALL mailboxes
    mailbox_id = Column(Integer, ForeignKey("mailbox_configs.id", ondelete="SET NULL"), nullable=True)

    # Control
    priority = Column(Integer, default=10)  # lower = checked first (user rules only)
    enabled = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EmailComment(Base):
    __tablename__ = "email_comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email_id = Column(Integer, ForeignKey("email_logs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username = Column(String(100), nullable=False)  # denormalised — survives user deletion
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    email_log = relationship("EmailLog", back_populates="comments")


class EmailLog(Base):
    __tablename__ = "email_logs"
    __table_args__ = (
        Index("ix_email_logs_mailbox_id", "mailbox_id"),
        Index("ix_email_logs_created_at", "created_at"),
        Index("ix_email_logs_status", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    mailbox_id = Column(Integer, ForeignKey("mailbox_configs.id", ondelete="CASCADE"), nullable=False)
    fingerprint = Column(String(24), unique=True, nullable=False, index=True)
    subject = Column(String(500), nullable=True)
    sender = Column(String(500), nullable=True)
    category = Column(String(50), nullable=False)   # builtin_key or user rule name
    rule_id = Column(Integer, ForeignKey("mail_routing_rules.id", ondelete="SET NULL"), nullable=True)
    telegram_sent = Column(Boolean, default=False, nullable=False)
    telegram_target_used = Column(String(200), nullable=True)
    extracted_code = Column(String(20), nullable=True)  # adobe codes only
    skip_reason = Column(String(100), nullable=True)    # None=processed, 'filter', 'no_target', 'error'
    received_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    status = Column(String(20), default="unchecked", nullable=False)  # unchecked | solved | on_pause | blocked
    solver_comment = Column(Text, nullable=True)
    solved_at = Column(DateTime(timezone=True), nullable=True)

    mailbox = relationship("MailboxConfig", back_populates="logs")
    comments = relationship("EmailComment", back_populates="email_log",
                            cascade="all, delete-orphan",
                            order_by="EmailComment.created_at")


# ─── Telegram Templates ───────────────────────────────────

class TelegramTemplate(Base):
    __tablename__ = "telegram_templates"

    id          = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    chat_id     = Column(String(50), nullable=False)
    topic_id    = Column(Integer, nullable=True)
    created_at  = Column(DateTime(timezone=True), default=utcnow)
    updated_at  = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ─── Container Dashboard ──────────────────────────────────

class VPSAgent(Base):
    __tablename__ = "vps_agents"

    id                = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name              = Column(String(100), unique=True, nullable=False)
    description       = Column(Text, nullable=True)
    api_key_hash      = Column(String(64), nullable=False)
    last_seen         = Column(DateTime(timezone=True), nullable=True)
    ip_address        = Column(String(45), nullable=True)
    hostname          = Column(String(255), nullable=True)
    is_enabled        = Column(Boolean, default=True, nullable=False)
    created_at        = Column(DateTime(timezone=True), default=utcnow)
    alert_template_id = Column(Uuid(as_uuid=True),
                               ForeignKey("telegram_templates.id", ondelete="SET NULL"),
                               nullable=True)

    system_snapshot      = Column(Text, nullable=True)   # JSON: system metrics, logins, updates
    disk_alert_threshold = Column(Integer, default=85, nullable=True)   # % — alert when disk >= this
    cpu_alert_threshold  = Column(Integer, default=80, nullable=True)   # % — alert when sustained CPU >= this
    alert_flags          = Column(JSON, nullable=True)                  # {disk,cpu,container_stopped,login,updates,offline}

    alert_template = relationship("TelegramTemplate")
    containers     = relationship("ContainerState", back_populates="agent",
                                  cascade="all, delete-orphan")
    commands       = relationship("ContainerCommand", back_populates="agent",
                                  cascade="all, delete-orphan")


class ContainerState(Base):
    __tablename__ = "container_states"
    __table_args__ = (UniqueConstraint("agent_id", "docker_id", name="uq_agent_docker"),)

    id              = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id        = Column(Uuid(as_uuid=True), ForeignKey("vps_agents.id", ondelete="CASCADE"),
                             nullable=False)
    docker_id       = Column(String(64), nullable=False)
    # Agent-reported (overwritten on every report)
    name            = Column(String(255), nullable=False)
    image           = Column(String(500), nullable=False)
    status          = Column(String(50), nullable=False)
    state_detail    = Column(Text, nullable=True)      # JSON
    ports           = Column(Text, nullable=True)      # JSON
    cpu_percent     = Column(Float, nullable=True)
    mem_usage_bytes = Column(Integer, nullable=True)
    mem_limit_bytes = Column(Integer, nullable=True)
    last_logs       = Column(Text, nullable=True)      # JSON array of last 50 log lines
    reported_at     = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_absent       = Column(Boolean, default=False, nullable=False)
    # User-editable metadata (never overwritten by agent)
    display_name    = Column(String(100), nullable=True)
    description     = Column(Text, nullable=True)
    hosted_on       = Column(String(150), nullable=True)

    agent = relationship("VPSAgent", back_populates="containers")


class ContainerCommand(Base):
    __tablename__ = "container_commands"

    id                = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id          = Column(Uuid(as_uuid=True), ForeignKey("vps_agents.id", ondelete="CASCADE"),
                               nullable=False)
    docker_id         = Column(String(64), nullable=False)
    container_name    = Column(String(255), nullable=True)
    command           = Column(SAEnum(ContainerCommandType), nullable=False)
    status            = Column(SAEnum(ContainerCommandStatus),
                               default=ContainerCommandStatus.PENDING, nullable=False)
    issued_by_user_id = Column(Uuid(as_uuid=True),
                               ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    issued_at         = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    executed_at       = Column(DateTime(timezone=True), nullable=True)
    result_message    = Column(Text, nullable=True)

    agent     = relationship("VPSAgent", back_populates="commands")
    issued_by = relationship("User")
