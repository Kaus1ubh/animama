"""The shared capability route reports what the composition offers each owner (ADR 0021)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.routes import runtime_capabilities
from animama.server.user_file_processing import get_user_file_processing_runner
from tests.product_http_support import HOSTED_CAPABILITIES, DeferredCommitPorts, TwoOwnerComposition, product_app


@dataclass
class PerOwnerCapabilityPorts(DeferredCommitPorts):
    """A composition that admits chat uploads for one owner only."""

    uploads_for: str = ""
    asked: list[str] = field(default_factory=list)

    async def runtime_capabilities(self, session: AsyncSession, principal: RequestPrincipal) -> RuntimeCapabilities:
        self.asked.append(principal.id)
        return HOSTED_CAPABILITIES.model_copy(update={"chat_file_uploads": principal.id == self.uploads_for})


async def test_each_owner_gets_the_compositions_answer_for_that_owner(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    ports = PerOwnerCapabilityPorts(async_session_factory, uploads_for=owner_a)
    app = product_app(runtime_capabilities.router, ports=ports)
    composition = TwoOwnerComposition(app, tmp_path, owners=(owner_a, owner_b))

    views: dict[str, RuntimeCapabilities] = {}
    for owner in composition.owners:
        async with composition.client(owner) as client:
            response = await client.get("/v1/runtime-capabilities")
            assert response.status_code == 200, response.text
            views[owner] = RuntimeCapabilities.model_validate(response.json())

    assert views[owner_a] == HOSTED_CAPABILITIES.model_copy(update={"chat_file_uploads": True})
    assert views[owner_b] == HOSTED_CAPABILITIES
    # Each owner's answer came from that owner's own read session and committed nothing.
    assert ports.asked == ports.owners == [owner_a, owner_b]
    assert ports.commits == ports.commits_requested == 0


async def test_hosted_composition_keeps_upload_processing_off_and_runs_no_processor(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    """In-server processing is local only: hosted reports what it reported before (spec R1.8)."""

    app = product_app(runtime_capabilities.router, ports=DeferredCommitPorts(async_session_factory))
    composition = TwoOwnerComposition(app, tmp_path)

    async with app.router.lifespan_context(app):
        async with composition.client(composition.owners[0]) as client:
            response = await client.get("/v1/runtime-capabilities")
        assert get_user_file_processing_runner(app) is None

    assert response.status_code == 200, response.text
    assert response.json()["user_file_processing"] == {
        "enabled": False,
        "worker_state": "disabled",
        "last_heartbeat_at": None,
        "pack_id": None,
        "supported_extensions": [],
    }
