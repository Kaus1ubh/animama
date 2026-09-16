"""Shared accountless Locust helpers that exercise the local application origin."""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from locust import HttpUser, between


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or not value.strip() else value.strip()


def truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


ANIMAMA_ORIGIN = _env(
    "LOADTEST_ANIMAMA_ORIGIN",
    _env("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:8000"),
).rstrip("/")
INCOGNITO = truthy(_env("LOADTEST_INCOGNITO", "1"))


def request_headers(*, mutation: bool = False) -> dict[str, str]:
    """Return browser metadata accepted by the local accountless gateway."""

    headers = {
        "Origin": ANIMAMA_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
    }
    if mutation:
        headers["X-Animama-CSRF"] = "1"
    return headers


def format_failure(resp, *, prefix: str) -> str:  # noqa: ANN001
    """Keep load-test failures useful without echoing private response bodies."""

    status = getattr(resp, "status_code", None)
    retry_after = None
    try:
        retry_after = resp.headers.get("retry-after") or resp.headers.get("x-retry-after")
    except Exception:
        pass
    code = None
    try:
        payload = resp.json()
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if isinstance(detail, dict) and isinstance(detail.get("code"), str):
            code = detail["code"][:128]
    except Exception:
        pass
    return f"{prefix}_{status} code={code} retry_after={retry_after}"


def _response_json(resp, *, operation: str) -> dict[str, Any]:  # noqa: ANN001
    try:
        payload = resp.json()
    except Exception as exc:
        raise RuntimeError(f"{operation} returned non-JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{operation} returned an unexpected response")
    return payload


def _source_roots(options: dict[str, Any], avatar: dict[str, Any]) -> list[dict[str, Any]]:
    roots: list[dict[str, Any]] = [
        {
            "kind": "avatar",
            "source": {
                "item_id": avatar["item_id"],
                "revision_sha256": avatar["revision_sha256"],
            },
        }
    ]
    recommended = options.get("recommended")
    if not isinstance(recommended, dict):
        raise RuntimeError("creation options omitted recommended content")
    for gesture in recommended.get("gestures") or []:
        if isinstance(gesture, dict) and isinstance(gesture.get("source"), dict):
            roots.append({"kind": "gesture", "source": gesture["source"]})
    reactions = recommended.get("reactions")
    if isinstance(reactions, dict):
        for cells in reactions.values():
            if not isinstance(cells, dict):
                continue
            for source in cells.values():
                if isinstance(source, dict):
                    roots.append({"kind": "reaction", "source": source})
    default_idle = options.get("default_idle")
    if isinstance(default_idle, dict) and isinstance(default_idle.get("source"), dict):
        roots.append({"kind": "idle_style", "source": default_idle["source"]})

    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for root in roots:
        source = root["source"]
        key = (root["kind"], source["item_id"], source["revision_sha256"])
        unique[key] = root
    return list(unique.values())


def load_creation_template(client) -> dict[str, Any]:  # noqa: ANN001
    """Resolve one current catalog-backed creation template through the application origin."""

    with client.get(
        "/v1/animas/creation-options",
        headers=request_headers(),
        name="/v1/animas/creation-options (setup)",
        catch_response=True,
        timeout=60,
    ) as response:
        if not 200 <= response.status_code < 300:
            response.failure(format_failure(response, prefix="creation_options_http"))
            raise RuntimeError("creation options unavailable")
        options = _response_json(response, operation="creation options")
        response.success()

    with client.get(
        "/v1/avatar-content",
        headers=request_headers(),
        name="/v1/avatar-content (setup)",
        catch_response=True,
        timeout=60,
    ) as response:
        if not 200 <= response.status_code < 300:
            response.failure(format_failure(response, prefix="avatar_catalog_http"))
            raise RuntimeError("avatar catalog unavailable")
        page = _response_json(response, operation="avatar catalog")
        items = page.get("items")
        if not isinstance(items, list) or not items or not isinstance(items[0], dict):
            response.failure("avatar_catalog_empty")
            raise RuntimeError("avatar catalog is empty")
        avatar = items[0]
        response.success()

    roots = _source_roots(options, avatar)
    with client.post(
        "/v1/content/evidence:resolve",
        json={"schema_version": 1, "roots": roots},
        headers=request_headers(mutation=True),
        name="/v1/content/evidence:resolve (setup)",
        catch_response=True,
        timeout=60,
    ) as response:
        if not 200 <= response.status_code < 300:
            response.failure(format_failure(response, prefix="content_evidence_http"))
            raise RuntimeError("content evidence unavailable")
        evidence = _response_json(response, operation="content evidence")
        if evidence.get("complete") is not True:
            response.failure("content_evidence_incomplete")
            raise RuntimeError("content evidence is incomplete")
        response.success()

    recommended = options["recommended"]
    return {
        "schema_version": 1,
        "display_name": "Load Test Anima",
        "identity_markdown": "# Load Test Anima\n\nA deterministic companion used for local performance checks.\n",
        "avatar": {
            "item_id": avatar["item_id"],
            "revision_sha256": avatar["revision_sha256"],
        },
        "appearance": {"profile": None, "background": None},
        "gestures": recommended["gestures"],
        "reactions": recommended["reactions"],
        "starter_pack": options["starter_pack"],
        "expected_source_revisions": evidence["combined_expected_source_revisions"],
    }


def anima_create_payload(template: dict[str, Any]) -> dict[str, Any]:
    payload = deepcopy(template)
    suffix = uuid.uuid4().hex
    payload["display_name"] = f"Load Test {suffix[:8]}"
    payload["idempotency_key"] = f"loadtest-{suffix}"
    return payload


def chat_payload(*, runtime_revision: str) -> dict[str, Any]:
    dispatch_options = None
    if INCOGNITO:
        dispatch_options = {
            "incognito": True,
            "disable_memory_updates": True,
            "disable_memory_influence": True,
            "disable_emotion_updates": True,
            "disable_emotion_influence": True,
        }
    return {
        "message": "Hello from the accountless gateway load test.",
        "run_id": f"run-{uuid.uuid4().hex}",
        "runtime_revision": runtime_revision,
        "dispatch_options": dispatch_options,
    }


class AccountlessAnimaUser(HttpUser):
    """Base Locust user admitted through the same local gateway as React."""

    abstract = True
    host = ANIMAMA_ORIGIN
    wait_time = between(0.2, 1.0)

    def on_start(self) -> None:
        with self.client.post(
            "/v1/runtime/bootstrap:ensure",
            headers=request_headers(mutation=True),
            name="/v1/runtime/bootstrap:ensure (setup)",
            catch_response=True,
            timeout=60,
        ) as response:
            if not 200 <= response.status_code < 300:
                response.failure(format_failure(response, prefix="bootstrap_http"))
                raise RuntimeError("accountless bootstrap failed")
            response.success()


def stream_sse_until_completed(
    resp,  # noqa: ANN001
    *,
    on_event: Callable[[str, dict[str, Any] | None, str | None], None] | None = None,
) -> tuple[bool, str | None, float, dict[str, Any] | None]:
    """Consume an SSE response until `run.completed` or a terminal error."""

    start = time.perf_counter()
    event_type: str | None = None
    event_data: dict[str, Any] | None = None
    event_data_raw: str | None = None
    completed = False

    for raw in resp.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        line = raw.strip()
        if not line:
            if on_event and event_type:
                on_event(event_type, event_data, event_data_raw)
            if event_type == "run.completed":
                completed = True
                break
            if event_type == "error":
                break
            event_type = None
            event_data = None
            event_data_raw = None
            continue
        if line.startswith("event:"):
            event_type = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            event_data_raw = line.split(":", 1)[1].strip()
            try:
                decoded = json.loads(event_data_raw) if event_data_raw else None
                event_data = decoded if isinstance(decoded, dict) else None
            except Exception:
                event_data = None

    return completed, event_type, time.perf_counter() - start, event_data


__all__ = [
    "ANIMAMA_ORIGIN",
    "AccountlessAnimaUser",
    "anima_create_payload",
    "chat_payload",
    "format_failure",
    "load_creation_template",
    "request_headers",
    "stream_sse_until_completed",
    "truthy",
]
