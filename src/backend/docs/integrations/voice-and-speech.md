# Voice And Speech

The backend contains integrations for ElevenLabs TTS/voice operations. Current
frontend and desktop speech flows primarily use client-side STT/VAD/turn
detection plus `chat:sse` TTS/session events.

## ElevenLabs

`server/routers/elevenlabs.py` exposes ElevenLabs operations:

- voice clone
- text-to-speech synthesis
- sound effects
- audio isolation

Anima-specific ElevenLabs configuration contains one voice only:
`speech.elevenlabs.primary_voice`. Legacy persisted `variants` maps are accepted
as ignored input for compatibility and are not serialized back on profile saves.
When a new anima saves an `elevenlabs_voice_profile`, the backend validates the
selected voice against the configured ElevenLabs API key before persisting it.
That fresh save-time check also primes a small process-local runtime cache.

Configuration lives in `server/config.py`, including the API key and
`ANIMAMA_ELEVENLABS_REALTIME_TTS_DEFAULT_MODEL_ID`. The default realtime model
is `eleven_flash_v2_5`. Do not return backend API keys to clients. For
realtime chat, return short-lived direct websocket credentials in `chat:sse`
`tts.session` events.

## Realtime TTS

For normal chat turns, `POST /v1/animas/{anima_id}/chat:sse` is the
preferred ElevenLabs realtime bootstrap path. The frontend sends explicit TTS
intent in `dispatch_options.tts` when TTS is enabled and the resolved provider
is ElevenLabs:

- `enabled: true`
- `provider: "elevenlabs"`
- `transport: "auto" | "direct"` as request intent
- optional `language_code`
- optional `model_id`: `eleven_flash_v2_5` or `eleven_multilingual_v2` for
  realtime speech, or `eleven_v3` for finalized-text speech
- optional `finalized_chunking`: `"sentence"` or `"paragraph"` for
  `eleven_v3` only

Session setup starts concurrently with the primary direct model turn, so model
invocation does not wait for direct-mode token minting. Runtime voice
accessibility validation uses the process-local cache populated at save time or
by recent chat runs; if the cache misses, the setup task validates once and
caches the result instead of checking repeatedly.
When session setup succeeds, `chat:sse` emits `tts.session`; the event may
arrive before or after the final `user.response`. The event includes the single-use
`tts_websocket` token for direct browser-to-ElevenLabs playback. If setup
fails, `chat:sse` emits `tts.session.error` and continues the assistant
response.

When `model_id` is present, the backend validates it against the realtime
allowlist and returns the selected value in `tts.session.model_id`. When it is
omitted, the backend uses the configured default. The selected model is used in
the upstream ElevenLabs websocket URL.

When `model_id` is `eleven_v3`, `chat:sse` does not start realtime session
setup and does not emit `tts.session` or `tts.session.error`. After the
main-structured speech stream begins, the backend synthesizes prepared speech in
order and pushes `tts.audio`, one final `tts.done`, or `tts.error` over the
same chat SSE stream. The default `finalized_chunking="sentence"` keeps one
upstream v3 request per prepared sentence. The opt-in
`finalized_chunking="paragraph"` mode keeps public sentence-level
`user.response` events unchanged while batching backend audio by paragraph, with
safety flushes at four sentence segments or about 600 visible characters. In
paragraph mode, the backend inserts a 400 ms silent PCM `tts.audio` frame before
each paragraph batch after the first.

Ordinary non-TTS chat streams do not run gruut for ElevenLabs and do not emit
`tts_text` fields. Gruut speech payloads are limited to main-structured
`speech` parts used by active TTS runs.

Realtime TTS is direct-only after `chat:sse` emits `tts.session`. Expressive
delivery should be implemented through synthesis parameters or prompt/tagging in
future TTS paths, not by switching among saved ElevenLabs voices.

## Finalized-Text v3 TTS

For Eleven v3 chat speech, `chat:sse` verifies anima ownership, resolves the
anima voice from `speech.elevenlabs.primary_voice`, validates that the
configured voice is available to the backend ElevenLabs API key at most once
per chat run using the runtime cache, and sends sentence or paragraph finalized
text upstream. Later sentence or paragraph batches reuse the resolved `voice_id`
and do not repeat database voice lookup or ElevenLabs `voices.get` validation.
Sentence mode sends the
gruut-prepared `tts_text` for each speech segment. Paragraph mode joins visible
sentence text for each paragraph batch, re-prepares that batch with gruut, and
then sends the resulting provider text upstream. The ElevenLabs call uses
`model_id="eleven_v3"`, `output_format="pcm_24000"`, and
`apply_text_normalization="off"`. Anima intentionally omits `previous_text` and
`next_text` for v3 because the live ElevenLabs API rejects those fields for
`eleven_v3`; it also does not send request-id continuity fields. Anima uses
ElevenLabs' plain streaming TTS API and does not request timestamp/alignment
metadata. Public sentence-level `user.response` payloads and `tts_text`
metadata do not expose paragraph batching fields. `chat:sse` audio chunks
include
`type: "tts.audio"`, `run_id`, `model_id`, `output_format`, and `audio_base64`;
the backend coalesces upstream PCM bytes before sending SSE frames to avoid
many tiny browser playback buffers. In paragraph mode, a generated 400 ms
silence frame is inserted before each later paragraph batch using the same
`tts.audio` shape. The stream ends with one `type: "tts.done"` after the last
segment. If segment setup or upstream streaming fails, Anima
emits `type: "tts.error"` with `code: "elevenlabs_stream_failed"` or a
setup-specific code, skips `tts.done`, and still completes the chat run.

Voice-structured responses are prompted and schematized to include
`emotional_tone`, `emotional_intensity`, `gesture`, then `speech`. The tone and intensity
fields are backend-internal metadata: they are not emitted as visible chat text
and are not stored as assistant messages. Normal `chat:sse` uses them to compute
and persist a full-state `emotion.update`; the frontend still treats the
resulting `emotions` array, not raw tone metadata, as canonical avatar emotion
state. For `eleven_v3`, the backend may also map the tone through the anima's
current backend-visible emotional state and prefix the upstream provider text
with an allowlisted bracketed tag such as `[friendly]`,
`[slightly happy]`, `[happy]`, or `[very happy]`. Level 0 recognized tones use
`slightly`, level 1 uses the base tone, and levels 2-3 use `very`. The
`tts_text`, `tts_phonemized_text`, persisted speech, avatar lip-sync inputs,
realtime ElevenLabs websocket text, PocketTTS text, and browser TTS text remain
untagged. If the model sends `neutral`, omits `emotional_tone`, sends it blank,
or returns a value outside the allowlist, the backend logs a warning for
malformed metadata when applicable, emits a no-op emotion update with
`emotional_intensity=0`, and uses the backend-only `[friendly]` Eleven v3
provider prefix instead of failing the chat turn. For each Eleven v3 finalized
request, the backend emits an info log named
`ElevenLabs v3 provider text prepared` with the resolved prefix and a truncated
preview of the exact provider text sent upstream. Sentence chunking applies the
prefix to only the first upstream request for backward-compatible Phase 4 audio
behavior; paragraph chunking applies the prefix to every paragraph batch.

The frontend finalized runtime decodes and plays PCM audio from SSE events.
Avatar lip-sync continues to use gruut phonemes from SSE plus provider
audio-start and actual-duration callbacks. Anima preserves the additive
`tts_text` fields on `user.response` as provider handoff data, but ElevenLabs
alignment is no longer part of the v3 runtime.

## Retired Server-Side STT

The former `server/routers/stt.py` WebSocket was retired. The current
frontend/desktop stack uses client-side Parakeet STT, MicVAD, and smart-turn
style turn detection.

Do not build new speech UX on a backend STT WebSocket. New speech features
should check frontend docs and code first to avoid duplicating client-side audio
processing on the backend.

## Retired LiveKit Voice Routes

The former `server/routers/livekit_voice.py` routes were retired with the
process-local engine. Current frontend flows do not depend on LiveKit as the
primary voice path.

If this integration is revived, document the deployment requirements,
authentication model, and frontend flow before expanding the route surface.

## Voice Session State

Normal chat resolves any request-local TTS session state inside the
`chat:sse` request. Durable voice configuration belongs in anima settings,
voice catalog metadata, or provider-side resources.

## Voice Catalog Storage

Animas may reference a Pocket voice catalog uploaded through the dedicated
`/v1/animas/voice-catalogs/uploads` lifecycle. The authenticated PUT is bounded
under `data/staging/uploads`; finalization validates the catalog and publishes
a normal standalone file plus metadata sidecar under
`content/local/voices`. This voice-specific upload path is separate from
private chat attachments; see
[custom Animas and typed content](../features/custom-animas-and-content.md).

## Adding Voice Features

When adding or changing voice behavior:

1. confirm whether the frontend already performs the function client-side
2. keep provider secrets server-side
3. prefer short-lived credentials or proxied backend calls for browser access
4. document whether the path is current or legacy
5. add tests around auth, provider error mapping, and binary/audio responses
