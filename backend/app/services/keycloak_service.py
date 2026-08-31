"""Keycloak OIDC SSO — additive to local username/password + TOTP login.

Group membership in the realm is the sole source of truth for both whether
someone can log in via SSO at all, and which portal role they get
(KEYCLOAK_ADMIN_GROUP > KEYCLOAK_MANAGER_GROUP > KEYCLOAK_ENGINEER_GROUP
priority if somehow in more than one). No new dependency: OIDC discovery and
token exchange use the already-installed httpx; ID-token signature
verification uses the already-installed python-jose against the realm's
JWKS.
"""
import logging
import secrets
import time
from typing import Optional

import httpx
from jose import jwt as jose_jwt, JWTError

from app.core.config import get_settings
from app.models.models import UserRole

logger = logging.getLogger(__name__)

_DISCOVERY_TTL = 3600   # 1h — discovery doc rarely changes
_JWKS_TTL = 3600        # 1h — signing keys rotate infrequently
STATE_TTL = 600         # 10 min to complete the Keycloak round trip
TICKET_TTL = 60         # one-time token-delivery ticket, single use


def _kc(key: str, cast=str):
    from app.core.dynamic_settings import eff
    return eff(key, getattr(get_settings(), key), cast=cast)


def enabled() -> bool:
    return bool(
        _kc("KEYCLOAK_SERVER_URL") and _kc("KEYCLOAK_REALM")
        and _kc("KEYCLOAK_CLIENT_ID") and _kc("KEYCLOAK_CLIENT_SECRET")
        and _kc("KEYCLOAK_REDIRECT_URI")
    )


# ─── in-memory caches / stores (single-worker, not shared across restarts —
# same idiom as auth.py's brute-force dict and mailbox_backup_service.py's
# JOBS dict) ────────────────────────────────────────────────────────────

_discovery_cache: dict = {}   # {"data": {...}, "fetched_at": float}
_jwks_cache: dict = {}        # {"data": {...}, "fetched_at": float}
_pending_states: dict[str, dict] = {}   # state -> {"nonce": str, "created_at": float}
_login_tickets: dict[str, dict] = {}    # ticket -> {"tokens": {...}, "created_at": float}


def _realm_url() -> str:
    return f"{_kc('KEYCLOAK_SERVER_URL').rstrip('/')}/realms/{_kc('KEYCLOAK_REALM')}"


async def _discovery() -> dict:
    now = time.time()
    if _discovery_cache and now - _discovery_cache["fetched_at"] < _DISCOVERY_TTL:
        return _discovery_cache["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_realm_url()}/.well-known/openid-configuration")
        resp.raise_for_status()
        data = resp.json()
    _discovery_cache.update(data=data, fetched_at=now)
    return data


async def _jwks() -> dict:
    now = time.time()
    if _jwks_cache and now - _jwks_cache["fetched_at"] < _JWKS_TTL:
        return _jwks_cache["data"]
    disc = await _discovery()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(disc["jwks_uri"])
        resp.raise_for_status()
        data = resp.json()
    _jwks_cache.update(data=data, fetched_at=now)
    return data


# ─── state / nonce (CSRF + replay protection for the OAuth round trip) ──

def new_pending_state() -> tuple[str, str]:
    """Returns (state, nonce); both must be echoed back correctly at callback."""
    _sweep_expired(_pending_states, STATE_TTL)
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    _pending_states[state] = {"nonce": nonce, "created_at": time.time()}
    return state, nonce


def pop_pending_state(state: str) -> Optional[str]:
    """Consumes a pending state; returns its nonce, or None if unknown/expired."""
    _sweep_expired(_pending_states, STATE_TTL)
    entry = _pending_states.pop(state, None)
    return entry["nonce"] if entry else None


# ─── one-time login ticket (hands the local token pair to the SPA without
# ever putting a refresh token in a URL / browser history) ───────────────

def new_login_ticket(tokens: dict) -> str:
    _sweep_expired(_login_tickets, TICKET_TTL)
    ticket = secrets.token_urlsafe(32)
    _login_tickets[ticket] = {"tokens": tokens, "created_at": time.time()}
    return ticket


def pop_login_ticket(ticket: str) -> Optional[dict]:
    _sweep_expired(_login_tickets, TICKET_TTL)
    entry = _login_tickets.pop(ticket, None)
    return entry["tokens"] if entry else None


def _sweep_expired(store: dict, ttl: float) -> None:
    now = time.time()
    for key in [k for k, v in store.items() if now - v["created_at"] > ttl]:
        store.pop(key, None)


# ─── OIDC flow ────────────────────────────────────────────────────────

async def build_authorize_url(state: str, nonce: str) -> str:
    disc = await _discovery()
    params = {
        "client_id": _kc("KEYCLOAK_CLIENT_ID"),
        "redirect_uri": _kc("KEYCLOAK_REDIRECT_URI"),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
    }
    return str(httpx.URL(disc["authorization_endpoint"], params=params))


async def exchange_code(code: str) -> dict:
    """Authorization-code grant. Returns Keycloak's {access_token, refresh_token, id_token, ...}."""
    disc = await _discovery()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(disc["token_endpoint"], data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _kc("KEYCLOAK_REDIRECT_URI"),
            "client_id": _kc("KEYCLOAK_CLIENT_ID"),
            "client_secret": _kc("KEYCLOAK_CLIENT_SECRET"),
        })
    if resp.status_code >= 400:
        raise RuntimeError(f"Keycloak token exchange failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


async def silent_refresh(kc_refresh_token: str) -> Optional[dict]:
    """Refresh-token grant, used to silently re-validate an SSO session (and
    pull current group membership) without any user interaction. Returns
    None if Keycloak rejects it (revoked/expired/user disabled)."""
    try:
        disc = await _discovery()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(disc["token_endpoint"], data={
                "grant_type": "refresh_token",
                "refresh_token": kc_refresh_token,
                "client_id": _kc("KEYCLOAK_CLIENT_ID"),
                "client_secret": _kc("KEYCLOAK_CLIENT_SECRET"),
            })
        if resp.status_code >= 400:
            logger.info("[keycloak] silent refresh rejected: %s %s", resp.status_code, resp.text[:200])
            return None
        return resp.json()
    except Exception:
        logger.exception("[keycloak] silent refresh errored")
        return None


async def verify_id_token(id_token: str, expected_nonce: str) -> dict:
    """Verify signature (against the realm JWKS), audience, issuer, expiry,
    and nonce. Raises on any failure — callers must not use unverified claims."""
    disc = await _discovery()
    jwks = await _jwks()

    unverified_header = jose_jwt.get_unverified_header(id_token)
    kid = unverified_header.get("kid")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise JWTError(f"no matching JWK for kid={kid!r}")

    claims = jose_jwt.decode(
        id_token, key,
        algorithms=[unverified_header.get("alg", "RS256")],
        audience=_kc("KEYCLOAK_CLIENT_ID"),
        issuer=disc["issuer"],
    )
    if claims.get("nonce") != expected_nonce:
        raise JWTError("nonce mismatch")
    return claims


def unverified_claims(token: str) -> dict:
    """Parse a JWT's claims WITHOUT verifying its signature. Only safe to use
    on a token that just came directly from Keycloak's token endpoint over an
    authenticated (client_secret) server-to-server call — i.e. the silent
    refresh path, where the transport itself is already trusted and there's
    no browser-relayed value that could have been forged or replayed. The
    initial login callback (verify_id_token) always does full verification,
    since that ID token arrives via a browser redirect an attacker could
    tamper with."""
    return jose_jwt.get_unverified_claims(token)


def extract_groups(claims: dict) -> set[str]:
    """Normalizes Keycloak's full-path ('/g-app-itportal-admin') vs
    short-name group claim formats to bare names."""
    raw = claims.get(_kc("KEYCLOAK_GROUPS_CLAIM")) or []
    return {g.rsplit("/", 1)[-1] for g in raw if g}


def resolve_role(groups: set[str]) -> Optional[UserRole]:
    if _kc("KEYCLOAK_ADMIN_GROUP") in groups:
        return UserRole.ADMIN
    if _kc("KEYCLOAK_MANAGER_GROUP") in groups:
        return UserRole.MANAGER
    if _kc("KEYCLOAK_ENGINEER_GROUP") in groups:
        return UserRole.ENGINEER
    return None
