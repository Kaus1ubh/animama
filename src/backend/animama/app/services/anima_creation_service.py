"""Atomic, owner-scoped private creation with durable replay before validation."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from animama.app.anima_creation_contract import AnimaSpec, CreateAnimaRequest, canonical_spec_hash
from animama.app.chat.api_standard import chat_api_standard_for_provider
from animama.app.ports.anima_aggregate_port import AnimaAggregateUnitOfWork
from animama.app.ports.anima_creation_port import AnimaCreationRepository, CreationReceipt
from animama.domain.anima_creation_error import AnimaCreationError, AnimaCreationIssue
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import AnimaLoadoutError

from .anima_aggregate_materializer import AnimaAggregateMaterializer
from .anima_creation_sources import AnimaCreationSources


class AnimaCreationService:
    """The command owns commit; the materializer and repositories never do."""

    def __init__(
        self,
        *,
        uow: AnimaAggregateUnitOfWork,
        receipts: AnimaCreationRepository,
        sources: AnimaCreationSources,
        default_model_provider_id: str,
        preferred_model_provider_id: Callable[[str], Awaitable[str | None]] | None = None,
    ) -> None:
        self.uow = uow
        self.receipts = receipts
        self.sources = sources
        self.default_model_provider_id = default_model_provider_id
        # Reads the owner's App Settings default chat model for new Animas.
        self.preferred_model_provider_id = preferred_model_provider_id
        self.materializer = AnimaAggregateMaterializer(
            default_model_provider_id=default_model_provider_id, max_identity_bytes=sources.max_identity_bytes
        )

    async def _defaults(self, *, for_update: bool = False) -> None:
        model = await self.uow.model_providers.get(self.default_model_provider_id, for_update=for_update)
        if model is None or not model.active:
            raise AnimaCreationError(
                "anima_creation_defaults_unavailable",
                status=503,
                retryable=True,
                message="The installation's configured model is unavailable.",
            )

    async def _model_provider_id(self, *, user_id: str, for_update: bool = False) -> str:
        """The owner's preferred model when it is known and active, else the default.

        An unavailable or non-chat preference never blocks creation; it falls back to the
        installation's configured model, which ``_defaults`` requires.
        """

        preferred = await self.preferred_model_provider_id(user_id) if self.preferred_model_provider_id else None
        if preferred:
            model = await self.uow.model_providers.get(preferred, for_update=for_update)
            # Only models that direct chat supports; others would fail the
            # new Anima's first turn with chat_api_standard_unsupported.
            if model is not None and model.active and chat_api_standard_for_provider(model) is not None:
                return preferred
        return self.default_model_provider_id

    async def validate(self, *, user_id: str, spec: AnimaSpec) -> dict[str, Any]:
        """Read-only preflight; it neither reserves a key nor creates runtime."""

        try:
            resolved = await self.sources.resolve(user_id=user_id, spec=spec)
            await self._defaults()
        except AnimaDefinitionError as exc:
            raise self._definition_error(exc) from exc
        return {"schema_version": 1, "spec": spec.model_dump(mode="json"), "warnings": resolved.warnings}

    async def create(self, *, user_id: str, request: CreateAnimaRequest) -> dict[str, Any]:
        """Commit one complete aggregate/receipt, or release the key on failure."""

        try:
            result = await self.create_in_uow(user_id=user_id, spec=request.spec(), key=request.idempotency_key)
            await self.uow.commit()
            return result
        except BaseException:
            await self.uow.rollback()
            raise

    async def create_in_uow(self, *, user_id: str, spec: AnimaSpec, key: str) -> dict[str, Any]:
        """Share the private command with starter receipt transactions; do not commit."""

        digest = canonical_spec_hash(spec)
        await self.receipts.lock_operation(user_id=user_id, operation="live_anima_create_v1", key=key)
        receipt = await self.receipts.receipt(user_id=user_id, key=key)
        if receipt is not None:
            if receipt.spec_sha256 != digest:
                raise AnimaCreationError(
                    "idempotency_key_reused",
                    status=409,
                    message="This key already belongs to a different creation request.",
                )
            if receipt.deleted or not await self.uow.animas.is_owned_by_user(
                user_id=user_id, anima_id=receipt.anima_id
            ):
                raise AnimaCreationError(
                    "creation_result_deleted", status=410, message="The original Anima was deleted."
                )
            return {**receipt.result, "idempotent_replay": True}
        # Lock the submitted set before materializing. An incomplete/extra map
        # fails validation; it never broadens the admitted selection.
        await self.sources.catalog.lock_items(user_id=user_id, item_ids=tuple(sorted(spec.expected_source_revisions)))
        try:
            resolved = await self.sources.resolve(user_id=user_id, spec=spec)
            await self._defaults(for_update=True)
            model_provider_id = await self._model_provider_id(user_id=user_id, for_update=True)
            anima = await self.materializer.materialize(
                user_id=user_id, spec=resolved.resolved, uow=self.uow, model_provider_id=model_provider_id
            )
            result = {
                "schema_version": 1,
                "anima_id": anima.id,
                "aggregate_revision": 1,
                "identity_version": 1,
                "loadout_revision": 1,
                "idempotent_replay": False,
                "warnings": resolved.warnings,
            }
            await self.receipts.save_receipt(
                user_id=user_id, key=key, receipt=CreationReceipt(digest, anima.id, result)
            )
            # Physical host edits cannot participate in SQL locks. Verify all
            # registered bytes and complete source facts after the last write.
            await self.sources.resolve(user_id=user_id, spec=spec)
            await self._defaults(for_update=True)
        except AnimaDefinitionError as exc:
            raise self._definition_error(exc) from exc
        except AnimaLoadoutError as exc:
            stale = exc.code == "loadout_source_stale"
            raise AnimaCreationError(
                "anima_creation_sources_stale" if stale else "anima_creation_invalid",
                status=409 if stale else 422,
                retryable=stale,
                issues=[AnimaCreationIssue(exc.code, "The exact typed loadout could not be created.", "")],
            ) from exc
        return result

    @staticmethod
    def _definition_error(exc: AnimaDefinitionError) -> AnimaCreationError:
        if exc.code == "anima_model_provider_unavailable":
            return AnimaCreationError(
                "anima_creation_defaults_unavailable",
                status=503,
                retryable=True,
                message="The installation's configured model is unavailable.",
            )
        return AnimaCreationError(
            issues=[
                AnimaCreationIssue(
                    exc.code, "The identity does not satisfy the installation's limits.", "/identity_markdown"
                )
            ]
        )
