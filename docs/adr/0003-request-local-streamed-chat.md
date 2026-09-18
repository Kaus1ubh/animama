# 0003: Request-local streamed chat with durable conversation state

- Status: accepted
- Recorded: 2026-09-17
- Retrospective: yes
- Original decision dates: Unknown from the evidence reviewed.
- Decision basis: Current documented architecture and inspected implementation; historical selection rationale remains unknown.

Acceptance records the existing boundary. It does not establish unknown historical
human approval or authorize new implementation, deployment or publication.

## Context and decision

The normal companion interaction addresses one Anima within an owned chat.
Execute it as a request-local direct model-client turn through `chat:sse`, with
durable conversation state maintained separately through `ChatManager`.

Validate and prepare the turn before opening the stream, then release the setup
database session. Use short-lived persistence sessions for later work. Provider
clients are app-scoped; turn execution, event bridging and cleanup belong to the
request. Provider events stay behind the model-client boundary. The public SSE
completion frame belongs to the route after successful downstream side effects.
Workflow orchestration would require a separate API contract.

## Reason and consequences

Current rationale: the lifetime of a single interaction is explicit, while chat
history survives individual requests. Transport formatting, model-provider
events and durable messages have distinct owners. Streaming does not hold the
setup database session open for the lifetime of the model call.

This choice requires explicit cancellation, cleanup, error handling and ordering
of TTS, title and compaction work. Durable conversation state does not imply a
resumable background execution job. A durable workflow/job system is a possible
alternative for different requirements; this record does not claim it was
historically evaluated or rejected.

A conversational turn can include several provider/tool rounds and stored
messages. The persisted `ChatMessage.turn` field orders individual message rows;
it is not one shared number for the entire user/assistant exchange. `run_id`
provides execution correlation rather than identifying the conversation.

## Evidence and historical limits

Observed implementation: [SSE lifecycle](../../src/backend/animama/server/routers/chat/chat_sse.py),
[turn preparation](../../src/backend/animama/server/routers/chat/turn_setup.py),
[direct executor](../../src/backend/animama/app/chat/direct_executor.py), and
[turn persistence](../../src/backend/animama/app/services/chat_manager.py).
The [chat runtime guide](../backend/runtime/chat.md) documents the current
request and stream contract; the [backend guide](../../src/backend/AGENTS.md)
explicitly preserves request-local product chat.

Historical records reviewed describe or preserve this architecture but do not
establish its original selection date, alternatives analysis or original
rationale. The reasons above are the current rationale supported by the
implementation and contract, not reconstructed historical intent.
