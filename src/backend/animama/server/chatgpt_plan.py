"""The local composition's ChatGPT plan session: where it lives and when sign-in is offered.

Sign-in is offered only when the installation's own origin is a loopback
``http`` origin (D14), because OpenAI sends the browser back to
``http://127.0.0.1:<port>/auth/callback`` and only then does that address reach
this server. A desktop profile also needs its vault's key for the session file;
without one, sign-in is unavailable rather than falling back to a plain file.

The service is created on first use, after startup has resolved the private
data root, and closed with the application.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast

from fastapi import FastAPI

from animama.adapters.chatgpt_plan.openai_identity import OpenAIChatGPTPlanIdentity
from animama.adapters.chatgpt_plan.session_store import FileChatGPTPlanSessionStore
from animama.app.ports.chatgpt_plan_port import ChatGPTPlanSessionStorePort
from animama.app.services.chatgpt_plan_session import ChatGPTPlanSessionService
from animama.domain.chatgpt_plan import ChatGPTPlanRecord
from animama.local.http.config import LocalHTTPConfig
from animama.server.schemas.chatgpt_plan import ChatGPTPlanUnavailableReason

CALLBACK_PATH = "/auth/callback"


class _NoSessionFile:
    """The store of a desktop profile without a key: always signed out, and nothing is written."""

    def load(self) -> ChatGPTPlanRecord | None:
        return None

    def save(self, record: ChatGPTPlanRecord) -> None:
        raise OSError("The ChatGPT plan session needs the desktop vault's key")


def _config(app: FastAPI) -> LocalHTTPConfig:
    return cast(LocalHTTPConfig, app.state.local_http_config)


def chatgpt_plan_return_uri(app: FastAPI) -> str | None:
    """The address OpenAI sends the browser back to, or None when it could not reach this server."""

    authority = _config(app).sign_in_return_authority
    return f"http://{authority}{CALLBACK_PATH}" if authority is not None else None


def chatgpt_plan_store_key(app: FastAPI) -> bytes | None:
    return cast(bytes | None, getattr(app.state, "chatgpt_plan_store_key", None))


def chatgpt_plan_unavailable_reason(app: FastAPI) -> ChatGPTPlanUnavailableReason | None:
    if chatgpt_plan_return_uri(app) is None:
        return "remote_origin"
    if _config(app).desktop is not None and chatgpt_plan_store_key(app) is None:
        return "secure_storage_unavailable"
    return None


def chatgpt_plan_session_for(app: FastAPI) -> ChatGPTPlanSessionService:
    """Return the installation's session service, creating it on first use."""

    service = getattr(app.state, "chatgpt_plan_session", None)
    if service is None:
        data_internal_root: Path = app.state.local_runtime_paths.data_internal_root
        identity = OpenAIChatGPTPlanIdentity()
        store: ChatGPTPlanSessionStorePort = FileChatGPTPlanSessionStore(
            data_internal_root / "chatgpt-plan", key=chatgpt_plan_store_key(app)
        )
        if chatgpt_plan_unavailable_reason(app) == "secure_storage_unavailable":
            # A desktop profile without its vault key reads and writes no session file at all.
            store = _NoSessionFile()
        service = ChatGPTPlanSessionService(identity=identity, store=store)
        app.state.chatgpt_plan_identity = identity
        app.state.chatgpt_plan_session = service
    return cast(ChatGPTPlanSessionService, service)


async def close_chatgpt_plan_session(app: FastAPI) -> None:
    identity = getattr(app.state, "chatgpt_plan_identity", None)
    if identity is not None:
        await identity.aclose()
        app.state.chatgpt_plan_identity = None
        app.state.chatgpt_plan_session = None
