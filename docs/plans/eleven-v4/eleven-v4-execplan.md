# Eleven v4 and v4 Turbo execution plan

Status: Draft for owner review (agent, 2026-10-12). No phase is authorized yet.

Source agreement: [spec draft](eleven-v4-spec.md) of 2026-10-12, based on
[issue #471](https://github.com/raymond-van/animama/issues/471) and the owner's
task instruction of 2026-10-12 (decisions D1–D3 in the spec). Research:
[eleven-v4-research.md](eleven-v4-research.md).

Authorized scope: none yet. Implementation starts after the owner accepts the
spec (including D1, D3, D5 and D6) and this plan.

Explicit gates:

- **G1 — Paid live checks.** Live ElevenLabs checks during implementation stay
  within the owner-approved budget (spec D6; proposed US$1).
- **G2 — Owner gate before merge.**
  - The owner listens to v4 Turbo and v4 with the voices in use.
  - The owner reviews provider-timed versus estimated lip-sync side by side on
    the same reply.
  - The owner confirms or waives Instant Voice Clone compatibility (spec D5).
- **G3 — Hosted (Cloud).** Cloud must adopt the v4 model ids before or together
  with hosted adoption of this release (spec D7). It is tracked by a Cloud issue,
  not by this PR.

## Purpose and context

Replace ElevenLabs `eleven_flash_v2_5` and `eleven_multilingual_v2` (realtime)
and `eleven_v3` (finalized) with `eleven_v4_turbo` and `eleven_v4`. Time the
avatar's lip-sync from ElevenLabs character timing when it is available. The
spike established the protocol facts this plan depends on:

- The Text to Speech socket rejects v4.
- The Text to Dialogue socket needs a `ttd_websocket` single-use token and works
  browser-direct.
- v4 Turbo with a flush after the first segment reaches first audio in
  106–149 ms, against 862 ms for Flash as used today.
- Timing frames on the socket restart at zero in every frame and tile each turn.
  HTTP timing is cumulative per request.
- `previous_text` works with v4.

Orientation (paths relative to the repository root):

- **Backend models and provider calls:**
  - `src/backend/animama/app/contracts/elevenlabs.py` (model literals, schemas);
  - `src/backend/animama/app/contracts/dispatch.py` (`PyAnimaTtsRunOptions`);
  - `src/backend/animama/app/chat/options.py`;
  - `src/backend/animama/server/config.py`
    (`elevenlabs_realtime_tts_default_model_id`);
  - `src/backend/animama/server/elevenlabs_service.py` (token, session,
    finalized stream, utility route);
  - `src/backend/animama/app/voice_emotional_tone.py` (tone prefix,
    `previous_text` bound).
- **Backend chat speech:**
  - `src/backend/animama/product_http/chat/tts.py` (session bootstrap, finalized
    batcher and bootstrap, model checks);
  - `src/backend/animama/product_http/chat/sse_events.py` (`tts.session`,
    `tts.audio`, `tts.done`, `tts.error`);
  - `src/backend/animama/product_http/ports.py` (`ProductSpeech`,
    `FinalizedSpeechPort`).
- **Browser realtime:**
  - `src/frontend/web/src/hooks/use-elevenlabs-tts-runtime.ts` (URL, socket
    lifecycle, frames);
  - `src/frontend/web/src/hooks/use-tts-playback.ts` (orchestration, chunker
    feed, Pocket fallback);
  - `src/frontend/web/src/lib/speech/tts-chunker.ts`.
- **Browser finalized:** `src/frontend/web/src/hooks/use-elevenlabs-finalized-tts-runtime.ts`
  (shared with Gemini).
- **Shared chat client (product-ui):**
  - `src/frontend/packages/product-ui/src/query/mutations/useChatSse.ts` (SSE
    types);
  - `src/frontend/packages/product-ui/src/chat/useProductChatSession.ts`
    (session validation, viseme inputs, allowance fallback);
  - `src/frontend/packages/product-ui/src/chat/session-bindings.ts`.
- **Settings:**
  - `src/frontend/web/src/lib/settings/preferences.ts` (model options,
    normalizers, `isElevenLabsFinalizedTtsModelId`);
  - `src/frontend/web/src/ui/sidebar/ApplicationSettingsModal.tsx` (Voice rows);
  - `src/frontend/web/src/lib/chat/elevenlabs-chat-tts-dispatch.ts`;
  - `src/frontend/web/src/ui/main/chat/useChatSession.ts`.
- **Lip-sync:**
  - `src/frontend/web/src/lib/speech/gruut-viseme-keyframes.ts` (planner,
    `buildGruutVisemeKeyframes`, global `timelineScale`);
  - `src/frontend/web/src/stores/avatar-lipsync-bridge-store.ts`
    (`queueVisemeInputsForRun`, in-flight rebuilds, `markSpeechAudioDurationResolved`);
  - `src/frontend/web/src/workers/viseme-worker.ts`;
  - `src/frontend/web/src/lib/avatar/viseme-worker-protocol.ts`;
  - `src/frontend/web/src/lib/avatar/vowelVisemeSegment.ts`;
  - `src/frontend/web/src/lib/avatar/ExpressionController.ts`.
- **Debug panel:**
  - `src/frontend/web/src/ui/debug/AnimaDebugPanel.tsx`;
  - `src/frontend/web/src/ui/debug/animaDebugPanelConfig.ts`.
- **Contracts:**
  - `contracts/hosted-web.md` (realtime session descriptor, speech refusals,
    versions);
  - `contracts/versions.json` (`local-http` 5.0.0);
  - `src/frontend/packages/runtime-contracts/package.json` (0.5.0);
  - `src/frontend/packages/product-ui/package.json` (0.9.0);
  - `docs/backend/architecture/http-api.md` (version mirror).
- **Docs:**
  - `docs/frontend/runtime/elevenlabs-tts.md`, `voice.md` and `avatar-lipsync.md`;
  - `docs/backend/integrations/voice-and-speech.md`;
  - `docs/backend/architecture/http-api.md`;
  - `docs/backend/runtime/chat.md`.

Ownership and boundaries:

- Backend code stays under `src/backend`, frontend code under `src/frontend`.
- Generated clients are regenerated with `pnpm openapi-ts`, never hand-edited.
- No Alembic revisions are needed: preferences are opaque JSON, and nothing in
  the schema changes.
- Cloud is read-only here. Its `services/hosted-api` imports
  `SUPPORTED_ELEVENLABS_REALTIME_TTS_MODEL_IDS` and hard-codes `eleven_v3`
  (`app/speech.py`, `server/speech_turn.py`), so the exported name is kept and
  the Cloud issue describes the rest.
- Gemini shares `tts.audio`, the finalized runtime and the bridge. Its frames gain
  no timing, and it keeps the estimated path.

## Progress

- [x] Spike (2026-10-12), about US$0.33 of US$1:
  [research brief](eleven-v4-research.md).
- [x] Spec drafted (2026-10-12): [eleven-v4-spec.md](eleven-v4-spec.md).
- [x] ExecPlan drafted (2026-10-12).
- [ ] Owner review of the spec and plan; decisions D1, D3, D5 and D6.
- [ ] Phase 1: v4 model set, migration and finalized v4.
- [ ] Phase 2: realtime v4 Turbo over the dialogue socket.
- [ ] Phase 3: provider-timed lip-sync.
- [ ] Phase 4: side-by-side lip-sync review.
- [ ] Phase 5: hosted contract, Cloud issue, docs and full validation.
- [ ] Final integration review.
- [ ] G2 owner gate.

## Surprises & Discoveries

From the spike, 2026-10-12 (details and numbers in the research brief):

- **Token type.** The existing `tts_websocket` token is refused on the dialogue
  socket with `invalid_token_type`. `ttd_websocket` works, though it is
  undocumented and absent from the installed SDK's `SingleUseTokenType`.
- **v4 on plain TTS HTTP.** ElevenLabs documents v4 only for Text to Dialogue,
  but the plain Text to Speech HTTP API (`convert`, `stream`,
  `stream/with-timestamps`) accepts it. Cloud's existing HTTP adapter therefore
  needs only model-id changes.
- **Socket timing.** Times are relative per frame. Frames tile the turn's audio,
  but not one-to-one with audio frames, and some audio frames have
  `alignment: null`.
- **Flush and turns.** `flush` ends a prosody turn (`is_final_audio_for_turn`).
  Flushing only the first segment gives the latency win without fragmenting the
  prosody of the rest of the reply.
- **IVC untestable.** The owner's plan refuses IVC on every model, so clone
  checks need a different plan (spec D5).
- **Today's socket usage** (code reading):
  - the realtime runtime sends trimmed `{text}` frames without trailing spaces;
  - it never sends `flush` or `keep_alive`;
  - its Flash first audio waits for ElevenLabs' default buffering (862 ms median).
- **Settings default mismatch.** The frontend default grouping is
  `DEFAULT_ELEVENLABS_V3_FINALIZED_CHUNKING = "paragraph"`, while the backend and
  docs say `"sentence"`. This is pre-existing. Phase 1 keeps the behavior and
  corrects the docs, unless the owner prefers the other default.
- **SDK gap.** The installed `elevenlabs` SDK 2.39.0 has no Text to Dialogue
  socket client, and its dialogue `stream_with_timestamps` has no `previous_text`
  parameter. The latest release is 2.71.0.
- **Lip-sync planning inputs.** `docs/plans/lipsync-upgrade/` (#468) had no
  findings yet. There is no debug tooling that shows two lip-sync plans; the
  bridge keeps one plan per run.

## Decision Log

- **2026-10-12 — owner (task instruction):**
  - Legacy models are allowed if replacing them proves too much work or too
    risky; full removal is preferred.
  - Use provider timing for lip-sync if feasible, with the estimated path as the
    fallback, and show the two side by side.
  - Tag mouth shapes and other providers stay in #468.
  - Proposed defaults: v4 Turbo realtime, v4 finalized as the optional mode.
- **2026-10-12 — agent proposal (spec D1):**
  - Remove the old models rather than keep them as Legacy.
  - The spike shows no voice-type, latency or price reason to keep them.
  - Keeping them doubles the realtime protocols in the browser and in Cloud.
  - Contingency: restore `eleven_v3` as Legacy if G2 rejects v4 for a voice in
    use.
- **2026-10-12 — agent proposal (spec D4):** the finalized path uses Text to
  Dialogue HTTP `stream/with-timestamps`, the documented home of v4. The plain
  Text to Speech HTTP acceptance is recorded as a fallback.
- **2026-10-12 — agent proposal: realtime flush policy.**
  - Flush once after the first speech segment, then let the server buffer.
  - Send `keep_alive` after 10 s without a message.
  - End with `close_socket`.
  - Basis: research §1.
- **2026-10-12 — agent proposal: one timing shape and time base.**
  - Every timing payload uses the dialogue socket's field names: `chars`,
    `char_start_times_ms` and `char_durations_ms`.
  - Direct sockets are relative per frame, and the browser accumulates them.
  - `tts.audio` and the hosted server socket carry times relative to the run's
    first audio sample; producers apply the offsets, since they know the sample
    counts.
- **2026-10-12 — agent proposal: old ids in requests.**
  - A `mode="before"` validator maps legacy ids to their replacements in
    `PyAnimaTtsRunOptions`.
  - The OpenAPI enum lists only the v4 ids, and a stale tab still gets its reply.

## Setup and execution rules

- **Workspace:**
  - Worktree `worktrees/animama/frosty-hawking-42dddf`, branch `feat/eleven-v4`
    from `95a2db39` (`origin/main` at setup).
  - Keep the primary checkout on `main`.
  - Use Python 3.12: `uv sync --python 3.12.13` (a new worktree venv may pick
    3.14 and break `openapi-ts`).
- **Credentials:**
  - Read the key from the owner-only `~/.config/animama/dev-secrets.env`:
    - scripts: `uv run --env-file "$HOME/.config/animama/dev-secrets.env" ...`;
    - stacks:
      `COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env" ./reset.sh --name ev4 --base-port 8240`.
  - Never print key or token values.
  - Desktop live checks use the desktop app's own key storage, under the owner's
    control.
- **Stacks:**
  - One named task stack (`animama-ev4`), started only for live checks and torn
    down right after its last use.
  - `pnpm e2e:test:fast` uses a separate disposable built stack
    (`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name ev4-e2e --base-port 8600`).
  - Never touch other tasks' stacks.
- **Paid checks (G1):**
  - Record characters and estimated cost per live check in this plan.
  - Stop and ask the owner before exceeding the approved budget.
- **Phase completion:** each phase ends with:
  - its focused tests;
  - the affected scoped checks;
  - one `sdlc-reviewer` full review, plus at most two repair rounds;
  - a phase commit `<type>(<scope>)[p#]: <summary>`, with no attribution lines.
- **CI:** hosted Portable product validation stays disabled. Local checks are the
  evidence.

## Phased implementation

### Phase 1: v4 model set, migration and finalized v4

Requirements: R2, R3, R6 (backend and settings). Starting source: `95a2db39`.

Outcome:

- The backend speaks finalized replies with `eleven_v4` over Text to Dialogue
  HTTP with timestamps, sending `previous_text` and the tone tag.
- The realtime session descriptor names `eleven_v4_turbo` with a `ttd_websocket`
  token and `sync_alignment: true`.
- Settings offer only v4 Turbo and v4, and saved old ids migrate.
- Timing is parsed in the backend stream but not yet emitted (Phase 3).

Changes:

1. **Contracts** (`app/contracts/elevenlabs.py`):
   - Realtime `Literal["eleven_v4_turbo"]`, finalized `Literal["eleven_v4"]`,
     chat union of both, and the `SUPPORTED_*` tuples. The names are kept.
   - Add `LEGACY_ELEVENLABS_TTS_MODEL_REPLACEMENTS` and a small helper.
   - `PyElevenLabsVoiceSettings` keeps `stability` and `similarity_boost`; drop
     `style`, `use_speaker_boost` and `speed`.
   - `PyElevenLabsTextToSpeechRequest.model_id` becomes the v4 union, default
     `eleven_v4`.
   - Delete the unused `PyElevenLabsRealtimeTtsSessionRequest` and
     `PyElevenLabsFinalizedTtsStreamRequest` and their re-exports, after
     confirming they have no users.
2. **Dispatch** (`dispatch.py`, `options.py`): a `mode="before"` validator on
   `model_id` maps legacy ids. The provider/model validator is unchanged.
3. **Config:**
   - Remove `elevenlabs_realtime_tts_default_model_id` and its environment
     variable; there is one realtime model.
   - `resolve_realtime_tts_model_id` reduces to the v4 Turbo constant, with
     legacy mapping for explicit values.
   - Document the removal in `voice-and-speech.md`.
4. **Service** (`elevenlabs_service.py`):
   - Mint `ttd_websocket` tokens. Use the SDK if `SingleUseTokenType` permits it
     after an upgrade; otherwise use a typed `cast` or a direct
     `POST /v1/single-use-token/ttd_websocket` with the shared client. Never log
     the token.
   - The session sets `sync_alignment=True`.
   - Finalized:
     - the request goes to Text to Dialogue `stream/with-timestamps` with
       `inputs=[{text, voice_id}]`, `model_id`, `language_code`,
       `apply_text_normalization="off"`, `output_format=pcm_24000`, and
       `previous_text` (≤100 characters);
     - send `previous_text` through the SDK's `request_options` additional body
       parameters, or upgrade the SDK (decide by inspection; record the choice);
     - parse each NDJSON chunk's `audio_base64` and `alignment`, and keep today's
       PCM framing (`pop_pcm_audio_frame`);
     - retain the alignment, converted to ms, on the yielded `audio` events as an
       internal field;
     - remove the v3 `previous_text` omission.
   - The utility route uses Text to Dialogue `convert`, mapping
     `similarity_boost` to `similarity`.
5. **Tone and continuity** (`voice_emotional_tone.py`):
   - Rename `elevenlabs_v3_text_with_emotional_prefix` to a model-neutral name.
   - Apply it for `eleven_v4`.
   - Bound ElevenLabs `previous_text` to 100 characters; Gemini's bound is
     unchanged.
6. **Chat speech** (`tts.py`, `sse_events.py`):
   - Replace the `"eleven_v3"` literals with the finalized model set.
   - `_uses_previous_text` becomes true for ElevenLabs.
   - The session is skipped for finalized models, as today.
7. **Frontend settings** (`preferences.ts`, `ApplicationSettingsModal.tsx`,
   `elevenlabs-chat-tts-dispatch.ts`, `useChatSession.ts`):
   - Two options:
     - "Eleven v4 Turbo": realtime, fastest, default;
     - "Eleven v4": finalized, highest quality, speaks each sentence once
       written.
   - `DEFAULT_ELEVENLABS_TTS_MODEL_ID = "eleven_v4_turbo"`.
   - Normalizers map legacy ids, so stored old values read as their
     replacements.
   - The settings modal writes the replacement when it loads a migrated value.
     Old ids are never sent to the backend.
   - `isElevenLabsFinalizedTtsModelId` is true for `eleven_v4`.
   - Relabel the grouping row and the "Unavailable with Eleven v3" text for v4,
     keeping the stored key `tts_elevenlabs_v3_finalized_chunking`.
   - Keep the frontend's current grouping default (`"paragraph"`) and correct
     the docs that say `"sentence"`, unless the owner chooses otherwise at review.
8. **Contracts and client:**
   - `contracts/versions.json` `local-http` 6.0.0, mirrored in `hosted-web.md`
     and `http-api.md`.
   - Bump `runtime-contracts` and run `pnpm openapi-ts` offline.
   - Re-record the golden SSE fixtures with `CHAT_SSE_GOLDEN_RECORD=1`.

Tests (TDD where behavior changes):

- **Backend:**
  - legacy ids map in `PyAnimaTtsRunOptions` and still yield a reply;
  - the session descriptor carries v4 Turbo, a `ttd_websocket` token and
    `sync_alignment`;
  - finalized v4 sends the tone tag, sends `previous_text` (≤100 characters) from
    the second request on, and frames PCM as before across sentence and
    paragraph modes;
  - a failed batch emits `tts.error` without `tts.done`;
  - Gemini tests unchanged;
  - utility route default and settings mapping;
  - golden fixtures.
- **Frontend:**
  - `preferences.test.ts` migrates all three old ids and the default;
  - the dispatch test builds v4 finalized and v4 Turbo options;
  - `use-tts-playback.test.tsx` and `chat-lifecycle.test.mjs` fixtures move to
    the v4 ids.

Checks:

- `uv run pytest -q` (focused, then full);
- `uv run ruff check`;
- `make check-test`;
- `uv run --no-sync python scripts/repository-boundary/check-python-imports.py`;
- from `src/frontend`: `pnpm openapi-ts`, `pnpm check`, `pnpm web:lint` and
  `pnpm web:test`.

Live (G1):

- On the task stack, one finalized v4 reply (two sentences, then paragraph mode)
  plays with emotional delivery.
- Record its first-audio time and characters.

Completion:

- Checks pass.
- `git grep -E "eleven_v3|eleven_flash_v2_5|eleven_multilingual_v2"` finds only
  the migration map, its tests, and history in `docs/plans/`.
- Review passes.
- Commit `feat(voice)[p1]: speak finalized replies with Eleven v4 and migrate model settings`.

Note: realtime speech fails live until Phase 2. The browser still opens the TTS
socket, which rejects v4 Turbo; the text is intact. Phases 1 and 2 ship in the
same PR.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 2: realtime v4 Turbo over the dialogue socket

Requirements: R1, R5 (browser frame compatibility). Depends on Phase 1.

Outcome: realtime replies speak with v4 Turbo browser-direct on local web and
desktop, with the latency target met and robust connection handling. The server
transport keeps working against a Cloud that has not yet changed.

Changes (`use-elevenlabs-tts-runtime.ts`, `use-tts-playback.ts`):

1. **Direct URL:** `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input`
   with `model_id`, `output_format`, `sync_alignment`, `single_use_token` and an
   optional `language_code`. URL redaction is kept in logs.
2. **Direct protocol:**
   - On open, send `{"voices": [voice_id]}`.
   - Send each queued chunk as `{"inputs": [{"text": chunk + " ", "voice_id"}]}`,
     keeping the separating space that trimming drops today.
   - Send `{"flush": true}` once, after the first chunk of the run.
   - Send `{"keep_alive": true}` when 10 s pass without a sent message, until the
     run ends.
   - End of stream sends `{"close_socket": true}`.
   - Treat `is_final` (and the legacy `isFinal`) as the end.
   - Parse error messages (`{message, error, code}`) as failures. The existing
     notice and text fallback apply.
3. **Server transport:**
   - Keep sending `{"text": chunk}` frames and `{"text": ""}` at the end, the
     shape Cloud validates.
   - Accept `is_final` or `isFinal`.
   - An optional `alignment` field is ignored until Phase 3.
4. **Teardown:** cancel, supersede and stop close the socket at once, releasing
   the dialogue session. Late frames for an old run are ignored, as today.
5. **Types:** the session's `sync_alignment` true is accepted. The server
   transport's `sync_alignment: false` remains valid.

Tests:

- **Runtime unit tests** (`use-elevenlabs-tts-runtime.test.ts`,
  `tests/speech/elevenlabsTtsRuntime.test.ts`), using a fake `WebSocket`:
  - URL and query;
  - the first message, input frames with trailing spaces and the single flush;
  - `keep_alive` after 10 s idle (fake timers);
  - `close_socket` at completion;
  - the `is_final` end;
  - an error message ending the run with the notice;
  - server-transport frames unchanged;
  - cancel closing the socket.
- `use-tts-playback.test.tsx` Pocket-fallback cases still pass.
- `hosted-workflows.browser.test.mjs` server socket cases still pass.

Checks:

- `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm desktop:test`;
- product-ui tests (`pnpm --filter @animama/product-ui test`, or the
  repository's equivalent).

Live (G1):

- On local web (task stack) and desktop dev against the task stack, measure
  first audio after the first segment over 5 replies each.
- Record the median against the spike's Flash baseline.
- Verify the reply speaks after a long pause, using a scripted check against the
  runtime with a 25 s gap or a debug delay.
- Check that cancelling mid-reply stops audio and closes the socket.

Completion:

- Median first audio is at most 300 ms on both.
- Checks and review pass.
- Commit `feat(voice)[p2]: stream realtime replies with Eleven v4 Turbo`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3: provider-timed lip-sync

Requirements: R4, plus R5 for timing frames. Depends on Phases 1–2.

Outcome:

- ElevenLabs replies with timing drive mouth movement from word windows.
- Everything else uses the estimated planner unchanged.

Changes:

1. **Backend `tts.audio`:**
   - Add an optional `alignment` field: `{chars, char_start_times_ms, char_durations_ms}`,
     with integer ms relative to the run's first audio sample.
   - `FinalizedTtsStreamBootstrap` adds each batch's offset: the samples
     already emitted in the run, including inserted paragraph silence.
   - Gemini frames carry no `alignment`.
   - Update the golden fixture.
2. **Product-ui:**
   - The SSE type for `tts.audio` gains the optional `alignment`.
   - Session types are unchanged.
   - Bump the `product-ui` version and mirror it in `hosted-web.md`.
3. **Browser timing collection:**
   - A small module (`src/frontend/web/src/lib/speech/provider-speech-timing.ts`)
     builds a run timeline of `{char, startSec, endSec}`:
     - direct socket frames are accumulated with a cursor per turn that advances
       by each frame's length and resynchronises to played samples at
       `is_final_audio_for_turn`;
     - absolute payloads (`tts.audio`, server socket) are appended as they are.
   - It hands the timeline to the bridge for the run.
4. **Word matching:**
   - Group timeline characters into spoken words (Unicode letters, digits and
     apostrophes).
   - Record bracketed `[...]` spans as non-speech intervals.
   - Match the words in order with the run's phonemized words (from the
     `tokenizedText` and `phonemizedText` already queued), tolerating a skipped
     word.
   - If fewer than 80% of words match, or nothing matches, use no timing for that
     run, which is the estimated fallback.
5. **Planner** (`buildGruutVisemeKeyframes`):
   - Add an optional `wordWindows` input (one window or `null` per phonemized
     word).
   - With windows, lay each word's phonemes out within its window by today's
     relative phoneme durations, close the mouth in gaps and non-speech
     intervals, and skip the global `timelineScale`.
   - Words without a window are interpolated between neighbours.
   - Without windows, output is identical to today. Assert this by keeping the
     existing behaviour tests and adding a golden comparison.
6. **Bridge and worker:**
   - Pass windows through the worker protocol.
   - The realtime path rebuilds the in-flight plan as new timed words arrive, at
     most every 250 ms, using the existing `actual_inflight` mechanism.
   - The finalized path rebuilds when timing grows and at `tts.done`.
   - Record which plan source drives the run (`provider_timing` or `estimated`)
     in the bridge state, for Phase 4 and logs.
7. **Server socket:** accept the same absolute `alignment` field on server
   transport audio frames.

Tests:

- **Planner:**
  - word-window placement from recorded spike timing (stored as small fixtures:
    text, chars, times; no audio);
  - pauses close the mouth;
  - tag spans are non-speech;
  - the 80% mismatch rule falls back;
  - output without windows is unchanged.
- **Timing module:**
  - per-frame relative accumulation;
  - resync at turn end;
  - absolute append;
  - `alignment: null` frames.
- **Bridge:** the source flag, in-flight rebuild throttling, and fallback on
  mismatch.
- **Backend:** `tts.audio` alignment offsets across batches and paragraph
  silence; Gemini frames have no alignment.

Checks: as in Phases 1 and 2, plus `make check-test`.

Live (G1):

- One realtime and one finalized reply, each containing a comma pause.
- Visual check that the mouth closes in the pause and starts with the voice.
- Record the source flag.
- A Gemini reply still lip-syncs (estimated).

Completion:

- Checks and review pass.
- Commit `feat(avatar)[p3]: time lip-sync from ElevenLabs character timing`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: side-by-side lip-sync review

Requirements: R4 (side-by-side). Depends on Phase 3.

Outcome: where the Anima debug panel is enabled, the owner can compare both
plans on the same ElevenLabs reply: see both curves and replay either on the
avatar.

Changes:

1. **Capture (debug only).** While the debug panel is enabled, the realtime and
   finalized ElevenLabs runtimes tee the latest run's PCM into a debug store,
   capped at 90 s, keeping only the last run. The bridge keeps that run's inputs
   and both plans: provider-timed and estimated, built from the same phonemes.
   Nothing is captured when the panel is disabled.
2. **Panel section** "Lip-sync", added to `DEBUG_SECTION_KEYS` and the config:
   - a canvas timeline of the audio envelope, the provider word windows and tag
     spans, and both plans' mouth openness (maximum of the A/E/I/O/U weights);
   - a playhead;
   - buttons "Replay with provider timing" and "Replay with estimated timing".
     Each plays the stored PCM through its own `AudioContext` and applies that
     plan to the avatar through the bridge's existing segment path, under a
     synthetic run id;
   - stop, and the drift summary (mean and max word-start difference).
3. **Responsiveness:** the panel works at desktop sizes and does not break
   narrow layouts.

Tests:

- **Debug store:** capture only while enabled, the cap, and last-run
  replacement.
- **Replay:** it builds the chosen plan and applies it through the segment API
  (mocked controller).
- **Summary:** drift values for recorded fixtures.

Checks:

- `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm build`;
- a browser check at desktop size and at a narrow size of the panel.

Live (G1):

- Capture one realtime v4 Turbo reply and one finalized v4 reply.
- Replay both plans on the avatar.
- Save a screenshot of the timeline for the PR.

Completion:

- Checks and review pass.
- Commit `feat(avatar)[p4]: compare provider-timed and estimated lip-sync in the debug panel`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5: hosted contract, Cloud issue, docs and full validation

Requirements: R5, docs and contract acceptance. Depends on Phases 1–4.

Changes:

1. **`contracts/hosted-web.md`:**
   - Realtime descriptor model ids (`eleven_v4_turbo`).
   - Server socket frames:
     - browser `{text}` frames are unchanged;
     - server audio frames are `{audio, alignment?}`, with the alignment time
       base relative to the run's first audio sample;
     - the end marker is `{is_final: true}`, with `isFinal` accepted.
   - `tts.audio` `alignment`.
   - Allowance refusals: `tts.error` for finalized `eleven_v4`.
   - Versions.
2. **Docs:**
   - `docs/frontend/runtime/elevenlabs-tts.md`: models, dialogue socket, token,
     flush, keep-alive, migration, server transport.
   - `docs/frontend/runtime/voice.md`.
   - `docs/frontend/runtime/avatar-lipsync.md`: provider timing, fallback rules,
     the debug comparison.
   - `docs/backend/integrations/voice-and-speech.md`: models, the removed
     environment variable, Text to Dialogue, the token type, `previous_text`.
   - `docs/backend/architecture/http-api.md`: the utility route schema and
     versions.
   - `docs/backend/runtime/chat.md`: `tts.audio` alignment.
   - `src/backend/animama/server/reference.md`, if it lists the models.
3. **Cloud issue.** Prepare `docs/plans/eleven-v4/cloud-issue-draft.md` with:
   - the model ids (`MODELS`, the `eleven_v3` branches in `speech_turn.py`);
   - the HTTP model change, since TTS HTTP accepts v4;
   - optional timing via `stream/with-timestamps`, forwarded as `alignment` with
     run-relative times;
   - the end marker;
   - pricing keys;
   - rollout ordering (G3).

   File it in the Cloud repository only with the owner's go-ahead, since filing
   is outward-facing; otherwise hand it over.
4. **Full validation:**
   - `make check-test`;
   - `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
     `pnpm desktop:test`;
   - `pnpm e2e:test:fast` on a disposable built stack;
   - the package-set build and compare against a `main` baseline:

     ```bash
     uv run --no-sync python scripts/package-sets/build.py build --source . --commit <head> --output <new dir>
     uv run --no-sync python scripts/package-sets/build.py compare <main baseline> <new dir>
     ```

5. **Owner gate pack (G2):**
   - a short checklist in this plan: the voices in use, the IVC check (D5), and
     the side-by-side steps;
   - listening samples from the spike under the ignored `evidence/` folder;
   - fresh v4 samples of the owner's voices on request.

Completion:

- All checks pass and docs are current.
- The Cloud issue is ready.
- Review passes.
- Commit `docs(voice)[p5]: document Eleven v4 speech, timing and the hosted contract`.
  Contract edits made earlier ride their phases.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

## Final integration review

After Phase 5, one `sdlc-reviewer` integration review covers:

- combined acceptance against the spec criteria;
- the cross-phase boundaries: backend frames, product-ui types, runtime and
  bridge;
- security: tokens, logging, the server transport;
- leftovers of the old ids;
- docs accuracy.

It may use at most two repair rounds. Still-valid phase evidence is reused.

## Validation and acceptance

Spec acceptance mapping:

| Criterion | Evidence |
| --- | --- |
| Realtime on local web and desktop, latency | Phase 2 live numbers (median of 5 per surface) and runtime tests |
| Connection handling | Phase 2 tests (keep-alive, cancel) and the live pause check |
| Finalized v4 | Phase 1 backend tests, golden fixture and live reply |
| Migration | Phase 1 tests and the repository search |
| Provider-timed lip-sync | Phase 3 tests, live check, Phase 4 side-by-side (G2) |
| Failures and allowance fallback | Phase 2 and 3 runtime/product-ui tests; existing fallback suites |
| Hosted | Phase 5 contract, server-socket browser tests, Cloud issue |
| Docs and contracts | Phase 5 docs, versions, `openapi-ts`, package-set compare |
| Checks | Phase 5 full run |
| Owner gate | G2 |

Not run by agents: real IVC playback (spec D5), real hosted Cloud speech (G3),
and packaged desktop release builds.

## Idempotence and recovery

- **Preferences:** migration is a pure normalisation; a migrated value written
  back is idempotent. Reverting the release leaves `eleven_v4_turbo` or
  `eleven_v4` stored. An older build normalises unknown ids to its default, so
  it still speaks with Flash; that is acceptable and needs no data repair.
- **Code:** no database or schema changes. Phase commits can be reverted
  independently in reverse order. Phases 1 and 2 must revert together to keep
  realtime speech working.
- **Live checks:** re-running them costs characters (G1). The spike scripts are
  rerunnable and print no secrets.
- **Stacks:** `./reset.sh --name ev4 ...` is idempotent. Tear down with
  `docker compose -p animama-ev4 down` after the last use; keep the volumes
  unless the owner asks for a purge.
- **Legacy restoration (contingency for D1):** add `eleven_v3` back to the
  finalized literal and options with a "Legacy" label and its `previous_text`
  omission. This is a bounded follow-up, decided at G2.

## Outcomes & Retrospective

Pending implementation.
