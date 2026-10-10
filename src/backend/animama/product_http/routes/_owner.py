"""Owner checks shared by the product routers (ADR 0021)."""

from __future__ import annotations

from fastapi import HTTPException, status

from animama.app.ports.anima_port import AnimaRepository


async def require_owned_anima(animas: AnimaRepository, *, anima_id: str, user_id: str) -> None:
    """Report an Anima the caller does not own, including an unowned one, as not found."""

    if not await animas.is_owned_by_user(user_id=user_id, anima_id=anima_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
