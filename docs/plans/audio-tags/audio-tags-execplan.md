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

- **G1 — Paid live checks (US$0.50, owner, 2026-10-14).**
  - Agent-run live Gemini and ElevenLabs replies, used to confirm provider text
    and placement, stay within a budget the owner approves.
  - Budget: US$0.50, approved by the owner on 2026-10-14.
  - Record characters and estimated cost for each check.
- **G2 — Owner listening gate, before merge.** The spec's listening criterion:
  - on Eleven v4 Turbo and on Gemini: a laugh, a sigh, a pause and a whisper;
  - on ElevenLabs: also one inline emotion shift and one sound effect;
  - on ElevenLabs: a whisper followed by more speech, which must return to the
    reply's tone (an agent prompt decision; Phase 2);
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
     - on an ElevenLabs run, the shared `chat:sse` route's first speech frame
       also carries `speech_tone_tag`, for example `[very excited]`. Cloud's
       own route computes the tag itself (G3).
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
- [x] G1 budget approved: US$0.50 (owner, 2026-10-14).
- [x] Spec published to #479 from `2337e064` and read back (2026-10-14T16:32:55Z); phase
      issues #538–#542 created as sub-issues.
- [x] Phase 1 (#538): one tag grammar in both languages. Review #1 was blocked
      (2 findings, fixed), review #2 passed; one repair round remains.
- [x] Phase 2 (#539): prompt rules. Review #1 was blocked (2 wording
      findings, fixed), review #2 passed; one repair round remains.
- [x] Phase 3 (#540): backend speech, tone and readers. Review #1 was blocked
      (2 reader findings, fixed), review #2 passed; one repair round remains.
- [x] Phase 4 (#541): browser speech and chat display.
  - Reviews #1–#3 used the full repair budget.
  - The owner waived a further recheck for the final one-line guard (P4-R3-F1,
    2026-10-14). The final integration review still covers it.
- [x] Phase 5 (#542): docs, dead prompt code, live checks, full validation and the G2 pack.
      Review #1 was blocked (2 doc findings, fixed); see its record for the recheck.
- [ ] Final integration review.
- [ ] G2 owner gate.

## Resume here

The work was paused twice by the owner on 2026-10-14 and resumed each time.
Current state:

- Phases 1–4 are committed.
- Phase 5 has been reviewed.
- The `tags` stack is kept for G2.
- The disposable e2e stack has been removed.

Remaining:

- the final integration review;
- push and PR;
- G2 (owner);
- G3 (Cloud, owner).

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
    `packages/product-ui/src/lib/chat/audio-tags.ts`. `web`'s `tags.ts` and
    `speech-timing-evidence.ts` import it, so bubbles, browser speech and
    lip-sync share one grammar.
    - **Revised 2026-10-14 (Phase 1 review, P1-R1-F3):** the grammar is
      exported through a new, dependency-free entry,
      `@animama/product-ui/audio-tags`, not through `./chat`.
    - Reason: importing `./chat` pulled React, react-dom and sonner into the
      lip-sync worker.
    - product-ui moves to 0.13.0 once for this PR.
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
    `feat/voice-audio-tags`. Drafted at `0019e280`; fast-forwarded to
    `19919ded` (`origin/main`, 2026-10-14) before implementation. Plan and spec
    commit: `2337e064`.
  - Dependencies: `uv sync --frozen --python 3.12.13` with the documented extras,
    and `pnpm install --frozen-lockfile` in `src/frontend` (2026-10-14).
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

Depends on: nothing. Issue: #538.

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
   - **The cases:** each lists the chunks of one reply, and the expected
     output of each chunk:
     - the Gemini provider text;
     - the ElevenLabs provider text;
     - the tag-free text.

     Further sections hold direction classes and the tags found in sample
     texts. Every neutral alias is checked in both syntaxes by a loop over the
     vocabulary.
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
   - Add `packages/product-ui/src/lib/chat/audio-tags.ts`, exported as
     `@animama/product-ui/audio-tags` (P-D3). It holds:
     - the grammar from `tags.ts`, with the link exclusion;
     - `classifyAudioTag` and its word lists, moved out of
       `speech-timing-evidence.ts`;
     - `findAudioTags`, `audioTagClass`, `stripAudioTags` and `hideSpeechTags`
       (display);
     - `createProviderSpeechText(provider)`, which returns a per-run function
       that maps one chunk at a time and keeps the sound count across chunks.
   - `web/src/lib/lipsync/text/tags.ts` keeps its exports
     (`splitTags`, `stripTags`, `lipSyncTagKind`, `pausePriorSec`,
     `TAG_PRIOR_SEC`), built on the package module.
   - `speech-timing-evidence.ts` imports `classifyAudioTag` from the package.
     Its square-bracket timing parser is unchanged.
3. **Python.** Add `src/backend/animama/domain/audio_tags.py`, the same module in
   Python:
   - `find_audio_tags`, `strip_audio_tags` and `classify_audio_tag`;
   - `ProviderSpeechText(provider)`, a per-reply object whose
     `.prepare(segment) -> str` keeps the sound count;
   - `opens_with_delivery_tag(text)`.

   Docstrings name Cloud's server socket as a supported caller.
4. **Tests:**
   - `tests/test_audio_tags.py` and `web/tests/speech/audioTagCases.test.ts`
     (following the idle-playback precedent) both run the case file and assert
     that the vocabulary is equal.
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

#### Phase 1 implementation notes

- **Starting point:** `2337e064` (`19919ded` plus the spec and plan). The
  worktree needed `git lfs pull` before the web tests: `pcm-processor.worklet.js`
  was an LFS pointer.
- **Case file:** `tests/fixtures/audio-tag-cases.json` holds 21 reply cases,
  6 class cases and 6 tag-finding cases. Its word lists are sorted.
- **Python:** `regex` is used only where `\p{L}` is needed; the rest uses `re`.
  It trims JavaScript's `trim()` set, so both halves treat edge whitespace the
  same. `ProviderSpeechText` refuses providers that perform no tags.
- **`opens_with_delivery_tag`:** true when any direction of the leading tag is
  emotion or delivery, as in `[sad, laughs]`. Accent tags never count.
- **TypeScript:**
  - `web`'s `tags.ts` keeps its exports.
  - `stripTags` is now `stripAudioTags`.
  - `speech-timing-evidence.ts` re-exports `classifyAudioTag` and
    `AudioTagClass`, so its existing importers are unchanged.
- **Known limitation (P1-R1-F5):** a sound that is not in the word lists, such
  as `[dog barks]`, classes as delivery and escapes the sound cap on ElevenLabs.
  The prompt asks for at most two sounds; the cap is a backstop for the listed
  sounds.

#### Phase 1 results

Source: the working tree on `2337e064`, before the phase commit.

- **Python:**
  - `uv run pytest -q tests/test_audio_tags.py`: 120 passed;
  - `uv run mypy` on the module and test: clean;
  - `uv run ruff check` and `uv run ruff format --check src/backend/animama tests`:
    clean.
- **Frontend:**
  - `pnpm --dir src/frontend packages:build`, `packages:check` and
    `packages:test`: pass.
  - `web:check` and `web:lint`: pass.
  - Prettier check on the changed files: pass.
  - Vitest on `tests/speech/audioTagCases.test.ts`, `src/lib/lipsync`,
    `src/lib/speech` and `src/ui/debug`: 41 files, 539 tests passed.
  - `pnpm --dir src/frontend web:test`:
    - before the review fixes: 523 vitest files (4,749 tests passed, 1
      skipped) and 114 browser-script tests passed;
    - after them: 523 files (4,799 passed, 1 skipped), and every browser-script
      test passed (221).
- **Lip-sync:** `node scripts/lipsync.mjs eval --json` was run with the new
  grammar and with `main`'s `tags.ts` and `speech-timing-evidence.ts`. Every
  quality metric is identical; only `cpuMs` timing differs. The test set
  contains no Markdown links, so the link exclusion cannot affect it.
- **Race to avoid:** `packages:check` failed once because it ran in parallel
  with `web:check`, which rebuilds the packages. It passed when rerun alone.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of the working tree on
`2337e064`. Result: **blocked**, on two required findings.

- **P1-R1-F1 (required).** `audio_tags.py` `_tidy` returns `Any` from the
  untyped `regex`, which fails mypy (`make check-test`, CI `backend-types`).
- **P1-R1-F2 (required).** The cases never map `giggle` or `breath`. Only
  `<laugh>` is exercised in angle brackets, so a wrong alias or spelling would
  pass both suites.
- **P1-R1-F3 (recommended).** Importing the grammar from
  `@animama/product-ui/chat` pulls React, react-dom and sonner into the lip-sync
  worker: +33 KB in an esbuild bundle of the worker.
- **P1-R1-F4 (optional).** Python's `strip()` and JavaScript's `trim()` differ
  on U+0085, U+001C–U+001F and U+FEFF. A 24,000-input differential run found
  no other mismatch.
- **P1-R1-F5 (optional).** Sounds missing from the word lists class as delivery
  and escape the sound cap.
- **P1-R1-F6 (judgement).** `opens_with_delivery_tag("[sad, laughs] Oh.")` is
  false, so Phase 3 would add a tone tag before the model's own emotion.
- **P1-R1-F7 (nit).** The `hideSpeechTags` docstring says "the rest as written",
  but a segment with a tag is tidied.
- **P1-R1-F8 (record).** The plan's names (`splitAudioTags`), test path and case
  structure differ from the code.
- **P1-R1-F9 (nits).**
  - An orphaned comment in `tags.ts`.
  - `as_fixture` is a test-only serializer on a production dataclass.
  - `ProviderSpeechText` accepts any provider string.
  - The timing evidence works out the strongest class inline.

#### Code Review #1 Revisions

- **F1: accepted.** The ASCII patterns use the typed `re`; only `_TAG` and
  `_NOT_LETTER` use `regex`. mypy is clean.
- **F2: accepted.** Both suites loop over every neutral alias in `[…]` and
  `<…>` (Python also tries title case) and check both provider spellings:
  75 Python and 50 TypeScript cases.
- **F3: accepted.** The new `@animama/product-ui/audio-tags` entry is
  dependency-free; its built `dist/audio-tags.js` has no imports. P-D3 is
  revised.
- **F4: accepted.** Python trims JavaScript's `trim()` set. Checked:
  `'[laughs] Hi\ufeff'` → `'<laugh> Hi'`, and U+0085 is kept, as in
  TypeScript.
- **F5: rejected as a code change; recorded as a known limitation.** Widening
  the word lists is speculative, and the prompt is the primary control.
- **F6: accepted.** Any emotion or delivery direction in the leading tag
  counts. `[sad, laughs]` and `[laughs, whispering]` are now true; accents
  never count.
- **F7: accepted.** The docstring is reworded.
- **F8: accepted.** This plan is updated (names, entry, test path, case
  structure, Phase 4 step 5).
- **F9:**
  - orphaned comment: accepted, folded into the module comment;
  - `as_fixture`: accepted, moved to the test (`asdict`);
  - provider check: accepted, `ProviderSpeechText` raises `ValueError` for any
    other provider;
  - inline strongest class: rejected. The evidence needs each direction's class
    anyway, and `audioTagClass` would classify twice.

Repair budget: 2 rounds remain before this repair; round #1 is now used.

#### Code Review #2 Findings

Reviewer: `sdlc-reviewer`, a targeted recheck of the accepted findings and of
regressions the fixes could cause. Result: **pass**, with no blocking findings.

**Repairs confirmed:**

- F1: the full Makefile mypy scope is clean (839 files).
- F2: the alias loops cover every neutral spelling.
- F3: re-bundling the worker gives 907 KB against the 906 KB baseline, with no
  React, react-dom or sonner.
- F4: a 24,000-input differential run with exotic whitespace found 0 mismatches.
- F6: a "true" result always means the model's own direction reaches the voice.
- F7, F8 and F9: fixed.

**Non-blocking notes:**

- **P1-R2-N1.** An accepted square tag immediately followed by `(` re-scans as
  a Markdown link label, so lip-sync and the debug count would read it as words
  (for example `<sad softly>(aside)` → `[sad softly](aside)`). It is rare.
  **Taken into Phase 4:** put a space after an accepted square tag when `(`
  follows.
- **P1-R2-N2.** The TypeScript alias loop skips the title-case form that Python
  tests. The shared cases cover mixed case.
- **P1-R2-N3 (Phase 4 watch item).** Once bubbles import the grammar inside
  product-ui, check that `dist/audio-tags.js` still pulls in only a
  dependency-free chunk.

Repair budget: one round remains (round #2), unused.

### Phase 2: prompt rules

Requirements: T1 and T4 (prompt text).

Depends on: Phase 1, for the vocabulary names only. Issue: #539.

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

#### Phase 2 implementation notes

- **`app/chat/speech_tags.py`:**
  - `speech_tag_provider(tts)` names the tag-capable voice, Gemini or
    ElevenLabs. Phase 3 reuses it.
  - `speech_tags_instruction(tts)` returns one of three module constants.
  - Eleven v4 Turbo needs no model check: the chat options keep no other
    ElevenLabs id (`merge_chat_request_options`).
- **Prompt assembly:** `DirectChatPromptAssembler.assemble(...,
  speech_tags_guidance=...)` places the section after Response Guidance and
  before the conversation language. `_build_prompt` passes it on every build
  path (prepare, history replay, stale-cursor rebuild, Anthropic style).
- **Tests:**
  - new: `tests/test_speech_tags_prompt.py` and the executor test for each
    voice;
  - updated expectations: the executor's expected prefix, the gesture-eval
    expectation and the live cache harness (`tests/live/test_prompt_cache_layout.py`).
- **Agent prompt decision (P2-R1-F3; owner may revise):**
  - ElevenLabs directions last until the next one, so the prompt asks the model
    to "return to your reply's tone" after a whispered sentence.
  - It names no specific reset tag such as `[normal voice]`, which would drop
    the D3 tone.
  - G2 includes a whisper followed by more speech.
- **Docs:** `docs/backend/runtime/prompt-caching.md` (turn layout and volatility
  row).

#### Phase 2 results

Source: the working tree on `730b6a63`.

- **Full suite:** `uv run pytest -q` passed 4,337 tests with 29 skipped,
  before the review fixes. The reviewer reran it on the same source.
- **After the fixes:**
  - the speech-tags, executor, gesture-eval, layout and live-harness tests:
    167 passed, 3 skipped;
  - mypy (Makefile scope), `ruff check` and `ruff format --check`: clean.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of the working tree on
`730b6a63`. Result: **blocked**.

- **P2-R1-F1 (required).** The Gemini variant never limits whisper (uncapped,
  D2) to real shifts in mood.
- **P2-R1-F2 (required).** The ElevenLabs variant does not say where `[whispers]`
  goes (T2).
- **P2-R1-F3 (recommended).** The invented `[normal voice]` reset is untested and
  would drop the D3 tone.
- **P2-R1-F4 (recommended).** The ElevenLabs model-id check can never fail in
  production, because the normalizer drops other ids, so its test describes an
  unreachable branch. Hosted Cloud still speaks Flash v2.5.
- **P2-R1-F5 (recommended).** The prompt-caching row says "per installation",
  but the voice is per Anima, and any change of voice changes the rule.
- **P2-R1-F6 (recommended).** The live cache harness omits the rule that
  production always sends.
- **N1–N4 (optional).**
  - N1: test one non-English reply.
  - N2: keep the "already sets how the reply begins" wording in sync with D3.
  - N3: name laughs, sighs and gasps in the ElevenLabs sound note.
  - N4: record where the plan and the code differ.

#### Code Review #1 Revisions

- **F1 and F2: accepted.** One shared bullet in both variants: "[whispers] goes
  at the start of a sentence, only when your mood really shifts, and whispers
  that sentence." Tests assert it for both voices.
- **F3: accepted.** The reset now reads "return to your reply's tone with a
  direction for it". It is recorded as an agent prompt decision and added to
  G2.
- **F4: accepted.**
  - The model-id clause and its test row are gone; the code comment names the
    normalizer.
  - G3: the Cloud draft must say that Cloud speaks v4, or strips tags from its
    copy, before it adopts this change.
- **F5: accepted.** The row is "per Anima", and any change of voice changes the
  rule.
- **F6: accepted.** The harness passes `speech_tags_instruction(None)`.
- **N1: accepted.** Phase 5's live checks include one non-English reply.
- **N2: noted.**
- **N3: accepted.** The ElevenLabs note names laughs, sighs and gasps.
- **N4: recorded** in the implementation notes above.

Repair budget: round #1 used; one round remains.

#### Code Review #2 Findings

Reviewer: `sdlc-reviewer`, a targeted recheck. Result: **pass**.

- F1–F6, N1 and N3 are confirmed. 275 tests passed and 3 were skipped (the
  paid live tests); mypy, ruff and the import-boundary check are clean.
- **P2-R2-N1 (record).** The whisper-reset check belongs in the G2 gate text,
  not only in the agent-run checks. **Fixed:** added to G2.
- **P2-R2-N2 (record).** The Phase 5 Cloud bullet should give the v4 reason.
  **Fixed.**

Repair budget: one round remains, unused.

### Phase 3: backend speech, tone and readers

Requirements:

- T5 (Gemini provider text);
- T7 and D3 (computing and delivering the tone tag);
- T8 (backend segmenter);
- T6 (Reflection and search snippets);
- the Q3 proposal.

Depends on: Phase 1. Issue: #540.

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

#### Phase 3 implementation notes

Starting point: `dfbcbc46` (Phase 2).

- **Shared helpers** (both languages, in the shared case file):
  - `ends_inside_audio_tag` / `endsInsideAudioTag` tell whether text ends in
    an open candidate tag: the last `[` or `<`, followed by nothing or by a
    letter and grammar characters, at most 64 of them.
  - The provider text now puts a space between an accepted square tag and a
    following `(`, so it never reads as a link label (P1-R2-N1).
- **Segmenter:** `UserResponseSegmenter` skips a sentence end whose sentence so
  far ends inside an open tag.
- **Gemini:**
  - `FinalizedTtsSegmentBatcher(..., speech_text=ProviderSpeechText("gemini"))`
    prepares each batch in both modes. The cap is counted in batch order, and a
    batch left without letters or digits is skipped.
  - Segment `tts_text` stays the visible text without emoji. Mapping happens per
    batch, because paragraph mode re-joins the visible text.
- **Tone tag (P-D1, P-D2):**
  - `elevenlabs_tone_tag` shares `_tone_description` with
    `gemini_speaking_style`.
  - `SseTextState.speech_tone_tag_pending` is set in `stream.py` when
    `speech_tag_provider(tts) == "elevenlabs"`.
  - The first speech `user.response` frame carries `speech_tone_tag`, unless
    `opens_with_delivery_tag`.
  - The degree comes from the pre-turn stored state, as for Gemini.
- **Readers:**
  - `_reflection_text` strips tags from `speech` only.
  - `_search_row_to_domain` builds the snippet from speech without its tags,
    then display as written (`_snippet_source`; P3-R1-F2).
  - Matching is unchanged (Q3).
- **Golden file:** `CHAT_SSE_GOLDEN_RECORD=1` rewrote one line of
  `tests/fixtures/chat_sse_golden/tts-realtime.sse`: the new field on the first
  speech frame.

#### Phase 3 results

Source: the working tree on `dfbcbc46`.

- **Backend:**
  - `ruff check` and `ruff format --check src/backend/animama tests`: clean.
  - mypy (Makefile scope): clean (843 files).
  - `make audit-typed-content`: passed.
  - `uv run pytest -q`: 4,368 passed, 29 skipped before the review fixes, and
    4,447 passed, 29 skipped after them.
- **Frontend** (shared-case tests after the helper changes): vitest on
  `tests/speech/audioTagCases.test.ts`, `src/lib/lipsync` and `src/lib/speech`
  passed (37 files, 530 tests), after `packages:build`.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of the working tree on
`dfbcbc46`. Result: **blocked**.

- **P3-R1-F1 (required).** For a tag-only reply, `_reflection_text` fell back
  to the stored content, which is the raw reply JSON.
- **P3-R1-F2 (required).** Snippets stripped bracketed words from owner
  messages and from `display` too, not only from speech.
- **P3-R1-F3 (recommended).** The open-tag helper treated a bare `[` or `<` as
  outside a tag, so Phase 4's length and idle splits could cut there.
- **P3-R1-N1.** Three docstrings still said Gemini speaks the text as written.
- **P3-R1-N2.** A Gemini reply whose tags are all dropped ends with
  `tts.error missing_tts_text`.
- **P3-R1-N3.** `speech_text` could be required.
- **P3-R1-N4.** The speech-part check is computed twice.
- **P3-R1-N5 (by design).** An unclosed `[` or `<` followed by a letter holds
  sentence ends for up to 64 characters. In a 16-text baseline comparison, only
  three such texts changed. A 20,000-stream fuzz never split a valid tag.
- **P3-R1-N6.** Test gaps:
  - `?` inside a tag;
  - a span over 64 characters in the segmenter;
  - a check that every tone tag is a delivery direction.
- **P3-R1-N7.** Docs to update in Phase 5:
  - `docs/backend/runtime/chat.md` (`user.response` fields, the segmenter, the
    batch text, "no tone tag");
  - `docs/backend/integrations/voice-and-speech.md`;
  - `docs/frontend/runtime/chat.md`.
- **P3-R1-N8.** Cloud's own `chat:sse` will not carry `speech_tone_tag`, so the
  G3 draft must say how Cloud computes and applies it. The pipeline's "shared
  start" step overstates this.
- **P3-R1-N9.** The implementation note should say the helper accepts an
  opener with no words yet.

#### Code Review #1 Revisions

- **F1: accepted.** A structured reply returns its display, else its speech
  without tags, else `None`; callers already skip `None`. The test now expects
  `None`.
- **F2: accepted.** The search SQL also returns `structured_speech` and
  `structured_display`. `_snippet_source` strips tags from speech only, and keeps
  display and every other message as written. A speech-only, tag-only reply has
  an empty snippet. Tests cover both cases.
- **F3: accepted.** The content after the opener is optional in both halves.
  The fixture's `Well [` row now expects inside, and a `Well <` row is added.
- **N1: accepted.** The three docstrings are corrected.
- **N2: rejected as a code change; recorded as a known limitation.** It is rare
  (the prompt requires words), and the browser shows its usual speech notice.
- **N3: rejected.** The older batcher tests construct it without tag
  preparation; production always passes Gemini.
- **N4: accepted.** `is_speech` is computed once.
- **N5: accepted as designed.**
- **N6: accepted.** Added segmenter tests for `?` inside a tag and a span over
  64 characters, and a tone-tag check over every tone and level (delivery
  class, uncapped).
- **N7: deferred to Phase 5** (the docs list is already in its scope).
- **N8: accepted.**
  - The pipeline section is corrected.
  - The G3 draft (Phase 5) will say that Cloud computes the tag with
    `elevenlabs_tone_tag` from the hidden tone event and the pre-turn state,
    applies `opens_with_delivery_tag` to its collected text, and may emit the
    field for lip-sync parity.
- **N9: accepted.** The note is corrected.

Verification after repairs:

- targeted backend tests (tags, segmenter, tone tag, readers, chat SSE,
  golden, Gemini, Reflection, search): 422 passed;
- mypy (Makefile scope): clean;
- ruff: clean;
- `packages:build`, then vitest (`audioTagCases`, lip-sync, speech): 37 files,
  531 tests passed.

Repair budget: round #1 used; one round remains.

#### Code Review #2 Findings

Reviewer: `sdlc-reviewer`, a targeted recheck. Result: **pass**.

- F1–F3, N1, N4, N6, N8 and N9 are confirmed. The database-backed search and
  Reflection tests run the new SQL against Postgres: 48 passed, none skipped.
- 554 related backend tests passed; mypy, ruff and the import-boundary check
  are clean.
- The segmenter baseline comparison and the fuzz runs are unchanged, and
  Python and TypeScript still agree on 6,000 replies.
- **Non-blocking, not taken:** the search's `content` expression could become
  `m.content`. It is left unchanged, to keep the SQL diff minimal.
- **Non-blocking, fixed:** a wording nit in the plan's reader note.

Repair budget: one round remains, unused.

### Phase 4: browser speech and chat display

Requirements:

- T5 (ElevenLabs and browser-speech text);
- T7 (applying the tone tag);
- T8 (browser chunker);
- T6 (bubbles, failure notice, quick chat);
- the Q1 proposal;
- the debug tag count.

Depends on: Phases 1 and 3. Issue: #541.

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
   `findAudioTags(capture.text)`, next to the existing timing count.

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

#### Phase 4 implementation notes

Starting point: the Phase 3 commit.

- **Chunker** (`web/src/lib/speech/tts-chunker.ts`):
  - a sentence mark inside an open tag ends nothing;
  - length, idle and final splits back off to before the open tag's bracket;
  - a short buffer that ends inside an open tag keeps the tag in the remainder.
- **Playback** (`web/src/hooks/use-tts-playback.ts`):
  - ElevenLabs chunks go through a per-run `createProviderSpeechText("elevenlabs")`.
  - Browser speech gets `stripAudioTags`.
  - The run's state and its pending tone tag reset with the run, and on the
    Pocket fallback.
  - `appendToken(runId, token, { speechToneTag })` keeps the tag for the run's
    first ElevenLabs chunk, which it then leads.
  - Gemini's reported speech text uses Gemini's spellings. Lip-sync still plans
    from `part_text`; the report feeds the debug capture.
- **product-ui:**
  - `ChatSseUserResponse.speech_tone_tag` is passed through
    `appendTtsToken(..., { speechToneTag })` (`session-bindings.ts`).
  - Bubbles hide tags in four places: `getStructuredAssistantTexts` (completion
    rows), `structuredAssistantTexts` (reload), the live bubble's text and
    segments, and the failure notice's partial text.
  - A tag-only speech part shows no bubble (Q1).
  - Display is compared with the raw speech.
  - `dist/audio-tags.js` still imports only a shared chunk with no imports of
    its own (P1-R2-N3).
- **Debug:** `LipSyncDebugSection` adds a "Text" row with the tag count of the
  captured provider text (Gemini: its parts).
- **Tests:**
  - `tts-chunker.test.ts`, `use-tts-playback.test.tsx`,
    `structured-response-stream.test.ts`, `display-message-mapping.test.ts` and
    `LipSyncDebugSection.test.tsx`;
  - the product-ui lifecycle test (`tests/chat-lifecycle.test.mjs`), whose
    fixture now records `speechToneTag`.

#### Phase 4 results

Source: the working tree on `be9e4e43`. The changes are uncommitted.

- **Frontend checks:**
  - `pnpm --dir src/frontend check`, `web:lint` and `packages:check`: pass.
  - Prettier on the changed files: clean.
  - `packages:test`: pass, including the new tagged-reply lifecycle test.
  - `pnpm build`: pass.
- **Lip-sync:** `node scripts/lipsync.mjs eval`: quality identical to Phase 1
  (CPU column aside).
- **`pnpm --dir src/frontend web:test`:** in both full runs, 4,822 vitest tests
  passed and `src/i18n/LocaleSync.test.tsx` ("re-renders mounted text when the
  saved locale needs a catalog load") failed. Because vitest failed, the
  browser-script tests did not run. That test:
  - passes 3/3 alone;
  - waits a fixed ~200 ms for a catalog chunk;
  - passed in both of Phase 1's full runs;
  - is in code this branch does not touch.

  The second run overlapped a review agent's test runs. **Open:** rerun
  `web:test` on an idle machine. If it still fails, compare against `be9e4e43`
  before calling it a flake.
- **Idle rerun, after the review repairs:** `pnpm --dir src/frontend web:test`
  passed: 523 vitest files (4,829 passed, 1 skipped) and all 221 node and
  browser-script tests, LocaleSync included. The earlier failures were
  load-related.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of the uncommitted working tree
on `be9e4e43`. Result: **blocked**, on two required findings.

- **P4-R1-F1 (required).** A reloaded reply whose speech is only tags, with no
  display, shows the raw tags.
  - Cause: `structuredAssistantTexts` returns `[]`, so `mapServerMessagesForDisplay`
    falls back to `content`, which the history API sets to the speech.
  - Location: `display-message-mapping.ts:74-81, 106-130`.
  - Fix: fall back to `content` only for rows that are not structured, and add
    a test for display null.
- **P4-R1-F2 (required, rare).** Tag-only speech that is still streaming shows
  a loader bubble.
  - With Markdown off and a display part, the turn never finalises: no
    plain-text animation completes. The completion rows never reach the cache,
    and the display bubble disappears on the next submit.
  - Fix: drop the speech bubble once its hidden text is empty and it is final
    or display has started. Wait for the plain-text queue only when a visible
    speech segment exists.
- **P4-R1-F3 (optional).** An idle flush whose buffer starts with an open tag
  (opener at index 0) still cuts the tag. It affects raw token streams only:
  0 of 5,000 sentence-delivered replies were affected. Fix: return no idle
  chunk in that case.
- **P4-R1-F4 (optional).** The final flush splits a trailing unclosed `[` or
  `<` into its own chunk. It could be skipped when the input fits one chunk.
- **P4-R1-F5 (optional).** The failure notice compares display with the hidden
  speech; the other paths compare with the raw speech. Choose one rule; the
  visible speech avoids duplicate bubbles.
- **P4-R1-F6 (optional tests).** Missing tests:
  - the failure notice with tags;
  - reload of tag-only speech without display;
  - an idle flush with the opener at index 0.
- **P4-R1-F7 (optional hardening).** Check that `speech_tone_tag` is a string
  that is exactly one tag before prefixing it.
- **Notes:**
  - Chunk `wordCount` includes tag words (pre-existing).
  - `streamingSegments.map(...).filter(...)` creates a new array on every
    recompute, defeating a memo.
  - `docs/frontend/runtime/elevenlabs-tts.md:105` is stale (Phase 5).

Confirmed correct:

- the ElevenLabs cap across chunk kinds;
- the tone tag's consumption and resets;
- browser speech, Pocket and Gemini text;
- the debug count;
- chunker termination (a 20,000-stream fuzz);
- the additive `appendTtsToken` API;
- the dependency-free entry and package boundaries.

#### Code Review #1 Revisions

Adjudicated after the owner resumed the work (2026-10-14).

- **F1: accepted.**
  - `structuredAssistantTexts` returns `null` only for rows that are not
    structured, or whose structured speech and display are both empty. Only
    those fall back to `content`.
  - A tag-only speech now shows no bubble after a reload.
  - New test: reloaded speech of only tags, with display null.
- **F2: accepted.**
  - The live speech bubble is dropped when its hidden text is empty and the
    display has started.
  - Completion waits for the animation queue only when a visible streamed
    speech segment exists; otherwise the turn finalises at once.
  - New lifecycle test: Markdown off, `[laughs]` speech plus a display. The turn
    completes, with no loader and no `[laughs]`. The consumer fixture gained a
    `markdown` option.
- **F3: accepted.** An idle flush whose buffer starts with a tag still being
  written returns no chunk. Test added.
- **F4: accepted.** A final piece that fits one chunk is sent whole, with no
  back-off. Test added.
- **F5: accepted.**
  - One shared `replyBubbleTexts(speech, display)` (in
    `structured-response-stream.ts`) builds the bubbles for completion, reload
    and the failure notice.
  - The live bubble applies the same rule: display is compared with the visible
    speech.
  - Test added.
- **F6: accepted.** Added tests for the reload case and for an idle flush that
  opens with a tag, and a lifecycle test for a failed reply's tagged partial
  text. Quick chat reuses `displayMessages`, so it is covered by the same data.
- **F7: accepted.** `appendToken` accepts `speechToneTag` only when it is
  exactly one well-formed square tag. Test added.
- **Word-count note: accepted.** Chunk `wordCount` counts words without tags,
  so talking-hands ranges match lip-sync. Test added.
- **Memo note: accepted.** The visible streaming segments are memoised.

Verification after repairs:

- `packages:build`, then vitest (`src/lib/chat`, `src/lib/speech`,
  `use-tts-playback`, `src/ui/debug`, `tests/speech`): 46 files, 502 tests
  passed.
- product-ui `pnpm run test`: 43 passed.
- `pnpm --dir src/frontend check`, `web:lint` and `packages:check`: pass.
- Prettier on the changed files: clean.

Repair budget: round #1 used; one round remains.

#### Code Review #2 Findings

Reviewer: `sdlc-reviewer`, a targeted recheck. Result: **blocked**, on one
regression.

- **P4-R2-F1 (required, a regression from the F5 revision).** A display that
  copies the speech word for word, tags included, was no longer deduplicated,
  so the reply showed twice and the copy kept its raw tags.
- **Notes:**
  - a JSDoc comment was stranded in `use-tts-playback.ts`;
  - `completeRun`'s single final chunk still counted tag words;
  - an idle timer re-arms harmlessly while an open tag sits at index 0;
  - the lifecycle test's `[role="status"]` assertion could not see the plain
    loader.
- **Confirmed:** F1–F4, F6, F7, the word count in the chunker and the memo
  (fuzz runs: 0 splits in 5,000 token streams with idle flushes, and 20,000
  streams terminated).

#### Code Review #2 Revisions

- **P4-R2-F1: accepted.** `replyBubbleTexts` hides a display that equals either
  the raw or the visible speech; the live bubble applies the same rule. Test
  added.
- **Notes:**
  - JSDoc: fixed.
  - The final-chunk word count now strips tags.
  - The idle re-arm: no change, as it is harmless.
  - The lifecycle assertion that could not see the loader: removed. The
    `#finalizing` check covers the hang.

Verification:

- `packages:build`, then vitest (chat, speech, playback, quick chat, debug, tag
  cases): 47 files, 505 tests passed.
- product-ui tests: 43 passed.
- `pnpm --dir src/frontend check`, `packages:check` and `web:lint`: pass.

Repair budget: both repair rounds are now used. Review #3 is the final targeted
recheck.

#### Code Review #3 Findings

Reviewer: `sdlc-reviewer`, the final targeted recheck. Result: **blocked**.

- **P4-R2-F1:** fixed and confirmed.
- **The note fixes:** confirmed.
- **P4-R3-F1 (required, a regression from the round 2 fix).**
  - Trigger: speech of only tags (`[laughs]`) together with a display that
    copies it.
  - Both live bubbles are dropped (`useProductChatSession.ts:670, 682-686`), so
    the streamed list is empty.
  - A `memory.updated` cue arriving mid-stream then reads `last.isPending` on
    `undefined` (`:692-693`) and crashes the chat render.
  - It needs the model to break two prompt rules, plus a memory update in the
    same turn.
  - Implementer verification: confirmed by reading the code.
  - Fix: guard `last`, and push the run only when `streamed` is non-empty.

The repair budget is exhausted, so the phase stops: **escalated to the owner**
(2026-10-14).

#### Owner decision on P4-R3-F1 (2026-10-14)

The owner chose "fix, no extra recheck": the waiver covers this one change, and
the final integration review still covers it.

- **Fix:** `const last = streamed.at(-1); if (last && streamingMemoryCue &&
  !last.isPending)`.
- **New lifecycle test:** a memory cue during a reply that shows no bubble does
  not break the chat. It records no page errors and the turn finalises.
- **Red check:** without the guard the test fails (0 passed, 1 failed); with it,
  it passes.
- **Verification:**
  - product-ui tests: 44 passed;
  - `pnpm --dir src/frontend check`, `packages:check` and `web:lint`: pass;
  - vitest (chat, speech, playback, quick chat, debug, tag cases): 47 files,
    505 tests passed;
  - Prettier: clean.

### Phase 5: docs, dead prompt code, live checks, full validation and the G2 pack

Issue: #542. Depends on: Phases 1–4.

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
   - a dependency on the unfiled Eleven v4 Turbo hand-off. Cloud must speak v4,
     or strip tags from its copy of the text, before it adopts this change,
     because every hosted ElevenLabs turn gets the tag rule (P2-R1-F4).
4. **Live checks (G1),** on the `tags` stack:
   - one tagged reply each on Gemini and on Eleven v4 Turbo;
   - for each, check the debug panel's provider text and tag counts and the
     bubbles before and after a reload;
   - one browser-speech reply, checking that tags are not spoken;
   - one non-English reply with a tag (the tag must stay in English);
   - one ElevenLabs whisper followed by more speech (the voice returns to the
     reply's tone);
   - record cost.
5. **Full validation:**
   - `uv run pytest -q`, `uv run ruff check`, `make check-test`;
   - the frontend commands from Phase 4;
   - `pnpm --dir src/frontend desktop:check`;
   - `pnpm e2e:test:fast` on a disposable built stack.
6. **G2 pack:** the prompts for the owner to try on each voice (the spec's
   listening list), what to listen and look for, and where to look in the debug
   panel.

#### Phase 5 implementation notes

Starting point: `162be4e5` (Phase 4).

- **Dead prompt code** (owner decision, 2026-10-14):
  - deleted `prompts/profiles.py`;
  - deleted `build_main_structured_output_schema` and its `__all__` entry;
  - deleted the test that only exercised that function;
  - `docs/frontend/runtime/avatar-emotion.md` now points at
    `main_structured_response.py`.
- **Source review:** `licenses/source-review.json` drops `profiles.py` and adds
  the 13 files new on this branch, following the lip-sync precedent.
- **Docs:**
  - backend `integrations/voice-and-speech.md`, with a new "Audio tags"
    section, and `runtime/chat.md`;
  - frontend `elevenlabs-tts.md`, `gemini-tts.md`, `voice.md`, `chat.md` and
    `avatar-lipsync.md`;
  - `GLOSSARY.md`: a new **Audio tag** entry.
- **Cloud draft:** [cloud-issue-draft.md](cloud-issue-draft.md), an addition to
  raymond-van/animama-cloud#100. It is not posted (G3).
- **Dead-code check:** before deleting, a search of `src`, `tests`, `scripts` and
  `docs` found no importer of `PROFILE_TEMPLATES`, `prompts.profiles` or
  `build_main_structured_output_schema`. Cloud's services and tests use none of
  them; only its tenant inventory lists `profiles.py`.
- **`contracts/hosted-web.md`:** no change needed. It lists no `user.response`
  fields, and the new `speech_tone_tag` is optional.

#### Phase 5 live checks (G1)

Run on 2026-10-14 against the `tags` stack (`./reset.sh --name tags
--base-port 8480`, development build, debug panel on) through `chat:sse`, with
`reasoning_effort: none` and memory updates off.

| Check | Result |
| --- | --- |
| Gemini, `Oh my gosh, [laughs] that is so funny! [applause] [sighs] Anyway.` | Pass. Speech frames keep the written tags. `part_text`: `Oh my gosh, <laugh> that is so funny!`, then `<sigh> Anyway.`; `[applause]` dropped. 32 audio frames, `tts.done`, no tone tag. |
| ElevenLabs, an excited reply with `[laughs]` and `[applause]` | Pass. `tts.session` names `eleven_v4_turbo`. The first speech frame carries `speech_tone_tag: [slightly excited]` (the degree comes from the stored state); later frames carry none. |
| ElevenLabs, a reply that opens with `[whispers]` | Pass. No `speech_tone_tag`. |
| Gemini, Japanese (`ui_locale: ja`), with a tag invited | Pass. The speech is Japanese plus `[chuckles]`, in English; `part_text` is `<chuckle>`. Without the invitation, the reply laughed in words and used no tag. |

Cost:

- Gemini TTS, by check: about 65 characters (first check, 2 requests), about 15
  and 20 characters (the Japanese checks). In total about 100 characters with
  flash-lite, well under US$0.01.
- No ElevenLabs audio was generated: the two minted session tokens were never
  used.
- Six short chat-model turns were run but not priced here.
- The total stays within the US$0.50 budget.

Not run by the agent; left to G2:

- ElevenLabs audio in the browser;
- browser speech;
- bubble and debug-panel checks in the browser.

The fresh stack's first-run setup ends at the app's 18+ confirmation, an
attestation left for the owner. The `tags` stack is kept running for G2.

#### G2 owner pack

Use the kept `tags` stack (`http://animama-tags.localhost:8480`, debug panel
on), or any stack built from this branch.

1. **Finish first-run setup.** Choose OpenAI (server key) and ElevenLabs, and
   confirm the 18+ prompt.
2. **Eleven v4 Turbo.** Settings → Voice: choose ElevenLabs and send each of
   these.
   - `Please say exactly this, nothing else: Oh my gosh, [laughs] that is so funny! [sighs] Anyway.`
     A laugh and a sigh are performed and never read. The bubble shows
     "Oh my gosh, that is so funny! Anyway."
   - `Say exactly this, nothing else: Hmm. [long pause] Okay, [whispers] here is a secret. [excited] Now tell everyone!`
     A pause, then a whisper for that sentence, then an excited shift.
   - `Say exactly this, nothing else: Knock knock. [door knocks] Who's there?`
     A sound effect.
   - `Whisper a secret to me, then tell me how your day went.` The voice
     whispers one sentence, then returns to the reply's tone (the Phase 2 reset
     rule).
   - `I just won the lottery!` The reply starts in an excited delivery, from
     the automatic tone tag.
   - Reload the chat. No bubble shows a tag.
3. **Gemini.** Choose Gemini and repeat the first two lines of step 2.
   Extras such as `[excited]` and `[door knocks]` are silently dropped.
4. **Browser speech** (web only) **or Pocket TTS.** Repeat the first line. No
   tag is spoken.
5. **Debug panel → Lip-sync.** On a tagged reply, "Text" counts the tags the
   voice received, and the mouth rests during the sound effect.

Report anything heard as a word, any visible tag, or a whisper that runs past
its sentence.

#### Phase 5 results

Source: the working tree on `162be4e5`.

- **Backend:** `make check-test`: typed-content audit, format, lint and mypy
  (842 files) clean; pytest 4,446 passed, 29 skipped.
- **Import boundary:** 0 forbidden edges.
- **Browser journeys:** `pnpm e2e:test:fast` on a disposable built stack (`tags-e2e`,
  `ANIMAMA_LLM_SKIP=1`, production build): 38 passed in 8.2 minutes. The stack
  and its record were removed afterwards.
- **Frontend:** `pnpm --dir src/frontend desktop:check` and `prettier:check`:
  pass.
- The final frontend suite and build run in the final integration step.

#### Code Review #1 Findings

Reviewer: `sdlc-reviewer`, full initial review of the working tree on
`162be4e5`. Result: **blocked**, on two doc findings.

- **P5-R1-F1 (required).** `docs/backend/architecture/data-model.md` and
  `http-api.md` still said snippets use the same text as the search index.
- **P5-R1-F2 (required).** The G2 pack had no free-form whisper case to
  exercise the Phase 2 reset rule.
- **N1–N3 (Cloud draft).**
  - "Pre-v4 models read tags aloud" is inaccurate: v3 performs tags.
  - Name the two new modules for Cloud's inventory.
  - Name where the stored emotional state comes from.
  - Prepare the text before `reserve_graph`.
- **N4–N7 (frontend doc wording):**
  - the bubble rules in `chat.md`;
  - the `speech_tone_tag` pass-through;
  - the debug "Text" source;
  - the tag-safe chunking note in `voice.md`.
- **N8 (out of scope).** `prompts/structured_output.py` and
  `is_main_structured_output_schema` look unused too, but predate this branch.
- **N9 (plan record).** "Resume here" was stale; the Phase 5 progress, the
  dead-code check, the `hosted-web` note and the per-check cost detail were
  missing.
- **N10 (hygiene).** Keep `.animama-stack-e2e.env` out of the commit. Commit the
  Cloud draft with its inventory entry.

#### Code Review #1 Revisions

- **F1: accepted.** Both architecture docs now say snippets hide the speech's
  audio tags and matching uses the stored speech.
- **F2: accepted.** The G2 pack adds "Whisper a secret to me, then tell me how
  your day went." The G2 gate text already lists the check.
- **N1–N3: accepted** in the Cloud draft.
- **N4–N7: accepted.**
- **N8: noted as a possible follow-up,** outside the owner's deletion scope.
- **N9: accepted.** This record is updated.
- **N10: done.** The e2e record was deleted with its stack, and the draft is
  committed together with the inventory.

These are doc-only revisions. Repair round #1 is used; a targeted recheck is
folded into the final integration review.

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
