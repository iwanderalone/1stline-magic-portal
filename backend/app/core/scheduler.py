"""Shared APScheduler instance.

Imported by both main.py (startup/shutdown) and API routes
(e.g. publish endpoint scheduling shift notifications).
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(timezone="UTC")
