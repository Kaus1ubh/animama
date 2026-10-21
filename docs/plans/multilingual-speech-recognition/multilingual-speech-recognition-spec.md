# Multilingual offline speech recognition

Status: Agreed
Owner decision: 2026-10-14. Scope decisions D1–D12 come from the owner's
intent-discovery answers, recorded in the
[discovery brief](https://github.com/raymond-van/animama/issues/509#issuecomment-6171691667);
the owner accepted this text by requesting the ExecPlan. Q1–Q7 stay open until
gate G1 in the plan.
Authoritative source: https://github.com/raymond-van/animama/issues/509,
published and read back 2026-10-14T15:53:03Z. This file is a snapshot of that
publication.

## Problem and intended users

Under [ADR 0024](../../adr/0024-ui-locale-is-the-conversation-language.md) the
UI Locale is the **conversation language**. Under `ja`, `ko`, `zh-Hans` or
`zh-Hant` an Anima replies in that language, and ElevenLabs and Gemini speak it.
Speech recognition does not follow:

- The only offline recognizer, Parakeet TDT 0.6B v2, understands English only.
  It runs in a browser worker on the CPU (WASM) path, or with an experimental
  WebGPU encoder. Its base set is 661 MB; the WebGPU add-on is 1.24 GB.
- The desktop app treats the browser's Web Speech recognition as unavailable,
  so desktop owners under these locales cannot talk to their Anima in their own
  language at all. On self-hosted web, browser recognition already uses the
  locale's language tag (`browserSpeechLanguage()`) where the browser supports
  it.
- Settings show "Parakeet understands English only. Speech recognition in …
  is coming soon." (`speechEngineIsEnglishOnly`, `SpeechLanguageNotice`).
- Smart Turn v3.x lists Chinese, Japanese and Korean among its 23 languages but
  publishes no per-language accuracy. Its forced end-of-turn short-reply list
  is English-only, and its normalization strips non-ASCII characters.

Users:

- Installation owners on desktop and self-host who use the `ja`, `ko`,
  `zh-Hans` or `zh-Hant` locale and want dictation and Voice Mode in that
  language without sending audio off the device.
- English owners, whose recognition must not get worse.

## Goals, scope and non-goals

Goal: offline dictation and Voice Mode understand Japanese, Korean, Mandarin
Chinese and English, choosing the engine by the conversation language.

In scope:

- A measured comparison of the two candidates, SenseVoice-Small and Nemotron
  3.5 ASR (`nvidia/nemotron-3.5-asr-streaming-0.6b`), against Parakeet v2 for
  English, followed by the owner's choice of model and numeric targets.
- The chosen model in dictation and Voice Mode on the CPU and WebGPU paths, on
  desktop and self-host.
- Engine selection and language hints from the conversation language, and
  Chinese output in the locale's script.
- The model's asset lifecycle, matching Parakeet's.
- Settings, Setup and warning updates, with translations.
- A Smart Turn and voice-activity smoke check, and localized short replies.

Non-goals:

- Cloud transcription (D1).
- Qwen3-ASR, Whisper large-v3-turbo and Parakeet v3 (D6).
- Text-to-speech ([#385](https://github.com/raymond-van/animama/issues/385)),
  lip-sync for non-English replies
  ([#468](https://github.com/raymond-van/animama/issues/468)) and new locales
  ([#512](https://github.com/raymond-van/animama/issues/512)).
- Emotion and audio-event tags from the recognizer (D12); a follow-up idea.
- Recognizing a language other than the conversation language, or a
  per-Anima language. Mixed-language speech works only as well as the chosen
  model handles it.
- Performance targets on Windows (D2) and multi-threaded WASM
  ([#128](https://github.com/raymond-van/animama/issues/128)).
- Cantonese as a requirement (D9).

## Terms

- **Conversation language**: see the glossary; always the active UI Locale.
- **Offline speech recognition**: Animama's on-device recognizer, today
  Parakeet. Audio never leaves the device.
- **Multilingual speech model**: the model the owner chooses under R1.
- **Speech window**: one accepted MicVAD segment, the unit Animama transcribes.
- **Final text**: the committed transcript of a speech window.
- **Interim text**: display-only text shown while a window is still open.
- **CER / WER**: character and word error rate; lower is better.

## Required behavior

### R1 Comparison and model choice

R1 is a gate: integration work beyond the comparison waits for the owner's
recorded choice.

- **Test set (D7).** Public read speech from FLEURS (CC-BY-4.0) and Common
  Voice (CC0), 50–100 clips each for English, Japanese, Korean, Mainland
  Mandarin (Simplified references) and Taiwan Mandarin (Traditional
  references). Cantonese clips are added only to check D9. The clip list,
  references and dataset revisions are tracked; audio is fetched when the
  comparison runs and is not committed or redistributed. The report credits
  the sources.
- **Where it runs (D2).** On the reference Mac (Apple M5, 24 GB), through the
  same browser runtime the app uses for Parakeet (the desktop renderer worker),
  on both the CPU path and WebGPU.
- **Measurements, per engine, language and backend:**
  - CER for ja, ko and zh; WER for en, with normalization rules fixed before
    the run and recorded in the report. Chinese is scored in the locale's
    script, as users would see it.
  - Latency from the end of a speech window to its final text (p50, p90).
  - Time to first interim text, where the engine and backend can produce it.
  - Real-time factor, model load time (cold and warm) and peak memory.
  - Download size of each file set, and licence.
- **Baseline.** Parakeet v2 on the English clips, measured the same way.
- **Selection rules agreed so far:**
  - The base (CPU) set is about 700 MB or less (D3). Any GPU-only add-on's size
    is reported for approval.
  - Fast models and interim text while speaking are preferred, not required
    (D5).
  - One model serves every language, English included, if its English WER is
    within about 1.5 points of Parakeet's on the same set and backend and it
    meets the latency floor (D8).
  - Latency floor: final text no slower than Parakeet's English final text on
    the same backend for comparable window lengths (D10).
- **Outcome.** A public-safe comparison report in the plan with a
  recommendation. The owner records the chosen model, whether it also takes
  English, and the numeric accuracy and latency targets (D10).

### R2 Engine selection by language

- When dictation or Voice Mode starts with offline speech recognition, the
  engine follows the conversation language:
  - `ja`, `ko`, `zh-Hans`, `zh-Hant`: the multilingual speech model, with that
    language as its hint. `zh-Hans` and `zh-Hant` both mean Mandarin;
    Cantonese is recognized under `zh-Hant` when the model supports it, with no
    extra setting (D9).
  - `en`: Parakeet, unless R1 makes the multilingual model the default for every
    language (D8).
- The CPU or WebGPU choice applies to whichever engine runs.
- A locale change applies from the next dictation or Voice Mode start; an
  active session keeps its engine. *(Proposal, Q3.)*
- Saved preferences keep working: stored values such as
  `stt_provider: "parakeet"` and `stt_parakeet_webgpu` are not renamed.

### R3 Transcription behavior

- Dictation and Voice Mode keep today's flow: MicVAD windows, final text per
  accepted window, Smart Turn auto-submit, mute, push to talk and silence reset.
- Final text is in the conversation language: Japanese in its usual mix of
  kana and kanji, Korean in Hangul, Simplified characters under `zh-Hans` and
  Traditional characters under `zh-Hant`.
- Recognizer markup never reaches the text: language, emotion, event and
  formatting tags are removed.
- A window of silence or noise produces no text.
- Interim text, where offered, stays display-only as today: Voice Mode never
  submits it.
- Failures are surfaced as they are for Parakeet today. A load or
  transcription failure shows an error rather than silently switching provider;
  a WebGPU failure falls back to the CPU and says so.
- Under a non-English locale without the multilingual model installed,
  dictation and Voice Mode say that the language's speech model is not
  installed and point to its download, as Parakeet's "not installed" message
  does today.
- English behavior is unchanged while Parakeet serves English.

### R4 Model assets

- The multilingual model follows the Parakeet asset path: a pinned manifest
  under `models/`, `acquire`, `verify` and `path` commands under
  `scripts/models`, offline verification by `reset.sh` (a missing set disables
  only its own feature; a set that fails verification stops the reset), the
  shared content-addressed origin, a model-asset catalog entry, runtime
  capability fields derived from installed sets, versioned same-origin serving,
  and use leases that refuse removal while in use.
- Packaged desktop and built self-host download the set in the app, with size,
  progress, cancel, resume, retry, removal and attribution, as for Parakeet
  ([ADR 0012](../../adr/0012-backend-parakeet-model-assets.md)). The weights are
  not bundled in the installer. *(See Q7.)*
- Settings → Voice shows the multilingual set beside Parakeet's. Setup's Voice
  step offers the set that matches the active locale. *(Proposal, Q2.)*
- Each set carries its README and attribution; third-party notices and the
  redistribution inventory are updated.

### R5 Language notice

- No language warning appears when the offline engine for the active locale
  supports that language and is installed.
- Under a non-English locale without the multilingual model, the notice says
  to download it instead of "coming soon".
- English and the browser providers are unaffected. All locale catalogs carry
  the new strings.

### R6 Turn-taking

- Smoke check: the ja, ko and zh clips run through MicVAD and Smart Turn;
  complete utterances end the turn, and MicVAD detects speech in every
  language. Results are recorded in the plan (D11).
- The forced end-of-turn short-reply list gains Japanese, Korean and Chinese
  entries (for example はい, 네, 好的), and its normalization keeps non-Latin
  characters.

### R7 Documentation

- Voice runtime, model setup and glossary documentation describe engine
  selection by language, the new asset set and its commands.
- An ADR records the chosen model and engine-by-language routing, and updates
  ADR 0024's consequence that speech recognition waits for this issue.
  *(Proposal, Q6.)*

## Constraints

- **Offline and private.** Recognition makes no network requests; models load
  only from the verified local store. No cloud fallback (D1).
- **Runtime.** Runs in the existing browser architecture (desktop renderer and
  self-host browsers) in a worker, off the UI thread. No native sidecar. Startup
  and builds never download models.
- **Size.** Base set about 700 MB or less (D3).
- **Licences.** SenseVoice's FunASR Model License v1.1 is accepted as is, with
  attribution (D4); Nemotron 3.5 is OpenMDW-1.1. Animama's own licence is
  proprietary, so no GPL code may run in the app process. Test clips keep their
  dataset licences and are not redistributed.
- **Compatibility.** Saved speech preferences, installed Parakeet sets, leases
  and removal rules keep working. English recognition does not regress beyond
  the tolerance agreed under R1.
- **Hardware.** Targets apply to the reference Mac; Windows gets a smoke check
  only (D2).
- **Accessibility and localization.** New and changed controls and messages are
  translated in all locale catalogs and remain keyboard and screen-reader
  accessible.

## Acceptance criteria

- [ ] R1: the comparison report covers both candidates and the Parakeet
      baseline on the pinned test set, CPU and WebGPU, with every R1 measurement,
      and the owner's choice of model, English role and numeric targets is
      recorded with its date.
- [ ] Offline dictation transcribes the Japanese, Korean, Mainland Mandarin and
      Taiwan Mandarin test clips within the approved CER and latency targets on
      the reference Mac, on CPU and WebGPU (automated run through the app's
      worker, recorded in the plan).
- [ ] Chinese output is Simplified under `zh-Hans` and Traditional under
      `zh-Hant` across the test set (automated check).
- [ ] English WER and latency meet the approved targets on the same set.
- [ ] Silence and noise windows produce no text, and no recognizer tags appear
      in any output (automated check).
- [ ] Voice Mode smoke check: a complete utterance in each language ends the
      turn and auto-submits; localized short replies end a turn (unit tests and
      recorded smoke run).
- [ ] The language notice is absent under each non-English locale with the
      model installed, asks for the download when it is missing, and is
      unchanged for English (component tests and a screenshot per state).
- [ ] `acquire`, `verify` and `path` work for the new set; `reset.sh` verifies
      it offline; a missing set disables only multilingual recognition; a
      corrupted set stops the reset.
- [ ] Packaged desktop and built self-host download, resume, remove and lease
      the set; removal is refused while in use.
- [ ] No outbound network request is made while dictating with the model
      installed (network inspection during a recorded run).
- [ ] Third-party notices, set attribution and the redistribution inventory
      include the model; the desktop redistribution review passes.
- [ ] Windows smoke check: dictation in Japanese works on a Windows desktop
      build on the CPU path.
- [ ] Owner live check on the reference Mac: dictation and Voice Mode under each
      non-English locale, with live speech or played clips.
- [ ] Documentation and the ADR (if agreed) are updated.

## Open questions and decisions

Decisions (owner, 2026-10-14):

- D1 Offline only; no cloud transcriber in this issue.
- D2 Reference hardware is the owner's Mac (Apple M5, 24 GB); Windows smoke
  check only.
- D3 Download budget about 700 MB or less for the multilingual model.
- D4 SenseVoice's FunASR Model License accepted as is, with attribution.
- D5 Fast, streaming-capable models preferred; interim text preferred, not
  required.
- D6 Candidates: SenseVoice-Small and Nemotron 3.5 ASR, with Parakeet v2 as the
  English baseline. Qwen3-ASR, Whisper large-v3-turbo and Parakeet v3 dropped.
- D7 Test set: public read speech, 50–100 clips per language from FLEURS and
  Common Voice, including Taiwan Mandarin; fetched at run time.
- D8 One model for every language if English WER is within about 1.5 points of
  Parakeet's; it then becomes the default, and Parakeet stays installed and
  selectable. This replaces the issue's "Parakeet stays for English unless the
  new model matches it".
- D9 Cantonese when the chosen model supports it; not required.
- D10 Method and metrics fixed now; numeric targets approved from the
  comparison report. Latency floor: no slower than Parakeet English.
- D11 Smart Turn and voice activity: smoke check plus localized short replies.
- D12 Emotion and audio-event tags out of scope; follow-up idea.

Open, for owner review:

- Q1 Settings labels. Proposal: engine-neutral offline choices ("Offline
  (CPU)", "Offline (WebGPU · Experimental)") with a line naming the model used
  for the current language, instead of adding a separate provider per model.
- Q2 Setup's Voice step under a non-English locale. Proposal: it offers the
  multilingual set; under English it offers Parakeet as today.
- Q3 Locale change mid-session. Proposal: applies from the next start.
- Q4 Memory. No limit is set; R1 reports peak memory for review.
- Q5 How a GPU-only add-on is budgeted if the chosen model needs one.
- Q6 Proposal: record the model choice and engine-by-language routing in a new
  ADR after R1.
- Q7 The issue's acceptance says "the desktop build packages them". Under ADR
  0012 speech models are runtime downloads, so this spec reads it as the build
  carrying the catalog entry and notices, not the weights. Confirm.
- Nemotron 3.5 streams from a continuous audio feed rather than finished
  windows, so choosing it changes the worker protocol. The R1 report states
  this cost; it is not a reason to exclude it.

## Spec

https://github.com/raymond-van/animama/issues/509

## ExecPlan

[multilingual-speech-recognition-execplan.md](multilingual-speech-recognition-execplan.md)
(not yet reviewed).

## Delivery links

Phase issues: #535 (Phase 1), #536 (Phase 2), #631 (Phase 3), #632 (Phase 4),
#633 (Phase 5), #634 (Phase 6).
