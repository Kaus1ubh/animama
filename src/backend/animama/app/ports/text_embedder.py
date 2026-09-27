"""Text embedding port for uploaded-file and archive search."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class TextEmbedder(Protocol):
    """Embeds text with one embedding model.

    ``model_id`` is the catalog row id of that model. It is stored with every
    vector, and searches compare only vectors with the same id.
    """

    @property
    def model_id(self) -> str: ...

    async def embed_texts(self, texts: Iterable[str]) -> list[list[float]]: ...


__all__ = ["TextEmbedder"]
