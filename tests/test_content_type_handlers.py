from __future__ import annotations

import json
from pathlib import Path

import pytest

from animama.app.services.content_kind_registry import (
    CONTENT_TYPE_HANDLERS,
    RuntimeProjectionInput,
    definition_for_kind,
    descriptor_filename,
    handler_for_kind,
)
from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1, ReactionDocumentV1


def test_handler_registry_is_exhaustive_and_reserves_anima() -> None:
    assert {handler.kind for handler in CONTENT_TYPE_HANDLERS.handlers} == set(ContentKind)
    assert len(CONTENT_TYPE_HANDLERS.handlers) == len(ContentKind)

    with pytest.raises(ContentDocumentError, match="reserved for the Base Anima") as error:
        handler_for_kind(ContentKind.ANIMA).parse_document(
            {"schema_version": 1, "content_type": "anima", "name": "Future Anima"},
            fallback_path=Path("animas/future"),
            descriptor_backed=True,
        )
    assert error.value.code == "anima_descriptor_reserved"


def test_action_control_documents_do_not_take_the_primary_payload_name() -> None:
    assert descriptor_filename(definition_for_kind(ContentKind.GESTURE), "wave") == "wave.meta.json"
    assert descriptor_filename(definition_for_kind(ContentKind.REACTION), "happy") == "happy.meta.json"
    assert descriptor_filename(definition_for_kind(ContentKind.SCENE_EFFECT), "dark") == "dark.json"


def test_gesture_handler_derives_standalone_document_and_rejects_loose_fields() -> None:
    parsed = handler_for_kind(ContentKind.GESTURE).parse_document(
        None,
        fallback_path=Path("gestures/Friendly Wave.vrma"),
        descriptor_backed=False,
    )
    assert isinstance(parsed.document, GestureDocumentV1)
    assert parsed.document.name == "Friendly Wave"
    assert parsed.document.semantic_key == "friendly-wave"
    assert parsed.document.implementation.kind == "vrma"

    with pytest.raises(ContentDocumentError) as error:
        handler_for_kind(ContentKind.GESTURE).parse_document(
            {
                "schema_version": 1,
                "content_type": "gesture",
                "name": "Wave",
                "semantic_key": "wave",
                "surprise": True,
            },
            fallback_path=Path("gestures/wave"),
            descriptor_backed=True,
        )
    assert error.value.code == "unexpected_document_fields"


def test_reaction_handler_preserves_hint_and_requires_registered_runtime_media() -> None:
    parsed = handler_for_kind(ContentKind.REACTION).parse_document(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "content_id": "local:reaction:happy",
            "name": "Happy",
            "placement_hint": {"emotion": "joy", "intensity": 2},
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "files": [{"path": "happy.vrma", "role": "animation"}],
        },
        fallback_path=Path("reactions/happy"),
        descriptor_backed=True,
    )
    assert isinstance(parsed.document, ReactionDocumentV1)
    assert (parsed.document.emotion, parsed.document.intensity) == ("joy", 2)

    invalid = {
        "schema_version": 1,
        "content_type": "reaction",
        "name": "Remote Happy",
        "placement_hint": {"emotion": "joy", "intensity": 2},
        "implementation": {
            "kind": "vrma",
            "technical_source": {
                "type": "public_url",
                "url": "/vrm/animations/happy.vrma",
            },
        },
    }
    with pytest.raises(ContentDocumentError) as error:
        handler_for_kind(ContentKind.REACTION).parse_document(
            invalid,
            fallback_path=Path("reactions/remote-happy"),
            descriptor_backed=True,
        )
    assert error.value.code == "public_url_not_portable"


@pytest.mark.parametrize(
    "placement",
    [
        None,
        {},
        {"emotion": "joy"},
        {"intensity": 2},
        {"emotion": "unknown", "intensity": 2},
        {"emotion": "joy", "intensity": 4},
        {"emotion": "joy", "intensity": True},
        {"emotion": "joy", "intensity": 1.0},
    ],
)
def test_reaction_rejects_invalid_supplied_placement(placement: object) -> None:
    with pytest.raises(ContentDocumentError):
        handler_for_kind(ContentKind.REACTION).parse_document(
            {"schema_version": 1, "content_type": "reaction", "name": "Unplaced", "placement_hint": placement},
            fallback_path=Path("reactions/unplaced"),
            descriptor_backed=True,
        )


def test_reaction_without_hint_roundtrips_catalog_package_and_preview() -> None:
    handler = handler_for_kind(ContentKind.REACTION)
    descriptor = {
        "schema_version": 1,
        "content_type": "reaction",
        "name": "Unplaced",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
    }
    parsed = handler.parse_document(descriptor, fallback_path=Path("reactions/unplaced"), descriptor_backed=True)
    assert isinstance(parsed.document, ReactionDocumentV1)
    assert (parsed.document.emotion, parsed.document.intensity) == (None, None)
    assert "placement_hint" not in parsed.metadata
    packaged = json.loads(
        handler.rewrite_package_document(json.dumps(descriptor).encode(), reference_rewrites={}, descriptor_backed=True)
    )
    assert "placement_hint" not in packaged
    projected = handler.project_runtime(
        parsed.document,
        RuntimeProjectionInput(
            item_id="reaction-item",
            runtime_root_id="reaction-root",
            slot_key="preview",
            source={"type": "catalog_item"},
            revision="revision-1",
            context={},
            files=[],
            logical_files={},
            dependency_files={},
            reference_map={},
        ),
    )
    assert projected.payload is not None
    assert projected.payload["emotion"] is None
    assert projected.payload["intensity"] is None


@pytest.mark.parametrize("hint", [None, {"emotion": "joy", "intensity": 3}])
def test_reaction_runtime_projection_uses_the_equipped_loadout_cell(hint: dict | None) -> None:
    handler = handler_for_kind(ContentKind.REACTION)
    parsed = handler.parse_document(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "name": "Strong Joy",
            **({"placement_hint": hint} if hint else {}),
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        },
        fallback_path=Path("reactions/strong-joy"),
        descriptor_backed=True,
    )

    projected = handler.project_runtime(
        parsed.document,
        RuntimeProjectionInput(
            item_id="reaction-item",
            runtime_root_id="reaction-root",
            slot_key="reaction:sadness-1",
            source={"type": "catalog_item"},
            revision="revision-1",
            context={},
            files=[],
            logical_files={},
            dependency_files={},
            reference_map={},
        ),
    )

    assert projected.lane == "reaction"
    assert projected.payload is not None
    assert (projected.payload["emotion"], projected.payload["intensity"]) == (
        "sadness",
        1,
    )


def test_dependency_declaration_and_resolved_kind_must_agree() -> None:
    handler = handler_for_kind(ContentKind.GESTURE)
    parsed = handler.parse_document(
        {
            "schema_version": 1,
            "content_type": "gesture",
            "name": "Sparkle Wave",
            "semantic_key": "sparkle-wave",
            "dependencies": [
                {
                    "ref": "builtin:particle-effect:sparkle",
                    "content_type": "particle_effect",
                    "alias": "sparkle",
                }
            ],
        },
        fallback_path=Path("gestures/sparkle-wave"),
        descriptor_backed=True,
    )
    diagnostics = handler.validate_resolved_dependencies([(parsed.document.dependencies[0], ContentKind.SOUND_EFFECT)])
    assert [diagnostic.code for diagnostic in diagnostics] == ["dependency_kind_mismatch"]


def test_directory_and_descriptor_discriminators_cannot_disagree() -> None:
    with pytest.raises(ContentDocumentError) as error:
        handler_for_kind(ContentKind.GESTURE).parse_document(
            {"schema_version": 1, "content_type": "reaction", "name": "Wrong"},
            fallback_path=Path("gestures/wrong"),
            descriptor_backed=True,
        )
    assert error.value.code == "content_kind_mismatch"


def test_runtime_catalog_is_not_a_portable_typed_media_source() -> None:
    with pytest.raises(ContentDocumentError) as error:
        handler_for_kind(ContentKind.AVATAR_EFFECT).parse_document(
            {
                "schema_version": 1,
                "content_type": "avatar_effect",
                "name": "Legacy Star",
                "technical_source": {
                    "type": "runtime_catalog",
                    "catalog": "avatar_vfx",
                    "key": "star",
                },
            },
            fallback_path=Path("vfx/avatar/legacy-star"),
            descriptor_backed=True,
        )
    assert error.value.code == "runtime_catalog_not_portable"


def test_idle_style_owned_animations_project_by_descriptor_relative_path() -> None:
    handler = handler_for_kind(ContentKind.IDLE_STYLE)
    parsed = handler.parse_document(
        {
            "schema_version": 1,
            "content_type": "idle_style",
            "name": "Starter",
            "animations": [
                {
                    "animation_id": "sway",
                    "name": "Sway",
                    "file_ref": "animations/sway.vrma",
                }
            ],
            "default_pool": ["sway"],
            "files": [{"path": "animations/sway.vrma", "role": "animation"}],
        },
        fallback_path=Path("idle-styles/starter"),
        descriptor_backed=True,
    )
    playable = {
        "file_ref": "catalog-file-sway",
        "role": "animation",
        "ordinal": 1,
        "filename": "sway.vrma",
    }
    projected = handler.project_runtime(
        parsed.document,
        RuntimeProjectionInput(
            item_id="idle-item",
            runtime_root_id="idle-root",
            slot_key="idle_style",
            source={"type": "catalog_item"},
            revision="revision-1",
            context={},
            files=[playable],
            logical_files={"animations/sway.vrma": playable},
            dependency_files={},
            reference_map={},
        ),
    )

    assert projected.lane == "idle_style"
    assert projected.payload is not None
    assert projected.payload["animations"][0]["files"] == [playable]

    with pytest.raises(ContentDocumentError) as error:
        handler.parse_document(
            {
                "schema_version": 1,
                "content_type": "idle_style",
                "name": "Broken",
                "animations": [
                    {
                        "animation_id": "missing",
                        "name": "Missing",
                        "file_ref": "animations/missing.vrma",
                    }
                ],
                "files": [],
            },
            fallback_path=Path("idle-styles/broken"),
            descriptor_backed=True,
        )
    assert error.value.code == "idle_animation_file_missing"


def test_included_typed_documents_do_not_embed_browser_delivery_aliases() -> None:
    included = Path(__file__).resolve().parents[1] / "content" / "included"
    forbidden = ('"public_url"', '"runtime_catalog"', '"assetPath": "/', '"url": "/vrm')
    offenders = [
        path.relative_to(included).as_posix()
        for path in included.rglob("*.json")
        if any(value in path.read_text(encoding="utf-8") for value in forbidden)
    ]
    assert offenders == []
