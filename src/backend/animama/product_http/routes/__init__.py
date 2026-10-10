"""Shared product routers, in the order every composition mounts them (ADR 0021).

Families move here stage by stage. Until a family moves, the local composition
serves it from ``animama.server.routers``.
"""

from __future__ import annotations

from fastapi import APIRouter

from animama.product_http.routes import chats, loadouts, memory, profile, safety, settings

ROUTERS: tuple[APIRouter, ...] = (
    loadouts.router,
    safety.router,
    chats.router,
    settings.router,
    profile.router,
    memory.router,
)
