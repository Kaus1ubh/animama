"""Age-status seam (spec R6).

Animama is for adults. The local composition records a self-attestation at first
run; a future hosted or OS age signal (for example CA AB 1043) can supply the
same status through another ``AgeStatusProvider``. There is no minor mode: any
status other than ``adult`` keeps first run incomplete.
"""

from __future__ import annotations

from typing import Literal, Protocol

AgeStatus = Literal["unknown", "adult", "minor"]
AgeStatusSource = Literal["self_attestation"]


class AgeStatusProvider(Protocol):
    async def get_age_status(self, user_id: str) -> AgeStatus:
        """Return the owner's current age status, ``unknown`` when never recorded."""
        ...


__all__ = ["AgeStatus", "AgeStatusProvider", "AgeStatusSource"]
