# Eleven v4 and v4 Turbo voices with provider-timed lip-sync

Status: Proposal, revised after owner review (2026-10-12).

Owner decisions, 2026-10-12:

- D1–D3 are agreed.
- The Instant Voice Clone check is waived (D5).
- US$1 is approved for live checks (D6).
- The integration is optimised for the v4 models alone (D4).

The revisions for v4-only integration and tag handling (R2, R4, R5, D8) await
the owner's go-ahead.

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
  automatic migration of saved preferences (D1).
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
- Speech uses ElevenLabs' Text to Dialogue HTTP streaming with timestamps, the
  documented API for v4.
- The reply's emotional tone still leads each request as an audio tag.
- Each request after the first continues the delivery of the reply's earlier
  requests, which v3 could not do:
  - it stitches to up to three previous request ids;
  - when no id is available, it falls back to up to 100 characters of preceding
    text.
- Requests stay at or under 2,000 characters.
- A failed batch ends that reply's speech with the existing error frame. The text
  is intact.
- Gemini finalized speech behaves exactly as before.

### R3 — Model choice, defaults and migration

- App Settings → Voice offers two ElevenLabs models: Eleven v4 Turbo (realtime)
  and Eleven v4 (finalized). Each shows a one-line description of its trade-off.
  The finalized grouping option stays available for v4, and its saved value is
  kept.
- **Defaults (D3, agreed):** v4 Turbo for new settings and for the server
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
  - leading silence is respected;
  - pauses close the mouth: commas, ellipses, sentence breaks, and breaths that
    ElevenLabs inserts. ElevenLabs reports each pause as time on the
    punctuation and spaces between words.
  - a bracketed audio tag, such as the emotional prefix `[cheerfully]` or an
    action tag like `[laughs]` or `[sighs]`, is never mouthed as a word. Its
    reported span (a laugh about 0.3 s, a sigh 0.4–0.7 s in the spike) becomes a
    named non-speech interval, during which the mouth rests closed in this
    change.
- Laugh, sigh and gasp mouth shapes and expressions are #468's: it will consume
  the same named intervals. The model's `speech` stays tag-free until #468 lifts
  the prompt ban, so today only the emotional prefix produces a tag interval.
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
  This task does not change Cloud code. The issue covers:
  - the v4 model ids;
  - timing frames;
  - the dialogue-session concurrency pool: hold a session only while a reply
    speaks, cap and queue sessions per operator, and treat a pool refusal as a
    speech refusal that keeps the text;
  - measuring the operator plan's limit before launch.

### R6 — Voice compatibility and settings

- Existing premade and shared-library voices, including Animama's default voice,
  speak on both models.
- Instant Voice Clones made through Animama are expected to keep working on both
  models. The owner waived live verification (D5).
- v4 accepts only Stability and Similarity. The utility synthesis route's voice
  settings drop Style, Speed and Speaker Boost. The route speaks with a v4 model
  over Text to Dialogue HTTP.

## Constraints

- **Security:**
  - The ElevenLabs key stays on the backend.
  - The browser receives only a short-lived single-use token, of type
    `ttd_websocket`, for one connection.
  - Tokens and keys are never logged; existing URL redaction is kept.
- **v4-only integration (owner, 2026-10-12).** With the older models removed,
  every ElevenLabs speech path uses the v4 APIs and their features:
  - realtime: the Text to Dialogue WebSocket with `ttd_websocket` tokens and
    timing always on;
  - finalized and utility: Text to Dialogue HTTP;
  - v4 continuity: request stitching.

  No code path keeps a branch for an older model, except the one-way migration
  map.
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
  paragraph mode) with the emotional tone tag and PCM frames. From the second
  request on, it stitches to the previous requests (with a `previous_text`
  fallback). Evidence: backend tests, the golden SSE fixture and one live check.
- [ ] **Migration:** saved `eleven_flash_v2_5`, `eleven_multilingual_v2` and
  `eleven_v3` preferences show and use the mapped v4 model with no owner action,
  and an old id in a chat request still yields a text reply. The old ids appear
  nowhere else in settings, contracts or docs. Evidence: frontend and backend
  tests, and a repository search.
- [ ] **Provider-timed lip-sync:** on ElevenLabs replies with timing, the mouth
  follows the spoken words and pauses with less drift than the estimated path.
  Without timing, and for Gemini and Pocket, lip-sync works as today. Evidence:
  - planner tests on recorded timing: word-window placement, pauses closing the
    mouth, the emotional prefix and action tags as named non-speech intervals
    that are never mouthed, and fallback on mismatch;
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
  - the owner reviews the lip-sync side by side on the same reply.

  Instant Voice Clone verification is waived (D5).

## Open questions and decisions

- **D1 — Remove rather than keep Legacy (agreed by the owner, 2026-10-12).**
  - Remove all three old models; offer no Legacy option.
  - Reasons from the spike:
    - v4 Turbo is about 6× faster to first audio than Flash as Animama uses it
      today;
    - v4 accepts continuity context and the same tone tags;
    - every voice type that could be tested speaks on both v4 models;
    - list prices are equal.
  - Contingency: if the owner's listening gate rejects v4 for a voice in use,
    the owner can choose a Legacy entry before merge, as a bounded change.
- **D2 — Provider timing for lip-sync (owner, 2026-10-12).**
  - Use the timing where feasible, and keep the estimated path as the fallback
    and for other providers.
  - Show the two side by side.
  - Leave tag mouth shapes and other providers to #468.
- **D3 — Defaults (agreed by the owner, 2026-10-12).** v4 Turbo on the realtime
  path is the default; v4 on the finalized path is the optional higher-quality
  mode.
- **D4 — v4-only integration (owner, 2026-10-12).**
  - Optimise for the v4 models alone:
    - realtime: Text to Dialogue WebSocket and `ttd_websocket` tokens;
    - finalized and utility synthesis: Text to Dialogue HTTP;
    - continuity: request stitching;
    - hosted: dialogue-pool concurrency handling, in the Cloud issue.
  - The spike found that the plain Text to Speech HTTP API also accepts v4,
    which ElevenLabs does not document. Animama does not depend on that; Cloud's
    existing adapter may use it while it migrates.
- **D5 — Instant Voice Clones (waived by the owner, 2026-10-12).** The owner's
  plan refuses clones on every model, so clone compatibility rests on ElevenLabs'
  documentation.
- **D6 — Live verification budget (approved by the owner, 2026-10-12).**
  - US$1 for the implementation's live checks.
  - Spent so far: about US$0.02 on the follow-up probes; the spike's own
    US$0.33 came from its separate US$1 budget.
- **D7 — Hosted rollout (dependency).**
  - Hosted web shares this frontend.
  - Cloud must accept `eleven_v4_turbo` and `eleven_v4` before, or together with,
    adopting this release. Otherwise a migrated hosted preference gets no speech;
    its text is intact.
  - The Cloud issue records this ordering.
- **D8 — Alignment with #468 (agent proposal, for confirmation).** The #468
  brief (2026-10-12) recommends a new browser lip-sync planner that aligns
  per-language text to the audio. It would treat vocal tags as non-speech events
  and use ElevenLabs timing as one evidence source. To avoid throwaway work, this
  change delivers the parts #468 reuses:
  - timing transport from the socket and SSE to the bridge;
  - a provider-neutral timing evidence module: spoken words with times, and
    named tag intervals;
  - the side-by-side review aid.

  It adapts today's planner only minimally, through word windows, which #468's
  planner later replaces. The spike also answers #468's open question: tags do
  appear in ElevenLabs alignment, with spans that cover the sound.
- **D9 — Languages beyond English (open question).**
  - #468 found that the backend gruut step gates finalized TTS: a Japanese,
    Korean or Chinese sentence gets no TTS segment and is never spoken.
  - v4's 94 languages only help once that gate is removed.
  - Proposed: leave that change to #468 (its migration step 1), unless the owner
    wants it pulled into this work.

## Spec

This document, before publication. After `workspace-setup` publishes it:
[issue #471](https://github.com/raymond-van/animama/issues/471).

## ExecPlan

[eleven-v4-execplan.md](eleven-v4-execplan.md), drafted for review.

## Delivery links

The phase issues and PR are added here once implementation is authorized.
