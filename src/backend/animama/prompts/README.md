# Prompt Ownership

Normal companion chat uses the request-local direct chat runtime. Start with
[Direct chat SSE runtime](../../docs/runtime/chat.md) for the supported flow.

- [`app/chat/direct_executor.py`](../app/chat/direct_executor.py) prepares the
  turn, selects its structured response shape, and adds the Anima's available
  Gesture descriptors to the guidance.
- [`app/chat/openai_prompt.py`](../app/chat/openai_prompt.py) assembles identity,
  history, memory/tool context, and response guidance into the provider-neutral
  prompt consumed by the selected model client.
- [`app/chat/direct_turn/response_format.py`](../app/chat/direct_turn/response_format.py)
  owns direct-chat response-format guidance and configuration.
- [`app/main_structured_response.py`](../app/main_structured_response.py) owns
  the typed speech, emotion, and Gesture response contract and parsing.
- [`avatar_animation_manifest.py`](avatar_animation_manifest.py) contains the
  bundled animation manifest reader and Gesture identifier normalization helpers.
  The direct turn's available Gestures come from its resolved runtime descriptors.

The retained profile templates, `PromptManager`, and prompt facade in this
package belong to the earlier graph/helper runtime. They are not the entrypoint
for normal `chat:sse` prompt changes. Historical supervisor-delegation examples
remain in Git history; they do not describe the supported chat architecture.
