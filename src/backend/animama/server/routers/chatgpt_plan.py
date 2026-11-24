"""ChatGPT plan sign-in routes: mounted only by the local composition.

``/v1/chatgpt-plan*`` serve the app page like any other owner route. The
sign-in return, ``GET /auth/callback``, is different: the system browser
arrives there from OpenAI in a cross-site navigation, so admission lets it in
under the narrow rule in ``LocalHTTPAdmission`` (T1), and it answers with a
static page. Its query carries a one-time code and the attempt's state, so it
is never logged, traced or reflected.

Hosted never mounts these routes and reports ``chatgpt_plan = false``.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse

from animama.app.services.chatgpt_plan_session import ChatGPTPlanSessionService
from animama.domain.chatgpt_plan import ChatGPTPlanSignInError, ChatGPTPlanStatus, ChatGPTPlanUnavailableError
from animama.domain.request_principal import RequestPrincipal
from animama.server.chatgpt_plan import (
    CALLBACK_PATH,
    chatgpt_plan_return_uri,
    chatgpt_plan_session_for,
    chatgpt_plan_unavailable_reason,
)
from animama.server.chatgpt_plan_return_page import ReturnOutcome, return_page
from animama.server.deps import get_current_principal
from animama.server.schemas.chatgpt_plan import (
    PyChatGPTPlanPreferences,
    PyChatGPTPlanSignIn,
    PyChatGPTPlanSignInRequest,
    PyChatGPTPlanSignOut,
    PyChatGPTPlanStatus,
)

router = APIRouter(tags=["chatgpt-plan"])

# The only return fields the sign-in reads; anything else in the query is ignored.
_RETURN_FIELDS = ("code", "state", "error", "client_id", "iss", "scope")
_OUTCOMES: dict[str, ReturnOutcome] = {
    "access_denied": "declined",
    "sign_in_expired": "expired",
    "no_pending_sign_in": "expired",
}


def _session(request: Request) -> ChatGPTPlanSessionService:
    return chatgpt_plan_session_for(request.app)


def _view(request: Request, current: ChatGPTPlanStatus) -> PyChatGPTPlanStatus:
    reason = chatgpt_plan_unavailable_reason(request.app)
    return PyChatGPTPlanStatus(sign_in_available=reason is None, unavailable_reason=reason, **asdict(current))


def _conflict(code: str, **fields: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": code, **fields})


@contextmanager
def _session_errors() -> Iterator[None]:
    """Word an unavailable session as a code: 503 while storage or OpenAI is down, otherwise 409."""

    try:
        yield
    except ChatGPTPlanUnavailableError as error:
        if error.code == "temporarily_unavailable":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "chatgpt_plan_temporarily_unavailable"},
            ) from error
        raise _conflict(f"chatgpt_plan_{error.code}") from error


@router.get("/v1/chatgpt-plan", response_model=PyChatGPTPlanStatus)
async def get_chatgpt_plan(
    request: Request, principal: Annotated[RequestPrincipal, Depends(get_current_principal)]
) -> PyChatGPTPlanStatus:
    """Return the session's state for settings; never a token."""

    with _session_errors():
        return _view(request, await _session(request).status())


@router.post("/v1/chatgpt-plan/sign-in", response_model=PyChatGPTPlanSignIn)
async def begin_chatgpt_plan_sign_in(
    body: PyChatGPTPlanSignInRequest,
    request: Request,
    response: Response,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyChatGPTPlanSignIn:
    """Start a sign-in and return the URL the page opens in the system browser."""

    reason = chatgpt_plan_unavailable_reason(request.app)
    redirect_uri = chatgpt_plan_return_uri(request.app)
    if reason is not None or redirect_uri is None:
        raise _conflict("chatgpt_plan_sign_in_unavailable", reason=reason or "remote_origin")
    with _session_errors():
        url = await _session(request).begin(redirect_uri=redirect_uri, enable_plan_use=body.enable_plan_use)
    # One attempt is pending at a time, so the return page uses the language of the latest one.
    request.app.state.chatgpt_plan_return_locale = body.ui_locale
    response.headers["Cache-Control"] = "no-store"
    return PyChatGPTPlanSignIn(authorize_url=url)


@router.delete("/v1/chatgpt-plan/sign-in", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_chatgpt_plan_sign_in(
    request: Request, principal: Annotated[RequestPrincipal, Depends(get_current_principal)]
) -> None:
    await _session(request).cancel()


@router.post("/v1/chatgpt-plan:sign-out", response_model=PyChatGPTPlanSignOut)
async def sign_out_of_chatgpt_plan(
    request: Request, principal: Annotated[RequestPrincipal, Depends(get_current_principal)]
) -> PyChatGPTPlanSignOut:
    """End the session at OpenAI and remove the tokens; say whether OpenAI confirmed it."""

    with _session_errors():
        result = await _session(request).sign_out()
    return PyChatGPTPlanSignOut(was_signed_in=result.was_signed_in, confirmed=result.confirmed)


@router.put("/v1/chatgpt-plan/preferences", response_model=PyChatGPTPlanStatus)
async def update_chatgpt_plan_preferences(
    body: PyChatGPTPlanPreferences,
    request: Request,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyChatGPTPlanStatus:
    """Record the one-time confirmation and whether background work may use the plan."""

    with _session_errors():
        current = await _session(request).set_preferences(
            confirmed=body.confirmed, background_agreed=body.background_agreed
        )
    return _view(request, current)


@router.get(CALLBACK_PATH, include_in_schema=False, response_class=HTMLResponse)
async def complete_chatgpt_plan_sign_in(request: Request) -> HTMLResponse:
    """Finish the pending sign-in from OpenAI's return and show a fixed page.

    The handler reads only the known fields, refuses a repeated one, and
    never echoes or logs any of them.
    """

    params: dict[str, str] = {}
    outcome: ReturnOutcome = "failed"
    if all(len(request.query_params.getlist(name)) <= 1 for name in _RETURN_FIELDS):
        params = {name: request.query_params[name] for name in _RETURN_FIELDS if name in request.query_params}
        try:
            await chatgpt_plan_session_for(request.app).complete(params)
            outcome = "signed_in"
        except ChatGPTPlanSignInError as error:
            outcome = _OUTCOMES.get(error.code, "failed")
    return return_page(outcome, getattr(request.app.state, "chatgpt_plan_return_locale", None))
