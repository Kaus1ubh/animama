"""Shared constants for the direct chat turn runtime."""

DIRECT_CHAT_NODE_ID = "direct-chat:model-client"

OPENAI_RESPONSES_PROVIDER = "OpenAIResponsesHTTPAgent"
OPENAI_RESPONSES_PREVIOUS_RESPONSE_UNRESOLVABLE_CODE = "openai_previous_response_unresolvable"
OPENAI_CHAT_COMPLETIONS_PROVIDER = "OpenAIHTTPAgent"
MOCK_MODEL_PROVIDER = "MockModelClient"

DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER = frozenset(
    {
        OPENAI_RESPONSES_PROVIDER,
        OPENAI_CHAT_COMPLETIONS_PROVIDER,
        MOCK_MODEL_PROVIDER,
    }
)

MAX_MEMORY_TOOL_ROUNDS = 4
MEMORY_TOOL_LIMIT_FINAL_INSTRUCTION = (
    "Memory tool round limit reached. Use the memory tool results already provided in this turn to produce the "
    "required final structured response. Do not request more tools."
)
