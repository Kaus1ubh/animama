"""Per-use overrides that an ``avatar_vfx`` clip event applies to the Avatar Effect it plays.

A Gesture or Reaction event may carry ``override`` to place, style or move its
effect differently for that one use, or pick another of its declared sounds
(``AvatarEffectEventOverride``). Clip validation checks the override's shape;
Save and package import/export also check the definition it produces against
the effect the event names. Failures raise ``ContentDocumentError`` with the
caller's code and the JSON path of the offending field.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from animama.app.contracts.avatar_effect import (
    AvatarEffectDefinitionV2,
    AvatarEffectEventOverride,
    merge_avatar_effect_override,
)
from animama.app.services.avatar_effect_conversion import avatar_effect_validation_error, avatar_effect_value_error
from animama.domain.content_documents import ContentDocumentError


def parse_avatar_effect_override(value: Any, *, code: str, field: str) -> AvatarEffectEventOverride:  # noqa: ANN401
    """Validate an event's ``override`` shape; ``field`` is its JSON path."""
    try:
        return AvatarEffectEventOverride.model_validate(value)
    except ValidationError as exc:
        path, message = avatar_effect_validation_error(exc, root=field)
        raise ContentDocumentError(code, f"{path}: {message}", field=path) from exc


def apply_avatar_effect_override(
    definition: AvatarEffectDefinitionV2, override: AvatarEffectEventOverride, *, code: str, field: str
) -> AvatarEffectDefinitionV2:
    """Return the definition the use plays, refusing a kind change or an inconsistent result."""
    try:
        return merge_avatar_effect_override(definition, override)
    except ValidationError as exc:
        path, message = avatar_effect_validation_error(exc, root=field)
    except ValueError as exc:
        path, message = avatar_effect_value_error(field, str(exc))
    raise ContentDocumentError(code, f"{path}: {message}", field=path)


def check_clip_effect_overrides(
    clip: Mapping[str, Any],
    definitions: Mapping[str, AvatarEffectDefinitionV2 | None],
    *,
    code: str,
) -> None:
    """Check every ``avatar_vfx`` override in a clip against the effect its ``effectId`` names.

    ``definitions`` maps an event's ``effectId`` to that effect's definition.
    An effect that is absent or not a valid ``/2`` definition is skipped: its
    own dependency or definition check reports it, and only the override's
    shape is checked.
    """
    events = clip.get("events")
    if not isinstance(events, list):
        return
    for event in events:
        if not isinstance(event, Mapping) or event.get("kind") != "avatar_vfx" or "override" not in event:
            continue
        # The same path clip validation uses for event fields.
        field = f"event.{event.get('id')}.override"
        override = parse_avatar_effect_override(event["override"], code=code, field=field)
        definition = definitions.get(str(event.get("effectId")))
        if definition is not None:
            apply_avatar_effect_override(definition, override, code=code, field=field)


__all__ = [
    "apply_avatar_effect_override",
    "check_clip_effect_overrides",
    "parse_avatar_effect_override",
]
