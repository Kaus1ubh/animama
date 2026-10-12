# Gemini text-to-speech as a cloud voice

Status: Agreed (owner, 2026-10-11). On 2026-10-11 the owner dropped Gemini as
a chat model provider (parent #428 and its phase issues closed as not planned)
and kept Gemini text-to-speech as a voice provider, like ElevenLabs. The voice
decisions below were agreed on 2026-10-10 as part of that spec and still stand;
the owner confirmed this scope on 2026-10-11 (D15–D17).

Authoritative source: parent issue
[#457](https://github.com/raymond-van/animama/issues/457), published on
2026-10-11 from this file at `f63e2071`. This file is that snapshot.
Research: [gemini-tts-research.md](gemini-tts-research.md).

## Problem and intended users

Voice is limited to ElevenLabs in the cloud and to on-device voices locally. An
installation owner who already holds a Gemini API key, or wants a lower-cost
cloud voice, cannot use Gemini's speech models. Gemini 3.8 Flash-Lite TTS costs
about $0.009 per minute of audio, streams 24 kHz PCM, offers 30 prebuilt voices
and takes a free-text speaking style.

This change serves the local installation owner. It adds Gemini text-to-speech
as a selectable cloud voice beside ElevenLabs and the on-device voices.

## Goals, scope and non-goals

Include:

- An owner-supplied Gemini API key (Google AI Studio, `GEMINI_API_KEY`), held
  on the backend like the ElevenLabs key.
- Gemini text-to-speech as a selectable voice provider:
  - Gemini 3.8 Flash-Lite TTS by default;
  - Gemini 3.8 Flash TTS selectable;
  - Gemini's prebuilt voices, chosen per Anima;
  - the reply's emotional tone as a speaking style;
  - lip-sync on Gemini audio.
- Desktop key storage, the voice settings and the docs.

Exclude:

- Gemini as a chat, Utility or Memory Manager model.
- Vertex AI and Google Cloud credentials.
- Gemini speech-to-text and the Live API.
- Voice design and voice replication (custom `voice_…` IDs).
- Animama Cloud and hosted compositions; hosted voice policy stays unchanged.

## Required behavior

### R1 — Gemini key

- The owner can provide a Gemini API key:
  - on desktop, in App Settings (stored in the desktop vault and applied
    without a restart);
  - on self-hosted web, as `GEMINI_API_KEY` in the server environment.
- Only the Gemini voice reads `GEMINI_API_KEY`, and the key is sent only to
  Google's Gemini API. Owner model connections cannot name it, and the key is
  never read from `GOOGLE_API_KEY` or any other variable.
- The key is never persisted outside the desktop vault and never logged. The
  browser never receives it.
- Earlier releases' retired `gemini` vault entries stay dropped. A key saved by
  this release is a new entry.

### R2 — Gemini voice

- Gemini is a selectable cloud text-to-speech provider in the voice settings
  and per Anima, beside ElevenLabs and the on-device voices.
  - Gemini 3.8 Flash-Lite TTS is the default; Gemini 3.8 Flash TTS is
    selectable.
  - The owner picks one of Gemini's prebuilt voices per Anima.
- Speech streams from the backend as the reply arrives, and plays with
  lip-sync, as the other voices do.
- The reply's emotional tone becomes a Gemini speaking style.
- A missing key, or a failed or unavailable Gemini voice, never breaks the
  chat. The reply still shows, and the failure is visible.
- Gemini voice is offered only in the local and desktop compositions.

## Constraints

- **Credential isolation:** `GEMINI_API_KEY` goes only to Google's Gemini API
  endpoint. The SDK reads `GOOGLE_API_KEY` ahead of `GEMINI_API_KEY` and has
  other environment fallbacks, so the key is always passed explicitly and the
  client is pinned against them (see the research brief's SDK findings).
- **API surface:** Interactions on `v1beta`, because audio output is not on
  the stable `v1`. The SDK is Google's official `google-genai`, Apache-2.0.
  Its retries are off, so the application controls retries.
- **Terms and privacy:** Google's terms say the Gemini API is for developers
  and not for consumer use; users must be 18 or older; free-tier prompts may be
  used for training and human review; only paid services may be offered in the
  EEA, UK and Switzerland. All Gemini audio carries a SynthID watermark. The
  docs disclose this. Gemini voice is offered only for local owner-supplied
  keys.
- **Hosted composition:** unchanged.
- **Release:** the Python licence inventory gains `google-genai` and its new
  dependencies. The owner re-reviews it before the next desktop release.

## Acceptance criteria

- [ ] Without a key, choosing the Gemini voice shows a visible voice error and
      the reply still appears. With a key added on desktop without a restart,
      the Anima speaks, and the key is not persisted or sent to the browser.
      Evidence: backend and desktop tests; owner check.
- [ ] An owner model connection naming `GEMINI_API_KEY` is refused, and
      `GOOGLE_API_KEY` is never read. Evidence: credential tests.
- [ ] Gemini TTS speaks an Anima's reply in the chosen prebuilt voice with
      lip-sync, and the emotional tone changes the speaking style. A TTS failure
      leaves the reply visible with a voice error. Evidence: backend and
      frontend tests; owner listening check.
- [ ] The voice settings show Gemini, its model choice and the voice picker.
      Evidence: UI tests; visual check at desktop size.
- [ ] The hosted composition is unchanged. Evidence: hosted voice tests.
- [ ] The voice docs are updated. Evidence: review.

## Open questions and decisions

Agreed on 2026-10-10 (owner), carried over from the closed Gemini provider
spec:

- **D3:** Gemini speech-to-text (`gemini-3.5-transcribe-live`) is out of scope.
- **D4:** the credential is the owner's Gemini API key (Google AI Studio), not
  Vertex AI. For live tests the key goes in the owner-only secrets file.
- **D7:** text-to-speech defaults to Gemini 3.8 Flash-Lite TTS, with Gemini 3.8
  Flash TTS selectable.
- **D8 (terms):** Gemini is offered in the local and desktop app with each
  owner's own key, and the docs note the terms.
- **D12 (voices):** prebuilt voices only; voice design and replication later.
- **D14 (speaking style):** the reply's emotional tone becomes a Gemini
  speaking style.

Decided on 2026-10-11 (owner):

- Gemini is not a chat model provider.
- **D15 (scope):** this spec's scope is confirmed: a Gemini voice beside
  ElevenLabs and the on-device voices, local and desktop only.
- **D16 (live measurement):** a one-off paid TTS measurement on both 3.8 TTS
  models, well under US$0.10, is authorized to choose chunking and confirm the
  byte order.
- **D17 (branch):** the work is delivered on `feat/gemini-tts`, recreated from
  `main` with only the text-to-speech work.

Planning items:

- How the finalized TTS flow generalizes from ElevenLabs to a provider seam,
  and how the frontend's ElevenLabs-only playback and lip-sync guards
  generalize (research appendix).
- Where the TTS model choice lives (installation voice preference beside the
  ElevenLabs model) and the default prebuilt voice.
- Sentence or paragraph chunking, from measured latency
  (`tests/live/test_gemini_tts_contract.py`).
- The byte order of streamed `audio/l16`, which the browser decoder assumes is
  little-endian.
- How the desktop vault re-admits `gemini` entries without reviving retired
  ones.

## Spec

This document; the owning issue once it is published.

## ExecPlan

[gemini-tts-execplan.md](gemini-tts-execplan.md).

## Delivery links

Parent #457; phase issues #458, #459, #460 and #461. Superseded: #428 (Gemini models and Gemini text-to-speech), closed
as not planned on 2026-10-11.
