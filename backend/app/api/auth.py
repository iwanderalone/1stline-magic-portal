"""Authentication endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, generate_otp_secret, generate_otp_qr_base64, verify_otp,
)
from app.core.deps import get_current_user
from app.models.models import User
from app.schemas.schemas import (
    LoginRequest, OTPVerifyRequest, OTPSetupResponse,
    TokenResponse, RefreshRequest, UserResponse,
)
import secrets

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Step 1: Validate credentials. If OTP enabled, return temp token for step 2."""
    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # If OTP enabled, require second factor
    if user.otp_enabled:
        temp_token = create_access_token(
            {"sub": str(user.id), "otp_pending": True},
        )
        return {"requires_otp": True, "temp_token": temp_token}

    # No OTP — issue tokens directly
    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=UserResponse.model_validate(user),
    )


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp_endpoint(req: OTPVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Step 2: Verify OTP code and issue full tokens."""
    payload = decode_token(req.temp_token)
    if not payload or not payload.get("otp_pending"):
        raise HTTPException(status_code=401, detail="Invalid temp token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.otp_secret:
        raise HTTPException(status_code=401, detail="OTP not configured")

    if not verify_otp(user.otp_secret, req.otp_code):
        raise HTTPException(status_code=401, detail="Invalid OTP code")

    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=UserResponse.model_validate(user),
    )


@router.post("/setup-otp", response_model=OTPSetupResponse)
async def setup_otp(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate OTP secret and QR code for the current user."""
    secret = generate_otp_secret()
    user.otp_secret = secret
    user.otp_enabled = False  # Not enabled until confirmed
    await db.flush()

    qr_b64 = generate_otp_qr_base64(secret, user.username)
    return OTPSetupResponse(qr_svg_base64=qr_b64, secret=secret)


@router.post("/confirm-otp")
async def confirm_otp(
    req: OTPVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm OTP setup by verifying a code. Enables OTP for the user."""
    if not user.otp_secret:
        raise HTTPException(status_code=400, detail="Run setup-otp first")

    if not verify_otp(user.otp_secret, req.otp_code):
        raise HTTPException(status_code=400, detail="Invalid code — try again")

    user.otp_enabled = True
    await db.flush()
    return {"message": "OTP enabled successfully"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")

    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)
