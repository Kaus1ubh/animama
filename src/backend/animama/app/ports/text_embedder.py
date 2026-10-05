"""Text embedding port for uploaded-file and archive search."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from animama.domain.usage import Usage


class TextEmbedder(Protocol):
    """Embeds text with one embedding model.

    ``model_id`` is the catalog row id of that model. It is stored with every
    vector, and searches compare only vectors with the same id.
    """

    @property
    def model_id(self) -> str: ...

    async def embed_texts(self, texts: Iterable[str]) -> list[list[float]]: ...


__all__ = ["TextEmbedder"]


@dataclass(frozen=True, slots=True)
class EmbeddingLimits:
    """Composition-selected input and deadline bounds; one SDK attempt only."""

    max_texts: int
    max_characters: int
    timeout_seconds: float

    def __post_init__(self) -> None:
        if any(type(value) is not int or value <= 0 for value in (self.max_texts, self.max_characters)):
            raise ValueError("Embedding input limits must be positive integers")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("Embedding timeout must be positive and finite")


@dataclass(frozen=True, slots=True)
class EmbeddingResult:
    """Vectors plus measured provider usage; missing usage is not zero."""

    vectors: list[list[float]]
    usage: Usage | None


class UsageReportingTextEmbedder(TextEmbedder, Protocol):
    """Compositions wrap each call with admission, settlement and cancellation."""

    async def embed_texts_with_usage(self, texts: Iterable[str]) -> EmbeddingResult: ...
