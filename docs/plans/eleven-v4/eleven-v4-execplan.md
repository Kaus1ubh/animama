# Eleven v4 and v4 Turbo execution plan

Status: Phases 1–2 authorized by the owner on 2026-10-12. Phases 3–5 are agreed in
scope but not yet authorized.

Source agreement: [spec](eleven-v4-spec.md), agreed by the owner on 2026-10-12
(decisions D1–D12), for
[issue #471](https://github.com/raymond-van/animama/issues/471). Research:
[eleven-v4-research.md](eleven-v4-research.md).

Authorized scope: Phases 1–2 (owner, 2026-10-12).
- Phase 1 delivers the v4 Turbo streamed path first, by the owner's priority
  (spec D10).
- One PR carries the whole plan (owner, 2026-10-12).

Explicit gates:

- **G1 — Paid live checks.** Live ElevenLabs checks during implementation stay
  within the owner-approved budget (spec D6: US$1, of which about US$0.02 is
  spent).
- **G2 — Owner gate before merge.**
  - The owner listens to v4 Turbo and v4 with the voices in use.
  - The owner reviews the side-by-side view on a v4 reply.
  - Instant Voice Clone verification was waived on 2026-10-12 (spec D5).
- **G3 — Hosted (Cloud).** Cloud must adopt the v4 model ids before or together
  with hosted adoption of this release (spec D7). It is tracked by a Cloud issue,
  not by this PR.

## Purpose and context

Replace ElevenLabs `eleven_flash_v2_5` and `eleven_multilingual_v2` (realtime)
and `eleven_v3` (finalized) with `eleven_v4_turbo` and `eleven_v4`, and let
finalized speech reach providers in every language. Carry ElevenLabs character
timing to the browser as evidence for #468's lip-sync planner, and add a
side-by-side view. The spike established the protocol facts this plan depends on:

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
  no timing, and it keeps the estimated path. It gains every-language segments
  (D9).
- Today's gruut planner is not extended (spec D8). #468 owns lip-sync rendering
  from timing.

## Progress

- [x] Spike (2026-10-12), about US$0.33 of US$1:
  [research brief](eleven-v4-research.md).
- [x] Spec drafted (2026-10-12): [eleven-v4-spec.md](eleven-v4-spec.md).
- [x] ExecPlan drafted (2026-10-12).
- [x] Owner review, 2026-10-12: D1–D4 agreed, D5 waived, D6 approved.
- [x] Follow-up probes, 2026-10-12, about US$0.02 of the D6 budget: v4 accepts
  request stitching, and 8 dialogue sessions generated at once
  ([research §7](eleven-v4-research.md#7-follow-up-probes-2026-10-12-after-owner-review)).
- [x] Owner decisions, 2026-10-12:
  - realtime first;
  - D8 narrowed;
  - D9 pulled in;
  - audio tags as new scope behind intent discovery.

  Phases 1–2 authorized.
- [x] Spec published to #471 at `5e0c6797` and read back (2026-10-12). Phase
  issues #480 and #481 were created as native sub-issues of #471.
- [ ] Phase 1 (#480): realtime v4 Turbo over the dialogue socket.
- [ ] Phase 2 (#481): finalized v4, model cleanup and every language.
- [ ] Phase 3: timing plumbing and the timing evidence module (not yet
  authorized).
- [ ] Phase 4: side-by-side view with pluggable plan sources (not yet
  authorized).
- [ ] Phase 5: hosted contract, Cloud issue, docs and full validation (not yet
  authorized).
- [x] Intent discovery for audio tags in `speech` (D12), 2026-10-12: linked
  issue [#479](https://github.com/raymond-van/animama/issues/479).
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
  corrects the docs, unless the owner prefers the other default (now Phase 2).
- **SDK gap.** The installed `elevenlabs` SDK 2.39.0 has no Text to Dialogue
  socket client, and its dialogue `stream_with_timestamps` has no `previous_text`
  parameter. The latest release is 2.71.0.
- **#468 brief** (`docs/lipsync-investigation` at `ccda1f26`, PR #473):
  - It scored v4 timing on 14 clips against forced alignment.
  - Timing rendered directly holds the mouth open in 21% (English) and 13% (tag
    lines) of silent gaps, because word ends overrun pauses by 0.1–0.35 s.
  - A mid-sentence `[laughs]` got 48 ms, with the laugh credited to the word
    before it.
  - Timing as evidence in #468's planner reached 66% vowel match, 5% / 4% open in
    silence, and 6 of 7 tags.
  - Hence spec D8: Phase 3 builds evidence, not rendering. The brief also found
    the gruut gate on finalized TTS (spec D9).
- **No comparison tooling.** No debug tooling shows two lip-sync plans; the
  bridge keeps one plan per run.
- **Follow-up probes.**
  - v4 accepts `previous_request_ids` on Text to Dialogue HTTP, and every
    response carries a `request-id` header.
  - 8 v4 Turbo sockets generated at once with no refusal, at 408–436 ms first
    audio.

## Decision Log

- **2026-10-12 — owner (task instruction):**
  - Legacy models are allowed if replacing them proves too much work or too
    risky; full removal is preferred.
  - Use provider timing for lip-sync if feasible, with the estimated path as the
    fallback, and show the two side by side.
  - Tag mouth shapes and other providers stay in #468.
  - Proposed defaults: v4 Turbo realtime, v4 finalized as the optional mode.
- **2026-10-12 — owner, after review:**
  - D1: remove the old models.
  - D3: v4 Turbo is the realtime default, and v4 the finalized option.
  - D4: optimise the integration for v4 alone. That means:
    - Text to Dialogue WebSocket and `ttd_websocket` tokens;
    - Text to Dialogue HTTP for finalized and utility synthesis;
    - stitching;
    - hosted concurrency handling, in the Cloud issue.
  - D5: IVC verification is waived.
  - D6: US$1 is approved for live checks.
- **2026-10-12 — agent proposal: continuity.** Finalized requests send
  `previous_request_ids` with up to the last three request ids of the run. The
  ids come from each response's `request-id` header. They fall back to a
  100-character `previous_text` when no id is known, for example after a failed
  request. Whether stitching sounds better than `previous_text` is judged at G2.
- **2026-10-12 — owner: priority, D8, D9, D12.**
  - **Priority:** the v4 Turbo streamed path comes first, so Phases 1–2 are
    reordered realtime-first.
  - **D8 narrowed:**
    - timing plumbing;
    - an evidence module with per-character CJK windows, punctuation as
      possible pauses, and classified tags (non-verbal, delivery or emotion,
      pacing; unknown tags count as markers);
    - a side-by-side view agnostic about where a plan came from;
    - no extension of `buildGruutVisemeKeyframes`.
  - **D9:** remove the gruut gate in this change (Phase 2).
  - **D12:** audio tags in `speech` go to intent discovery and a linked issue.
- **2026-10-12 — owner:**
  - D10: one PR for the whole plan (the realtime-first PR split was declined);
  - D11: no English lip-sync change before #468;
  - D12: intent discovery done, with the outcome in
    [#479](https://github.com/raymond-van/animama/issues/479). Its sound effects
    add a class to the Phase 3 evidence module.
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

Phases follow the owner's priority (D10). Phase 1 delivers the v4 Turbo streamed
path on its own and leaves `eleven_v3` untouched. Phase 2 migrates the finalized
path and removes the gruut gate (D9). Phases 3–5 are agreed in scope but not yet
authorized.

### Phase 1: realtime v4 Turbo over the dialogue socket

Issue: #480. Requirements: R1, R3 (realtime models), R5 (browser frame
compatibility). Starting source: `5e0c6797` on `feat/eleven-v4` (base
`95a2db39`).

Outcome:

- Realtime replies speak with `eleven_v4_turbo`, browser-direct, over the Text to
  Dialogue socket on local web and desktop.
- The latency target is met, and the connection survives long pauses.
- Saved Flash v2.5 and Multilingual v2 preferences become v4 Turbo.
- `eleven_v3` (finalized) is untouched until Phase 2.
- The server transport keeps working against an unchanged Cloud.
- Timing is requested (`sync_alignment=true`) but not yet consumed (Phase 3).

Changes:

1. **Backend models** (`app/contracts/elevenlabs.py`):
   - Realtime `Literal["eleven_v4_turbo"]`; the chat union becomes
     `eleven_v4_turbo | eleven_v3`. The `SUPPORTED_*` names that Cloud imports are
     kept.
   - Add `LEGACY_ELEVENLABS_TTS_MODEL_REPLACEMENTS` with
     `eleven_flash_v2_5` and `eleven_multilingual_v2` → `eleven_v4_turbo`.
     Phase 2 adds `eleven_v3` → `eleven_v4`.
2. **Dispatch** (`dispatch.py`, `options.py`): a `mode="before"` validator on
   `PyAnimaTtsRunOptions.model_id` maps legacy ids, so a stale tab's request
   still gets its reply. The provider/model validator is unchanged.
3. **Config:**
   - Remove `elevenlabs_realtime_tts_default_model_id` and the
     `ANIMAMA_ELEVENLABS_REALTIME_TTS_DEFAULT_MODEL_ID` variable; there is one
     realtime model.
   - `resolve_realtime_tts_model_id` returns v4 Turbo and maps legacy explicit
     values.
4. **Token and session** (`elevenlabs_service.py`):
   - Mint `ttd_websocket` single-use tokens. The SDK's `SingleUseTokenType` lacks
     it, so call `POST /v1/single-use-token/ttd_websocket` through the SDK with a
     typed cast, or directly with the shared `httpx` client. Never log the token.
   - The session sets `sync_alignment=True`.
   - Rename `mint_tts_websocket_single_use_token` accordingly.
5. **Browser runtime** (`use-elevenlabs-tts-runtime.ts`):
   - **Direct URL:** `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input`
     with `model_id`, `output_format`, `sync_alignment`, `single_use_token` and
     an optional `language_code`. URL redaction is kept in logs.
   - **Direct protocol:**
     - On open, send `{"voices": [voice_id]}`.
     - Send each chunk as `{"inputs": [{"text": chunk + " ", "voice_id"}]}`.
     - Send `{"flush": true}` once, after the run's first chunk.
     - Send `{"keep_alive": true}` after 10 s without a sent message, until the
       run ends.
     - End with `{"close_socket": true}`.
     - End on `is_final`, and also accept `isFinal`.
     - Treat `{message, error, code}` messages and abnormal closes as failures,
       with the existing notice and the text intact.
   - **Server transport:**
     - Keep `{"text": chunk}` frames and the `{"text": ""}` end, the shape
       Cloud validates.
     - Accept `is_final` or `isFinal`.
     - Ignore an `alignment` field until Phase 3.
   - **Teardown:** cancel, supersede and stop close the socket at once,
     releasing the dialogue session. Late frames for an old run are ignored, as
     today.
6. **Settings** (`preferences.ts`, `ApplicationSettingsModal.tsx`,
   `elevenlabs-chat-tts-dispatch.ts`, `useChatSession.ts`):
   - The options are "Eleven v4 Turbo" (realtime, fastest, default) and the
     existing "Eleven v3" (finalized) until Phase 2.
   - `DEFAULT_ELEVENLABS_TTS_MODEL_ID = "eleven_v4_turbo"`.
   - Normalizers map the legacy realtime ids. The settings modal writes the
     replacement when it loads a migrated value, so old ids are never sent.
7. **Contracts and client:**
   - `local-http` 6.0.0 in `contracts/versions.json`, mirrored in
     `hosted-web.md` and `http-api.md`.
   - Bump `runtime-contracts`, and bump `product-ui` if its types change.
   - Run `pnpm openapi-ts` offline.
   - Re-record `tts-realtime.sse` with `CHAT_SSE_GOLDEN_RECORD=1`.
8. **Docs:**
   - The realtime sections of `docs/frontend/runtime/elevenlabs-tts.md` and
     `docs/backend/integrations/voice-and-speech.md`: models, the dialogue
     socket, the token type, flush, keep-alive, migration and the removed
     variable.
   - The realtime-descriptor model id in `contracts/hosted-web.md`.

Tests (TDD where behavior changes):

- **Backend:**
  - legacy realtime ids map in `PyAnimaTtsRunOptions` and still yield a reply;
  - the session descriptor carries v4 Turbo, a `ttd_websocket` token and
    `sync_alignment: true`;
  - the minted token type;
  - the realtime golden fixture;
  - `eleven_v3` finalized tests unchanged.
- **Runtime** (`use-elevenlabs-tts-runtime.test.ts`,
  `tests/speech/elevenlabsTtsRuntime.test.ts`), with a fake `WebSocket` and fake
  timers:
  - URL and query, and the first message;
  - input frames with trailing spaces, and the single flush;
  - `keep_alive` after 10 s idle, and `close_socket` at completion;
  - the `is_final` end;
  - an error message ending the run with the notice;
  - server-transport frames unchanged, ending on either marker;
  - cancel closing the socket.
- **Preferences and dispatch:** `preferences.test.ts` migrates both realtime
  ids and the default; the dispatch test covers v4 Turbo.
- **Regressions:**
  - `use-tts-playback.test.tsx` Pocket-fallback cases;
  - `chat-lifecycle.test.mjs`;
  - `hosted-workflows.browser.test.mjs` server-socket cases.

Checks:

- `uv run pytest -q` (focused, then full), `uv run ruff check` and
  `make check-test`;
- `uv run --no-sync python scripts/repository-boundary/check-python-imports.py`;
- from `src/frontend`: `pnpm openapi-ts`, `pnpm check`, `pnpm web:lint`,
  `pnpm web:test` and `pnpm desktop:test`.

Live (G1), on the task stack and desktop dev against it:

- 5 replies each on web and desktop: first audio after the first segment,
  median recorded against the spike's Flash baseline (862 ms);
- a reply after a pause longer than 20 s, using a debug delay or a scripted
  runtime check;
- cancelling mid-reply stops audio and closes the socket;
- Japanese, Korean and Chinese replies are spoken (streamed path, D9
  verification).

Completion:

- Median first audio is at most 300 ms on both surfaces.
- Checks and review pass.
- Commit `feat(voice)[p1]: stream realtime replies with Eleven v4 Turbo`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 2: finalized v4, model cleanup and every language

Issue: #481. Requirements: R2, R3 (finalized and cleanup), R6 and R7. Depends on
Phase 1.

Outcome:

- Finalized replies speak with `eleven_v4` over Text to Dialogue HTTP with
  timestamps, with stitching and the tone tag.
- `eleven_v3` is gone and migrates to `eleven_v4`.
- The utility route speaks v4.
- Finalized v4 and Gemini speak Japanese, Korean, Chinese and Spanish sentences.
- Timing is parsed in the backend but not yet emitted (Phase 3).

Changes:

1. **Models and migration:**
   - The finalized literal becomes `Literal["eleven_v4"]`, and the chat union
     `eleven_v4_turbo | eleven_v4`.
   - Add `eleven_v3` → `eleven_v4` to the legacy map.
   - Frontend: the "Eleven v4" option (finalized, highest quality, speaks each
     sentence once written) replaces "Eleven v3", and
     `isElevenLabsFinalizedTtsModelId` is true for `eleven_v4`.
   - Relabel the grouping row and the "Unavailable with Eleven v3" text. Keep the
     stored key `tts_elevenlabs_v3_finalized_chunking` and the current
     `"paragraph"` default; correct the docs that say `"sentence"`.
2. **Finalized provider call** (`elevenlabs_service.py`):
   - Use Text to Dialogue `stream/with-timestamps` with `inputs=[{text, voice_id}]`,
     `model_id`, `language_code`, `apply_text_normalization="off"` and
     `pcm_24000`.
   - Continuity: `previous_request_ids` (the run's last ≤3 ids, from each
     response's `request-id` header), else `previous_text` (≤100 characters).
   - The installed SDK's dialogue stream lacks both parameters and the header,
     so prefer a direct streamed request through the shared `httpx` client.
     Record the choice.
   - Parse the NDJSON `audio_base64` and `alignment`, and keep the PCM framing
     (`pop_pcm_audio_frame`).
   - Keep the alignment in ms on the yielded internal `audio` events.
   - Remove the v3 `previous_text` omission.
   - `FinalizedTtsStreamBootstrap` keeps the run's last three request ids.
3. **Tone:** rename `elevenlabs_v3_text_with_emotional_prefix` to a model-neutral
   name and apply it for `eleven_v4`. Bound the ElevenLabs `previous_text` to
   100 characters; Gemini's bound is unchanged.
4. **Chat speech** (`tts.py`, `sse_events.py`):
   - Replace the `"eleven_v3"` literals with the finalized model set.
   - `_uses_previous_text` is true for ElevenLabs.
5. **Utility route:**
   - Text to Dialogue `convert` with v4 by default.
   - `PyElevenLabsVoiceSettings` keeps `stability` and `similarity_boost`
     (mapped to `similarity`); drop `style`, `use_speaker_boost` and `speed`.
   - Delete the unused `PyElevenLabsRealtimeTtsSessionRequest` and
     `PyElevenLabsFinalizedTtsStreamRequest` after confirming they have no users.
   - Nothing calls `text_to_speech.*` for speech any more.
6. **Remove the gruut gate (D9):**
   - `_attach_tts_speech_payload` prepares a segment from the speech text
     whatever gruut returns.
   - When gruut yields English phonemes, the segment keeps `tts_text`,
     `tts_phonemized_text` and the `gruut_text_with_ws` basis, so English
     lip-sync is unchanged.
   - Otherwise the segment speaks the visible text (`visible_text` basis) with
     no phonemes.
   - Revisit `server/finalized_speech.py` and the frontend selector so both
     bases work.
   - If gruut's cost on non-English text matters (the #468 brief measured
     294–549 ms on Korean), skip gruut for text with no Latin letters. Record
     the measurement and the choice.
7. **Contracts, client and docs:**
   - Fold into the same `local-http` 6.0.0 bump (one PR).
   - Bump `runtime-contracts`; run `pnpm openapi-ts`.
   - Re-record `tts-finalized.sse`.
   - Update the finalized and language sections of the docs.

Tests:

- **Backend:**
  - finalized v4 sends the tone tag and frames PCM in sentence and paragraph
    modes;
  - it stitches request ids from the second request on, and falls back to
    `previous_text` after a failed or id-less request;
  - a failed batch emits `tts.error` without `tts.done`;
  - legacy `eleven_v3` maps;
  - utility-route default and settings mapping;
  - ja, ko, zh and es sentences produce segments and are spoken, for both v4
    and Gemini (fake providers);
  - English segments keep their gruut payload;
  - golden fixtures.
- **Frontend:**
  - `preferences.test.ts` migrates `eleven_v3`;
  - the dispatch test covers v4 finalized;
  - `chat-lifecycle.test.mjs` and `use-tts-playback.test.tsx` fixtures move to
    `eleven_v4`;
  - the TTS payload selector handles both text bases.

Checks: as in Phase 1, plus `pnpm build`.

Live (G1):

- One finalized v4 reply (two sentences, then paragraph mode), with first-audio
  time and characters.
- One stitched and one `previous_text` rendering of the same two sentences, for
  G2.
- One Japanese and one Korean finalized v4 reply, and one Gemini Japanese reply.

Completion:

- Checks and review pass.
- `git grep -E "eleven_v3|eleven_flash_v2_5|eleven_multilingual_v2"` finds only
  the migration map, its tests and history in `docs/plans/`.
- Commit `feat(voice)[p2]: speak finalized replies with Eleven v4 in every language`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3: timing plumbing and the timing evidence module

Requirements: R4 (timing and module), R5 (timing frames). Depends on Phases 1–2.
Not yet authorized.

Outcome:

- Every v4 reply's character timing reaches the browser in one time base.
- A provider-neutral module turns it into evidence that #468's planner and the
  Phase 4 view consume.
- Lip-sync rendering is unchanged (D8).

Changes:

1. **Backend `tts.audio`:**
   - An optional `alignment` field: `{chars, char_start_times_ms, char_durations_ms}`,
     integer ms relative to the run's first audio sample.
   - `FinalizedTtsStreamBootstrap` adds each batch's offset: the samples already
     emitted in the run, including inserted paragraph silence.
   - Gemini frames carry none.
   - Update the golden fixture.
2. **Product-ui:** the SSE type gains the optional field; bump `product-ui`.
3. **Browser collection** (`src/frontend/web/src/lib/speech/provider-speech-timing.ts`):
   - **Realtime socket:** per-frame relative times, with a cursor per turn that
     advances by each frame's length and resynchronises to the played samples
     at `is_final_audio_for_turn`. It tolerates `alignment: null`.
   - **Absolute payloads** (`tts.audio`, the server socket) are appended as they
     are.
   - The result is a run timeline of `{char, startSec, endSec}`, kept by run id
     in a small store. It is cleared with the run, and late frames are ignored.
4. **Evidence module** (`src/frontend/web/src/lib/speech/speech-timing-evidence.ts`),
   a pure function from a timeline to evidence:
   - Spoken words: runs of Latin, Cyrillic and similar letters, digits and
     apostrophes. Han, kana and Hangul characters each keep their own window.
   - Punctuation entries with times, marked as possible pauses.
   - Bracketed spans with the raw tag text and a class:
     - non-verbal sound → a non-speech interval;
     - sound effect (allowed on ElevenLabs by #479) → a separate non-speech
       interval, mouth at rest;
     - delivery or emotion → a zero-width marker at the span's start that applies
       to the following words;
     - pacing → a silent interval.
   - Classification uses a small keyword table. It handles combined tags
     (`[whispering, playful]`); unknown tags become delivery or emotion markers,
     never words.
   - The emotional prefix tag classifies as emotion.
   - It reports provider times unchanged. Overrun word ends and short tag spans
     are documented as hints for the planner.
5. **Fixtures:**
   - Recorded from the spike (text, characters and times; no audio) under
     `src/frontend/web/src/lib/speech/__fixtures__/`.
   - English with pauses, tags (`[laughs]`, `[sighs]`), numbers and the tone
     prefix; a v4 Turbo socket run with per-frame times and turns.
   - New small captures for ja, ko, zh and es, and for `[gasps]`, `[whispers]`,
     `[pause]` and a combined tag, within G1.
6. **Server socket:** accept the absolute `alignment` field on server transport
   audio frames.

Tests:

- **Collection:**
  - cursor accumulation and turn resync;
  - `alignment: null` frames;
  - absolute append;
  - late or old-run frames ignored.
- **Evidence:** on fixtures, Latin words, per-character CJK windows,
  punctuation, each tag class, combined and unknown tags, and the tone prefix.
- **Backend:** `tts.audio` offsets across batches and paragraph silence; Gemini
  frames without alignment.

Checks: as in Phase 2.

Live (G1): one realtime and one finalized v4 reply. Inspect the collected timeline
in development tools against the audio.

Completion:

- Checks and review pass.
- Commit `feat(avatar)[p3]: collect ElevenLabs timing as lip-sync evidence`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: side-by-side view with pluggable plan sources

Requirements: R4 (side-by-side view). Depends on Phase 3. Not yet authorized.

Outcome: where the Anima debug panel is enabled, the owner can inspect a v4
reply's audio, its timing evidence and every registered lip-sync plan, and
replay the reply on the avatar with any of them.

Changes:

1. **Plan-source registry:** a small interface,
   `{id, label, build(inputs) → vowel keyframe plan | null}`.
   - Register "Estimated (today)", wrapping today's planner unchanged.
   - #468 registers its planner later.
2. **Capture (debug only):**
   - While the panel is enabled, the ElevenLabs runtimes tee the latest run's PCM
     into a debug store, capped at 90 s and keeping only the last run.
   - The store also keeps that run's evidence and planner inputs.
   - Nothing is captured when the panel is disabled.
3. **Panel section "Lip-sync":**
   - a canvas timeline: audio envelope; evidence overlay (words or characters,
     punctuation, tag intervals and markers); one mouth-openness curve per plan
     source;
   - a playhead;
   - "Replay with <plan>" for each source, playing the stored PCM through its own
     `AudioContext` and applying that plan through the bridge's segment path
     under a synthetic run id;
   - stop.
4. **Layout:** desktop sizes first, then narrow layouts without breakage.

Tests:

- **Registry:** adding a source needs no view change; a test source appears as a
  curve.
- **Debug store:** capture only while enabled, the cap, and last-run replacement.
- **Replay:** it applies the chosen plan through the segment API (mocked
  controller).

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm build`, plus a
browser check at desktop and narrow sizes.

Live (G1): capture a realtime and a finalized v4 reply, replay them, and save a
timeline screenshot for the PR.

Completion:

- Checks and review pass.
- Commit `feat(avatar)[p4]: compare lip-sync plans against ElevenLabs timing in the debug panel`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5: hosted contract, Cloud issue, docs and full validation

Requirements: R5, docs and contract acceptance. Depends on Phases 1–4. Not yet
authorized.

Changes:

1. **`contracts/hosted-web.md`:**
   - server socket frames:
     - browser `{text}` frames are unchanged;
     - server audio frames are `{audio, alignment?}`, with times relative to the
       run's first audio sample;
     - the end marker is `{is_final: true}`, with `isFinal` accepted;
   - `tts.audio` `alignment`;
   - allowance refusals: `tts.error` for finalized `eleven_v4`;
   - versions.
2. **Docs:** finish what the phases have not covered:
   - `docs/frontend/runtime/elevenlabs-tts.md`, `voice.md` and
     `avatar-lipsync.md` (timing evidence, the debug view, and the unchanged
     planner);
   - `docs/backend/integrations/voice-and-speech.md`;
   - `docs/backend/architecture/http-api.md`;
   - `docs/backend/runtime/chat.md`;
   - `src/backend/animama/server/reference.md`, if it lists models.
3. **Cloud issue.** Prepare `docs/plans/eleven-v4/cloud-issue-draft.md` with:
   - the model ids (`MODELS`, and the `eleven_v3` branches in `speech_turn.py`);
   - the HTTP model change (TTS HTTP accepts v4);
   - optional timing via `stream/with-timestamps`, forwarded as `alignment` with
     run-relative times;
   - the end marker;
   - pricing keys;
   - rollout ordering (G3);
   - dialogue-pool concurrency, if Cloud moves realtime to a server-side socket:
     - open a session only while a reply speaks, and close it at the end or on
       cancel;
     - cap and queue per operator;
     - treat refusals as speech refusals that keep the text;
     - measure the operator plan's limit before launch (the owner's plan showed
       none at 8 generating or 16 idle sessions).

   File it in the Cloud repository only with the owner's go-ahead; otherwise
   hand it over.
4. **Full validation:**
   - `make check-test`;
   - `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` and
     `pnpm desktop:test`;
   - `pnpm e2e:test:fast` on a disposable built stack;
   - the package-set build and compare against a `main` baseline.
5. **Owner gate pack (G2):** a checklist covering the voices in use, v4 Turbo
   and v4 listening (stitched and `previous_text`), and the side-by-side steps.

Completion:

- All checks pass and docs are current.
- The Cloud issue is ready.
- Review passes.
- Commit `docs(voice)[p5]: document Eleven v4 speech, timing evidence and the hosted contract`.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Linked: audio tags in the chat model's `speech` (D12)

Not part of these phases. Intent discovery ran on 2026-10-12, and the outcome is
[#479](https://github.com/raymond-van/animama/issues/479). It depends on Phases
2–3. Its spec and plan placement are decided when `to-spec` completes it.

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
| Realtime on local web and desktop, latency | Phase 1 live numbers (median of 5 per surface) and runtime tests |
| Connection handling | Phase 1 tests (keep-alive, cancel) and the live pause check |
| Finalized v4 | Phase 2 backend tests, golden fixture and live reply |
| Every language | Phase 2 per-language tests and live replies; Phase 1 streamed check |
| Migration | Phase 1 (realtime ids) and Phase 2 (`eleven_v3`) tests, and the repository search |
| Timing evidence and module | Phase 3 tests on recorded fixtures |
| Side-by-side view | Phase 4 tests, screenshot, G2 |
| Failures and allowance fallback | Phase 1 runtime and product-ui tests; existing fallback suites |
| Hosted | Phase 1 server-socket compatibility tests; Phase 5 contract and Cloud issue |
| Docs and contracts | Phases 1–2 contract bumps, `openapi-ts`; Phase 5 docs and package-set compare |
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
  independently in reverse order. Phase 1 stands alone. Reverting it alone
  restores Flash and the Text to Speech socket.
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
