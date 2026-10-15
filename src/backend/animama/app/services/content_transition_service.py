"""Run the known content transitions after a rescan, under mutation authority."""

from __future__ import annotations

from animama.app.ports.content_transition import ContentTransitionBindings
from animama.app.services.avatar_effect_merge_transition import AvatarEffectMergeTransitionService
from animama.app.services.avatar_effect_transition import AvatarEffectTransitionService
from animama.app.services.content_catalog_service import ContentCatalogService, ContentRescanResult
from animama.app.services.music_retirement_service import MusicRetirementService
from animama.domain.content_catalog import ContentStatus


class ContentTransitionService:
    """Convert only the known local content transition under mutation authority."""

    def __init__(self, *, content: ContentCatalogService, bindings: ContentTransitionBindings) -> None:
        self._content = content
        self._bindings = bindings

    async def transition(self, *, user_id: str, include_included: bool = True) -> ContentRescanResult:
        """Preserve existing content before exposing the supported product catalog."""
        scanned = await self._content.rescan(user_id=user_id, include_included=include_included)
        # Action conversions rescan Local. Reapply already diagnosed source
        # failures afterward so a successful peer cannot erase a repair result.
        failures = [
            (item, item.diagnostics[0].code)
            for item in scanned.items
            if item.status is ContentStatus.INVALID and item.diagnostics
        ]
        failures.extend(await AvatarEffectTransitionService(content=self._content).convert(user_id=user_id))
        await AvatarEffectMergeTransitionService(content=self._content).convert(user_id=user_id)
        await MusicRetirementService(content=self._content, bindings=self._bindings).retire(user_id=user_id)
        catalog = self._content.mutations.catalog
        for item, code in failures:
            await catalog.record_transition_failure(
                user_id=user_id, item_id=item.id, expected_revision=item.revision_sha256 or "", code=code
            )
        return await self._content.visible_scan_result(scanned.summaries, user_id=user_id)
