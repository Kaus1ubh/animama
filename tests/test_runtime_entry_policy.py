from __future__ import annotations

from io import BytesIO

import pytest

import animama.app.services.runtime_content_closure as closure_module
from animama.app.services.runtime_content_closure import RuntimeContentClosureCompiler
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)
from animama.domain.runtime_content_descriptor import RuntimeContentRootSelection


@pytest.mark.asyncio
async def test_budget_failure_omits_later_optional_root(monkeypatch) -> None:
    monkeypatch.setattr(closure_module, "MAX_RUNTIME_BYTES", 4)
    entries = []
    for index in range(2):
        item_id = f"00000000-0000-4000-8000-{index + 1:012d}"
        file = CatalogContentFile(
            file_ref=f"catalog-{index}",
            item_id=item_id,
            source=ContentSource.LOCAL,
            relative_path=f"gestures/{index}.vrma",
            role="primary",
            media_type="model/gltf-binary",
            size_bytes=4,
            sha256=str(index + 1) * 64,
        )
        entries.append(
            CatalogContentEntry(
                id=item_id,
                source=ContentSource.LOCAL,
                scope=ContentScope.OWNER,
                owner_user_id="owner",
                kind=ContentKind.GESTURE,
                relative_locator=file.relative_path,
                display_name=item_id,
                status=ContentStatus.VALID,
                revision_sha256=str(index + 3) * 64,
                files=(file,),
            )
        )

    class Catalog:
        async def list_visible(self, *, user_id):
            return entries

        async def mark_scan_required(self, **kwargs):
            raise AssertionError(kwargs)

    class Store:
        def open_verified_file(self, **facts):
            return VerifiedContentFile(
                BytesIO(b"data"),
                facts["expected_size_bytes"],
                facts["expected_sha256"],
                facts["media_type"],
            )

    descriptor = await RuntimeContentClosureCompiler(
        catalog=Catalog(),  # type: ignore[arg-type]
        store=Store(),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=tuple(
            RuntimeContentRootSelection(f"gesture:{index}", entry.id, entry.kind) for index, entry in enumerate(entries)
        ),
    )

    assert [root.slot_key for root in descriptor.roots] == ["gesture:0"]
    assert descriptor.diagnostics[0].code == "runtime_byte_budget"
