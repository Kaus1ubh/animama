from __future__ import annotations

from loadtest.common import (
    AccountlessAnimaUser,
    anima_create_payload,
    format_failure,
    load_creation_template,
    request_headers,
)
from locust import task


class AnimaCreateUser(AccountlessAnimaUser):
    """Load test Anima creation."""

    def on_start(self) -> None:
        super().on_start()
        self.creation_template = load_creation_template(self.client)

    @task
    def create_anima(self) -> None:
        payload = anima_create_payload(self.creation_template)
        with self.client.post(
            "/v1/animas",
            json=payload,
            headers=request_headers(mutation=True),
            name="/v1/animas",
            catch_response=True,
            timeout=60,
        ) as resp:
            if 200 <= resp.status_code < 300:
                resp.success()
                return
            resp.failure(format_failure(resp, prefix="create_anima_http"))


__all__ = ["AnimaCreateUser"]
