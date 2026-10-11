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
    elevenlabs,
    loadouts,
    memory,
    memory_manager,
    model_catalog,
    packages,
    profile,
    runtime_capabilities,
    safety,
    settings,
    typed_content,
    voice_catalogs,
)

ROUTERS: tuple[APIRouter, ...] = (
    animas.router,
    voice_catalogs.router,
    loadouts.router,
    anima_runtime.router,
    model_catalog.router,
    runtime_capabilities.router,
    safety.router,
    avatars.router,
    content.router,
    packages.router,
    typed_content.router,
    chats.router,
    elevenlabs.router,
    settings.router,
    profile.router,
    memory.router,
    memory_manager.router,
)
