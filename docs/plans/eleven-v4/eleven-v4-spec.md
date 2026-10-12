# Eleven v4 and v4 Turbo voices with provider-timed lip-sync

Status: Proposal (agent draft, 2026-10-12), for owner review.

Owner decision: the owner gave three decisions in the task instruction of
2026-10-12, recorded as D1–D3 below. The agent's proposals that still need owner
confirmation are marked **Proposed**.

Authoritative source: this draft, until `workspace-setup` publishes it to
[issue #471](https://github.com/raymond-van/animama/issues/471).
Research: [eleven-v4-research.md](eleven-v4-research.md) (spike of 2026-10-12).

## Problem and intended users

Animama speaks ElevenLabs replies with three older models:

- **Realtime path:** `eleven_flash_v2_5` (the default) and `eleven_multilingual_v2`.
  The browser streams the reply's sentences to ElevenLabs' Text to Speech
  WebSocket while the reply is written.
- **Finalized path:** `eleven_v3`. The backend speaks each finished sentence or
  paragraph and pushes PCM over `chat:sse`.

ElevenLabs now offers Eleven v4 and v4 Turbo. They have better voice accuracy and
more languages (94), follow richer audio tags, and cost the same per character as
the models they replace. Neither runs on the Text to Speech WebSocket.

The avatar's lip-sync estimates phoneme durations from gruut and stretches the
whole plan to the clip length. Pauses, laughs and leading silence therefore pull
the mouth away from the voice: in the spike the estimated word starts were up to
0.6 s off on a sentence with a comma pause, and 0.9 s off after a laugh. v4 can
return per-character timing of the audio actually spoken.

This change serves the local installation owner, on desktop and self-hosted web,
who chats with an Anima that speaks with an ElevenLabs voice. Hosted Animama Cloud
users benefit once Cloud adopts the updated contract.

## Goals, scope and non-goals

Include:

- `eleven_v4_turbo` on the realtime path, over the Text to Dialogue WebSocket.
- `eleven_v4` on the finalized path, keeping sentence and paragraph batching,
  the emotional tone tag and PCM frames over `chat:sse`.
- Removal of `eleven_flash_v2_5`, `eleven_multilingual_v2` and `eleven_v3`, with
  automatic migration of saved preferences (D1, D4).
- Lip-sync timed from ElevenLabs character timing when it is available, with
  today's estimated path as the fallback, plus a side-by-side review aid (D2).
- The hosted contract for the `transport: "server"` socket, and a prepared Cloud
  issue.
- Docs, contract versions and the regenerated client.

Exclude:

- Mouth shapes for vocal tags (laughs, sighs) and lip-sync for non-ElevenLabs
  providers or languages gruut cannot phonemize. [#468](https://github.com/raymond-van/animama/issues/468)
  owns these. Tag spans are only kept out of word timing here.
- Multi-speaker dialogue; each connection uses one voice.
- Gemini TTS behaviour. It shares the finalized pipeline and must not regress.
- Voice-cloning UI, beyond keeping clones working.
- Animama Cloud code. A Cloud issue is prepared but not implemented.
- Allowing the model to write audio tags in `speech`. The prompt's ban on tags
  stays; #468 decides when to lift it.

## Required behavior

### R1 — Realtime speech with v4 Turbo

- When the owner's ElevenLabs model is v4 Turbo, the reply's speech streams over
  ElevenLabs' Text to Dialogue WebSocket while the reply is written. This holds on
  local web and desktop.
- The browser connects directly with a single-use dialogue token minted by the
  backend for that reply. The ElevenLabs key never reaches the browser.
- Speech starts promptly after the reply's first sentence. Acceptance: median
  first audio within 300 ms of the first speech segment being sent on an open
  socket, measured live and recorded against Flash v2.5 (spike baseline 862 ms;
  v4 Turbo 106–149 ms).
- A short first sentence is not held back by the provider's 40-character /
  8-word buffer.
- The connection survives pauses in the reply longer than the provider's 20 s
  inactivity timeout, and closes as soon as the reply's speech ends, the reply
  is cancelled, or the run is superseded.
- If the token, socket or provider fails, that reply's speech stops with the
  existing "Text-to-speech unavailable" notice. The text reply is intact, and the
  next reply tries again.

### R2 — Finalized speech with v4

- When the owner's model is v4, each finished sentence (or paragraph, in the
  paragraph grouping mode) is spoken by the backend and pushed over `chat:sse` as
  PCM, as Eleven v3 is today.
- The reply's emotional tone still leads each request as an audio tag.
- Each request after the first carries up to 100 characters of the preceding
  text for continuity, which v3 could not take.
- Requests stay at or under 2,000 characters.
- A failed batch ends that reply's speech with the existing error frame. The text
  is intact.
- Gemini finalized speech behaves exactly as before.

### R3 — Model choice, defaults and migration

- App Settings → Voice offers two ElevenLabs models: Eleven v4 Turbo (realtime)
  and Eleven v4 (finalized). Each shows a one-line description of its trade-off.
  The finalized grouping option stays available for v4, and its saved value is
  kept.
- **Proposed default (D3):** v4 Turbo for new settings and for the server
  default; v4 as the optional higher-quality mode.
- Saved preferences migrate without owner action:
  - `eleven_flash_v2_5` and `eleven_multilingual_v2` become `eleven_v4_turbo`;
  - `eleven_v3` becomes `eleven_v4`;
  - the settings show the new model, and the old ids are never sent to the
    backend again.
- A chat request that still carries an old id, for example from a browser tab
  open across an upgrade, is answered with the mapped replacement rather than
  rejected. Its text reply is never lost to an old id.
- The old ids are removed from contracts, settings, the server's default-model
  setting, the utility synthesis route and docs. Only the one-way migration map
  keeps them.

### R4 — Lip-sync from provider timing

- For ElevenLabs v4 and v4 Turbo replies, the backend and browser request
  character timing.
- When timing is received, each spoken word's mouth movement is placed within
  that word's timing in the audio:
  - silences between words are closed or at rest;
  - leading silence is respected;
  - spans of audio tags, including the emotional prefix tag, are treated as
    non-speech and never mouthed as words.
- Today's estimated path remains in use when:
  - the provider is not ElevenLabs (Pocket TTS, Gemini, browser speech);
  - timing is missing or incomplete;
  - the timed words cannot be matched to the reply's phonemized words;
  - the language yields no phonemes.
  Falling back never stops speech or lip-sync.
- Timing is consumed with the audio it describes, so speech never waits for it.
- **Side-by-side review:** for an ElevenLabs reply with timing, the owner can
  compare the provider-timed and estimated lip-sync on the same reply, in a
  debug-only view available where the Anima debug panel is enabled:
  - both mouth curves are shown against the reply's audio timeline;
  - the reply can be replayed on the avatar with either plan.

  The view is not part of the normal product UI.

### R5 — Hosted server transport

- The hosted contract describes how a `transport: "server"` session proxies v4
  Turbo speech, including optional timing frames and their time base.
- The browser keeps sending the frame shape the hosted socket already validates,
  so a Cloud that has not yet adopted v4 is not broken by this release.
- The browser accepts both the existing and the new end-of-stream markers from
  the server socket. When no timing arrives, lip-sync falls back as in R4.
- The `speech_allowance_exhausted` → Pocket TTS fallback is unchanged. It applies
  to `tts.session.error` for realtime v4 Turbo and to `tts.error` for finalized
  v4.
- A Cloud issue in the Cloud repository describes the required Cloud changes.
  This task does not change Cloud code.

### R6 — Voice compatibility and settings

- Existing premade and shared-library voices, including Animama's default voice,
  speak on both models.
- Instant Voice Clones made through Animama keep working on both models.
- v4 accepts only Stability and Similarity. The utility synthesis route's voice
  settings drop Style, Speed and Speaker Boost. The route's default model becomes
  a v4 model.

## Constraints

- **Security:**
  - The ElevenLabs key stays on the backend.
  - The browser receives only a short-lived single-use token, of type
    `ttd_websocket`, for one connection.
  - Tokens and keys are never logged; existing URL redaction is kept.
- **Provider facts (spike):**
  - The Text to Speech WebSocket rejects v4.
  - The dialogue socket requires a `ttd_websocket` token. The `tts_websocket`
    token is refused.
  - Each open dialogue connection holds a session from a separate concurrency
    pool for its whole life, and closes after 20 s without a message.
  - Socket timing frames restart at zero per frame; HTTP timing is cumulative per
    request.
- **Compatibility:**
  - Contract versions follow `scripts/package-sets/README.md`. Changing the model
    enum is a `local-http` major.
  - The generated client is regenerated offline with `pnpm openapi-ts`.
  - The exported realtime model set that Cloud imports keeps its name.
- **Reliability:** a speech failure never removes or delays the text reply. Late
  audio, late timing or a late session for a cancelled or superseded run is
  ignored.
- **Cost:** v4 Turbo and v4 cost the same per character as the models they
  replace (issue #471). Requesting timing adds no charge. Live verification
  during implementation needs an owner-approved paid budget.
- **Performance:** the timing-based plan runs off the main thread, as today's
  planner does. It must not add to time to first audio.

## Acceptance criteria

- [ ] **Realtime on local web and desktop:** a realtime v4 Turbo reply speaks
  over the dialogue socket. Median first audio after the first segment is within
  300 ms, recorded against Flash v2.5. Evidence: a live browser check on local web
  and on desktop, with the measurements in the ExecPlan.
- [ ] **Realtime connection handling:** a reply that pauses for more than 20 s
  keeps speaking afterwards. Cancelling a reply closes its socket. Evidence:
  automated tests, plus one live check.
- [ ] **Finalized v4:** a finalized v4 reply speaks sentence by sentence (and in
  paragraph mode) with the emotional tone tag, `previous_text` from the second
  request on, and PCM frames. Evidence: backend tests, the golden SSE fixture and
  one live check.
- [ ] **Migration:** saved `eleven_flash_v2_5`, `eleven_multilingual_v2` and
  `eleven_v3` preferences show and use the mapped v4 model with no owner action,
  and an old id in a chat request still yields a text reply. The old ids appear
  nowhere else in settings, contracts or docs. Evidence: frontend and backend
  tests, and a repository search.
- [ ] **Provider-timed lip-sync:** on ElevenLabs replies with timing, the mouth
  follows the spoken words and pauses with less drift than the estimated path.
  Without timing, and for Gemini and Pocket, lip-sync works as today. Evidence:
  - planner tests on recorded timing (word-window placement, tag and silence
    spans, fallback on mismatch);
  - live checks;
  - the owner's side-by-side review (owner gate).
- [ ] **Failures:** speech failures (token refused, socket error, provider error,
  timeout) leave the text reply intact with the existing notice. The hosted
  `speech_allowance_exhausted` → Pocket fallback still works. Evidence: existing
  and updated frontend and product-ui tests.
- [ ] **Hosted:**
  - `contracts/hosted-web.md` describes the v4 server transport and timing frames;
  - browser tests show that a server socket without timing still plays and
    lip-syncs (estimated);
  - a Cloud issue is filed or ready to file.
- [ ] **Docs and contracts:**
  - the docs listed in the issue are updated;
  - contract versions are bumped;
  - the client is regenerated;
  - the package-set compare against a `main` baseline passes.
- [ ] **Checks:** `make check-test`; `pnpm check`, `pnpm web:lint`,
  `pnpm web:test`, `pnpm build` and `pnpm desktop:test`; and
  `pnpm e2e:test:fast` on a disposable built stack.
- [ ] **Owner gate** (before merge):
  - the owner listens to v4 Turbo and v4 with the voices in use;
  - the owner reviews the lip-sync side by side on the same reply;
  - Instant Voice Clone compatibility is confirmed on a plan that allows clones
    (D5).

## Open questions and decisions

- **D1 — Remove rather than keep Legacy (owner allowed either, 2026-10-12;
  agent decision, for confirmation).**
  - Remove all three old models; offer no Legacy option.
  - Reasons from the spike:
    - v4 Turbo is about 6× faster to first audio than Flash as Animama uses it
      today;
    - v4 accepts `previous_text` and the same tone tags;
    - every voice type that could be tested speaks on both v4 models;
    - list prices are equal.
  - Keeping Legacy would keep two realtime socket protocols in the browser and in
    Cloud, the v3-only `previous_text` workaround, and model branches in docs and
    tests, for no measured benefit.
  - Contingency: if the owner's listening gate rejects v4 for a voice in use,
    the owner can choose a Legacy entry before merge. The finalized path stays
    model-parametric, so restoring `eleven_v3` as Legacy would be a small,
    bounded change.
- **D2 — Provider timing for lip-sync (owner, 2026-10-12).**
  - Use the timing where feasible, and keep the estimated path as the fallback
    and for other providers.
  - Show the two side by side.
  - Leave tag mouth shapes and other providers to #468.
  - On 2026-10-12 no #468 findings existed under `docs/plans/lipsync-upgrade/`.
    The timing input should be provider-neutral, so #468 can reuse it.
- **D3 — Defaults (Proposed; owner to confirm).** v4 Turbo on the realtime path
  is the default; v4 on the finalized path is the optional higher-quality mode.
  Basis: v4 Turbo's 106–149 ms first audio against v4's ~0.5–0.75 s per finalized
  sentence, and equal timing quality.
- **D4 — Finalized API (Proposed).**
  - Use the documented Text to Dialogue HTTP streaming with timestamps.
  - The spike found that the plain Text to Speech HTTP API also accepts v4, which
    ElevenLabs does not document. That is a fallback, and also the API Cloud uses
    today.
- **D5 — Instant Voice Clones (owner input needed).**
  - The owner's current pay-as-you-go plan refuses clones on every model
    (`ivc_not_permitted`), so clone compatibility could not be measured.
  - The owner either verifies it on a plan that allows clones before merge, or
    accepts it on ElevenLabs' documentation and records that waiver.
- **D6 — Live verification budget (owner input needed).**
  - Proposed: up to US$1 more for the implementation's live checks.
  - The spike used about US$0.33 of its US$1 budget.
- **D7 — Hosted rollout (dependency).**
  - Hosted web shares this frontend.
  - Cloud must accept `eleven_v4_turbo` and `eleven_v4` before, or together with,
    adopting this release. Otherwise a migrated hosted preference gets no speech;
    its text is intact.
  - The Cloud issue records this ordering.

## Spec

This document, before publication. After `workspace-setup` publishes it:
[issue #471](https://github.com/raymond-van/animama/issues/471).

## ExecPlan

[eleven-v4-execplan.md](eleven-v4-execplan.md), drafted for review.

## Delivery links

The phase issues and PR are added here once implementation is authorized.
