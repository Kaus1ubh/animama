from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from animama.adapters.mappers.model_provider_map import (
    model_provider_domain_to_public_catalog_row,
    model_provider_registry_row_to_domain,
)
from animama.app.model_catalog import serialize_model_provider_catalog
from animama.app.model_provider_native_tools import requestable_native_tool_support
from animama.domain import ModelProvider
from animama.logging import get_logger

from ..ports import ModelProviderRepository, UnitOfWork


class ModelProviderCatalogService:
    """Synchronize and expose durable provider/model catalog rows."""

    def __init__(self, *, model_providers: ModelProviderRepository, uow: UnitOfWork | None = None) -> None:
        self._model_providers = model_providers
        self._uow = uow
        self._log = get_logger("app.services.model_provider_catalog")

    async def sync_from_registry(
        self,
        rows: Iterable[Mapping[str, Any]] | None = None,
    ) -> list[ModelProvider]:
        """Upsert registry rows and soft-retire active rows missing from the registry."""

        registry_rows = list(rows if rows is not None else serialize_model_provider_catalog())
        domain_rows = [model_provider_registry_row_to_domain(row) for row in registry_rows]
        stored = await self._model_providers.upsert_many(domain_rows)
        retired = await self._model_providers.soft_retire_missing(model_provider.id for model_provider in domain_rows)
        if self._uow is not None:
            await self._uow.commit()
        self._log.info("Model provider catalog synced", row_count=len(stored), retired_count=retired)
        return stored

    async def list_public_catalog(self) -> list[dict[str, Any]]:
        """Return active catalog rows in the public `/v1/model-providers` shape."""

        rows = sorted(
            await self._model_providers.list_active(),
            key=lambda row: (str(row.provider_label), str(row.model_label), str(row.id)),
        )
        public_rows: list[dict[str, Any]] = []
        for model_provider in rows:
            row = model_provider_domain_to_public_catalog_row(model_provider)
            if model_provider.capabilities.native_tool_support is not None:
                row["requestable_native_tool_support"] = requestable_native_tool_support(
                    model_provider.provider_type,
                    model_provider.capabilities.native_tool_support,
                )
            public_rows.append(row)
        return public_rows


__all__ = ["ModelProviderCatalogService"]
