# Gemini text-to-speech execution plan

Status: Authorized by the owner's `/implement` on 2026-10-11. In progress.

Source agreement: [spec](gemini-tts-spec.md), agreed by the owner on
2026-10-11 (D3, D4, D7, D8, D12, D14 carried over; D15–D17 new). It becomes the
parent issue [#457](https://github.com/raymond-van/animama/issues/457), published on 2026-10-11 from
the snapshot at `f63e2071`; the issue is authoritative. Research:
[gemini-tts-research.md](gemini-tts-research.md).

Authorized scope: phases 1–4, by the owner's `/implement` on 2026-10-11. Explicit
gates:

- **Live measurement** (Phase 1): authorized by D16, under US$0.10.
- **Owner listening check** (Phase 4).

Exact-candidate merge approval stays separate.

Starting source: `fd4fea0f` on branch `feat/gemini-tts`, checkout
`worktrees/animama/gemini-model-provider` (the folder keeps its earlier name).
The branch was recreated from `origin/main` (`515851fb`) with the spec and
research (`27cc0200`), the isolated SDK client (`db30d213`) and this plan
(`c4bbf579`), then merged `origin/main` (`f7eb367c`), which moved the chat SSE
and TTS modules from `server/` to `product_http/chat/`.

## Purpose and context

After this plan, an installation owner on desktop or a self-hosted local stack
can add a Gemini API key and choose Gemini as an Anima's voice. The backend
streams Gemini audio for each reply in the Anima's chosen prebuilt voice, with
a speaking style taken from the reply's emotional tone, and the browser plays
it with lip-sync, exactly as it plays finalized ElevenLabs audio. A missing key
or a failed request shows a voice error and never breaks the chat.

Gemini is not a chat model provider. Hosted compositions, speech-to-text, the
Live API, and voice design and replication are out of scope.

Ownership and boundaries:

- **Backend** (`src/backend/animama/`): the key, the voice service, the
  finalized TTS provider seam, dispatch contracts and composition gating.
- **Frontend** (`src/frontend/`): voice settings, playback, lip-sync, the
  desktop key and the generated client (regenerated offline, never
  hand-edited).
- **Rules:** API calls go through `google-genai` only, using
  `adapters/voice/gemini_client.py`, which passes the key explicitly, pins the
  host and `v1beta`, and turns off SDK retries and header logging. The key
  never reaches the browser. No database change is expected; Anima voice
  choices live in the existing preferences JSON.

## Progress

- [x] Phase 1: Live measurement and the backend Gemini voice. Done
      2026-10-11; Review #3 passed (repair round 2).
- [x] Phase 2: Voice settings, playback and lip-sync. Done 2026-10-11;
      Review #2 passed (repair round 1).
- [x] Phase 3: Desktop key. Done 2026-10-11; Review #1 passed.
- [ ] Phase 4: Documentation, release note and owner listening check. Docs
      and release note done 2026-10-12, Review #1 passed; the owner listening
      check is pending.
- [x] Final integration review. Review #1 passed; repair round 1 passed
      2026-10-12; repair round 2 rechecked Phase 5's integration and passed.
- [x] Phase 5: Voice samples and the Gemini voice picker (D29). Done
      2026-10-12; Review #2 passed (repair round 1).

## Surprises & Discoveries

Planning, 2026-10-11, code at `db30d213` unless stated:

- **Already done on the branch.** `adapters/voice/gemini_client.py` builds a
  client pinned against every environment fallback the SDK has, with its
  Interactions sub-client's retries and header logging off.
  `tests/test_gemini_sdk_isolation.py` (6 tests) proves it, and
  `tests/live/test_gemini_tts_contract.py` measures latency, format, byte order
  and style. That test has not run.
- **The finalized flow is the seam.** `product_http/chat/tts.py`
  (`FinalizedTtsStreamBootstrap`, `_stream_batch`) already has
  provider-neutral batching (`FinalizedTtsSegmentBatcher`, sentence or
  paragraph mode), silence insertion, queueing, cancellation and ordering.
  Only `_stream_batch`'s calls into `server/elevenlabs_service.py`
  (`prepare_finalized_tts_stream_from_text`, `stream_finalized_tts_chunks`) are
  ElevenLabs-specific. The flow starts once the reply's `emotional_tone` and a
  gruut segment are known (`start_if_ready`), and `run.completed` waits for
  audio (`app/chat/completion.py:32-46`).
- **Hard-coded provider names.**
  - `product_http/chat/sse_events.py` writes `"provider": "elevenlabs"` and
    ElevenLabs defaults in the `tts.audio`, `tts.done` and `tts.error` frames.
    `tests/fixtures/chat_sse_golden/tts-finalized.sse` pins today's frames.
  - `app/contracts/dispatch.py:13-21` accepts `browser`, `pocket_tts` and
    `elevenlabs`, with an ElevenLabs-typed `model_id`;
    `app/chat/options.py:181-211` silently drops unknown providers and models.
  - `product_http/chat/tts.py` (`elevenlabs_tts_options`) selects the
    finalized flow only for ElevenLabs `eleven_v3`.
  - Frontend: `TTS_PROVIDERS` (`lib/speech/tts-provider.ts:11-23`), the
    dispatch builder (`ui/main/chat/useChatSession.ts:328-360`,
    `lib/chat/elevenlabs-chat-tts-dispatch.ts`), the finalized gates in
    `product-ui/src/chat/useProductChatSession.ts:1284-1323` and
    `hooks/use-tts-playback.ts:1258-1295,1404-1413,1490-1530`, and the
    lip-sync guards in `useChatSession.ts:115,181,222`,
    `useProductChatSession.ts:909-920` and
    `stores/avatar-lipsync-bridge-store.ts:80,510-527`.
- **Frames are not in OpenAPI.** The `tts.*` frames are hand-typed in
  `product-ui/src/query/mutations/useChatSse.ts:78-130,207-229`. Only the
  dispatch options (`PyAnimaTtsRunOptions`) and `CreationVoice` are generated.
- **Playback** decodes base64 as 24 kHz little-endian PCM
  (`hooks/use-elevenlabs-finalized-tts-runtime.ts:7,79-99`). Gemini streams
  `audio/l16`, which RFC 2586 defines as big-endian; Phase 1 measures it.
- **Lip-sync** uses gruut phonemes from `user.response` and the sample-count
  duration; it needs no provider timing data.
- **Emotional tone.** The reply's `emotional_tone` enum is
  `ELEVENLABS_EMOTIONAL_TONE_VALUES` (`app/main_structured_response.py:55-59`);
  `app/voice_emotional_tone.py:17-52,132-188` builds the ElevenLabs tag from the
  tone and the Anima's pre-turn emotional level.
- **Availability.** Provider options depend only on browser capabilities
  (`tts-provider.ts:129-234`); no voice provider reports a key state. The
  hosted composition requires `provider_credentials: false`
  (`app/hosted-runtime/hosted-composition.ts:423-439`), and the local runtime
  reports `true` (`server/runtime_capabilities.py:75`).
- **Composition flags** follow `app.state` attributes that default to off
  (`server/web_search.py:28-31`), so a hosted composition that does not set one
  keeps today's behaviour.
- **Key handling.** `ELEVENLABS_API_KEY` is a process credential loaded at
  startup and deliverable from the desktop vault
  (`app/model_clients/credential_store.py:29,79-100`), read per request from
  `runtime_credentials` (`elevenlabs_service.py:182-191`). Owner model
  connections may name only `KNOWN_PROVIDER_CREDENTIAL_ENVS` or
  `ANIMAMA_CONNECTION_*` variables.
- **Vault.** `desktop/src/main-process/runtime/vault.ts:69` lists `gemini` in
  `retiredProviders`, dropped on load and at the next save (:180-184);
  `desktop/tests/runtime-state.test.ts:247-273` pins that a legacy entry
  exposes no `GEMINI_API_KEY`, and `desktop/tests/runtime-ipc.test.ts:202`
  rejects `{provider: "gemini"}`.
- **Per-Anima voice storage.** Anima settings are an unvalidated `preferences`
  JSON (`app/services/settings_service.py:96-129`); the ElevenLabs voice lives
  at `speech.elevenlabs.primary_voice.voice_id`. Package export allows only
  `pocket_tts`, `elevenlabs` and `browser`, defaulting to `elevenlabs`
  (`adapters/repositories/sqlalchemy/anima_package_source_repo.py:74-81`), and
  portable import forces `pocket_tts`.

- **Main moved the chat routes** (merged at `fd4fea0f`): the chat SSE and TTS
  modules now live in `product_http/chat/` behind composition ports. Every
  finalized speech call goes through `ProductSpeech`
  (`product_http/ports.py`), which the local composition implements in
  `server/elevenlabs_service.py` (`LocalSpeech`) and a hosted composition
  implements with its own metering. Golden SSE frames in
  `tests/fixtures/chat_sse_golden/` pin the ElevenLabs frames.
- **Byte order** (Phase 1 live run): Gemini's streamed `audio/l16` is
  little-endian, so no conversion is needed.

## Decision Log

Spec decisions D3, D4, D7, D8, D12, D14 and D15–D17 are in the
[spec](gemini-tts-spec.md#open-questions-and-decisions). Planning decisions:

- **D18 (planning): identifiers.** Provider `gemini`; credential
  `GEMINI_API_KEY`; model ids `gemini-3.8-flash-lite-tts` (default) and
  `gemini-3.8-flash-tts`; per-Anima voice at `speech.gemini.voice`; error codes
  `gemini_tts_missing_credential`, `gemini_tts_stream_setup_failed` and
  `gemini_tts_stream_failed`.
- **D19 (planning): key isolation.** `GEMINI_API_KEY` is a process and
  deliverable credential like `ELEVENLABS_API_KEY`, never in
  `KNOWN_PROVIDER_CREDENTIAL_ENVS`, so no owner model connection can name it.
  Only the Gemini voice service reads it, through the pinned client.
- **D20 (planning): one provider seam.** `_stream_batch` calls a small
  finalized-voice interface implemented by the existing ElevenLabs functions
  and a new Gemini service. Batching, silence, queueing, cancellation and frame
  ordering stay shared. The frame format stays `pcm_24000` little-endian; the
  Gemini service converts byte order if Phase 1 finds big-endian. The SSE
  formatters take the provider and model instead of hard-coding them.
- **D21 (planning): speaking style.** `gemini_speaking_style` beside the
  ElevenLabs tag builder takes the same tone and level and returns one style
  sentence, "Speak in a [slightly |very ]<tone> tone.", with "Speak in a
  friendly tone." for neutral or unknown tones. Every request in a reply
  carries the same style, as Google recommends for streamed agents.
- **D22 (planning; resolved in Phase 1): chunking.** Sentence mode if Phase 1
  measures Flash-Lite TTS's time to first audio at or under 1.5 s for one
  sentence; otherwise paragraph mode. Measured 0.66–1.37 s, so Gemini uses
  sentence mode by default, and an explicit `finalized_chunking: paragraph`
  request is honoured. The owner may revise it at the listening check.
- **D23 (planning; confirmed in Phase 1): prebuilt voices.** One backend
  `Literal` (`app/contracts/gemini.py`) lists Google's 30 prebuilt voices,
  confirmed against the speech generation docs (updated 2026-10-01). The
  `gemini_tts` runtime capability carries the voices and models, so the
  frontend picker and backend validation share the generated enum. The default
  voice is `Kore`; an unknown stored name falls back to it.
- **D24 (planning; revised in Phase 1 for the composition ports): gating.**
  `ChatTurnServices.gemini_speech` is the Gemini finalized-speech port, read
  only when a turn asks for Gemini; the local composition supplies
  `LocalGeminiSpeech`. Where a composition supplies `None`, a Gemini request
  produces no speech frames. The `gemini_tts` runtime capability is likewise
  reported only by the local composition, and the frontend offers Gemini only
  when it is present. This replaces the planned `app.state` flag. Hosted
  behaviour is unchanged; a hosted composition adopting this release adds a
  `gemini_speech` property that returns `None`.
- **D25 (planning): settings placement.** The Gemini TTS model is an
  installation voice preference beside the ElevenLabs model in App Settings;
  the voice is chosen per Anima in its voice section. Setup's voice step and
  the create-Anima voice step stay unchanged.
- **D26 (planning): vault re-admission.** The desktop vault stores keys saved
  by this release under a marker that earlier releases never wrote; an
  unmarked `gemini` entry is still dropped, even in a vault never re-saved.
- **D27 (planning; revised in Phase 1): package export.** No change needed:
  export already includes a voice binding only when the effective provider is
  `pocket_tts`, so a Gemini-voiced Anima exports like an ElevenLabs one, with
  no voice binding and no provider name. A test case pins it.
- **D28 (planning): no ADR.** Gemini extends the existing backend-brokered
  voice pattern (ElevenLabs finalized audio) without a new boundary, so current
  docs record it instead of an ADR.
- **D29 (owner, 2026-10-12): voice samples and picker (Phase 5).**
  - Google publishes no sample audio for the prebuilt voices, so clicking play
    generates a brief sample through the backend with the owner's key. It is
    cached per installation, so each model and voice is billed once.
  - The Gemini voice choice becomes a picker like Pocket TTS's: search,
    All/Female/Male tabs, Google's one-word description, and a play button per
    voice.
    - Genders come from Google Cloud's Gemini-TTS voice list.
    - Descriptions come from the Gemini API speech-generation docs.
  - Delivered in this PR: the new route is a structural API change, and
    `local-http` 5.0.0 has not shipped yet, so no further major is needed.

## Implementation orientation

Backend paths are under `src/backend/animama/`, tests under `tests/`.

- **Client:** `adapters/voice/gemini_client.py` (done); tests
  `tests/test_gemini_sdk_isolation.py`, `tests/live/test_gemini_tts_contract.py`.
- **Credentials:** `app/model_clients/credential_store.py:29,79-100`;
  `server/runtime_credentials.py`; `server/routers/desktop_control.py:152-175`;
  `docker-compose.yml:72` (the ElevenLabs passthrough); `tests/conftest.py`
  (environment scrub).
- **Finalized flow:** `product_http/chat/tts.py`; `product_http/chat/stream.py`
  (formerly `server/routers/chat/chat_sse.py`); `server/elevenlabs_service.py:802-852,995-1144`
  (voice resolution, frame coalescing at 9,600 bytes, in-flight semaphore);
  `product_http/chat/sse_events.py`; `app/chat/completion.py:32-46`;
  golden frames in `tests/fixtures/chat_sse_golden/`.
- **Contracts:** `app/contracts/dispatch.py:13-21`; `app/contracts/elevenlabs.py:75-99`;
  `app/chat/options.py:30-73,181-211`.
- **Style:** `app/voice_emotional_tone.py`; `app/main_structured_response.py:55-59,712-720`.
- **Composition:** `server/web_search.py:28-31` (flag pattern);
  `server/app.py` and the local composition setup;
  `server/runtime_capabilities.py`.
- **Content:** `adapters/repositories/sqlalchemy/anima_package_source_repo.py:74-81`.
- **Frontend** (`src/frontend/`):
  - settings: `web/src/lib/settings/preferences.ts:40-185,380`,
    `web/src/lib/speech/tts-provider.ts`, `web/src/ui/sidebar/ApplicationSettingsModal.tsx:703-860`,
    `web/src/ui/animas/VoiceLoadoutSection.tsx:53-438`;
  - dispatch and session: `web/src/ui/main/chat/useChatSession.ts:94-360`,
    `web/src/lib/chat/elevenlabs-chat-tts-dispatch.ts`,
    `packages/product-ui/src/chat/session-bindings.ts:53-153`,
    `packages/product-ui/src/chat/useProductChatSession.ts:909-1323`,
    `packages/product-ui/src/query/mutations/useChatSse.ts:78-448`;
  - playback and lip-sync: `web/src/hooks/use-tts-playback.ts`,
    `web/src/hooks/use-elevenlabs-finalized-tts-runtime.ts`,
    `web/src/stores/avatar-lipsync-bridge-store.ts`;
  - desktop: `shared/desktop-runtime.ts:5-10`, `desktop/src/main-process/runtime/vault.ts:63-69,180-184`,
    `web/src/ui/settings/DesktopCredentialsPanel.tsx:31-35,259-266`.
- **Tests to mirror:** `tests/test_anima_chat_sse.py` (finalized TTS cases)
  and the golden SSE tests;
  `tests/test_elevenlabs_realtime_router.py:51-399`;
  `web/src/hooks/use-tts-playback.test.tsx:201-535`;
  `web/tests/speech/elevenlabsTtsRuntime.test.ts`;
  `packages/product-ui/tests/chat-lifecycle.test.mjs:512-675`;
  `web/src/lib/speech/tts-provider.test.ts`; `avatar-lipsync-bridge-store.test.ts`;
  `VoiceLoadoutSection.test.tsx`; `preferences.test.ts`;
  `desktop/tests/runtime-state.test.ts`, `runtime-ipc.test.ts`;
  `DesktopCredentialsPanel.test.tsx`.

## Setup and execution rules

1. Workspace setup is done (2026-10-11): parent #457, with phase issues #458,
   #459, #460 and #461 (phases 1–4) as sub-issues, each blocked by the previous
   phase. The branch was pushed at `f63e2071`.
2. Offline work needs no stack. Phase 2's visual check and Phase 4's listening
   check use a named task stack, after checking `docker ps` for port conflicts:

   ```bash
   COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env" ./reset.sh --name gemini-tts --base-port 8860
   source .animama-stack.env
   ```

   Never copy, source or print a secrets file or `.env`.
3. Live runs use
   `ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/<file>`
   and stay within D16; each run costs a few cents.
4. Work test-first. Offline tests use fake SDK clients or `httpx` mock
   transports, never keys or the network.
5. Before each phase commit: the phase's checks and an independent
   `sdlc-reviewer` review (one full review, at most two repair rounds). Commit
   as `<type>(voice)[p#]: <summary>` (or scope `settings` or `desktop` where
   clearer), with no attribution lines. Stop and report blockers left after the
   repair budget.
6. Pushes to an open PR start billed hosted CI; batch them.
7. If the venv resolves to Python 3.14, run `uv sync --python 3.12.13` before
   `pnpm openapi-ts`. `web:test` failures in `tests/local-api-proxy.test.ts`
   are environmental only when another process holds port 5173.

## Phased implementation

### Phase 1: Live measurement and the backend Gemini voice

Requirements: R1 (backend), R2 (backend). Decisions: D14, D16, D18–D24, D27.

Outcome: a chat request that asks for Gemini voice streams Gemini audio as
`tts.audio` frames in the existing format, in the Anima's voice and a
tone-derived style, and fails cleanly without breaking the chat. Only the local
composition allows it.

1. **Measure (gate D16).** Run `tests/live/test_gemini_tts_contract.py`
   once. Record time to first audio, chunk sizes, format, sample rate, byte
   order and whether the style is accepted, for both models. Resolve D22 and
   the byte order. Confirm the prebuilt voice list against Google's speech
   generation docs (D23).
2. **Key (D19).** Add `GEMINI_CREDENTIAL_ENV` to the process and deliverable
   sets in `credential_store.py`, not the known set; pass
   `GEMINI_API_KEY: ${GEMINI_API_KEY:-}` to `animama-server` in compose; extend
   the test scrub. A missing key raises the D18 missing-credential code.
3. **Contracts.** Accept `gemini` in `PyAnimaTtsRunOptions` and
   `DirectChatTtsOptions`, with a per-provider `model_id` (the two Gemini ids)
   and `finalized_chunking`. Keep dropping unknown values. Add the D23 voice
   enum to a generated schema.
4. **Provider seam (D20).** Route `_stream_batch` through a finalized-voice
   interface; the ElevenLabs path keeps its behaviour and tests. Parameterize
   the SSE formatters' provider and model.
5. **Gemini service** (`server/gemini_tts_service.py`): resolve the Anima's
   voice from `speech.gemini.voice` (default `Kore`); stream one Interactions
   request per batch with the pinned client, `store: false`, `audio/l16` at
   24 kHz, `speech_config: [{voice}]` and the D21 style; coalesce frames to the
   ElevenLabs size; convert byte order if needed; cap requests in flight like
   ElevenLabs; map failures to the D18 codes without logging text or keys.
6. **Style (D21)** beside `elevenlabs_v3_text_with_emotional_prefix`.
7. **Composition (D24, as revised).** The local composition supplies
   `ChatTurnServices.gemini_speech` and the `gemini_tts` capability; without
   the port a Gemini request produces no speech.
8. **Content (D27, as revised).** Package export needs no change; a test pins
   that a Gemini voice exports no voice binding.
9. Regenerate the client offline and fix type fallout for `pnpm check`.

Tests: options and contract validation; the seam keeps every ElevenLabs
finalized test passing; Gemini ordering, chunking, style per request, frame
format and byte order, failure without `tts.done`, early-close cancellation,
audio before `run.completed`, missing key; composition refusal; voice
fallback; package export; key isolation (an owner connection naming
`GEMINI_API_KEY` is refused; `GOOGLE_API_KEY` is never read; the key is absent
from frames and logs).

Live: add a service-level check to `test_gemini_tts_contract.py` (one
two-sentence reply through `server/gemini_tts_service.py`) and run it once
within D16.

Checks: focused tests, `make check-test`, `uv lock --check`, both compose
config commands, `pnpm check`.

Completion: tests pass; D22 and the byte order are recorded; review leaves no
blocker.

Phase record: issue #458; starting source `fd4fea0f`; commit `65c37cca`.

Results (2026-10-11, working tree on `077b8c8f`):

- **Live measurement** (D16), `tests/live/test_gemini_tts_contract.py`, 8
  requests on both models, one and three sentences, with and without a style:
  all completed, `audio/l16@24000`. Little-endian (neighbouring-sample score
  about 590–1,420) against big-endian (about 14,900–18,400). Time to first
  audio: Flash-Lite 0.66–1.37 s, Flash 0.81–1.02 s; chunks of 1,920 or 3,840
  bytes. The style was accepted on both. Spend under US$0.01. Command:
  `ANIMAMA_RUN_LIVE_TESTS=1 uv run --env-file "$HOME/.config/animama/dev-secrets.env" pytest -q -s tests/live/test_gemini_tts_contract.py`.
- **Service live check:** two sentences through
  `server/gemini_tts_service.py` with voice `Puck` and style "Speak in a very
  happy tone.": first frame 1.22 s and 0.71 s, 8 frames each, then `done`.
- **Implementation:**
  - `app/contracts/gemini.py`: model ids, the 30 voices, defaults and the
    `GeminiTtsCapability`; `RuntimeCapabilities.gemini_tts`, set by the local
    composition.
  - `GEMINI_API_KEY` is a process and deliverable credential, not an
    owner-connection name; compose passes it to `animama-server`.
  - Dispatch and chat options accept `gemini` and its two models.
  - `product_http/ports.py`: `FinalizedSpeechPort` (prepare and stream), which
    `ProductSpeech` now extends, and `ChatTurnServices.gemini_speech`.
  - `product_http/chat/tts.py`: the finalized bootstrap takes a provider;
    Gemini resolves the Anima's voice from `speech.gemini.voice`, styles every
    request, never sends continuity text, and names itself in frames and
    error codes. ElevenLabs strings and codes are unchanged.
  - `product_http/chat/sse_events.py`: the `tts.*` formatters take a
    provider, defaulting to ElevenLabs.
  - `server/finalized_speech.py`: gruut text preparation and PCM framing,
    shared by `elevenlabs_service.py` and the new `gemini_tts_service.py`
    (`LocalGeminiSpeech`, one client per key, three requests in flight,
    `store: false`, status-only error text).
  - `app/voice_emotional_tone.py`: `gemini_speaking_style`.
  - The generated client is regenerated offline.
- **Tests:** `tests/test_gemini_tts.py` (key sets, contracts, options,
  capability, style, prepare, stream framing, failures, safe errors, client per
  key); four route tests in `tests/test_anima_chat_sse.py` (voice and style
  per sentence, missing key with the reply kept, provider failure with the
  reply kept, no port → no speech); export
  and owner-connection refusal cases. Three ElevenLabs tests now patch the moved
  helpers.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`077b8c8f` plus the committed client groundwork (`db30d213`). **Result: pass,
no blocking findings.** Checks run by the reviewer: ruff, format check, the
import-boundary script (0 forbidden edges), mypy on the changed files, 481
focused backend tests, `uv lock --check`, both compose configs,
`openapi-ts --check` and `tsc --noEmit` for the frontend packages.

- **P1-R1-F1:** the "no key in logs" test read only `getMessage()`, while the
  logger adapter writes keyword arguments as record extras.
- **P1-R1-F2:** the test environment scrub lacked `GEMINI_API_KEY` and
  `GOOGLE_API_KEY` (plan step 2).
- **P1-R1-F3:** an ElevenLabs request with a Gemini model id now validated and
  failed later as a `tts.session.error`.
- **P1-R1-F4 (optional):** "Speak in a amused tone." for vowel-initial tones.
- **P1-R1-F5:** the stream's missing-key branch used the stream-failed code.
- **P1-R1-F6:** a client construction error escaped the status-only error text.
- **P1-R1-F7:** `ChatTurnServices.gemini_speech` is a required protocol
  member; a composition lacking it fails a crafted Gemini request.
- **P1-R1-F8 (optional):** simplifications: the no-port branch, the failure
  label special case, a duplicated text-basis constant, the key digest, and an
  unclosed client after key rotation.
- **P1-R1-F9 (optional):** `google.genai` loaded at app startup (about
  0.2 s) for every installation.
- **P1-R1-F10 (optional):** the SDK stream is closed by garbage collection when
  the consumer stops early, as on ElevenLabs.
- **P1-R1-F11:** no Gemini route test for a provider failure, nor a
  Gemini-specific cancellation test.
- **P1-R1-F12:** plan steps 7–8 and a test count were out of date.

#### Code Review #1 Revisions

- **F1 (fixed):** the test checks every record's full `__dict__`.
- **F2 (fixed):** `tests/conftest.py` scrubs both names, keeping
  `GEMINI_API_KEY` only for live runs.
- **F3 (fixed):** `PyAnimaTtsRunOptions` rejects a model id that does not match
  the provider, and `_normalize_tts_options` keeps a model id only for its own
  provider; tests cover both directions.
- **F4 (fixed):** "an" before vowel-initial descriptions; test cases added.
- **F5 (fixed):** that branch now sends `gemini_tts_missing_credential`.
- **F6 (fixed):** any other client setup error yields the safe text and code;
  a test covers it.
- **F7 (accepted, recorded):** D24 already requires adopters to add the
  property; the PR's Cloud follow-up names it. No consumer implements these
  protocols today.
- **F8 (fixed):** a `gemini_finalized_tts_model_id` helper and an early return
  for the no-port case; a `failure_label` field; `finalized_speech.py` imports
  the shared text-basis constant; the cache compares the key directly. A key
  change first also closed the previous client (`aio.aclose()`); Review #2
  found that this cuts off speech in progress, so it was removed (P1-R2-F1).
- **F9 (fixed):** the SDK is imported on the first Gemini request; a check
  shows `google.genai` is not loaded after importing the app.
- **F10 (accepted):** the SDK's own `finally` closes the response and the
  semaphore is released one loop iteration later, the same pattern as
  ElevenLabs.
- **F11 (partly fixed):** a route test now covers a provider failure (one
  `tts.error`, no `tts.done`, `run.completed` sent). Cancellation is shared code
  already covered by the ElevenLabs early-close tests.
- **F12 (fixed):** steps 7–8 and the test count are corrected.

Verification: ruff and format pass; `make mypy` passes (826 files); the
import-boundary script reports 0 forbidden edges; 208 focused tests pass
(`test_gemini_tts`, `test_gemini_sdk_isolation`, `test_anima_chat_sse`,
`test_elevenlabs_realtime_router`, `test_chat_sse_golden`,
`test_product_http_chat_turns`, `test_main_structured_response`).

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Independent `sdlc-reviewer`, targeted recheck (repair round 1) of the same
tree. **Result: pass, no blocking findings.** It verified F1–F6, F8, F9, F11
and F12, found no request shape that the new dispatch validator rejects (the
frontend's only TTS builder and Cloud's hosted speech tests send `elevenlabs`
with ElevenLabs ids, or `browser` with none), and confirmed that importing the
app leaves `google.genai` unloaded. Checks: ruff, format check, the boundary
script (0 forbidden edges), mypy on the changed files, 355 focused tests.

- **P1-R2-F1 (low):** closing the previous client on a key change (the F8
  revision) breaks a stream still using it: a scratch script showed
  `httpx.ReadError` mid-stream and "client has been closed" for a queued
  request, so the rest of that reply would be silent. The SDK's
  `AsyncClient.__del__` already closes a dropped client.
- **P1-R2-F2 (doc):** the Results bullet still said three route tests.
- **P1-R2-F3 (optional):** the F1 test would pass with no captured records.

#### Code Review #2 Revisions

- **F1 (fixed):** `_client` no longer closes the dropped client (and is
  synchronous again); its docstring says why; the test asserts only that a
  changed key builds a new client.
- **F2 (fixed):** four route tests, listed.
- **F3 (fixed):** the test asserts that records were captured.

Verification: ruff, format and mypy pass on the changed files; 31 Gemini tests
pass.

Repair budget: two of two rounds used. Review #3 is the final targeted
recheck.

#### Code Review #3 Findings

Final targeted recheck (repair round 2): **pass, no findings.** It verified
the three Review #2 revisions:

- `_client` is synchronous with one caller and synchronous test doubles;
- a speaking reply keeps its own client reference;
- a dropped `genai.Client` is closed by the SDK once collected, shown by a
  scratch script: the HTTP client went from open to closed after the drop.

It also confirmed the Review #1 and #2 records match the code. Checks: ruff,
format check, mypy on the changed files, 132 focused tests.

#### Code Review #3 Revisions

None needed.

Final validation of the Phase 1 tree:

- `make check-test`: audit, format, lint and mypy pass; 3,983 passed, 29
  skipped and 1 failed. The failure was the Review #2 `caplog.records` guard:
  earlier in the full run, Alembic's `fileConfig` disables loggers that
  already exist, so nothing was captured. Every test file sorting before it
  reproduced the failure. The test now re-enables the service logger and
  captures at it; that same run then passes (1,868 passed, 3 skipped).
- `uv lock --check`, `bash -n reset.sh`, both compose configs and
  `pnpm openapi-ts:check` pass.

### Phase 2: Voice settings, playback and lip-sync

Requirements: R2 (frontend). Decisions: D20, D23–D25.

Outcome: the owner can choose Gemini and its model in App Settings and a
prebuilt voice per Anima; replies play with lip-sync; a voice error shows the
existing "Text-to-speech unavailable" notice while the reply stays.

1. `gemini` joins `TtsProviderPreference`, `TTS_PROVIDERS` and the provider
   options, offered only when runtime capabilities report `gemini_tts` and Web
   Audio is available. It is never chosen automatically.
2. `SpeechPreferences` gains the Gemini TTS model (Flash-Lite default) with a
   select beside the ElevenLabs model in `ApplicationSettingsModal`.
3. `VoiceLoadoutSection` offers Gemini with a select of the generated voice
   enum, saved at `speech.gemini.voice`.
4. Generalize the dispatch builder from `elevenlabs-chat-tts-dispatch.ts` to
   send `{enabled, provider: "gemini", model_id, finalized_chunking}`.
5. Replace the ElevenLabs-only finalized checks in `session-bindings.ts`,
   `useProductChatSession.ts` and `use-tts-playback.ts` with a
   provider-neutral "server-pushed PCM" check, and stop hard-coding the
   emitted provider. Reuse the existing decoder and scheduler.
6. The lip-sync guards in `useChatSession.ts`, `useProductChatSession.ts` and
   `avatar-lipsync-bridge-store.ts` accept `gemini`.
7. `useChatSse.ts` accepts `provider: "gemini"` on `tts.*` frames (no change
   needed: its `provider` field is already any string).

Tests: provider options with and without provider credentials; preferences
defaults; dispatch payload; playback start, duration and end signals for
`gemini`; lip-sync acceptance; the voice select saving and reloading; error
notice with the reply intact; ElevenLabs cases unchanged.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`packages:check`; a visual check of App Settings voice and an Anima's voice
section at 1440×900, then a narrow width, on the task stack.

Completion: checks pass; the visual check matches existing styling; review
leaves no blocker.

Phase record: issue #459; starting source `65c37cca`; commits `bac0c1ac`, and
`65b29b0c` for the package and contract versions (Review #1 F2).

Implementation (2026-10-11):

- **Settings:** `TtsProviderPreference` and `TTS_PROVIDERS` gain `gemini`.
  `getTtsProviderOptions(platform, { gemini })` lists Gemini only when
  runtime capabilities report `gemini_tts`, and automatic fallback never
  chooses it. `SpeechPreferences.tts_gemini_model_id`
  (`GEMINI_TTS_MODEL_OPTIONS`, Flash-Lite default) has a "Gemini model" row in
  App Settings → Voice, shown for the Gemini provider, with a note that Google
  bills the owner's key.
- **Per Anima:** `VoiceLoadoutSection` offers Gemini where it is offered and a
  voice select from the capability's voices, saved at `speech.gemini.voice`.
- **Dispatch:** `buildGeminiChatTtsDispatchOptions` sends `provider: "gemini"`,
  the model and sentence chunking.
- **Session:** `ChatSpeechPolicy.finalizedElevenLabs` becomes
  `finalizedServerAudio` (ElevenLabs v3 or Gemini); the three `tts.*` gates in
  `useProductChatSession` use it, and visemes queue for Gemini.
- **Playback:** `useTtsPlayback` treats Gemini runs as server-pushed: it
  prepares the shared finalized runtime instead of streaming text, routes
  pushed audio, completion and failure to it, and reports the run's own
  provider in the audio signals, so lip-sync accepts Gemini.
  `useChatSession` and the lip-sync store accept `gemini`.
- **Tests:** provider options and fallback; preferences; the dispatch builder;
  Gemini playback (no text streaming, pushed audio, provider in signals);
  lip-sync acceptance; the voice picker with and without the capability; two
  product-ui lifecycle tests (pushed Gemini audio reaches the finalized adapter;
  a Gemini error ends speech without Pocket fallback).
- **Checks:** `pnpm check`, `pnpm web:lint`, `pnpm prettier:check` and
  `pnpm packages:check` pass; `pnpm web:test` 3,900 passed and 1 skipped (463
  files); `pnpm packages:test` passes (product-ui 29 of 29).
- **Visual check** (2026-10-11) on the task stack `animama-gemini-tts`
  (`http://animama-gemini-tts.localhost:8860`, development mode, base port
  8860; only the web app is published):
  - the stack reports `gemini_tts` (2 models, 30 voices) and loads the key;
  - App Settings → Voice lists Gemini, and choosing it shows the "Gemini
    model" row (Flash-Lite TTS) with the billing note, styled like the
    ElevenLabs rows;
  - Loadout → Voices shows "Gemini (app)", the active-provider badge and the
    voice picker; choosing Puck saves `speech.gemini.voice`;
  - at 420 px wide the section fits with no horizontal overflow.

  The desktop-size check used a 1024 px pane (the 1440 × 900 emulation did
  not fit the hidden pane). No spoken reply was played; the owner listening
  check in Phase 4 covers audio and lip-sync.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`65c37cca`. **Result: pass, no blocking findings.** It verified every playback
path for each provider, the Pocket fallback guards, the flag rename, that
Gemini is never chosen automatically, capability timing (local capabilities
arrive with admission), the error notice, lip-sync and voice storage. Checks:
web `tsc`, product-ui check, `web:lint`, `prettier:check`, 171 focused vitest
tests, the product-ui lifecycle file (29 of 29), `git diff --check`.

- **P2-R1-F1:** with a saved `gemini` provider and no `gemini_tts`
  capability, the chat policy dropped Gemini but playback still resolved it,
  prepared a finalized run and waited for audio that never came, leaving the
  avatar thinking; the settings modal showed the same split. Latent: the local
  composition always reports the capability.
- **P2-R1-F2 (required before the PR):** `product-ui` declarations changed
  (and Phase 1 changed the `runtime-contracts` declarations and the OpenAPI
  structure) without the version bumps that `scripts/package-sets/README.md`
  requires.
- **P2-R1-F3:** tests the plan lists were missing: saving the Gemini voice,
  the gate without the capability, the duration signal, and a lifecycle case
  that exercises the allowance guard and keeps the reply text.
- **P2-R1-F4 (optional):** the hosted admission guard did not reject
  `gemini_tts`; step 1 still named `provider_credentials`.
- **P2-R1-F5 (optional):** "Stream chunked Text-to-Speech" stayed enabled for
  Gemini, where it has no effect.
- **P2-R1-F6 (optional):** `isFinalizedServerProvider` was declared as a type
  guard but returns false for realtime ElevenLabs.
- **P2-R1-F7 (optional):** an unknown saved voice showed as is while the
  backend speaks `Kore`; a duplicated fallback.
- **P2-R1-F8 (optional):** the Gemini model type was written by hand.
- **P2-R1-F9 (plan record):** step 7 needed no change; `pnpm build` and the
  visual check were not yet recorded.

#### Code Review #1 Revisions

- **F1 (fixed):** `resolvePreferredTtsProvider` takes `offers`; a saved
  `gemini` without the offer falls back like an unsupported provider.
  `useChatSession`, `useTtsPlayback` (new `geminiTtsOffered` option) and the
  settings modal's initialization pass the offer; the special case in
  `useChatSession` is gone. Tests: resolution with and without the offer, and
  playback that prepares nothing without it.
- **F2 (to do, before the PR):** a separate `build(voice)` commit bumps
  `product-ui` to 0.9.0, `runtime-contracts` to 0.5.0 and `local-http` to 5.0.0,
  updating `contracts/versions.json`, `contracts/hosted-web.md` and
  `docs/backend/architecture/http-api.md`, as in `afc2fc40`.
- **F3 (fixed):** `VoiceLoadoutSection.gemini.test.tsx` checks the saved voice
  (`{speech: {gemini: {voice}}}`) and the default shown for an unknown name;
  the playback test asserts the duration signal; a lifecycle test sends a
  Gemini `tts.error` with the allowance code and checks there is no Pocket
  fallback and the reply text stays.
- **F4 (fixed):** the hosted guard rejects `gemini_tts`, with a test; step 1
  is corrected.
- **F5 (fixed):** the switch is off and disabled for Gemini ("Unavailable with
  Gemini.").
- **F6 (fixed):** it returns a plain `boolean`.
- **F7 (fixed):** an unknown saved voice shows the default; the duplicate
  fallback is gone.
- **F8 (fixed):** `GeminiTtsModelId` is `GeminiTtsCapability["models"][number]`.
- **F9 (fixed):** step 7 notes no change; `pnpm build` passed; the visual
  check is recorded above.

Verification: web `tsc`, `web:lint` and `prettier:check` pass; 75 focused
vitest tests and the hosted-composition tests (66) pass; the product-ui
lifecycle file passes 30 of 30; `pnpm build` passes.

Repair budget: one of two rounds used.

#### Code Review #2 Findings

Independent `sdlc-reviewer`, targeted recheck (repair round 1). **Result: pass,
no blocking findings.** It verified F1 and F3–F9, found no regressions (ElevenLabs,
Pocket and browser resolution are unchanged; setup never offers Gemini; hosted
payloads without `gemini_tts` are still admitted, and no Cloud producer
reports it), and confirmed the recorded F2 bump plan against
`scripts/package-sets/README.md` and `afc2fc40`. Checks: web `tsc`,
`web:lint`, `prettier:check`, 867 vitest tests across the touched and
neighbouring areas, product-ui check, the lifecycle file (30 of 30).

- **P2-R2-F1 (non-blocking):** two comments in `preferences.ts` promised more
  than the code does.
- **P2-R2-F2 (non-blocking):** a playback test's name overstated what the
  mocked resolver shows.
- **P2-R2-F3 (non-blocking):** the hosted Gemini case asserted only
  `unavailable`, which a parse failure also returns.
- **P2-R2-F4 (record):** rerun the full Phase 2 checks on the final tree;
  mention the `finalizedServerAudio` rename with the package bump.

#### Code Review #2 Revisions

- **F1–F2 (fixed):** comments reworded; the test is "does not prepare Gemini
  playback without the composition's offer".
- **F3 (fixed):** a separate test asserts the "incompatible application
  capabilities" message for `gemini_tts`.
- **F4 (done):** the full checks are recorded below; the `build(voice)` commit
  names the rename.

No further review round was needed: Review #2 found no blocking issue and its
revisions are comments, a test name and a test.

Final checks on the Phase 2 tree: `pnpm check`, `pnpm web:lint`,
`pnpm prettier:check` and `pnpm packages:check` pass; `pnpm web:test` passed
its vitest part (3,904 passed, 1 skipped, 464 files) before a 25-minute
command timeout stopped its browser-script tests; rerunning those alone
(`pnpm --filter animama-web test:source`) passed 216 of 216.

### Phase 3: Desktop key

Requirements: R1 (desktop). Decision: D26.

Outcome: on desktop the owner adds, replaces or removes the Gemini key in App
Settings without a restart; earlier releases' retired entries stay dropped.

1. Add `gemini` to `credentialProviders` and the vault environment map
   (`GEMINI_API_KEY`), with the D26 marker; keep dropping unmarked entries.
2. Add Gemini to `DesktopCredentialsPanel` (name and default copy).
3. Keep `runtime-state.test.ts:247-273` passing for the legacy entry; add a
   round trip for the new one; update the IPC test that rejects `gemini`; check
   the backend receives the key through `PUT /credentials` and drops it on
   removal.

Checks: `pnpm desktop:check`, `pnpm desktop:test`, `pnpm web:test` for the
panel, the backend desktop-credentials route tests.

Completion: checks pass; review leaves no blocker.

Phase record: issue #460; starting source `65b29b0c`; commit `a2eba7c6`.

Implementation (2026-10-11):

- `shared/desktop-runtime.ts`: `credentialProviders` gains `gemini` (API Keys
  lists it last).
- `vault.ts`: `gemini` maps to `GEMINI_API_KEY`. Its entry is stored under a
  new `restoredProviders` section that earlier releases never wrote; a legacy
  `providers.gemini` entry stays retired and is dropped on load and at the
  next save, and `restoredProviders` may name only Gemini. In memory the key
  sits with the other providers, so status, delivery and removal are
  unchanged. Earlier releases ignore the new section and keep it when they
  save.
- `DesktopCredentialsPanel` names Gemini, and its default copy mentions
  Gemini voices; App Settings → Voice gains a "Gemini API key" row (desktop
  only, shown where Gemini voice is offered) beside the ElevenLabs one.
- Tests: a vault holding an earlier release's Gemini entry exposes no key, a
  new key round-trips under `restoredProviders` without reviving the old one,
  removal works, and a `restoredProviders` section naming another provider is
  refused; the IPC rejection case now uses another retired name; status lists
  and the panel order include Gemini; the backend parity test expects
  `GEMINI_API_KEY`; a route test applies and removes the key without a
  restart.
- Checks: `pnpm desktop:check`; `pnpm desktop:test` 506 passed, 14 skipped;
  web `tsc`, `web:lint`, `prettier:check` (web and desktop); 167 settings and
  sidebar tests; `tests/test_desktop_credentials_route.py` 87 passed.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`65b29b0c`. **Result: pass, no blocking findings.** Using scratch builds of
this vault and the baseline's, it verified that:

- a legacy `providers.gemini` entry is never revived, even in a vault never
  re-saved, and disappears at the next save;
- a restored entry wins when both are present;
- the baseline release and two older ones open a vault this release wrote and
  keep `restoredProviders` when they save;
- malformed sections are refused;
- writes are all-or-nothing;
- IPC accepts `gemini`, and status carries no values;
- the backend applies the key without a restart.

Checks: `desktop:check`, 136 desktop tests in the three touched files, the
panel tests, web `tsc`, `web:lint`, Prettier, `test_desktop_credentials_route.py`
(87), ruff.

- **P3-R1-F1 (docs):** `desktop-runtime.md`, `docs/frontend/desktop/overview.md`
  and `docs/frontend/features/model-settings.md` still list three stored
  provider keys and say retired Gemini keys must be re-entered on a model
  connection; Phase 4 named only the first.
- **P3-R1-F2 (tests):** malformed `restoredProviders` shapes beyond a wrong
  name were untested, and an IPC case for a `GEMINI_API_KEY` connection name
  was missing. The downgrade guarantee is untested, since older code is not
  in the test tree.
- **P3-R1-F3:** `restoredProviders: null` is read as empty, like `connections`;
  harmless.
- **P3-R1-F4:** a later release that restores another provider would make
  this release refuse its vault on downgrade, as for unknown names in
  `providers`; worth a docs line.
- **P3-R1-F5 (existing pattern):** the document worker receives and restarts
  on every vault key, now including Gemini, as with ElevenLabs.
- **Outside scope:** `save()` does not bound the vault size, so keys made of
  JSON-escaped characters could exceed the 512 KiB load limit; the baseline
  has the same gap.

#### Code Review #1 Revisions

- **F1 (planned):** Phase 4's doc list now includes the two frontend docs and
  the `restoredProviders` notes.
- **F2 (fixed):** the refusal test covers a wrong name, an array, a string, an
  invalid value and an invalid date; the IPC list refuses a `GEMINI_API_KEY`
  connection name. The downgrade guarantee stays verified by the review's
  probe, not a test.
- **F3, F5 (accepted):** consistent with existing handling.
- **F4 (planned):** covered by the F1 docs line.
- **Vault size (out of scope):** pre-existing; not changed here.

Verification: the two desktop test files pass (80 passed, 3 skipped);
`desktop:check` passes. No further round: the revisions are tests and plan
text.

### Phase 4: Documentation, release note and owner listening check

Requirements: every acceptance criterion.

1. **Docs:** `docs/backend/integrations/voice-and-speech.md`,
   `docs/frontend/runtime/voice.md`, a new `docs/frontend/runtime/gemini-tts.md`
   beside `elevenlabs-tts.md` and indexed in `docs/frontend/README.md`,
   `docs/frontend/runtime/avatar-lipsync.md`, `docs/frontend/runtime/chat.md`,
   `docs/backend/architecture/http-api.md` (dispatch options),
   `docs/backend/operations/desktop-runtime.md` (the key, the env table and the
   vault's `restoredProviders` section, including that it may name only
   `gemini` and that a release restoring another provider must allow it here
   first) and `development.md`, `docs/frontend/desktop/overview.md` and
   `docs/frontend/features/model-settings.md` (stored provider keys),
   `docs/frontend/features/emotional-voice-catalog.md` (styles), and
   `tests/live/README.md`. Cover the terms note (D8) and the SynthID watermark.
2. **Release note:** `docs/frontend/desktop/redistribution-review.md` records
   that the next desktop release needs owner re-review of the Python licence
   inventory (`google-genai`, `google-auth`, `pyasn1`, `pyasn1-modules`) and one
   Gemini voice request from the frozen runtime per target for TLS.
3. **Owner listening check** (gate), on the live task stack or a desktop
   development build. The agent prepares the checklist and records results:
   - two prebuilt voices on Flash-Lite TTS and one on Flash TTS;
   - two emotional tones, to hear the style change;
   - lip-sync timing and the start and end of speech;
   - a long reply, to judge D22's chunking;
   - the missing-key error with the reply still shown;
   - on desktop, adding the key without a restart.

Checks: `docs-sync` review; the final checks below.

Completion: docs reviewed; the owner check recorded; failures become fixes or
follow-up issues, per the owner.

Phase record: issue #461; starting source `a2eba7c6`; final-review fix `7680a4e5`; docs commit recorded in the PR.

Implementation (2026-10-12):

- **Docs:**
  - A new `docs/frontend/runtime/gemini-tts.md` covers availability and the
    key, dispatch and playback, the speaking style, settings, error codes, and
    terms, privacy and billing (D8, SynthID). It is indexed in
    `docs/frontend/README.md`.
  - `voice-and-speech.md` gains a "Gemini TTS" section: composition, key
    isolation, the pinned client, framing, the style and errors.
  - Gemini is added where provider lists, stored keys or finalized audio
    were ElevenLabs-only:
    - `voice.md`, `avatar-lipsync.md` (the finalized path is now
      provider-neutral) and both `chat.md` files;
    - `http-api.md`, `local-http-components.md` and
      `model-client-providers.md`;
    - `elevenlabs-tts.md` and `avatar-animation.md`;
    - `emotional-voice-catalog.md`.
  - `desktop-runtime.md`, `overview.md` and `model-settings.md` list the
    Gemini key and drop the advice to re-enter Gemini keys on a model
    connection (P3-R1-F1). `desktop-runtime.md` also documents
    `restoredProviders` and its downgrade constraint (P3-R1-F4).
  - `development.md` and `tests/live/README.md` describe the key and the
    live test.
  - `contracts/hosted-web.md` tells Cloud consumers to return `None` from
    `gemini_speech` and that `gemini_tts` must be absent.
- **Release note:** `redistribution-review.md` records the re-review of
  `google-genai` 2.29.0, `google-auth`, `pyasn1` and `pyasn1-modules`, plus one
  Gemini request per target from the frozen runtime. It also corrects the older
  sentence that said `google-genai` had been removed.

#### Owner listening checklist

Run it on the live task stack `animama-gemini-tts`
(`http://animama-gemini-tts.localhost:8860`, development mode, started with the
owner-only secrets file, so `GEMINI_API_KEY` and the chat model's key are set).
The stack already has App Settings → Voice set to Gemini with Flash-Lite TTS,
and Annie's voice set to Puck. Each item names what it checks.

1. **Voice and lip-sync.** Chat with Annie (Puck, Flash-Lite TTS) for a few
   turns, then switch App Settings → Voice → Gemini model to Flash TTS and
   continue.
   - Check: replies are spoken in Puck; the mouth moves with the words and
     stops when speech ends; Flash TTS sounds at least as good.
2. **Another voice.** In Annie's Loadout → Voices, choose another voice (for
   example Kore or Charon) and send a message.
   - Check: the new voice is used.
3. **Speaking style.** Ask for something happy, then something sad.
   - Check: the delivery follows the reply's tone (the style is "Speak in a
     [slightly|very] <tone> tone.").
4. **Long reply and chunking (D22).** Ask for a three-paragraph story.
   - Check: speech starts quickly and gaps between sentences are acceptable;
     say whether paragraph chunking should replace sentence chunking.
5. **Missing key.** The coordinator restarts the server without the key on
   request (`docker compose -p animama-gemini-tts` with the key unset), or skip
   this item; automated tests cover it.
   - Check: the reply still appears and a "Text-to-speech unavailable" notice
     shows.
6. **Desktop key (optional).** In a desktop development build, add the Gemini
   key in App Settings → API Keys without restarting, then speak a reply.
   - Check: it speaks; automated vault, IPC and route tests cover the rest.

Agent preflight (2026-10-11, stack at `a2eba7c6`): one spoken reply with
Annie on Flash-Lite TTS streamed 22 `tts.audio` frames (245,760 bytes, about
5.1 s of 24 kHz PCM), then `tts.done` and `run.completed`, with no voice error.
This proves delivery only; what it sounds like is the owner's check.

Results: pending the owner's check.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, docs-sync review of the working tree on
`a2eba7c6`, including the final review's error-text fix. **Result: pass, no
blocking findings.**

- **Verified against the code:**
  - error texts, settings labels and the dispatch shape;
  - model ids, voices, defaults and limits;
  - the vault rules and the hosted guard;
  - the `uv.lock` versions and package versions;
  - the terms statements, checked against the research brief.
- **Coverage:** every planned doc is updated, P3-R1-F1 and F4 are covered,
  and all links and anchors resolve.

- **P4-R1-F1 (should-fix):** `docs/frontend/desktop/installation.md` said "all
  three" keys are in API Keys and did not mention Gemini.
- **P4-R1-F2 (should-fix):** the release note dropped the fact that the
  approved inventory predates the `google-genai` removal. "Regains" also hid
  that the owner will see version changes, with `cachetools` and `rsa` gone.
- **P4-R1-F3 (should-fix):** the local runtime-capabilities example in
  `http-api.md` lacked `gemini_tts`.
- **P4-R1-F4 (note):** the downgrade sentence was too broad, since earlier
  releases ignore `restoredProviders`.
- **P4-R1-F5 (note):** `hosted-web.md` should say "Absent or null".
- **P4-R1-F6 (note):** `gemini-tts.md` lacked a restart cue for self-hosted
  keys and implied the dispatch shape was complete.
- **P4-R1-F7 (note):** "Codes are" omitted the shared `missing_tts_text`, and
  each request's last frame can be shorter than 0.2 s.
- **P4-R1-F8 (note):** the `docs/backend/README.md` index named only
  ElevenLabs.

#### Code Review #1 Revisions

All fixed as suggested:

- **F1:** Gemini is in Voice and API Keys, is not asked for in setup, and the
  text now says "all four".
- **F2:** the note now says the inventory predates both removals and the stack
  returns at new versions, without `cachetools` and `rsa`. Verified against
  `uv.lock`.
- **F3:** the example gains `gemini_tts`, with the voices shortened and a note
  saying so. The JSON still parses.
- **F4–F8:** applied as described in the findings.
- **Verification:** `git diff --check`. No further round: the revisions are
  wording changes confirmed against the cited code.

### Phase 5: Voice samples and the Gemini voice picker

Requirements: D29; R1's key rules apply to sample requests.

1. **Backend:**
   - **Route.** `GET /v1/gemini/voices/{voice}/sample?model_id=` is a local
     route (`server/routers/gemini.py`, inventory `_local`), because Gemini voice
     is local only. No shared port or hosted contract change is needed. It is
     delivered with `local_file_response` (`audio/wav`, ETag, 304). Errors carry
     `detail.code` and a browser-safe `detail.message`:
     - 422 for an unknown voice or model;
     - 503 `gemini_tts_missing_credential`, with the key message;
     - 502 `gemini_tts_sample_failed`, naming at most the HTTP status.
   - **Local implementation.** `server/gemini_voice_samples.py` speaks
     "Hi there! This is how I sound when we talk." in the friendly default
     style through `stream_gemini_finalized_speech`. It shares the client, the
     key check, the three-request limit and the redacted errors.
     - Audio is capped at 10 s and wrapped as a 24 kHz mono 16-bit WAV.
     - Files go under `<data root>/internal/derivatives/gemini-voice-samples/<model>/<voice>.<digest>.wav`.
       The digest covers a version, the text and the style. Writes are
       atomic, and stale digests are removed.
     - One in-flight generation per file, shielded from cancellation, so two
       clicks never bill twice and a stopped click still caches.
     - A cached sample plays without a key.
2. **Frontend:**
   - A `GeminiVoicePicker` replaces the Select in Loadout → Voices. It reuses
     the Pocket picker's popover layout, search box and gender tabs,
     `createVoiceSamplePlayer`, and `VoiceSampleButton` (moved into its own
     file).
   - Each row shows the name, Google's description and play/select buttons.
     The sample uses the saved `tts_gemini_model_id`, falling back to the
     default.
   - Errors from the server's `detail.message` are shown as is. A note says
     the first play of each voice uses the Gemini key.
   - Voice metadata (gender, description) is a frontend catalog keyed by
     name, like Pocket's. A voice the catalog lacks still lists under All.
3. **Contract:** regenerate the client offline. No further version bumps:
   `local-http` 5.0.0 and `runtime-contracts` 0.5.0 are unreleased in this PR.
4. **Docs:** `gemini-tts.md`, `voice-and-speech.md`, `http-api.md` and
   `local-content-storage.md` (derivatives).

Checks: new `tests/test_gemini_voice_samples.py` covering:
- a miss generates and caches; a repeat makes no call; an ETag returns 304;
- concurrent requests make one call; a cancelled request still caches;
- missing key 503; upstream 429 gives a status-only 502 that caches nothing;
- no `.tmp` files are left after failures;
- unknown voice or model 422; a corrupt file is regenerated;
- a changed sample line replaces the old file.

Frontend tests: the sample loader's error mapping, and the picker's rows,
gender tabs, search, play and select. `VoiceLoadoutSection.gemini.test.tsx` is
updated. The inventory test is updated. Then the final checks.

Completion: checks pass, review leaves no blocker, and one live sample plays
on the task stack. The owner listening check (Phase 4) also covers the
picker.

Phase record: issue #469; starting source `f3a9e6b5`; commit `d676c07e`.

Implementation (2026-10-12):

- **Backend:**
  - `server/gemini_voice_samples.py` (`LocalGeminiVoiceSamples`) and the
    local route `server/routers/gemini.py`, listed in the inventory as
    `_local`.
  - Planning had proposed a shared `ProductPorts` member. It was dropped
    because Gemini voice is local only, so hosted adopters need no change.
  - `stream_gemini_finalized_speech` is now typed as an async generator, so
    callers can close it early.
  - The Gemini SDK fakes moved to `tests/gemini_support.py`.
- **Frontend:**
  - `lib/speech/gemini-voices.ts` holds the voice details, the filter and the
    sample loader. `VoiceSampleError` lets a loader's message reach the player.
  - `VoiceSampleButton` moved to its own file. The new `GeminiVoicePicker`
    replaces the Select in Loadout → Voices.
  - The client was regenerated offline.
- **Checks:**
  - 15 new backend tests; 330 route, admission, inventory and Gemini tests;
    ruff, format and mypy.
  - Web: 173 tests in `src/ui/animas` and `src/lib/speech`; `pnpm check`,
    `web:lint`, `prettier:check` and `openapi-ts:check`.
- **Live (task stack):** a Puck sample on Flash-Lite TTS was made in 2.8 s (a
  3.1 s WAV). A repeat was served from the cache in 3 ms, and the ETag returned
  304.
- **Owner report (2026-10-12):** chats on the task stack failed with
  `gemini_tts_stream_failed` (HTTP 429). Google's reply confirmed the key's
  Free tier allows 10 requests a day per model. Five voice samples and the
  day's chats had used Flash-Lite TTS's allowance, so this is a quota, not a
  defect.

#### Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the working tree on
`f3a9e6b5`. **Result: fail, one blocker.** It agreed with the local-route
design and judged the duplication between the two pickers acceptable.

- **P5-R1-F1 (blocker):** `make mypy` failed on four errors in the new test
  file: one `no-any-return`, and three `comparison-overlap` errors where an
  `HTTPException.detail` is compared with a dict. The record's "mypy" covered
  only the source files.
- **P5-R1-F2 (should-fix):** the store dependency was synchronous, so FastAPI
  ran it in the threadpool. Two first plays right after a start could each
  build a store, and so bill twice; a probe with a widened window confirmed
  it.
- **P5-R1-F3 (should-fix):** the cache-write failure path was untested.
- **P5-R1-F4 (note):** no empty-state row, unlike the Pocket list.
- **P5-R1-F5 (note):** the voice catalog's keys were not checked against the
  contract's voices.
- **P5-R1-F6 (note):** local admission rejects cross-site GETs. A browser
  without Fetch Metadata would be admitted, but the cache bounds the cost to
  60 samples.
- **P5-R1-F7 (note, docs):**
  - `http-api.md` said every error carries `detail.message`, but
    `content_unavailable` does not;
  - the inventory docstring omitted Gemini samples.
- **P5-R1-F8 (note, existing):** when the sample cap is hit, the SDK's inner
  stream is closed only by garbage collection. The semaphore is released.
  The chat path behaves the same.

#### Code Review #1 Revisions

- **F1 (fixed):** the frames are read as `bytes`, and each detail is compared
  as `object`. The full `make mypy` target now passes (830 files).
- **F2 (fixed):** the dependency is `async`, so it runs on the event loop and
  every play shares one store. A route test sends two concurrent first plays
  and sees one Gemini call.
- **F3 (fixed):** a test makes `replace` fail. The sample still plays, no
  file or `.tmp` is left, and the next play speaks again.
- **F4 (fixed):** the list shows "No voices match these filters.", with a test.
- **F5 (fixed):** the catalog `satisfies Record<GeminiVoice, …>`, so a missing
  or extra voice fails type checking.
- **F7 (fixed):** both doc points are corrected.
- **F6, F8 (accepted):** no change.
- **Owner report (fixed):**
  - A 429 now reads "Gemini's rate limit or daily quota was reached (HTTP 429).
    Try again later, or raise your Gemini API tier.", in chat and in samples.
    The service test covers both 429 and 500; the docs explain the Free-tier
    allowance.
  - The shared finalized runtime no longer labels Gemini failures as
    ElevenLabs: its log name is `FinalizedTTSRuntime`, its reason is
    `finalized_error`, and its fallback text is neutral.
- **Verification:**
  - backend: 59 tests in the Gemini sample, TTS and inventory files, plus 50
    Gemini chat SSE tests; ruff and format; full `make mypy`;
  - web: 235 tests in `src/ui/animas`, `src/lib/speech` and `src/hooks`;
    `pnpm check`, `web:lint` and `prettier:check`.

Repair round 1 (targeted recheck by the same reviewer): **pass.** All
revisions resolve their findings:
- the full `make mypy` target passes;
- the race probe now makes one call;
- the 429 text is a fixed string, never built from the exception;
- no consumer used the old runtime names, including in animama-cloud.

Note P5-R2-F1 (a quota number in the docs will go stale) was fixed by linking
Google's rate-limits page. One of two repair rounds was used.

Visual check (2026-10-12, task stack, Annie on Gemini with the voice Leda;
answers FI-R3-F1):
- **At 1440×900:** the picker shows search, the All/Female/Male tabs,
  "30 voices", a description and a play button on each row, the check on
  Leda, and the footer note. The Female tab lists the 14 female voices, and a
  search with no matches shows "No voices match these filters.".
- **At 390×844:** the popover fills the width, the list scrolls, and the page
  does not overflow horizontally.
- The owner had already played Zephyr, Kore, Leda and Callirrhoe from the
  picker. Samples served 200 the first time and 304 after that.

## Final integration review

Run after Phase 4, before the PR leaves draft, with at most two repair rounds.
It covers key isolation end to end, composition gating and hosted behaviour,
ElevenLabs regressions, voice failure isolation, and the contract between
backend frames and frontend playback. Reuse still-valid phase evidence.

### Final Code Review #1 Findings

Independent `sdlc-reviewer`, full initial review of the committed code at
`a2eba7c6` against `f7eb367c`; Phase 4 docs were out of scope. **Result:
pass, no blocking findings.** It verified all six scope items:

- **Key isolation.** The key is sent in a header, never in the URL, and
  connections naming it are refused by both the API and IPC.
- **Gating.** Without the port the reply has no frames and still completes;
  the hosted guard refuses the capability; the package versions follow the
  rules, and the generated SDK is current.
- **ElevenLabs.** Behaviour is unchanged, and the golden SSE tests pass.
- **Failure isolation.**
- **Frames.** Frames are an even number of bytes, carry the chat `run_id`,
  and give lip-sync the `gemini` provider.

Checks: 294 targeted backend tests, ruff and format, the import boundary,
`openapi-ts:check`, 141 web tests in nine files, 30 product-ui lifecycle tests,
type checks for product-ui, web and desktop, `web:lint`, and 80 desktop tests.

- **FI-R1-F1 (should-fix):** with no key, the notice read "Gemini TTS setup
  failed.", because the shared setup path blanks every refusal's text. The
  helpful missing-key message only appeared if the key vanished between
  preparing and streaming.
- **FI-R1-F2 (note):** a setup error that is not a refusal forwarded
  `str(exc)` to the browser for Gemini too (for example a database or gruut
  error), against the status-only rule.
- **FI-R1-F3 (note, docs):** `docs/frontend/desktop/troubleshooting.md` still
  said to re-enter retired Gemini keys on a model connection.
- **FI-R1-F4 (note):** the SDK imports some modules lazily, so the planned
  frozen-runtime release request should also confirm the bundle imports.

### Final Code Review #1 Revisions

- **F1, F2 (fixed):**
  - `_FinalizedProviderText` gains `refusal_messages`, which maps the Gemini
    missing-credential code to "Gemini text-to-speech needs a Gemini API key."
    The code and message now live in `app/contracts/gemini.py`, shared with the
    service.
  - It also gains `forwards_error_text`, false for Gemini, so other Gemini
    setup and task errors show only the generic text. ElevenLabs is unchanged.
  - Tests: the missing-key route test expects the new message; a new route
    test shows that a setup error's detail never reaches the browser; the
    product-ui fixture uses the new text.
  - Verification: 154 tests across `test_anima_chat_sse.py`, `test_gemini_tts.py`,
    the golden SSE tests and the ElevenLabs router (all pass); ruff and format;
    product-ui lifecycle 30/30.
- **F3 (fixed):** the troubleshooting page now sends retired Gemini keys to
  App Settings → API Keys for voices.
- **F4 (fixed):** the release note's frozen-runtime request now also confirms
  that the SDK's lazily imported modules were bundled.

Repair round 1 (targeted recheck by the same reviewer): **pass, no new
findings.** All four revisions resolve their findings. Comparing both error
paths line by line shows ElevenLabs text and codes unchanged. Checks: 154
tests as above, 16 in `test_product_http_chat_turns.py` (ElevenLabs refusal
codes), ruff and format, mypy on the three changed modules, and product-ui
lifecycle 30/30. One of two repair rounds used.

### Final Code Review repair round 2 (Phase 5 integration)

The same reviewer ran a targeted cross-phase recheck of the Phase 5 working
tree on `f3a9e6b5`. **Result: pass.**
- Samples share the client, key and semaphore with chat, and the cap releases
  its slot.
- The 429 text and the runtime rename change no ElevenLabs behaviour.
- The local route stays out of hosted, and no further version bumps are
  needed.
- Key isolation holds for responses, logs and cache files.

Its findings:
- **FI-R3-F1:** the picker lacked a visual check. Fixed by the Phase 5
  visual check above.
- **FI-R3-F2 (note):** samples and chat share Google's per-model quota. This
  is documented, and the 429 text explains it.

Checks: 212 backend and 172 web tests, ruff, mypy, the import boundary and
`openapi-ts:check`. Both repair rounds are now used.

Final local checks on `d676c07e` (2026-10-12):
- `make check-test`: 4,004 passed, 29 skipped. The run covered the same code;
  only the docs and the plan changed afterwards.
- `pnpm check`, `web:lint`, `prettier:check` and `build`: pass.
- `desktop:test`: 506 passed, 14 skipped.
- `web:test`: vitest 3,917 passed, 1 skipped; browser scripts 216/216.
- `pnpm e2e:test:fast` on a disposable built stack: 38 passed (5.6 min); the
  stack was torn down.
- Package-set build of `d676c07e` compared with `f7eb367c`: "Compatibility
  policy passed".
- Hosted CI: run 38256804300 passed on `f3a9e6b5` (Phases 1–4). The workflow
  was disabled again before the later push, so the later commits have only
  this local evidence.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| No key → visible voice error, reply still shown; desktop key without restart, not persisted or sent to the browser | backend and desktop tests; owner check | 1, 3, 4 |
| Owner connection naming `GEMINI_API_KEY` refused; `GOOGLE_API_KEY` never read | credential and SDK isolation tests | 1 |
| Speaks in the chosen prebuilt voice with lip-sync; tone changes the style; failure leaves the reply with a voice error | backend and frontend tests; live check; owner listening check | 1, 2, 4 |
| Settings show Gemini, its model and the voice picker | UI tests; visual check (Phase 5 for the picker) | 2, 5 |
| Hosted composition unchanged | composition and provider-option tests | 1, 2 |
| Voice docs updated | review | 4 |

Final local checks on the exact candidate: `make check-test`, `uv lock --check`,
`bash -n reset.sh`, both compose config commands, `pnpm check`,
`pnpm web:lint`, `pnpm web:test`, `pnpm build`, `pnpm desktop:check`,
`pnpm desktop:test`, and `pnpm e2e:test:fast` on a disposable built stack.

Record hosted `Validation` separately. Automated evidence does not establish
audio or lip-sync fidelity; the listening check does.

## Idempotence and recovery

- **Live runs:** rerunnable but billed; keep within D16 and never loop them.
- **Reverting a phase:** revert its commits. Animas saved with `gemini` then
  have an unknown provider; `resolvePreferredTtsProvider` falls back to a
  supported one, and the backend drops the dispatch.
- **Keys:** removing the key in App Settings or the environment only disables
  the Gemini voice; nothing else reads it.
- **No schema change:** no database reset is needed.

## Outcomes & Retrospective

Not started.
