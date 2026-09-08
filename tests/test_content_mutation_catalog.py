"""Observable transaction and durable replay guarantees for Local mutations."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import create_engine, delete, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from alembic import command
from alembic.config import Config
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    ScannedContentEntry,
    ScannedContentFile,
)
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.content_mutation import ORMContentMutationReceipt


@dataclass
class _Scenario:
    owner: str
    writer: AsyncSession
    catalog: SQLAlchemyContentCatalog
    observer: SQLAlchemyContentCatalog

    async def reconcile(self, *, shared: bool = False) -> str:
        """Admit one actual catalog projection without mocking persistence."""

        locator = f"gestures/{self.owner}.vrma"
        entries = await self.catalog.reconcile_source(
            source=ContentSource.LOCAL,
            entries=[
                ScannedContentEntry(
                    source=ContentSource.LOCAL,
                    kind=ContentKind.GESTURE,
                    relative_locator=locator,
                    display_name="Mutation fixture",
                    status=ContentStatus.VALID,
                    revision_sha256="a" * 64,
                    files=(
                        ScannedContentFile(
                            relative_path=locator,
                            role="primary",
                            media_type="model/gltf-binary",
                            size_bytes=16,
                            sha256="b" * 64,
                        ),
                    ),
                )
            ],
            new_item_scope=ContentScope.INSTALLATION_SHARED if shared else ContentScope.OWNER,
            new_item_owner_user_id=None if shared else self.owner,
        )
        return next(item.id for item in entries if item.relative_locator == locator)


@pytest_asyncio.fixture
async def scenario(async_session_factory):  # noqa: ANN001, ANN201
    async with async_session_factory() as writer, async_session_factory() as reader:
        owner = f"mutation-{uuid4().hex}"
        value = _Scenario(owner, writer, SQLAlchemyContentCatalog(writer), SQLAlchemyContentCatalog(reader))
        try:
            yield value
        finally:
            await writer.rollback()
            await reader.rollback()
            await writer.execute(
                delete(ORMContentCatalogItem).where(ORMContentCatalogItem.relative_locator == f"gestures/{owner}.vrma")
            )
            await writer.execute(
                delete(ORMContentMutationReceipt).where(
                    ORMContentMutationReceipt.owner_user_id.in_([owner, owner + "-other"])
                )
            )
            await writer.commit()


async def test_mutation_hides_catalog_owner_provenance_and_receipt_until_commit(scenario: _Scenario) -> None:
    # Preflight reads autobegin a transaction; the mutation must adopt it.
    assert await scenario.catalog.get_mutation_receipt(user_id=scenario.owner, operation_id="save") is None
    async with scenario.catalog.mutation_transaction():
        item_id = await scenario.reconcile(shared=True)
        # Another adapter on this session must not bypass the transaction owner.
        peer = SQLAlchemyContentCatalog(scenario.writer)
        await peer.assign_creator_owner(item_id=item_id, user_id=scenario.owner)
        await peer.record_import_provenance(item_id=item_id, user_id=scenario.owner, provenance={"license": "fixture"})
        await peer.record_mutation_receipt(
            user_id=scenario.owner,
            operation_id="save",
            request_digest="c" * 64,
            result={"item_id": item_id, "name": "Original success"},
        )
        assert await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner) is None
        assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="save") is None

    item = await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner)
    assert item is not None
    assert item.owner_user_id == scenario.owner
    assert item.provenance == {"license": "fixture"}
    assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="save") == {
        "request_digest": "c" * 64,
        "result": {"item_id": item_id, "name": "Original success"},
    }


@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
async def test_failure_or_cancellation_rolls_back_catalog_and_receipt(scenario: _Scenario, failure) -> None:  # noqa: ANN001
    with pytest.raises(failure):
        async with scenario.catalog.mutation_transaction():
            item_id = await scenario.reconcile()
            await scenario.catalog.record_mutation_receipt(
                user_id=scenario.owner, operation_id="failed", request_digest="d" * 64, result={"item_id": item_id}
            )
            raise failure("interrupted mutation")

    assert await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner) is None
    assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="failed") is None
    # A rolled-back operation id remains available for a later successful retry.
    async with scenario.catalog.mutation_transaction():
        await scenario.catalog.record_mutation_receipt(
            user_id=scenario.owner, operation_id="failed", request_digest="e" * 64, result={"retried": True}
        )
    assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="failed") == {
        "request_digest": "e" * 64,
        "result": {"retried": True},
    }


async def test_original_receipt_survives_deletion_and_cannot_be_rewritten(scenario: _Scenario) -> None:
    async with scenario.catalog.mutation_transaction():
        item_id = await scenario.reconcile()
        await scenario.catalog.record_mutation_receipt(
            user_id=scenario.owner, operation_id="save", request_digest="a" * 64, result={"item_id": item_id}
        )
    async with scenario.catalog.mutation_transaction():
        await scenario.catalog.purge_item(item_id=item_id)
        assert await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner) is not None
        await scenario.catalog.record_mutation_receipt(
            user_id=scenario.owner, operation_id="save", request_digest="a" * 64, result={"item_id": "replacement"}
        )
    assert await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner) is None
    expected = {"request_digest": "a" * 64, "result": {"item_id": item_id}}
    receipt = await scenario.catalog.get_mutation_receipt(user_id=scenario.owner, operation_id="save")
    assert receipt == expected
    receipt["result"]["item_id"] = "local mutation"
    assert await scenario.catalog.get_mutation_receipt(user_id=scenario.owner, operation_id="save") == expected

    with pytest.raises(ContentConflictError, match="operation_id_reused"):
        async with scenario.catalog.mutation_transaction():
            await scenario.catalog.record_mutation_receipt(
                user_id=scenario.owner, operation_id="save", request_digest="f" * 64, result={}
            )
    assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="save") == expected
    async with scenario.catalog.mutation_transaction():
        await scenario.catalog.record_mutation_receipt(
            user_id=scenario.owner + "-other", operation_id="save", request_digest="f" * 64, result={"other": True}
        )
    assert await scenario.observer.get_mutation_receipt(user_id=scenario.owner, operation_id="save") == expected


async def test_mutation_holds_source_fence_across_reconciliation(scenario: _Scenario) -> None:
    admitted = asyncio.Event()

    async def competing_mutation() -> None:
        async with scenario.observer.mutation_transaction():
            admitted.set()

    task = None
    try:
        async with scenario.catalog.mutation_transaction():
            await scenario.reconcile()
            task = asyncio.create_task(competing_mutation())
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(admitted.wait(), timeout=0.1)
        await asyncio.wait_for(task, timeout=5)
        assert admitted.is_set()
    finally:
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def test_caught_nested_failure_aborts_the_outer_mutation(scenario: _Scenario) -> None:
    with pytest.raises(RuntimeError, match="nested content mutation failed"):
        async with scenario.catalog.mutation_transaction():
            item_id = await scenario.reconcile()
            try:
                async with SQLAlchemyContentCatalog(scenario.writer).mutation_transaction():
                    raise ValueError("nested mutation failed")
            except ValueError:
                pass
    assert await scenario.observer.get_visible_item(item_id=item_id, user_id=scenario.owner) is None


def test_fresh_baseline_receipt_has_no_item_foreign_key_and_survives_repeated_upgrade(
    db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Receipt replay remains available even when its catalog item no longer exists."""

    base_url = make_url(db_url.replace("+asyncpg", "+psycopg"))
    schema = f"content_mutation_migration_{uuid4().hex}"
    admin = create_engine(base_url)
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    migration_url = base_url.update_query_dict({"options": f"-csearch_path={schema},public"})
    monkeypatch.setenv("ANIMAMA_DATABASE_URL", migration_url.render_as_string(hide_password=False))
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    engine = create_engine(migration_url)
    try:
        command.upgrade(config, "head")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO anima (id, user_id, display_name) "
                    "VALUES ('mutation-existing', 'owner', 'Existing Anima')"
                )
            )
        inspector = inspect(engine)
        assert inspector.get_foreign_keys("content_mutation_receipts", schema=schema) == []
        assert inspector.get_pk_constraint("content_mutation_receipts", schema=schema)["constrained_columns"] == [
            "owner_user_id",
            "operation_id",
        ]
        with engine.begin() as connection:
            assert connection.scalar(text("SELECT count(*) FROM anima WHERE id = 'mutation-existing'")) == 1
            connection.execute(
                text(
                    "INSERT INTO content_mutation_receipts (owner_user_id, operation_id, request_digest, result) "
                    "VALUES ('owner', 'save', :digest, :result)"
                ),
                {"digest": "a" * 64, "result": '{"deleted_item_id": "no-item-foreign-key"}'},
            )
        for digest, result in (("invalid", "{}"), ("b" * 64, "[]")):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO content_mutation_receipts (owner_user_id, operation_id, request_digest, result) "
                        "VALUES ('owner', 'invalid', :digest, CAST(:result AS jsonb))"
                    ),
                    {"digest": digest, "result": result},
                )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM anima WHERE id = 'mutation-existing'")) == 1
            assert connection.scalar(text("SELECT result FROM content_mutation_receipts")) == {
                "deleted_item_id": "no-item-foreign-key"
            }
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        admin.dispose()
