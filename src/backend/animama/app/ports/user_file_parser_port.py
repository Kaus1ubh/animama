"""Parser protocol for account-owned user-file processing."""

from __future__ import annotations

from typing import Protocol

from animama.domain.user_file_processing import ParsedUserFileDocument


class UserFileParser(Protocol):
    """Parse uploaded file bytes into normalized text plus parser metadata."""

    async def parse(
        self,
        *,
        payload: bytes,
        filename: str,
        extension: str,
    ) -> ParsedUserFileDocument:
        raise NotImplementedError


__all__ = ["UserFileParser"]
