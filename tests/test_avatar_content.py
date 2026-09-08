from __future__ import annotations

import pytest
from pydantic import ValidationError

from animama.app.anima_creation_contract import CreateAnimaRequest, ItemRevisionRef


def test_anima_creation_requires_an_exact_admitted_avatar_revision() -> None:
    schema = CreateAnimaRequest.model_json_schema()
    assert schema["properties"]["avatar"]["$ref"].endswith("/ItemRevisionRef")
    assert "avatar_source" not in schema["properties"]
    reference = ItemRevisionRef(item_id="catalog-avatar", revision_sha256="a" * 64)
    assert reference.item_id == "catalog-avatar"
    with pytest.raises(ValidationError, match="revision_sha256"):
        ItemRevisionRef.model_validate({"item_id": "catalog-avatar"})


@pytest.mark.parametrize(
    "extra",
    [{"file_path": "/host/avatar.vrm"}, {"avatar_id": "another-avatar"}, {"url": "https://example.test/avatar.vrm"}],
)
def test_creation_avatar_reference_rejects_legacy_identity_paths_and_delivery_urls(extra) -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        ItemRevisionRef.model_validate({"item_id": "catalog-avatar", "revision_sha256": "a" * 64, **extra})
