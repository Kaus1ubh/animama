"""An unchanged content catalog answers 304 before any of its body is built.

Content Health polls the catalog, so its validator comes from row revisions, not from
the body: every change a caller can see changes it, and nothing else does.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import Request, Response
from httpx import AsyncClient
from sqlalchemy import delete, or_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.contracts.content import PyContentCatalog, PyContentItem
from animama.domain.content_catalog import ContentKind, ContentScope, ContentSource
from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.delivery import DeferredJsonBody, encoded_json_response
from animama.product_http.routes import content
from tests.content_package_helpers import reviewed_export, reviewed_import, vrma
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app
from tests.test_product_http_content import save_gesture

CATALOG = "/v1/content/catalog"
GZIP = {"Accept-Encoding": "gzip"}


class RevalidatingPorts(DeferredCommitPorts):
    """Two owners' content, delivered under the local JSON policy that revalidates by ETag."""

    async def json_response(
        self,
        request: Request,
        body: bytes | DeferredJsonBody,
        *,
        encoding: str,
        headers: dict[str, str],
        if_none_match: str | None,
        cacheable: bool,
    ) -> Response:
        return await encoded_json_response(
            body, encoding=encoding, headers=headers, if_none_match=if_none_match, cacheable=cacheable
        )


@asynccontextmanager
async def two_owners(
    session_factory: async_sessionmaker[AsyncSession], root: Path
) -> AsyncIterator[tuple[RevalidatingPorts, TwoOwnerComposition]]:
    """Two fresh owners with their own content trees; their rows are removed afterwards."""

    ports = RevalidatingPorts(session_factory, content_root=root)
    owners = (f"owner-{uuid4().hex[:8]}", f"other-{uuid4().hex[:8]}")
    composition = TwoOwnerComposition(product_app(content.router, ports=ports), root, owners=owners)
    try:
        yield ports, composition
    finally:
        async with session_factory() as session:
            await session.execute(
                delete(ORMContentCatalogItem).where(
                    or_(
                        ORMContentCatalogItem.owner_user_id.in_(owners),
                        ORMContentCatalogItem.relative_locator.like("%catalog-revalidation%"),
                    )
                )
            )
            await session.commit()


async def etag(client: AsyncClient) -> str:
    """The caller's current catalog validator, read as Content Health reads it."""

    response = await client.get(CATALOG, headers=GZIP)
    assert response.status_code == 200
    return response.headers["etag"]


async def write_row(session_factory: async_sessionmaker[AsyncSession], statement: Any) -> None:
    async with session_factory() as session:
        await session.execute(statement)
        await session.commit()


def local_row(*, owner: str | None, scope: ContentScope) -> ORMContentCatalogItem:
    """A Local catalog row written directly, as any writer of the catalog table may write one."""

    item_id = str(uuid4())
    return ORMContentCatalogItem(
        id=item_id,
        source=ContentSource.LOCAL.value,
        scope=scope.value,
        owner_user_id=owner,
        kind=ContentKind.GESTURE.value,
        relative_locator=f"gestures/catalog-revalidation-{item_id}.vrma",
        display_name="Direct row",
        status="valid",
    )


async def add_row(session_factory: async_sessionmaker[AsyncSession], row: ORMContentCatalogItem) -> str:
    async with session_factory() as session:
        session.add(row)
        await session.commit()
    return row.id


def recorder(calls: list[str], name: str, original: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap ``original`` so each call records ``name``."""

    def record(*args: Any, **kwargs: Any) -> Any:
        calls.append(name)
        return original(*args, **kwargs)

    return record


async def test_an_unchanged_catalog_answers_304_without_building_it(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (ports, composition):
        owner = composition.owners[0]
        await save_gesture(ports, owner, "Wave")
        async with composition.client(owner) as client:
            first = await client.get(CATALOG, headers=GZIP)
            assert first.status_code == 200

            built: list[str] = []
            monkeypatch.setattr(
                SQLAlchemyContentCatalog,
                "list_visible",
                recorder(built, "list_visible", SQLAlchemyContentCatalog.list_visible),
            )
            monkeypatch.setattr(
                SQLAlchemyContentCatalog,
                "_load_entries",
                recorder(built, "_load_entries", SQLAlchemyContentCatalog._load_entries),
            )
            monkeypatch.setattr(PyContentItem, "from_domain", recorder(built, "from_domain", PyContentItem.from_domain))
            monkeypatch.setattr(
                PyContentCatalog,
                "model_dump_json",
                recorder(built, "model_dump_json", PyContentCatalog.model_dump_json),
            )
            monkeypatch.setattr(gzip, "compress", recorder(built, "gzip", gzip.compress))

            unchanged = await client.get(CATALOG, headers={**GZIP, "If-None-Match": first.headers["etag"]})
            assert unchanged.status_code == 304
            assert unchanged.content == b""
            assert built == []
            for header in ("etag", "cache-control", "vary", "content-encoding"):
                assert unchanged.headers[header] == first.headers[header]

            # Without the validator the same catalog is built and sent again, under the same ETag.
            again = await client.get(CATALOG, headers=GZIP)
            assert again.status_code == 200
            assert {"list_visible", "model_dump_json", "gzip"} <= set(built)
            assert (again.headers["etag"], again.json()) == (first.headers["etag"], first.json())


async def test_each_representation_has_its_own_validator(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (_ports, composition):
        async with composition.client(composition.owners[0]) as client:
            compressed = await client.get(CATALOG, headers=GZIP)
            identity = await client.get(CATALOG, headers={"Accept-Encoding": "identity"})
            assert identity.headers["etag"] != compressed.headers["etag"]
            assert identity.json() == compressed.json()
            crossed = await client.get(
                CATALOG, headers={"Accept-Encoding": "identity", "If-None-Match": compressed.headers["etag"]}
            )
            assert crossed.status_code == 200


async def test_a_release_that_reshapes_the_catalog_revalidates_no_earlier_copy(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (_ports, composition):
        async with composition.client(composition.owners[0]) as client:
            cached = await etag(client)
            # The same rows, served by a release whose catalog response has another shape.
            monkeypatch.setattr(content, "CATALOG_SHAPE", "another shape")
            reshaped = await client.get(CATALOG, headers={**GZIP, "If-None-Match": cached})
            assert reshaped.status_code == 200
            assert reshaped.headers["etag"] != cached


async def test_the_callers_own_changes_change_the_etag(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (ports, composition):
        owner = composition.owners[0]
        async with composition.client(owner) as client:
            seen = [await etag(client)]

            created = (await save_gesture(ports, owner, "Wave")).item
            seen.append(await etag(client))

            async with ports.session_factory() as session:
                async with ports.content(session, RequestPrincipal(id=owner)) as owned:
                    edited = (
                        await owned.saves.save_standalone(
                            user_id=owner,
                            kind=ContentKind.GESTURE,
                            entry_name="Wave",
                            filename="wave.vrma",
                            payload=vrma("Wave, edited"),
                            metadata_sidecar=json.dumps({"schema_version": 1, "name": "Wave"}).encode(),
                            operation_id=f"edit-{uuid4().hex}",
                            catalog_item_id=created.id,
                            expected_revision=created.revision_sha256,
                        )
                    ).item
                await session.commit()
            assert edited.revision_sha256 is not None and edited.revision_sha256 != created.revision_sha256
            seen.append(await etag(client))

            async with ports.session_factory() as session:
                async with ports.content(session, RequestPrincipal(id=owner)) as owned:
                    exported = await reviewed_export(owned.packages, user_id=owner, root_item_id=edited.id)
                    command = await reviewed_import(
                        owned.packages, user_id=owner, archive_path=exported.path, operation_id=f"import-{uuid4().hex}"
                    )
                    imported = await owned.packages.imports.commit(**command)
                await session.commit()
            assert imported.items
            seen.append(await etag(client))

            async with ports.session_factory() as session:
                async with ports.content(session, RequestPrincipal(id=owner)) as owned:
                    await owned.catalog.delete_item(
                        item_id=edited.id, user_id=owner, expected_revision=edited.revision_sha256
                    )
                await session.commit()
            seen.append(await etag(client))
            # An unchanged catalog keeps its validator.
            seen.append(await etag(client))

        changes, repeated = seen[:-1], seen[-1]
        assert len(set(changes)) == len(changes), seen
        assert repeated == changes[-1]


async def test_shared_rows_and_included_changes_change_the_etag(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (ports, composition):
        owner, other = composition.owners
        async with composition.client(owner) as client:
            seen = [await etag(client)]

            shared = await add_row(async_session_factory, local_row(owner=None, scope=ContentScope.INSTALLATION_SHARED))
            seen.append(await etag(client))
            await write_row(
                async_session_factory,
                update(ORMContentCatalogItem)
                .where(ORMContentCatalogItem.id == shared)
                .values(display_name="Renamed shared row"),
            )
            seen.append(await etag(client))

            # An Included release adds a Gesture; reconciliation publishes it to every owner.
            gestures = composition.roots[owner] / "content" / "included" / "gestures"
            gestures.mkdir(parents=True, exist_ok=True)
            (gestures / "catalog-revalidation.vrma").write_bytes(vrma("Included wave"))
            async with ports.session_factory() as session:
                async with ports.content(session, RequestPrincipal(id=owner)) as owned:
                    await owned.catalog.rescan(user_id=owner, include_included=True)
                await session.commit()
            seen.append(await etag(client))
            async with composition.client(other) as other_client:
                other_before_drift = await etag(other_client)

            # A pack's bytes drift: its entry awaits a rescan.
            async with ports.session_factory() as session:
                async with ports.content(session, RequestPrincipal(id=owner)) as owned:
                    await owned.catalog.mark_scan_required(
                        source=ContentSource.INCLUDED, relative_paths=("gestures/catalog-revalidation.vrma",)
                    )
                await session.commit()
            seen.append(await etag(client))
            async with composition.client(other) as other_client:
                assert await etag(other_client) != other_before_drift

        assert len(set(seen)) == len(seen), seen


async def test_another_owners_changes_leave_the_etag_unchanged(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (_ports, composition):
        owner, other = composition.owners
        async with composition.client(owner) as client, composition.client(other) as other_client:
            unchanged = await etag(client)
            others = [await etag(other_client)]

            row = await add_row(async_session_factory, local_row(owner=other, scope=ContentScope.OWNER))
            others.append(await etag(other_client))
            assert await etag(client) == unchanged

            await write_row(
                async_session_factory,
                update(ORMContentCatalogItem).where(ORMContentCatalogItem.id == row).values(display_name="Renamed"),
            )
            others.append(await etag(other_client))
            assert await etag(client) == unchanged

            await write_row(async_session_factory, delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == row))
            others.append(await etag(other_client))
            assert await etag(client) == unchanged

            # The other owner's catalog did change each time.
            assert all(before != after for before, after in zip(others, others[1:], strict=False)), others


async def test_owners_with_identical_catalogs_never_share_a_validator(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with two_owners(async_session_factory, tmp_path) as (_ports, composition):
        owner, other = composition.owners
        async with composition.client(owner) as client, composition.client(other) as other_client:
            mine = await client.get(CATALOG, headers=GZIP)
            theirs = await other_client.get(CATALOG, headers=GZIP)
            assert mine.json() == theirs.json()
            assert mine.headers["etag"] != theirs.headers["etag"]
            replayed = await other_client.get(CATALOG, headers={**GZIP, "If-None-Match": mine.headers["etag"]})
            assert replayed.status_code == 200
