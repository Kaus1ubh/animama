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

- [ ] Phase 1: Live measurement and the backend Gemini voice.
- [ ] Phase 2: Voice settings, playback and lip-sync.
- [ ] Phase 3: Desktop key.
- [ ] Phase 4: Documentation, release note and owner listening check.
- [ ] Final integration review.

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
- **D21 (planning): speaking style.** A tone-to-style mapper beside the
  ElevenLabs tag builder takes the same tone and level and returns one style
  sentence (for example, "Speak slightly cheerfully."), with a friendly default
  for neutral or unknown tones. Every request in a reply carries the same style,
  as Google recommends for streamed agents.
- **D22 (planning): chunking.** Sentence mode if Phase 1 measures Flash-Lite
  TTS's time to first audio at or under 1.5 s for one sentence; otherwise
  paragraph mode. The owner may revise it at the listening check.
- **D23 (planning): prebuilt voices.** One backend constant lists Google's
  prebuilt voice names (30 per the docs; Phase 1 confirms the list against
  the current docs page). It is exposed through the generated client as an
  enum, so the frontend picker and backend validation share it. The default
  voice is `Kore`; an unknown stored name falls back to it.
- **D24 (planning): composition gating.** A new `app.state` flag, set only by
  the local composition, enables provider voices that need a key on the
  backend. Without it the backend drops a `gemini` dispatch the way it drops
  unknown providers, and the frontend shows Gemini only when
  `provider_credentials` is true. Hosted behaviour is unchanged.
- **D25 (planning): settings placement.** The Gemini TTS model is an
  installation voice preference beside the ElevenLabs model in App Settings;
  the voice is chosen per Anima in its voice section. Setup's voice step and
  the create-Anima voice step stay unchanged.
- **D26 (planning): vault re-admission.** The desktop vault stores keys saved
  by this release under a marker that earlier releases never wrote; an
  unmarked `gemini` entry is still dropped, even in a vault never re-saved.
- **D27 (planning): package export.** A `gemini` voice exports as
  `pocket_tts`, the provider portable import already forces, so packages carry
  no provider their readers do not know.
- **D28 (planning): no ADR.** Gemini extends the existing backend-brokered
  voice pattern (ElevenLabs finalized audio) without a new boundary, so current
  docs record it instead of an ADR.

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
7. **Composition (D24).** Set the new flag in the local composition; drop a
   `gemini` dispatch without it.
8. **Content (D27).** Package export maps `gemini` to `pocket_tts`.
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

Phase record: issue #458; starting source `fd4fea0f`; commit —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 2: Voice settings, playback and lip-sync

Requirements: R2 (frontend). Decisions: D20, D23–D25.

Outcome: the owner can choose Gemini and its model in App Settings and a
prebuilt voice per Anima; replies play with lip-sync; a voice error shows the
existing "Text-to-speech unavailable" notice while the reply stays.

1. `gemini` joins `TtsProviderPreference`, `TTS_PROVIDERS` and the provider
   options, offered only when `provider_credentials` is true and Web Audio is
   available. It is never chosen automatically.
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
7. `useChatSse.ts` accepts `provider: "gemini"` on `tts.*` frames.

Tests: provider options with and without provider credentials; preferences
defaults; dispatch payload; playback start, duration and end signals for
`gemini`; lip-sync acceptance; the voice select saving and reloading; error
notice with the reply intact; ElevenLabs cases unchanged.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`packages:check`; a visual check of App Settings voice and an Anima's voice
section at 1440×900, then a narrow width, on the task stack.

Completion: checks pass; the visual check matches existing styling; review
leaves no blocker.

Phase record: issue #459; starting source —; commit —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

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

Phase record: issue #460; starting source —; commit —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 4: Documentation, release note and owner listening check

Requirements: every acceptance criterion.

1. **Docs:** `docs/backend/integrations/voice-and-speech.md`,
   `docs/frontend/runtime/voice.md`, a new `docs/frontend/runtime/gemini-tts.md`
   beside `elevenlabs-tts.md` and indexed in `docs/frontend/README.md`,
   `docs/frontend/runtime/avatar-lipsync.md`, `docs/frontend/runtime/chat.md`,
   `docs/backend/architecture/http-api.md` (dispatch options),
   `docs/backend/operations/desktop-runtime.md` and `development.md` (the key),
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

Phase record: issue #461; starting source —; commit —.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

## Final integration review

Run after Phase 4, before the PR leaves draft, with at most two repair rounds.
It covers key isolation end to end, composition gating and hosted behaviour,
ElevenLabs regressions, voice failure isolation, and the contract between
backend frames and frontend playback. Reuse still-valid phase evidence.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| No key → visible voice error, reply still shown; desktop key without restart, not persisted or sent to the browser | backend and desktop tests; owner check | 1, 3, 4 |
| Owner connection naming `GEMINI_API_KEY` refused; `GOOGLE_API_KEY` never read | credential and SDK isolation tests | 1 |
| Speaks in the chosen prebuilt voice with lip-sync; tone changes the style; failure leaves the reply with a voice error | backend and frontend tests; live check; owner listening check | 1, 2, 4 |
| Settings show Gemini, its model and the voice picker | UI tests; visual check | 2 |
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
