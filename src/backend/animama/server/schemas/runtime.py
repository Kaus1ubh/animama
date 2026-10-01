"""Bounded local runtime-context and first-run schemas."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .base import Base
from .user_profile import DisplayName


class PyRuntimeContext(Base):
    schema_version: Literal[1] = 1
    principal_id: str
    bootstrap_status: Literal["ready", "repair_required"]
    failed_steps: list[Literal["local_profile", "user_settings", "profile_memory", "starter_animas"]]
    first_run_complete: bool
    display_name: str | None


class PyOnboardingCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: DisplayName
    adult_confirmed: bool = Field(description="The owner confirms they are 18 or older; first run requires true.")
    # Surrounding whitespace is stripped first, so a blank value is refused.
    chat_model_provider_id: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)] | None
    ) = Field(
        default=None,
        description=(
            "Optional catalog row chosen in setup. It becomes the default Chat model, and starter Animas "
            "still on the model they were created with move to it. Omit to keep the system default."
        ),
    )


__all__ = ["PyOnboardingCompleteRequest", "PyRuntimeContext"]
