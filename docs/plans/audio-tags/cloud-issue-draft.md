# Cloud addition draft: audio tags in hosted speech

Status: a draft addition to raymond-van/animama-cloud#100. Post it only with the
owner's agreement (Animama ExecPlan gate G3).

Source: Animama issue raymond-van/animama#479 (spec T1–T8), delivered on the
branch `feat/voice-audio-tags`. The hosted contract is
[`contracts/hosted-web.md`](../../../contracts/hosted-web.md) in Animama.

---

### Audio tags in hosted speech (also in scope)

Animama now lets the chat model write audio tags in `speech` when the turn's
voice can perform them, such as `[laughs]`, `[sighs]`, `[long pause]` and, on
ElevenLabs, emotion and delivery directions and sound effects.

- **Prompt (shared, inherited on adoption).** The stable instructions add an
  "Audio Tags in Speech" section chosen by the turn's speech options:
  - ElevenLabs gets its rule;
  - Gemini gets its own;
  - every other turn is told not to write tags.

  Because every hosted ElevenLabs turn gets the ElevenLabs rule, **Cloud must
  speak Eleven v4 Turbo** (the unfiled v4 hand-off,
  `docs/plans/eleven-v4/cloud-issue-draft.md` in Animama) **before it adopts
  this change, or strip tags from its own copy of the text**. Flash v2.5 and
  Multilingual v2 read tags aloud.

- **Server-side speech text (Cloud's own code).** Cloud speaks the text that
  `TurnSpeech` collects from the backend's speech `user.response` events. The
  browser's socket text is ignored, so Cloud must prepare its copy itself:
  - use `animama.domain.audio_tags.ProviderSpeechText("elevenlabs")`, one
    instance per reply, and call `.prepare(text)` on the text it sends;
  - this respells neutral tags, keeps ElevenLabs extras except accents, drops
    the third and later sounds, and removes stray brackets;
  - prepare per request, in order, so the cap counts across the reply.

- **Leading tone tag (Cloud's own code).** Locally, the shared `chat:sse` adds
  `speech_tone_tag` (for example `[very excited]`) to the first speech frame of
  an ElevenLabs reply. Cloud's own route does not, so it should:
  - read the reply's tone from the hidden emotional-tone `user.response` event
    (`response_part == "emotional_tone"`), which `TurnSpeech.observe` already
    receives;
  - read the Anima's stored emotional state before the reply. Locally this is
    `animas.stored_emotional_state(anima_id)` in `turn_setup.py`; Cloud's turn
    object does not carry it;
  - compute `animama.app.voice_emotional_tone.elevenlabs_tone_tag(emotional_tone=…,
    emotional_state=…)`;
  - prefix it to the first spoken text unless
    `animama.domain.audio_tags.opens_with_delivery_tag(text)` is true;
  - prepare and prefix the text **before** `reserve_graph`, so the reservation
    covers the exact provider text;
  - optionally, also emit `speech_tone_tag` on its first speech frame, so the
    browser's lip-sync text matches. Delivery tags form no lip-sync unit, so
    this is cosmetic.

- **Browser (inherited with `product-ui` 0.13.0 and the hosted web build).**
  - Chat bubbles hide tags, including after a reload.
  - A tag-only speech part shows no bubble.
  - The Pocket fallback after `speech_allowance_exhausted` receives tag-free
    text.

- **Readers (inherited).** Reflection and search snippets read speech without
  tags. Stored replies keep the tags the model wrote.

- **Inventory.** At adoption, update `docs/hosted/tenant-inventory.json` and
  `docs/hosted/tenant-inventory-candidate.json`:
  - drop the row for the deleted `animama/prompts/profiles.py`;
  - add rows for the new `animama/domain/audio_tags.py` and
    `animama/app/chat/speech_tags.py`.

Acceptance to add:

- A hosted ElevenLabs reply with `[laughs]` and a sound effect is heard
  performed, not read.
- Its first request starts with the tone tag, unless the reply opens with its
  own direction.
- The bubble hides the tags before and after a reload.
- With the allowance exhausted, Pocket speaks the reply without tags.
