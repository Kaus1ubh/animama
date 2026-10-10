"""Shared product routers, in the order every composition mounts them (ADR 0021).

Families move here stage by stage. Until a family moves, the local composition
serves it from ``animama.server.routers``.
"""

from __future__ import annotations

from fastapi import APIRouter

from animama.product_http.routes import (
    anima_runtime,
    animas,
    avatars,
    chats,
    content,
    loadouts,
    memory,
    packages,
    profile,
    runtime_capabilities,
    safety,
    settings,
    typed_content,
)

ROUTERS: tuple[APIRouter, ...] = (
    animas.router,
    loadouts.router,
    anima_runtime.router,
    runtime_capabilities.router,
    safety.router,
    avatars.router,
    content.router,
    packages.router,
    typed_content.router,
    chats.router,
    settings.router,
    profile.router,
    memory.router,
)
