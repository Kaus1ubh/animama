# Lip-sync that follows the voice in every language, without gruut

Status: Proposal, drafted 2026-10-13. D1–D4 were agreed on 2026-10-13; D5 and the
spec as a whole await the owner.

Owner decisions, 2026-10-13 (recorded in the research brief's "Owner decisions"):

- A default tier for everyone, plus the ZIPA phone model as an opt-in Model asset
  in int8 precision.
- ElevenLabs character timing is evidence in the shared planner, not a separate
  lip-sync path.
- Each sentence's language comes from its script until a speech language exists.
- Kanji without a reading become unknown-vowel units; the model asset refines them.
- Tag expressions: laugh → `happy`, sigh → `relaxed`, gasp → `surprised`. Whispers
  narrow the mouth with no added expression.
- At most 200 KB gzip of new lip-sync code and data in the web build (see D5).
- Visible tags and the prompt rules belong to
  [#479](https://github.com/raymond-van/animama/issues/479).
- gruut is removed in this work, replaced by a browser English pronunciation source,
  and Pocket TTS gets numbers and symbols spelled out (D1).

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
- **gruut is a costly backend dependency.** Its upstream repository is archived. It
  adds about 15 MB to the desktop runtime and 17–549 ms of backend work per speech
  event. On Gemini that work runs before the speech request, so it delays first
  audio. It also decides the English text every provider speaks.

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
- A browser English pronunciation source, and English numbers and symbols spelled
  out for Pocket TTS and for lip-sync.
- Removing gruut, today's estimated planner and their chat fields.
- A repository evaluation that scores lip-sync against reference timings, and the
  new planner in the debug panel's Lip-sync view.

Exclude:

- **Prompt rules, tag vocabulary, mapping and visible text:**
  [#479](https://github.com/raymond-van/animama/issues/479). This work handles tags
  in whatever text reaches the provider.
- **A per-Anima speech language** ([#385](https://github.com/raymond-van/animama/issues/385)
  or a smaller prerequisite), and the Spanish, French, German and Portuguese
  converters that need it.
- **Spelling out numbers in other languages,** and for Gemini, ElevenLabs or
  browser speech, which do it themselves.
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
- English uses the browser pronunciation source (R11), with numbers and symbols
  spelled out first (R12). Accented Latin text still moves the mouth in time with
  the audio; its vowel shapes may be approximate until a speech language exists.
- When a sentence has no usable text, for example only symbols, the mouth follows
  the audio alone.

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
- When installed, the planner uses it to improve vowel identity (including kanji,
  accented Latin text and English words the pronunciation source lacks) and to
  separate laughs, gasps and breaths from speech. When it is missing, still loading
  or fails, lip-sync uses the default tier with no visible error. A failure is
  logged once with its cause.
- Hosted web has no Model assets and always uses the default tier.

### R6 — Fallbacks

- **No capturable audio** (browser speech): a text-only estimate in every supported
  script, so the mouth still moves for Japanese, Korean and Chinese.
- **Planner failure** for a reply: a loudness-driven mouth. Speech always plays.

### R7 — Talking hands and other consumers

- Talking hands beat on speech in every supported language. The planner supplies
  the same timeline the talking-hands layer reads today (word timings and beat
  times), so the layer itself does not change.
- Beats fall on prominent syllables, found in the audio: louder, higher-pitched or
  longer than their neighbours. That works in any language. Where the text marks
  stress (English, from the pronunciation source), it decides between candidates
  that are close together. Hands do not beat during tags, pauses or sound effects.
- The layer starts a gesture about 0.5 s before its beat. When audio arrives ahead
  of playback, beats are ready in time. When it does not, provisional beats from
  the text are used first and replaced once the audio arrives.
- The desktop picture-in-picture avatar shows the same mouth and hands as the main
  view.

### R8 — Debug comparison

- Until gruut is removed, the new planner is a plan source in the debug panel's
  Lip-sync view beside "Estimated (today)", so a captured reply can be compared and
  replayed with either. This is where the owner gate happens.
- Afterwards, the view lists the new planner's evidence combinations instead: text
  and audio; with provider timing; with the phone model.

### R9 — Default planner

- The new planner plans lip-sync for every provider. No user setting chooses a
  planner.

### R10 — Repository evaluation

- A checked-in evaluation scores any plan source against reference timings with the
  brief's metrics: vowel match, open in silence, timing correlation and tags placed.
  It runs without network access or paid TTS.

### R11 — English pronunciation in the browser

- English words get their syllables, vowel shapes and stress from a pronunciation
  dictionary shipped with the web app, covering everyday conversation.
- Words it lacks, such as names and new words, get them from spelling rules. With
  the phone model installed, their vowels come from the audio.

### R12 — Numbers and symbols spelled out

- Before Pocket TTS speaks English text, the browser spells out numbers and
  symbols. It covers at least what gruut handles today:
  - cardinals with separators ("1,250" → "one thousand two hundred fifty");
  - decimals and currency in dollars, euros, pounds and yen ("$5.99" → "five dollars
    ninety-nine cents");
  - percentages, ordinals ("22nd"), years ("1999"), times ("3:30 pm"), numeric dates
    and negatives;
  - common abbreviations ("Dr.", "St.", "Mr.", "Mrs.").
- It also covers what gruut misses today, measured on `main`:

  | Text | gruut today | Spelled out |
  | --- | --- | --- |
  | `5-10` | "five ten" | "five to ten" |
  | `72°F` | "72°F" | "seventy-two degrees Fahrenheit" |
  | `@`, `#1`, `+`, `=` | dropped or "#1" | "at", "number one", "plus", "equals" |
  | `555-0123` | "five hundred and fifty five one hundred and twenty three" | digit by digit |
  | `2.5.1` | "2.5.1" | "two point five point one" |

- Emoji and symbols with no spoken form are dropped, never read aloud.
- Gemini, ElevenLabs and browser speech receive the text as written and spell out
  numbers themselves. Today Gemini and ElevenLabs receive gruut's version.
- Lip-sync plans English numbers and symbols from the same spelled-out words, for
  every provider, so it expects the right syllables. When a provider reads a number
  differently, for example "2026" as a year, the audio decides the timing.

### R13 — gruut removed

- The backend no longer runs gruut. That removes:
  - the call per speech event, and gruut's preparation of English TTS text;
  - the phoneme fields in chat frames: `tokenized_text`, `phonemized_text`,
    `tts_text`, `tts_phonemized_text` and `tts_text_basis`;
  - the `server` extra's gruut dependency, its data in the desktop runtime, and the
    runtime self-check.
- Today's estimated planner (`buildGruutVisemeKeyframes`) and its inputs are
  removed.
- Removal happens after the owner gate (R8), which compares the new planner with
  today's estimate.

## Constraints

- **Performance:** on one worker thread on the reference Mac (Apple M5), in the
  desktop app's Electron, measured progressively as audio arrives:
  - default tier: at most 5 ms of CPU per second of audio;
  - with the phone model: at most 60 ms of CPU per second of audio, after a one-time
    model load of under 1 s per app session.
  - Lip-sync work never blocks the UI thread or audio playback.
  - Spelling out numbers adds no noticeable delay before Pocket TTS starts.
- **Download (D5):** new lip-sync code and the English dictionary add at most 200 KB
  gzip to the web build. The Chinese pinyin table (about 145 KB gzip) loads only
  when Chinese is first planned, outside that budget. The phone model is about
  71 MB on disk, downloaded only on request. The desktop runtime shrinks by gruut's
  size.
- **Compatibility:**
  - the avatar bridge and `ExpressionController` keep the `vowel5` contract;
  - chat stream consumers must not rely on the removed phoneme fields. The hosted
    contract (`contracts/hosted-web.md`) already treats them as optional, and is
    updated to drop them. Cloud is told through a linked issue;
  - nothing persisted holds phonemes, so stored chats need no migration;
  - hosted compositions work without the Model asset and without timing.
- **Licences:** no GPL code in the app process. The ZIPA weights are CC-BY-4.0, with
  attribution in the Model asset's notices and the third-party notices. `pinyin-pro`
  is MIT. The English dictionary uses a permissive licence and is attributed in the
  third-party notices. gruut's notices are removed.
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
- [ ] **English without gruut:** on a fixed list of common English words plus the
  test lines' words, the browser source's syllable count and vowel shapes agree with
  gruut's for at least 90% of words, measured before gruut is removed. English
  scores on the evaluation stay within the thresholds above.
- [ ] **Numbers and symbols:** unit tests cover every R12 category, including the
  gruut cases recorded above. The owner listens to one line of numbers and symbols
  on Pocket TTS, Gemini and ElevenLabs, and none reads a symbol aloud or skips a
  number.
- [ ] **gruut gone:** no gruut import, dependency or packaged data remains; the
  backend tests and `make check-test` pass without it. The desktop runtime's size
  change is recorded.
- [ ] **CPU** meets the constraints above, measured in the desktop app's Electron.
- [ ] **End to end, in a running stack:** the mouth moves in time for Japanese,
  Korean, Chinese and English replies spoken by Gemini, by ElevenLabs and (English)
  by Pocket TTS. A laugh tag in the text produces a laugh, not a word.
- [ ] **Talking hands** beat on speech in English and in at least one of Japanese,
  Korean or Chinese, and in the picture-in-picture view.
- [ ] **Model asset:** install, verify, use, removal and a failed load (falling back
  to the default tier) are covered by tests and checked once on desktop.
- [ ] **Tests:** converters and script detection, the English source, the number
  speller, tag parsing and kinds, the aligner with and without timing and phone
  posteriors, and the fallbacks, on recorded fixtures. `pnpm check`,
  `pnpm web:lint`, `pnpm web:test`, `pnpm build`, `pnpm desktop:check`,
  `uv run pytest -q`, `uv run ruff check` and `make check-test` pass.
- [ ] **Owner gate, before gruut is removed:** in the debug panel's Lip-sync view,
  the owner compares the new planner with today's estimate on a laugh, a sigh or
  pause, and a Japanese, Korean or Chinese line, on Gemini and on ElevenLabs.

## Open questions and decisions

Agreed on 2026-10-13: the decisions listed at the top, and:

- **D1 — Scope:** remove gruut in this work, replace it with a browser English
  pronunciation source, and spell out numbers and symbols for Pocket TTS.
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

- **D5 — Download budget.** The 200 KB gzip covers the lip-sync code and the
  English dictionary. The Chinese pinyin table loads on first use, outside it,
  as the brief's figures assumed. The dictionary's size is not measured yet;
  estimated at 60–120 KB gzip.

Open, for the ExecPlan's early spikes:

- The English dictionary's word coverage and size within the budget.
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
- animama-cloud#87: hosted timing (optional). A new Cloud issue covers the removed
  phoneme fields.
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
