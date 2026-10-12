"""Direct chat turns over SSE, shared by every composition (ADR 0021).

``stream`` prepares and streams one ``POST /v1/animas/{anima_id}/chat:sse`` turn:
``turn_setup`` validates the owner's Anima and runtime revision and builds the
app-layer executor; ``sse_runtime`` and ``sse_events`` turn domain events into
frames; ``tts``, ``title``, ``compaction`` and ``safety`` run the reply's side
effects. Every collaborator comes from the composition's ``ProductPorts``, and the
composition's chat-turn lease guards the whole turn.
"""
