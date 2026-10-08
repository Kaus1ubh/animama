"""SQL runtime projections remain untrusted until exact owner/pin authorization."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.anima_runtime_service import (
    AnimaRuntimeService,
    RuntimeFileAuthorization,
    RuntimeSnapshotError,
)
from animama.domain.content_catalog import ContentSource


@pytest.mark.asyncio
async def test_runtime_authorizes_owned_and_included_files_but_rejects_foreign_join_rows() -> None:
    """Equal locators and digests never grant another owner's registered bytes."""
    rows = [
        (
            datetime.now(UTC) + timedelta(hours=1),
            "item-revision",
            item_id,
            "appearances/same.png",
            "image",
            "image/png",
            4,
            "a" * 64,
            source,
            scope,
            owner,
            "valid",
            "item-revision",
            None,
            file_ref,
        )
        for item_id, source, scope, owner, file_ref in (
            ("owned", "local", "owner", "owner-a", "own-file"),
            ("foreign", "local", "owner", "owner-b", "foreign-file"),
            ("included", "included", "included", None, "included-file"),
        )
    ]
    # Deliberately return a foreign row too: SQL row security is the composition's
    # separate gate, while this public service must still refuse foreign bytes.
    session = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda: rows)))
    service = AnimaRuntimeService(cast(AsyncSession, session))
    result = await service.authorize_files(
        user_id="owner-a",
        anima_id="owned-anima",
        revision="runtime-revision",
        file_refs=["own-file", "foreign-file", "included-file"],
    )
    own, included, foreign = result["own-file"], result["included-file"], result["foreign-file"]
    assert isinstance(own, RuntimeFileAuthorization) and own.item_id == "owned"
    assert isinstance(included, RuntimeFileAuthorization) and included.source is ContentSource.INCLUDED
    assert isinstance(foreign, RuntimeSnapshotError) and foreign.code == "runtime_file_not_found"
    assert own.relative_path == included.relative_path == "appearances/same.png"
