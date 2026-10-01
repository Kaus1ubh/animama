"""Local composition of the shared model-asset downloader.

One service per application owns the packaged catalog, the store beneath the
installation data root (desktop ``<userData>/data``, Compose
``/var/lib/animama/data``) and the production-only release fetcher. Consumers
that must veto removal register guards in ``_build_service``. Tests inject a
fixture service with a dependency override on ``get_model_asset_service`` (or
``application.state.model_asset_service``).

This module also adapts installed Parakeet sets to the local HTTP responder and
reports their availability, both resolved per request.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final

from fastapi import FastAPI, Request

from animama.adapters.model_assets import FilesystemModelAssetStore, HttpAssetFetcher
from animama.app.services.model_asset_service import (
    ModelAssetService,
    UnknownAssetError,
    load_packaged_asset_catalog,
)
from animama.local.http.assets import PARAKEET_MOUNT, PARAKEET_WEBGPU_MOUNT, ModelFile, ModelMount
from animama.server.config import Settings, settings

# Catalog IDs of the Parakeet sets served at the browser's existing model paths.
PARAKEET_ASSET_ID: Final = "parakeet-stt"
PARAKEET_WEBGPU_ASSET_ID: Final = "parakeet-stt-webgpu"
_PARAKEET_MOUNT_ASSETS: Final = {PARAKEET_MOUNT: PARAKEET_ASSET_ID, PARAKEET_WEBGPU_MOUNT: PARAKEET_WEBGPU_ASSET_ID}


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
    """Return the application's service, creating it (and pruning stored data) once."""

    service = getattr(application.state, "model_asset_service", None)
    if service is None:
        service = _build_service(application)
        application.state.model_asset_service = service
    return service


def get_model_asset_service(request: Request) -> ModelAssetService:
    """FastAPI dependency for the application's model-asset service."""

    return model_asset_service_for(request.app)


async def close_model_asset_service(application: FastAPI) -> None:
    """Cancel in-flight downloads at shutdown; staged bytes are kept for resume."""

    service = getattr(application.state, "model_asset_service", None)
    if service is not None:
        await service.aclose()


def _installed_version(application: FastAPI, asset_id: str) -> str | None:
    try:
        return model_asset_service_for(application).installed_version(asset_id)
    except UnknownAssetError:
        return None


class AssetStoreModelMounts:
    """A ``ModelMountSource`` serving installed Parakeet sets from the asset store.

    Each request reads the current install state, so an install or removal
    applies without restarting FastAPI. The mount version is the set's
    manifest digest, which the browser pins with ``?v=``.
    """

    def __init__(self, application: FastAPI) -> None:
        self._application = application

    def mount(self, path: str) -> ModelMount | None:
        asset_id = _PARAKEET_MOUNT_ASSETS.get(path)
        if asset_id is None:
            return None
        try:
            installed = model_asset_service_for(self._application).installed_set(asset_id)
        except UnknownAssetError:
            return None
        if installed is None:
            return None
        files = tuple(ModelFile(file.path, file.size, file.sha256, file.media_type) for file in installed.files)
        return ModelMount(installed.root, installed.version, files)


@dataclass(frozen=True, slots=True)
class ParakeetAvailability:
    """Offline speech availability for runtime capabilities."""

    enabled: bool
    asset_version: str | None
    gpu_asset_version: str | None


def parakeet_availability(application: FastAPI, runtime_settings: Settings) -> ParakeetAvailability:
    """Resolve offline speech from the composition's Parakeet source.

    The operator flag always gates availability. The ``operator`` source reports
    its launch versions; ``asset-store`` requires an installed base set and
    reports installed manifest digests, read on every call.
    """

    if runtime_settings.animama_parakeet_source == "operator":
        return ParakeetAvailability(
            enabled=runtime_settings.animama_parakeet_stt_enabled,
            asset_version=runtime_settings.animama_parakeet_asset_version,
            gpu_asset_version=runtime_settings.animama_parakeet_webgpu_asset_version,
        )
    version = _installed_version(application, PARAKEET_ASSET_ID)
    return ParakeetAvailability(
        enabled=runtime_settings.animama_parakeet_stt_enabled and version is not None,
        asset_version=version,
        gpu_asset_version=_installed_version(application, PARAKEET_WEBGPU_ASSET_ID),
    )
