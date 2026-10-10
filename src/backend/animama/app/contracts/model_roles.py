"""Model and role choices; composition owns the admitted catalog."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PyModelRoleAssignment(BaseModel):
    """The row doing one role's job and how it was chosen.

    ``source`` is ``owner`` (App Settings), ``default`` (operator environment),
    ``inherited`` (the chat role) or ``off``. ``assignment_available`` is False
    when the owner's choice could not be used and the role fell back.
    """

    role: Literal["chat", "utility", "memory_manager", "embeddings"]
    source: Literal["owner", "default", "inherited", "off"]
    model_provider_id: str | None = None
    model_label: str | None = None
    connection_name: str | None = None
    requested_model_provider_id: str | None = None
    assignment_available: bool


class PyEmbeddingRefreshStatus(BaseModel):
    """Whether stored vectors match the embeddings role.

    While ``re_embedding`` or ``retrying``, search uses keyword retrieval;
    ``pending`` counts rows still waiting for a vector.
    """

    state: Literal["off", "current", "re_embedding", "retrying"]
    pending: int = 0
    error_category: str | None = None


class PyModelRoles(BaseModel):
    roles: list[PyModelRoleAssignment]
    embeddings_refresh: PyEmbeddingRefreshStatus


__all__ = ["PyEmbeddingRefreshStatus", "PyModelRoleAssignment", "PyModelRoles"]
