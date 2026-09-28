"""Isolated admitted-catalog fixtures for the no-provider materializer."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_aggregate_materializer import AnimaAggregateMaterializer
from animama.domain.anima_creation import ResolvedAnimaSpec, ResolvedAppearanceSelection, ResolvedReactionSelection
from animama.domain.content_catalog import CatalogContentEntry
from animama.domain.emotions import TRACKED_EMOTIONS
from animama.orm.content_catalog import ORMContentCatalogFile, ORMContentCatalogItem
from animama.orm.model_provider import ORMModelProvider


@dataclass(frozen=True)
class CreationFixture:
    user_id: str
    spec: ResolvedAnimaSpec
    materializer: AnimaAggregateMaterializer
    provider_id: str


async def creation_fixture(session: AsyncSession) -> CreationFixture:
    """Create catalog/provider rows only, never a companion or user account."""

    suffix = uuid4().hex
    user_id = f"creation-owner-{suffix}"
    provider_id = f"test:creation-{suffix}"
    session.add(
        ORMModelProvider(
            id=provider_id,
            provider_type="test",
            model=f"creation-{suffix}",
            active=True,
            model_label="Creation fixture",
            provider_label="Fixture provider",
        )
    )

    async def item(kind: str, extra: dict[str, Any], logical_key: str | None = None) -> CatalogContentEntry:
        item_id = f"{kind}-{uuid4().hex}"
        key = logical_key or f"local:{kind}:{item_id}"
        included = key.startswith("builtin:")
        row = ORMContentCatalogItem(
            id=item_id,
            source="included" if included else "local",
            scope="included" if included else "owner",
            owner_user_id=None if included else user_id,
            kind=kind,
            relative_locator=f"{kind}/{item_id}",
            logical_key=key,
            display_name=f"Source {kind} {suffix}",
            status="valid",
            revision_sha256="a" * 64,
            content_metadata={
                "schema_version": 1,
                "content_type": kind,
                "content_id": key,
                "name": f"Source {kind} {suffix}",
                **extra,
            },
        )
        session.add(row)
        await session.flush()
        if kind == "appearance":
            session.add(
                ORMContentCatalogFile(
                    file_ref=f"image-{item_id}",
                    item_id=item_id,
                    relative_path=f"appearance/{item_id}/image.webp",
                    role="image",
                    media_type="image/webp",
                    size_bytes=32,
                    sha256="b" * 64,
                    ordinal=1,
                )
            )
        await session.flush()
        result = await SQLAlchemyContentCatalog(session).get_visible_item(item_id=item_id, user_id=user_id)
        assert result is not None
        return result

    avatar = await item("avatar", {"model_role": "model", "compatibility": {}})
    idle = await item(
        "idle_style",
        {
            "schema_version": 2,
            "default_pool": [],
            "cells": {},
        },
        "builtin:idle-style:starter",
    )
    profile = await item("appearance", {"width": 256, "height": 256})
    background = await item("appearance", {"width": 1024, "height": 512})
    await session.commit()
    return CreationFixture(
        user_id=user_id,
        provider_id=provider_id,
        materializer=AnimaAggregateMaterializer(default_model_provider_id=provider_id),
        spec=ResolvedAnimaSpec(
            display_name="  My  Companion  ",
            identity="# My identity\r\n\r\nKeep two spaces.  \r\n",
            avatar=avatar,
            idle_style=idle,
            reactions=tuple(
                ResolvedReactionSelection(emotion, intensity, None)
                for emotion in sorted(TRACKED_EMOTIONS)
                for intensity in (1, 2, 3)
            ),
            profile=ResolvedAppearanceSelection(profile, {"fit": "contain", "focal_x": 0.2, "zoom": 1.5}),
            background=ResolvedAppearanceSelection(background),
        ),
    )
