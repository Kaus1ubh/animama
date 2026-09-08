"""Bootstrap reads catalog state only after real file-journal recovery."""

from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.owner_bootstrap_service import OwnerBootstrapResult
from animama.domain.content_catalog import ContentKind, ContentScope, ContentSource
from animama.local.installation_model import ORMInstallationSettings
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.content_mutation import ORMContentMutationReceipt
from animama.server import local_installation_bootstrap
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from tests.content_package_helpers import vrma


@pytest.mark.parametrize(
    ("operation", "committed", "manual_edit"),
    [
        ("save", False, False),
        ("save", True, False),
        ("delete", False, False),
        ("delete", True, False),
        ("save", False, True),
    ],
)
async def test_bootstrap_recovers_before_catalog_admission(
    async_session_factory,  # noqa: ANN001
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    committed: bool,
    manual_edit: bool,
) -> None:
    owner = str(uuid4())
    settings = Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    paths = initialize_local_runtime(settings)
    store = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    original, changed, manual = vrma("original"), vrma("changed"), vrma("manual")
    locator = "gestures/startup.vrma"
    destination = paths.local_root / locator
    observations: list[tuple[bytes | None, tuple[str, ...]]] = []

    class ObservingOwnerDefaults:
        """Use the real catalog at the point starter/default creation would run."""

        async def ensure(self, *, owner_id: str, policy) -> OwnerBootstrapResult:  # noqa: ANN001
            async with async_session_factory() as session:
                items = await SQLAlchemyContentCatalog(session).list_visible(user_id=owner_id)
                digests = tuple(file.sha256 for item in items for file in item.files)
                observations.append((destination.read_bytes() if destination.exists() else None, digests))
            return OwnerBootstrapResult()

    # Keep the actual production bootstrap factory and its real reconciliation
    # callback; only unrelated profile/model/starter creation is substituted.
    monkeypatch.setattr(
        local_installation_bootstrap, "OwnerBootstrapService", lambda **_dependencies: ObservingOwnerDefaults()
    )
    try:
        async with async_session_factory() as session:
            await session.execute(delete(ORMInstallationSettings))
            session.add(ORMInstallationSettings(id=1, installation_principal_id=owner))
            await session.commit()
            store.save_standalone(
                kind=ContentKind.GESTURE,
                relative_locator=locator,
                payload=original,
                operation_id="initial-save",
            )
            catalog = SQLAlchemyContentCatalog(session)
            await ContentCatalogService(store=store, catalog=catalog).rescan(user_id=owner)
            item = await catalog.get_by_locator(source=ContentSource.LOCAL, relative_locator=locator)
            assert item is not None
            # Leave durable file evidence exactly as a process crash would: the
            # next bootstrap gets a fresh store with no in-memory mutation state.
            store.begin_mutation(operation_id="interrupted", user_id=owner, request_digest="a" * 64)
            if operation == "save":
                store.save_standalone(
                    kind=ContentKind.GESTURE,
                    relative_locator=locator,
                    payload=changed,
                    operation_id="interrupted",
                )
            else:
                store.delete_entry(entry=item)
            if committed:
                async with catalog.mutation_transaction():
                    if operation == "delete":
                        await catalog.purge_item(item_id=item.id)
                    else:
                        await catalog.reconcile_source(
                            source=ContentSource.LOCAL,
                            entries=store.scan(ContentSource.LOCAL),
                            new_item_scope=ContentScope.OWNER,
                            new_item_owner_user_id=owner,
                        )
                    await catalog.record_mutation_receipt(
                        user_id=owner,
                        operation_id="interrupted",
                        request_digest="a" * 64,
                        result={"value": {"item_id": item.id}},
                    )
            if manual_edit:
                destination.write_bytes(manual)

        bootstrap = local_installation_bootstrap.create_local_installation_bootstrap_service(
            session_factory=async_session_factory, paths=paths, settings=settings
        )
        state = await bootstrap.ensure()
        assert len(observations) == 1
        if manual_edit:
            assert state.content_ready is False
            assert state.status == "repair_required"
            assert observations[0][0] == manual
            assert hashlib.sha256(manual).hexdigest() not in observations[0][1]
            assert list(paths.operations_root.glob("mutation-*.json"))
            assert any(
                path.read_bytes() == original for path in paths.local_root.glob(".animama-mutations/*/*.original")
            )
        else:
            expected = changed if committed and operation == "save" else None if committed else original
            assert state.content_ready is True
            assert state.status == "ready"
            assert observations[0] == (
                expected,
                (hashlib.sha256(expected).hexdigest(),) if expected is not None else (),
            )
            assert not list(paths.operations_root.glob("mutation-*.json"))
            assert not list(paths.local_root.glob(".animama-mutations/*/*.original"))
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner))
            await session.execute(
                delete(ORMContentMutationReceipt).where(ORMContentMutationReceipt.owner_user_id == owner)
            )
            await session.execute(
                delete(ORMInstallationSettings).where(ORMInstallationSettings.installation_principal_id == owner)
            )
            await session.commit()
