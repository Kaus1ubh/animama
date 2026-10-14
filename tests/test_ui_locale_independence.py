"""The UI Locale never changes chat options or companion safety (internationalization spec R6).

The Anima's reply and speech language follow the locale the client applied for
the turn (``client_context.ui_locale``, ADR 0024; see ``test_conversation_language``).
The saved preference does not reach turn options, and safety reads neither it
nor the turn's ``ui_locale``.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.contracts.chat import PyChatClientContext
from animama.domain.request_principal import RequestPrincipal
from animama.orm.settings import ORMUserSettings
from animama.product_http.chat.options import resolve_chat_request_options
from animama.product_http.chat.safety import prepare_turn_safety
from animama.server.companion_safety import runtime_crisis_resources
from animama.server.config import Settings

PREFERENCES = {"chat": {"reasoning_effort": "low"}, "safety": {"crisis_resource_region": None}}


@pytest.mark.parametrize("client_locale", ["en-US", "ja-JP"])
async def test_turn_options_and_safety_do_not_depend_on_the_ui_locale(async_session, client_locale) -> None:
    outcomes = []
    for ui_locale in ("ja", "zh-Hant", None):
        owner = str(uuid4())
        async_session.add(ORMUserSettings(user_id=owner, locale=ui_locale, preferences=dict(PREFERENCES)))
        await async_session.flush()
        repositories = SQLAlchemyProductRepositories(async_session)
        options = await resolve_chat_request_options(
            repositories=repositories,
            user=RequestPrincipal(id=owner),
            anima_id="anima-1",
            request_opts=None,
        )
        runtime_settings = Settings()
        safety = await prepare_turn_safety(
            repositories=repositories,
            user_id=owner,
            client_context=PyChatClientContext(time_zone="UTC", locale=client_locale, ui_locale=ui_locale),
            operator=runtime_settings.companion_safety,
            crisis_resources=runtime_crisis_resources(runtime_settings),
        )
        outcomes.append((options, safety.effective, safety.crisis_region.code))
    assert outcomes[0] == outcomes[1] == outcomes[2]
