# Gemini text-to-speech research brief (as of 2026-10-10)

Scope: Gemini Developer API (ai.google.dev), not Gemini Enterprise Agent Platform. Sources were read on 2026-10-10; most doc pages carry "Last updated" dates between 2026-08-26 and 2026-10-09. No API key was used and no API calls were made. **UNCONFIRMED** means no official source confirms the item.

Trimmed on 2026-10-11 to the parts that matter for text-to-speech, after the owner dropped Gemini as a chat model provider. Section 7 adds what an audit of the SDK source found.

## Source keys
| Key | URL |
|---|---|
| IA | https://ai.google.dev/gemini-api/docs/interactions |
| REF | https://ai.google.dev/api/interactions-api (v1beta reference) |
| REF1 | https://ai.google.dev/api/interactions-api-v1 (v1 reference) |
| SPEC | https://ai.google.dev/static/api/interactions.openapi.json |
| VER | https://ai.google.dev/gemini-api/docs/api-versions |
| BC | https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026 |
| BLOG | https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api-general-availability |
| STR | https://ai.google.dev/gemini-api/docs/streaming |
| TH | https://ai.google.dev/gemini-api/docs/thinking |
| PRICE | https://ai.google.dev/gemini-api/docs/pricing |
| MIG | https://ai.google.dev/gemini-api/docs/migrate-to-interactions |
| ERR | https://ai.google.dev/gemini-api/docs/api-errors |
| KEY | https://ai.google.dev/gemini-api/docs/api-key |
| LIBS | https://ai.google.dev/gemini-api/docs/libraries |
| PYPI | https://pypi.org/project/google-genai/ |
| PYSRC | https://github.com/googleapis/python-genai (`google/genai/client.py`, `google/genai/_gaos/google_genai.py`, `google/genai/_gaos/interactions.py`, `google/genai/_gaos/_hooks/google_genai_auth.py`) |
| TERMS | https://ai.google.dev/gemini-api/terms |
| ABUSE | https://ai.google.dev/gemini-api/docs/usage-policies |
| LOGS | https://ai.google.dev/gemini-api/docs/logs-policy |
| TTS | https://ai.google.dev/gemini-api/docs/speech-generation |
| MTTS | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts and .../gemini-3.8-flash-lite-tts |
| VD | https://ai.google.dev/gemini-api/docs/voice-design |
| BLOGTTS | https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/ |
| RL | https://ai.google.dev/gemini-api/docs/rate-limits |
| REG | https://ai.google.dev/gemini-api/docs/available-regions |
| DEP | https://ai.google.dev/gemini-api/docs/deprecations |
| CL | https://ai.google.dev/gemini-api/docs/changelog |

---

## 1. Status, endpoint and auth

- **GA and recommended: TRUE.** The docs say the API has been GA since June 2026 and is "recommended for all new projects"; generateContent is "considered legacy" but "remains fully supported" [IA]. The GA blog post says the API has reached GA, has a stable schema, and that the public beta began in December 2025 [BLOG]. The blog post shows no date. Secondary copies date it June 22–23, 2026 (UNCONFIRMED).
- **New features ship on Interactions first: TRUE, with a nuance.** The docs say "all new models, multimodal capabilities, tools, and agentic features will launch on the Interactions API" [IA]. The blog post adds that generateContent "will continue to receive new mainline Gemini models for the foreseeable future" [BLOG].
- **Path: PARTIALLY TRUE.** Most docs and the SDK default use `POST https://generativelanguage.googleapis.com/v1beta/interactions` [IA][REF]. There is also a **stable `v1`** surface (`/v1/interactions`, get, delete, cancel), and Google says "The Interactions API and its core features are generally available in v1" [VER][REF1]. Feature support differs by version [VER]:
  - **Both v1 and v1beta:** function calling, structured output, thinking, system instructions, code execution, Google Search, Maps, URL context, file search, Models API and Files.
  - **v1beta only:** audio output (speech config/TTS), service tier (Flex/Priority), computer use, MCP, the Live API and ephemeral tokens, Agents, Webhooks, and context caching.
  - The SDKs default to v1beta and can be switched with `http_options={'api_version': 'v1'}` [VER].
  - Some migration-guide samples use `/v1beta2/interactions`. This looks like a documentation inconsistency [MIG].
- **Methods:** create, get (`?stream=true&last_event_id=` resumes a stream; `include_input`), cancel (`POST /interactions/{id}/cancel`), and delete [REF]. No list method is documented [REF].
- **Auth: TRUE.** Use the header `x-goog-api-key: $GEMINI_API_KEY` [IA][KEY]. The SDKs read `GEMINI_API_KEY` or `GOOGLE_API_KEY`, and **`GOOGLE_API_KEY` wins if both are set** [KEY][PYSRC README].
- **New key rules:**
  - From May 28, 2026, new AI Studio keys are "authorization keys" bound to a service account [KEY].
  - The API **rejects unrestricted standard keys**; standard keys with explicit restrictions still work [KEY].
- **Schema revision:** the May 2026 `outputs`→`steps` schema became default on May 26, and the legacy schema was removed on June 8, 2026 [BC][CL]. The current Python SDK still sends `Api-Revision: 2026-05-20` [PYSRC `_hooks/google_genai_auth.py`]. Whether raw clients still need this header is UNCONFIRMED; it appears to be a no-op now.

## 2. Streaming

- **Request:** set `stream: true` to get SSE. Each event has `event:` set to its name and a `data` payload carrying `event_type` [STR].
- **SSE event types in the reference and spec:** `interaction.created`, `interaction.status_update`, `step.start`, `step.delta`, `step.stop`, `interaction.completed`, and `error`. The stream then ends with `event: done` / `data: [DONE]` [REF][SPEC][STR].
- **Status enum:** `in_progress, requires_action, completed, failed, cancelled, incomplete, queued` [REF].
- **How content arrives** (every event carries an `index` that ties it to a step) [STR][TH]:
  - **Initial content in `step.start`:** `step.start` can already contain content, so parse it as well [TH example].
  - **Audio and images:** `audio` and `image` deltas carry base64 `data` [STR][TTS].
- **Usage:** sent on `interaction.completed` as `interaction.usage`. Fields:
  - Totals: `total_tokens`, `total_input_tokens`, `total_output_tokens`, `total_thought_tokens`, `total_cached_tokens`, `total_tool_use_tokens`.
  - Per-modality arrays (`input_`, `output_`, `cached_`, `tool_use_tokens_by_modality`).
  - Per-step `usage`/`step_usage` on `step.stop` is documented only for the Antigravity agent [STR][SPEC].
- **Errors mid-stream:** an `error` event, e.g. `{"error":{"code":"gateway_timeout","message":"…"},"event_type":"error"}` [STR][ERR]. Whether partial text already streamed stays valid is UNCONFIRMED.
- **Resume:** events carry `event_id`. Reconnect with `GET /interactions/{id}?stream=true&last_event_id=…` [REF][SPEC].
- **Forward compatibility:** "log and skip any events you don't recognize" [STR].

## 3. SDKs

- **google-genai (Python) supports Interactions** through `client.interactions.create/get/delete/cancel`. Streaming uses `stream=True` and yields typed `InteractionSSEEvent` objects (`event.event_type`, `event.delta.type`). Async is available as `client.aio.interactions` [IA][STR][PYSRC `client.py`].
- **Minimum versions:**
  - Interactions: ≥2.3.0 per the docs [IA]; ≥2.0.0 for the post-May schema, since 1.x broke on June 8 [BC].
  - 3.8 TTS and the Voices API: ≥2.25.0 [TTS].
  - Latest release: **2.29.0 (2026-10-07)**; requires Python ≥3.10; **Apache-2.0** licence [PYPI].
- **Retries and timeouts:** default exponential backoff (0.5 s initial, 8 s cap, ×2, 30 s max elapsed) on HTTP 408, 409, 429 and 5xx [PYSRC `_gaos/google_genai.py`, `_gaos/interactions.py`].
  - Configure through `HttpOptions(retry_options=…, timeout=…)` or the per-call `timeout=` [PYSRC].
  - The client's default is about 3 attempts (`_DEFAULT_MAX_RETRIES = 2` + 1), inferred from source.
  - The Interactions client is generated with Speakeasy [PYSRC].
- **Other official SDKs:** JS `@google/genai` (≥2.3.0 for Interactions), Go `google.golang.org/genai`, Java `com.google.genai:google-genai`, and C# `Google.GenAI` [LIBS][IA]. Interactions support in C# is UNCONFIRMED.

## 4. Data use

- **Free (unpaid) tier** [TERMS][PRICE]:
  - Prompts and responses are used "to provide, improve, and develop Google products".
  - Human reviewers may read them.
  - "Do not submit sensitive, confidential, or personal information".
- **Paid tier** [TERMS][ABUSE]:
  - Content is not used to improve products and is processed under the Data Processing Addendum.
  - Prompts and outputs are logged for **55 days** for abuse monitoring, and may be stored transiently in any country.
  - Separately, stored interactions are retained for 55 days (1 day on free) unless `store=false` [IA].
- **Region rule:** in the **EEA, Switzerland and the UK only Paid Services may be offered** to users [TERMS].
- **Age and use:** the terms require users to be **18+**, forbid services "likely to be accessed by individuals under the age of 18", and say the Gemini API is "for developers … for professional or business purposes, not for consumer use" [TERMS].
- **Logs shared with Google:** datasets shared from logs fall under unpaid-service terms [LOGS].

## 5. Text-to-speech

- **Model IDs** (GA 2026-09-22) [CL][MTTS]:
  - `gemini-3.8-flash-tts`: flagship, 130 languages.
  - `gemini-3.8-flash-lite-tts`: low latency and cost, 101 languages; recommended for "real-time voice agent cascades".
  - `gemini-3.1-flash-tts-preview` shuts down on 2026-11-17; the 2.5 TTS previews shut down the same day [DEP].
- **API surface:**
  - **Interactions:** `response_format:{"type":"audio"}` with `generation_config.speech_config:[{"voice":"Kore"}]` [TTS]. Single-speaker uses an array; multi-speaker uses `{"speakers":[…]}`.
  - **generateContent** is also supported [MTTS].
  - **Not the Live API** ("Live API: Not supported") [MTTS].
  - **v1beta only:** speech config is not available on v1 [VER].
  - Note: the Interactions overview's model table lists only the 3.1 TTS preview, which looks like a stale doc [IA].
- **Input format:** text is a verbatim transcript. Per-turn style goes in `annotations:[{"type":"speech_metadata","style":…,"speaker":…}]`. Inline tags such as `<laugh>`, `<sigh>` and `<short pause>` mark vocal events [TTS].
- **Streaming:** `stream:true` returns `step.delta` events with `delta.type=="audio"` and base64 `data` [TTS]. The streaming default is **headerless `audio/l16`, 24 kHz, mono, 16-bit LE**; unary requests default to WAV with a RIFF header [TTS].
  - `response_format.mime_type` options: `audio/wav`, `audio/l16`, `audio/mulaw`, `audio/alaw`, plus `sample_rate` (for example 24000, 16000 or 8000) [TTS].
  - The reference also lists `audio/mp3` and `audio/ogg_opus`, plus `bit_rate` and `delivery: inline|uri` [REF]. MP3/Opus support on the TTS models is UNCONFIRMED.
- **Voices** [TTS][VD][BLOGTTS]:
  - 30 prebuilt voices (Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, … Sulafat).
  - An Extended Voice Library via `GET /v1beta/voices`, described as "hundreds" in the docs and "2,000+" in the blog post.
  - **Voice design**: `POST /v1beta/voices` with `type:"prompted"` returns a persistent `voice_…` ID.
  - Voice replication.
  - Limits: 200 custom voices per project, kept for 1 year from last use; stateless voice keys last 7 days.
  - Replication is unavailable in AI Studio in Illinois, Texas, the EEA, UK, Switzerland and India.
  - All output carries a SynthID watermark.
- **Multi-speaker:** at most 2 speakers using prebuilt voices [TTS].
- **Recommended pattern for agents:** "one TTS call per turn as LLM text chunks arrive", keeping the style string empty or constant [TTS].
- **Limits:** input 8,192 tokens; output 16,384 tokens [MTTS]. At 25 audio tokens per second that is about 11 minutes of audio (calculated). Rate limits are shown only in AI Studio [RL].
- **Latency:** no number is published (UNCONFIRMED) [BLOGTTS][MTTS].
- **Pricing per 1M tokens, Standard tier (25 audio tokens/s)** [PRICE]:

  | Model | Text input | Audio output | Per minute of audio (calculated) |
  |---|---|---|---|
  | 3.8 Flash TTS | $0.50, then $1.00 | $9.00, then $18.00 | about $0.0135, then $0.027 |
  | 3.8 Flash-Lite TTS | $0.50, then $1.00 | $6.00, then $12.00 | about $0.009, then $0.018 |

  - Voice design and replication pricing is UNCONFIRMED.

## 6. Other material facts

- **Rate limits:** applied per project, not per key; daily quotas reset at midnight Pacific; values are shown only in AI Studio [RL].
  - Usage tiers: Free; Tier 1 ($250 cap); Tier 2 ($100 paid + 3 days; $2,000 cap); Tier 3 ($1,000 + 30 days) [RL].
  - **Spend-based limits per rolling 10 minutes:** $10 for Tier 1, $50 for Tier 2, $200 for Tier 3 (HTTP 429) [RL].
  - Priority traffic gets 0.3× of the standard limits [RL].
- **Regions:** the API is available only in listed countries; China, Hong Kong and Russia are not listed [REG].
- **Deprecations:** 3.1 Flash TTS preview, 2.5 TTS previews, 3.1 Flash Live preview and 2.5 native-audio preview all shut down **2026-11-17**; 3.1 Flash-Lite shuts down 2027-05-07 [DEP].
- **Pricing change:** introductory prices for 3.8/3.6 Flash and 3.8 TTS **double on 2027-01-01** [PRICE].

## 7. SDK client isolation (source audit, 2026-10-10, `google-genai` 2.29.0)

- **Environment reads.** Besides `GOOGLE_API_KEY` and `GEMINI_API_KEY`, the SDK reads `GOOGLE_GEMINI_BASE_URL`, `GOOGLE_VERTEX_BASE_URL`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_ENTERPRISE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_CLIENT_MODE`, `GOOGLE_GENAI_REPLAYS_DIRECTORY`, `GOOGLE_GENAI_REPLAY_ID`, `SSL_CERT_FILE` and `SSL_CERT_DIR`.
- **Interactions sub-client.** It also reads `GOOGLE_GENAI_API_KEY`, `GOOGLE_GENAI_ACCESS_TOKEN` and `GOOGLE_GENAI_DEFAULT_HEADERS` (only when no credential is passed), and `GOOGLE_GENAI_DEBUG`, which logs every request's headers, key included.
- **Key fallback.** A blank `api_key` falls back to the environment, so a blank key must be refused before building the client.
- **Retries.** The parent client makes one attempt when `retry_options` is unset. The Interactions sub-client translates the same options into its own retry count: unset gives three retries, and any `attempts` value leaves at least one, because the parent rewrites `attempts=0` to 1 first. Setting the sub-client's shared configuration to retry strategy `none` turns it off.
- **Errors.** Interactions calls raise classes from the private `google.genai._gaos.lib.compat_errors` module (`APIStatusError` subclasses with `status_code`, and `APIConnectionError`). Other calls raise `google.genai.errors.APIError` or plain `httpx` errors.
- **New dependencies.** `google-genai` 2.29.0 adds `google-auth` 2.61.0, `pyasn1` 0.6.4 and `pyasn1-modules` 0.4.2 to the lock; its other dependencies were already present.
- **In this branch.** `adapters/voice/gemini_client.py` builds a client pinned against all of the above, and `tests/test_gemini_sdk_isolation.py` checks it with every variable set to a decoy. `tests/live/test_gemini_tts_contract.py` measures latency, format, byte order and style on both 3.8 TTS models; it has not been run.

---

## Implications for Animama

1. **Endpoint:** audio output needs `v1beta`; pin the base URL and version.
2. **Key handling:** hold `GEMINI_API_KEY` on the backend like the ElevenLabs key; never let the SDK fall back to the environment (section 7).
3. **Streaming:** request `audio/l16` at 24 kHz with `store: false`; relay base64 PCM frames as the ElevenLabs finalized flow does. Confirm the byte order: RFC 2586 L16 is big-endian, while the browser decoder assumes little-endian.
4. **Agents pattern:** Google recommends one TTS call per turn as text chunks arrive, with an empty or constant style; Animama's finalized flow already batches by sentence or paragraph.
5. **Style:** the speaking style goes in `annotations: [{type: speech_metadata, style}]`; map the reply's emotional tone to a style string.
6. **Voices:** 30 prebuilt voices need no listing endpoint; voice design (`voice_…` IDs) is deferred.
7. **Terms:** 18+, developer use, free-tier training and paid-only in the EEA, UK and Switzerland; SynthID watermark on all output.
8. **Latency:** no published figures; measure with the live test before choosing chunking.

---

## Appendix: Animama voice architecture (read-only map, 2026-10-10, source `199e96ec`)

There is no generic cloud TTS or STT abstraction in the live chat path. ElevenLabs is wired
through the backend and the frontend, and all STT runs in the browser.

### Text-to-speech providers and selection

- **Providers:**
  - `browser` (Web Speech);
  - `pocket_tts` (in-browser ONNX);
  - `elevenlabs` (brokered by the backend).
- **Legacy adapters:** `adapters/voice/kokoro_http.py` and `echo.py` are unused.
- **Selection:**
  - provider types: `web/src/lib/settings/preferences.ts`;
  - provider list and ordering: `lib/speech/tts-provider.ts`;
  - per-Anima settings: `speech.tts_provider` and the ElevenLabs voice ID in
    `ui/animas/VoiceLoadoutSection.tsx`;
  - creation and setup enums: `app/anima_creation_contract.py`,
    `create-anima/*` and `local-runtime/setup*`.

### From chat reply to playback

1. `useChatSession.ts` sets `dispatch_options.tts`.
2. The backend validates the provider with a Literal: `app/contracts/dispatch.py`
   and `app/chat/options.py`.
3. `server/routers/chat/chat_sse.py` starts one of two flows:
   - **Realtime:** `routers/chat/tts.py` returns a single-use token, and the browser
     connects to the ElevenLabs WebSocket.
   - **Finalized:** `tts.py` and `server/elevenlabs_service.py` relay base64
     `pcm_24000` frames as `tts.audio`, `tts.done` and `tts.error` on the chat SSE
     stream. This is the natural template for Gemini TTS.
4. `server/sse_events.py` hard-codes `provider: "elevenlabs"`.
5. The frontend handles the frames in `product-ui/.../useChatSse.ts`,
   `useProductChatSession.ts` and `session-bindings.ts`, and plays them through
   `hooks/use-tts-playback.ts`.

### Lip-sync

- `server/gruut_text.py` produces phonemes, which become visemes in the browser.
- `stores/avatar-lipsync-bridge-store.ts` accepts only `pocket_tts` and
  `elevenlabs`.
- Providers must emit audio start, duration, playback-ended and ended signals.

### Credentials

- **Store:** `app/model_clients/credential_store.py`.
- **Desktop vault:** `desktop/.../vault.ts`, which lists `"gemini"` in
  `retiredProviders`.
- **Provider list and settings:** `shared/desktop-runtime.ts` and
  `DesktopCredentialsPanel.tsx`.
- **Compose:** `docker-compose.yml`.

### Speech-to-text (out of scope here)

STT runs only in the browser: Parakeet (worker), Web Speech, and Smart Turn v3.2 for
end of turn.

### Ports

- `app/ports/voice.py` defines `SpeechToTextProvider` and `TextToSpeechProvider`, and
  `domain/audio.py` defines the 24 kHz pcm16 synthesis chunk.
- The bounded speech service (`app/services/bounded_speech.py`) exists but no route
  uses it.
- Chat TTS does not go through these ports.

### Hosted

- `provider_credentials` and `offline_speech_enabled` are false.
- Speech reserves allowance before dispatch and settles afterwards. Allowance
  exhaustion falls back to Pocket TTS. Both are ElevenLabs-only today; see
  `contracts/hosted-web.md`.

### Further findings (2026-10-10, source `6a76c31f`)

- The finalized ElevenLabs flow (`server/routers/chat/tts.py`,
  `FinalizedTtsStreamBootstrap` and `_stream_batch`) already has
  provider-neutral batching, silence, queueing, cancellation and ordering; the
  provider call in `_stream_batch` is the seam.
- `server/sse_events.py` hard-codes `"provider": "elevenlabs"` in five places.
  The `tts.*` frames are hand-typed in `useChatSse.ts`, not in OpenAPI.
- `app/contracts/dispatch.py` and `app/chat/options.py` accept only the
  existing providers, and `options.py` silently drops unknown ones.
- Playback hard-codes 24 kHz little-endian PCM
  (`use-elevenlabs-finalized-tts-runtime.ts`). Lip-sync guards for
  `pocket_tts`/`elevenlabs` exist in `useChatSession.ts`,
  `useProductChatSession.ts` and `avatar-lipsync-bridge-store.ts`.
- The structured reply's `emotional_tone` enum is named for ElevenLabs
  (`ELEVENLABS_EMOTIONAL_TONE_VALUES`). The ElevenLabs prefix takes its level
  from the Anima's pre-turn emotional state, and finalized TTS starts only once
  the tone is known.
- There is no voice-list endpoint and no missing-key state for voice; a missing
  key surfaces as `tts.error`.
- The desktop vault's `retiredProviders` drops stored `gemini` entries on load
  (`vault.ts:69,180-184`); `desktop/tests/runtime-state.test.ts:247-273` pins
  that a legacy entry exposes no `GEMINI_API_KEY`.

### Docs to update for a new voice provider

- `docs/backend/integrations/voice-and-speech.md`
- `docs/frontend/runtime/voice.md`
- `docs/frontend/runtime/elevenlabs-tts.md`, plus a new Gemini page indexed in
  `docs/frontend/README.md`
- `docs/frontend/runtime/avatar-lipsync.md`
- `docs/frontend/runtime/chat.md`
- `docs/backend/architecture/http-api.md`
- `docs/frontend/features/model-settings.md`
- `docs/backend/operations/desktop-runtime.md`
- `contracts/hosted-web.md`
- the related ADRs: 0003, 0010, 0012 and 0017
