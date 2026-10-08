"""Exact-media finite playback admission shared by Idle Save, preview and mount."""

from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from typing import BinaryIO, Literal, cast

from animama.app.ports.content_store import ContentStore
from animama.app.services.clip_format import ANIMA_POSE_CLIP_SCHEMA, unsupported_clip_format_message
from animama.app.services.content_file_validation import ContentFileInvalidError
from animama.app.services.content_gltf import canonicalize_vrma_stream
from animama.app.services.content_kind_registry import MAX_JSON_BYTES, _validate_bounded_json
from animama.app.services.idle_clip_validation import validate_clip_v2_timeline
from animama.domain.content_catalog import CatalogContentEntry
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1


@dataclass(frozen=True, slots=True)
class IdlePlaybackFacts:
    """Finite facts whose clock is shared by scheduler and motion/event executor."""

    cycle_seconds: float
    time_scale: float
    repetitions: int
    duration_seconds: float
    loop_type: Literal["once", "repeat", "pingpong"]
    eligible: bool = True
    reason: str | None = None


def _finite(value: object, code: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ContentDocumentError(code, "Idle playback requires a finite number")
    try:
        result = float(value)
    except OverflowError as exc:
        raise ContentDocumentError(code, "Idle playback requires a finite number") from exc
    if not math.isfinite(result):
        raise ContentDocumentError(code, "Idle playback requires a finite number")
    return result


def _positive(value: object, code: str) -> float:
    result = _finite(value, code)
    if result <= 0:
        raise ContentDocumentError(code, "Idle playback requires a positive finite value")
    return result


def derive_idle_playback(document: GestureDocumentV1, payload: BinaryIO) -> IdlePlaybackFacts:
    """Inspect registered bytes; never use a declared duration to repair unknown bounds.

    The caller owns the stream. Its position is restored on both success and error.
    VRMA validation reuses the bounded media importer and verifies actual samples.
    """

    position = payload.tell()
    try:
        payload.seek(0, 2)
        size = payload.tell()
        payload.seek(0)
        speed = _positive(document.config.get("time_scale", 1), "idle_speed_invalid")
        if document.implementation.kind == "vrma":
            try:
                cycle = canonicalize_vrma_stream(content=payload, size_bytes=size).duration_seconds
            except ContentFileInvalidError as exc:
                raise ContentDocumentError(
                    "idle_motion_invalid", "Gesture motion has no validated finite timeline"
                ) from exc
            loop = document.config.get("loop_type", "once")
            if not isinstance(loop, str) or loop not in {"once", "repeat", "pingpong"}:
                raise ContentDocumentError("idle_loop_invalid", "Gesture loop mode is unsupported")
        else:
            if size > MAX_JSON_BYTES:
                raise ContentDocumentError("idle_motion_invalid", "Gesture clip exceeds its JSON budget")
            try:
                clip = json.loads(payload.read(MAX_JSON_BYTES + 1))
            except (ValueError, UnicodeError, RecursionError) as exc:
                raise ContentDocumentError("idle_motion_invalid", "Gesture clip is not valid JSON") from exc
            schema = clip.get("schema") if isinstance(clip, dict) else None
            if schema != ANIMA_POSE_CLIP_SCHEMA:
                raise ContentDocumentError("idle_motion_invalid", unsupported_clip_format_message(schema))
            _validate_bounded_json(clip)
            if clip.get("playback") is not None:
                raise ContentDocumentError(
                    "idle_lifetime_unsupported", "Idle cannot use a phase, state or run lifetime"
                )
            if not isinstance(clip.get("loop", False), bool):
                raise ContentDocumentError("idle_loop_invalid", "Gesture clip loop must be boolean")
            cycle = validate_clip_v2_timeline(clip)
            loop = "repeat" if document.config.get("loop", clip.get("loop", False)) is True else "once"
            if "loop" in document.config and not isinstance(document.config["loop"], bool):
                raise ContentDocumentError("idle_loop_invalid", "Gesture clip loop override must be boolean")
        cycle = _positive(cycle, "idle_duration_invalid")
        repetitions = 1 if loop == "once" else document.config.get("loop_count", 2 if loop == "pingpong" else None)
        if isinstance(repetitions, bool) or not isinstance(repetitions, int) or not 1 <= repetitions <= 2**53 - 1:
            raise ContentDocumentError(
                "idle_repetitions_invalid", "Looping idle Gestures require an explicit positive finite repetition count"
            )
        duration = _positive(cycle * repetitions / speed, "idle_duration_invalid")
        return IdlePlaybackFacts(cycle, speed, repetitions, duration, cast(Literal["once", "repeat", "pingpong"], loop))
    finally:
        payload.seek(position)


async def read_gesture_idle_playback(
    *,
    document: GestureDocumentV1,
    item: CatalogContentEntry,
    dependency_items: dict[str, CatalogContentEntry],
    store: ContentStore,
) -> IdlePlaybackFacts:
    """Open one exact registered motion after the caller validates its typed closure."""

    motion_owner = item
    dependency_ref = document.implementation.content_dependency_ref
    if dependency_ref is not None:
        targets = dict(zip(item.dependencies, item.dependency_item_ids, strict=True))
        dependency_owner = dependency_items.get(targets.get(dependency_ref, ""))
        if dependency_owner is None:
            raise ContentDocumentError("idle_motion_unavailable", "Gesture motion dependency is unavailable")
        motion_owner = dependency_owner
    role = document.implementation.file_role or ("animation" if document.implementation.kind == "vrma" else "sequence")
    files = [file for file in motion_owner.files if file.role == role]
    if len(files) != 1:
        raise ContentDocumentError("idle_motion_ambiguous", "Idle Gesture requires exactly one registered motion file")
    file = files[0]

    def read() -> IdlePlaybackFacts:
        opened = store.open_verified_file(
            source=file.source,
            source_mount_id=file.source_mount_id,
            relative_path=file.relative_path,
            expected_size_bytes=file.size_bytes,
            expected_sha256=file.sha256,
            media_type=file.media_type,
        )
        try:
            return derive_idle_playback(document, opened.handle)
        finally:
            opened.handle.close()

    return await asyncio.to_thread(read)
