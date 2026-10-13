# Lip-sync that follows the voice in every language, with vocal tags

Status: Proposal, drafted 2026-10-13. D2–D4 were agreed on 2026-10-13; D1 awaits the
owner.

Owner decisions, 2026-10-13 (recorded in the research brief's "Owner decisions"):

- A default tier for everyone, plus the ZIPA phone model as an opt-in Model asset
  in int8 precision.
- ElevenLabs character timing is evidence in the shared planner, not a separate
  lip-sync path.
- Each sentence's language comes from its script until a speech language exists.
- Kanji without a reading become unknown-vowel units; the model asset refines them.
- Tag expressions: laugh → `happy`, sigh → `relaxed`, gasp → `surprised`. Whispers
  narrow the mouth with no added expression.
- At most 200 KB gzip of new lip-sync code and data in the web build.
- Visible tags and the prompt rules belong to
  [#479](https://github.com/raymond-van/animama/issues/479).

Authoritative source: this file until `workspace-setup` publishes it to parent issue
[#468](https://github.com/raymond-van/animama/issues/468).
Research: [lipsync-research.md](lipsync-research.md), beside this file. It holds the
measurements, method and prototype findings this spec relies on.

## Problem and intended users

Animama moves the avatar's mouth from a plan that the backend's gruut step
estimates from English phonemes, rescaled as a whole to the played audio length.
On `main` (`b10ee432`):

- **Japanese, Korean and Chinese replies leave the mouth still.** gruut finds no
  phonemes in them. Latin text with accented letters, such as Spanish "día", gets
  none either.
- **The mouth does not follow the voice.** One global rescale cannot follow pauses,
  so in English the mouth is open in about 70% of silent gaps, and the plan drifts
  from the audio.
- **Vocal tags are not understood.** A laugh, sigh or gasp that a Gemini or
  ElevenLabs voice performs would be mouthed as a word, or not at all. #479 will let
  the chat model write such tags.
- **ElevenLabs character timing is unused.** Since #497 the browser collects it for
  every ElevenLabs reply, but no planner reads it.
- **Talking hands depend on English stress marks,** so hands do not beat with
  speech in other languages.

This serves the installation owner chatting with an Anima on desktop, self-host and
hosted web, with any speech provider: ElevenLabs v4 Turbo (realtime), Gemini
(finalized), Pocket TTS (local) and browser speech.

## Goals, scope and non-goals

Include:

- A browser lip-sync planner that aligns the spoken text to the speech audio, for
  every provider, in Japanese, Korean, Chinese and English, and in time with the
  audio for any Latin-script text.
- Vocal tags as non-speech mouth events, with brief expressions.
- ElevenLabs character timing as alignment evidence.
- The ZIPA small phone model as an optional Model asset that improves vowels and
  tag placement.
- Talking-hands beats from the new planner in every supported language.
- A repository evaluation that scores lip-sync against reference timings, and the
  new planner as a source in the debug panel's Lip-sync view.

Exclude:

- **Prompt rules, tag vocabulary, mapping and visible text:**
  [#479](https://github.com/raymond-van/animama/issues/479). This work handles tags
  in whatever text reaches the provider.
- **A per-Anima speech language** ([#385](https://github.com/raymond-van/animama/issues/385)
  or a smaller prerequisite), and the Spanish, French, German and Portuguese
  converters that need it.
- **Removing gruut from the backend** (its TTS text preparation, SSE fields and
  desktop runtime), and a browser English converter to replace its phonemes.
  Proposed as a follow-up (see D1).
- **Cloud's speech pipeline.** Hosted timing depends on
  [animama-cloud#87](https://github.com/raymond-van/animama-cloud/issues/87).
- Tongue or ARKit-style face shapes, multi-speaker dialogue, and choosing speech
  models.

## Required behavior

### R1 — Plans follow the speech audio

- The mouth plan for each part of a reply is aligned to that part's own audio:
  speech where the voice speaks, closed in pauses. There is no whole-reply rescale,
  and an error in one sentence does not shift later ones.
- Planning keeps up with arriving audio. Mouth frames are ready before playback
  reaches them whenever audio arrives ahead of playback, and the planner adds no
  delay before first audio.
- Stopping, cancelling or superseding a reply stops its planning and the mouth at
  once, as today.

### R2 — Languages by script

- Each run of text is planned by script:
  - kana → Japanese;
  - Hangul → Korean;
  - Han characters → Japanese when the reply contains kana, otherwise Chinese;
  - Latin → English.
- A sentence that mixes scripts plans each run with its own rules.
- Japanese kana, Korean and Chinese text give vowel shapes from the text. Kanji
  without a known reading become units whose timing comes from the audio and whose
  shape is a neutral opening that follows loudness.
- English uses the gruut phonemes the backend already sends with the speech. Latin
  text without them, including accented text, still moves the mouth in time with
  the audio. Its vowel shapes may be approximate until a speech language exists.
- When a sentence has no usable text, for example only digits or symbols, the mouth
  follows the audio alone.

### R3 — Audio tags on Gemini and ElevenLabs voices

Gemini and ElevenLabs v4 Turbo voices perform audio tags; Pocket TTS and browser
speech receive tag-free text (#479), so they produce no tag events. For the two
tag-capable providers, the planner combines the tags in the spoken text with the
audio, and on ElevenLabs also with the provider's timing:

| Per reply | Gemini | ElevenLabs v4 Turbo |
| --- | --- | --- |
| Tags in the text sent | Angle brackets from Gemini's list, such as `<laugh>`, `<sigh>`, `<whispers>`, `<long pause>` | Free-form square brackets, such as `[laughs]`, `[sighs]`, `[whispering, playful]`, `[excited]` |
| Emotion | Request style from `emotional_tone`; no emotion tags | A leading tone tag from `emotional_tone`, plus inline emotion tags (#479) |
| Provider timing | None | Each tag's characters get a window, often shorter than the sound |
| Where the sound is found | In the audio between the neighbouring words: loud stretches that are not voiced speech, and low phone density when the model is installed | The timing window as a starting point, then the audio, as on Gemini |

- **Never words:** tags are never mouthed as words, including combined directions.
- **Each tag behaves by its kind:**

  | Kind | Examples | Mouth | Expression |
  | --- | --- | --- | --- |
  | Laugh | laugh, chuckle, giggle | Open, pulsing with the laugh's loudness | `happy` |
  | Sigh or breath | sigh, exhale, breath | Relaxed rounded shape closing through the exhale | `relaxed` |
  | Gasp | gasp | Quick opening | `surprised` |
  | Other vocal sound | cough, cry, groan | Follows loudness with a neutral shape | none |
  | Pause | short pause, long pause, `[pause]` | Closed | none |
  | Sound effect | `[applause]`, `[door]` | At rest | none |
  | Whisper | whispers, whispering | Narrower shapes until the next delivery tag or the end of the speech part | none |
  | Other delivery or emotion | `[excited]`, `[softly]` | Unchanged | none |

- **The audio decides placement.** A tag's event covers its sound in the audio, not
  the position the text or the provider's timing suggests. A tag the voice did not
  perform leaves no event.
- **Expressions are brief overlays** during the sound. The face returns to the
  Anima's current emotion afterwards, and its emotion state does not change.
- **Emotion tags change the voice, not the face.** As agreed in #479, the avatar's
  emotion follows `emotional_tone`, not inline emotion tags.

Example: an ElevenLabs reply says "Oh my gosh, [laughs] that is the funniest thing".
Its timing gives `[laughs]` 48 ms and credits the laugh to "gosh,". The laugh event
still covers the audible laugh between "gosh" and "that": the mouth pulses with it,
`happy` shows briefly, and the word "laughs" is never mouthed.

### R4 — Provider timing as evidence

- When a reply has ElevenLabs character timing (`providerSpeechTimingByRun`), its
  words, characters, punctuation and tags guide the alignment. The audio still
  decides where words end, where pauses fall and where mid-sentence tags sit.
  Provider word ends often run past a pause, and tag spans are often too short.
- With timing present, tag placement follows the timing's tag windows and the audio,
  even when the phone model is installed.
- Without timing (Gemini, Pocket TTS, hosted without forwarded alignment), the
  planner works from text and audio alone.

### R5 — Optional phone model

- The ZIPA small phone recognizer (int8) is offered as an opt-in Model asset on
  desktop and self-host. It is installed, verified and removed like the other
  speech Model assets, without a restart, and is never downloaded by default.
- When installed, the planner uses it to improve vowel identity (including kanji
  and Latin text without phonemes) and to separate laughs, gasps and breaths from
  speech. When it is missing, still loading or fails, lip-sync uses the default tier
  with no visible error. A failure is logged once with its cause.
- Hosted web has no Model assets and always uses the default tier.

### R6 — Fallbacks

- **No capturable audio** (browser speech): a text-only estimate in every supported
  script, so the mouth still moves for Japanese, Korean and Chinese.
- **Planner failure** for a reply: today's estimated plan when it exists, otherwise
  a loudness-driven mouth. Speech always plays.

### R7 — Talking hands and other consumers

- Talking hands beat on speech in every supported language. The planner supplies
  the same timeline the talking-hands layer reads today (word timings and beat
  times), so the layer itself does not change.
- Beats fall on prominent syllables, found in the audio: louder, higher-pitched or
  longer than their neighbours. That works in any language, and none of it needs
  gruut. Where the text marks stress (English, from gruut's phonemes while they
  exist), it decides between candidates that are close together. Hands do not beat
  during tags, pauses or sound effects.
- The layer starts a gesture about 0.5 s before its beat. When audio arrives ahead
  of playback, beats are ready in time. When it does not, provisional beats from
  the text are used first and replaced once the audio arrives, as today's plan is.
- The desktop picture-in-picture avatar shows the same mouth and hands as the main
  view.

### R8 — Debug comparison

- The new planner is a plan source in the debug panel's Lip-sync view, beside
  "Estimated (today)", so a captured reply can be compared and replayed with either.

### R9 — Default planner

- The new planner replaces today's estimate for every provider once acceptance
  passes. Today's estimate remains only as the R6 fallback and in the debug view.
  No user setting chooses between them.

### R10 — Repository evaluation

- A checked-in evaluation scores any plan source against reference timings with the
  brief's metrics: vowel match, open in silence, timing correlation and tags placed.
  It runs without network access or paid TTS.

## Constraints

- **Performance:** on one worker thread on the reference Mac (Apple M5), in the
  desktop app's Electron, measured progressively as audio arrives:
  - default tier: at most 5 ms of CPU per second of audio;
  - with the phone model: at most 60 ms of CPU per second of audio, after a one-time
    model load of under 1 s per app session.
  - Lip-sync work never blocks the UI thread or audio playback.
- **Download:** new lip-sync code and data add at most 200 KB gzip to the web build.
  Language data, such as the Chinese pinyin table, loads only when that language is
  first planned. The phone model is about 71 MB on disk, downloaded only on request.
- **Compatibility:**
  - the avatar bridge and `ExpressionController` keep the `vowel5` contract;
  - SSE and `local-http` contracts are unchanged (gruut fields stay, see D1);
  - hosted compositions work without the Model asset and without timing.
- **Licences:** no GPL code in the app process. The ZIPA weights are CC-BY-4.0, with
  attribution in the Model asset's notices and the third-party notices; `pinyin-pro`
  is MIT.
- **Privacy:** all analysis runs locally. No speech text or audio goes to a new
  service.
- **Evaluation data:** the repository holds scripted test lines, reference timings
  and derived features, never personal data. The forced-alignment model used to
  make references is evaluation-only (CC-BY-NC weights) and is not shipped or
  required by tests. Raw TTS clips are not committed.
- **Cost:** no per-reply cost. New paid test clips stay under US$0.50 without
  further owner approval.

## Acceptance criteria

Scored by the repository evaluation (R10) on its fixed set, which keeps the
brief's 35 clips and adds the 8 v4 Turbo socket clips, held-out clips not used for
tuning and an anime-pitched voice. Alignment is progressive, at each provider's
delivery rate. Thresholds (D2, agreed 2026-10-13):

- [ ] **Default tier, Gemini and Pocket:**
  - open in silence at most 10% on English and tag lines;
  - vowel match at least 40% on Japanese, Korean and Chinese lines.
- [ ] **ElevenLabs with timing, including a live stream simulated at real time:**
  - open in silence at most 10% on English and tag lines;
  - vowel match at least 60% on Japanese, Korean and Chinese lines;
  - at least 75% of performed tags placed (intersection-over-union with the
    reference at least 0.5).
- [ ] **With the phone model:**
  - vowel match at least 70% on Japanese, Korean and Chinese lines;
  - at least 75% of performed tags placed.
- [ ] **Held-out clips** are reported separately and stay within 10 points of the
  tuning clips on each metric.
- [ ] **CPU** meets the constraints above, measured in the desktop app's Electron.
- [ ] **End to end, in a running stack:** the mouth moves in time for Japanese,
  Korean and Chinese replies spoken by Gemini and by ElevenLabs. A laugh tag in the
  text produces a laugh, not a word.
- [ ] **Talking hands** beat on speech in English and in at least one of Japanese,
  Korean or Chinese, and in the picture-in-picture view.
- [ ] **Model asset:** install, verify, use, removal and a failed load (falling back
  to the default tier) are covered by tests and checked once on desktop.
- [ ] **Tests:** converters and script detection, tag parsing and kinds, the
  aligner with and without timing and phone posteriors, and the fallbacks, on
  recorded fixtures. `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
  `pnpm desktop:check` and the affected backend checks pass.
- [ ] **Owner gate:** in the debug panel's Lip-sync view, the owner compares the new
  planner with today's estimate on a laugh, a sigh or pause, and a Japanese, Korean
  or Chinese line, on Gemini and on ElevenLabs.

## Open questions and decisions

Agreed on 2026-10-13: the decisions listed at the top, and:

- **D2 — Thresholds:** as in the acceptance criteria. Two risks remain:
  - Japanese kanji without readings were not measured in the default tier, so the
    Japanese share of the 40% target may need revisiting after the first
    measurement;
  - the brief's text aligners were tuned on their own clips, hence the held-out
    check.
- **D3 — Installing the phone model:** in Voice settings, beside the other speech
  Model assets, described as "Sharper lip-sync" with its size.
- **D4 — Test clip spend:** up to US$0.30 for held-out and anime-voice clips on
  Gemini and ElevenLabs.

Proposed, for the owner:

- **D1 — English pronunciation comes from gruut's existing phonemes; gruut stays.**
  The planner takes timing from the audio and provider timing, not from phonemes.
  It needs text only to know which syllables, pauses and tags to expect and which
  vowel shape each syllable has. Kana, Hangul and pinyin spell their sounds, so
  small tables suffice. English spelling does not ("though", "laugh"), so English
  vowel shapes need a pronunciation source. This work uses the phonemes the backend
  already sends, and builds no English converter. Removing gruut would change how
  English text is prepared for TTS (numbers and symbols) and the SSE contract.
  That removal, with a browser English source, is a separate follow-up issue if
  wanted.

Open, for the ExecPlan's early spikes:

- How well beats from audio prominence agree with gruut's stressed syllables on the
  English clips. Nothing is measured yet; the owner's visual check decides.

- Windowed re-alignment and chunked phone-model inference: accuracy and CPU when
  aligning progressively. Only a naive version was simulated.
- How ElevenLabs realtime audio, one stream per reply, is divided into alignment
  windows when timing is missing (hosted without forwarded alignment).

Dependencies:

- #497 (merged): timing collector, evidence module, plan-source registry.
- #479 (not started): tags in `speech`. This work does not wait for it. Its tests use
  tagged fixtures.
- animama-cloud#87: hosted timing (optional).
- #385: the speech language that later enables Spanish, French, German and
  Portuguese converters.

## Spec

This document, until it is published to
[#468](https://github.com/raymond-van/animama/issues/468).

## ExecPlan

To be drafted with `to-execplan` after the owner agrees this spec, as
`lipsync-execplan.md` beside it.

## Delivery links

- PR [#473](https://github.com/raymond-van/animama/pull/473) carries the research,
  this spec and, once authorized, the implementation.
- Sub-issues: to follow.
