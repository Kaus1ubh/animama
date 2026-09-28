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

# One extra request per turn when the final reply fails local validation.
STRUCTURED_REPLY_REPAIR_ROUND_INDEX = MAX_MEMORY_TOOL_ROUNDS + 2
STRUCTURED_REPLY_REPAIR_INSTRUCTION = (
    "The last reply did not match the required response format. Reply to the user again with only one valid "
    "JSON object in the required shape, with the fields in the required order and no markdown or text outside it."
)
# Final metadata recording the repair outcome: "attempted" or "request_failed".
STRUCTURED_REPAIR_METADATA_KEY = "structured_repair"
