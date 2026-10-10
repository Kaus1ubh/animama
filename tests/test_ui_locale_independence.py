"""The owner's UI Locale never changes chat behavior (internationalization spec R6, AC7).

The saved ``locale`` only chooses interface text and formatting. Turn setup reads
App settings for chat options and companion safety; neither may differ by locale,
and the provider prompt assembler takes no locale at all.
"""

from __future__ import annotations

import inspect
from uuid import uuid4

import pytest

from animama.app.chat.openai_prompt import DirectChatPromptAssembler
from animama.domain.request_principal import RequestPrincipal
from animama.orm.settings import ORMUserSettings
from animama.server.chat_options import resolve_chat_request_options
from animama.server.config import Settings
from animama.server.routers.chat.safety import prepare_turn_safety
from animama.server.schemas.chat import PyChatClientContext

PREFERENCES = {"chat": {"reasoning_effort": "low"}, "safety": {"crisis_resource_region": None}}


@pytest.mark.parametrize("client_locale", ["en-US", "ja-JP"])
async def test_turn_options_and_safety_do_not_depend_on_the_ui_locale(async_session, client_locale) -> None:
    outcomes = []
    for ui_locale in ("ja", "zh-Hant", None):
        owner = str(uuid4())
        async_session.add(ORMUserSettings(user_id=owner, locale=ui_locale, preferences=dict(PREFERENCES)))
        await async_session.flush()
        options = await resolve_chat_request_options(
            session=async_session,
            user=RequestPrincipal(id=owner),
            anima_id="anima-1",
            request_opts=None,
        )
        safety = await prepare_turn_safety(
            session=async_session,
            user_id=owner,
            client_context=PyChatClientContext(time_zone="UTC", locale=client_locale),
            runtime_settings=Settings(),
        )
        outcomes.append((options, safety.effective, safety.crisis_region.code))
    assert outcomes[0] == outcomes[1] == outcomes[2]


def test_prompt_assembly_has_no_locale_input() -> None:
    parameters = inspect.signature(DirectChatPromptAssembler.assemble).parameters
    assert not [name for name in parameters if "locale" in name or "language" in name]
