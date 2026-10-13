# Lip-sync that follows the voice in every language, without gruut

Source agreement: [lipsync-spec.md](lipsync-spec.md) at `35fc8d7f`. The owner asked
for this plan on 2026-10-13 after reviewing that revision, which is recorded as
agreement for planning. D5 (download budget) is unanswered and is planned as
proposed (see the Decision Log).
Authorized scope: Phases 1–7. The owner approved this plan, including agent
proposals P1–P5, and authorized Phases 1–7 on 2026-10-13.
Parent issue: [#468](https://github.com/raymond-van/animama/issues/468), which holds the
spec (published 2026-10-13 at 19:14 UTC from `92b3e735`). PR:
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

- [x] Setup (2026-10-13): the owner merged `main` (`7a25aa34`) into the branch at
  `b8c7080c`; spec published to #468; phase issues #513–#519 created as
  sub-issues with their dependencies.
- [x] Phase 1 (#513): evaluation harness, fixtures and baseline (R10). Review
  passed after one repair round.
- [x] Phase 2 (#514): text units, tags and spelled-out numbers (R2, R3, R12 for
  Pocket). Review passed after two repair rounds.
- [x] Phase 3 (#515): English pronunciation source (R11, D5). Review passed after
  two repair rounds and one owner-approved extra round (P3-F14, P3-F15). The
  agreement measure awaits owner confirmation (Decision Log).
- [x] Phase 4 (#516): aligner, renderer and beats, scored offline (R1, R3, R4, R6,
  R7). Review passed after two repair rounds; untimed drift is a known limit for
  G1.
- [ ] Phase 5 (#517): in the app, including the debug comparison (R1, R3, R6–R9).
  Gate G1.
- [ ] Phase 6 (#518): optional phone model (R5). Gates G2 and G4.
- [ ] Phase 7 (#519): gruut removed (R12 providers, R13). Gate G3.
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
- **Partial audio misleads loudness levels (Phase 4):** a part that opens with a
  laugh or sigh gives an 8th-percentile "noise" inside that sound, so the sound
  reads as silence and progressive plans commit it as a pause. The lab never saw
  this because it measured levels on the whole clip. Fixing it took live
  ElevenLabs tags from 8/12 to 12/12 placed.
- **Provider timing implies what has not started (Phase 4):** timing arrives with
  its audio, so a word with no timed character has not begun. Holding such words
  after the end of the audio, with the pause before them left open, keeps live
  plans from mouthing a breath as the next word.

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
- **2026-10-13 — agent, awaiting owner confirmation (Phase 3 review P3-F2):** R11's
  "vowel shapes agree with gruut's for at least 90% of words" is measured with
  unstressed weak vowels (ə, ɪ, ɚ in gruut; AH0, IH0, ER0 in CMUdict) as one
  class: 91.7%. The two sources reduce vowels differently, and both draw a short,
  small mouth.
  - **Other measures:** syllable count 99.1%; shapes as shown, with each weak vowel
    as its own small vowel, 85.6% (tested at 85% or more); exact 82.9%.
  - **Before the review,** every weak vowel was drawn as a small E, so the shapes
    as shown agreed only 64.6%. IH0 now draws a small I.
  - **If the owner reads R11 strictly** (shapes as shown at 90%), the dictionary
    alone cannot reach it: most of the rest are CMUdict and gruut differing on
    dialect and weak forms, not errors.
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

Requirements: R10, and the acceptance set. Issue: #513. Starting source: the merged
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

Results (2026-10-13, starting source `8e292cd5`):

- **Built:**
  - `src/frontend/web/src/lib/lipsync/audio/features.ts`: an incremental feature
    extractor. Pushing a clip in chunks of any size gives exactly the frames of a
    whole-clip pass;
  - `src/frontend/web/src/lib/lipsync/eval/`: fixture codec, metrics, arrival
    simulation, summaries and the "Estimated (today)" source;
  - `src/frontend/web/scripts/lipsync.mjs` (`pnpm lipsync:eval`, `pnpm lipsync:fixtures`);
  - `scripts/lipsync/clips.py` and its README, for maintainers;
  - `src/frontend/web/tests/lipsync/testset.json` and 58 fixtures (400 KB, no audio).
- **New clips (D4):**
  - 15 held-out clips: Gemini 7, ElevenLabs v4 Turbo socket 7, Pocket 1. They
    cover a two-tag English line, kanji-heavy Japanese, Korean, Chinese, a numbers
    line, and an anime-styled voice (Gemini Autonoe with a style prompt; ElevenLabs
    with a leading `[high-pitched, cute anime voice]` direction);
  - spend about US$0.04 (389 ElevenLabs characters at half credit, 7 short Gemini
    requests);
  - Parakeet transcripts confirm the tags and the anime direction were performed,
    not read.
- **Numbers lines are not scored.** Providers read digits differently (Gemini
  dropped "dollars" from "$5.99"), so their reference words cannot be trusted.
  They remain fixtures for Phases 2 and 7.
- **Baseline** (`pnpm lipsync:eval --mode whole`, "Estimated (today)"):

  | Set | Clips | Vowel match ja/ko/zh (+es) | Open in silence, English / tags | Tags |
  | --- | --: | --: | --: | --: |
  | Main | 21 | 6% (6%) | 73% / 66% | 0/8 |
  | ElevenLabs v4 HTTP | 14 | 13% (13%) | 63% / 60% | 0/7 |
  | ElevenLabs v4 Turbo socket | 8 | 6% (10%) | — / 74% | 0/5 |
  | Main, held out | 7 | 0% | 69% / 82% | 0/2 |
  | Turbo socket, held out | 6 | 3% | 79% / 62% | 0/2 |

  The brief measured 6% and 72% / 65% (main), and 13% and 61% / 58% (ElevenLabs
  HTTP). The remaining gap of up to 2 points comes from detecting silence on the
  100 Hz features rather than re-reading each WAV: short gaps hold 10–12 frames, so
  one frame moves a clip by about 10%.
- **The socket set's English column is empty** because its English lines are all
  tag lines (`tags` group), as for the HTTP set's tag lines. The brief's socket
  table counted every English-language line instead, so its figures (10%, 59% /
  71%) are not directly comparable.
- **The progressive simulation is stricter than the lab's.** A plan now fills only
  frames that play before the next plan exists. Frames that played before any plan
  stay closed. The lab filled each frame from the first plan made after it played,
  which gave up to one step (0.25 s) of extra audio. Phase 4 compares against the
  brief's progressive figures with that in mind.
- **Deviations from the steps above:**
  - the metrics and simulation live in `src/lib/lipsync/eval/`, not under
    `tests/`, so they are type-checked with the app sources (nothing imports them);
  - the fixture builder is `pnpm lipsync:fixtures` with `eval/build.ts`;
  - "two English lines of numbers" became one numbers line on two providers.
- **Environment:** this worktree's Git LFS objects had not been fetched, so
  `web:lint` failed on pointer files in `public/`; `git lfs pull` fixed it.

Checks:

- `npx vitest run src/lib/lipsync`: 21 passed;
- `pnpm check`: passed;
- `pnpm web:lint`: passed;
- `pnpm web:test`: 489 files, 4,361 passed, 1 skipped;
- Prettier on new docs, Ruff check and format on `scripts/lipsync/`: passed.



#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, on the uncommitted Phase 1 tree (baseline
`8e292cd5`). It reran `lipsync:eval --mode whole` and `vitest run src/lib/lipsync`
and inspected the fixtures, the test set and the source review.

- **P1-F1 (required):** the `live` and `faster` simulations filled each frame from
  the first plan made after it played, contradicting the module's own description
  and the brief's rule. A probe that stamped each plan's arrival time showed frames
  using up to 0.25 s of audio that had not arrived. Progressive scores would come
  out better than they should.
- **P1-F2 (required):** the Spanish references dropped accented vowels ("qué"
  became "qu", "día" became "da"). The aligner's letter filter deleted accented
  letters instead of folding them. The "+es" vowel column was therefore wrong.
- **P1-F3 (optional):** the gap margin is 3 frames (50 ms), not the stated 60 ms.
- **P1-F4 (optional):** the feature lookahead (45 ms) was hand-copied and not tied
  to the extractor's geometry.
- **P1-F5 (optional):** tag scoring counted any event of a tag kind, so a
  punctuation pause could count as a placed tag.
- **P1-F6 (optional):** an unknown `--mode` printed an empty table and exited 0.
- **P1-F7 (optional):** the clip tool's Gemini path ignored stream errors (a failed
  paid stream could leave a kept partial clip), copied the backend's request
  instead of reusing it, and ignored `perSentence`.
- **P1-F8 (optional):** the plan record missed several deviations and the socket
  set's comparison note.
- **P1-F9 (optional):** an unused `scoreTrack`, an unread source label, and a
  re-derived frame count.
- **P1-F10 (optional):** the Korean "eo"/"eu" vowel span covered only its first
  letter.

Result: changes required (P1-F1, P1-F2).

#### Code Review #1 Revisions

All ten findings were verified and accepted.

- **P1-F1, fixed:**
  - a plan now fills frames from the playhead at its arrival up to the playhead
    when the next plan arrives; frames that played before any plan stay closed;
  - a new test stamps each plan's arrival time into its frames and asserts that no
    frame used a plan made after it played, in both `live` and `faster` modes. It
    failed before the fix, including for faster-mode frames that played before the
    first plan.
- **P1-F2, fixed:**
  - `clips.py reference` folds accents (NFD, combining marks dropped) before
    keeping the aligner's letters;
  - `g-es`, `e-es` and `t-es` were realigned (`que`, `dia` now present) and every
    fixture was rebuilt. No paid requests were needed.
- **P1-F3:** documented as 3 frames (50 ms), as the brief's scoring truncated it.
- **P1-F4:** `speechFeatureFramesReady` in `features.ts` shares the extractor's
  geometry. The simulation uses it with each clip's recorded sample rate, and a
  test checks it against an extractor fed the same audio.
- **P1-F5:** only events with a `label` (made by a tag) are scored as tags; a test
  covers an unlabeled pause.
- **P1-F6:** `evaluate` rejects unknown modes and names the valid ones.
- **P1-F7:** Gemini lines now go through the backend's
  `stream_gemini_finalized_speech`, which stops with an error rather than keeping a
  partial clip, and `perSentence` lines are spoken a sentence at a time.
- **P1-F8:** the deviations and the socket comparison note are recorded in Results
  above.
- **P1-F9:** `scoreTrack` was removed, rows show the source's label, and metrics
  use `lipSyncFrameCount`.
- **P1-F10:** the vowel span now covers both letters. The baseline moved by 1
  point (main 5% → 6%, ElevenLabs HTTP 12% → 13%).

Verification after the fixes:

- `npx vitest run src/lib/lipsync`: 24 passed;
- `pnpm lipsync:eval`: the table above;
- `pnpm check`: passed;
- ESLint and Prettier on `src/lib/lipsync` and `scripts/lipsync.mjs`: passed;
- Ruff check and format on `scripts/lipsync/`: passed;
- not rerun: the full `pnpm web:test` and `pnpm web:lint`, since the fixes stayed in
  the new, unimported `src/lib/lipsync` code and its tests.

Repair rounds used: 1 of 2.

#### Code Review #2 Findings

Targeted recheck of P1-F1 to P1-F10 by the same reviewer. It reran the lip-sync
tests, `lipsync:eval` in all modes, its arrival probe and the fixture checks.

- All ten fixes hold; no blocking findings. Result: pass.
- **P1-F11 (optional):** `mode in ARRIVAL_MODES` also accepted inherited names such
  as `toString`.
- **P1-F12 (optional):** the verification list above omitted the type-check, lint
  and format reruns, and did not say which checks were not rerun.

#### Code Review #2 Revisions

- **P1-F11, accepted:** the check now uses `Object.hasOwn`.
- **P1-F12, accepted:** the verification list above now records every rerun and
  what was not rerun.

Phase 1 complete: checks pass and review passed after one repair round.

### Phase 2: Text units, tags and spelled-out numbers

Requirements:

- R2;
- R3 (parsing and kinds);
- R12, Pocket and lip-sync, but not yet providers speaking text as written.

Issue: #514. Depends on: Phase 1 (fixtures for scoring).

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

Results (2026-10-13, starting source `57fb60d4`):

- **Built** under `src/frontend/web/src/lib/lipsync/text/`:
  - `units.ts`: the unit model. Units are syllables, unknown-vowel units,
    closures, nasals, pauses and tags. Each keeps its source range, its word and
    any whisper.
  - `tags.ts`: Gemini `<…>` and ElevenLabs `[…]` tags, including combined
    directions, as eight kinds. It reuses `classifyAudioTag` from
    `speech-timing-evidence.ts`, so text and timing agree; no change there was
    needed.
  - `converters.ts`:
    - kana morae;
    - kanji as unknown-vowel units;
    - Hangul arithmetic;
    - Chinese through `pinyin-pro`, loaded on first use;
    - letter rules for accented Latin;
    - temporary English letter rules.
  - `text-units.ts`: script runs. Han reads as Japanese when the reply has kana.
    Digits written against CJK text become unknown units. Punctuation gives
    merged pauses, and a whisper carries forward until another delivery
    direction.
  - `spell-out-english.ts`: every R12 category, with source ranges for each
    spelled segment.
- **Pocket TTS** now speaks `pocketSpeechText` (`src/lib/speech/pocket-speech-text.ts`):
  - numbers, symbols and abbreviations are spelled out, and tags and emoji are
    left out (Pocket cannot perform tags);
  - this includes the re-speak after a declined ElevenLabs run, which goes through
    the same `generatePocketTtsText`.
- **Deviation from P3, simpler:** the Pocket worker needed no change. Its own
  passes rewrite digits, symbols and abbreviations the speller never emits, so on
  spelled text they do nothing (the reviewer checked "ninety-nine", "P M",
  "o'clock", "Saint" and "Street", unit words and commas).
- **While gruut remains (until Phase 7),** Pocket receives gruut's prepared text
  for sentences whose letters are all ASCII, and the speller then spells only what gruut
  left. gruut's misreadings, such as "5-10" as "five ten", persist there until
  then.
- **Dependency:** `pinyin-pro` pinned to 3.29.4 (MIT). 3.29.5 was published three
  days earlier, inside the two-week rule. Desktop notices pick it up from the
  dependency graph.
- **Pocket transcript check (new held-out fixture `h-p-en-numbers`):**
  - its `text` is what Pocket now receives, and `written` is the reply as the
    model wrote it; a test keeps the two in step through `pocketSpeechText`;
  - rendered locally with Pocket and transcribed with Parakeet: "It costs $5.99,
    about 1,250 yen. Meet me at 3:30 p.m. on october 13th, 2026, room number 4.";
  - Parakeet writes numbers back as digits, so this shows each one was read
    correctly ("one thousand two hundred fifty", not "twelve fifty"), with no
    symbol names.
- **Found while aligning that line:** MMS uses "-" as its blank token, so
  `clips.py reference` now splits words on hyphens ("ninety-nine").

Checks:

- `npx vitest run src/lib/lipsync src/hooks/use-pocket-tts-runtime.test.ts`: 110
  passed;
- `pnpm check`: passed, after typing fixes in `converters.ts`;
- `pnpm web:lint`: passed;
- `pnpm web:test`: 491 files, 4,445 passed, 1 skipped, run before those
  type-only fixes;
- Prettier and ESLint on the changed files, and Ruff on `scripts/lipsync/`: passed.


#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, on the uncommitted Phase 2 tree (baseline
`57fb60d4`). It ran the lip-sync, Pocket and timing-evidence tests, type-checked,
linted, and probed the speller and gruut 2.4.0 on prose cases.

- **P2-F1 (required):** a Pocket reply never ended when its last chunk spelled out
  to nothing, such as a final `[laughs]` or emoji. `generatePocketTtsText` returned
  before asking Pocket to end the stream, so `playback_ended` never fired and the
  run stayed active.
- **P2-F2 (required):** ranges were misread:
  - "5-10%" lost "percent";
  - "5%-10%" ran together;
  - "500-1000" was read as a phone number, digit by digit;
  - adjacent spelled segments joined with no space ("C plusplus").
- **P2-F3 (required):** numbers of 2×10¹⁵ or more were read with "undefined".
- **P2-F4 (required):** "Baker St. See you" read "Saint", and the sentence's
  full stop was lost.
- **Optional:**
  - currency with a magnitude word ("$5 million");
  - fractions read as dates ("5/8");
  - "100m" read as millions;
  - decades;
  - ".5" and ratios ("16:9");
  - full stops swallowed by "etc." and "p.m.";
  - `stripTags` removing "x < 5 and y > 3";
  - combined tags losing a whisper;
  - spaced and full-width CJK digits, and astral kanji;
  - the docs and Results not saying that Pocket still gets gruut's text until
    Phase 7;
  - "P M" aligned as bare letters in `h-p-en-numbers`;
  - a misleading test comment, the `voice.md` row, and trailing blank lines.

Result: changes required (P2-F1 to P2-F4).

#### Code Review #1 Revisions

- **P2-F1, fixed at the source:**
  - `prepareChunksForPlayback` drops Pocket chunks with nothing left to say, so the
    stream ends on the last chunk Pocket speaks;
  - `enqueuePocketChunks` reports whether it queued anything, and `completeRun`
    falls through to its existing end-of-stream branches when it did not;
  - a new playback test ("ends a Pocket reply that has nothing to say") failed
    before the fix.
- **P2-F2, fixed:**
  - ranges carry a trailing `%`, meridiem or year reading;
  - "5 - 3 = 2" reads as a subtraction;
  - bare `ddd-dddd` is a phone number only after "call", "number" and the like;
  - currency ranges read as "five to ten dollars";
  - adjacent spelled segments are separated.
- **P2-F3, fixed:** numbers past trillions, and digit strings over 15 digits, are
  read digit by digit.
- **P2-F4, fixed:** "St." is Street after a name and Saint only before one, and an
  abbreviation keeps a sentence's full stop ("etc.", "Jr.", "p.m.").
- **Optional, accepted:**
  - magnitude words after currency;
  - fractions with denominators 2, 3, 4, 8 and 16;
  - decimal scores such as "4.5/5";
  - "m" as meters after a number;
  - decades;
  - leading decimals;
  - ratios;
  - tags limited to words (letters, spaces, commas, hyphens, apostrophes);
  - whispers from combined tags, ended by any delivery direction;
  - spaced and full-width digits inside CJK text;
  - astral kanji as one unit;
  - the docs (`voice.md` Pocket section) and Results updated;
  - test comment fixed.
- **Every review case is now a test:** 22 prose cases plus the earlier tables.
- **Deferred to Phase 3:** reading single capitals such as "P M" as letter names;
  the English source owns it.
- **Not changed:**
  - `tags.ts` keeps its own 64-character limit and strength order rather than
    sharing them with `speech-timing-evidence.ts`, as the reviewer accepted;
  - "[Settings]" in square brackets still reads as a tag, because tags are words.

Verification after the fixes:

- `npx vitest run src/lib/lipsync src/hooks/use-pocket-tts-runtime.test.ts src/hooks/use-tts-playback.test.tsx tests/speech`:
  201 passed;
- `pnpm check`: passed;
- ESLint and Prettier on the changed files: passed;
- not rerun: the full `pnpm web:test` and `pnpm web:lint`.

Repair rounds used: 1 of 2.

#### Code Review #2 Findings

Targeted recheck by the same reviewer. It confirmed P2-F1 to P2-F4 and the
accepted optional items, and reran 226 tests, type-check, lint and its probes. The
revisions caused four regressions:

- **P2-F5 (required):** "Happy St. Patrick's Day" read "Street", because a
  capitalised first word counted as a street name.
- **P2-F6 (required):** "5-10,000" and "10-15.5" broke apart with stray digits.
  "$5.99-$9.99" read cents as decimal digits.
- **P2-F7 (required):** ASCII punctuation between CJK text ("안녕, 반가워",
  "うーん...そうだね") no longer gave a pause.
- **P2-F8 (required):** a bare "555-0123" read as a range.
- **Optional:**
  - dates without a year read as fractions after "on" or "due";
  - "1000s" and bare "80s";
  - "Jr. Day" gained a false stop;
  - tags containing "!";
  - the "all-ASCII" wording;
  - a defensive end of stream in `generatePocketTtsText`;
  - the empty `if` block in `completeRun`;
  - number paths beyond 2⁵³ in ordinals and ratios.

Result: changes required (P2-F5 to P2-F8).

#### Code Review #2 Revisions

- **P2-F5, fixed:** a capitalised word that starts its sentence is not a street
  name. "Happy St. Patrick's Day" and "Visit St. Louis" read "Saint" again; "Baker
  St. See you" still reads "Street.".
- **P2-F6, fixed:**
  - range bounds read whole amounts with separators and decimals and cannot
    backtrack into shorter numbers;
  - currency ranges with cents read each price in full.
- **P2-F7, fixed:** a CJK digit run must contain a digit, so punctuation runs give
  pauses again.
- **P2-F8, fixed:** a bare "ddd-dddd" whose four-digit part starts with 0, or
  which starts with 555, is a phone number.
- **Optional, accepted:**
  - a date cue ("on", "by", "due", "until" …) keeps a date;
  - decades are limited to 1100–2099, and bare 20s–90s read as "twenties" to
    "nineties";
  - "Jr." and "Sr." keep no stop;
  - tags may hold sentence punctuation;
  - the wording says "sentences whose letters are all ASCII";
  - `generatePocketTtsText` ends the stream if an empty final chunk arrives
    anyway (with a test);
  - `completeRun` reads without an empty block.
- **Not changed:** ordinal, ratio and number-sign readings beyond 2⁵³, which are
  vanishingly rare.
- Each fix has a test, failing before the fix where it was a regression.

Verification after the fixes:

- `npx vitest run src/lib/lipsync src/hooks/use-pocket-tts-runtime.test.ts src/hooks/use-tts-playback.test.tsx tests/speech src/lib/speech/speech-timing-evidence.test.ts`:
  240 passed;
- `pnpm check`: passed;
- ESLint and Prettier on the changed files: passed.

Repair rounds used: 2 of 2.

#### Code Review #3 Findings

Final targeted recheck by the same reviewer: P2-F5 to P2-F8 are fixed, P2-F1 to
P2-F4 still hold, and nothing blocks. It reran the 240 tests, type-check, lint and
its probes (50 speller and 19 unit cases). Result: pass.

Optional, not required for Phase 2:

- "Rest 60s between sets" now reads "sixties" (the bare decade rule);
- currency ranges with a magnitude ("$1-2 million");
- "cut from 3/8 to 1/4 inch" reads a date after "from";
- units after ranges ("5-10 km");
- bracketed asides such as "[this]" still count as tags.

#### Code Review #3 Revisions

No change in Phase 2; the review budget is used. Deferred to Phase 3, whose review
covers it: seconds such as "60s" after a number-like context, and currency ranges
with a magnitude. The rest are recorded as known limits.

Final checks: `pnpm web:test` 491 files, 4,486 passed, 1 skipped, on the reviewed
tree.

Phase 2 complete: checks pass and the final review passed.

### Phase 3: English pronunciation source

Requirements: R11, D5. Issue: #515. Depends on: Phase 2.

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

Results (2026-10-13, starting source `9993ef5a`):

- **Spike** (sources fetched into an isolated folder, never executed):

  | Candidate | Words | Size, gzip | Missed words in sample chat replies |
  | --- | --: | --: | --: |
  | CMUdict ∩ SCOWL size 10 | 4,200 | 15 KB | 13% |
  | CMUdict ∩ SCOWL size 20 | 11,375 | 41 KB | 6% |
  | CMUdict ∩ SCOWL size 35 | 34,298 | 121 KB | 2% |
  | **size 35, capitals to 50, contractions (chosen)** | 40,108 | 149 KB | 1% |
  | CMUdict ∩ SCOWL size 50 | 49,778 | 189 KB | 0.4% |

  - **What the sample was:** 30 typical companion replies, written for the spike
    and not committed, so the missed-words column is indicative only.
  - **Frequency ranking:** SCOWL's size levels serve as the ranking, so no separate
    frequency list (and its licence) is needed.
  - **Not built:**
    - an exceptions-only dictionary, because the full subset already fits the
      budget;
    - a learned letter-to-sound model.
- **Licences:**
  - CMUdict at `74790861` is BSD-2-Clause;
  - SCOWL 2020.12.07 carries Kevin Atkinson's permissive notice and its
    public-domain sources.
  - Both notices are now in `src/frontend/desktop/runtime/notices/`, with entries
    in `licenses/third-party/code-and-models.{md,json}`,
    `src/frontend/desktop/runtime/license-sources.json` and the source review.
- **Built:**
  - `scripts/lipsync/build_english_dictionary.py`. It checks CMUdict's SHA-256 and
    encodes each word's vowel shapes, primary stress, weak vowels, long vowels and
    lip closures in front-coded lines.
    It also checks SCOWL's `VERSION`.
  - The generated `english-dictionary.data.ts`: 434,449 bytes on disk (a 384 KB
    encoded body); 149 KB gzip once minified.
  - `english-dictionary.ts`:
    - lazy load and decode, retried after a failed load;
    - possessives and words with a trailing apostrophe through their stem, adding
      a weak syllable after a hissing sound ("box's");
    - letter names for capitalised abbreviations of two to four letters that the
      dictionary lacks ("P M", "TV");
    - spelling rules otherwise, and for every word until the dictionary loads.
  - The default English pronouncer in `textToUnits` is now the dictionary, once
    loaded.
  - Units gain `weak` for unstressed weak vowels: a small E for AH0 and ER0, a
    small I for IH0.
- **Agreement with gruut**, recorded first in `tests/lipsync/english-gruut-reference.json`
  from gruut 2.4.0 on SCOWL's 4,408 most common words plus the test lines' words
  (4,436 in all), after review revisions:

  | Measure | Agreement |
  | --- | --: |
  | Syllable count | 99.1% |
  | Vowel shapes, weak vowels as one class (the test's 90% measure) | 91.7% |
  | Vowel shapes as shown (a weak vowel as its own small vowel; tested at 85%) | 85.6% |
  | Exact, weak classes included | 82.9% |

  - By source, weak vowels as one class: 92.3% of the 4,197 dictionary words; 84.8%
    of the 223 words read through a stem (possessives); 31% of the 16 words left to
    spelling rules (such as "haha", "hmm", "inputted").
  - **Why weak vowels form one class:** the two sources reduce vowels differently
    ("added" is AH0 in CMUdict and ɪ in gruut), and both render as a short, small
    mouth. This reading of R11's "vowel shapes agree" awaits owner confirmation
    (Decision Log).
  - **Remaining differences** are dialect choices ("caught" with ɑ or ɔ) and weak
    forms ("and", "can").
- **Size against D5:** measured with esbuild 0.27.7 (`text-units.ts` and
  `pocket-speech-text.ts` as entries, `--bundle --splitting --format=esm --minify`,
  `pinyin-pro` external, gzip -9) because nothing in the app imports the code yet,
  so `pnpm build` cannot show it: the dictionary chunk is 149.3 KB and the Phase
  2–3 text code 8.4 KB, about 158 KB in all. That
  leaves about 42 KB for Phases 4–6. The build size is measured in Phase 5.
- **Deferred from Phase 2, done here:**
  - "Rest 60s" and "20s left" read as seconds beside a duration word; otherwise a
    bare "80s" is a decade ("80s music", "your 20s", "for 90s anime");
  - currency ranges keep their magnitude ("$1-2 million", "$5-$10k").
- **Harness scores for English** wait for the planner in Phase 4; the English
  source has no consumer before then.

Checks:

- `npx vitest run src/lib/lipsync`: 152 passed, including the agreement test;
- `pnpm check`: passed;
- ESLint, Prettier, and Ruff on `scripts/lipsync/`: passed;
- `pnpm desktop:test`, which covers the notice inventory: 27 files, 509 passed, 14
  skipped.



#### Code Review #1 Findings

Independent review (sdlc-reviewer) of the uncommitted Phase 3 tree on `9993ef5a`.
Phase 4 files appeared during the review; the findings cover the Phase 3 files
only, which had not changed. Required:

- **P3-F1:** the new decade rule read "I love 80s music" as "eighty seconds music",
  a regression on Pocket's live path. Decades should be the default, and seconds
  read only beside a duration word.
- **P3-F2:** 90% agreement holds only with weak vowels as one class, an agent
  reading of R11 that needs owner confirmation. Every weak vowel was drawn as a
  small E (shapes as shown agreed 64.6%); IH0 could keep its own weak-I code.
- **P3-F3:** the recorded figures were wrong:
  - only 16 words reach spelling rules (223 of the "239" are possessives read
    through a stem);
  - "384 KB" is the decoded body, while the file is 434,449 bytes.
- **P3-F4:** `pnpm web:lint`, `pnpm web:test` and `pnpm build` were not run on the
  exact Phase 3 source, and the size check needs an equivalent measurement since
  nothing imports the code yet.

Optional:

- P3-F5: the single-letter clause in the abbreviation rule was dead code, and
  all-caps words read letter by letter before the dictionary loaded.
- P3-F6: possessives of hissing stems lost their extra syllable.
- P3-F7: words with a trailing apostrophe missed the dictionary.
- P3-F8: a failed dictionary load was never retried.
- P3-F9: closure and nasal weights were duplicated, and onsets used the coda weight.
- P3-F10: the generator lacked a SCOWL version check and argument errors, and
  hard-coded gruut's version.
- P3-F11: the gruut reference's licence entry omitted SCOWL.
- P3-F12: wording ("the worker loads it", "contractions", the uncommitted spike
  sample).

#### Code Review #1 Revisions

- **P3-F1 accepted:** a bare "80s" is a decade unless a duration word is beside it
  (before: rest, wait, hold, for, every, in, within, after, another, takes, took,
  lasts; after: between, rest, left, each, later, remaining, per, on, off). The
  reviewer's five phrases and "Wait 30s… 20s left" are now tests.
- **P3-F2 accepted, with the optional fix:**
  - IH0 is now `y`, a small I; AH0 and ER0 stay `w`, a small E;
  - the gruut reference was re-recorded with the same split;
  - the test asserts at least 90% with weak vowels as one class, and at least 85%
    for shapes as shown (now 85.6%);
  - the reading of R11 is recorded in the Decision Log for owner confirmation.
- **P3-F3 accepted:** Results now give the corrected breakdown and sizes.
- **P3-F4 accepted:** the checks below ran on the exact Phase 3 source, with the
  Phase 4 work set aside. The size was measured with esbuild (Results).
- **P3-F5–F11 accepted:**
  - letter names apply only to two- to four-letter capitals the loaded dictionary
    lacks;
  - hissing stems add a weak I ("box's");
  - one trailing apostrophe is ignored when looking a word up;
  - a failed load resets so the next call retries;
  - weights come from `converters.ts`, onsets included;
  - the generator verifies SCOWL's `VERSION`, parses its arguments and records
    the installed gruut version;
  - the reference's licence entry names SCOWL and its notice.
- **P3-F12 accepted:** README, generator and licence wording corrected; the spike
  sample is marked indicative.
- **Checks on the revised Phase 3 source** (`9993ef5a` plus the Phase 3 files, with
  the Phase 4 work set aside):
  - Ruff check and format check on `scripts/lipsync/`: passed;
  - `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`: passed;
  - `pnpm web:test`: 492 vitest files, 4,502 passed and 1 skipped; node tests 220
    passed;
  - `pnpm build`: passed (the dictionary is not yet imported by the app);
  - `pnpm desktop:test`: 27 files, 509 passed and 14 skipped.

#### Code Review #2 Findings

Targeted recheck of `2d210094` against `9993ef5a`. P3-F2 to P3-F12 are fixed, and
every recorded figure reproduces (the dictionary and gruut reference regenerate
byte for byte). Required:

- **P3-F13:** the decade fix still read some decades as seconds, because "for",
  "in", "every", "another", "on" and "off" introduce decades as often as
  durations ("a soft spot for 90s anime", "80s on repeat").

Optional, not adopted in this round:

- all-caps interjections that the dictionary lacks ("HAHA", "YAY") are spelled
  letter by letter;
- the load retry and the path before the dictionary loads have no test;
- "ch" read as /k/ ("stomach's") gains a syllable.

The reviewer also noted that gruut's own possessive readings are unreliable, so the
84.8% stem figure understates the dictionary. The esbuild entry set is now recorded
in Results.

#### Code Review #2 Revisions

- **P3-F13 accepted:**
  - firm duration words make seconds anywhere beside the number: rest, wait,
    hold, within, takes, took and lasts before it; between, rest, left, each,
    later, remaining and per after it;
  - "on" and "off" count only at the end of a phrase ("20s on, 10s off");
  - for, in, every, after and another count only when the phrase ends after the
    number or a firm word follows it ("Hold for 30s.", "Plank for 30s each
    side");
  - the same cues now read other numbers as seconds ("Rest 45s" is "forty-five
    seconds"; "1s" is "one second"), where "45s" was "forty-five s".
  - The reviewer's decade phrases and these cases are tests.
- **Checks:** `npx vitest run src/lib/lipsync/text`: 143 passed; ESLint and
  Prettier on the changed files: passed.

#### Code Review #3 Findings

Final targeted review of `11b28086` (the last round in the budget). The P3-F13
cases in the tests are fixed, rule order holds ("1990s", "5 sec", times, phone
numbers, ranges) and the Pocket fixture test passes. Required, and unresolved
at the budget limit:

- **P3-F14:** the "phrase ends" test for ambiguous cues treats a hyphen, en dash
  or slash as an ending, so "for 80s-style synths", "Every 90s-born kid" and "for
  80s/90s anime" still read seconds.
- **P3-F15 (regression):** the revision widened the rule's lookbehind to
  `(?<![\d.,])`, so a number straight after "..." or a comma is no longer read:
  "Hmm...90s?" reaches Pocket as digits (it was "nineties"), and "Wait...30s
  left." likewise.

Optional:

- P3-F16: the RULES comment moved above the new cue constants.
- P3-F17: firm after-cues can follow a decade ("The 90s left a mark").
- P3-F18: comma lists after an ambiguous cue, and "100s of tries".
- The Review #2 record should name the changed files and the lookbehind change.

**Status:** blocked at the review budget and reported to the owner, who on
2026-10-13 allowed one more repair round and a targeted recheck.

#### Code Review #3 Revisions (owner-approved extra round)

In `src/frontend/web/src/lib/lipsync/text/spell-out-english.ts` and its test:

- **P3-F15 accepted:** the rule's lookbehind is `(?<!\d)` again (round 2 had
  widened it to `(?<![\d.,])`), so "Hmm...90s?" reads "nineties".
- **P3-F14 accepted:** a phrase end is the end of the text or punctuation, but
  not a hyphen, dash or slash joined to a word, so "in 90s-era" and "for
  80s/90s" read as decades while "Hold for 30s—then switch." stays seconds.
- **P3-F16 accepted:** the RULES comment is back above `RULES`.
- **Review #2 record:** its revisions changed the same two files, and widened
  the lookbehind (now reverted).
- P3-F17 and P3-F18 are not adopted: rare readings, outside this round.
- **Checks:** `npx vitest run src/lib/lipsync/text src/lib/lipsync/eval/fixtures.test.ts`:
  150 passed, including the Pocket fixture test; `tsc -p tsconfig.app.json`,
  ESLint and Prettier on the changed files: passed.

#### Code Review #4 Findings

Targeted recheck of the extra round at `69d8105d`: **pass**. P3-F14, P3-F15 and
P3-F16 are fixed. Across 2,533 inputs, every output that changed is an intended
change: numbers after "..." or ",", joined hyphens and slashes, and the new tests.
Optional, not adopted:

- P3-F19: a joined seconds range after an ambiguous cue reads its first number as
  a decade ("Hold for 30s-45s"), the counterpart of "80s–90s"; "Hold for 30-45s"
  is unaffected.
- P3-F20: decade ranges with spaces around the dash ("in 80s – 90s") still read
  seconds, the counterpart of "Hold for 30s - then switch".
- More of the reviewer's phrases could become tests.
- **Process:** the Phase 4 commit was made locally before this recheck reported.
  Nothing was pushed or reviewed out of order, and the Phase 3 files are the
  same in both commits; future phases wait for the gate before committing.

**Phase 3 complete** at `69d8105d`.

### Phase 4: Aligner, renderer and beats, scored offline

Requirements: R1, R3 (placement and shapes), R4, R6 (text-only estimate) and R7
(beats). Issue: #516. Depends on: Phases 1–3.

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

Results (2026-10-13, starting source `11b28086`; revised after Code Review #1):

- **Built** under `src/frontend/web/src/lib/lipsync/`:
  - `align/aligner.ts`: the lab's explicit-duration alignment on 10 ms frames,
    with:
    - an optional short gap between words, and between Japanese, Korean and
      Chinese characters, for the dips of stop consonants and breaths (without
      it, partial plans slid the text forward to put closures on those dips);
    - lip closures that prefer quiet or voiced frames, never a loud breath;
    - tags that may be skipped at a cost, so a tag the voice did not perform
      leaves no event, and laughs that discount steadily voiced frames;
    - loudness levels robust to a short start (the noise percentile grows from
      the lowest to the 8th over three seconds; a speech peak of at least -35
      dBFS);
    - a tag still sounding at the end of partial audio that pays no penalty for
      being short;
    - `null` when no alignment fits, for the caller to fall back;
    - duration and start costs computed once per state.
  - `align/timing-windows.ts`: provider timing as soft windows (cost 1.5 a frame;
    60 ms for speech, 0.4 s for tags, loose for punctuation; gap pauses between
    words), matched to the text ignoring the socket's added spaces. While audio
    is arriving, words not yet timed start after the end of the audio and the
    pause before them stays open; tags are exempt, since their characters are
    often timed after their sound.
  - `align/estimate.ts`: the text-only estimate (R6), re-anchored on known word
    starts.
  - `render/render.ts`: `vowel5` frames at 60 FPS:
    - weak and whispered vowels smaller;
    - a neutral opening for unknown units and other vocal sounds;
    - laughs pulse with loudness; sighs close; gasps open; pauses and sound
      effects rest;
    - openness from loudness, with a 40 ms release, closed 30 dB under a peak of
      at least -20 dBFS;
    - tag events with labels; pause events without.
  - `render/beats.ts`: word timings, phrases between stops, long pauses and tags,
    and beats on prominent syllables (louder, higher or longer than two neighbours
    each side, English stress as a tie-break, 0.4 s apart).
  - `planner.ts`: text to units once, then progressive plans:
    - units ending two seconds behind the newest audio are kept, and only the
      audio after them is re-aligned;
    - the speaking rate comes from the units already placed, starting from a
      deliberately slow 16 frames per unit of weight (a lagging plan catches
      up; one running ahead uses up words early);
    - a tag placed for 0.4 s is pinned near its start in later plans;
    - with no usable text, or no alignment that fits, the mouth follows the
      audio alone and `fallback` says why (`no_text`, `no_alignment`).
  - Evaluation sources `aligned` and opt-in `aligned-full`, which re-aligns
    everything. Sources now start per clip, so a planner keeps state across
    steps. The report adds "vowel open", the share of reference vowel frames
    with the mouth open, and word drift (below), which shows a plan running
    ahead of or behind the speech.
- **Scores** (tuning clips; held-out in brackets), from `pnpm lipsync:eval`:

  | Set, arrival | Vowel open | Vowel match ja/ko/zh | Open in silence, English / tags | Tags placed |
  | --- | --: | --: | --: | --: |
  | Main, whole | 91.6% (90.8%) | 50.6% (67.0%) | 0% / 1.3% | 3/8 (0/2) |
  | Main, 2.9× | 92.8% (88.5%) | 49.4% (66.5%) | 0.1% / 0.8% | 4/8 (0/2) |
  | Main, live | 91.7% (86.4%) | 41.0% (41.3%) | 0% / 1.0% | 2/8 (0/2) |
  | ElevenLabs HTTP, whole | 96.5% | 69.4% | 0% / 3.9% | 7/7 |
  | ElevenLabs HTTP, 2.9× | 94.8% | 68.8% | 0% / 4.2% | 7/7 |
  | ElevenLabs HTTP, live | 95.6% | 63.6% | 0% / 4.0% | 7/7 |
  | ElevenLabs socket, whole | 97.0% (88.6%) | 66.4% (66.1%) | — / 5.9% | 4/5 (1/2) |
  | ElevenLabs socket, 2.9× | 95.1% (88.8%) | 66.8% (68.2%) | — / 8.4% | 2/5 (1/2) |
  | ElevenLabs socket, live | 94.8% (89.8%) | 65.4% (62.8%) | — / 5.9% | 3/5 (0/2) |

  - **Against D2:**
    - default tier: passes at 2.9× (49.4%) and live (41.0%);
    - ElevenLabs (≥60%, ≤10%, ≥75% of tags): passes at 2.9× (tags 9/12, at the
      line) and live (10/12).
  - **Word drift** (how far each word starts, in the plan in force when playback
    reaches it, from where planning the whole clip puts it; mean per set, worst
    clip in brackets):

    | Set | 2.9× | Live |
    | --- | --: | --: |
    | Main | 0.15 s (1.03) | 0.27 s (1.33) |
    | Main, held out | 0.17 s (1.09) | 0.27 s (1.04) |
    | ElevenLabs HTTP | 0.01 s (0.04) | 0.05 s (0.16) |
    | ElevenLabs socket | 0.01 s (0.04) | 0.11 s (0.45) |

    Vowel opening alone cannot show drift: the mouth follows loudness wherever
    the words are placed.
  - **Known limit, for the owner at G1: untimed parts with voiced sighs or
    laughs drift ahead of the speech.** Loudness and voicing cannot tell a voiced
    sigh or laugh from words, so a progressive plan can spend words on it, and
    the kept units keep the error:
    - Gemini tag lines: `g-ko-sigh` 1.33 s live, `h-g-en-tags` 1.09 s at 2.9×
      (1.04 s live), `g-zh-laugh` 0.88 s, `g-en-laugh` 0.69 s (whole planning
      skips some of these sighs too);
    - ElevenLabs without timing (hosted, until animama-cloud#87): 0.35 s mean
      live, up to 1.57 s (`e-en-long`; 1.58 s at 2.9×);
    - joined parts without timing: Gemini English (25 s) 0.39 s, Pocket English
      (28 s) 0.09 s, Gemini Japanese (17 s) 1.05 s, untimed ElevenLabs (17 s)
      0.26 s;
    - long parts, planned as one part (mean drift live, and the earliest word):
      - 58 s, `g-en-long`, `g-en-pause`, `g-en-whisper`, `g-en-sigh`, twice:
        2.49 s, a word 9.8 s early;
      - 91 s, `s-en`, `g-en-long`, `s-en-sad`, `p-en`, `p-en-long`, `h-p-en`,
        `e-en`, `e-en-long`, `s-en`, `g-en-long`: 7.11 s, 17.4 s early, by which
        point it has run out of text;
      - 34 s, `g-en-laugh`, `g-en-sigh`, `g-en-pause`, `g-en-whisper`,
        `g-en-long`: 7.09 s, 12.7 s early;
      - 28 s, `g-ko-sigh`, `g-zh-laugh`, `g-ja-laugh`, `g-en-gasp`,
        `g-en-laugh`: 8.21 s, 14.0 s early.

      Phase 5 plans Gemini replies part by part, which bounds this (Phase 5
      Results).

    ElevenLabs with timing, and Pocket, stay close. The phone model (Phase 6)
    adds phone density, which separates sighs and laughs from words. Re-anchoring
    the plan at long silences is a possible later step. An end-of-text cost
    (penalising partial plans that place more speech than the audio shows) was
    tried and made drift worse.
  - **Today's planner** for comparison: 6% vowel match on the main set and
    13% / 6% on ElevenLabs HTTP / socket, with the mouth open in 60–74% of
    silences.
  - **Japanese (the D2 risk):** 43% on the main set at 2.9× (Korean 57%, Chinese
    48%) and 41% live, so kanji as unknown units keep the 40% target, narrowly.
    Held-out Japanese is 59% at 2.9× and 26% live (two clips).
  - **Held-out clips** are no more than 10 points worse on vowel match and
    silence (tested). Not tested, and recorded for the owner at G1:
    - **Tags:** two per set. ElevenLabs `h-e-en-tags`: the laugh is placed at
      2.9× (IoU 0.51) but not live; the sigh lands at IoU 0.41 in every mode,
      whole included. Gemini `h-g-en-tags`: both are missed.
    - **Correlation** on held-out ElevenLabs clips is 0.29–0.32 against
      0.42–0.46 for tuning clips (every one of the six held-out clips is
      0.21–0.35); the main set matches. They use the same voice as the tuning
      clips, so the cause is not established.
    - **Exception:** two held-out clips, `h-p-en` and `h-g-ja`, were inside the
      joined parts used to choose the hold, starting rate and lookahead in
      repair round 1. The tests now join tuning clips only.
  - **Gemini tags** (no timing) are placed in 2–4 of 8 progressive. Laughs and
    sighs that are voiced look like speech to loudness and voicing alone; the
    phone model (Phase 6) adds phone density for them.
  - **Unperformed tags** (`<laugh>` inserted into the 34 scored lines without
    tags, no timing; events of 0.2 s or more). Mid-line, the tag goes after the
    first `. ! ? , 。 ！ ？ ， 、` that has more text after it, with a space
    either side:

    | Where | Whole | 2.9× | Live |
    | --- | --: | --: | --: |
    | Start of the line | 2 | 2 | 3 |
    | After the first sentence | 7 | 7 | 10 |

    The longest is 0.68 s. Mid-line, a laugh can sit on an unvoiced stretch
    between words even when the whole line is planned. Phase 5's overlay ramps
    in over 0.15 s, which hides only the shortest; the phone model should help
    here too.
- **Progressive spike** (final code, Node, all clips):

  | Arrival | Windowed: vowel open / ja-ko-zh / CPU | Full re-align: vowel open / ja-ko-zh / CPU |
  | --- | --: | --: |
  | Main, 2.9× | 93% / 49% / 1.8 ms/s | 91% / 46% / 3.4 ms/s |
  | Main, live | 92% / 41% / 1.3 ms/s | 92% / 34% / 3.3 ms/s |
  | Socket, live | 95% / 65% / 1.2 ms/s | 96% / 65% / 2.4 ms/s |

  Windowed planning matches full re-alignment, and beats it on main-set vowels
  live, at about half the cost. Full re-alignment's partial plans measure the
  speaking rate against the whole text, which pushes it to its fastest bound;
  that handicap is part of its live gap.
- **CPU per second of audio** (Node, this Mac, progressive, all clips): median 1.6
  ms, 90th percentile 2.5 ms. The highest (7–9 ms) are first runs before the JIT
  warms; warm Korean plans take about 0.5 ms each, about 2 ms a second.
  - **Scaling:** loudness levels, openness, rendering and gesture timing still
    cover the whole part on every call. On the 91 s part the average is 4.3 ms a
    second, rising towards the end.
  - Phase 5's worker sends only new frames, and should render from the kept
    point on; the 5 ms budget is measured in Electron there.
- **Beats against gruut** on the 28 scored English clips (tested in
  `aligned-thresholds.test.ts`, at least 75%): 85.8% of 162 beats fall on gruut's
  primary-stressed syllable (67.3% of syllables are), and 99.4% on a word gruut
  stresses.
- **Tests:** aligner on synthetic signals (including skipped tags and no-path),
  timing windows, renderer, beats, estimate, planner stability and fallbacks,
  and `eval/aligned-thresholds.test.ts`:
  - D2 at each delivery rate;
  - held-out clips no more than 10 points worse;
  - progressive vowel opening within 5 points of whole, per set and on four
    joined parts;
  - word drift: at most 0.35 s per set, 1.5 s for any clip (held-out
    included), and 1.2 s for a joined part;
  - beats against gruut's stress.
- **Checks:** see Code Review #1 Revisions.

#### Code Review #1 Findings

Independent review of `d502423f` against `69d8105d`. Required:

- **P4-F1:** without provider timing, the windowed planner ran ahead of the audio
  and kept those placements. Per-clip vowel opening fell from about 90% whole to
  about 45% progressive on `g-en-pause`, `g-ko-sigh` and `h-p-en-numbers`, and
  multi-sentence parts ran out of text early (the 8th line of a 56 s part placed
  17 s early). The D2 test could not see it.
- **P4-F2:** when no alignment existed (text far too short or long for the
  audio), the aligner returned nothing and the mouth stayed shut, with no failure
  signal.
- **P4-F3:** every tag in the text produced an event, performed or not, against
  R3.
- **P4-F4:** the held-out check left out tags and correlation, and Results did
  not record the correlation gap.
- **P4-F5:** the planner's docstring claimed bounded work per call, but levels,
  rendering and gestures cover the whole part (gestures with an O(n²) neighbour
  filter and a full pitch sort).

Optional:

- P4-F6: symbol-only text left the mouth closed.
- P4-F7: tag events fragmented across progressive plans.
- P4-F8: on the two known limits: two held-out tags cannot show a 10-point
  gap, and Gemini's progressive tag losses come from the progressive planner.
- P4-F9: the new gesture types run parallel to the old ones; Phase 5 should
  converge them.
- P4-F10: spike caveats (full re-align's rate handicap, stale CPU columns, the
  beat figure not reproducible).
- P4-F11: assert the main set live too, and do not let a missing English group
  pass silently.

#### Code Review #1 Revisions

- **P4-F1 accepted.** The cause was partial plans sliding text forward: the text
  has no units for most consonant dips, so closures and nasals were placed on
  them, and a too-fast rate and a one-second hold kept the result. Fixed by:
  - optional short gaps between words and between CJK characters;
  - a two-second hold before units are kept;
  - keeping the starting rate at 16 frames per unit of weight (a trial of 12
    ran ahead; this item first read as a change, but 16 was already the
    default);
  - cheaper alignment (start costs precomputed) to pay for the longer window;
  - a narrower lookahead (1.2× the remaining audio plus 0.5 s).

  Tried and rejected, measured: per-frame breath scoring, a fixed rate,
  likelihood-chosen rates, and keeping units only when two plans agree. The new
  "vowel open" summary and tests guard it: progressive within 5 points of whole
  per set and on four joined parts.
- **P4-F2 accepted:** `alignUnits` returns `null` when no path exists; the planner
  then follows the audio alone and reports `fallback: "no_alignment"` for Phase
  5 to log. Tested.
- **P4-F3 accepted:** tags may be skipped at a cost, and the rate estimate no
  longer assumes tags are performed. Unperformed laughs before or inside a line
  leave no event when planned whole; progressive plans can flash one for up to
  0.2 s (Results), which Phase 5's overlay ramp should hide.
- **P4-F4 accepted:** the held-out test checks vowel match and silence one-sided
  (held-out may be better); tags and correlation are recorded in Results for the
  owner.
- **P4-F5 accepted:** the docstring now states the scaling, and Results record it
  with the 91 s measurement. Gesture timing uses a pitch histogram and a local
  neighbour slice. Incremental rendering moves to Phase 5.
- **P4-F6 accepted:** symbol-only text follows the audio (`fallback: "no_text"`).
- **P4-F7 partly:** a tag placed for 0.2 s is pinned near its start, and
  ElevenLabs tags are exempt from the "untimed means not started" rule, since
  their characters are timed after the sound. Hiding still-short tags was tried
  and rejected: it delayed every tag at the start of a part.
- **P4-F8–F11 accepted:**
  - the Gemini tags note now names the progressive cause;
  - P4-F9 is left to Phase 5, step 6;
  - the spike is re-run on the final code, with the full re-align handicap
    stated;
  - the beat measure is a test;
  - the main set is asserted live, and the English groups must be present.
- **Checks** (`d502423f` plus these revisions):
  - `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`: passed;
  - `pnpm web:test`: 497 vitest files, 4,566 passed and 1 skipped, including the
    lip-sync suite (222). One browser journey ("actual Library blocks denied
    upload permission…", `retained-screens.browser.test.mjs`) timed out at 35 s;
    the file alone then passed 8 of 8;
  - `pnpm desktop:test`: 27 files, 509 passed and 14 skipped.

#### Code Review #2 Findings

Targeted recheck of `83b78028`. P4-F2, F4–F11 are fixed, and every recorded
figure reproduces. Required:

- **P4-F12:** P4-F1 is only partly fixed:
  - untimed single clips with tags still place words seconds early
    (`h-g-en-tags`, `g-ko-sigh`, untimed `e-en-long`);
  - long parts still run out of text (15 s early on the 91 s part), so "still
    lags" was wrong;
  - vowel opening cannot see it, because the mouth follows loudness;
  - needed: a drift measure that sees words, per clip and per joined part, and
    either a fix or a recorded limit, with Results and the docs corrected.
- **P4-F13:** unperformed tags still leave events, and a pin keeps them to the
  final plan (0.3–0.5 s); the record overstated the fix.
- **P4-F14 (regression):** a part of only a tag went to `no_text` and lost its
  tag.
- **P4-F15:** two held-out clips fed the joined-part tests and the round-1 tuning
  sweeps, against the record.

Optional:

- P4-F16: the starting rate was already 16; the record called it a change.
- P4-F17: `alignUnitsScored` had no caller.
- P4-F18: a text that cannot fit is flagged late in progressive plans.

#### Code Review #2 Revisions

- **P4-F12 accepted, recorded as a known limit for the owner at G1:**
  - the evaluation now reports word drift, per clip, and per set with the worst
    clip;
  - `aligned-thresholds.test.ts` bounds it per set (0.35 s), per clip (1.5 s,
    held-out included) and per joined part (1.2 s), so regressions fail;
  - Results record the drift that remains, with the measured cases; the
    end-of-text cost was tried and rejected, measured.
  - The docs now say word drift, not vowel opening, shows a plan running ahead.
- **P4-F13 accepted:** a tag is pinned only once placed for 0.4 s, which brings
  progressive plans at 2.9× down to the whole-plan rate; live stays higher
  (Results). Results record the measured rates, and the Phase 5 note no longer
  claims the overlay ramp hides them.
- **P4-F14 accepted:** tags count as text; only symbol or punctuation parts are
  `no_text`. Tested.
- **P4-F15 accepted:** the joined parts use tuning clips only, and Results record
  the exception for round 1.
- **P4-F16, P4-F17 accepted:** the record is corrected; `alignUnitsScored` is
  folded back into `alignUnits`.
- **P4-F18:** recorded here, not changed: until enough audio shows the text
  cannot fit, the plan places it as well as it can, and the fallback follows.
- **Checks** (`83b78028` plus these revisions, with the Phase 5 work set aside):
  `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`: passed; `pnpm web:test`:
  497 vitest files, 4,567 passed and 1 skipped, and every browser journey passed;
  `pnpm desktop:test`: 27 files, 509 passed and 14 skipped.
- Committed as `f150c894`.

#### Code Review #3 Findings

Final targeted review of `f150c894` against `83b78028`: **pass**, no required
findings. P4-F12–F18 are verified: every recorded figure reproduces, the new
drift bounds fail on `d502423f` and pass on `83b78028`, and D2 still passes.
Optional:

- P4-F19: one Results sentence still said vowel opening falls with drift, and
  the Tests list left out the word-drift bounds.
- P4-F20: the long parts' clips were not recorded, mean drift hides how early
  single words go, `h-g-en-tags` 1.09 s was the 2.9× figure, not live.
- P4-F21: the mid-line insertion rule was not recorded; the P4-F13 revision
  overstated live.
- P4-F22: the tag-only test passed even if the laugh was lost.

#### Code Review #3 Revisions

- **P4-F19, P4-F21 accepted:** Results and the P4-F13 revision corrected; the
  insertion rule recorded.
- **P4-F20 accepted:** the long parts' clips and earliest words are recorded,
  measured again. Two more Gemini tag parts showed drift of 7–8 s. Phase 5
  responds by planning Gemini replies part by part (Phase 5 Results).
- **P4-F22 accepted:** the test now requires no fallback and a laugh event.
- Committed with the record as a Phase 4 follow-up.

### Phase 5: In the app

Requirements: R1, R3 (overlays), R6, R7 (consumers), R8 (comparison) and R9.
Issue: #517. Depends on: Phase 4.

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

Requirements: R5 and the pack-tier acceptance. Issue: #518. Depends on: Phase 4 (it
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

Requirements: R13, and R12 (providers speak text as written). Issue: #519. Depends on:
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
