"""Aggregate accountless Locust scenarios that run through Hono."""

from __future__ import annotations

from loadtest.anima_create_locustfile import AnimaCreateUser
from loadtest.chat_sse_locustfile import AnimaChatSseUser

__all__ = [
    "AnimaCreateUser",
    "AnimaChatSseUser",
]
