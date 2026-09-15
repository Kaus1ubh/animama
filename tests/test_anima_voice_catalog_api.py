from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from sqlalchemy import delete

from animama.domain.request_principal import RequestPrincipal
from animama.orm.avatar_upload import ORMAvatarUpload
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers.anima import router
from tests.local_http_client import local_client


def _voice_catalog() -> bytes:
    name = b"neutral" + b"\x00" * (32 - len("neutral"))
    return (
        (1).to_bytes(4, byteorder="little", signed=False)
        + name
        + (1).to_bytes(4, byteorder="little", signed=False)
        + (1024).to_bytes(4, byteorder="little", signed=False)
        + b"\x00" * (1024 * 4)
    )


async def test_voice_catalog_upload_publishes_readable_local_file(async_session, tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(settings, "animama_content_root", tmp_path / "content")
    monkeypatch.setattr(settings, "animama_data_root", tmp_path / "data")
    payload = _voice_catalog()

    app = FastAPI()
    app.include_router(router)

    async def override_user() -> RequestPrincipal:
        return RequestPrincipal(id="voice-owner")

    async def override_session():  # noqa: ANN202
        yield async_session

    app.dependency_overrides[get_current_principal] = override_user
    app.dependency_overrides[get_async_session] = override_session
    client = local_client(app)
    try:
        initialized = await client.post(
            "/v1/animas/voice-catalogs/uploads",
            json={
                "filename": "Mika Voice.bin",
                "content_type": "application/octet-stream",
                "size_bytes": len(payload),
            },
        )
        assert initialized.status_code == 200, initialized.text
        init = initialized.json()
        assert init["upload_url"].startswith("/v1/animas/voice-catalogs/uploads/")

        uploaded = await client.put(
            init["upload_url"],
            content=payload,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert uploaded.status_code == 204, uploaded.text

        finalized = await client.post(f"/v1/animas/voice-catalogs/uploads/{init['upload_id']}:finalize")
        assert finalized.status_code == 200, finalized.text
        item = finalized.json()["item"]
        assert item["kind"] == "voice"
        assert item["relative_locator"] == "voices/mika-voice.bin"
        assert item["status"] == "valid"
        assert (tmp_path / "content/local/voices/mika-voice.bin").read_bytes() == payload
        assert (tmp_path / "content/local/voices/mika-voice.meta.json").is_file()
        assert not list((tmp_path / "data/staging/uploads").glob("**/*.bin"))
    finally:
        await client.aclose()
        await async_session.execute(delete(ORMAvatarUpload).where(ORMAvatarUpload.user_id == "voice-owner"))
        await async_session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == "voice-owner")
        )
        await async_session.commit()
