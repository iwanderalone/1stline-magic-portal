"""Pydantic schemas — expanded."""
import json as _json
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from datetime import date, time, datetime
from typing import Optional, Any, Literal
from uuid import UUID
from app.models.models import (
    UserRole, ShiftType, WorkLocation, TimeOffStatus,
    TimeOffType, ReminderStatus, TelegramChatType,
)



class BaseOrmModel(BaseModel):
    """Base class for all SQLAlchemy ORM response schemas."""
    model_config = ConfigDict(from_attributes=True)


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

class GroupResponse(BaseOrmModel):
    id: UUID
    name: str
    description: Optional[str]
    color: str
    member_ids: list[UUID] = []
    created_at: datetime


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
    email: Optional[str] = Field(default=None, max_length=255)
    timezone: Optional[str] = Field(default=None, max_length=50)
    telegram_username: Optional[str] = None
    telegram_notify_shifts: Optional[bool] = None
    telegram_notify_reminders: Optional[bool] = None

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

class PublicUserResponse(BaseOrmModel):
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


class UserResponse(BaseOrmModel):
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


# ─── Shift Config ────────────────────────────────────────

class ShiftConfigUpdate(BaseModel):
    label: Optional[str] = None
    duration_hours: Optional[float] = None
    default_start_time: Optional[time] = None
    default_end_time: Optional[time] = None
    color: Optional[str] = None
    emoji: Optional[str] = None
    requires_location: Optional[bool] = None
    is_active: Optional[bool] = None

class ShiftConfigResponse(BaseOrmModel):
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


# ─── Schedule ────────────────────────────────────────────

class ShiftCreate(BaseModel):
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    location: Optional[WorkLocation] = None
    notes: Optional[str] = None

class ShiftResponse(BaseOrmModel):
    id: UUID
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time]
    end_time: Optional[time]
    location: Optional[WorkLocation]
    notes: Optional[str]
    is_published: bool
    pending_delete: bool = False
    user: Optional[PublicUserResponse] = None

class ShiftUpdate(BaseModel):
    shift_type: Optional[ShiftType] = None
    location: Optional[WorkLocation] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    notes: Optional[str] = None
    is_published: Optional[bool] = None
    pending_delete: Optional[bool] = None

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

class TimeOffResponse(BaseOrmModel):
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

class TimeOffReviewRequest(BaseModel):
    status: TimeOffStatus
    admin_comment: Optional[str] = None


class UserBlockedDateCreate(BaseModel):
    user_id: UUID
    start_date: date
    end_date: date
    reason: Optional[str] = Field(default=None, max_length=255)


class UserBlockedDateResponse(BaseOrmModel):
    id: UUID
    user_id: UUID
    start_date: date
    end_date: date
    reason: Optional[str] = None
    created_at: datetime


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

class ReminderResponse(BaseOrmModel):
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


# ─── Notifications ───────────────────────────────────────

class NotificationResponse(BaseOrmModel):
    id: UUID
    title: str
    message: str
    is_read: bool
    created_at: datetime


# ─── Activity Logs ───────────────────────────────────────

class ActivityLogResponse(BaseOrmModel):
    id: UUID
    user_id: Optional[UUID]
    username: Optional[str]
    action: str
    details: Optional[str]
    created_at: datetime


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

class TelegramChatResponse(BaseOrmModel):
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
    solver_comment: Optional[str] = Field(default=None, max_length=1000)
    status: Optional[str] = Field(default=None, pattern="^(unchecked|solved|on_pause|blocked)$")

class MailboxConfigResponse(BaseOrmModel):
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

class EmailCommentCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)

class EmailCommentResponse(BaseOrmModel):
    id: int
    email_id: int
    user_id: Optional[UUID] = None
    username: str
    text: str
    created_at: datetime

class EmailLogResponse(BaseOrmModel):
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
    solver_comment: Optional[str] = None
    solved_at: Optional[datetime] = None
    comment_count: int = 0

class EmailLogDetailResponse(EmailLogResponse):
    body: Optional[str] = None


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

class MailRoutingRuleResponse(BaseOrmModel):
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

class TelegramTemplateResponse(BaseOrmModel):
    id: UUID
    name: str
    description: Optional[str]
    chat_id: str
    topic_id: Optional[int]
    created_at: datetime
    updated_at: datetime


# ─── Runbooks ────────────────────────────────────────────

class RunbookStepCreate(BaseModel):
    order: int = Field(..., ge=1)
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    code_block: Optional[str] = None
    code_language: Optional[str] = Field(default=None, max_length=20)

class RunbookStepResponse(BaseOrmModel):
    id: UUID
    order: int
    title: str
    description: Optional[str]
    code_block: Optional[str]
    code_language: Optional[str]

class RunbookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str = Field(default="general", max_length=50)
    tags: Optional[list[str]] = None
    when_to_use: Optional[str] = None
    owner_id: Optional[UUID] = None
    steps: list[RunbookStepCreate] = []

class RunbookUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=50)
    tags: Optional[list[str]] = None
    when_to_use: Optional[str] = None
    owner_id: Optional[UUID] = None
    steps: Optional[list[RunbookStepCreate]] = None

class RunbookOwnerResponse(BaseOrmModel):
    id: UUID
    display_name: str
    username: str

class RunbookResponse(BaseOrmModel):
    id: UUID
    slug: str
    title: str
    category: str
    tags: Optional[list[str]] = None
    when_to_use: Optional[str]
    owner: Optional[RunbookOwnerResponse]
    run_count: int
    steps: list[RunbookStepResponse] = []
    created_at: datetime
    updated_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def parse_tags(cls, v):
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except Exception:
                return []
        return v




# ─── Zammad ──────────────────────────────────────────────

ZammadEventType = Literal[
    "ticket_opened",
    "ticket_assigned",
    "comment_added",
    "ticket_closed",
    "ticket_paused",
    "ticket_status_changed",
    "ticket_sync",
]

class ZammadWebhookPayload(BaseModel):
    """
    Zammad webhook body. Configure one webhook trigger per event in Zammad
    and pass the event name as a query parameter:
      POST /api/tickets/webhook?event=ticket_opened
      POST /api/tickets/webhook?event=ticket_assigned
      POST /api/tickets/webhook?event=comment_added
      POST /api/tickets/webhook?event=ticket_closed
      POST /api/tickets/webhook?event=ticket_paused
      POST /api/tickets/webhook?event=ticket_status_changed
      POST /api/tickets/webhook?event=ticket_sync

    The event parameter may also be omitted; the backend will infer one
    or more supported event types from the Zammad payload.

    Zammad sends the full ticket object on every trigger. The `article`
    field is populated only for comment events.
    """
    ticket: Optional[dict[str, Any]] = None
    article: Optional[dict[str, Any]] = None

    model_config = ConfigDict(extra="allow")


class ZammadEventResponse(BaseOrmModel):
    id: int
    event_type: str
    ticket_id: Optional[int]
    ticket_number: Optional[str]
    ticket_title: Optional[str]
    ticket_state: Optional[str]
    ticket_group: Optional[str]
    ticket_priority: Optional[str]
    assignee: Optional[str]
    customer: Optional[str]
    article_body: Optional[str]
    payload: str
    received_at: datetime


class ZammadCommentResponse(BaseOrmModel):
    id: int
    article_id: Optional[int]
    ticket_id: int
    author: Optional[str]
    sender: Optional[str]
    body: Optional[str]
    internal: Optional[bool]
    portal_only: bool = False
    zammad_created_at: Optional[datetime]
    created_at: datetime


class ZammadTicketResponse(BaseModel):
    """Current-state ticket for the board view."""
    id: int
    number: Optional[str]
    title: Optional[str]
    state: Optional[str]
    bucket: str
    group_name: Optional[str]
    priority: Optional[str]
    assignee: Optional[str]
    customer: Optional[str]
    request_type: Optional[str] = None
    description: Optional[str] = None
    article_count: Optional[int]
    last_comment: Optional[str]
    last_event_type: Optional[str]
    last_event_at: Optional[datetime]
    state_changed_at: Optional[datetime]
    zammad_created_at: Optional[datetime]
    zammad_updated_at: Optional[datetime]
    url: Optional[str]


class ZammadTicketDetail(ZammadTicketResponse):
    comments: list[ZammadCommentResponse] = []
    events: list[ZammadEventResponse] = []


class ZammadReplyCreate(BaseModel):
    """Portal-only internal note — stored on the website, never sent to Zammad."""
    body: str = Field(min_length=1, max_length=8000)
