"""Pydantic schemas for request/response validation."""
from pydantic import BaseModel, Field
from datetime import date, time, datetime
from typing import Optional
from uuid import UUID
from app.models.models import UserRole, ShiftType, TimeOffStatus, TimeOffType, ReminderStatus


# ─── Auth ────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=6)

class OTPVerifyRequest(BaseModel):
    temp_token: str
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


# ─── Users ───────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    email: Optional[str] = None
    role: UserRole = UserRole.ENGINEER
    telegram_username: Optional[str] = None
    min_shift_gap_days: int = Field(default=2, ge=0, le=7)
    max_shifts_per_week: int = Field(default=3, ge=1, le=7)

class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    min_shift_gap_days: Optional[int] = Field(default=None, ge=0, le=7)
    max_shifts_per_week: Optional[int] = Field(default=None, ge=1, le=7)
    is_active: Optional[bool] = None

class UserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str
    email: Optional[str]
    role: UserRole
    is_active: bool
    otp_enabled: bool
    telegram_username: Optional[str]
    telegram_chat_id: Optional[str]
    min_shift_gap_days: int
    max_shifts_per_week: int
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Schedule ────────────────────────────────────────────

class ShiftCreate(BaseModel):
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    notes: Optional[str] = None

class ShiftResponse(BaseModel):
    id: UUID
    user_id: UUID
    date: date
    shift_type: ShiftType
    start_time: Optional[time]
    end_time: Optional[time]
    notes: Optional[str]
    is_published: bool
    user: Optional[UserResponse] = None

    class Config:
        from_attributes = True

class ScheduleGenerateRequest(BaseModel):
    start_date: date
    end_date: date
    shift_types: list[ShiftType] = [ShiftType.MORNING, ShiftType.AFTERNOON, ShiftType.NIGHT]
    user_ids: Optional[list[UUID]] = None  # None = all active engineers

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


# ─── Telegram ────────────────────────────────────────────

class TelegramLinkRequest(BaseModel):
    code: str
