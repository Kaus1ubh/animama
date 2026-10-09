from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from animama.adapters.mappers.model_provider_map import (
    model_provider_domain_to_public_catalog_row,
    model_provider_registry_row_to_domain,
)
from animama.app.model_catalog import serialize_model_provider_catalog
from animama.app.model_provider_native_tools import requestable_native_tool_support
from animama.domain import ModelProvider
from animama.domain.model_connection import BUILTIN_CONNECTION_IDS, BUILTIN_OPENAI_CONNECTION_ID, MODEL_SOURCE_OWNER
from animama.logging import get_logger

from ..ports import ModelProviderRepository, UnitOfWork


@dataclass(frozen=True, slots=True)
class ModelCatalogPolicy:
    """Which catalog rows a composition exposes.

    The local composition (:meth:`local`) enables owner-added models and the
    built-in rows of every built-in connection. Any other composition keeps the
    default: built-in rows of the OpenAI connection only, optionally restricted
    further with ``builtin_allowlist``. An allowlist names exact rows, so it can
    also admit rows of another built-in connection.
    """

    owner_models_enabled: bool = False
    builtin_allowlist: frozenset[str] | None = None
    builtin_connection_ids: frozenset[str] = frozenset({BUILTIN_OPENAI_CONNECTION_ID})

    @classmethod
    def local(cls) -> ModelCatalogPolicy:
        """The local installation's policy: owner models and every built-in connection."""

        return cls(owner_models_enabled=True, builtin_connection_ids=BUILTIN_CONNECTION_IDS)

    def allows(self, model_provider: ModelProvider) -> bool:
        if model_provider.source == MODEL_SOURCE_OWNER:
            return self.owner_models_enabled
        if self.builtin_allowlist is not None:
            return model_provider.id in self.builtin_allowlist
        return model_provider.connection_id in self.builtin_connection_ids


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

    async def list_public_catalog(self, policy: ModelCatalogPolicy | None = None) -> list[dict[str, Any]]:
        """Return active catalog rows allowed by ``policy`` in the public shape.

        Rows whose connection has been removed are excluded.
        """

        policy = policy or ModelCatalogPolicy()
        rows = [
            row
            for row in await self._model_providers.list_active()
            if policy.allows(row) and (row.connection is None or row.connection.active)
        ]
        public_rows: list[dict[str, Any]] = []
        for model_provider in rows:
            row = model_provider_domain_to_public_catalog_row(model_provider)
            if model_provider.capabilities.native_tool_support is not None:
                row["requestable_native_tool_support"] = requestable_native_tool_support(
                    model_provider.provider_type,
                    model_provider.capabilities.native_tool_support,
                )
            public_rows.append(row)
        # Sort by the displayed labels: owner rows take their connection's current name.
        return sorted(
            public_rows,
            key=lambda row: (str(row["provider_label"]), str(row["model_label"]), str(row["id"])),
        )


__all__ = ["ModelCatalogPolicy", "ModelProviderCatalogService"]
