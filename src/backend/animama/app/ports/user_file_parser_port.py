"""Parser protocol for account-owned user-file processing."""

from __future__ import annotations

from typing import Protocol

from animama.domain.user_file_processing import ParsedUserFileDocument


class UserFileParseError(Exception):
    """A parse that produced no document.

    ``reason`` is a short English sentence shown to the owner with the file.
    ``error_type`` names the failure for logs (an exception class or a limit),
    never the file's content.
    """

    def __init__(self, reason: str, *, error_type: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.error_type = error_type


class UserFileParseRejectedError(UserFileParseError):
    """The upload's content cannot be read, so retrying cannot help.

    Examples are an unsupported or malformed format and an exceeded parse limit.
    """


class UserFileParser(Protocol):
    """Parse uploaded file bytes into normalized text plus parser metadata.

    Content the parser cannot read raises :class:`UserFileParseRejectedError`;
    any other exception, including another :class:`UserFileParseError`, is
    treated as transient and the job is retried.
    """

    async def parse(
        self,
        *,
        payload: bytes,
        filename: str,
        extension: str,
    ) -> ParsedUserFileDocument:
        raise NotImplementedError


__all__ = ["UserFileParseError", "UserFileParseRejectedError", "UserFileParser"]
