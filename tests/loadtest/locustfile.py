"""Aggregate accountless Locust scenarios for the local application."""

from __future__ import annotations

from tests.loadtest.anima_create_locustfile import AnimaCreateUser
from tests.loadtest.chat_sse_locustfile import AnimaChatSseUser

__all__ = [
    "AnimaCreateUser",
    "AnimaChatSseUser",
]
