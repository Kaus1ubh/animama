from __future__ import annotations

import json
import logging
import os

from loadtest.common import (
    AccountlessAnimaUser,
    anima_create_payload,
    chat_payload,
    format_failure,
    load_creation_template,
    request_headers,
    stream_sse_until_completed,
    truthy,
)
from locust import between, task

_log = logging.getLogger("locust.sse")


class AnimaChatSseUser(AccountlessAnimaUser):
    """Load test the current accountless Anima chat SSE journey."""

    wait_time = between(1, 2)

    def on_start(self) -> None:
        super().on_start()
        template = load_creation_template(self.client)
        payload = anima_create_payload(template)
        with self.client.post(
            "/v1/animas",
            json=payload,
            headers=request_headers(mutation=True),
            name="/v1/animas (setup)",
            catch_response=True,
            timeout=60,
        ) as response:
            if not 200 <= response.status_code < 300:
                response.failure(format_failure(response, prefix="setup_create_anima_http"))
                raise RuntimeError("setup Anima creation failed")
            body = response.json()
            anima_id = body.get("anima_id") if isinstance(body, dict) else None
            if not isinstance(anima_id, str) or not anima_id:
                response.failure("setup_create_anima_missing_id")
                raise RuntimeError("setup Anima creation omitted its ID")
            self.anima_id = anima_id
            response.success()

        with self.client.get(
            f"/v1/animas/{self.anima_id}/runtime",
            headers=request_headers(),
            name="/v1/animas/:id/runtime (setup)",
            catch_response=True,
            timeout=60,
        ) as response:
            if not 200 <= response.status_code < 300:
                response.failure(format_failure(response, prefix="setup_runtime_http"))
                raise RuntimeError("setup runtime issuance failed")
            body = response.json()
            revision = body.get("effective_revision") if isinstance(body, dict) else None
            if not isinstance(revision, str) or not revision:
                response.failure("setup_runtime_missing_revision")
                raise RuntimeError("setup runtime omitted its revision")
            self.runtime_revision = revision
            response.success()

    @task
    def chat_sse(self) -> None:
        payload = chat_payload(runtime_revision=self.runtime_revision)
        url = f"/v1/animas/{self.anima_id}/chat:sse"
        log_sse = truthy(os.getenv("LOADTEST_SSE_LOG"))
        max_events = int(os.getenv("LOADTEST_SSE_LOG_MAX_EVENTS", "50"))
        max_chars = int(os.getenv("LOADTEST_SSE_LOG_MAX_CHARS", "2000"))
        events: list[tuple[str, str]] = []

        def on_event(event_type: str, event_data, event_data_raw) -> None:  # noqa: ANN001
            if not log_sse or len(events) >= max_events:
                return
            data = json.dumps(event_data, ensure_ascii=True) if event_data is not None else (event_data_raw or "")
            events.append((event_type, data[:max_chars]))

        with self.client.post(
            url,
            json=payload,
            headers=request_headers(mutation=True),
            name="/v1/animas/:id/chat:sse",
            catch_response=True,
            stream=False,
            timeout=120,
        ) as response:
            if not 200 <= response.status_code < 300:
                response.failure(format_failure(response, prefix="chat_sse_http"))
                return
            try:
                completed, last_type, elapsed, _last_data = stream_sse_until_completed(
                    response,
                    on_event=on_event if log_sse else None,
                )
            except Exception as exc:
                response.failure(f"chat_sse_stream_error type={type(exc).__name__}")
                return
            if not completed:
                response.failure(f"chat_sse_incomplete elapsed={elapsed:.3f}s last={last_type}")
                return
            for event_type, data in events:
                _log.info("sse_event event=%s data=%s", event_type, data)
            response.success()


__all__ = ["AnimaChatSseUser"]
