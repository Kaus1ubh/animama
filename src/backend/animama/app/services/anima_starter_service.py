"""Backend-owned starter specifications and conservative idempotent repair."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from animama.app.anima_creation_contract import AnimaSpec, EnsureAnimaStartersRequest, StarterRepair
from animama.app.ports.anima_creation_port import StarterReceipt
from animama.domain.anima_creation_error import AnimaCreationError, AnimaCreationIssue
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.content_catalog import ContentKind, ContentSource

from .anima_creation_service import AnimaCreationService
from .anima_creation_sources import item_ref, source_revisions
from .typed_content_service import TypedContentAdmissionError, TypedContentService


@dataclass(frozen=True, slots=True)
class StarterAnimaSpec:
    """Application configuration, not a template endpoint or portable descriptor."""

    id: str
    version: int
    display_name: str
    identity_markdown: str
    legacy_avatar_id: str
    avatar_locator: str
    legacy_profile_url: str

    @property
    def portrait_logical_key(self) -> str:
        """Shared optional-presentation contract for bootstrap and packaging."""

        return f"builtin:avatar-portrait:{PurePosixPath(self.avatar_locator).stem}"


# Version 1 retains the LF-normalized SQL seed text. Later versions may change
# defaults, but never rewrite a receipt or the historical adoption identifiers.
STARTER_ANIMA_SPECS = (
    StarterAnimaSpec(
        "starter:annie",
        1,
        "Annie",
        """
# Annie

## Appearance
Annie has short dark brown hair with soft reddish highlights, warm amber-brown
eyes, and a calm, attentive expression. She wears a cream cardigan with teal
ribbon accents over a black lace-trimmed top.

## Personality
- Friendly, curious, and conversational.
- Enjoys helping vague ideas become clear choices through natural back-and-forth.
- Stays attentive, warm, and honest about what she does or does not know.
""",
        "avt_sample_a1n",
        "avatars/AvatarSample_A_1_New.vrm",
        "/marine-pfp.png",
    ),
    StarterAnimaSpec(
        "starter:caitlyn",
        3,
        "Caitlyn",
        """
# Caitlyn

## Appearance
Caitlyn has a straight ash-brown bob with blunt bangs and a gentle expression.
She wears a simple blue top.

## Personality
- Imaginative, expressive, and idea-driven.
- Loves brainstorming options, remixing concepts, and finding fresh angles.
- Keeps creative energy collaborative instead of taking over the user's intent.
""",
        "avt_chibi_2",
        "avatars/AvatarSample_R1.vrm",
        "/korone-pfp.png",
    ),
)


class AnimaStarterService:
    """Commit each starter independently through the same private creation path."""

    def __init__(self, creation: AnimaCreationService) -> None:
        self.creation = creation
        self.receipts = creation.receipts
        self.uow = creation.uow

    async def ensure(self, *, user_id: str, request: EnsureAnimaStartersRequest) -> dict[str, Any]:
        repairs = {repair.starter_id: repair for repair in request.repairs}
        results = []
        for starter in STARTER_ANIMA_SPECS:
            try:
                result = await self._ensure_one(user_id=user_id, spec=starter, repair=repairs.get(starter.id))
                await self.uow.commit()
                results.append(result)
            except BaseException:
                # Earlier slots are intentionally durable; this slot's aggregate
                # and both kinds of receipt roll back together on any failure.
                await self.uow.rollback()
                raise
        return {
            "schema_version": 1,
            "complete": all(value["outcome"] != "repair_required" for value in results),
            "starters": results,
        }

    async def _ensure_one(
        self, *, user_id: str, spec: StarterAnimaSpec, repair: StarterRepair | None
    ) -> dict[str, Any]:
        await self.receipts.lock_operation(user_id=user_id, operation="starter_ensure", key=spec.id)
        receipt = await self.receipts.starter(user_id=user_id, starter_id=spec.id)
        if repair is not None and (receipt is None or receipt.state != "legacy_unresolved"):
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        "starter_repair_not_allowed",
                        "Repairs require a recorded unresolved legacy starter.",
                        "/repairs",
                    )
                ]
            )
        if receipt is not None and receipt.state in {"ready", "deleted"}:
            if receipt.state == "ready" and not await self.uow.animas.is_owned_by_user(
                user_id=user_id, anima_id=receipt.anima_id or ""
            ):
                # Also fence direct database deletion without resurrecting it.
                receipt = StarterReceipt(
                    spec.id, receipt.spec_version, "deleted", receipt.anima_id, receipt.diagnostics
                )
                await self.receipts.save_starter(user_id=user_id, receipt=receipt)
            return self._result(receipt, "deleted" if receipt.state == "deleted" else "existing")
        if repair is not None and repair.action == "adopt":
            await self._adopt(user_id=user_id, spec=spec, anima_id=repair.anima_id)
            return self._result(StarterReceipt(spec.id, spec.version, "ready", repair.anima_id, []), "adopted")
        if repair is None:
            if receipt is not None and receipt.diagnostics:
                return self._result(receipt, "repair_required")
            matches, partial = await self.receipts.legacy_candidates(
                user_id=user_id, avatar_id=spec.legacy_avatar_id, profile_url=spec.legacy_profile_url
            )
            if len(matches) == 1 and not partial:
                await self._adopt(user_id=user_id, spec=spec, anima_id=matches[0])
                return self._result(StarterReceipt(spec.id, spec.version, "ready", matches[0], []), "adopted")
            if receipt is not None or matches or partial:
                code = "starter_adoption_ambiguous" if matches or partial else "starter_legacy_missing"
                receipt = StarterReceipt(
                    spec.id,
                    spec.version,
                    "legacy_unresolved",
                    None,
                    [
                        AnimaCreationIssue(
                            code, "Explicit owner repair is required; no companion was recreated.", ""
                        ).as_dict()
                    ],
                )
                await self.receipts.save_starter(user_id=user_id, receipt=receipt)
                return self._result(receipt, "repair_required")
        command = await self._command(user_id=user_id, spec=spec)
        # A fresh internal key is safe because the stable starter lock/receipt is
        # this operation's retry authority, and both receipts commit together.
        result = await self.creation.create_in_uow(user_id=user_id, spec=command, key=f"starter-{uuid4()}")
        receipt = StarterReceipt(spec.id, spec.version, "ready", result["anima_id"], result["warnings"])
        await self.receipts.save_starter(user_id=user_id, receipt=receipt)
        return self._result(receipt, "created")

    async def _adopt(self, *, user_id: str, spec: StarterAnimaSpec, anima_id: str) -> None:
        try:
            await self.uow.animas.lock_definition(user_id=user_id, anima_id=anima_id)
        except AnimaDefinitionError as exc:
            raise AnimaCreationError(
                "anima_creation_source_unavailable",
                status=404,
                issues=[
                    AnimaCreationIssue("starter_anima_unavailable", "The requested Anima is unavailable.", "/repairs")
                ],
            ) from exc
        mapped = await self.receipts.mapped_starter(user_id=user_id, anima_id=anima_id)
        if mapped is not None and mapped != spec.id:
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        "starter_anima_already_adopted",
                        "This Anima already belongs to another starter slot.",
                        "/repairs",
                    )
                ]
            )
        await self.receipts.save_starter(
            user_id=user_id, receipt=StarterReceipt(spec.id, spec.version, "ready", anima_id, [])
        )

    async def _command(self, *, user_id: str, spec: StarterAnimaSpec) -> AnimaSpec:
        """Resolve current Included content, never frontend URLs or mutable templates."""

        sources = self.creation.sources
        options = await sources.options(user_id=user_id)
        if options["diagnostics"]:
            raise AnimaCreationError(
                "anima_creation_defaults_unavailable",
                status=503,
                retryable=True,
                message="The complete Recommended Starter Pack is unavailable.",
            )
        visible = {item.id: item for item in await sources.catalog.list_visible(user_id=user_id)}
        avatars = [
            item
            for item in visible.values()
            if item.source is ContentSource.INCLUDED
            and item.kind is ContentKind.AVATAR
            and item.relative_locator == spec.avatar_locator
        ]
        if len(avatars) != 1:
            raise AnimaCreationError(
                "anima_creation_defaults_unavailable",
                status=503,
                retryable=True,
                message="The Included starter Avatar is unavailable.",
            )
        avatar = avatars[0]
        try:
            closure = TypedContentService.resolve_closure(item_id=avatar.id, visible=visible)
        except TypedContentAdmissionError as exc:
            raise AnimaCreationError(
                "anima_creation_defaults_unavailable",
                status=503,
                retryable=True,
                message="The Included starter Avatar needs repair.",
            ) from exc
        revisions = {
            **options["expected_source_revisions"],
            **source_revisions({item.item.id: item for item in closure}),
        }
        profile = None
        portrait = sources._included(visible, key=spec.portrait_logical_key, kind=ContentKind.APPEARANCE)
        if portrait is not None:
            try:
                closure = TypedContentService.resolve_closure(item_id=portrait.id, visible=visible)
                await sources._validate_media(portrait, ("/appearance/profile", None))
            except (TypedContentAdmissionError, AnimaCreationError):
                # A registered optional portrait is usable only when valid. Null
                # carries the normal explicit profile warning in the receipt.
                pass
            else:
                revisions.update(source_revisions({item.item.id: item for item in closure}))
                profile = {
                    "source": item_ref(portrait),
                    "presentation": {"fit": "cover", "focal_x": 0.5, "focal_y": 0.5, "zoom": 1},
                }
        return AnimaSpec.model_validate(
            {
                "schema_version": 1,
                "display_name": spec.display_name,
                "identity_markdown": spec.identity_markdown,
                "avatar": item_ref(avatar),
                "appearance": {"profile": profile, "background": None},
                **options["recommended"],
                "starter_pack": options["starter_pack"],
                "expected_source_revisions": revisions,
            }
        )

    @staticmethod
    def _result(receipt: StarterReceipt, outcome: str) -> dict[str, Any]:
        return {
            "starter_id": receipt.starter_id,
            "spec_version": receipt.spec_version,
            "anima_id": receipt.anima_id,
            "outcome": outcome,
            "diagnostics": receipt.diagnostics,
        }
