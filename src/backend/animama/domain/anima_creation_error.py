"""Safe, bounded diagnostics shared by private creation and starter operations."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class AnimaCreationIssue:
    code: str
    message: str
    path: str
    item_id: str | None = None
    declaring_action_item_id: str | None = None
    expected_revision_sha256: str | None = None
    current_revision_sha256: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value is not None}


def bounded_issues(issues: list[AnimaCreationIssue]) -> list[dict[str, Any]]:
    """Bound errors and receipt warnings without including request bodies."""

    values = (
        issues
        if len(issues) <= 100
        else [
            *issues[:99],
            AnimaCreationIssue("additional_issues_omitted", "Additional issues were omitted.", ""),
        ]
    )
    return [value.as_dict() for value in values]


class AnimaCreationError(Exception):
    """HTTP-independent failure; never carries host paths or raw submitted bodies."""

    def __init__(
        self,
        code: str = "anima_creation_invalid",
        *,
        message: str = "The Anima definition is invalid.",
        status: int = 422,
        retryable: bool = False,
        issues: list[AnimaCreationIssue] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = {"code": code, "message": message, "retryable": retryable, "issues": bounded_issues(issues or [])}
