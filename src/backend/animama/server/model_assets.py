"""Local composition of the shared model-asset downloader.

One service per application owns the packaged catalog, the store beneath the
installation data root (desktop ``<userData>/data``, Compose
``/var/lib/animama/data``) and the production-only release fetcher. Consumers
that must veto removal register guards in ``_build_service``. Tests inject a
fixture service with a dependency override on ``get_model_asset_service``.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request

from animama.adapters.model_assets import FilesystemModelAssetStore, HttpAssetFetcher
from animama.app.services.model_asset_service import ModelAssetService, load_packaged_asset_catalog
from animama.server.config import Settings, settings


def _data_root(application: FastAPI) -> Path:
    # The same configured root that local runtime paths resolve beneath.
    runtime_settings: Settings = getattr(application.state, "runtime_settings", settings)
    return runtime_settings.animama_data_root


def _build_service(application: FastAPI) -> ModelAssetService:
    # Register consumer removal guards here, e.g. voices in use by an Anima.
    return ModelAssetService(
        load_packaged_asset_catalog(),
        FilesystemModelAssetStore(_data_root(application)),
        HttpAssetFetcher(),
    )


def model_asset_service_for(application: FastAPI) -> ModelAssetService:
    """Return the application's service, creating it (and clearing staging) once."""

    service = getattr(application.state, "model_asset_service", None)
    if service is None:
        service = _build_service(application)
        application.state.model_asset_service = service
    return service


def get_model_asset_service(request: Request) -> ModelAssetService:
    """FastAPI dependency for the application's model-asset service."""

    return model_asset_service_for(request.app)


async def close_model_asset_service(application: FastAPI) -> None:
    """Cancel in-flight downloads at shutdown; staging is discarded."""

    service = getattr(application.state, "model_asset_service", None)
    if service is not None:
        await service.aclose()
