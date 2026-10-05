"""Owner binding is an admission boundary, independent of byte storage layout."""

from types import SimpleNamespace
from typing import cast

import pytest

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.domain.content_catalog import ContentNotFoundError


class OwnerCatalog:
    def __init__(self, owner_id: str) -> None:
        self.owner_id = owner_id
        self.reads: list[str] = []

    async def list_visible(self, *, user_id: str) -> list[object]:
        self.reads.append(user_id)
        return []


async def test_bound_catalog_rejects_another_owner_before_calling_any_adapter() -> None:
    catalog = OwnerCatalog("alice")
    store = SimpleNamespace(owner_id="alice")
    content = ContentCatalogService(
        store=store,
        catalog=cast(ContentCatalog, catalog),
        mutations=SimpleNamespace(store=store, catalog=catalog),
        publication=SimpleNamespace(owner_id="alice"),
    )
    with pytest.raises(ContentNotFoundError):
        await content.list_visible(user_id="bob")
    assert catalog.reads == []


def test_differently_bound_catalog_and_store_cannot_be_composed() -> None:
    with pytest.raises(ValueError, match="owner"):
        ContentCatalogService(
            store=SimpleNamespace(owner_id="bob"), catalog=cast(ContentCatalog, OwnerCatalog("alice"))
        )


def test_account_composition_cannot_silently_fall_back_to_local_publication() -> None:
    with pytest.raises(ValueError, match="explicit publication"):
        ContentCatalogService(
            store=SimpleNamespace(owner_id="alice"), catalog=cast(ContentCatalog, OwnerCatalog("alice"))
        )


async def test_opaque_memory_consumer_exercises_retained_service_paths() -> None:
    import runpy
    from pathlib import Path

    fixture = Path(__file__).parents[1] / "scripts/repository-boundary/consumers/content.py"
    namespace = runpy.run_path(str(fixture))
    await namespace["exercise"]()
