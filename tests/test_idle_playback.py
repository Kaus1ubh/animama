"""Finite Idle eligibility is derived from exact Gesture media, not guessed durations."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, replace
from io import BytesIO
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest

from animama.app.ports.content_store import ContentStore
from animama.app.services import idle_playback
from animama.app.services.idle_playback import derive_idle_playback, read_gesture_idle_playback
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)
from animama.domain.content_documents import ActionImplementationV1, ContentDocumentError, GestureDocumentV1
from tests.test_content_gltf import _fixture_document, _glb_source

CASES = json.loads((Path(__file__).parent / "fixtures/idle-playback-cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_finite_idle_cases(case: dict[str, Any]) -> None:
    document = GestureDocumentV1(
        kind=ContentKind.GESTURE,
        name="Idle action",
        implementation=ActionImplementationV1(kind=case["kind"]),
        config=case["config"],
    )
    if case["kind"] == "vrma":
        gltf, binary = _fixture_document(buffer_uri=None)
        data = _glb_source(gltf, binary)
    else:
        data = json.dumps(case["clip"]).encode()
    if "error" in case:
        with pytest.raises(ContentDocumentError) as error:
            derive_idle_playback(document, BytesIO(data))
        assert error.value.code == case["error"]
    else:
        assert asdict(derive_idle_playback(document, BytesIO(data))) == {
            "eligible": True,
            "reason": None,
            **case["expected"],
        }


def test_config_duration_cannot_substitute_for_exact_motion_bounds() -> None:
    document = GestureDocumentV1(kind=ContentKind.GESTURE, name="Unknown", config={"duration_seconds": 10})
    with pytest.raises(ContentDocumentError) as error:
        derive_idle_playback(document, BytesIO(b"invalid vrma"))
    assert error.value.code == "idle_motion_invalid"


@pytest.mark.parametrize("speed", [float("nan"), float("inf"), 10**400, True])
def test_nonfinite_or_unrepresentable_speed_has_a_safe_validation_error(speed: object) -> None:
    document = GestureDocumentV1(
        kind=ContentKind.GESTURE,
        name="Unsafe speed",
        config={"time_scale": speed},
        implementation=ActionImplementationV1(kind="anima_clip"),
    )
    with pytest.raises(ContentDocumentError) as error:
        derive_idle_playback(document, BytesIO(b'{"schema":"animaPoseClip/2.0","duration":1}'))
    assert error.value.code == "idle_speed_invalid"


class _CountingStore:
    """Serves one clip's bytes and counts verified opens."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.opens = 0

    def open_verified_file(self, **facts: Any) -> VerifiedContentFile:
        self.opens += 1
        assert facts["expected_sha256"] == hashlib.sha256(self.data).hexdigest()
        return VerifiedContentFile(BytesIO(self.data), len(self.data), facts["expected_sha256"], facts["media_type"])


def _idle_gesture(config: dict[str, Any]) -> tuple[GestureDocumentV1, CatalogContentEntry, _CountingStore]:
    """A clip Gesture whose bytes are unique to the test, so cached facts never leak between tests."""

    clip = {**CASES[0]["clip"], "id": uuid4().hex}
    data = json.dumps(clip).encode()
    motion = CatalogContentFile(
        file_ref=f"ref-{uuid4().hex}",
        item_id="gesture",
        source=ContentSource.LOCAL,
        relative_path="gestures/idle/idle.json",
        role="sequence",
        media_type="application/json",
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    item = CatalogContentEntry(
        id="gesture",
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="owner",
        kind=ContentKind.GESTURE,
        relative_locator="gestures/idle",
        display_name="Idle",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        files=(motion,),
    )
    document = GestureDocumentV1(
        kind=ContentKind.GESTURE,
        name="Idle",
        implementation=ActionImplementationV1(kind="anima_clip", file_role="sequence"),
        config=config,
    )
    return document, item, _CountingStore(data)


async def _read(
    document: GestureDocumentV1, item: CatalogContentEntry, store: _CountingStore, *, verified: bool = False
) -> idle_playback.IdlePlaybackFacts:
    return await read_gesture_idle_playback(
        document=document, item=item, dependency_items={}, store=cast(ContentStore, store), verified=verified
    )


def _count_derivations(monkeypatch: pytest.MonkeyPatch) -> list[GestureDocumentV1]:
    calls: list[GestureDocumentV1] = []
    derive = idle_playback.derive_idle_playback

    def counted(document: GestureDocumentV1, payload: Any) -> idle_playback.IdlePlaybackFacts:
        calls.append(document)
        return derive(document, payload)

    monkeypatch.setattr(idle_playback, "derive_idle_playback", counted)
    return calls


async def test_unchanged_motion_and_settings_are_parsed_once_but_still_verified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    derivations = _count_derivations(monkeypatch)
    document, item, store = _idle_gesture({"time_scale": 2})
    first = await _read(document, item, store)
    again = await _read(document, item, store)
    assert first == again and first.duration_seconds == 1.5
    assert len(derivations) == 1
    # A caller that has not verified the bytes itself still opens and hashes them.
    assert store.opens == 2


async def test_bytes_the_caller_verified_reuse_cached_facts_without_opening(monkeypatch: pytest.MonkeyPatch) -> None:
    derivations = _count_derivations(monkeypatch)
    document, item, store = _idle_gesture({})
    first = await _read(document, item, store, verified=True)
    again = await _read(document, item, store, verified=True)
    assert first == again
    assert len(derivations) == 1
    assert store.opens == 1


async def test_changed_settings_or_motion_bytes_are_parsed_again(monkeypatch: pytest.MonkeyPatch) -> None:
    derivations = _count_derivations(monkeypatch)
    document, item, store = _idle_gesture({"time_scale": 2})
    slower = replace(document, config={"time_scale": 0.5})
    first = await _read(document, item, store)
    second = await _read(slower, item, store, verified=True)
    assert (first.duration_seconds, second.duration_seconds) == (1.5, 6)
    other_document, other_item, other_store = _idle_gesture({"time_scale": 2})
    await _read(other_document, other_item, other_store, verified=True)
    assert len(derivations) == 3


async def test_invalid_motion_is_never_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    derivations = _count_derivations(monkeypatch)
    document, item, store = _idle_gesture({"loop": True})
    for _ in range(2):
        with pytest.raises(ContentDocumentError) as error:
            await _read(document, item, store, verified=True)
        assert error.value.code == "idle_repetitions_invalid"
    assert len(derivations) == 2


async def test_cached_facts_stay_within_the_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(idle_playback, "_facts_cache", idle_playback._FactsCache(max_entries=2))
    derivations = _count_derivations(monkeypatch)
    gestures = [_idle_gesture({}) for _ in range(3)]
    for document, item, store in [*gestures, gestures[0]]:
        await _read(document, item, store, verified=True)
    # The first Gesture was evicted by the third, so it is parsed again.
    assert len(derivations) == 4
