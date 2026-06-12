from sqlalchemy import select

from app.models.models import ZammadEvent


def ticket_payload(**overrides):
    payload = {
        "ticket": {
            "id": 42,
            "number": "880042",
            "title": "Printer is offline",
            "article_count": 2,
            "state": {"name": "open"},
            "owner": {"firstname": "Ada", "lastname": "Lovelace"},
            "customer": {"email": "user@example.com"},
            "group": {"name": "Support"},
            "priority": {"name": "2 normal"},
        },
        "article": {
            "body": "Please check this again",
            "sender": "Customer",
            "preferences": {},
        },
    }
    payload.update(overrides)
    return payload


async def test_webhook_auto_detects_multiple_events(client, db_session):
    payload = ticket_payload(article={
        "body": "Please check this again",
        "sender": "Customer",
        "preferences": {
            "new_status": "escalated",
            "new_owner_id": 7,
        },
    })

    resp = await client.post("/api/tickets/webhook", json=payload)

    assert resp.status_code == 204
    result = await db_session.execute(select(ZammadEvent).order_by(ZammadEvent.id))
    events = result.scalars().all()
    assert [ev.event_type for ev in events] == [
        "comment_added",
        "ticket_status_changed",
        "ticket_assigned",
    ]
    assert events[0].ticket_number == "880042"
    assert events[0].article_body == "Please check this again"


async def test_webhook_accepts_ticket_sync_event(client, db_session):
    resp = await client.post(
        "/api/tickets/webhook?event=ticket_sync",
        json=ticket_payload(article={}),
    )

    assert resp.status_code == 204
    result = await db_session.execute(select(ZammadEvent))
    ev = result.scalar_one()
    assert ev.event_type == "ticket_sync"
    assert ev.ticket_title == "Printer is offline"


async def test_webhook_rejects_unknown_event(client):
    resp = await client.post(
        "/api/tickets/webhook?event=unknown",
        json=ticket_payload(),
    )

    assert resp.status_code == 422
