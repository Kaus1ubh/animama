from __future__ import annotations

import hashlib
import uuid
from io import BytesIO

import pytest

from animama.app.services.runtime_content_closure import RuntimeContentClosureCompiler
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentIntegrityError,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)
from animama.domain.runtime_content_descriptor import RuntimeContentRootSelection


def _id(value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://animama.test/runtime/{value}"))


def _file(item_id: str, name: str, digest: str, size: int = 4) -> CatalogContentFile:
    return CatalogContentFile(
        file_ref=f"catalog-{name}",
        item_id=_id(item_id),
        source=ContentSource.LOCAL,
        relative_path=f"gestures/{name}",
        role="primary",
        media_type="application/octet-stream",
        size_bytes=size,
        sha256=digest,
    )


def _entry(
    item_id: str,
    *,
    kind: ContentKind = ContentKind.GESTURE,
    files: tuple[CatalogContentFile, ...] = (),
    dependencies: tuple[str, ...] = (),
    status: ContentStatus = ContentStatus.VALID,
) -> CatalogContentEntry:
    return CatalogContentEntry(
        id=_id(item_id),
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="owner",
        kind=kind,
        relative_locator=f"gestures/{item_id}",
        display_name=item_id,
        status=status,
        revision_sha256=hashlib.sha256(item_id.encode()).hexdigest() if status is ContentStatus.VALID else None,
        files=files,
        dependency_item_ids=dependencies,
    )


class _Catalog:
    def __init__(self, entries: list[CatalogContentEntry]) -> None:
        self.entries = entries
        self.invalidations: list[tuple[ContentSource, tuple[str, ...]]] = []

    async def list_visible(self, *, user_id: str):  # noqa: ANN202
        assert user_id == "owner"
        return self.entries

    async def mark_scan_required(self, *, source, relative_paths):  # noqa: ANN001, ANN202
        self.invalidations.append((source, relative_paths))


class _Store:
    def __init__(self, changed_paths: set[str] | None = None) -> None:
        self.changed_paths = changed_paths or set()

    def open_verified_file(self, **facts):  # noqa: ANN003, ANN202
        if facts["relative_path"] in self.changed_paths:
            raise ContentIntegrityError("changed")
        return VerifiedContentFile(
            BytesIO(b"data"),
            facts["expected_size_bytes"],
            facts["expected_sha256"],
            facts["media_type"],
        )


@pytest.mark.asyncio
async def test_closure_flattens_dependencies_and_deduplicates_members() -> None:
    shared_file = _file("support", "sparkle.bin", "a" * 64)
    root_file = _file("gesture", "wave.bin", "b" * 64)
    support = _entry(
        "support",
        kind=ContentKind.PARTICLE_EFFECT,
        files=(shared_file,),
    )
    gesture = _entry("gesture", files=(root_file,), dependencies=(support.id,))
    catalog = _Catalog([gesture, support])
    descriptor = await RuntimeContentClosureCompiler(
        catalog=catalog,  # type: ignore[arg-type]
        store=_Store(),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=3,
        selections=(
            RuntimeContentRootSelection("gesture:wave", gesture.id, gesture.kind),
            RuntimeContentRootSelection("effect:sparkle", support.id, support.kind),
        ),
    )

    assert [root.slot_key for root in descriptor.roots] == ["gesture:wave", "effect:sparkle"]
    assert len(descriptor.entries) == 2
    assert len(descriptor.members) == 2
    assert {member.file_ref for member in descriptor.members} == {
        root_file.file_ref,
        shared_file.file_ref,
    }
    assert descriptor.admitted_item_revisions == dict(
        sorted(
            {
                gesture.id: gesture.revision_sha256,
                support.id: support.revision_sha256,
            }.items()
        )
    )
    assert descriptor.roots[0].entry_ids == (support.id, gesture.id)
    assert descriptor.diagnostics == ()


@pytest.mark.asyncio
async def test_changed_dependency_omits_only_affected_roots_and_requests_rescan() -> None:
    bad_file = _file("bad", "bad.bin", "a" * 64)
    good_file = _file("good", "good.bin", "b" * 64)
    dependency = _entry("bad", kind=ContentKind.PARTICLE_EFFECT, files=(bad_file,))
    affected = _entry("affected", dependencies=(dependency.id,))
    good = _entry("good", files=(good_file,))
    catalog = _Catalog([dependency, affected, good])
    descriptor = await RuntimeContentClosureCompiler(
        catalog=catalog,  # type: ignore[arg-type]
        store=_Store({bad_file.relative_path}),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=(
            RuntimeContentRootSelection("gesture:affected", affected.id, affected.kind),
            RuntimeContentRootSelection("gesture:good", good.id, good.kind),
        ),
    )

    assert [root.slot_key for root in descriptor.roots] == ["gesture:good"]
    assert [item.code for item in descriptor.diagnostics] == ["runtime_source_changed"]
    assert catalog.invalidations == [(ContentSource.LOCAL, (bad_file.relative_path,))]
