# Audio tags in the chat model's speech: execution plan

Status: Phases 1–5 authorized by the owner on 2026-10-14.

Source agreement:

- The governing document is [audio-tags-spec.md](audio-tags-spec.md), drafted on
  2026-10-14 for [issue #479](https://github.com/raymond-van/animama/issues/479).
- The owner decided D1–D3 on 2026-10-14 and then requested this plan.
- Q1–Q3 were not answered explicitly; work proceeds with the spec's proposals.
  An owner change to any of them is a bounded revision to Phases 3–4.
- The owner requested implementation of the whole plan on 2026-10-14.

Authorized scope: Phases 1–5 (owner, 2026-10-14). One branch and one PR carry
the whole plan.

Explicit gates:

- **G1 — Paid live checks (proposed).**
  - Agent-run live Gemini and ElevenLabs replies, used to confirm provider text
    and placement, stay within a budget the owner approves.
  - Proposed budget: US$0.50.
  - Record characters and estimated cost for each check.
- **G2 — Owner listening gate, before merge.** The spec's listening criterion:
  - on Eleven v4 Turbo and on Gemini: a laugh, a sigh, a pause and a whisper;
  - on ElevenLabs: also one inline emotion shift and one sound effect;
  - throughout: tags are never heard as words, and bubbles hide them before and
    after a reload.
- **G3 — Hosted.**
  - Cloud applies T1–T7 on its server socket and forwards ElevenLabs alignment.
  - This is tracked in Cloud, proposed as an addition to
    raymond-van/animama-cloud#100 (spec Q2).
  - It does not block this PR.

## Purpose and context

The aim is for the chat model to write audio tags in `speech` when the selected
voice can perform them, while every other reader of that text gets the right
form. The spec owns the requirements T1–T8; this plan refers to them by ID.

How the text flows today, at `0019e280`:

- **The model's reply** is structured JSON with `emotional_tone`, `speech` and
  related fields.
  - The live response guidance is `MAIN_STRUCTURED_OUTPUT_GUIDANCE` in
    `src/backend/animama/app/chat/memory_context.py:69`, or its Anthropic
    counterpart in `app/chat/anthropic_instructions.py:56`. Neither mentions tags.
  - The stable instructions are assembled in `_stable_instruction_sections`
    (`app/chat/openai_prompt.py:239`). Only `DirectChatPromptAssembler.assemble`
    (`:112`) calls it, from `DirectChatTurnExecutor._build_prompt`
    (`app/chat/direct_executor.py:1181`).
  - `_build_prompt` already receives the turn request, so `request.options.tts`
    (`DirectChatTtsOptions`, `app/chat/options.py:31`) is available at all three
    prompt builds.
  - The conversation-language section (`:287`) is the precedent for a section
    that depends on a setting.
- **Speech segments:**
  - `UserResponseSegmenter` (`domain/text_segmenter.py`) turns streamed speech
    into one `user.response` frame per sentence.
  - Its sentence-end pattern (`:17-20`) has no awareness of brackets.
- **Gemini, which the backend speaks:**
  - `_record_tts_speech_segment` and `speakable_text`
    (`product_http/chat/sse_events.py:305-351`) store each segment's
    `visible_text` and `tts_text`.
  - `FinalizedTtsSegmentBatcher` (`product_http/chat/tts.py:281`) batches them:
    - sentence mode uses `tts_text`;
    - paragraph mode re-joins `visible_text` (`:322`).
  - The batch text is both the Gemini request text and the lip-sync `part_text`.
  - The style comes from `gemini_speaking_style` (`app/voice_emotional_tone.py:121`).
- **ElevenLabs and browser speech, which the browser speaks:**
  - `prepareChunksForPlayback` (`src/frontend/web/src/hooks/use-tts-playback.ts:1038`)
    drops emoji from chunks produced by `lib/speech/tts-chunker.ts`. Pocket
    receives `pocketSpeechText`, which already strips tags.
  - The prepared chunks feed lip-sync through `recordPreparedChunksForAvatar`.
  - The browser never sees `emotional_tone` before speech:
    - the hidden tone part is absorbed at `sse_events.py:400-409`;
    - `emotion.update` arrives after every speech frame.
- **Chat bubbles:**
  - Bubbles are built in `@animama/product-ui`:
    - live: `useProductChatSession.ts:648-700`;
    - at completion: `:1318-1377`;
    - on reload: `lib/chat/display-message-mapping.ts:104-127`;
    - in the failure notice: `:792-801`.
  - Desktop quick chat mirrors `displayMessages`.
  - Product-ui cannot import from `web`. A grammar shared by bubbles and speech
    must therefore live in product-ui, which `web` already re-exports through
    shims.
- **Tag grammar:**
  - The tag grammar is in `web/src/lib/lipsync/text/tags.ts:31` (`TAG`,
    `splitTags`, `stripTags`). Its kinds come from `classifyAudioTag`
    (`web/src/lib/speech/speech-timing-evidence.ts:180`).
  - The backend has no tag code.
- **Other readers:**
  - Reflection reads `_reflection_text` (`adapters/repositories/sqlalchemy/chat_message_repo.py:160`).
  - Search snippets come from `_snippet_for_query` (`:29-52`).
  - Stored replies keep the raw JSON and `structured.speech`, and history replay
    uses the raw reply.
- **Cloud:**
  - Cloud speaks hosted ElevenLabs from the backend's speech `user.response`
    events on its own server (`speech_turn.py`, Cloud).
  - It can reuse a public Python tag module from `animama-backend`.
- **Shared fixtures:** precedents are `tests/fixtures/idle-playback-cases.json`,
  read by pytest and vitest, and `web/src/lib/content/fixtures/name-identifiers.json`.

### Speech pipeline, end to end

This traces one ElevenLabs reply from the model to the speakers, as of
`0019e280` (Animama) and `39cc67f` (Cloud). Steps marked **#479** are where this
plan changes the text.

**Shared start (every composition):**

1. **The model streams the structured reply.** `emotional_tone` (with
   `emotional_intensity`) comes first, then `speech`, for example
   `Oh my gosh, [laughs] that is so funny!`.
2. **The backend parses it as it streams.**
   - `MainStructuredJsonStreamParser` absorbs the tone as a hidden part. The SSE
     layer records it server-side and never sends it to the browser.
   - `UserResponseSegmenter` cuts `speech` into sentences and emits one speech
     `user.response` event per sentence. The text is exactly as the model wrote
     it.
   - **#479:**
     - the segmenter never cuts inside a tag;
     - on an ElevenLabs run, the first speech frame also carries
       `speech_tone_tag`, for example `[very excited]`.
3. **The stored reply is the raw JSON, tags included.** `emotion.update` follows
   after the last speech frame.

**Local: the desktop app and self-hosted web.** Electron's window is the
browser here.

4. **Session.** At the start of the turn, the local backend mints a single-use
   ElevenLabs `ttd_websocket` token with the owner's key and sends `tts.session`
   (`eleven_v4_turbo`, `pcm_24000`, `sync_alignment: true`).
5. **Each speech frame is used twice.**
   - It becomes a chat bubble (product-ui). **#479:** the bubble hides tags.
   - It enters the speech pipeline: `appendTtsToken` → `tts-chunker` (sentence,
     idle and length splits) → `prepareChunksForPlayback`, which drops emoji
     today.
   - **#479:**
     - the chunker never cuts inside a tag;
     - the chunk is mapped to ElevenLabs text, applying the T2/T3 rules, the
       sound cap and stray-bracket removal;
     - the first chunk is prefixed with `speech_tone_tag`.
6. **Text to ElevenLabs.** The browser opens ElevenLabs' Text to Dialogue
   websocket directly and sends each chunk as `{"inputs":[{"text": …}]}` while
   the reply is still streaming. It flushes once after the first chunk.
   ElevenLabs performs the tags.
7. **Audio to the speakers.**
   - ElevenLabs streams base64 PCM (24 kHz) with character timing.
   - The browser plays it through `PCMPlayerWorklet` on an `AudioContext`.
   - Lip-sync plans from the played audio, the chunk text as sent (tags
     included) and the timing.
   - Speech can start before the reply has finished.

**Hosted: Cloud.** Cloud serves chat with its own `chat:sse` route until stage 5
(raymond-van/animama-cloud#101).

4. **Session.**
   - Cloud's `TurnSpeech` checks the speech allowance and the Anima's voice.
   - It sends `tts.session` with `transport: "server"`, a
     `/v1/speech/sessions/<nonce>` socket on the hosted origin, and
     `sync_alignment: false`.
   - No provider credential reaches the browser.
5. **Bubbles and browser chunks run as locally.** The browser opens the Cloud
   socket with its session cookie and sends `{"text": chunk}` frames.
   - Cloud validates those frames and ignores them: browser text never selects
     the spoken utterance.
   - The browser still records its own prepared text for lip-sync.
6. **Cloud speaks its own copy of the text.**
   - It collects the speech parts from the backend's `user.response` events.
   - Only after the reply completes successfully does it reserve the allowance
     for the whole text and call ElevenLabs server-side with the operator's key.
   - Today that is the HTTP Text to Speech stream with pre-v4 models. The Cloud
     v4 hand-off (`docs/plans/eleven-v4/cloud-issue-draft.md`) moves it to
     `eleven_v4_turbo`, with an optional `/with-timestamps` variant for timing.
7. **Audio to the speakers.**
   - Cloud relays the audio frames over the socket and ends with
     `{"isFinal": true}`. Character timing is added by
     raymond-van/animama-cloud#100.
   - The browser plays them through the same `PCMPlayerWorklet`.
   - Hosted speech therefore starts after the reply ends, not while it streams.
   - If the allowance is exhausted, the browser falls back to Pocket TTS with
     tag-free text.

What this means for #479 on hosted:

- **Two copies of the text.** The audio comes from Cloud's copy and the
  lip-sync text from the browser's. Cloud must apply the same mapping, sound cap
  and tone tag to its copy, through `domain/audio_tags.py` and
  `elevenlabs_tone_tag`. Otherwise the voice and the mouth disagree about which
  tags exist.
- **The tone is available to Cloud.** Cloud can read it from the same hidden
  tone event that it already receives with the backend's events.

Gemini, by contrast, is spoken by the backend (finalized, local only today).
The backend maps each segment to Gemini text and sends that text as
`part_text` beside the PCM it pushes. Browser speech and Pocket TTS receive
tag-free text.

Boundaries:

- No lip-sync tuning. Lip-sync's tagged lines and `aligned-thresholds.test.ts`
  must pass unchanged.
- No new Alembic revision; nothing persisted changes shape.
- No accents, no Gemini emotion tags, and no avatar emotion from inline tags.
- No hosted code. Cloud work goes through G3.

## Progress

- [x] Spec drafted (2026-10-14): [audio-tags-spec.md](audio-tags-spec.md).
- [x] Owner decisions D1–D3 (2026-10-14).
- [x] ExecPlan drafted (2026-10-14).
- [x] Owner requested implementation of Phases 1–5 (2026-10-14). Q1–Q3 proceed
      as proposed.
- [ ] G1 budget approved (asked before the first paid live check).
- [ ] Spec published to #479 and read back; phase issues created.
- [ ] Phase 1: one tag grammar in both languages.
- [ ] Phase 2: prompt rules.
- [ ] Phase 3: backend speech, tone and readers.
- [ ] Phase 4: browser speech and chat display.
- [ ] Phase 5: docs, dead prompt code, live checks, full validation and the G2 pack.
- [ ] Final integration review.
- [ ] G2 owner gate.

## Surprises & Discoveries

- **2026-10-14 — The bans the brief cites are dead code.**
  - `prompts/profiles.py` (`PROFILE_TEMPLATES`) has no importer.
  - Only `tests/test_main_structured_response.py:197` calls
    `build_main_structured_output_schema`.
  - Cloud's tenant inventory lists `profiles.py` by path, so deleting the module
    changes Cloud's next adoption inventory. Phase 5 deletes both definitions
    (owner, 2026-10-14) and records the inventory row in the Cloud addition.
- **2026-10-14 — Hosted speech uses its own copy of the text.** Cloud speaks
  the text it collects server-side, after the reply ends, and ignores the
  browser's socket text. See [Speech pipeline, end to end](#speech-pipeline-end-to-end).
- **2026-10-14 — No hosted v4 issue has been filed.**
  - The Cloud hand-off for Eleven v4 Turbo
    (`docs/plans/eleven-v4/cloud-issue-draft.md`) is still a draft; no matching
    Cloud issue exists yet.
  - Cloud `main` still lists the pre-v4 models and the HTTP Text to Speech
    stream.
  - Hosted tags depend on that adoption as well as on G3.
- **2026-10-14 — The browser has no tone before speech (affects D3).** The
  leading ElevenLabs tone tag therefore has to be computed by the backend and
  delivered with the first speech frame (Phase 3).
- **2026-10-14 — The old tone level came from stored state.** The removed
  ElevenLabs prefix (`37a661ff^`) and today's `gemini_speaking_style` both take
  the degree (slightly, plain, very) from the Anima's stored emotional state,
  not from the reply's `emotional_intensity`.
- **2026-10-14 — Two splitters can cut a tag.**
  - The backend segmenter and the browser chunker both split
    `[sighs. long pause]` at ". ".
  - The browser's length and idle splits can also land inside a multi-word tag.
- **2026-10-14 — The current grammar swallows link labels.** It treats a Markdown
  link label `[text](url)` as a tag. T6 needs links kept, so Phase 1 excludes a
  `[…]` that is immediately followed by `(`.
- **2026-10-14 — The debug panel counts no Gemini tags.** Its tag count comes
  from provider timing, so it is always 0 on Gemini. Phase 4 adds a count from
  the provider text (`capture.text`).

## Decision Log

- **2026-10-12 (owner, intent discovery):** the decisions are recorded in the
  spec under "Owner decisions, 2026-10-12".
- **2026-10-14 (owner):**
  - D1: the neutral set in square brackets.
  - D2: no numeric cap on emotion or delivery tags.
  - D3: restore the leading ElevenLabs tone tag.
- **2026-10-14 (owner):** delete the unused prompt profiles and schema builder,
  which hold the old bans, in Phase 5 rather than as a separate task.
- **2026-10-14 (owner):** this issue gets its own plan and PR. #471 and #468 are
  both delivered.
- **2026-10-14 (agent, within scope; owner may revise):**
  - **P-D1 — Tone degree.** The leading tone tag takes its degree from the
    stored emotional state, by the same rule as `gemini_speaking_style`, through
    one shared helper. A neutral or unknown tone gives `[friendly]`. This keeps
    Gemini and ElevenLabs consistent.
  - **P-D2 — Delivering the tone tag.** The backend adds an optional
    `speech_tone_tag` to the first speech `user.response` frame of an ElevenLabs
    run, and only when that frame does not open with a delivery tag. A new frame
    type would add ordering and contract surface for no gain.
  - **P-D3 — Where the TypeScript grammar lives.** It moves to
    `packages/product-ui/src/lib/chat/audio-tags.ts`, exported through the
    existing `@animama/product-ui/chat` entry. `web`'s `tags.ts` and
    `speech-timing-evidence.ts` import it from there, so bubbles, browser speech
    and lip-sync share one grammar.
  - **P-D4 — Where the Python grammar lives.** It goes in
    `src/backend/animama/domain/audio_tags.py`, as pure functions documented for
    reuse by Cloud.
  - **P-D5 — Keeping the two grammars equal.** A shared case file,
    `tests/fixtures/audio-tag-cases.json`, holds:
    - the vocabulary (neutral set, aliases, provider spellings and word classes);
    - input/output cases.

    Both test suites assert that their constants equal the vocabulary and that
    every case gives the expected result. The data is not loaded at runtime,
    because the backend package must not read frontend files.

## Setup and execution rules

- **Workspace:**
  - Worktree `worktrees/animama/chat-model-voice-tags-b0f3d7`, branch
    `feat/voice-audio-tags`, starting at `0019e280` (`origin/main` at drafting).
  - Re-read `origin/main` before implementation, and record the starting
    revision in Phase 1.
  - Keep the primary checkout on `main`.
- **Python:** `uv sync --python 3.12.13`. A new worktree venv may pick 3.14.
- **Stack:**
  - Live checks only, as `./reset.sh --name tags --base-port 8480` with
    `VITE_ENABLE_DEBUG_PANEL=true`.
  - Run `git lfs pull` first, and pass credentials through `COMPOSE_ENV_FILES`
    from the owner-only secrets file.
  - Never print key values.
  - Tear the stack down right after its last use.
  - `pnpm e2e:test:fast` uses a separate disposable built stack.
- **Browser checks:** live avatar and audio checks need the browser pane visible,
  or go to the owner.
- **Phase completion:** each phase ends with:
  - its focused tests and the affected scoped checks;
  - one `sdlc-reviewer` full review, with at most two repair rounds;
  - a phase commit `feat(speech)[p#]: <summary>`, with no attribution lines.
- **CI:** hosted validation stays disabled unless the owner approves a run. Local
  checks are the evidence. Wrap delegated test runs in `timeout`.

## Phased implementation

### Phase 1: one tag grammar in both languages

Requirements: T2, T3, T5 (grammar, mapping, removal and the sound cap), the
one-grammar constraint, and the Markdown-link part of T6.

Depends on: nothing. Issue: created at workspace setup.

Changes:

1. **Shared case file.** Create `tests/fixtures/audio-tag-cases.json`:
   - **The vocabulary:**
     - the D1 neutral set with its aliases, including Gemini's documented
       spellings of the same sounds (`<laugh>`, `<chuckles>`, `<sighs>`,
       `<whispering>`, …);
     - the Gemini and ElevenLabs spelling of each neutral tag (spec T2 table);
     - the word classes now in `speech-timing-evidence.ts`: sound effect,
       non-verbal and pacing;
     - the accent rule: any tag word starting with `accent`.
   - **The cases:** each has an input, a provider (`gemini`, `elevenlabs`,
     `browser` or `pocket`) and expected outputs:
     - the provider text;
     - the display text;
     - the kinds and accepted or dropped status of each tag.
   - **What the cases must cover:**
     - both syntaxes and mixed case;
     - combined tags such as `[whispering, playful]`;
     - extras on each provider, accents and unknown tags;
     - the third sound in a reply being dropped;
     - emotion tags left uncapped (D2);
     - malformed spans such as `[see 2]`, `x < 5 and y > 3` and 80-character
       spans;
     - stray brackets;
     - Markdown links;
     - whitespace and punctuation tidying (`"gosh , that"` → `"gosh, that"`);
     - tag-only speech;
     - non-English text with English tags.
2. **TypeScript.**
   - Add `packages/product-ui/src/lib/chat/audio-tags.ts` and export it from
     `src/chat.ts`. It holds:
     - the grammar from `tags.ts`, with the link exclusion;
     - `classifyAudioTag` and its word lists, moved out of
       `speech-timing-evidence.ts`;
     - `splitAudioTags`, `stripAudioTags` and `hideSpeechTags` (display);
     - `createProviderSpeechText(provider)`, which returns a per-run function
       that maps one chunk at a time and keeps the sound count across chunks.
   - `web/src/lib/lipsync/text/tags.ts` keeps its exports
     (`splitTags`, `stripTags`, `lipSyncTagKind`, `pausePriorSec`,
     `TAG_PRIOR_SEC`), built on the package module.
   - `speech-timing-evidence.ts` imports `classifyAudioTag` from the package.
     Its square-bracket timing parser is unchanged.
3. **Python.** Add `src/backend/animama/domain/audio_tags.py`, the same module in
   Python:
   - `split_audio_tags`, `strip_audio_tags` and `classify_audio_tag`;
   - `ProviderSpeechText(provider)`, a per-reply object whose
     `.prepare(segment) -> str` keeps the sound count;
   - `opens_with_delivery_tag(text)`.

   Docstrings name Cloud's server socket as a supported caller.
4. **Tests:**
   - `tests/test_audio_tags.py`, and `audio-tags.test.ts` in `web` (alongside the
     chat shims), both run the case file and assert that the vocabulary is equal.
   - Existing lip-sync tests run unchanged: `text-units.test.ts`,
     `fixtures.test.ts`, `aligned-thresholds.test.ts` and the timing evidence
     tests.

Checks:

- `uv run pytest -q tests/test_audio_tags.py`
- `uv run ruff check`
- `uv run ruff format --check src/backend/animama tests`
- `pnpm --dir src/frontend packages:build`
- `pnpm --dir src/frontend packages:check`
- `pnpm --dir src/frontend web:test`
- `pnpm --dir src/frontend web:lint`
- `pnpm --dir src/frontend/web lipsync:eval`, with results identical to `main`.

Completion: both suites pass the same cases, and lip-sync results are unchanged.

Recovery: the change is pure code. If moving the grammar disturbs lip-sync,
restore the `web` copy and import only the new provider functions from the
package until the difference is found.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 2: prompt rules

Requirements: T1 and T4 (prompt text).

Depends on: Phase 1, for the vocabulary names only.

Changes:

1. **A new section builder,** `speech_tags_instruction(tts) -> str` in
   `app/chat/speech_tags.py`, with three byte-stable variants:
   - **Gemini:** the neutral set, the T4 rules (few, short, at boundaries; pauses
     and sighs at a sentence's start; at most two sounds; emotion and delivery
     only at real shifts; whisper at a sentence's start for that sentence; words
     always present), and English tag names in every language.
   - **ElevenLabs:** the same, plus the extras (emotion and delivery, other
     non-verbal sounds, sound effects; no accents).
   - **No tags:** for speech off, Pocket, browser speech or no options, a single
     rule not to write bracketed tags in `speech`.
2. **Threading:** `_build_prompt` passes `request.options.tts` to
   `assemble(...)`, and `_stable_instruction_sections` appends the section after
   Response Guidance and before the conversation-language section.

Tests:

- extend `tests/test_turn_instruction_layout.py` and
  `tests/test_conversation_language.py`:
  - the section variant for each provider and model;
  - section order;
  - a byte-identical stable prefix across turns with the same voice;
  - a single change when the voice changes;
- the stale-cursor rebuild in `tests/test_direct_chat_turn_executor.py` keeps the
  section;
- the Anthropic layout tests;
- update `docs/backend/runtime/prompt-caching.md` (a voice change invalidates the
  stable prefix).

Checks:

- `uv run pytest -q tests/test_turn_instruction_layout.py tests/test_conversation_language.py tests/test_anthropic_direct_chat.py tests/test_direct_chat_turn_executor.py tests/test_main_structured_response.py`
- ruff check and format check.

Completion: each voice gets its rule and the caching tests pass. The live cache
measurement (`tests/live/test_prompt_cache_layout.py`) is optional and covered by
G1.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 3: backend speech, tone and readers

Requirements:

- T5 (Gemini provider text);
- T7 and D3 (computing and delivering the tone tag);
- T8 (backend segmenter);
- T6 (Reflection and search snippets);
- the Q3 proposal.

Depends on: Phase 1.

Changes:

1. **Segmenter:** in `UserResponseSegmenter._split_complete_sentences`, skip
   sentence-end matches inside an open candidate tag. A candidate is an opening
   `[` or `<` within the last 64 characters, not yet closed, whose content still
   fits the grammar. A span that outgrows the grammar stops being a candidate.
2. **Gemini text:**
   - `SseTextState` gains the run's speech provider, set at
     `product_http/chat/stream.py:237`, and a per-reply `ProviderSpeechText`.
   - `_record_tts_speech_segment` sets `tts_text` from the provider text, and
     drops a segment that has no letters or digits after mapping.
   - `FinalizedTtsSegmentBatcher` paragraph mode joins the segments' `tts_text`
     instead of re-running `speakable_text` on `visible_text`.
   - The batch text, and therefore `part_text`, is the mapped text.
3. **Tone tag (P-D1, P-D2):**
   - Add `elevenlabs_tone_tag(emotional_tone, emotional_state)` to
     `voice_emotional_tone.py`, sharing the degree helper with
     `gemini_speaking_style`.
   - On an ElevenLabs run, `format_user_response_event` adds `speech_tone_tag`
     to the first speech frame, unless `opens_with_delivery_tag(text)`.
   - The tag goes into no stored text.
4. **Readers:**
   - `_reflection_text` strips tags from `structured.speech`, leaving `display`
     as written.
   - `_search_row_to_domain` strips tags before `_snippet_for_query`. Matching is
     unchanged (Q3).

Tests:

- `tests/test_text_segmenter.py`: tags with inner `.`, `!` and `?`; a tag
  arriving across deltas; a span past 64 characters.
- `tests/test_anima_chat_sse.py`:
  - Gemini `tts_text` and batches in both modes;
  - the sound cap across segments;
  - the tone-tag field on the first ElevenLabs frame only, absent when speech
    opens with a delivery tag, and absent on Gemini, Pocket and browser runs.
- `tests/test_chat_sse_golden.py`: update the golden files for the new field.
- `tests/test_memory_manager_reflection.py`, `tests/test_shared_chat_search.py`:
  tag-free Reflection input and snippets; stored speech unchanged.

Checks:

- the tests above;
- `uv run pytest -q`;
- ruff;
- `make check-test` before the phase commit.

Recovery: the segmenter change is the risk. If the golden or sentence tests move
for untagged text, narrow the candidate rule to require an opening bracket
followed by a letter.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 4: browser speech and chat display

Requirements:

- T5 (ElevenLabs and browser-speech text);
- T7 (applying the tone tag);
- T8 (browser chunker);
- T6 (bubbles, failure notice, quick chat);
- the Q1 proposal;
- the debug tag count.

Depends on: Phases 1 and 3.

Changes:

1. **Chunker:** in `tts-chunker.ts`, the sentence split, length split
   (`splitAtWhitespaceOrLimit`) and idle split never end inside an open candidate
   tag. A length split backs off to before the tag's opening bracket.
2. **Provider text:** in `prepareChunksForPlayback`:
   - ElevenLabs runs use a per-run `createProviderSpeechText("elevenlabs")`,
     reset in `resetRunPlaybackLifecycle`;
   - browser speech gets `stripAudioTags`;
   - Pocket stays unchanged;
   - the Pocket fallback resets the state and re-prepares from the raw speech.
3. **Tone tag:**
   - `useProductChatSession` passes `speech_tone_tag` from the first speech frame
     to the speech runtime.
   - `enqueueElevenLabsChunks` prepends it to the run's first prepared chunk.
   - Lip-sync sees it as a delivery tag, which forms no unit.
4. **Bubbles:** in product-ui, apply `hideSpeechTags`:
   - to the speech bubble's `text` and `streamingSegments` in `displayMessages`.
     Per-segment hiding is safe because T8 keeps tags whole within a segment;
   - in `structuredAssistantTexts` (speech only; compare display against the raw
     speech);
   - to completion rows, which carry `data.structured` so the same mapping
     applies;
   - in the failure notice's `partialText`.
   A speech part that is empty after hiding shows no bubble (Q1). The TTS input
   and stored speech stay raw.
5. **Debug:** `LipSyncDebugSection` shows the provider text's tag count from
   `splitAudioTags(capture.text)`, next to the existing timing count.

Tests:

- `tts-chunker.test.ts`;
- `use-tts-playback.test.tsx`:
  - ElevenLabs mapping and the cap across chunks;
  - the tone tag on the first chunk only;
  - browser speech tag-free;
  - the Pocket fallback tag-free;
  - `onSpeechText` equal to the provider text;
- `structured-response-stream.test.ts`, `display-message-mapping.test.ts`,
  `chat-failure.test.ts`, `useDesktopQuickChatRuntime.test.ts` and
  `LipSyncDebugSection.test.tsx`;
- the product-ui `tests/chat-lifecycle.test.mjs` where bubbles are asserted.

Checks:

- `pnpm --dir src/frontend check`
- `pnpm --dir src/frontend web:lint`
- `pnpm --dir src/frontend web:test`
- `pnpm --dir src/frontend packages:test`
- `pnpm --dir src/frontend build`
- `pnpm --dir src/frontend/web lipsync:eval`

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

### Phase 5: docs, dead prompt code, live checks, full validation and the G2 pack

Requirements:

- the docs criterion of the spec's acceptance;
- deleting the dead prompt code that holds the old bans (owner, 2026-10-14);
- the G1 checks;
- preparation for G2.

Changes:

1. **Docs.** Update current guidance:
   - Backend:
     - `docs/backend/runtime/chat.md`;
     - `docs/backend/integrations/voice-and-speech.md` (provider text, the tone
       tag field, which replaces "no tone tag").
   - Frontend:
     - `docs/frontend/runtime/elevenlabs-tts.md`;
     - `gemini-tts.md`;
     - `voice.md` (browser speech strips tags);
     - `chat.md` (bubbles hide tags);
     - `avatar-lipsync.md` (the provider-text tag count).
   - Contracts: `contracts/hosted-web.md`, if it describes `user.response`
     fields.
   - Glossary: an **Audio tag** entry.
2. **Dead prompt code.** First confirm, with `rg` over `src`, `tests`,
   `scripts` and `docs`, that both are still unused. Then delete:
   - `src/backend/animama/prompts/profiles.py` (`PROFILE_TEMPLATES`);
   - `build_main_structured_output_schema`
     (`app/main_structured_response.py:706`, plus its `__all__` entry);
   - `test_main_structured_output_schema_lists_available_gesture_values`
     (`tests/test_main_structured_response.py:197`), the only caller of that
     function, after checking that no live behaviour depends on it. The live
     schema stays `PyMainAgentResponse.model_json_schema()`.
3. **Cloud.** Draft the Cloud addition for raymond-van/animama-cloud#100.
   Post it only when the owner agrees (G3). It covers:
   - T1–T7 parity;
   - applying `domain/audio_tags.py` and `elevenlabs_tone_tag` to Cloud's
     collected speech text before it calls ElevenLabs;
   - reading the tone from the hidden tone event;
   - the `profiles.py` row to drop from Cloud's tenant inventory;
   - a dependency on the unfiled Eleven v4 Turbo hand-off.
4. **Live checks (G1),** on the `tags` stack:
   - one tagged reply each on Gemini and on Eleven v4 Turbo;
   - for each, check the debug panel's provider text and tag counts and the
     bubbles before and after a reload;
   - one browser-speech reply, checking that tags are not spoken;
   - record cost.
5. **Full validation:**
   - `uv run pytest -q`, `uv run ruff check`, `make check-test`;
   - the frontend commands from Phase 4;
   - `pnpm --dir src/frontend desktop:check`;
   - `pnpm e2e:test:fast` on a disposable built stack.
6. **G2 pack:** the prompts for the owner to try on each voice (the spec's
   listening list), what to listen and look for, and where to look in the debug
   panel.

#### Code Review #1 Findings

Pending.

#### Code Review #1 Revisions

Pending.

## Final integration review

Scope: the whole branch against the spec's acceptance criteria. Still-valid phase
evidence is reused. One full review, with at most two repair rounds.

Pending.

## Validation and acceptance

Acceptance is the spec's list, plus:

- lip-sync's results identical to `main`;
- G2 passed by the owner.

Record exact commands, results and the source revision of each run. Keep local
evidence separate from any hosted run. Never record an unperformed check as
passed.

## Idempotence and recovery

- **Persistence and migrations:** nothing persisted changes. Stored replies keep
  the tags the model wrote, so reverting the branch leaves history readable, with
  tags shown as text again.
- **Re-running tests:** the shared case file and the golden SSE files are the
  only fixtures. Regenerate the golden files only with the existing golden
  tooling, and review the diff.
- **Prompt caching:** a voice change, or the first turn after deployment,
  invalidates the stable prefix once per chat. No data is affected.
- **Stack:** live checks use only the `tags` stack. Tear it down after use;
  `reset.sh --name tags` can recreate it.

## Outcomes & Retrospective

Pending.
