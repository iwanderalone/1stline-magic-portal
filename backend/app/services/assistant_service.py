"""AI assistant — Gemini function-calling over team data.

Privacy boundary (user-approved, updated 2026-07-09): team data (schedule,
time-off, runbooks) + email queue METADATA in bulk. Full email/ticket content
is allowed only per-case, when the user explicitly references that case in
chat (get_email_case / get_ticket_case) — never in bulk.
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import (
    Shift, TimeOffRequest, TimeOffStatus, TimeOffType,
    Runbook, RunbookStep, User,
)

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 6

TOOL_DECLARATIONS = [
    {
        "name": "get_my_schedule",
        "description": "Get the current user's own shifts in a date range (defaults to the next 14 days).",
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD, default today"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, default start+14d"},
            },
        },
    },
    {
        "name": "get_team_schedule",
        "description": "Get all published shifts for the whole team in a date range (max 14 days), including who is on each shift.",
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD, default today"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, default start+7d"},
            },
        },
    },
    {
        "name": "get_my_timeoff",
        "description": "List the current user's time-off requests and their statuses (pending/approved/rejected).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "file_timeoff_request",
        "description": (
            "File a time-off request for the current user. It is created as PENDING and still requires "
            "admin approval. Always confirm dates and type with the user before calling this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD (same as start for a single day)"},
                "off_type": {"type": "string", "enum": ["day_off", "vacation", "sick_leave"]},
                "comment": {"type": "string", "description": "Optional short reason"},
            },
            "required": ["start_date", "end_date", "off_type"],
        },
    },
    {
        "name": "review_emails",
        "description": (
            "Review the operational mail queue for a period: counts by status plus a compact list "
            "(subject, sender, status, category, replied?). Use for questions like 'did we miss "
            "anything today/this week?', 'what is on pause?', 'were there onboarding requests?'. "
            "Categories come from routing rules (e.g. onboarding, adobe). Statuses: unchecked = "
            "nobody looked at it yet, on_pause = waiting, blocked, solved."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["today", "week", "month"], "description": "How far back to look"},
                "only": {"type": "string", "enum": ["all", "unchecked", "on_pause", "unsolved"], "description": "Optional status focus, default all"},
            },
            "required": ["period"],
        },
    },
    {
        "name": "get_email_case",
        "description": (
            "Fetch one email case in full (subject, sender, body, engineer comments) by its id — "
            "the number shown in the mail queue. Use when the user says 'check this email' or asks "
            "to draft a runbook from an email case."
        ),
        "parameters": {
            "type": "object",
            "properties": {"email_id": {"type": "integer"}},
            "required": ["email_id"],
        },
    },
    {
        "name": "get_ticket_case",
        "description": (
            "Fetch one Zammad ticket in full (title, description, state, comment thread) by its "
            "ticket number (e.g. 82505). Use when the user says 'check this ticket' or asks to "
            "draft a runbook from a ticket."
        ),
        "parameters": {
            "type": "object",
            "properties": {"number": {"type": "string", "description": "Ticket number, e.g. 82505"}},
            "required": ["number"],
        },
    },
    {
        "name": "create_runbook_draft",
        "description": (
            "Create a runbook DRAFT in the library. Always show the user the proposed title and "
            "steps in chat and get an explicit confirmation before calling this. The draft is "
            "tagged 'ai-draft' and the engineer will fine-tune it on the Runbooks page. Write "
            "runbooks in English."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "category": {
                    "type": "string",
                    "enum": ["access", "infra", "yandex", "website", "office", "services", "general"],
                    "description": (
                        "Runbook section: access = accounts/permissions/credentials; "
                        "infra = servers, network, proxies, deployments; "
                        "yandex = Yandex 360 services (mail, disk, tracker, wiki); "
                        "website = the public site / CMS; "
                        "office = physical office, equipment, meeting rooms; "
                        "services = internal tools (e.g. LinkScout, portal); "
                        "general = anything that fits nowhere else"
                    ),
                },
                "when_to_use": {"type": "string", "description": "1-2 sentences: when to reach for this runbook"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "code_block": {"type": "string"},
                            "code_language": {"type": "string", "description": "shell, sql, python, yaml…"},
                        },
                        "required": ["title"],
                    },
                },
            },
            "required": ["title", "when_to_use", "steps"],
        },
    },
    {
        "name": "list_runbooks",
        "description": "List all runbooks in the library (slug, title, category). Use when the user asks what runbooks/guides exist.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "search_runbooks",
        "description": "Search the runbook library by keywords (matches title, category, tags, when-to-use and step text). Use for any 'how do I…' operational question.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Keywords, e.g. 'vpn certificate'"}},
            "required": ["query"],
        },
    },
    {
        "name": "get_runbook",
        "description": "Fetch a runbook's full step-by-step instructions by its slug (e.g. rb-001).",
        "parameters": {
            "type": "object",
            "properties": {"slug": {"type": "string"}},
            "required": ["slug"],
        },
    },
]


def _d(value: str | None, default: date) -> date:
    try:
        return date.fromisoformat(value) if value else default
    except ValueError:
        return default


def _shift_dict(s: Shift, with_user: bool) -> dict:
    out = {
        "date": s.date.isoformat(),
        "shift_type": s.shift_type.value if hasattr(s.shift_type, "value") else str(s.shift_type),
        "start_time": s.start_time.isoformat()[:5] if s.start_time else None,
        "end_time": s.end_time.isoformat()[:5] if s.end_time else None,
        "location": s.location.value if s.location else None,
    }
    if with_user:
        out["engineer"] = s.user.display_name or s.user.username if s.user else None
    return out


async def _tool_get_my_schedule(user: User, args: dict) -> dict:
    start = _d(args.get("start_date"), date.today())
    end = _d(args.get("end_date"), start + timedelta(days=14))
    async with AsyncSessionFactory() as db:
        rows = (await db.execute(
            select(Shift).where(
                Shift.user_id == user.id,
                Shift.date >= start, Shift.date <= end,
                Shift.is_published.is_(True), Shift.pending_delete.is_(False),
            ).order_by(Shift.date)
        )).scalars().all()
    return {"shifts": [_shift_dict(s, False) for s in rows], "range": f"{start} — {end}"}


async def _tool_get_team_schedule(user: User, args: dict) -> dict:
    start = _d(args.get("start_date"), date.today())
    end = min(_d(args.get("end_date"), start + timedelta(days=7)), start + timedelta(days=14))
    async with AsyncSessionFactory() as db:
        rows = (await db.execute(
            select(Shift).options(selectinload(Shift.user)).where(
                Shift.date >= start, Shift.date <= end,
                Shift.is_published.is_(True), Shift.pending_delete.is_(False),
            ).order_by(Shift.date, Shift.shift_type)
        )).scalars().all()
        out = [_shift_dict(s, True) for s in rows]
    return {"shifts": out, "range": f"{start} — {end}"}


async def _tool_get_my_timeoff(user: User, args: dict) -> dict:
    async with AsyncSessionFactory() as db:
        rows = (await db.execute(
            select(TimeOffRequest).where(TimeOffRequest.user_id == user.id)
            .order_by(TimeOffRequest.start_date.desc()).limit(20)
        )).scalars().all()
    return {"requests": [
        {
            "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(),
            "type": r.off_type.value, "status": r.status.value,
            "comment": r.comment, "admin_comment": r.admin_comment,
        } for r in rows
    ]}


async def _tool_file_timeoff_request(user: User, args: dict) -> dict:
    try:
        start = date.fromisoformat(args["start_date"])
        end = date.fromisoformat(args["end_date"])
        off_type = TimeOffType(args["off_type"])
    except (KeyError, ValueError) as exc:
        return {"error": f"Invalid arguments: {exc}"}
    if end < start:
        return {"error": "end_date is before start_date"}
    if start < date.today():
        return {"error": "start_date is in the past"}
    async with AsyncSessionFactory() as db:
        req = TimeOffRequest(
            user_id=user.id, start_date=start, end_date=end,
            off_type=off_type, status=TimeOffStatus.PENDING,
            comment=(args.get("comment") or "")[:500] or None,
        )
        db.add(req)
        await db.commit()
    logger.info("[assistant] %s filed time-off %s—%s (%s) via assistant", user.username, start, end, off_type.value)
    return {"ok": True, "status": "pending", "note": "Request filed — awaiting admin approval."}


async def _tool_review_emails(user: User, args: dict) -> dict:
    """Email-queue review. Privacy: metadata only (subject/sender/status/category) — never bodies."""
    from app.models.models import EmailLog, EmailReply

    days = {"today": 1, "week": 7, "month": 30}.get(args.get("period"), 7)
    since = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    if days > 1:
        since = since - timedelta(days=days - 1)
    only = args.get("only") or "all"

    async with AsyncSessionFactory() as db:
        q = select(EmailLog).where(
            EmailLog.created_at >= since,
            or_(EmailLog.skip_reason.is_(None), EmailLog.skip_reason.notin_(["filter"])),
        ).order_by(EmailLog.created_at.desc())
        rows = (await db.execute(q)).scalars().all()

        replied_ids = set((await db.execute(
            select(EmailReply.email_id).where(EmailReply.status == "sent")
        )).scalars().all())

    counts = {"total": len(rows), "unchecked": 0, "on_pause": 0, "blocked": 0, "solved": 0, "replied": 0}
    emails = []
    for e in rows:
        counts[e.status] = counts.get(e.status, 0) + 1
        if e.id in replied_ids:
            counts["replied"] += 1
        if only == "unchecked" and e.status != "unchecked":
            continue
        if only == "on_pause" and e.status != "on_pause":
            continue
        if only == "unsolved" and e.status == "solved":
            continue
        if len(emails) < 60:
            emails.append({
                "subject": (e.subject or "")[:120],
                "sender": (e.sender or "")[:80],
                "status": e.status,
                "category": e.category,
                "received": (e.received_at or e.created_at).strftime("%m-%d %H:%M") if (e.received_at or e.created_at) else None,
                "replied": e.id in replied_ids,
                "comments": None,  # kept out to stay compact
            })
    return {"since": since.strftime("%Y-%m-%d"), "counts": counts, "emails": emails}


async def _tool_get_email_case(user: User, args: dict) -> dict:
    """Full single-email case — body access is per-case and human-requested via chat."""
    from app.models.models import EmailLog, EmailComment

    email_id = args.get("email_id")
    async with AsyncSessionFactory() as db:
        e = await db.get(EmailLog, email_id)
        if not e:
            return {"error": f"No email with id {email_id}"}
        comments = (await db.execute(
            select(EmailComment).where(EmailComment.email_id == email_id).order_by(EmailComment.created_at)
        )).scalars().all()
    return {
        "id": e.id,
        "subject": e.subject,
        "sender": e.sender,
        "status": e.status,
        "category": e.category,
        "received": (e.received_at or e.created_at).isoformat()[:16] if (e.received_at or e.created_at) else None,
        "body": (e.body or "")[:4000],
        "comments": [{"by": c.username, "text": (c.text or "")[:500]} for c in comments[:15]],
    }


async def _tool_get_ticket_case(user: User, args: dict) -> dict:
    """Full single-ticket case — content access is per-case and human-requested via chat."""
    from app.models.models import ZammadTicket, ZammadComment

    number = str(args.get("number") or "").strip().lstrip("#")
    async with AsyncSessionFactory() as db:
        t = (await db.execute(
            select(ZammadTicket).where(ZammadTicket.number == number)
        )).scalar_one_or_none()
        if not t:
            return {"error": f"No ticket with number {number}"}
        comments = (await db.execute(
            select(ZammadComment).where(ZammadComment.ticket_id == t.id)
            .order_by(ZammadComment.zammad_created_at.nullslast(), ZammadComment.id)
        )).scalars().all()
    return {
        "number": t.number,
        "title": t.title,
        "state": t.state,
        "request_type": t.request_type,
        "assignee": t.assignee,
        "description": (t.description or "")[:2000],
        "comments": [
            {"by": c.author or c.sender, "internal": bool(c.portal_only), "text": (c.body or "")[:600]}
            for c in comments[:15]
        ],
    }


async def _tool_create_runbook_draft(user: User, args: dict) -> dict:
    """Create an ai-draft runbook. The model must confirm content with the user first."""
    from app.api.runbooks import _next_slug
    from app.models.models import Runbook, RunbookStep

    title = (args.get("title") or "").strip()
    steps = args.get("steps") or []
    if not title or not steps:
        return {"error": "title and at least one step are required"}

    tags = [t for t in (args.get("tags") or []) if isinstance(t, str)][:8]
    if "ai-draft" not in tags:
        tags.append("ai-draft")

    async with AsyncSessionFactory() as db:
        slug = await _next_slug(db)
        rb = Runbook(
            slug=slug,
            title=title[:200],
            category=(args.get("category") or "general")[:50],
            tags=json.dumps(tags),
            when_to_use=args.get("when_to_use"),
            owner_id=user.id,
        )
        db.add(rb)
        await db.flush()
        for i, s in enumerate(steps[:20], start=1):
            if not isinstance(s, dict) or not s.get("title"):
                continue
            db.add(RunbookStep(
                runbook_id=rb.id,
                order=i,
                title=str(s["title"])[:200],
                description=s.get("description"),
                code_block=s.get("code_block"),
                code_language=(s.get("code_language") or None),
            ))
        await db.commit()
    logger.info("[assistant] %s created runbook draft %s — %s", user.username, slug, title[:80])
    return {"ok": True, "slug": slug, "note": "Draft created (tagged ai-draft) — fine-tune it on the Runbooks page."}


async def _tool_list_runbooks(user: User, args: dict) -> dict:
    async with AsyncSessionFactory() as db:
        rows = (await db.execute(select(Runbook).order_by(Runbook.category, Runbook.slug))).scalars().all()
    return {"runbooks": [
        {"slug": r.slug, "title": r.title, "category": r.category, "when_to_use": r.when_to_use}
        for r in rows
    ]}


async def _tool_search_runbooks(user: User, args: dict) -> dict:
    query = (args.get("query") or "").strip()
    if not query:
        return {"matches": []}
    words = [w for w in query.lower().split() if len(w) > 2][:6]
    async with AsyncSessionFactory() as db:
        conds = []
        for w in words or [query.lower()]:
            like = f"%{w}%"
            conds.append(or_(
                Runbook.title.ilike(like), Runbook.category.ilike(like),
                Runbook.tags.ilike(like), Runbook.when_to_use.ilike(like),
            ))
        rows = (await db.execute(select(Runbook).where(or_(*conds)).limit(8))).scalars().all()

        # Also match step text for anything not already found
        step_rows = (await db.execute(
            select(RunbookStep.runbook_id).where(or_(*[
                or_(RunbookStep.title.ilike(f"%{w}%"), RunbookStep.description.ilike(f"%{w}%"))
                for w in (words or [query.lower()])
            ])).limit(20)
        )).scalars().all()
        found_ids = {r.id for r in rows}
        extra_ids = [rid for rid in step_rows if rid not in found_ids][:4]
        if extra_ids:
            rows += (await db.execute(select(Runbook).where(Runbook.id.in_(extra_ids)))).scalars().all()

    return {"matches": [
        {"slug": r.slug, "title": r.title, "category": r.category, "when_to_use": r.when_to_use}
        for r in rows
    ]}


async def _tool_get_runbook(user: User, args: dict) -> dict:
    slug = (args.get("slug") or "").strip().lower()
    async with AsyncSessionFactory() as db:
        rb = (await db.execute(select(Runbook).where(Runbook.slug == slug))).scalar_one_or_none()
        if not rb:
            return {"error": f"No runbook with slug '{slug}'"}
        steps = (await db.execute(
            select(RunbookStep).where(RunbookStep.runbook_id == rb.id).order_by(RunbookStep.order)
        )).scalars().all()
    return {
        "slug": rb.slug, "title": rb.title, "category": rb.category, "when_to_use": rb.when_to_use,
        "steps": [
            {"n": s.order, "title": s.title, "description": s.description,
             "code": s.code_block, "language": s.code_language}
            for s in steps
        ],
    }


TOOL_IMPL = {
    "get_my_schedule": _tool_get_my_schedule,
    "get_team_schedule": _tool_get_team_schedule,
    "get_my_timeoff": _tool_get_my_timeoff,
    "file_timeoff_request": _tool_file_timeoff_request,
    "review_emails": _tool_review_emails,
    "get_email_case": _tool_get_email_case,
    "get_ticket_case": _tool_get_ticket_case,
    "create_runbook_draft": _tool_create_runbook_draft,
    "list_runbooks": _tool_list_runbooks,
    "search_runbooks": _tool_search_runbooks,
    "get_runbook": _tool_get_runbook,
}


def _system_prompt(user: User) -> str:
    return (
        "You are the built-in assistant of the 1stline support portal, helping first-line "
        "support engineers.\n"
        "LANGUAGE RULE (strict): always reply in the language of the user's LAST message. "
        "Russian message -> reply entirely in Russian. English message -> reply in English. "
        "This applies to every part of the reply, including summaries of tool results. "
        "The only exception: runbook drafts themselves are written in English.\n"
        "Be concise and practical; use short lists where helpful.\n"
        f"Today is {date.today().isoformat()} ({date.today().strftime('%A')}). "
        f"The user is {user.display_name or user.username} (role: {user.role.value}).\n"
        "You can look up schedules, time-off, runbooks, and review the operational mail "
        "queue via tools — prefer tools over guessing. When filing a time-off request, "
        "restate the dates and type and get an explicit confirmation from the user first. "
        "Time-off requests always require admin approval afterwards — mention that. "
        "For mail reviews, highlight what needs action: unchecked items first, then "
        "long-paused ones; call out onboarding/offboarding category emails explicitly "
        "(reviews show metadata only — fetch a specific case for full content). "
        "RUNBOOK DRAFTING: when the user says 'check this ticket/email' or pastes case "
        "material and asks for a runbook, fetch the case if referenced, propose a full "
        "draft in chat (title + steps, in English), and only after the user confirms "
        "call create_runbook_draft. Mention the draft is tagged ai-draft and can be "
        "fine-tuned on the Runbooks page. SECTION CHOICE: pick the best-fitting section "
        "and state it explicitly in the proposal (e.g. 'I would put this under Services'). "
        "If no section clearly fits, ask the engineer which one to use instead of "
        "guessing. If the engineer names a different section, use exactly that one."
    )


async def run_chat(user: User, messages: list[dict]) -> dict:
    """Run one assistant turn. `messages` = [{role: user|model, text: str}, ...]."""
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        return {"reply": None, "error": "Assistant is not configured (GEMINI_API_KEY missing)"}

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent"
    )
    contents = [
        {"role": ("model" if m.get("role") == "model" else "user"), "parts": [{"text": (m.get("text") or "")[:4000]}]}
        for m in messages[-16:]  # cap history
    ]
    body = {
        "system_instruction": {"parts": [{"text": _system_prompt(user)}]},
        "contents": contents,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
    }

    tools_used: list[str] = []
    async with httpx.AsyncClient(timeout=45) as client:
        for _ in range(MAX_TOOL_ROUNDS):
            # Google intermittently 503s under load ("high demand") — retry with backoff.
            for attempt in range(3):
                resp = await client.post(url, params={"key": settings.GEMINI_API_KEY}, json=body)
                if resp.status_code != 503:
                    break
                logger.warning("[assistant] Gemini 503 (overloaded), attempt %d/3", attempt + 1)
                await asyncio.sleep(2 * (attempt + 1))
            if resp.status_code == 503:
                return {"reply": None, "error": "The AI model is overloaded on Google's side right now — please try again in a moment."}
            if resp.status_code == 429:
                logger.warning("[assistant] Gemini rate-limited: %s", resp.text[:300])
                return {"reply": None, "error": "The assistant is rate-limited right now — try again in a minute."}
            if resp.status_code >= 400:
                logger.warning("[assistant] Gemini %s: %s", resp.status_code, resp.text[:300])
                return {"reply": None, "error": f"AI service error ({resp.status_code})"}
            data = resp.json()
            try:
                parts = data["candidates"][0]["content"]["parts"]
            except (KeyError, IndexError):
                return {"reply": None, "error": "AI returned an empty response"}

            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            if not calls:
                text = "".join(p.get("text", "") for p in parts).strip()
                return {"reply": text or "…", "tools_used": tools_used}

            # Execute tool calls, then continue the loop with their results.
            body["contents"].append({"role": "model", "parts": parts})
            responses = []
            for call in calls:
                name = call.get("name")
                args = call.get("args") or {}
                impl = TOOL_IMPL.get(name)
                if impl is None:
                    result = {"error": f"unknown tool {name}"}
                else:
                    try:
                        result = await impl(user, args)
                    except Exception as exc:  # keep the chat alive on tool bugs
                        logger.exception("[assistant] tool %s failed", name)
                        result = {"error": f"tool failed: {exc}"}
                tools_used.append(name)
                responses.append({"functionResponse": {"name": name, "response": result}})
            body["contents"].append({"role": "user", "parts": responses})

    return {"reply": None, "error": "Too many tool rounds — please rephrase"}
