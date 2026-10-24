"""Materialize one complete private Anima in a caller-owned transaction."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any
from uuid import uuid4

from animama.app.ports.anima_aggregate_port import AnimaAggregateUnitOfWork
from animama.domain.anima import Anima
from animama.domain.anima_chat_profile import AnimaChatProfile
from animama.domain.anima_creation import ResolvedAnimaSpec
from animama.domain.anima_definition import (
    ANIMA_IDENTITY_MAX_BYTES,
    DEFAULT_ANIMA_VOICE_ID,
    AnimaDefinitionError,
    anima_identity_description,
    normalize_display_name,
    normalize_identity,
)
from animama.domain.emotions import default_emotional_state
from animama.domain.settings import AnimaSettings

from .memory_entry_service import MemoryEntryService
from .settings_service import default_anima_preferences


def initial_voice_profile(choice: dict[str, Any] | None) -> dict[str, Any]:
    """Validate only local voice identity; never contact ElevenLabs at creation."""

    profile = deepcopy(choice) if choice is not None else {"primary_voice": {"voice_id": DEFAULT_ANIMA_VOICE_ID}}
    voice = profile.get("primary_voice")
    voice_id = voice.get("voice_id") if isinstance(voice, dict) else None
    if not isinstance(voice_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", voice_id):
        raise AnimaDefinitionError("anima_voice_choice_invalid")
    return profile


class AnimaAggregateMaterializer:
    """Write authority and children together; the caller commits or rolls back.

    Whole-spec source/closure validation and creation receipts belong to the
    AnimaCreationService command boundary. This boundary never issues runtime or creates chat.
    """

    def __init__(self, *, default_model_provider_id: str, max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES) -> None:
        self._default_model_provider_id = default_model_provider_id
        self._max_identity_bytes = min(ANIMA_IDENTITY_MAX_BYTES, max_identity_bytes)

    async def materialize(
        self,
        *,
        user_id: str,
        spec: ResolvedAnimaSpec,
        uow: AnimaAggregateUnitOfWork,
        model_provider_id: str | None = None,
    ) -> Anima:
        """Create a fresh ID and exact selected loadout from resolved content.

        ``model_provider_id`` overrides the installation default, e.g. with the
        owner's preferred default chat model; it is validated the same way.
        """

        display_name = normalize_display_name(spec.display_name)
        identity = normalize_identity(spec.identity, max_bytes=self._max_identity_bytes)
        voice = initial_voice_profile(spec.voice_profile)
        model_id = model_provider_id or self._default_model_provider_id
        await self._validate_model(uow, model_id)
        avatar = await uow.avatars.resolve_catalog_avatar(user_id=user_id, item=spec.avatar)
        anima = Anima(
            id=f"anima-{uuid4().hex}",
            display_name=display_name,
            avatar=avatar,
            user_id=user_id,
            emotional_state=default_emotional_state(),
        )
        await self._write_definition(
            uow=uow,
            anima=anima,
            identity=identity,
            model_provider_id=model_id,
            voice_profile=voice,
            speech_preferences=spec.speech_preferences,
            identity_metadata={},
        )
        await uow.loadouts.initialize(user_id=user_id, anima_id=anima.id, spec=spec)
        return await uow.animas.record_definition_revision(
            user_id=user_id,
            anima_id=anima.id,
            expected_revision=1,
            reason="anima_create",
            initial=True,
        )

    @staticmethod
    async def _validate_model(uow: AnimaAggregateUnitOfWork, model_provider_id: str) -> None:
        provider = await uow.model_providers.get(model_provider_id)
        if provider is None or not provider.active:
            raise AnimaDefinitionError("anima_model_provider_unavailable")

    async def _write_definition(
        self,
        *,
        uow: AnimaAggregateUnitOfWork,
        anima: Anima,
        identity: str,
        model_provider_id: str,
        voice_profile: dict[str, Any],
        identity_metadata: dict[str, Any],
        speech_preferences: dict[str, Any] | None = None,
    ) -> None:
        assert anima.user_id is not None
        await uow.animas.create(anima)
        memory = MemoryEntryService(
            memory_entries=uow.memory_entries,
            animas=uow.animas,
            uow=uow,
            max_file_bytes=self._max_identity_bytes,
            commit_on_write=False,
        )
        await memory.initialize_anima_identity(
            user_id=anima.user_id,
            anima_id=anima.id,
            content=identity,
            description=anima_identity_description(anima.display_name),
            metadata=identity_metadata,
        )
        await memory.initialize_anima_memories(
            user_id=anima.user_id, anima_id=anima.id, display_name=anima.display_name
        )
        preferences = default_anima_preferences()
        preferences["speech"] = (
            deepcopy(speech_preferences) if speech_preferences is not None else {"elevenlabs": voice_profile}
        )
        await uow.settings.upsert(AnimaSettings(user_id=anima.user_id, anima_id=anima.id, preferences=preferences))
        await uow.chat_profiles.upsert(
            AnimaChatProfile(
                anima_id=anima.id,
                default_model_provider_id=model_provider_id,
                metadata={"source": "anima_create"},
            )
        )
