# Live Integration Test Helpers

`tests/live` contains helper fixtures for integration-style tests that need a
real FastAPI server and database, plus opt-in provider smoke tests. Normal chat
coverage exercises the direct model-client runtime.

## Server Fixture

`tests/live/conftest.py` provides `anima_server_base_url`. The fixture:

1. receives the testcontainer PostgreSQL URL from the shared `db_ready` fixture
2. points `ANIMAMA_DATABASE_URL` at that database before importing the app
3. starts the FastAPI app in-process with Uvicorn on a random localhost port
4. waits for `/health`
5. yields the base URL to the test
6. shuts the server down after the test

The fixture shares the disposable database with the test process. It does not
configure `ANIMAMA_PUBLIC_ORIGIN` for its chosen port or install the production
`LocalH11Protocol` transport, so it is not acceptance evidence for local HTTP
admission or streaming. Use `tests/test_local_http_transport.py` and its
isolated composition for those checks. A product request through this helper
requires compatible origin/bootstrap configuration; fixture availability alone
does not establish a working product journey.

Example:

```python
@pytest.mark.asyncio
async def test_my_feature(anima_server_base_url: str, async_session) -> None:
    async with httpx.AsyncClient(base_url=anima_server_base_url) as client:
        response = await client.get("/health")
    assert response.status_code == 200
```

## Current Chat Runtime Smoke Checks

For local checks that should avoid provider calls, run the backend with
`ANIMAMA_LLM_SKIP=1`. Startup then registers `MockModelClient` for all direct
provider families.

Useful focused automated checks from the repo root:

```bash
uv run pytest -q tests/test_direct_chat_turn_executor.py tests/test_direct_chat_model_clients.py tests/test_model_client_registry.py
uv run pytest -q tests/test_anima_chat_sse.py tests/test_anima_sse_events.py
```

`test_openai_responses_apply_patch.py` is an opt-in provider smoke for the
official OpenAI Responses `gpt-5.4-nano` row. It verifies that the model emits a
native `apply_patch_call`, accepts the matching `apply_patch_call_output` through
`previous_response_id`, and then satisfies a strict structured response. Run it
only with a real key:

```bash
ANIMAMA_RUN_LIVE_TESTS=1 uv run pytest -q tests/live/test_openai_responses_apply_patch.py
```

The test uses `ANIMAMA_LIVE_OPENAI_API_KEY` when set, otherwise
`OPENAI_API_KEY`. It skips when live tests are disabled or the test-suite
placeholder key is active.

## Manual OpenAI Stream Metadata Smoke

Use this checklist only when validating a real OpenAI-backed local or staging
stack with `OPENAI_API_KEY` configured and a non-incognito chat turn.

1. Select a provider through the anima chat profile default or request
   `model_provider_id`. Use `OpenAIHTTPAgent:*` for Chat Completions and
   `OpenAIResponsesHTTPAgent:*` for Responses.
2. Send a `chat:sse` turn and confirm the browser-facing stream contains the
   supported Animama events such as `user.response`, `emotion.update`,
   `avatar.gesture.requested`, optional TTS/title events, `error`, and exactly
   one route-owned `run.completed` on completed/error paths.
3. Confirm raw upstream provider events are not forwarded as SSE frames. OpenAI
   chunks, Responses lifecycle events, assistant `phase`, function-call
   fragments, native hosted tool events, and unknown provider events should be
   visible only through sanitized logs and compact persisted metadata.
4. Inspect the visible assistant `chat_messages` row. It should contain
   `message_data.structured` and `message_data.model_client.raw_provider_metadata`.
   When provider stream observations occurred, that metadata should include a
   compact `stream_event_summary` with event counts and warnings rather than raw
   provider payloads.
5. For Chat Completions, confirm `stream_event_summary.finish_reasons` is present
   when the provider sends a finish reason. If usage is missing, expect a
   `missing_usage` warning rather than raw usage payloads.
6. For Responses, confirm `message_data.openai.response_id` is present and the
   parent `chats.openai_previous_response_id` advances to that ID. The stream
   summary should include terminal completion information when
   `response.completed` or compatible `response.done` was received.
7. For phased Responses output, confirm `final_answer` text is the public chat
   output and `commentary` is only internally observed. If a stale cursor forces
   manual history replay, persisted assistant phase metadata should be serialized
   back onto assistant input items.
8. For Responses-native web search or other hosted tools, enable only catalog
   rows that advertise the capability and confirm native hosted tool lifecycle
   observations appear as compact summaries such as `native_tool_events` or
   `native_tool_summaries`.
9. Send an incognito Responses turn and confirm local `chat_messages` rows and
   `chats.openai_previous_response_id` do not advance. The upstream Responses
   request should use `store=false`.
10. Fetch `/v1/chats/{chat_id}/messages` and confirm public history responses do
    not expose raw provider response bodies or full raw stream events.

## Troubleshooting

If the in-process server fixture fails:

- ensure Docker is running for testcontainers
- check Docker permissions for the current user
- run with `--log-cli-level=DEBUG` for startup details
- confirm imports from `animama.server.app` work in the current environment

If provider-backed manual checks fail:

- verify the selected `model_providers` row is active
- verify the anima chat profile has a valid default provider when the request
  does not pass `model_provider_id`
- check normalized OpenAI error codes such as `openai_authentication_error`,
  `openai_rate_limit`, `openai_previous_response_unresolvable`, or
  `openai_stream_incomplete`
- inspect sanitized `model_client_stream_event` and
  `model_client_stream_event_summary` logs instead of raw provider payloads
