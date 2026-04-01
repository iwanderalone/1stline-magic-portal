"""Pydantic schemas — expanded."""
import json as _json
from pydantic import BaseModel, Field, model_validator, field_validator
from datetime import date, time, datetime
from typing import Optional, Any
from uuid import UUID
from app.models.models import (
    UserRole, ShiftType, WorkLocation, TimeOffStatus,
    TimeOffType, ReminderStatus, TelegramChatType,
)


# ─── Auth ────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=6)

class OTPVerifyRequest(BaseModel):
    temp_token: Optional[str] = None
    otp_code: str = Field(..., min_length=6, max_length=6)

class OTPSetupResponse(BaseModel):
    qr_svg_base64: str
    secret: str
    message: str = "Scan QR code with your authenticator app"

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "UserResponse"

class RefreshRequest(BaseModel):
    refresh_token: str


# ─── Groups ──────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class GroupResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    color: str
    member_ids: list[UUID] = []
    created_at: datetime
    class Config:
        from_attributes = True

class GroupMemberUpdate(BaseModel):
    user_ids: list[UUID]


# ─── Users ───────────────────────────────────────────────

class AvailabilityPattern(BaseModel):
    """Defines a repeating work/off cycle for users with external schedules."""
    cycle_days: int = Field(..., ge=2, le=30, description="Total days in one cycle")
    work_days: list[int] = Field(..., description="Which days of the cycle are available (1-indexed)")
    blocked_weekdays: list[int] = Field(default=[], description="Weekdays never available (0=Mon, 6=Sun)")

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    email: Optional[str] = None
    role: UserRole = UserRole.ENGINEER
    telegram_username: Optional[str] = None
    timezone: str = Field(default="UTC", max_length=50)
    min_shift_gap_days: int = Field(default=2, ge=0, le=7)
    max_shifts_per_week: int = Field(default=3, ge=1, le=7)
    group_ids: Optional[list[UUID]] = None
    availability_pattern: Optional[AvailabilityPattern] = None
    availability_anchor_date: Optional[date] = None
    allowed_shift_types: Optional[list[str]] = None  # None = all types allowed

class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    timezone: Optional[str] = Field(default=None, max_length=50)
    min_shift_gap_days: Optional[int] = Field(default=None, ge=0, le=7)
    max_shifts_per_week: Optional[int] = Field(default=None, ge=1, le=7)
    is_active: Optional[bool] = None
    role: Optional[UserRole] = None
    group_ids: Optional[list[UUID]] = None
    availability_pattern: Optional[AvailabilityPattern] = None
    availability_anchor_date: Optional[date] = None
    allowed_shift_types: Optional[list[str]] = None

class AdminResetPassword(BaseModel):
    new_password: str = Field(..., min_length=8)

class ProfileUpdate(BaseModel):
    """User self-service profile update."""
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name_color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    avatar_url: Optional[str] = None
    timezone: Optional[str] = Field(default=None, max_length=50)
    telegram_username: Optional[str] = None
    telegram_notify_shifts: Optional[bool] = None
    telegram_notify_reminders: Optional[bool] = None

class PublicUserResponse(BaseModel):
    """Safe subset of user data returned to non-admin users (e.g. embedded in shifts)."""
    id: UUID
    display_name: str
    role: UserRole
    is_active: bool = True
    avatar_url: Optional[str] = None
    name_color: Optional[str] = None
    timezone: Optional[str] = None
    group_ids: list[UUID] = []
    created_at: datetime

    @model_validator(mode='after')
    def apply_defaults(self) -> 'PublicUserResponse':
        if self.name_color is None:
            self.name_color = "#2563eb"
        if self.timezone is None:
            self.timezone = "UTC"
        return self

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    email: Optional[str] = None
    role: UserRole
    is_active: bool = True
    otp_enabled: bool = False
    avatar_url: Optional[str] = None
    name_color: Optional[str] = None
    timezone: Optional[str] = None
    telegram_username: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_notify_shifts: Optional[bool] = None
    telegram_notify_reminders: Optional[bool] = None
    min_shift_gap_days: int = 2
    max_shifts_per_week: int = 3
    availability_pattern: Optional[AvailabilityPattern] = None
    availability_anchor_date: Optional[date] = None
    allowed_shift_types: Optional[list[str]] = None
    group_ids: list[UUID] = []
    created_at: datetime

    @field_validator('availability_pattern', 'allowed_shift_types', mode='before')
    @classmethod
    def _parse_json_text(cls, v: object) -> object:
        if isinstance(v, str):
            try:
                return _json.loads(v)
            except Exception:
                return None
        return v

    @model_validator(mode='after')
    def apply_defaults(self) -> 'UserResponse':
        if self.name_color is None:
            self.name_color = "#2563eb"
        if self.timezone is None:
            self.timezone = "UTC"
        if self.telegram_notify_shifts is None:
            self.telegram_notify_shifts = True
        if self.telegram_notify_reminders is None:
            self.telegram_notify_reminders = True
        return self

    class Config:
        from_attributes = True


# ─── Shift Config ────────────────────────────────────────

class ShiftConfigCreate(BaseModel):
    shift_type: ShiftType
    label: str = Field(..., min_length=1, max_length=50)
    duration_hours: float = Field(default=12, gt=0, le=24)
    default_start_time: Optional[time] = None
    default_end_time: Optional[time] = None
    color: str = Field(default="#3b82f6", pattern=r"^#[0-9a-fA-F]{6}$")
    emoji: str = Field(default="☀️", max_length=4)
    requires_location: bool = False

class ShiftConfigUpdate(BaseModel):
    label: Optional[str] = None
    duration_hours: Optional[float] = None
    default_start_time: Optional[time] = None
    default_end_time: Optional[time] = None
    color: Optional[str] = None
    emoji: Optional[str] = None
    requires_location: Optional[bool] = None
    is_active: Optional[bool] = None

class ShiftConfigResponse(BaseModel):
    id: UUID
    shift_type: ShiftType
    label: str
    duration_hours: float
    default_start_time: Optional[time]
    default_end_time: Optional[time]
    color: str
    emoji: str
    requires_location: bool
    is_active: bool
    class Config:
        from_attributes = True


# ─── Schedule ────────────────────────────────────────────

class ShiftCreate(BaseModel):
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    location: Optional[WorkLocation] = None
    notes: Optional[str] = None

class ShiftResponse(BaseModel):
    id: UUID
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time]
    end_time: Optional[time]
    location: Optional[WorkLocation]
    notes: Optional[str]
    is_published: bool
    user: Optional[PublicUserResponse] = None
    class Config:
        from_attributes = True

class ShiftUpdate(BaseModel):
    shift_type: Optional[ShiftType] = None
    location: Optional[WorkLocation] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    notes: Optional[str] = None
    is_published: Optional[bool] = None

class ScheduleGenerateRequest(BaseModel):
    start_date: date
    end_date: date
    shift_types: list[ShiftType] = [ShiftType.DAY, ShiftType.NIGHT]
    user_ids: Optional[list[UUID]] = None

class TimeOffCreate(BaseModel):
    start_date: date
    end_date: date
    off_type: TimeOffType
    comment: Optional[str] = None

class TimeOffResponse(BaseModel):
    id: UUID
    user_id: UUID
    start_date: date
    end_date: date
    off_type: TimeOffType
    status: TimeOffStatus
    comment: Optional[str]
    admin_comment: Optional[str]
    created_at: datetime
    user: Optional[UserResponse] = None
    class Config:
        from_attributes = True

class TimeOffReviewRequest(BaseModel):
    status: TimeOffStatus
    admin_comment: Optional[str] = None


# ─── Reminders ───────────────────────────────────────────

class ReminderCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    remind_at: datetime
    is_recurring: bool = False
    recurrence_minutes: Optional[int] = Field(default=None, ge=5)
    notify_telegram: bool = True
    notify_in_app: bool = True
    telegram_target: str = "personal"  # none | personal | groups | both

class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    remind_at: Optional[datetime] = None
    status: Optional[ReminderStatus] = None

class ReminderResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    description: Optional[str]
    remind_at: datetime
    status: ReminderStatus
    is_recurring: bool
    recurrence_minutes: Optional[int]
    notify_telegram: bool
    notify_in_app: bool
    telegram_target: str = "personal"
    created_at: datetime
    fired_at: Optional[datetime]
    class Config:
        from_attributes = True


# ─── Notifications ───────────────────────────────────────

class NotificationResponse(BaseModel):
    id: UUID
    title: str
    message: str
    is_read: bool
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Activity Logs ───────────────────────────────────────

class ActivityLogResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID]
    username: Optional[str]
    action: str
    details: Optional[str]
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Admin / Test Notifications ─────────────────────────

class TestNotificationRequest(BaseModel):
    title: str = Field(default="Test Notification", min_length=1, max_length=255)
    message: str = Field(default="This is a test notification from the admin panel.", min_length=1)
    user_ids: Optional[list[UUID]] = None  # None = send to all active users
    send_telegram: bool = False
    telegram_chat_db_ids: Optional[list[UUID]] = None  # configured TelegramChat record IDs


# ─── Telegram Chats ──────────────────────────────────────

class TelegramChatCreate(BaseModel):
    chat_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=200)
    chat_type: TelegramChatType = TelegramChatType.GROUP
    topic_id: Optional[str] = None
    notify_day_shift_start: bool = False
    notify_night_shift_start: bool = False
    notify_office_roster: bool = False
    notify_reminders: bool = False
    notify_general: bool = True

class TelegramChatUpdate(BaseModel):
    name: Optional[str] = None
    topic_id: Optional[str] = None
    is_active: Optional[bool] = None
    notify_day_shift_start: Optional[bool] = None
    notify_night_shift_start: Optional[bool] = None
    notify_office_roster: Optional[bool] = None
    notify_reminders: Optional[bool] = None
    notify_general: Optional[bool] = None

class TelegramChatResponse(BaseModel):
    id: UUID
    chat_id: str
    name: str
    chat_type: TelegramChatType
    topic_id: Optional[str]
    is_active: bool
    notify_day_shift_start: bool
    notify_night_shift_start: bool
    notify_office_roster: bool
    notify_reminders: bool
    notify_general: bool
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Mail Reporter ────────────────────────────────────────

class MailboxConfigCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=1, max_length=500)
    subject_filter: str = Field(default="NONE", max_length=200)
    telegram_target: str = Field(default="", max_length=200)
    enabled: bool = True
    monitor_since: Optional[date] = None

class MailboxConfigUpdate(BaseModel):
    email: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, max_length=500)
    subject_filter: Optional[str] = Field(default=None, max_length=200)
    telegram_target: Optional[str] = Field(default=None, max_length=200)
    enabled: Optional[bool] = None
    monitor_since: Optional[date] = None

class EmailLogUpdate(BaseModel):
    is_solved: Optional[bool] = None
    solver_comment: Optional[str] = Field(default=None, max_length=1000)
    status: Optional[str] = Field(default=None, pattern="^(unchecked|solved|on_pause|blocked)$")

class MailboxConfigResponse(BaseModel):
    id: int
    email: str
    subject_filter: str
    telegram_target: str
    enabled: bool
    monitor_since: Optional[date]
    last_poll_at: Optional[datetime]
    last_error: Optional[str]
    consecutive_failures: int
    created_at: datetime
    class Config:
        from_attributes = True

class EmailCommentCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)

class EmailCommentResponse(BaseModel):
    id: int
    email_id: int
    user_id: Optional[UUID] = None
    username: str
    text: str
    created_at: datetime
    class Config:
        from_attributes = True

class EmailLogResponse(BaseModel):
    id: int
    mailbox_id: int
    mailbox_email: Optional[str] = None  # populated in router
    fingerprint: str
    subject: Optional[str]
    sender: Optional[str]
    category: str
    rule_id: Optional[int] = None
    telegram_sent: bool
    telegram_target_used: Optional[str]
    extracted_code: Optional[str]
    skip_reason: Optional[str]
    received_at: Optional[datetime]
    created_at: datetime
    status: str = "unchecked"
    is_solved: bool = False
    solver_comment: Optional[str] = None
    solved_at: Optional[datetime] = None
    comment_count: int = 0
    class Config:
        from_attributes = True


# ─── Mail Routing Rules ───────────────────────────────────

class MailRoutingRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    match_type: str = Field(..., pattern="^(keyword|subject_keyword|sender|sender_domain)$")
    match_values: str = Field(..., min_length=1, max_length=1000)
    label: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="#6b7280", pattern=r"^#[0-9a-fA-F]{6}$")
    hashtag: Optional[str] = Field(default=None, max_length=200)
    mention_users: Optional[str] = Field(default=None, max_length=200)
    include_body: bool = True
    telegram_target: Optional[str] = Field(default=None, max_length=200)
    priority: int = Field(default=10, ge=1, le=999)
    enabled: bool = True
    mailbox_id: Optional[int] = None  # None = applies to all mailboxes

class MailRoutingRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    match_type: Optional[str] = Field(default=None, pattern="^(keyword|subject_keyword|sender|sender_domain)$")
    match_values: Optional[str] = Field(default=None, max_length=1000)
    label: Optional[str] = Field(default=None, max_length=100)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    hashtag: Optional[str] = Field(default=None, max_length=200)
    mention_users: Optional[str] = Field(default=None, max_length=200)
    include_body: Optional[bool] = None
    telegram_target: Optional[str] = Field(default=None, max_length=200)
    priority: Optional[int] = Field(default=None, ge=1, le=999)
    enabled: Optional[bool] = None
    mailbox_id: Optional[int] = None  # None = applies to all mailboxes

class MailRoutingRuleResponse(BaseModel):
    id: int
    name: str
    is_builtin: bool
    builtin_key: Optional[str]
    match_type: Optional[str]
    match_values: Optional[str]
    label: str
    color: str
    hashtag: Optional[str]
    mention_users: Optional[str]
    include_body: bool
    telegram_target: Optional[str]
    priority: int
    enabled: bool
    mailbox_id: Optional[int]
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Telegram Templates ──────────────────────────────────

class TelegramTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    chat_id: str = Field(..., min_length=1, max_length=50)
    topic_id: Optional[int] = Field(default=None, ge=1)

class TelegramTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    chat_id: Optional[str] = Field(default=None, max_length=50)
    topic_id: Optional[int] = None

class TelegramTemplateResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    chat_id: str
    topic_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True


# ─── Container Dashboard ─────────────────────────────────

class VPSAgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    alert_template_id: Optional[UUID] = None
    disk_alert_threshold: int = Field(default=85, ge=50, le=99)
    cpu_alert_threshold: int = Field(default=80, ge=1, le=100)
    alert_flags: Optional[dict] = None

class VPSAgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    alert_template_id: Optional[UUID] = None
    is_enabled: Optional[bool] = None
    disk_alert_threshold: Optional[int] = Field(default=None, ge=50, le=99)
    cpu_alert_threshold: Optional[int] = Field(default=None, ge=1, le=100)
    alert_flags: Optional[dict] = None

class VPSAgentResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    last_seen: Optional[datetime]
    ip_address: Optional[str]
    hostname: Optional[str]
    is_enabled: bool
    created_at: datetime
    alert_template_id: Optional[UUID]
    disk_alert_threshold: int = 85
    cpu_alert_threshold: int = 80
    alert_flags: Optional[dict] = None
    class Config:
        from_attributes = True

class VPSAgentRegisterResponse(VPSAgentResponse):
    api_key: Optional[str] = None  # plain token shown once; never stored again

class ContainerStateInput(BaseModel):
    docker_id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., max_length=255)
    image: str = Field(..., max_length=500)
    status: str = Field(..., max_length=50)
    state_detail: Optional[dict] = None
    ports: Optional[list[dict]] = None
    cpu_percent: Optional[float] = Field(default=None, ge=0, le=100)
    mem_usage_bytes: Optional[int] = Field(default=None, ge=0)
    mem_limit_bytes: Optional[int] = Field(default=None, ge=0)
    logs: Optional[list[str]] = Field(default=None, max_length=50)

class SystemMetrics(BaseModel):
    cpu_percent: Optional[float] = Field(default=None, ge=0, le=100)
    mem_used_bytes: Optional[int] = Field(default=None, ge=0)
    mem_total_bytes: Optional[int] = Field(default=None, ge=0)
    disk_used_bytes: Optional[int] = Field(default=None, ge=0)
    disk_total_bytes: Optional[int] = Field(default=None, ge=0)
    load_avg_1m: Optional[float] = Field(default=None, ge=0)
    load_avg_5m: Optional[float] = Field(default=None, ge=0)
    uptime_seconds: Optional[int] = Field(default=None, ge=0)

class LoginEvent(BaseModel):
    username: str = Field(..., max_length=100)
    ip: Optional[str] = Field(default=None, max_length=45)
    timestamp: Optional[str] = None
    event_type: str = Field(default="login", max_length=20)

class PendingUpdate(BaseModel):
    package: str = Field(..., max_length=200)
    current_version: Optional[str] = Field(default=None, max_length=100)
    new_version: Optional[str] = Field(default=None, max_length=100)

class SystemSnapshotResponse(BaseModel):
    system: Optional[SystemMetrics] = None
    recent_logins: list[LoginEvent] = []
    pending_updates: list[PendingUpdate] = []
    failed_services: list[str] = []
    snapshot_at: Optional[str] = None

class AgentReportRequest(BaseModel):
    hostname: Optional[str] = Field(default=None, max_length=255)
    ip_address: Optional[str] = Field(default=None, max_length=45)
    containers: list[ContainerStateInput] = Field(default_factory=list, max_length=500)
    system: Optional[SystemMetrics] = None
    recent_logins: Optional[list[LoginEvent]] = None
    pending_updates: Optional[list[PendingUpdate]] = None
    failed_services: Optional[list[str]] = None

class AgentReportResponse(BaseModel):
    ok: bool = True

class ContainerStateResponse(BaseModel):
    id: UUID
    agent_id: UUID
    docker_id: str
    name: str
    image: str
    status: str
    state_detail: Optional[dict] = None
    ports: Optional[list] = None
    cpu_percent: Optional[float] = None
    mem_usage_bytes: Optional[int] = None
    mem_limit_bytes: Optional[int] = None
    last_logs: Optional[list] = None
    reported_at: datetime
    is_absent: bool
    display_name: Optional[str] = None
    description: Optional[str] = None
    hosted_on: Optional[str] = None

    @field_validator('state_detail', 'ports', 'last_logs', mode='before')
    @classmethod
    def _parse_json(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return _json.loads(v)
            except Exception:
                return None
        return v

    class Config:
        from_attributes = True

class ContainerMetaUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    hosted_on: Optional[str] = Field(default=None, max_length=150)

class AgentWithContainersResponse(VPSAgentResponse):
    containers: list[ContainerStateResponse] = Field(default_factory=list)
    online: bool = False
    snapshot: Optional[SystemSnapshotResponse] = None
