"""Real scanned files and isolated owners for private-creation integration tests."""

from __future__ import annotations

import json
import struct
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
from PIL import Image, ImageDraw
from sqlalchemy import delete, select

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_creation_repo import SQLAlchemyAnimaCreationRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.services.anima_creation_service import AnimaCreationService
from animama.app.services.anima_creation_sources import AnimaCreationSources, item_ref
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_gltf import REQUIRED_VRM_HUMANOID_BONES
from animama.app.services.starter_loadout_policy import starter_loadout_policy, starter_pack_identity
from animama.domain.content_catalog import CatalogContentEntry
from animama.domain.content_sources import IncludedContentSource
from animama.domain.emotions import TRACKED_EMOTIONS
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMAvatar, ORMModelProvider
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.memory_entry import ORMMemoryEntry, ORMMemoryEntryVersion
from animama.server.config import Settings, settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from animama.server.routers import anima, anima_creation, anima_loadouts, typed_content


def glb(document: dict[str, Any]) -> bytes:
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    return struct.pack("<4sII", b"glTF", 2, 20 + len(encoded)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded


def vrm(label: str = "avatar", version: str = "1.0") -> bytes:
    names = sorted(REQUIRED_VRM_HUMANOID_BONES)
    extension = "VRMC_vrm" if version == "1.0" else "VRM"
    bones = (
        {name: {"node": index} for index, name in enumerate(names)}
        if version == "1.0"
        else [{"bone": name, "node": index} for index, name in enumerate(names)]
    )
    return glb(
        {
            "asset": {"version": "2.0", "generator": label},
            "nodes": [{"name": name} for name in names],
            "extensionsUsed": [extension],
            "extensions": {extension: {"specVersion": version, "humanoid": {"humanBones": bones}}},
        }
    )


def vrma() -> bytes:
    return glb({"asset": {"version": "2.0"}, "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}}})


def image_bytes(*, portrait: bool = False, format: str = "PNG") -> bytes:
    image = Image.new("RGBA", (512, 512) if portrait else (32, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((30, 20, 450, 470) if portrait else (2, 2, 28, 22), fill="red")
    output = BytesIO()
    image.save(output, format=format)
    image.close()
    return output.getvalue()


def write_file(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def write_json(path: Path, value: dict[str, Any]) -> None:
    write_file(path, json.dumps(value).encode())


@dataclass
class AnimaCreationFixture:
    owner: str
    provider: str
    paths: LocalRuntimePaths
    items: dict[str, CatalogContentEntry]
    owners: set[str] = field(default_factory=set)
    extra_avatar_ids: set[str] = field(default_factory=set)
    extra_catalog_ids: set[str] = field(default_factory=set)

    async def add_owner(self, session) -> str:
        owner = f"other-{uuid4().hex}"
        self.owners.add(owner)
        return owner

    async def add_action_support(self, session) -> None:
        """Give the fixture Gesture a real typed and byte-verified sound support."""

        audio = BytesIO()
        with wave.open(audio, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\x01\x00" * 800)
        write_file(self.paths.local_root / "sfx/chime.wav", audio.getvalue())
        write_json(
            self.paths.local_root / "sfx/chime.meta.json",
            {"content_type": "sound_effect", "content_id": "local:sound-effect:chime", "name": "Chime"},
        )
        path = self.paths.local_root / "gestures/wave/wave.meta.json"
        document = json.loads(path.read_text())
        document["dependencies"] = [{"ref": "local:sound-effect:chime", "content_type": "sound_effect"}]
        write_json(path, document)
        result = await ContentCatalogService(
            catalog=SQLAlchemyContentCatalog(session),
            store=self.store(),
        ).rescan(user_id=self.owner, include_included=False)
        by_path = {item.relative_locator: item for item in result.items}
        for name, item in self.items.items():
            self.items[name] = by_path[item.relative_locator]
        self.items["sound"] = by_path["sfx/chime.wav"]
        assert self.items["gesture"].status.value == self.items["sound"].status.value == "valid"

    def store(self) -> FilesystemContentStore:
        return FilesystemContentStore(
            included_root=self.paths.included_root,
            included_sources=self.paths.included_sources,
            local_root=self.paths.local_root,
            operations_root=self.paths.operations_root,
        )

    def service(self, session, *, max_identity_bytes: int = 32768) -> AnimaCreationService:
        return AnimaCreationService(
            uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
            receipts=SQLAlchemyAnimaCreationRepository(session),
            sources=AnimaCreationSources(
                catalog=SQLAlchemyContentCatalog(session), store=self.store(), max_identity_bytes=max_identity_bytes
            ),
            default_model_provider_id=self.provider,
        )

    def request(
        self, *, key: str = "creation-key", avatar: str = "local-avatar", actions: bool = False
    ) -> CreateAnimaRequest:
        roots = [self.items[avatar], self.items["idle"]]
        reactions: dict[str, dict[str, dict[str, str] | None]] = {
            emotion: {str(level): None for level in (1, 2, 3)} for emotion in TRACKED_EMOTIONS
        }
        gestures = []
        if actions:
            roots.extend([self.items["gesture"], self.items["reaction"]])
            gestures = [{"semantic_key": "wave", "source": item_ref(self.items["gesture"])}]
            # Reuse one source in two non-hint cells to prove unrestricted placement.
            reactions["sadness"]["3"] = item_ref(self.items["reaction"])
            reactions["joy"]["1"] = item_ref(self.items["reaction"])
        return CreateAnimaRequest.model_validate(
            {
                "schema_version": 1,
                "display_name": "  Test  Companion  ",
                "identity_markdown": "# Test\r\n\r\nKeep two spaces.  \r\n",
                "avatar": item_ref(roots[0]),
                "appearance": {"profile": None, "background": None},
                "gestures": gestures,
                "reactions": reactions,
                "starter_pack": starter_pack_identity(),
                "expected_source_revisions": {
                    item.id: {"kind": item.kind.value, "revision_sha256": item.revision_sha256} for item in roots
                },
                "idempotency_key": key,
            }
        )

    def app(self, session, monkeypatch) -> FastAPI:
        monkeypatch.setattr(settings, "anima_default_model_provider_id", self.provider)
        app = FastAPI()
        app.state.local_runtime_paths = self.paths
        app.include_router(anima_creation.router)
        app.include_router(anima.router)
        app.include_router(anima_loadouts.router)
        app.include_router(typed_content.router)

        async def user():
            return RequestPrincipal(id=self.owner)

        async def database():
            yield session

        app.dependency_overrides[get_current_principal] = user
        app.dependency_overrides[get_async_session] = database
        return app


@asynccontextmanager
async def anima_creation_fixture(
    session, tmp_path: Path, *, full_starter: bool = False, mounted_included: bool = False
):
    owner = f"private-{uuid4().hex}"
    provider = f"test:{uuid4().hex}"
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    write_json(paths.included_root / "licenses/inventory.json", {"rules": [{"glob": "**/*", "license_id": "test"}]})
    for name in ("AvatarSample_A_1_New", "AvatarSample_R1"):
        write_file(paths.included_root / f"avatars/{name}.vrm", vrm(name))
    write_file(paths.local_root / "avatars/local-avatar.vrm", vrm(owner))
    write_file(paths.local_root / "appearances/picture.png", image_bytes())
    write_json(
        paths.included_root / "idle-styles/starter/starter.json",
        {
            "schema_version": 1,
            "content_type": "idle_style",
            "content_id": "builtin:idle-style:starter",
            "name": "Starter Idle",
            "animations": [{"animation_id": "calm", "name": "Calm", "file_ref": "calm.vrma"}],
            "files": [{"path": "calm.vrma", "role": "animation"}],
            "default_pool": ["calm"],
            "emotion_pools": {},
            "compatibility": {"vrm_versions": ["0.x", "1.0"]},
        },
    )
    write_file(paths.included_root / "idle-styles/starter/calm.vrma", vrma())
    for kind, name in (("gesture", "wave"), ("reaction", "joy-2")):
        document: dict[str, Any] = {
            "schema_version": 1,
            "content_type": kind,
            "content_id": f"local:{kind}:{name}",
            "name": name,
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "files": [{"path": "motion.vrma", "role": "animation"}],
        }
        if kind == "gesture":
            document["semantic_key"] = name
        else:
            document["placement_hint"] = {"emotion": "joy", "intensity": 2}
        write_json(paths.local_root / f"{kind}s/{name}/{name}.meta.json", document)
        write_file(paths.local_root / f"{kind}s/{name}/motion.vrma", vrma())
    if full_starter:
        policy = starter_loadout_policy()
        for kind, choices in (("gesture", policy["gestures"]), ("reaction", policy["reactions"])):
            for choice in choices:
                name = choice["content_id"].rsplit(":", 1)[-1]
                document = {
                    "schema_version": 1,
                    "content_type": kind,
                    "content_id": choice["content_id"],
                    "name": name,
                    "implementation": {"kind": "vrma", "file_role": "animation"},
                    "files": [{"path": "motion.vrma", "role": "animation"}],
                }
                document.update(
                    {"semantic_key": name}
                    if kind == "gesture"
                    else {"placement_hint": {"emotion": choice["emotion"], "intensity": choice["intensity"]}}
                )
                write_json(paths.included_root / f"{kind}s/{name}/{name}.meta.json", document)
                write_file(paths.included_root / f"{kind}s/{name}/motion.vrma", vrma())
    session.add_all(
        [
            ORMModelProvider(
                id=provider,
                provider_type="test",
                model=provider,
                active=True,
                model_label="Fixture",
                provider_label="Fixture",
            ),
        ]
    )
    await session.commit()
    if mounted_included:
        # The same fixture bytes exercise the desktop source selector; no real
        # starter assets or distribution permissions are required by this test.
        paths = replace(paths, included_sources=(IncludedContentSource("core", "fixture-v1", paths.included_root),))
    fixture = AnimaCreationFixture(owner, provider, paths, {})
    fixture.owners.add(owner)
    catalog = SQLAlchemyContentCatalog(session)
    content = ContentCatalogService(catalog=catalog, store=fixture.store())
    result = await content.rescan(user_id=owner)
    bad = [item for item in result.items if item.status.value != "valid"]
    assert not bad, [(item.relative_locator, item.diagnostics) for item in bad]
    by_path = {item.relative_locator: item for item in result.items}
    fixture.items = {
        "local-avatar": by_path["avatars/local-avatar.vrm"],
        "included-avatar": by_path["avatars/AvatarSample_A_1_New.vrm"],
        "idle": by_path["idle-styles/starter"],
        "gesture": by_path["gestures/wave"],
        "reaction": by_path["reactions/joy-2"],
        "image": by_path["appearances/picture.png"],
    }
    try:
        yield fixture
    finally:
        await session.rollback()
        ids = list(
            await session.scalars(
                select(ORMContentCatalogItem.id).where(
                    (ORMContentCatalogItem.owner_user_id.in_(fixture.owners))
                    | (
                        ORMContentCatalogItem.id.in_(
                            [item.id for item in result.items] + list(fixture.extra_catalog_ids)
                        )
                    )
                )
            )
        )
        avatar_ids = list(await session.scalars(select(ORMAvatar.id).where(ORMAvatar.catalog_item_id.in_(ids))))
        avatar_ids.extend(fixture.extra_avatar_ids)
        await session.execute(
            delete(ORMAnima).where((ORMAnima.user_id.in_(fixture.owners)) | ORMAnima.avatar_id.in_(avatar_ids))
        )
        await session.execute(delete(ORMAvatar).where(ORMAvatar.id.in_(avatar_ids)))
        await session.execute(delete(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.user_id.in_(fixture.owners)))
        await session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id.in_(fixture.owners)))
        await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(ids)))
        await session.execute(delete(ORMModelProvider).where(ORMModelProvider.id == provider))
        await session.commit()
