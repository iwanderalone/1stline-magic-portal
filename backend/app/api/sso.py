"""Keycloak OIDC SSO login — additive to local username/password + TOTP login.

GET  /auth/sso/start      redirect the browser to Keycloak's own login page
GET  /auth/sso/callback   Keycloak redirects here after login; resolves the
                          portal user and hands off via a one-time ticket
POST /auth/sso/exchange   frontend trades the ticket for real portal tokens
"""
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.encryption import encrypt
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.models.models import User, UserRole
from app.schemas.schemas import SsoExchangeRequest, TokenResponse, UserResponse
from app.services import keycloak_service as kc
from app.services.audit import log_action

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/sso", tags=["auth"])


def _portal_public_url() -> str:
    s = get_settings()
    if s.PORTAL_PUBLIC_URL:
        return s.PORTAL_PUBLIC_URL.rstrip("/")
    origins = s.cors_origins_list
    return origins[0].rstrip("/") if origins else ""


@router.get("/start")
async def sso_start():
    if not kc.enabled():
        raise HTTPException(status_code=503, detail="SSO is not configured")
    state, nonce = kc.new_pending_state()
    url = await kc.build_authorize_url(state, nonce)
    return RedirectResponse(url, status_code=302)


async def _unique_username(db: AsyncSession, base: str) -> str:
    base = (base or "user").lower()
    candidate = base
    suffix = 1
    while (await db.execute(select(User).where(User.username == candidate))).scalar_one_or_none():
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


@router.get("/callback")
async def sso_callback(
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    public_url = _portal_public_url()

    def _fail(reason: str) -> RedirectResponse:
        return RedirectResponse(f"{public_url}/#/sso-callback?error={reason}", status_code=302)

    if not kc.enabled():
        return _fail("sso_disabled")
    if error:
        logger.info("[sso] Keycloak returned error=%s", error)
        return _fail("keycloak_error")

    nonce = kc.pop_pending_state(state)
    if nonce is None:
        return _fail("invalid_state")

    try:
        kc_tokens = await kc.exchange_code(code)
        claims = await kc.verify_id_token(kc_tokens["id_token"], nonce)
    except Exception:
        logger.exception("[sso] code exchange / id_token verification failed")
        return _fail("exchange_failed")

    groups = kc.extract_groups(claims)
    role = kc.resolve_role(groups)
    if role is None:
        logger.info("[sso] rejected %s — not in any portal access group", claims.get("email"))
        return _fail("no_access_group")

    sso_subject = claims["sub"]
    email = claims.get("email")

    user = (await db.execute(select(User).where(User.sso_subject == sso_subject))).scalar_one_or_none()
    if user is None and email:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    if user is not None:
        if not user.is_active:
            return _fail("account_deactivated")
        user.sso_subject = sso_subject
        user.role = role
    else:
        username = await _unique_username(db, claims.get("preferred_username") or (email or "user").split("@")[0])
        user = User(
            username=username,
            display_name=claims.get("name") or username,
            email=email,
            hashed_password=hash_password(secrets.token_urlsafe(32)),  # unusable — SSO-only account
            role=role,
            sso_subject=sso_subject,
        )
        db.add(user)

    user.sso_refresh_token_encrypted = encrypt(kc_tokens["refresh_token"])
    await db.flush()  # ensure user.id is populated (new users) before the audit log FK references it
    await log_action(db, user, "login", "SSO auth (Keycloak)")
    await db.commit()
    await db.refresh(user)

    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    ticket = kc.new_login_ticket({
        "access_token": access,
        "refresh_token": refresh,
        "user": UserResponse.model_validate(user).model_dump(mode="json"),
    })
    logger.info("[sso] %s logged in via Keycloak (role=%s)", user.username, role.value)
    return RedirectResponse(f"{public_url}/#/sso-callback?ticket={ticket}", status_code=302)


@router.post("/exchange", response_model=TokenResponse)
async def sso_exchange(req: SsoExchangeRequest):
    tokens = kc.pop_login_ticket(req.ticket)
    if tokens is None:
        raise HTTPException(status_code=401, detail="Invalid or expired ticket")
    return tokens
