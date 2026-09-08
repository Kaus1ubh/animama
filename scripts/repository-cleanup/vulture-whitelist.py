"""Specific implicit consumers for Vulture; parsed as source, never executed.

Vulture matches names globally. Review every before/after suppression and do not
interpret this file as proof that another same-named definition is reachable.
"""

from animama.server.routers import runtime_context
from animama.server.schemas.chat import PyAnimaChatRequest

# Router mounted at server/routers/__init__.py:34 and server/app.py:52.
# Exact HTTP registrations: server/routers/runtime_context.py:63,72,85.
_runtime_routes = (
    runtime_context.get_runtime_context,
    runtime_context.ensure_runtime_bootstrap,
    runtime_context.complete_runtime_onboarding,
)

# Pydantic field validators registered at server/schemas/chat.py:17,25,35,43.
# The request model is consumed by server/routers/chat/chat_sse.py.
_chat_validators = (
    PyAnimaChatRequest.trim_message,
    PyAnimaChatRequest.trim_model_provider_id,
    PyAnimaChatRequest.trim_runtime_revision,
    PyAnimaChatRequest.trim_attached_file_ids,
)
