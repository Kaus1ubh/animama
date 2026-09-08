from __future__ import annotations

import os
from collections.abc import Iterable


class Embedder:
    """OpenAI embeddings wrapper. Swappable for testing."""

    def __init__(self, model: str = os.getenv("ANIMAMA_EMBEDDING_MODEL", "text-embedding-3-small")) -> None:
        # Load `.env` only for local development (see `animama.server.app`).
        running_in_ecs = bool(
            os.getenv("ECS_CONTAINER_METADATA_URI_V4")
            or os.getenv("ECS_CONTAINER_METADATA_URI")
            or (os.getenv("AWS_EXECUTION_ENV") or "").startswith("AWS_ECS")
        )
        if not running_in_ecs:
            try:
                from dotenv import load_dotenv

                load_dotenv()
            except Exception:
                pass

        from openai import AsyncOpenAI

        api_key = os.getenv("OPENAI_API_KEY")
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def embed_texts(self, texts: Iterable[str]) -> list[list[float]]:
        payload = list(texts)
        if not payload:
            return []
        res = await self._client.embeddings.create(model=self._model, input=payload)
        # Preserve original order
        return [d.embedding for d in sorted(res.data, key=lambda d: d.index)]
