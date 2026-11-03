"""Save checks a Gesture's or Reaction's per-use effect overrides against the named effect."""

from __future__ import annotations

import json
import shutil
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete

from animama.app.services.content_kind_registry import handler_for_kind
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.domain.content_documents import ContentDocumentError, ReactionDocumentV1
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services

OWNER = "effect-override-owner"
REPOSITORY = Path(__file__).parents[1]
EFFECT = "builtin:avatar-effect:kira_star"
EFFECT_FOLDER = "vfx/avatar/kira_star"


@pytest.fixture(autouse=True)
async def _cleanup(async_session):
    yield
    await async_session.rollback()
    await async_session.execute(
        delete(ORMContentCatalogItem).where(
            (ORMContentCatalogItem.owner_user_id == OWNER) | (ORMContentCatalogItem.logical_key == EFFECT)
        )
    )
    await async_session.commit()


def _reaction(override: dict[str, Any]) -> tuple[bytes, dict[str, tuple[BytesIO, int]]]:
    clip = json.loads((REPOSITORY / "content/included/reactions/anger-2/anger-2.json").read_text())
    clip["id"] = "cheer"
    clip["events"] = [{"id": "star", "time": 0.1, "kind": "avatar_vfx", "effectId": "star", "override": override}]
    descriptor = {
        "schema_version": 1,
        "content_type": "reaction",
        "content_id": "local:reaction:cheer",
        "name": "Cheer",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "dependencies": [{"ref": EFFECT, "alias": "star", "content_type": "avatar_effect", "config": {}}],
        "files": [{"path": "cheer.json", "role": "sequence"}],
    }
    body = json.dumps(clip).encode()
    return json.dumps(descriptor).encode(), {"cheer.json": (BytesIO(body), len(body))}


async def _saves(async_session, tmp_path: Path):
    paths, _, content, saves, _ = package_services(async_session, tmp_path)
    inventory = paths.included_root / "licenses/inventory.json"
    inventory.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(REPOSITORY / "content/included/licenses/inventory.json", inventory)
    shutil.copytree(REPOSITORY / "content/included" / EFFECT_FOLDER, paths.included_root / EFFECT_FOLDER)
    await content.rescan(user_id=OWNER)
    return saves


async def _save(saves, override: dict[str, Any], operation: str):
    descriptor, files = _reaction(override)
    return await saves.save_descriptor_streams(
        user_id=OWNER,
        kind=ContentKind.REACTION,
        entry_name="Cheer",
        descriptor=descriptor,
        companion_files=files,
        operation_id=operation,
        catalog_item_id=None,
        expected_revision=None,
    )


async def test_save_admits_an_override_that_keeps_the_effect_valid(async_session, tmp_path: Path) -> None:
    saves = await _saves(async_session, tmp_path)
    saved = await _save(saves, {"attachment": {"kind": "body", "bone": "leftHand", "size": 0.08}}, "save-valid")
    assert saved.item.kind is ContentKind.REACTION


async def test_save_refuses_an_override_that_changes_the_attachment_kind(async_session, tmp_path: Path) -> None:
    saves = await _saves(async_session, tmp_path)
    with pytest.raises(ContentDocumentError) as error:
        await _save(saves, {"attachment": {"kind": "sticker"}}, "save-kind")
    assert error.value.code == "action_effect_override_invalid"
    assert error.value.field == "event.star.override.attachment.kind"


async def test_save_refuses_a_malformed_override(async_session, tmp_path: Path) -> None:
    saves = await _saves(async_session, tmp_path)
    with pytest.raises(ContentDocumentError) as error:
        await _save(saves, {"appearance": {"opacity": 2}}, "save-shape")
    assert error.value.field == "event.star.override.appearance.opacity"


async def test_save_names_a_missing_effect_rather_than_its_override(
    async_session,
    tmp_path: Path,
) -> None:
    # The override can't be checked against an effect that isn't installed;
    # Save refuses the missing dependency itself.
    _, _, content, saves, _ = package_services(async_session, tmp_path)
    await content.rescan(user_id=OWNER)
    with pytest.raises(ContentConflictError) as error:
        await _save(saves, {"attachment": {"kind": "sticker"}}, "save-missing")
    assert error.value.code == "saved_content_invalid"
    assert error.value.field == "dependencies"


async def test_save_ignores_a_clip_too_deeply_nested_to_parse(async_session, tmp_path: Path) -> None:
    saves = await _saves(async_session, tmp_path)
    descriptor, _ = _reaction({"soundAlias": "tehe"})
    document = (
        handler_for_kind(ContentKind.REACTION)
        .parse_document(json.loads(descriptor), fallback_path=Path("Cheer"), descriptor_backed=True)
        .document
    )
    assert isinstance(document, ReactionDocumentV1)
    body = b"[" * 200_000
    stream = BytesIO(body)
    # Not JSON this check can read: other admission reports it, and the stream is left as found.
    await saves._check_effect_overrides(
        user_id=OWNER, document=document, companion_files={"cheer.json": (stream, len(body))}
    )
    assert stream.tell() == 0
