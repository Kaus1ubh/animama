"""Shared product routers, in the order every composition mounts them (ADR 0021).

The local composition mounts these among its own routes from
``animama.server.routers``; ``animama.product_http.inventory`` lists which are which.
"""

from __future__ import annotations

from fastapi import APIRouter

from animama.product_http.routes import (
    anima_runtime,
    animas,
    avatars,
    chat_turns,
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
    chat_turns.router,
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
