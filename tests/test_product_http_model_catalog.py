"""Shared model catalog reads and model-role validation (ADR 0021, owner default 5)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy, ModelProviderCatalogService
from animama.orm.settings import ORMUserSettings
from animama.product_http.routes import model_catalog, settings
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, install_local_ports, product_app

CHAT = "OpenAIResponsesHTTPAgent:gpt-6-luna"
EMBEDDING = "OpenAIHTTPAgent:text-embedding-3-small"
ANTHROPIC = "AnthropicMessagesHTTPAgent:claude-haiku-5-5"
USER_SETTINGS = "/v1/users/me/settings"


async def _seed_builtins(session: AsyncSession) -> None:
    await ModelProviderCatalogService(
        model_providers=SQLAlchemyModelProviderRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    ).sync_from_registry()


def _owners() -> tuple[str, str]:
    return f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"


async def test_catalog_and_roles_are_read_only_and_resolve_each_owners_preferences(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with async_session_factory() as session:
        await _seed_builtins(session)
    ports = DeferredCommitPorts(
        async_session_factory, model_catalog_policy=ModelCatalogPolicy(owner_models_enabled=True)
    )
    owner_a, owner_b = _owners()
    app = product_app(model_catalog.router, settings.router, ports=ports)
    composition = TwoOwnerComposition(app, tmp_path, owners=(owner_a, owner_b))

    async with composition.client(owner_a) as a:
        assigned = {"preferences": {"models": {"embedding_model_provider_id": EMBEDDING}}}
        assert (await a.patch(USER_SETTINGS, json=assigned)).status_code == 200
        commits = ports.commits
        catalog = (await a.get("/v1/model-providers")).json()
        roles_a = (await a.get("/v1/model-roles")).json()
    async with composition.client(owner_b) as b:
        roles_b = (await b.get("/v1/model-roles")).json()

    # The port's policy decides the rows: here built-in OpenAI rows, not other built-in connections.
    listed = {row["id"] for row in catalog}
    assert CHAT in listed
    assert ANTHROPIC not in listed
    embeddings_a = next(role for role in roles_a["roles"] if role["role"] == "embeddings")
    assert (embeddings_a["source"], embeddings_a["model_provider_id"]) == ("owner", EMBEDDING)
    assert roles_a["embeddings_refresh"]["state"] == "current"
    # Owner a's assignment never reaches owner b.
    embeddings_b = next(role for role in roles_b["roles"] if role["role"] == "embeddings")
    assert (embeddings_b["source"], embeddings_b["model_provider_id"]) == ("off", None)
    assert roles_b["embeddings_refresh"] == {"state": "off", "pending": 0, "error_category": None}
    # The reads ran on read sessions (which refuse writes) and committed nothing.
    assert ports.commits == commits


async def test_a_validating_composition_refuses_role_preferences_its_catalog_cannot_serve(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    async with async_session_factory() as session:
        await _seed_builtins(session)
    ports = DeferredCommitPorts(
        async_session_factory, model_catalog_policy=ModelCatalogPolicy(validate_role_preferences=True)
    )
    owner, _ = _owners()
    composition = TwoOwnerComposition(product_app(settings.router, ports=ports), tmp_path, owners=(owner, "unused"))

    async with composition.client(owner) as client:
        refused = [
            # An embeddings row cannot do the utility role; a missing row cannot do any;
            # the default policy does not offer the built-in Anthropic connection's rows.
            await client.post(
                USER_SETTINGS, json={"preferences": {"models": {"utility_model_provider_id": EMBEDDING}}}
            ),
            await client.patch(
                USER_SETTINGS, json={"preferences": {"chat": {"default_model_provider_id": "missing:row"}}}
            ),
            await client.patch(USER_SETTINGS, json={"preferences": {"chat": {"default_model_provider_id": ANTHROPIC}}}),
        ]
        stored = await client.patch(
            USER_SETTINGS,
            json={
                "preferences": {
                    "chat": {"default_model_provider_id": CHAT},
                    "models": {"embedding_model_provider_id": EMBEDDING},
                }
            },
        )

    for response in refused:
        assert (response.status_code, response.json()) == (422, {"detail": {"code": "model_role_unavailable"}})
    assert stored.status_code == 200
    assert stored.json()["preferences"]["models"] == {"embedding_model_provider_id": EMBEDDING}
    # Only the usable assignment committed; the refused writes rolled back.
    assert (ports.commits, ports.settings_changes) == (1, [owner])


async def test_the_local_composition_stores_any_role_preference(async_session: AsyncSession, tmp_path: Path) -> None:
    owner, _ = _owners()
    app = product_app(settings.router, ports=None)
    app.state.model_catalog_policy = ModelCatalogPolicy.local()
    install_local_ports(app, async_session)
    composition = TwoOwnerComposition(app, tmp_path, owners=(owner, "unused"))

    async with composition.client(owner) as client:
        response = await client.patch(
            USER_SETTINGS, json={"preferences": {"models": {"utility_model_provider_id": "missing:row"}}}
        )

    # Locally an unusable assignment is kept and the role falls back when it resolves.
    assert response.status_code == 200
    row = (await async_session.execute(select(ORMUserSettings).where(ORMUserSettings.user_id == owner))).scalar_one()
    assert row.preferences == {"models": {"utility_model_provider_id": "missing:row"}}
