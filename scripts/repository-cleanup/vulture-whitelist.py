"""Specific implicit consumers for Vulture; parsed as source, never executed.

Vulture matches names globally. Review every before/after suppression and do not
interpret this file as proof that another same-named definition is reachable.
"""

from animama.server.routers import runtime_context
from animama.server.schemas.chat import PyAnimaChatRequest

# Local runtime routes are mounted by create_local_app through the product router.
# Their HTTP registrations live in server/routers/runtime_context.py.
_runtime_routes = (
    runtime_context.get_runtime_context,
    runtime_context.ensure_runtime_bootstrap,
    runtime_context.complete_runtime_onboarding,
)

# Pydantic registers these field validators on server/schemas/chat.py's request model.
# The request model is consumed by product_http/routes/chat_turns.py.
_chat_validators = (
    PyAnimaChatRequest.trim_message,
    PyAnimaChatRequest.trim_model_provider_id,
    PyAnimaChatRequest.trim_runtime_revision,
    PyAnimaChatRequest.trim_attached_file_ids,
)
