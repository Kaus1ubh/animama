"""The shared-route test compositions behave as their consumers rely on (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import uuid4

import pytest
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima
from animama.product_http.ports import ReadSession, WriteSession
from animama.product_http.principal import get_current_principal
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app

Principal = Annotated[RequestPrincipal, Depends(get_current_principal)]


def anima_writer() -> APIRouter:
    """A probe handler that commits an owned Anima, then optionally fails."""

    router = APIRouter()

    @router.post("/probe/animas/{anima_id}")
    async def create(
        anima_id: str, session: WriteSession, principal: Principal, fail: bool = False, commit: bool = True
    ) -> dict[str, str]:
        session.add(ORMAnima(id=anima_id, user_id=principal.id))
        if commit:
            await session.commit()
        if fail:
            raise HTTPException(status_code=409, detail={"code": "probe_failed"})
        return {"owner": principal.id}

    return router


def anima_reader_that_writes() -> APIRouter:
    """A probe handler on a read session that wrongly writes an Anima."""

    router = APIRouter()

    @router.get("/probe/read-writes/{anima_id}")
    async def read(anima_id: str, session: ReadSession, principal: Principal, commit: bool = False) -> dict[str, str]:
        session.add(ORMAnima(id=anima_id, user_id=principal.id))
        if commit:
            await session.commit()
        else:
            await session.flush()
        return {"owner": principal.id}

    return router


async def stored_owner(factory: async_sessionmaker[AsyncSession], anima_id: str) -> str | None:
    async with factory() as session:
        row = await session.get(ORMAnima, anima_id)
        return row.user_id if row is not None else None


async def test_deferred_commit_completes_after_a_successful_handler(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(anima_writer(), ports=ports), tmp_path)
    anima_id = f"anima-{uuid4().hex}"
    async with composition.client("owner-a") as client:
        response = await client.post(f"/probe/animas/{anima_id}")
    assert response.status_code == 200
    assert (ports.commits_requested, ports.commits, ports.rollbacks) == (1, 1, 0)
    assert await stored_owner(async_session_factory, anima_id) == "owner-a"


async def test_deferred_commit_is_rolled_back_when_the_handler_fails_afterwards(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(anima_writer(), ports=ports), tmp_path)
    anima_id = f"anima-{uuid4().hex}"
    async with composition.client("owner-a") as client:
        response = await client.post(f"/probe/animas/{anima_id}", params={"fail": True})
    assert response.status_code == 409
    assert (ports.commits_requested, ports.commits, ports.rollbacks) == (1, 0, 1)
    assert await stored_owner(async_session_factory, anima_id) is None


async def test_uncommitted_work_is_rolled_back_when_the_session_ends(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(anima_writer(), ports=ports), tmp_path)
    anima_id = f"anima-{uuid4().hex}"
    async with composition.client("owner-a") as client:
        response = await client.post(f"/probe/animas/{anima_id}", params={"commit": False})
    assert response.status_code == 200
    assert (ports.commits_requested, ports.commits, ports.rollbacks) == (0, 0, 1)
    assert await stored_owner(async_session_factory, anima_id) is None


async def test_two_owner_clients_resolve_their_own_principal_and_root(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(anima_writer(), ports=ports), tmp_path)
    for owner in composition.owners:
        async with composition.client(owner) as client:
            response = await client.post(f"/probe/animas/anima-{uuid4().hex}")
        assert response.json() == {"owner": owner}
        assert composition.roots[owner].is_dir()
    assert composition.roots["owner-a"] != composition.roots["owner-b"]
    assert ports.owners == ["owner-a", "owner-b"]


@pytest.mark.parametrize("commit", [False, True])
async def test_a_read_session_refuses_to_write(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path, commit: bool
) -> None:
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(anima_reader_that_writes(), ports=ports), tmp_path)
    anima_id = f"anima-{uuid4().hex}"
    async with composition.client("owner-a") as client:
        with pytest.raises(AssertionError, match="a read session"):
            await client.get(f"/probe/read-writes/{anima_id}", params={"commit": commit})
    assert await stored_owner(async_session_factory, anima_id) is None
