"""Retire active Music equipment while retaining private binding evidence."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass

from animama.app.ports.content_transition import ContentTransitionBindings, MusicTransitionAnima
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.local_content_mutations import mutation_digest


@dataclass(frozen=True, slots=True)
class MusicRetirementResult:
    """Durable completion facts for one Anima's retired Music selection."""

    anima_id: str
    removed_binding_ids: tuple[str, ...]
    loadout_revision: int
    aggregate_revision: int
    preservation_id: str


class MusicRetirementService:
    """Preserve binding facts before removal through the Local mutation authority."""

    def __init__(self, *, content: ContentCatalogService, bindings: ContentTransitionBindings) -> None:
        self._content = content
        self._bindings = bindings

    async def retire(self, *, user_id: str) -> tuple[MusicRetirementResult, ...]:
        """Remove existing Music equipment without reading or changing audio bytes."""
        mutations = self._content.mutations

        async def snapshot() -> tuple[MusicTransitionAnima, ...]:
            return await self._bindings.music_consumers(user_id=user_id)

        # Recovery must run even when a previous commit already removed every row
        # but its process stopped before finalizing the filesystem journal.
        consumers = await mutations.reconcile(snapshot)
        results = []
        for before in consumers:
            digest = mutation_digest({"transition": "music-retirement/1", "user_id": user_id, "before": asdict(before)})
            operation_id = f"music-retirement-{digest[:40]}"

            async def remove(
                original: MusicTransitionAnima = before, preservation_id: str = operation_id
            ) -> MusicRetirementResult:
                await asyncio.to_thread(
                    mutations.store.retain_transition_originals,
                    operation_id=preservation_id,
                    entry=None,
                    binding_facts=[asdict(original)],
                )
                await self._bindings.remove_music(user_id=user_id, before=original)
                return MusicRetirementResult(
                    original.anima_id,
                    tuple(binding.binding_id for binding in original.bindings),
                    original.loadout_revision + 1,
                    original.aggregate_revision + 1,
                    preservation_id,
                )

            results.append(
                await mutations.run(
                    user_id=user_id,
                    operation_id=operation_id,
                    request_digest=digest,
                    result_type=MusicRetirementResult,
                    action=remove,
                )
            )
        return tuple(results)
