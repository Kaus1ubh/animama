"""Local composition of the shared model-asset downloader.

One service per application owns the packaged catalog, the store beneath the
installation data root (desktop ``<userData>/data``, Compose
``/var/lib/animama/data``) and the production-only release fetcher. Consumers
that must veto removal register guards in ``_build_service``. Tests inject a
fixture service with a dependency override on ``get_model_asset_service`` (or
``application.state.model_asset_service``).

This module also adapts installed speech-to-text sets (Parakeet and SenseVoice)
to the local HTTP responder and reports their availability, both resolved per
request.
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
from animama.local.http.assets import (
    PARAKEET_MOUNT,
    PARAKEET_WEBGPU_MOUNT,
    SENSEVOICE_MOUNT,
    SENSEVOICE_WEBGPU_MOUNT,
    ModelFile,
    ModelMount,
)
from animama.server.config import Settings, settings

# Catalog IDs of the speech-to-text sets served at the browser's model paths.
PARAKEET_ASSET_ID: Final = "parakeet-stt"
PARAKEET_WEBGPU_ASSET_ID: Final = "parakeet-stt-webgpu"
SENSEVOICE_ASSET_ID: Final = "sensevoice-stt"
SENSEVOICE_WEBGPU_ASSET_ID: Final = "sensevoice-stt-webgpu"
_SPEECH_MOUNT_ASSETS: Final = {
    PARAKEET_MOUNT: PARAKEET_ASSET_ID,
    PARAKEET_WEBGPU_MOUNT: PARAKEET_WEBGPU_ASSET_ID,
    SENSEVOICE_MOUNT: SENSEVOICE_ASSET_ID,
    SENSEVOICE_WEBGPU_MOUNT: SENSEVOICE_WEBGPU_ASSET_ID,
}


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
    """A ``ModelMountSource`` serving installed speech-to-text sets from the asset store.

    Each request reads the current install state, so an install or removal
    applies without restarting FastAPI. The mount version is the set's
    manifest digest, which the browser pins with ``?v=``.
    """

    def __init__(self, application: FastAPI) -> None:
        self._application = application

    def mount(self, path: str) -> ModelMount | None:
        asset_id = _SPEECH_MOUNT_ASSETS.get(path)
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
class SpeechAvailability:
    """One speech-to-text engine's offline availability for runtime capabilities."""

    enabled: bool
    asset_version: str | None
    gpu_asset_version: str | None


def _speech_availability(
    application: FastAPI, runtime_settings: Settings, *, enabled: bool, asset_id: str, gpu_asset_id: str
) -> SpeechAvailability:
    """Resolve an engine's sets from the composition's speech model source.

    The operator flag always gates availability. The ``operator`` source has no
    versions (development Vite serves the host sets); ``asset-store`` requires
    an installed base set and reports installed manifest digests, read on every
    call.
    """

    if runtime_settings.animama_parakeet_source == "operator":
        return SpeechAvailability(enabled=enabled, asset_version=None, gpu_asset_version=None)
    version = _installed_version(application, asset_id)
    return SpeechAvailability(
        enabled=enabled and version is not None,
        asset_version=version,
        gpu_asset_version=_installed_version(application, gpu_asset_id),
    )


def parakeet_availability(application: FastAPI, runtime_settings: Settings) -> SpeechAvailability:
    """Offline English speech recognition (Parakeet)."""

    return _speech_availability(
        application,
        runtime_settings,
        enabled=runtime_settings.animama_parakeet_stt_enabled,
        asset_id=PARAKEET_ASSET_ID,
        gpu_asset_id=PARAKEET_WEBGPU_ASSET_ID,
    )


def sensevoice_availability(application: FastAPI, runtime_settings: Settings) -> SpeechAvailability:
    """Offline multilingual speech recognition (SenseVoice-Small)."""

    return _speech_availability(
        application,
        runtime_settings,
        enabled=runtime_settings.animama_sensevoice_stt_enabled,
        asset_id=SENSEVOICE_ASSET_ID,
        gpu_asset_id=SENSEVOICE_WEBGPU_ASSET_ID,
    )
