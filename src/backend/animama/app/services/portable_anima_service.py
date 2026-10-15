"""Pure portable Anima admission and mapping; no creation commands or runtime issuance."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from animama.app.contracts.portable_anima import PortableActionConfig, PortableAnima
from animama.app.services.content_voice import POCKET_CLONE_CODEC
from animama.app.services.runtime_budget_policy import RuntimeBudgetUsage, runtime_budget_violation
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.anima_creation import (
    ResolvedAnimaSpec,
    ResolvedAppearanceSelection,
    ResolvedGestureSelection,
    ResolvedIdleMember,
    ResolvedReactionSelection,
)
from animama.domain.anima_definition import ANIMA_IDENTITY_MAX_BYTES, normalize_identity
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentNotFoundError,
    ContentStatus,
)
from animama.domain.content_documents import (
    GestureDocumentV1,
    ReactionDocumentV1,
    SoundEffectDocumentV1,
    TypedContentDocument,
    VoiceDocumentV1,
)


def validate_binding_configuration(document: TypedContentDocument, config: dict[str, Any]) -> dict[str, Any]:
    """Admit only fields actually consumed for this family and implementation."""
    try:
        if any(value is None for value in config.values()):
            raise ValueError("Null binding field")
        normalized = PortableActionConfig.model_validate(config).model_dump(exclude_none=True)
    except (ValueError, ValidationError) as exc:
        raise ContentConflictError("package_anima_binding_config_invalid") from exc
    if isinstance(document, ReactionDocumentV1):
        if normalized or document.implementation.kind != "anima_clip":
            raise ContentConflictError("package_anima_binding_config_unsupported")
    elif isinstance(document, GestureDocumentV1):
        unsupported = {"loop"} if document.implementation.kind == "vrma" else {"loop_type", "blend_mode"}
        if unsupported.intersection(normalized):
            raise ContentConflictError("package_anima_binding_config_unsupported")
    else:
        raise ContentConflictError("package_anima_action_required")
    return normalized


def _documents(
    definition: PortableAnima, entries: Mapping[str, CatalogContentEntry]
) -> dict[str, TypedContentDocument]:
    result = {}
    for entry_id, kind in definition.entry_references():
        entry = entries.get(entry_id)
        if entry is None or entry.status is not ContentStatus.VALID or entry.revision_sha256 is None:
            raise ContentConflictError("package_anima_source_unavailable")
        if entry.kind is not kind:
            raise ContentConflictError("package_anima_source_kind_invalid")
        try:
            result[entry_id] = TypedContentService.parse(entry).document
        except ContentNotFoundError as exc:
            raise ContentConflictError("package_anima_source_invalid") from exc
    return result


def resolve_portable_anima(
    definition: PortableAnima,
    entries: Mapping[str, CatalogContentEntry],
    *,
    max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES,
) -> ResolvedAnimaSpec:
    """Map package entry identities to admitted receiver-local content without writes."""
    normalize_identity(definition.identity_markdown, max_bytes=max_identity_bytes)
    documents = _documents(definition, entries)
    gestures = []
    for selection in definition.gestures:
        document = documents[selection.entry_id]
        if not isinstance(document, GestureDocumentV1) or document.semantic_key != selection.semantic_key:
            raise ContentConflictError("package_anima_gesture_key_mismatch")
        gestures.append(
            ResolvedGestureSelection(
                entries[selection.entry_id], validate_binding_configuration(document, selection.config)
            )
        )
    reactions = tuple(
        ResolvedReactionSelection(
            emotion,
            int(level),
            entries[selection.entry_id] if selection else None,
            validate_binding_configuration(documents[selection.entry_id], selection.config) if selection else {},
        )
        for emotion, cells in definition.reactions.items()
        for level, selection in cells.items()
    )
    idle = []
    for cell, entry_id in definition.idle.members():
        if not isinstance(documents[entry_id], GestureDocumentV1):
            raise ContentConflictError("package_anima_source_kind_invalid")
        idle.append(ResolvedIdleMember(entries[entry_id], cell))
    if definition.pocket_voice is not None:
        voice = documents[definition.pocket_voice]
        if not isinstance(voice, VoiceDocumentV1) or voice.codec != POCKET_CLONE_CODEC:
            raise ContentConflictError("package_anima_voice_unsupported")
    return ResolvedAnimaSpec(
        display_name=definition.display_name,
        identity=definition.identity_markdown,
        avatar=entries[definition.avatar],
        idle=tuple(idle),
        gestures=tuple(gestures),
        reactions=reactions,
        profile=ResolvedAppearanceSelection(
            entries[definition.appearance.profile.entry_id], definition.appearance.profile.presentation.model_dump()
        )
        if definition.appearance.profile
        else None,
        voice_source=entries[definition.pocket_voice] if definition.pocket_voice else None,
        # Activate the imported binding with fresh preferences, never sender settings.
        speech_preferences={
            "tts_provider": "pocket_tts",
            "tts_pocket_anima_voice": "eve",
            "tts_pocket_anima_custom_voice_available": False,
            "elevenlabs": {},
        }
        if definition.pocket_voice
        else None,
        background=ResolvedAppearanceSelection(
            entries[definition.appearance.background.entry_id],
            definition.appearance.background.presentation.model_dump(),
        )
        if definition.appearance.background
        else None,
    )


def rewrite_portable_anima(definition: PortableAnima, reference_map: Mapping[str, str]) -> PortableAnima:
    """Rewrite only typed equipment references, never names, identity text or configuration."""
    if any(entry_id not in reference_map for entry_id, _ in definition.entry_references()):
        raise ContentConflictError("package_anima_reference_missing")
    value = definition.model_dump()
    value["avatar"] = reference_map[definition.avatar]
    for selection in value["gestures"]:
        selection["entry_id"] = reference_map[selection["entry_id"]]
    for cells in value["reactions"].values():
        for selection in cells.values():
            if selection is not None:
                selection["entry_id"] = reference_map[selection["entry_id"]]
    idle = value["idle"]
    idle["default"] = [reference_map[entry_id] for entry_id in idle["default"]]
    for levels in idle["cells"].values():
        for level, members in levels.items():
            levels[level] = [reference_map[entry_id] for entry_id in members]
    if value["pocket_voice"] is not None:
        value["pocket_voice"] = reference_map[value["pocket_voice"]]
    for selection in value["appearance"].values():
        if selection is not None:
            selection["entry_id"] = reference_map[selection["entry_id"]]
    return PortableAnima.model_validate(value)


def validate_package_anima_runtime(
    definition: PortableAnima,
    entries: Mapping[str, CatalogContentEntry],
    *,
    max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES,
) -> None:
    """Check the complete validated package closure against recipient Anima limits.

    Archive/source callers own graph and byte validation. This pure check is shared
    by the writer and reader and cannot issue a best-effort mounted runtime.
    """
    resolve_portable_anima(definition, entries, max_identity_bytes=max_identity_bytes)
    files = {file.file_ref: file for entry in entries.values() for file in entry.files}
    audio_seconds = 0.0
    for entry in entries.values():
        if entry.kind is ContentKind.SOUND_EFFECT:
            document = TypedContentService.parse(entry).document
            assert isinstance(document, SoundEffectDocumentV1)
            audio_seconds += document.duration_seconds or 0
    config_bytes = sum(len(json.dumps(entry.metadata, allow_nan=False).encode()) for entry in entries.values())
    config_bytes += sum(len(json.dumps(selection.config).encode()) for selection in definition.gestures)
    config_bytes += sum(
        len(json.dumps(selection.config).encode())
        for cells in definition.reactions.values()
        for selection in cells.values()
        if selection
    )
    violation = runtime_budget_violation(
        RuntimeBudgetUsage(len(entries), sum(file.size_bytes for file in files.values()), audio_seconds, config_bytes)
    )
    if violation:
        raise ContentConflictError(violation)
