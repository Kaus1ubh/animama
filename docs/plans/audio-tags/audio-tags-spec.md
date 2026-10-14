# Audio tags in the chat model's speech

Status: Agreed. The owner decided D1–D3 on 2026-10-14, then requested the ExecPlan
and its implementation (Phases 1–5) the same day. Q1–Q3 were not answered
explicitly; work proceeds with their proposals.
Owner decision: 2026-10-14. It builds on the owner's intent-discovery decisions of
2026-10-12, recorded in issue #479 and as D12 in the
[Eleven v4 spec](../eleven-v4/eleven-v4-spec.md).

Authoritative source: issue [#479](https://github.com/raymond-van/animama/issues/479),
published from this file at `2337e064` and read back on 2026-10-14T16:32:55Z. This file is a
snapshot of that issue; refresh it from the issue before resuming.

## Problem and intended users

Each reply's `speech` is both spoken by the selected voice and shown in the chat.
Gemini 3.8 TTS and Eleven v4 Turbo can perform audio tags: laughs, sighs, gasps,
pauses and whispering. Animama never asks the model for them, and it treats any
tag the model does write as ordinary text:

- **The prompt says nothing about tags.**
  - The three bans cited in the brief are unused code. `PROFILE_TEMPLATES` in
    `prompts/profiles.py` has no importer, and only a test calls
    `build_main_structured_output_schema`.
  - Neither the live schema nor the response guidance mentions tags.
- **A tag the model writes anyway is handled inconsistently:**
  - it reaches Gemini and ElevenLabs as written, in whichever syntax the model
    chose;
  - browser speech reads it aloud;
  - chat bubbles show it;
  - Reflection and chat search treat it as words;
  - only Pocket TTS strips it.
- **Tone:**
  - Since D13 of #471, ElevenLabs speech carries no tone tag, so ElevenLabs
    receives no signal of the reply's emotion.
  - Gemini receives `emotional_tone` as its speaking style.

Lip-sync (#468, PR #473) already handles tags in whatever text reaches the
provider:

- it reads both syntaxes, Gemini's `<laugh>` and ElevenLabs' `[laughs]`;
- it classifies each tag (laugh, sigh, gasp, other vocal sound, pause, sound
  effect, whisper, delivery);
- it gives laughs, sighs and gasps brief expressions;
- it plans from the exact text each voice receives.

What is missing is the model writing tags at all, with each voice and reader
receiving the right form of them.

This serves the installation owner, on desktop and self-hosted web, who chats
with an Anima whose voice is Gemini or Eleven v4 Turbo. Hosted compositions
follow once Cloud applies the same rules.

## Terms

- **Audio tag:** a short bracketed direction in `speech` that the voice performs
  and never speaks as words. It is written either in square brackets
  (`[laughs]`, ElevenLabs) or in angle brackets (`<laugh>`, Gemini).
- **Neutral tag:** one of the small set the model may write for any tag-capable
  voice. Animama spells it the way each provider expects (T2).
- **ElevenLabs extra:** any other well-formed tag, allowed only when ElevenLabs
  is selected (T3). Extras cover emotion and delivery, other non-verbal sounds
  and sound effects.
- **Tag-capable voice:** speech is on and the provider is Gemini or ElevenLabs.
  Eleven v4 Turbo is the only ElevenLabs model.
- **Provider text:** the exact text Animama sends to a voice for one request or
  chunk.

## Goals, scope and non-goals

Include:

- Prompt rules that depend on the selected voice (T1, T4).
- The neutral vocabulary and its spelling per provider (T2), plus the ElevenLabs
  extras (T3).
- Validation, a frequency cap and tag removal for every voice, including browser
  speech (T4, T5).
- Tags hidden in chat text but kept in stored history. Reflection input and
  search snippets are tag-free (T6).
- How tone reaches ElevenLabs (T7).
- Segmenting and chunking that never splits a tag (T8).
- Deleting the unused prompt profiles and schema builder that hold the old
  bans, so the code holds one live rule (owner, 2026-10-14).

Exclude:

- Lip-sync tuning, mouth shapes and expressions, which belong to #468.
  `aligned-thresholds.test.ts` already sits at its limits.
- Accents.
- Emotion tags on Gemini, whose style still comes from `emotional_tone`.
- The avatar's emotion following inline tags.
- Tags performed by Pocket TTS or browser speech.
- Tags in `display`. Display text is never spoken, and it is shown as written.
- Search matching. Tag words in stored speech may still match a query (Q3).
- Cloud's implementation, which is tracked in Cloud (Q2).

## Required behavior

Example, with ElevenLabs selected, the model writes this speech:

```text
Oh my gosh, [laughs] that is so funny! [applause]
```

| Reader | Receives or shows |
| --- | --- |
| ElevenLabs | `Oh my gosh, [laughs] that is so funny! [applause]` |
| Gemini, had it been selected | `Oh my gosh, <laugh> that is so funny!` (the sound effect is dropped) |
| Browser speech or Pocket TTS | `Oh my gosh, that is so funny!` |
| Chat bubble, live and after reload | `Oh my gosh, that is so funny!` |
| Stored reply and later model turns | The speech exactly as written |

### T1 — Permission

- **Tag-capable voice:** the prompt allows tags under T4's rules. It offers the
  neutral tags, plus the extras when the voice is ElevenLabs. Tag names stay in
  English in every conversation language.
- **Any other turn:** the prompt tells the model not to write tags. This covers
  speech off, Pocket TTS, browser speech and a request without speech options.
  The rule holds even when earlier turns in history, spoken by another voice,
  contain tags.
- **How the backend decides:** from the turn's speech options. Today, speech off,
  Pocket and browser speech all send none, and all three mean no tags.
- **The prompt does not enforce anything.** Whatever it says, T5 decides what
  reaches each voice.

### T2 — Neutral vocabulary

The model writes square brackets. The set (D1):

| Model writes | Gemini receives | ElevenLabs receives | Lip-sync kind |
| --- | --- | --- | --- |
| `[laughs]` | `<laugh>` | `[laughs]` | laugh |
| `[chuckles]` | `<chuckle>` | `[chuckles]` | laugh |
| `[giggles]` | `<giggle>` | `[giggles]` | laugh |
| `[sighs]` | `<sigh>` | `[sighs]` | sigh |
| `[gasps]` | `<gasp>` | `[gasps]` | gasp |
| `[breathes]` | `<breath>` | `[breathes]` | sigh |
| `[short pause]` | `<short pause>` | `[pause]` | pause |
| `[long pause]` | `<long pause>` | `[long pause]` | pause |
| `[whispers]` | `<whispers>` | `[whispers]` | whisper |

- **Spelling variants:** case and syntax do not matter. `<laugh>` and `[laugh]`
  both mean the neutral laugh. The plan fixes the full alias list, which includes
  Gemini's documented spellings of these sounds.
- **Whisper:** a modifier. It goes before the words it affects, and the prompt
  asks for it at the start of a sentence, for that sentence only. The listening
  gate checks how far each provider carries it.
- **ElevenLabs pause spellings** are confirmed in the listening gate. Changing a
  spelling is a plan detail.

### T3 — ElevenLabs extras

When ElevenLabs is selected, other well-formed tags pass as written:

- **Emotion and delivery,** placed before the words they affect, such as
  `[excited]`, `[softly]` or `[whispering, playful]`.
- **Other non-verbal sounds,** such as `[coughs]` or `[yawns]`.
- **Sound effects,** such as `[applause]` or `[door knocks]`.

Two exceptions:

- A tag that asks for an accent is dropped.
- On Gemini, every extra is dropped.

### T4 — Prompt rules and frequency

The prompt asks for:

- **Few, short tags,** at sentence or clause boundaries, at the moment the sound
  happens. Pauses and sighs at the start of a sentence are placed most reliably.
- **At most two sounds per reply.** Sounds are non-verbal sounds, sound effects
  and pauses.
- **Emotion or delivery tags only at a real shift in mood.** These, including
  whisper, have no numeric cap (D2).
- **Words in every reply.** Speech always has words besides its tags (Q1).

Animama enforces the sound cap. Counting in reading order across the whole reply,
it drops the third and later sounds from the provider text. History keeps them
(T6).

Evidence for these rules, from #468:

- **Gemini, without provider timing:** lip-sync places 2–4 of 8 tags. A voiced
  laugh or sigh looks like speech to loudness and voicing.
- **ElevenLabs, with timing:** 7 of 7 on HTTP clips, and 2–4 of 5 over the
  socket.

### T5 — Validation and tag removal

- **What reaches Gemini and ElevenLabs:** provider text holds only accepted tags,
  each in the provider's syntax. A tag is accepted when it is all of these:
  - well formed: it starts with a letter, contains only letters, spaces and
    `,.!?'’-`, and is at most 64 characters long;
  - allowed for the provider (T2, T3);
  - within the sound cap (T4).
- **Anything else recognized as a tag** is dropped and never read aloud.
- **No stray brackets:** outside accepted tags, Gemini and ElevenLabs provider
  text contains no `[`, `]`, `<` or `>`.
- **Pocket TTS and browser speech** receive tag-free text, including after the
  hosted `speech_allowance_exhausted` fallback to Pocket. Pocket already does
  this; browser speech gains it.
- **Same result on both paths.** The same speech gives the same provider text
  wherever it is prepared:
  - Gemini's text is prepared by the backend, one speech segment at a time;
  - ElevenLabs and browser-speech text is prepared in the browser, one chunk at a
    time.

### T6 — Visible text, history and other readers

- **Speech bubbles hide every recognized tag, accepted or not.** This applies in
  each place speech is shown:
  - while streaming and at completion;
  - after a reload;
  - in the failure notice's partial text;
  - in desktop quick chat.
- **The remaining text reads naturally,** with no doubled spaces or a space
  before punctuation.
- **Markdown link labels** (`[text](url)`) are not tags, and they stay.
- **Stored replies keep every tag the model wrote,** including tags T5 dropped.
  This covers the structured data, the raw reply content and the provider
  message, so the model sees the tags on later turns.
- **Reflection reads tag-free text.** Chat search snippets show tag-free text.
- **The compaction summary** reads the stored reply as model context, as replay
  does, and may see tags.
- **A speech part holding only tags** shows no speech bubble (Q1). Its sound
  still plays.

### T7 — Emotion

- **`emotional_tone` is still the reply's emotion.** It drives the avatar's
  emotion update and Gemini's speaking style, as today.
- **An ElevenLabs emotion or delivery tag changes the voice from that point on.**
  Neither the avatar's emotion nor the lip-sync expressions follow it.
- **ElevenLabs leading tone (D3):**
  - When speech does not open with the model's own emotion or delivery tag,
    Animama starts the reply's ElevenLabs text with a tone tag from
    `emotional_tone` and its intensity.
  - The tag takes the form `[slightly X]`, `[X]` or `[very X]`. A neutral tone
    gives `[friendly]`, matching Gemini's style for neutral replies.
  - The tag is not counted against the sound cap, not shown, and not stored.

### T8 — Segments, chunks and lip-sync

- **No boundary falls inside a bracketed span.** This applies to backend speech
  segments and browser chunks alike. Two cases currently cut a tag:
  - a sentence mark inside a tag, as in `[sighs. long pause]`;
  - the browser's idle and length splits.
- **Lip-sync still plans from the provider text,** so it sees exactly the accepted
  tags, in provider syntax:
  - Gemini's `part_text`;
  - the chunks sent to ElevenLabs;
  - browser speech's tag-free text.
- **No lip-sync tuning.**

## Constraints

- **Security:** tags are untrusted model output. Only accepted tags become
  provider controls. The sound cap bounds how many sounds pass, and the grammar
  bounds every tag's length.
- **One grammar:** the backend (Python) and the browser (TypeScript) must
  recognize, map and drop tags identically.
  - The evidence is a fixture set that both test suites run.
  - The browser's lip-sync grammar in `lib/lipsync/text/tags.ts` is the
    reference. Any change to it must keep lip-sync's tagged test lines passing.
- **Streaming:** tags are handled one segment or chunk at a time, in order, and
  the finalized and realtime paths behave alike. The sound cap counts across the
  reply in reading order.
- **Prompt caching:**
  - The tag rule depends on the selected voice.
  - Changing the voice changes the stable instructions once, as changing the
    conversation language does.
  - Turns with the same voice keep them byte-identical (ADR 0023).
- **Compatibility:**
  - The stored reply keeps its shape.
  - Tags already in older stored replies are hidden in the chat too.
  - After a voice switch, T5 applies at speech time.
- **Cost:** tags count as provider characters. The sound cap and the prompt's
  sparing rule bound their cost.
- **Languages:** tag names stay in English in every conversation language, as
  Gemini's documentation recommends.
- **Hosted:**
  - Cloud speaks hosted ElevenLabs through its own server socket, so it must
    apply T1–T7 itself.
  - Timed tags on hosted ElevenLabs also need Cloud to forward ElevenLabs'
    character timing (alignment). raymond-van/animama-cloud#100 already tracks
    that (Q2).

## Acceptance criteria

- [ ] **Permission:** backend tests show:
  - the tag rules for Gemini and for ElevenLabs, with extras offered only for
    ElevenLabs;
  - the no-tags rule for speech off, Pocket TTS, browser speech and missing
    speech options.

  No unused ban copy remains.
- [ ] **Mapping:** the shared fixtures pass in both the backend and the frontend
  suites. They cover:
  - the neutral set for each provider, with aliases in both syntaxes;
  - extras passing on ElevenLabs only;
  - accents, and unknown tags on Gemini, being dropped;
  - the sound cap, with emotion and delivery tags left uncapped;
  - malformed brackets and stray bracket characters.
- [ ] **Tag removal:** tests show:
  - Pocket TTS (including after the fallback) and browser-speech provider text
    are tag-free;
  - bubble text is tag-free while streaming, at completion and after a reload;
  - Reflection input and search snippets are tag-free;
  - stored speech keeps every tag.
- [ ] **Segmentation:** tests show that the backend segmenter and the browser
  chunker never split either a tag with inner punctuation or a long multi-word
  tag.
- [ ] **Tone (D3):** tests show:
  - the leading tone tag for each intensity, and `[friendly]` for a neutral tone;
  - no leading tag when speech opens with the model's own emotion or delivery tag;
  - the leading tag absent from bubbles and stored speech.
- [ ] **Lip-sync:**
  - `pnpm --dir src/frontend/web lipsync:eval` and `aligned-thresholds.test.ts`
    pass unchanged;
  - on a tagged reply, the debug panel's Lip-sync view shows the provider text's
    tag count.
- [ ] **Listening (owner gate):**
  - on Eleven v4 Turbo and on Gemini: a laugh, a sigh, a pause and a whisper;
  - on ElevenLabs only: one inline emotion shift and one sound effect.

  In each case:
  - no tag is heard as a word;
  - bubbles hide the tags, including after a reload;
  - browser speech does not read them.
- [ ] **Checks and docs:** backend and frontend checks pass. Current guidance is
  updated:
  - backend: `runtime/chat.md` and `integrations/voice-and-speech.md`;
  - frontend: `runtime/elevenlabs-tts.md`, `runtime/gemini-tts.md`,
    `runtime/voice.md`, `runtime/chat.md` and `runtime/avatar-lipsync.md`;
  - the glossary gains **Audio tag**.

## Open questions and decisions

### Owner decisions, 2026-10-12 (intent discovery)

- **Vocabulary:** a neutral set, plus ElevenLabs extras.
- **Emotion:** also inline on ElevenLabs.
- **ElevenLabs extras:** more non-verbal sounds and sound effects, but no accents.
- **Frequency:** sparing and capped. At most two sounds or pauses per reply;
  inline emotion only at real shifts; Animama drops anything over the cap.
- **Visible text:** hidden in the chat, kept in history.
- **Validation:** unsupported or unknown tags are dropped.
- **Permission:** as proposed in the owner's note of 2026-10-12 (T1).

### Findings since the brief (research, 2026-10-14)

- **F1 — No ban is live.** The brief assumed three bans. T1 therefore adds a
  live rule both ways and removes the unused copies.
- **F2 — No automatic ElevenLabs tone tag exists.**
  - D13 of #471 removed it together with finalized v4; the realtime path never
    had one.
  - The brief's proposal to omit the automatic tag when the model writes its own
    is therefore replaced by D3.
- **F3 — Text is prepared in two places.** The backend prepares Gemini's provider
  text; the browser prepares ElevenLabs' and browser speech's. The single-grammar
  constraint follows from this.
- **F4 — #479 gets its own plan.** #471 and #468 are both delivered, so #479
  gets its own ExecPlan and PR. This resolves the brief's planning question.
- **F5 — T8 is reduced.**
  - The English phoneme input left with gruut.
  - #471 already added the sound-effect class to the timing evidence.
  - What remains of T8 is tag-safe splitting.
- **F6 — Two tag-splitting risks:**
  - the backend's sentence-end rule splits at a mark followed by a space inside a
    tag;
  - the browser's idle and length splits can cut a multi-word tag.
- **F7 — A doc conflict.** The R3 table in
  [lipsync-spec.md](../lipsync-upgrade/lipsync-spec.md) says ElevenLabs gets a
  leading tone tag from `emotional_tone`. Before D3 that was stale; D3 makes
  it correct once delivered. Current guidance that says ElevenLabs text carries
  no tone tag changes with the delivery.

### Owner decisions, 2026-10-14

- **D1 — Neutral set and syntax:** the T2 table, written in square brackets.
- **D2 — No numeric cap on emotion or delivery tags,** whisper included. The
  prompt asks for them only at real shifts in mood. The cap of two sounds per
  reply (2026-10-12) stands.
- **D3 — ElevenLabs leading tone:** restore a tone tag from `emotional_tone`,
  except when speech opens with the model's own emotion or delivery tag (T7).

### Open for the owner (proceeding as proposed, 2026-10-14)

- **Q1 — Speech that is only tags.** Proposed: the prompt requires words, and a
  tag-only speech part shows no bubble.
- **Q2 — The Cloud follow-up.** The owner leans towards folding T1–T7 parity
  into raymond-van/animama-cloud#100, which already covers forwarding
  ElevenLabs alignment on Cloud's server socket. Proposed: add it to #100 when
  this spec is published.
  - Consequence: #100 then adopts both #473 and this delivery. Its gruut
    clean-up can still land on the next adoption, with the tag parity following
    once this work merges.
- **Q3 — Search.** Proposed: snippets hide tags; matching is unchanged.

## Spec

[#479](https://github.com/raymond-van/animama/issues/479), the authoritative copy. This file is its snapshot.

## ExecPlan

[audio-tags-execplan.md](audio-tags-execplan.md), drafted on 2026-10-14. The
owner authorized Phases 1–5 on 2026-10-14. A plan is needed because the work spans backend and
browser text paths, a grammar shared across two languages, and an owner
listening gate.

## Delivery links

- **Phases:** [#538](https://github.com/raymond-van/animama/issues/538) (shared grammar),
  [#539](https://github.com/raymond-van/animama/issues/539) (prompt rules),
  [#540](https://github.com/raymond-van/animama/issues/540) (backend speech),
  [#541](https://github.com/raymond-van/animama/issues/541) (browser speech and bubbles),
  [#542](https://github.com/raymond-van/animama/issues/542) (docs, dead code, validation).
- **Depends on:**
  - [#471](https://github.com/raymond-van/animama/issues/471), delivered;
  - [#468](https://github.com/raymond-van/animama/issues/468), delivered in PR
    #473.
- **Related:** raymond-van/animama-cloud#100, which covers #468's removed chat
  fields.
