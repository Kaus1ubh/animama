# Lip-sync that follows the voice in every language, without gruut

Source agreement: [lipsync-spec.md](lipsync-spec.md) at `35fc8d7f`. The owner asked
for this plan on 2026-10-13 after reviewing that revision, which is recorded as
agreement for planning. D5 (download budget) is unanswered and is planned as
proposed (see the Decision Log).
Authorized scope: planning only. Implementation needs the owner's review of this
plan and an explicit authorization of a phase range.
Parent issue: [#468](https://github.com/raymond-van/animama/issues/468) (the spec is
published there by `workspace-setup`). PR:
[#473](https://github.com/raymond-van/animama/pull/473), which already carries the
research brief and the spec.

## Purpose and context

After this plan, the avatar's mouth follows the speech audio itself, in Japanese,
Korean, Chinese and English, for every speech provider. Laughs, sighs, gasps,
pauses and whispers show as themselves, not as words. ElevenLabs character timing
sharpens the alignment, an optional phone model sharpens vowels, talking hands
beat in every language, and gruut is gone from the product. The spec owns the
required behavior (R1–R13) and acceptance; this plan owns how to deliver and
verify it.

**How lip-sync works on `main` today** (`b10ee432`; paths under
`src/frontend/web/src` unless noted):

- **Backend phonemes.** `src/backend/animama/app/gruut_text.py` phonemizes each
  speech event with gruut (`en_US`). `product_http/chat/sse_events.py` adds
  `tokenized_text` and `phonemized_text` to every structured `speech` event, and,
  when TTS is on and the text is all-ASCII, `tts_text`, `tts_phonemized_text` and
  `tts_text_basis`. The same function records the speech segments that Gemini's
  finalized path batches.
- **Frontend inputs.** `src/frontend/packages/product-ui/src/chat/useProductChatSession.ts`
  reads those fields (`selectStructuredSpeechTtsPayload`,
  `selectStructuredSpeechVisemePayload` in `lib/chat/structured-response-stream.ts`)
  and queues them with `queueVisemeInputsForRun` in
  `stores/avatar-lipsync-bridge-store.ts`.
- **Planner.** `workers/viseme-worker.ts` runs `buildGruutVisemeKeyframes`
  (`lib/speech/gruut-viseme-keyframes.ts`). It estimates phoneme durations and
  scales the whole plan to the played length, in three build modes
  (`estimated_provisional`, `actual_prestart`, `actual_inflight`). It also builds
  the `SpeechGestureTimeline` (word timings, and beats on primary-stress vowels)
  for talking hands.
- **Playback.** The bridge's `tickGate`, called from `ui/main/canvas/AvatarCanvasActor.tsx`,
  hands a `VowelVisemeLipSyncSegment` (`lib/avatar/vowelVisemeSegment.ts`, 60 FPS,
  `vowel5`) to `lib/avatar/ExpressionController.ts`. That controller samples it
  against the provider's `AudioContext.currentTime - audioStartSec`.
- **Talking hands.** `lib/avatar/proc-animation/TalkingHandsProceduralAnimationLayer.ts`
  maps live TTS chunks (`speechChunksByRun`, word ranges counted by
  `/[A-Za-z0-9']+/`) onto the timeline's beats.
  `lib/desktop-pip/visual-state.ts` mirrors plans to the picture-in-picture
  window.
- **Provider timing (#497).** `lib/speech/provider-speech-timing.ts`,
  `lib/speech/speech-timing-evidence.ts`, the bridge's `providerSpeechTimingByRun`,
  and the debug panel's Lip-sync view with pluggable sources
  (`lib/speech/lipsync-plan-sources.ts`, `ui/debug/LipSyncDebugSection.tsx`,
  `stores/lipsync-debug-store.ts`).

**Where the audio is** (all providers deliver 24 kHz mono PCM):

| Provider | Decoded PCM | Start and duration |
| --- | --- | --- |
| ElevenLabs v4 Turbo, direct and hosted socket | `hooks/use-elevenlabs-tts-runtime.ts` `handleAudioChunk` (Int16), then `PCMPlayerWorklet` | first playback; total samples at stream end |
| Gemini (finalized `tts.audio`) | `hooks/use-finalized-tts-runtime.ts` `scheduleAudioChunk` (Int16 → `AudioBuffer`), with each chunk's exact start time | first chunk's start; `tts.done` |
| Pocket TTS | `public/tts/workers/inference-worker.js` posts Float32 chunks with 0.25 s gaps; `lib/speech/pocket/core/PocketTTSCore.js` `_bufferOrPlay` / `_flushBufferedAudio`, then the worklet | `playback_started`; `generation_finished` |
| Browser speech | none | `onstart` only |

The research brief ([lipsync-research.md](lipsync-research.md)) documents the
algorithm, the prototypes and their measurements. The prototypes and the test
clips are maintainer-held (raw TTS audio is not committed). Phase 1 brings the
derived evaluation data into the repository, and later phases port the
prototypes.

**Boundaries.**

- Frontend code lives under `src/frontend/web` (new lip-sync modules in
  `src/frontend/web/src/lib/lipsync/`). Backend changes are removals, plus the
  Model asset entry.
- Docs under `docs/frontend` and `docs/backend`; contract text in
  `contracts/hosted-web.md`.
- Cloud is out of scope. A linked Cloud issue records the removed fields (Phase 7).
- #479 owns prompt rules and tag mapping; this plan handles tags in whatever text
  reaches the provider.

## Progress

- [ ] Setup: merge `main` into the branch (waits on gate G0).
- [ ] Phase 1: evaluation harness, fixtures and baseline (R10).
- [ ] Phase 2: text units, tags and spelled-out numbers (R2, R3, R12 for Pocket).
- [ ] Phase 3: English pronunciation source (R11, D5).
- [ ] Phase 4: aligner, renderer and beats, scored offline (R1, R3, R4, R6, R7).
- [ ] Phase 5: in the app, including the debug comparison (R1, R3, R6–R9). Gate G1.
- [ ] Phase 6: optional phone model (R5). Gates G2 and G4.
- [ ] Phase 7: gruut removed (R12 providers, R13). Gate G3.
- [ ] Final integration review.
- [ ] Owner acceptance and merge approval.

## Surprises & Discoveries

From planning, 2026-10-13 (code reading of `main` at `b10ee432`):

- **Hosted has no lip-sync today.** Cloud installs the backend wheel without the
  `server` extra, so hosted frames carry no phonemes and the bridge never plans.
  The new planner is hosted's first lip-sync, as long as the PCM tap covers the
  hosted ElevenLabs socket (it shares `handleAudioChunk`).
- **Talking hands never gesture on Gemini,** because the finalized path records no
  TTS chunks. Japanese, Korean and Chinese chunks get empty word ranges (non-ASCII
  words count as zero). Pocket has one chunk per reply. The picture-in-picture
  window does not mirror chunks, so its hands never gesture.
- **Browser speech has no lip-sync today:** `useChatSession` skips the bridge for
  it. R6's text-only estimate is new behavior.
- **Pocket TTS already spells out numbers in its worker** (`prepareText` in
  `inference-worker.js`), but wrongly in many cases. Measured on `main`:

  | Text | Pocket today | gruut today (Gemini, ElevenLabs) |
  | --- | --- | --- |
  | `1,250` | "twelve fifty" | "one thousand two hundred and fifty" |
  | `€4` | "€four" | "four euro" |
  | `10/13/2026` | "ten dash thirteen dash twenty twenty six" | "October thirteenth twenty twenty six" |
  | `1st`, `22nd` | "one st", "twenty two nd" | "first", "twenty second" |
  | `5-10` | "five minus ten" | "five ten" |
  | `72°F` | "seventy two°F" | "72°F" |
  | `555-0123` | "five hundred fifty five minus one hundred twenty three" | "five hundred and fifty five one hundred and twenty three" |
  | `2.5.1` | "two p o i n t five p o i n t one" | "2.5.1" |
  | `3kg`, `¥500` | "three thousandg", "¥five hundred" | (not checked) |
  | `😊` | kept | dropped |

- **No shared PCM tap.** `lib/speech/speech-debug-tap.ts` is ElevenLabs-only.
- **Clock limits:**
  - for worklet providers, `audioStartSec` is the main-thread time at which the
    `playback-started` message was handled, slightly late; the worklet's own time
    is ignored;
  - on a buffer underrun the worklet plays silence and keeps going, so sample
    counts drift from `AudioContext` time.
- **Expressions:**
  - `ExpressionController.setExpressionOverlay(ownerId, map)` gives additive,
    owner-keyed overlays that leave the emotion state alone, which suits tag
    expressions;
  - lip-sync overwrites the vowel expressions each frame, and three-vrm's
    `overrideMouth` on a `happy`, `relaxed` or `surprised` preset can damp or block
    vowels, depending on the model.
- **Stale or untested code:**
  - `docs/frontend/runtime/avatar-lipsync.md` still describes `artifacts.visemePlan`
    and 1.25 s / 20% provisional margins (the code uses 1.5 s / 30%);
  - `finalizedTextBasisByRunRef` in `hooks/use-tts-playback.ts` is written but never
    read;
  - `gruut-viseme-keyframes.ts`, `vowelVisemeSegment.ts` and `viseme-worker.ts` have
    no unit tests.
- **The `server` extra holds only gruut** (`pyproject.toml`). Removing gruut empties
  it.

## Decision Log

- **2026-10-12/13 — owner, during the investigation** (brief, "Owner decisions"):
  - direction B: the default tier plus the opt-in int8 ZIPA phone model;
  - timing as evidence;
  - language from script;
  - unknown-vowel kanji;
  - tag expressions;
  - whispers;
  - #479 owns tags in `speech`.
- **2026-10-13 — owner:**
  - continue the upgrade on this branch and PR (#473); no separate research PR;
  - D1: remove gruut in this work, add a browser English source, and spell out
    numbers and symbols for Pocket TTS;
  - D2–D4 approved (thresholds; Voice settings placement; up to US$0.30 for new
    clips).
- **2026-10-13 — owner requested this plan** after reviewing the spec at
  `35fc8d7f`. D5 was not answered. The plan proceeds with the proposed budget: the
  200 KB gzip covers lip-sync code and the English dictionary, and the Chinese
  pinyin table loads on first use, outside it. Phase 3 reports the measured size
  before the English source merges. The owner can change D5 at plan review.
- **2026-10-13 — agent proposals (for plan review):**
  - **P1, evaluation data:**
    - fixtures hold derived features (10 ms loudness, voicing and pitch; phone
      posteriors for the pack tier), provider timing, text and reference timings.
      They never hold audio;
    - reference timings come from an evaluation-only aligner (MMS, CC-BY-NC
      weights). They are committed with their provenance recorded in
      `licenses/source-review.json`, as a pending rights question to settle before
      any public release candidate;
    - if the owner prefers, they stay out of the repository and the harness reads
      them from a maintainer path.
  - **P2, `server` extra:** remove it and every `--extra server` reference rather
    than leave an empty extra. Cloud does not install it.
  - **P3, Pocket's text:** the shared English speller runs before Pocket
    generation, and the worker's number, abbreviation and symbol passes are
    skipped for prepared text. The worker keeps its ASCII folding and punctuation
    clean-up.
  - **P4, material for gate G1:** the Lip-sync view can load a capture file (text,
    PCM chunks, timing), made from the test clips and kept outside the repository.
    The laugh, sigh and pause lines are then comparable even before #479 lets
    replies carry tags. Live replies cover the Japanese, Korean and Chinese lines.
  - **P5, module home:** `src/frontend/web/src/lib/lipsync/`, with one worker,
    `workers/lipsync-worker.ts`, that replaces `workers/viseme-worker.ts`.

## Setup and execution rules

- **Workspace:**
  - this task's worktree, branch `docs/lipsync-investigation` (the PR's branch,
    kept for continuity; the PR title is `feat:`);
  - the primary checkout stays on `main`.
- **Gate G0:** the branch starts at `1b34e471` plus documentation commits. The app
  refused to merge `main` because the merge changes `.claude/settings.json`. Once
  the owner confirms the repository's pinned Git origin (Help → Troubleshooting →
  Review Pinned Git Origins), merge `origin/main` with the app's base-sync. Then
  record the merged revision here.
- **Environment:**
  - Python 3.12: `uv sync --python 3.12.13`;
  - frontend: `pnpm install` in `src/frontend`.
- **Credentials:**
  - live checks read keys from the owner-only secrets file through
    `uv run --env-file …` or `COMPOSE_ENV_FILES=… ./reset.sh --name lipsync --base-port <free port>`;
  - never print keys;
  - tear down the `lipsync` stack after its last use in each phase.
- **Spend:** at most US$0.30 for new clips (D4); live replies in Phases 5 and 7 stay
  small. Ask the owner before anything that would take total spend in this plan
  past US$0.50.
- **Hosted CI:** hosted validation stays disabled. Evidence is local and recorded
  here.
- **Commits:** `feat(lipsync)[p#]: …` style subjects (or `fix`, `refactor`, `test`,
  `docs` as fits), with no attribution lines.
- **Review:** after each phase, one independent `sdlc-reviewer` review with at most
  two repair rounds, recorded under that phase. Then a final integration review.

## Phased implementation

Each phase gets one issue under #468 at implementation time. Owner checks (G1–G4)
stay in this plan and the PR, not in separate issues.

### Phase 1: Evaluation harness, fixtures and baseline

Requirements: R10, and the acceptance set. Issue: —. Starting source: the merged
branch from Setup.

Outcome: one command scores any plan source on the fixed clip set, offline,
printing every acceptance metric, and today's estimate has a recorded baseline.

1. **Audio features** (`src/frontend/web/src/lib/lipsync/audio/features.ts`):
   - 10 ms frames of loudness (dB), voicing (peak autocorrelation, 75–700 Hz) and
     pitch, from 24 kHz PCM;
   - ported from the lab, with unit tests on synthetic tones, noise and silence.
2. **Fixture builder** (`scripts/lipsync/`):
   - reads a maintainer-held clip directory;
   - writes compact fixtures under `src/frontend/web/tests/lipsync/fixtures/`:
     - text as sent (with tags), provider, language, duration;
     - the features from step 1, quantized;
     - provider timing as `TimedChar[]` (HTTP alignment, or socket frames replayed
       through `createSpeechTimingCollector`);
     - reference words and vowel spans;
     - the gruut phonemes that today's estimate needs (generated with the backend's
       `build_gruut_sse_text` while gruut exists).
3. **New clips** (D4, at most US$0.30): with scripts in `scripts/lipsync/` that read
   keys from the environment and skip existing outputs:
   - held-out lines in en, ja, ko and zh on Gemini and ElevenLabs v4 Turbo (socket,
     sent as the app sends);
   - an anime-pitched voice on each provider;
   - two English lines of numbers and symbols (for Phases 2 and 7);
   - Pocket renders, made locally.
   - Mark held-out clips in the fixture index.
4. **Reference timings:** MMS forced alignment, evaluation-only (P1). Record the
   provenance in `licenses/source-review.json`.
5. **Metrics and progressive simulation** in TypeScript
   (`src/frontend/web/tests/lipsync/eval/`):
   - vowel match, open in silence, timing correlation, tags placed (exact
     intersection-over-union, at least 0.5);
   - three arrival modes: whole clip, 2.9×, and real time with a 0.3 s buffer.
6. **Command:** `pnpm --dir src/frontend/web lipsync:eval [--source <id>] [--json <out>]`
   prints per-group tables. A fast vitest test runs it on three clips so it keeps
   working.
7. **Baseline:** score "Estimated (today)" and record the table here. It should
   match the brief within 3 points; explain any larger gap.

Checks:

- from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`;
- `npx prettier@3.3.3 --check` on the new docs.

Completion: the fixtures and the command are committed; the baseline is recorded;
review passes.

Recovery: the fixture builder is idempotent; regenerate from the clips. New paid
clips are never regenerated once they exist.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 2: Text units, tags and spelled-out numbers

Requirements:

- R2;
- R3 (parsing and kinds);
- R12, Pocket and lip-sync, but not yet providers speaking text as written.

Issue: —. Depends on: Phase 1 (fixtures for scoring).

Outcome: every reply's text becomes units ready for alignment, in the browser; tags
never become words; and Pocket TTS speaks numbers and symbols correctly.

1. **Units and script runs** (`lib/lipsync/text/`):
   - units are syllables with a vowel class and closure/nasal flags, pauses, tags
     and unknown-vowel units;
   - script runs: kana, Hangul, Han (Japanese when the reply has kana) and Latin.
2. **Converters**, ported from the lab:
   - Japanese kana table (small kana, ー, ッ, ン);
   - Korean Hangul arithmetic;
   - Chinese through `pinyin-pro`: added at an exact reviewed version (the lab used
     3.29.5) and imported lazily;
   - letter rules for accented Latin;
   - temporary English letter rules, replaced in Phase 3.
3. **Tags:**
   - parse Gemini `<…>` and ElevenLabs `[…]`, including combined directions;
   - classify into the spec's kinds by extending `classifyAudioTag` in
     `lib/speech/speech-timing-evidence.ts`, so text and provider timing share one
     table.
4. **English speller** (`lib/lipsync/text/spell-out-english.ts`):
   - covers every R12 category and every case in the discovery table;
   - "St." is read as "Saint" before a name and "Street" after one;
   - unit tests per category.
5. **Pocket switch (P3):**
   - `hooks/use-tts-playback.ts` (or the Pocket runtime) spells out English text
     before Pocket generation. This includes the re-speak after a declined
     ElevenLabs run;
   - `inference-worker.js` skips its number, abbreviation and symbol passes when
     the request marks the text as prepared.

Checks:

- vitest suites for converters, script runs, tags and the speller, plus the Pocket
  runtime tests;
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`;
- a local Pocket render of the numbers line, transcribed with Parakeet: the
  transcript contains the spelled-out words and no symbol names.

Completion: tests pass; the Pocket transcript check passes; review passes.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 3: English pronunciation source

Requirements: R11, D5. Issue: —. Depends on: Phase 2.

Outcome: English syllables, vowel shapes and stress come from data shipped with the
web app, agreeing with gruut on at least 90% of a fixed word list.

1. **Spike** (results recorded here):
   - Compare a dictionary subset ranked by word frequency plus letter rules, a
     dictionary of exceptions to letter rules, and a small learned
     letter-to-sound model.
   - Measure each on:
     - coverage of a public-domain English sample and the test lines;
     - gzip size;
     - agreement with gruut (syllable count and vowel class per word);
     - the licence of every input. Dictionary and frequency data must be
       permissive, with no share-alike or non-commercial terms. CMUdict's licence is
       to be verified.
2. **Owner decision if needed:** if no candidate fits the D5 budget, stop and ask.
3. **Build:**
   - a generator script writes a compact module: vowel classes and primary stress
     per word;
   - the worker loads it lazily;
   - letter rules handle unknown words.
4. **Agreement test:** record gruut's outputs for a fixed list (the most common
   English words plus the test lines' words) as a fixture now, before Phase 7
   removes gruut. A vitest test then asserts at least 90% agreement.
5. **Wire in:** replace Phase 2's temporary English rules.

Checks:

- tests, `pnpm check`, `pnpm web:lint`, `pnpm web:test`;
- `pnpm build`, recording the gzip size of the lip-sync chunks.

Completion: agreement at least 90%; size within D5 or an owner decision recorded;
review passes.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 4: Aligner, renderer and beats, scored offline

Requirements: R1, R3 (placement and shapes), R4, R6 (text-only estimate) and R7
(beats). Issue: —. Depends on: Phases 1–3.

Outcome: the new planner meets the default-tier and ElevenLabs thresholds on the
evaluation set, including progressive alignment, with no app wiring yet.

1. **Aligner** (`lib/lipsync/align/`), ported from the lab:
   - explicit-duration alignment on 10 ms frames;
   - emissions from loudness and voicing, and unit duration priors;
   - pauses that absorb quiet breaths;
   - tag units that prefer audible unvoiced frames.
2. **Provider timing as evidence (R4):**
   - map `buildSpeechTimingEvidence` to soft unit windows (lab weight 1.5);
   - punctuation becomes optional pauses with loose windows;
   - tag windows from timing take precedence over phone density.
3. **Progressive alignment (spike, then build):**
   - re-align a window over the newest audio, with a committed past;
   - compare accuracy and CPU with the brief's naive simulation, at 2.9× and at
     real time with a 0.3 s buffer, and record both here.
4. **Renderer (`lib/lipsync/render/`):**
   - `vowel5` frames at 60 FPS in the existing segment shape;
   - narrower shapes after a whisper;
   - tag mouth shapes per kind;
   - tag expression events (kind, start, end);
   - the neutral loudness-following shape for unknown-vowel units.
5. **Beats and phrases:**
   - prominence per aligned syllable (loudness peak, pitch rise, length against
     neighbours), with English stress as the tie-break and 0.4 s minimum spacing;
   - word timings, and sentence phrases with word ranges for talking hands;
   - a spike measuring agreement with gruut's stressed syllables on the English
     clips, recorded here.
6. **Text-only estimate (R6):** units with prior durations at a speaking rate, able
   to re-anchor on word-boundary times.
7. **Harness source:** "Aligned (new)" scored against the D2 thresholds, as a
   deterministic vitest test. Held-out clips are reported separately. Node CPU per
   second of audio is recorded as an early indicator.

Checks:

- unit tests: aligner on synthetic signals, timing mapping, renderer, beats;
- the threshold test;
- `pnpm check`, `pnpm web:lint`, `pnpm web:test`.

Completion:

- the default-tier and ElevenLabs thresholds pass, at real time too;
- held-out clips are within 10 points;
- review passes;
- if Japanese misses 40% because kanji have no readings, record it and ask the owner
  (the D2 risk).

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 5: In the app

Requirements: R1, R3 (overlays), R6, R7 (consumers), R8 (comparison) and R9.
Issue: —. Depends on: Phase 4.

Outcome: every reply's mouth, tag expressions and hands come from the new planner,
in the main view and picture-in-picture, and the owner can compare it with today's
estimate.

1. **PCM tap:**
   - Replace `lib/speech/speech-debug-tap.ts` with a provider-neutral, run-scoped
     tap. Each event carries the run, provider, sample rate, PCM and, where known,
     the chunk's playback start.
   - Emit it from:
     - ElevenLabs `handleAudioChunk`, covering both transports;
     - Gemini `scheduleAudioChunk`, inserting silence for scheduling gaps;
     - Pocket `_bufferOrPlay` / `_flushBufferedAudio`, with generation ids mapped
       to runs in `use-tts-playback.ts`.
2. **Clock:**
   - take `audioStartSec` from the worklet's own time
     (`public/tts/audio/pcm-processor.worklet.js`);
   - have the worklet post played-frame anchors after each underrun, so run time
     maps to `AudioContext` time;
   - Gemini maps through its chunk start times.
   - Unit tests cover the mapping.
3. **Worker** (`workers/lipsync-worker.ts` and a client):
   - Per run it accepts text parts with provider and tags, transferred PCM chunks,
     provider timing and the end of audio. It returns incremental frames, tag
     events, the gesture timeline and phrases, plus CPU per second of audio.
   - Text sources:
     - ElevenLabs chunk text (`recordPreparedChunksForAvatar`);
     - Gemini speech parts;
     - Pocket's spelled-out speech part.
   - Cancel and supersede end the worker run.
4. **Bridge** (`stores/avatar-lipsync-bridge-store.ts`):
   - planner inputs and incremental segments replace raw viseme inputs and build
     modes. Talking-state gating and hard stops are kept;
   - `ExpressionController` gains a way to append frames to a live segment.
5. **Tag expressions:**
   - the bridge tick computes overlay weights for active tag events and applies
     them with `setExpressionOverlay("lipsync-tags", …)`, cleared at run end and
     reset;
   - check `overrideMouth` interplay on both Included Avatars, and record the
     outcome.
6. **Talking hands:**
   - move the timeline types out of `gruut-viseme-keyframes.ts` into a neutral
     module;
   - the bridge passes the planner's progressive timeline and phrases, in place
     of ASCII-counted chunk ranges, to `getSpeechTimingContext`;
   - picture-in-picture mirrors phrases and tag events.
7. **Browser speech:** the text-only estimate runs on a performance-clock context
   (the picture-in-picture fake context is the pattern), anchored at `onstart` and
   on `onboundary` where available.
8. **Debug view:**
   - `LipSyncPlanInputs` gains the captured PCM, captured for every provider;
   - register "Aligned (new)", and show planner CPU per second of audio;
   - add a development-only "Load capture" (P4).
9. **Default (R9):**
   - `useChatSession` routes every provider through the new planner;
   - on failure, a loudness-driven mouth (R6);
   - today's estimate remains only as the debug comparison until Phase 7.
10. **Docs:** update `docs/frontend/runtime/avatar-lipsync.md` for the new flow.
    Phase 7 finishes it.

Checks:

- unit tests for the tap, the clock mapping, the bridge, the overlay envelope and
  the hands timeline;
- from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
  `pnpm desktop:check`;
- `pnpm e2e:test:fast` against a disposable built stack;
- live, on the `lipsync` stack with the owner's keys, and torn down afterwards:
  - Japanese, Korean, Chinese and English replies on Gemini and ElevenLabs, and
    English on Pocket;
  - captures in the Lip-sync view;
  - picture-in-picture hands;
  - planner CPU read in the desktop app (Electron) on the reference Mac.

**Gate G1 (owner):** in the Lip-sync view, compare "Aligned (new)" with "Estimated
(today)" on a laugh, a sigh or pause, and a Japanese, Korean or Chinese line, on
Gemini and on ElevenLabs. Phase 7 starts only after G1 passes.

Completion: checks pass, G1 passes and review passes.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 6: Optional phone model

Requirements: R5 and the pack-tier acceptance. Issue: —. Depends on: Phase 4 (it
can run beside Phase 5).

Outcome: installing "Sharper lip-sync" in Voice settings improves vowels and tags
on desktop and self-host. Without it, nothing changes.

1. **Model set** `models/zipa-small-crctc-int8/`, following
   `models/parakeet-tdt-0.6b-v2-webgpu/`:
   - `manifest.json`, `ATTRIBUTION.md` (CC-BY-4.0) and `README.md`;
   - `model.int8.onnx`: 70,677,672 bytes, SHA-256 `8f0505173e4606b4afe041f19477b38d6a72a98a19863562749066dc496e86ae`;
   - `tokens.txt`: 769 bytes, SHA-256 `f8e042a0c9130532b22d03ec7cae2f75a23fbec70c450c31a8efb51787b2b8fe`;
   - pin both to a fixed revision of the authors' Hugging Face export
     (`anyspeech/zipa-small-crctc-300k`, CC-BY-4.0), confirmed when pinning.
2. **Acquisition and catalog:**
   - `scripts/models/zipa.py`, following `parakeet_webgpu.py`, including
     `--source upstream` for development;
   - a catalog entry in `src/backend/animama/resources/model-assets.v1.json`, and
     a binding in `tests/test_model_assets.py`;
   - `licenses/source-review.json` and the third-party notices;
   - the `optional-inputs.mjs` model set;
   - the mount and capability (`server/model_assets.py`,
     `server/runtime_capabilities.py`, `local/http/assets.py`);
   - development serving (the Vite model plugin). Hosted builds exclude it.
3. **Inference:**
   - port the lab's fbank front end;
   - run ZIPA in the lip-sync worker with onnxruntime-web (WASM, one thread), with
     leases as in `lib/speech/client-parakeet/`;
   - class posteriors and phone density feed the aligner, while timing still owns
     tag windows.
4. **UI (D3):** a "Sharper lip-sync" item with its size, in Voice settings beside
   the other speech downloads (`ui/settings/VoiceDownloads.tsx`). It is never
   installed by default.
5. **Fallbacks:** missing, loading or failed means the default tier, with one log
   entry.
6. **Harness:** add int8 posteriors to the fixtures (computed with onnxruntime-web
   in Node). Pack thresholds: vowel match at least 70%, tags at least 75%.
7. **Docs:** `docs/backend/operations/model-assets.md` and the voice docs.

Checks:

- backend: `uv run pytest -q`, `uv run ruff check`, `make check-test`;
- frontend suite and `pnpm build`, `pnpm desktop:check`;
- the pack threshold test.

**Gate G2 (owner):** approve publishing the model files to the shared model origin
(`pnpm models:stage` / `pnpm models:publish`). This must happen before merge, or
packaged installs fail.

**Gate G4 (owner, desktop):** install, use, remove, and a failed load that falls
back, checked once. Record planner CPU with the model.

Completion: checks pass, G2 and G4 pass, and review passes.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

### Phase 7: gruut removed

Requirements: R13, and R12 (providers speak text as written). Issue: —. Depends on:
G1 passed, and Phase 3's recorded agreement.

Outcome: no gruut in the product, chat frames carry no phoneme fields, and every
provider speaks correctly.

1. **Backend:**
   - delete `app/gruut_text.py`;
   - in `product_http/chat/sse_events.py`, keep recording TTS segments with visible
     text and drop the phoneme fields;
   - remove the builder threading through `sse_runtime.py`, `stream.py` and
     `routes/chat_turns.py`;
   - simplify the text basis in `chat/tts.py`;
   - `server/finalized_speech.py`: Gemini speaks the visible text;
   - drop the gruut check from the `runtime/resources.py` audit.
2. **Packaging (P2):**
   - remove the `server` extra, its uv conflict, the dev-group reference and the
     mypy override;
   - remove every `--extra server`: `Dockerfile`, `Makefile`,
     `scripts/ci/local_validate.py`, `scripts/package-sets/build.py`,
     `.github/workflows/validate-public.yml`,
     `src/frontend/desktop/scripts/runtime/common.mjs` and the docs;
   - `uv lock`;
   - `src/backend/packaging/desktop/animama-runtime.spec` and its README.
3. **Frontend:** remove:
   - `gruut-viseme-keyframes.ts`, and the viseme worker, protocol and client;
   - product-ui's phoneme and `tts_text` handling, `TtsTextBasis` and
     `finalizedTextBasisByRunRef`;
   - the "Estimated (today)" source. The Lip-sync view then lists the evidence
     combinations (R8).
4. **Tests:**
   - regenerate `tests/fixtures/chat_sse_golden/*.sse`;
   - delete `tests/test_gruut_text.py`;
   - update the SSE, Gemini, chat-turn and packaging tests, and the frontend
     selector tests.
5. **Contracts and docs:**
   - `contracts/hosted-web.md` (drop the phoneme clause);
   - backend `runtime/chat.md`, `integrations/voice-and-speech.md` and
     `operations/development.md`;
   - frontend `avatar-lipsync.md` (full rewrite), `chat.md`, `elevenlabs-tts.md`,
     `gemini-tts.md` and `avatar-animation.md`;
   - stale `licenses/source-review.json` entries.
6. **Cloud:** open a linked animama-cloud issue stating that the phoneme fields are
   gone. Hosted behavior does not change, because hosted never had them.
7. **Size:** record the desktop runtime's size before and after.

Checks:

- backend: `uv run pytest -q`, `uv run ruff check`, `make check-test`;
- frontend: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
  `pnpm desktop:check`;
- stack tooling: `bash -n reset.sh`, and both `docker compose … config --quiet`
  checks;
- `pnpm e2e:test:fast`;
- `git grep -i gruut` finds only historical plans, this plan, the spec and the
  research brief.

**Gate G3 (owner):** listen to the numbers-and-symbols line on Pocket TTS, Gemini
and ElevenLabs. No symbol may be read aloud and no number skipped.

Completion: checks pass, G3 passes and review passes.

Results: —

#### Code Review #1 Findings

—

#### Code Review #1 Revisions

—

## Final integration review

Covers every acceptance criterion in the spec on the final candidate. It reuses
still-valid phase evidence and reruns the evaluation command, the full local check
set and `pnpm e2e:test:fast`. Findings and revisions are recorded here, within one
review and at most two repair rounds.

## Validation and acceptance

The spec's acceptance criteria are the contract. Evidence map:

| Criterion | Evidence |
| --- | --- |
| Default tier, ElevenLabs with timing, held-out clips | `lipsync:eval` output and the threshold test (Phases 4–5) |
| Phone model thresholds | Pack threshold test (Phase 6) |
| English without gruut | Agreement test (Phase 3); evaluation English scores (Phase 7) |
| Numbers and symbols | Speller tests and Parakeet transcript (Phase 2); G3 |
| gruut gone | Check commands and grep (Phase 7); runtime size |
| CPU | Node indicator (Phase 4); Electron reading in the Lip-sync view (Phases 5–6) |
| End to end | Live stack replies and captures (Phases 5 and 7) |
| Talking hands, picture-in-picture | Live check (Phase 5) |
| Model asset | Tests (Phase 6); G4 |
| Owner comparison | G1 |

Local commands, from the repository root unless noted:

```bash
uv run pytest -q
uv run ruff check
make check-test
make format-check
```

From `src/frontend`:

```bash
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm desktop:check
pnpm e2e:test:fast
```

Hosted CI is not run. Record actual results per phase; never mark an unperformed
check as passed.

## Idempotence and recovery

- **Phases commit separately,** so any phase can be reverted by its commits before
  merge.
- **Paid clips are generated once:** generation scripts skip existing outputs, and
  fixtures are rebuilt from the same clips.
- **Before gruut goes:** Phase 7 runs only after G1, and only after gruut's outputs
  are recorded as fixtures (Phase 3) and the baseline numbers are recorded (Phase
  1). If G1 fails, iterate within the review budget or return to the owner; gruut
  stays until then.
- **Model assets** install atomically and cannot be removed while leased. A failed
  or missing model never blocks speech.
- **Stacks:** use the named stack `lipsync` and tear it down after each phase's last
  use (`docker compose -p animama-lipsync down`, or `reset.sh` cleanup). Never touch
  other tasks' stacks.
- **Decisions that stop progress and go to the owner:**
  - the D5 budget cannot be met (Phase 3);
  - Japanese misses its threshold (Phase 4);
  - G2 publication is delayed (merge waits);
  - spend would pass US$0.50.

## Outcomes & Retrospective

—
