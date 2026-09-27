"""Translate trusted local settings into the installation's HTTP components."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from animama.local.http.assets import LocalAssets, ModelFile, ModelMount
from animama.local.http.config import DesktopAccess, LocalHTTPConfig
from animama.local.http.telemetry import TelemetryConfig, TelemetryDestinations, TelemetryForwarder
from animama.server.config import Settings

_MAX_MODEL_MOUNT_BYTES = 4 * 1024 * 1024


def local_http_config(settings: Settings) -> LocalHTTPConfig:
    """Require both desktop credentials; a partial launch cannot weaken policy."""
    renderer, control = settings.animama_desktop_renderer_capability, settings.animama_desktop_control_token
    if (renderer is None) != (control is None):
        raise ValueError("Desktop HTTP requires both renderer and control credentials")
    desktop = DesktopAccess(renderer, control) if renderer is not None and control is not None else None
    return LocalHTTPConfig(public_origin=settings.animama_public_origin, desktop=desktop)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Model mount JSON contains duplicate fields")
        result[key] = value
    return result


def verified_model_mount(payload: str | None) -> ModelMount | None:
    """Read only the bounded inventory already verified by the desktop owner.

    This is private launch configuration, not a package upload or browser API.
    The supervisor verifies package digests before handing over exact paths and
    inventory; the asset responder retains its regular-file/size/range checks.
    """
    if payload is None:
        return None
    if len(payload.encode("utf-8")) > _MAX_MODEL_MOUNT_BYTES:
        raise ValueError("Model mount JSON exceeds its bounded configuration limit")
    try:
        value = json.loads(payload, object_pairs_hook=_unique_object)
        if not isinstance(value, dict) or set(value) != {"root", "version", "files"}:
            raise ValueError("Model mount requires exact root, version and files fields")
        if not isinstance(value["root"], str) or not Path(value["root"]).is_absolute():
            raise ValueError("Model mount root must be an absolute configured directory")
        if not isinstance(value["files"], list) or not value["files"]:
            raise ValueError("Model mount must inventory its files")
        files = []
        for item in value["files"]:
            if not isinstance(item, dict) or set(item) != {"path", "size_bytes", "sha256", "media_type"}:
                raise ValueError("Model file inventory contains unknown or missing fields")
            files.append(ModelFile(**item))
        return ModelMount(root=Path(value["root"]), version=value["version"], files=tuple(files))
    except (TypeError, RecursionError, UnicodeError) as error:
        raise ValueError("Model mount configuration is invalid") from error


def local_assets(settings: Settings) -> LocalAssets | None:
    """Development leaves build serving to Vite; built installations supply it."""
    mount = verified_model_mount(settings.animama_parakeet_model_mount_json)
    webgpu_mount = verified_model_mount(settings.animama_parakeet_webgpu_model_mount_json)
    if settings.animama_web_root is None:
        if mount is not None or webgpu_mount is not None:
            raise ValueError("A configured model mount requires the built application root")
        return None
    return LocalAssets(settings.animama_web_root, mount, webgpu_mount)


def local_telemetry(config: LocalHTTPConfig) -> TelemetryForwarder:
    """Keep desktop disabled and preserve the existing explicit web opt-outs."""

    def disabled(*names: str) -> bool:
        return any(os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"} for name in names)

    enabled = config.desktop is None and not disabled(
        "ANIMAMA_DISABLE_WEBUI_TELEMETRY", "NEXT_PUBLIC_ANIMAMA_DISABLE_WEBUI_TELEMETRY"
    )
    traces_enabled = not disabled("ANIMAMA_DISABLE_WEBUI_TRACES", "NEXT_PUBLIC_ANIMAMA_DISABLE_WEBUI_TRACES")

    def endpoint(signal: str) -> str:
        base = (
            os.getenv(f"OTEL_EXPORTER_OTLP_{signal.upper()}_ENDPOINT")
            or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
            or "http://otel-collector:4318"
        ).rstrip("/")
        return base if base.endswith(f"/v1/{signal}") else f"{base}/v1/{signal}"

    destinations = (
        TelemetryDestinations(**{signal: endpoint(signal) for signal in ("traces", "metrics", "logs")})
        if enabled
        else None
    )
    return TelemetryForwarder(
        TelemetryConfig(enabled=enabled, traces_enabled=traces_enabled, destinations=destinations)
    )
