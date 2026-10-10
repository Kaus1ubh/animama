"""Shared product routers, in the order every composition mounts them (ADR 0021).

Families move here stage by stage. Until a family moves, the local composition
serves it from ``animama.server.routers``.
"""

from __future__ import annotations

from fastapi import APIRouter

ROUTERS: tuple[APIRouter, ...] = ()
