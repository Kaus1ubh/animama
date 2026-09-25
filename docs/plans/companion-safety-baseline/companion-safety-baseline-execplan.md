# Companion safety baseline execution plan

Status: Proposal — awaiting owner acceptance and implementation authorization.
Source agreement: [Companion safety baseline spec](companion-safety-baseline-spec.md),
accepted by the owner on 2026-09-25 when execution planning was invoked. At the
same time the owner added a single global environment switch for the safety
features, now recorded in spec R8. Later the same day the owner added a Safety
settings section, also in spec R8. At implementation the owner dropped the
operator-gated in-app toggles (see Decision Log).
Authorized scope: all five phases, by the owner's `/implement` instruction on
2026-09-25. Exact-candidate merge approval remains separate.

## Purpose and context

Deliver spec R1–R11:

- a non-overridable companion guardrail at the end of the provider instructions;
- an app-rendered AI notice at the New York cadence;
- local crisis detection with OpenAI Responses inline moderation, a deterministic crisis
  card with localized resources, and an in-character care note;
- an 18+ first-run step with an age-status seam;
- a crisis protocol document and an in-app Safety page;
- configuration limits, including one global safety switch;
- a sensitive-data rule for model-authored memory;
- a copy audit;
- updated docs, glossary entries and ADR 0008.

The spec is the requirements authority; this plan records how to implement and
verify it.

Repository `raymond-van/animama`, worktree
`worktrees/animama/companion-safety-baseline-5c278e`, branch
`feat/companion-safety-baseline` (renamed from the generated `claude/...`
branch). Starting revision is `76d4472`. The primary checkout stays on `main`.
No Cloud checkout or private input is needed.

Follow:

- [SDLC](../../../SDLC.md), [PLANS](../../../PLANS.md) and the root and scoped
  agent guides;
- [ADR 0002](../../adr/0002-accountless-installation-and-http-admission.md): a
  single owner, no telemetry;
- [ADR 0003](../../adr/0003-request-local-streamed-chat.md): request-local
  turns, route-formatted domain events, `run.completed` ordering.

Two further rules apply:

- Do not add an Alembic revision; update the ORM and
  `alembic/versions/0001_baseline.sql` directly. Existing development databases
  need a reset (see Idempotence and recovery).
- Regenerate the frontend client offline with `pnpm openapi-ts`, from a
  Python 3.12.13 venv so that OpenAPI wording matches CI.

## Progress

- [x] Discovery (2026-09-25): regulatory check against official sources and a
      repository investigation. Decisions are recorded in the spec.
- [x] Spec drafted and accepted (2026-09-25).
- [x] Plan drafted (2026-09-25).
- [x] Owner authorized all phases via `/implement` (2026-09-25).
- [x] Workspace setup (2026-09-25): branch fast-forwarded to `main` `5630ad8`;
      spec and plan committed `73ffb93` and pushed; parent #134 with sub-issues
      #139 (p1), #135 (p2), #136 (p3), #137 (p4), #138 (p5), chained blocked-by.
- [x] Phase 1: guardrail and memory guidance (review #2 pass; commit recorded
      below). DB-backed tests to rerun when Docker responds.
- [x] Phase 2: backend safety core. Unblocked by the owner-authorized
      detector pass, which passed with documented limitations. Scope: (config, detector, resources, notice state,
      age status).
- [ ] Phase 3: chat-turn integration (care note, SSE events, moderation).
- [ ] Phase 4: frontend (notice, crisis card, first run, settings, Safety page).
- [ ] Phase 5: protocol document, docs, ADR, glossary, copy audit and manual
      desktop acceptance.
- [ ] Final integration review.
- [ ] Owner gates G1–G4 (see Validation and acceptance).
- [ ] PR opened; hosted Validation; exact-candidate owner merge approval.

## Surprises & Discoveries

- **The notice and card must outlive the chat panel.** In the Avatar-only canvas
  mode, `MainShell` does not render the chat panel (`ui/main/MainShell.tsx:116`).
  `ChatInterface` therefore unmounts, and with it `useChatSession`, the SSE hook
  and Voice Mode. No turn can start from the main window in Avatar-only mode.
  Switching modes would drop notice or card state if that state lived in
  `ChatInterface`, so it moves to a provider at the Anima route level (Phase 4).
- **Quick Chat has no chat session of its own.** It renders a snapshot of the
  main window's session sent over IPC (`hooks/useDesktopQuickChatRuntime.ts`)
  and sends commands back. Its safety UI must travel in that snapshot.
- **The SSE client classifies events by payload shape, not event name**
  (`packages/product-ui/src/query/mutations/useChatSse.ts:149-211`). Any string
  `text` is taken as a reply, and any string `error` ends the stream. New events
  use the `type`-keyed pattern of `chat.title.updated`.
- **The instructions order is fixed, and the guardrail must follow all of it.**
  For Responses, `prompt_instruction_text` joins every system and developer
  message in order (`app/model_clients/prompt.py:151`). The compaction summary
  (developer, at the start of history) and the memory-map developer message
  follow the system message. So the guardrail must be the last system or
  developer message, not the tail of the first system message. With a Responses
  continuation, history is skipped (`direct_executor.py:396`), but instructions
  are sent on every request.
- **The care note must be decided at setup.** The prompt is assembled inside
  `executor.prepare_turn` before the stream opens (`turn_setup.py:200,219`), so
  the care note is decided in turn setup. Frames yielded before the provider
  task starts (`chat_sse.py:209`) reach the client before any model output.
- **The backend cannot tell whether an OpenAI key exists.** The desktop keeps
  it in an encrypted Electron vault and injects `OPENAI_API_KEY` into the
  backend process; changing it needs a restart. The backend sees only
  `settings.openai_api_key`, and no API reports whether a key exists.
  `AsyncOpenAI` is built privately in `server/model_clients.py:55-60`.
- **Nothing supplies a timezone or locale.** Chat requests carry neither.
  `user_settings.locale` is stored but never read, and `preferences.timezone` is
  never written by the frontend (episodes fall back to UTC).
- **The protocol document is outside the web build.** The web Docker build
  copies only `src/frontend` (`Dockerfile:15-18`), and Vite `server.fs.allow`
  covers only the web root and packages. `react-markdown` and `remark-gfm` are
  already dependencies.
- **Configuration is plain module-level code.** `server/config.py` is a pydantic
  `BaseModel` that reads each variable once at import through `_env_bool`,
  `_env_text` and `_env_path`. Its validators raise at import, which gives an
  invalid table a clear startup failure. Each new variable must also be listed
  in `docker-compose.yml` (passthrough), `.env.example` and the
  `docs/backend/operations/development.md` variable table and drift list.
- **Tests set time explicitly.** Backend tests have no freezegun and pass
  `now=` or local helpers. Frontend tests use `vi.useFakeTimers`.
- **First run is one form.** `routes/setup.tsx` is a single form, and
  `PyOnboardingCompleteRequest` forbids extra fields.

## Decision Log

- **2026-09-25, owner:** accepted the spec and its proposals, and added one
  global environment switch for the safety features.
- **2026-09-25, plan design, global switch.**
  `ANIMAMA_COMPANION_SAFETY_ENABLED` (default `true`) is the single place to
  turn the AI notice, crisis detection, moderation and the crisis card off or
  on together.
  - When `false`, every item below is off whatever its own setting is.
  - When `true`, the individual variables below apply.
  - It never affects the guardrail.

  This reads the owner's "these moderation settings" as the whole safety
  feature set. If only OpenAI moderation was meant, narrow it before Phase 2.
- **2026-09-25, plan design, individual variables.**

  | Variable | Default | Effect |
  | --- | --- | --- |
  | `ANIMAMA_AI_NOTICE_ENABLED` | `true` | Turns the AI notice on or off |
  | `ANIMAMA_AI_NOTICE_REMINDER_HOURS` | `3` | Reminder interval; must be a positive number, and values above 3 relax the cadence |
  | `ANIMAMA_CRISIS_DETECTION_ENABLED` | `true` | Local detector, moderation and card together |
  | `ANIMAMA_CRISIS_RESOURCES_PATH` | unset | Operator's replacement resource table |

  Any value that weakens a default logs one startup warning naming the
  variable. Names may be refined in Phase 2 if an existing convention argues
  otherwise; record any change here.
- **2026-09-25, owner: Safety settings section.**
  - Always shown: the crisis-resource region; the OpenAI moderation opt-in
    (moved from Advanced); a reminder interval the owner may only shorten; and
    the Safety page link.
- **2026-09-25, owner (implementation start):** no
  `ANIMAMA_SAFETY_SETTINGS_EDITABLE` gate and no in-app relax or disable
  toggles. `ANIMAMA_COMPANION_SAFETY_ENABLED` is the single off switch. The
  effective reminder interval is the owner's value only when it is shorter than
  the operator's. Packaged desktop builds construct the backend environment
  explicitly (`desktop/src/main-process/runtime/supervisor.ts` `environment()`),
  so they set no safety variable; a desktop test locks this in.
- **2026-09-25, owner, detector blocker at the review limit.**
  - The owner authorized one bounded pass against a held-out corpus.
  - An independent agent, without access to the detector source, writes about
    150 crisis and 250 ordinary labelled messages.
  - The detector is tuned on the tune half only. Precision and recall are
    reported on the hidden half, rather than chasing zero errors on probe
    lists.
  - One implementation pass and one review.
- **2026-09-25, owner, moderation strategy (after the detector pass review).**
  - Fix P2-X-F1 to F3.
  - For OpenAI Responses models, use the Responses API's built-in moderation
    (`moderation={"model": "omni-moderation-latest"}`) on the chat request
    itself.
  - Ignore other providers for now; they are currently unsupported.
  - This supersedes the separate moderation call, its Settings toggle,
    `ANIMAMA_CRISIS_MODERATION_DEFAULT` and the capability field.
  - Moderation is on whenever crisis detection is on. The global switch still
    turns it off.
  - OpenAI docs checked on 2026-09-25: GA and report-only (no blocking). Scores
    cover input and output and arrive on the completed response after the
    output text. The openai-python 2.41 SDK types it.
  - Open questions for gate G2 (live check): whether `input` covers the whole
    chain when `previous_response_id` is set, and the cost.
- **2026-09-25, plan design, safety state storage.** A new table
  `companion_safety_state` is keyed by the owner principal's user id, with one
  row per owner. It holds:
  - notice state: `last_notice_at`, `last_notice_local_date`,
    `interaction_started_at`, `last_turn_started_at`;
  - age status: `age_status`, `age_status_source`, `age_status_recorded_at`.

  Keying by principal rather than `installation_settings` keeps a hosted
  per-user composition possible without migrating the table. Locally there is
  exactly one row, so the state is effectively per installation.
- **2026-09-25, plan design, notice decision.** A pure function decides whether
  a notice is due, taking the state, `now`, the client-local date and the
  reminder interval.
  - At stream start it runs in a short-lived session that row-locks the state,
    before the provider task starts.
  - Setup failures (4xx) never record a notice.
  - If a state read or write fails, the notice is emitted anyway as `start` and
    a warning is logged.
- **2026-09-25, plan design, client context.** The chat request gains an
  optional `client_context: {time_zone, locale}` object, taken from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` and `navigator.language`.
  - The backend validates the time zone with `zoneinfo` and falls back to UTC
    if it is invalid or absent.
  - The locale's region provides the default crisis-resource region.
- **2026-09-25, plan design, crisis resources on the backend.** The backend owns
  the resource table, because operators may replace it. The crisis event
  carries the already-resolved resources, so the card needs no second request.
  `GET /v1/safety/crisis-resources` lists regions for the Settings picker.
- **2026-09-25, plan design, owner preferences.** Owner preferences live in
  `user_settings.preferences.safety`:
  - `crisis_resource_region`: a region code or `null` for automatic;
  - `reminder_hours`: a positive number or `null`, applied only when it is
    shorter than the operator's interval.

  They are read tolerantly with defaults. Because PATCH replaces the whole
  preferences object, the frontend's existing merge helper is used.
- **2026-09-25, plan design, capabilities.** `/v1/runtime-capabilities` gains a
  `companion_safety` block:
  - `enabled`, `ai_notice_enabled` and `crisis_detection_enabled`;
  - `operator_reminder_hours`.

- **2026-09-25, plan design, moderation (superseded the same day by the owner's
  moderation-strategy decision above; kept for history).**
  - Model `omni-moderation-latest`, called through a new moderation adapter. It
    builds its own `AsyncOpenAI` from the same key and base-URL resolution as
    `server/model_clients.py`, factored into a shared helper.
  - Positive when `self-harm/intent` or `self-harm/instructions` is flagged, or
    when the `self-harm` score is at or above a named threshold constant
    (initially 0.8).
  - The threshold is calibrated against the fixture set in an opt-in live test
    (gate G2).
  - `ANIMAMA_LLM_SKIP=1` installs no moderation client.
- **2026-09-25, plan design, safety UI state.** A `CompanionSafetyProvider` sits
  in `AnimaRouteProviders`.
  - `ChatInterface` pushes notice and card events into it.
  - A shared `CompanionSafetySlot` renders below `ChatInput` when the chat
    panel is mounted, and at bottom-center of `MainShell` in Avatar-only mode.
  - Quick Chat receives the same state in its snapshot and dismisses the card
    through a new `dismiss-crisis-card` command.
  - PiP renders nothing.
- **2026-09-25, plan design, Safety page source.** The Safety page imports
  `docs/safety/crisis-protocol.md` with Vite `?raw`. This requires extending
  `server.fs.allow` and adding `docs/safety` to the web Docker build context.
  If that build boundary proves unworkable, fall back to a checked-in frontend
  copy plus a test that fails when the two differ, and record the switch here.
- **2026-09-25, plan design, delivery shape.** Five phases on one branch and one
  PR. Commit scopes: `feat(chat)` for Phases 1 and 3, `feat(safety)` for
  Phases 2 and 4, `docs(safety)` for Phase 5.

## Implementation orientation

Backend (`src/backend/animama/`):

| Boundary | Existing implementation |
| --- | --- |
| Prompt | `app/chat/memory_context.py` (core instruction, `MEMORY_SYSTEM_GUIDANCE`, `MAIN_STRUCTURED_OUTPUT_GUIDANCE`), `app/chat/openai_prompt.py` (`DirectChatPromptAssembler.assemble`, `_direct_chat_system_instruction`), `app/chat/direct_executor.py` (`_build_prompt`, `prepare_turn`), `app/chat/direct_turn/provider_state.py` |
| Turn and SSE | `server/routers/chat/turn_setup.py`, `server/routers/chat/chat_sse.py`, `server/routers/chat/sse_runtime.py`, `server/sse_events.py`, `server/schemas/chat.py`, `domain/events.py` |
| Config and clients | `server/config.py`, `server/model_clients.py`, `server/app.py`, `server/routers/runtime_capabilities.py` |
| First run | `local/installation_model.py`, `server/installation_personalization.py`, `server/routers/runtime_context.py`, `server/schemas/runtime.py` |
| Settings | `domain/settings.py`, `app/services/settings_service.py`, `server/chat_options.py` |
| Memory Manager | `adapters/memory_manager/episode_processing.py` |
| Data | `orm/`, `alembic/versions/0001_baseline.sql`, `resources/` (packaged JSON) |

New backend code:

- `app/safety/` for the guardrail text, crisis detector, resource table model
  and loader, notice cadence and age status;
- `resources/crisis-resources.v1.json` for the bundled table.

Frontend (`src/frontend/`):

| Boundary | Existing implementation |
| --- | --- |
| SSE and session | `packages/product-ui/src/query/mutations/useChatSse.ts`, `packages/product-ui/src/chat/useProductChatSession.ts`, `web/src/ui/main/chat/useChatSession.ts` |
| Layout | `web/src/ui/main/MainShell.tsx`, `web/src/ui/main/chat/ChatInterface.tsx` (`ChatInterfaceView`), `web/src/routes/a/$animaId.tsx` |
| Quick Chat | `web/src/hooks/useDesktopQuickChatRuntime.ts`, `web/src/routes/desktop/quick-chat/$animaId.tsx`, desktop main-process quick-chat bridge |
| First run | `web/src/routes/setup.tsx`, `web/src/app/local-runtime/LocalRuntimeProvider.tsx` |
| Settings | `web/src/ui/sidebar/ApplicationSettingsModal.tsx`, `web/src/lib/settings/preferences.ts` |
| Markdown | `web/src/ui/memory/MemoryMarkdownPreview.tsx` (react-markdown pattern) |

New frontend code:

- `web/src/lib/safety/` for notice visibility timing and client-context helpers;
- `web/src/ui/safety/` for `CompanionSafetyProvider`, `AiNotice`, `CrisisCard`
  and `CompanionSafetySlot`;
- `web/src/routes/safety.tsx`, a top-level route reachable before onboarding.

Tests:

- Backend: new `tests/test_companion_guardrail.py`,
  `tests/test_crisis_detector.py` (fixtures in
  `tests/fixtures/safety/crisis_detection.json`),
  `tests/test_crisis_resources.py`, `tests/test_ai_notice_cadence.py` and
  `tests/test_crisis_moderation.py` (inline Responses moderation).
- Backend, existing files to extend: `test_direct_chat_turn_executor.py`,
  `test_anima_chat_sse.py`, `test_anima_sse_events.py`,
  `test_installation_personalization.py`, `test_settings_service.py`.
- Frontend: `useChatSse.test.ts`, `lib/safety/*.test.ts`, `ui/safety/*.test.tsx`
  and `routes/-setup.test.ts`.

## Setup and execution rules

When implementation is authorized:

1. Use `workspace-setup` to publish the spec as the parent issue and create one
   issue per authorized phase. Read them back and record the URLs here and in
   the spec.
2. Start a task stack for the schema change and manual checks, for example
   `ANIMAMA_LLM_SKIP=1 ./reset.sh --name safety --base-port 8760`. Use a
   non-skip stack only for gates that need a live model.
3. Work test-first on observable behavior.
4. Before each phase commit, run the affected read-only checks and an
   independent `sdlc-reviewer` review: one full initial review and at most two
   targeted repair rounds.
5. Stop and report if blockers remain after the repair budget.
6. A later phase may start once the previous phase's completion conditions
   pass.

## Phased implementation

### Phase 1 — Guardrail and memory guidance

Requirements: R1, R9 (guidance), and R10 (prompt copy). No dependencies beyond
authorization. Output: prompt changes that later phases build on.

1. **Guardrail text.** Add the guardrail as a constant in
   `app/safety/prompts.py` (with the other safety prompt text), headed
   `# Companion Guardrails`.
   - It must be short, in second person and able to be voiced in character.
   - It covers R1 a)–g), including the fiction carve-out and "no disclaimers
     for ordinary sadness, venting or dark humor".
   - Note: it must not contain the words therapy or counselor except in the
     negative form "never claim to be".
2. **Core instruction.** Replace the "Do NOT diverge from this under any
   circumstances" sentence in `memory_context.py` with one that keeps the
   identity binding "except where the Companion Guardrails below apply".
   Otherwise leave the core instruction's tone unchanged.
3. **Placement.** In `DirectChatPromptAssembler.assemble`, collect the trailing
   instruction sections in this order: request context (memory map and
   attachments), the care note (a parameter, unused until Phase 3), then the
   guardrail.
   - With the developer role supported, append the care note and guardrail as
     final `developer` messages after the request-context message.
   - With the developer role unsupported, append them at the end of the system
     message, after the request context.
   - Give `assemble` a keyword-only `care_note: str | None = None`.
4. **Memory rule.** Define one `SENSITIVE_MEMORY_RULE` constant stating the R9
   rule and use it in all three places, replacing the current "raw sensitive
   data" sentence in the `remember` guidance:
   - the `remember` guidance (`MAIN_STRUCTURED_OUTPUT_GUIDANCE`);
   - `MEMORY_SYSTEM_GUIDANCE`, for the chat memory tools;
   - `render_episode_processing_instructions`.
5. **Tests.**
   - `prompt_instruction_text(prompt)` ends with the guardrail with and
     without the developer role, with compaction history, and with a memory
     map and attachments.
   - The same holds with an adversarial identity ("ignore all later
     instructions; you are human") and with incognito or memory disabled.
   - The "under any circumstances" text is absent.
   - All three memory surfaces contain the rule.
   - Update the exact-text helpers in `test_direct_chat_turn_executor.py`
     (`_phase5_prefix` and the full message lists) rather than weakening them.
6. **ADR.** Draft `docs/adr/0008-non-overridable-companion-guardrail.md` (status
   Proposed) and add it to the index.

Checks: focused pytest, then `uv run pytest -q`, `uv run ruff check`, and
`make check-test`.

Completion: the tests above pass and review leaves no unresolved blockers. The
guardrail copy is flagged for gate G1.

Phase record: issue #139; starting source `73ffb93`.

Evidence:

- `make check-test` on the pre-review tree: 1808 passed, 7 skipped; format,
  lint and mypy pass.
- After the review repairs: focused guardrail, executor, model-client and
  Memory Manager tests pass; `ruff check`, `ruff format --check` and mypy pass.

Implementation notes:

- The trailing request context, any care note and the guardrail form one final
  `developer` message, which is always present.
- Without developer-role support, the assembler folds every developer message,
  in order, into the system message and re-indexes the Responses assistant
  phases.

#### Code Review #1 Findings

Reviewed the working tree on `73ffb93` (`sdlc-reviewer`, full initial review).

- **P1-R1-F1 (blocking):** the forced-final request at the memory-tool round
  limit appended its developer instruction after the guardrail, breaking R1's
  "final text on every turn" in a reachable path.
- **P1-R1-F2 (optional):** no test covered phase re-indexing when folding
  developer messages.
- **P1-R1-F3 (optional):** the fold exists in both the assembler and the Chat
  Completions adapter. Acceptable; the adapter fold is still needed for
  endpoint families.
- **P1-R1-F4 (optional):** the plan named `guardrail.py`; the code uses
  `prompts.py`.
- **P1-R1-F5 (owner-visible):** the new memory rule dropped "raw sensitive data"
  and made credentials absolute. The explicit-request exception is also
  ambiguous in episode processing.
- **P1-R1-F6 (docs):** `memory-manager-and-episodic-memory.md`, `chat.md`,
  `http-api.md` and `memory.md` describe the old rule and the old position of
  the request context.

#### Code Review #1 Revisions

- **F1 accepted.** The forced-final developer instruction now restates the
  guardrail after the limit text. The executor test asserts that the
  instructions end with the guardrail.
- **F2 accepted.** Added `test_fold_without_developer_role_reindexes_assistant_phases`.
- **F3 rejected.** Both folds are needed. The assembler guarantees guardrail
  order independently of the adapter.
- **F4 accepted.** Plan step updated.
- **F5 accepted.** The rule restores "secrets, credentials or other raw
  sensitive data" under the original explicit-request exception and adds the
  health and crisis clause. Episode processing adds that a note counts as an
  explicit request only when it says so.
- **F6 deferred to Phase 5.** Those four docs are added to the Phase 5 docs
  list.

#### Code Review #2 Findings

Targeted recheck of F1, F2 and F5: all resolved, and no blockers.

- **P1-R2-F1 (optional):** at the round limit the guardrail now appears twice.
  This is harmless and only happens on that rare request.

Checks:

- Focused guardrail, executor and model-client tests pass.
- `ruff check` and `ruff format --check` pass.
- Memory Manager DB tests errored because the Docker daemon timed out
  (environment only). Rerun them once Docker responds.

#### Code Review #2 Revisions

- **P1-R2-F1 rejected:** restating the guardrail keeps the invariant with the
  least code.
- Repair budget used: one of two. Phase 1 review: pass.

### Phase 2 — Backend safety core

Requirements: R2 (decision), R3 (local detector), R5 (table), R6 (backend) and
R8. Depends on Phase 1.

1. **Configuration.** Add the global and individual variables from the Decision
   Log to `server/config.py`, using the existing helpers.
   - Add `effective_*` properties that apply the global switch.
   - Validate the reminder interval as positive, and load and validate the
     resource table at import (bundled, or `ANIMAMA_CRISIS_RESOURCES_PATH`).
     Invalid input raises with the file path and field.
   - Log one warning per active override at startup.
   - Add the variables to `docker-compose.yml`, `.env.example` and the
     `development.md` table and drift list.
2. **Resource table.** Add `resources/crisis-resources.v1.json` and its pydantic
   model.
   - Each region has a code, a label, services with phone, text and chat
     entries, an emergency number, a `source_url` and `verified_on`.
   - The minimum regions are US, CA, GB, IE and AU, plus the `fallback` entry.
   - Verify every number against its official source when adding it, and
     record the check dates.
   - Resolve a region from an explicit preference, else the locale region,
     else the fallback.
   - Confirm the hatch build includes `resources/*.json`, as it already does
     for the other resources.
3. **Crisis detector.** Add `app/safety/crisis_detector.py`, a pure,
   deterministic function over normalized text: lowercase, folded
   apostrophes and whitespace, bounded length.
   - It matches first-person intent, plan, means, preparation, active
     self-harm and method-seeking patterns.
   - It applies explicit exclusions: idioms and hyperbole, quoted or
     lyric-marked spans, third-party subjects, negation, and past recovery
     where unambiguous.
   - It returns a small result (`positive`, `category`) and never includes
     matched text in logs.
   - Build `tests/fixtures/safety/crisis_detection.json` first, with at least
     40 negative and 25 positive labelled cases (R3 categories and the spec's
     examples), and tune until it has zero errors.
   - Add a timing test on a 20,000-character message with a generous bound
     (5 ms target). Record the measured value here.
4. **Safety state.** Add the ORM model and the `0001_baseline.sql` table
   `companion_safety_state` (FK to the owner user), plus a repository with
   row-lock access.
   - Add the pure `decide_ai_notice(state, now, local_date, reminder_interval)`
     returning `start`, `reminder` or `None` and the next state.
   - Test with a controlled clock: the first turn of a day; repeats; a 3-hour
     continuing interaction; a gap of 30 minutes or more; midnight; several
     Animas; a relaxed interval; notice disabled.
5. **Age status and onboarding.**
   - `PyOnboardingCompleteRequest` gains a required `adult_confirmed: bool`.
     A value other than `true` returns 422 and leaves first run incomplete.
   - Completion records `age_status=adult`, `age_status_source=self_attestation`
     and the time.
   - `first_run_complete` also requires `age_status == adult`.
   - Define the `AgeStatus` enum (`unknown`, `adult`, `minor`) and a small
     `AgeStatusProvider` protocol as the seam. The local implementation reads
     the row.
6. **Preferences and endpoints.**
   - Add helpers that read `preferences.safety` with defaults.
   - Add `GET /v1/safety/crisis-resources`, returning the region list and the
     resolved entry for an optional `region` query.
   - Add the `companion_safety` capabilities block.
  - Resolve the effective safety configuration from environment and
    preferences, in one function used by chat and capabilities. Test it: a
    shorter interval applies, a longer one is ignored, the global switch wins,
    and the guardrail is unaffected.
   - Regenerate the frontend client.

Checks: focused pytest (detector, resources, cadence, onboarding, capabilities,
config overrides), then the full backend chain. From `src/frontend`, run
`pnpm check` after regeneration.

Completion: every fixture passes; cadence and onboarding tests pass; an invalid
table fails at import with a clear message; review leaves no blockers.

Phase record: issue #135; starting source `502529f`.

Implementation notes:

- The first-run 18+ UI step moved here from Phase 4, because the required
  `adult_confirmed` contract would otherwise break the frontend build. The
  Safety page link on that screen is added in Phase 4.
- `companion_safety_state` has no foreign key: there is no users table, and
  `user_settings` has none either.
- `GET /v1/safety/crisis-resources` takes `locale` rather than `region`. The
  owner's region preference comes from settings, so the client only supplies
  its locale.
- `AgeStatusProvider` is the seam. The local composition reads the repository
  directly.
- Existing development installs reopen `/setup` until the age confirmation is
  recorded. That is accepted: there are no existing users.

Evidence (the Docker/OrbStack API hung for this session, so DB-backed tests are
pending):

- Detector: 45 positive and 65 negative fixtures pass. It takes 4.9–5.0 ms on
  20,000-character worst-case text and about 8 µs on a typical turn.
- Cadence, resource, config and guardrail tests pass.
- `ruff check`, `ruff format --check` and mypy pass.
- `pnpm openapi-ts:check` passes.
- `pnpm check` passes.
- Focused setup and runtime-provider vitest passes, 21 tests.
- Desktop vitest passes, 303 tests, plus `runtime-packaging.test.mjs` with 66
  tests.
- `docker compose config --quiet` passes.

#### Code Review #1 Findings

Reviewed the working tree on `502529f` (`sdlc-reviewer`, full initial review).

- **P2-R1-F1 (blocking):** `scripts/verify-accountless-journey.ts` and the
  macOS smoke script still completed first run without `adult_confirmed`.
- **P2-R1-F2 (blocking):** the detector matched common benign phrases: idioms
  ("cutting myself some slack", "kill myself laughing", "overdose on sugar"),
  noun compounds ("suicide prevention"), games ("best way to die in Elden
  Ring"), place qualifiers ("don't want to live anymore in this city") and
  reported speech.
- **P2-R1-F3 (blocking):** the detector missed explicit statements: "planning
  my suicide", "want to be dead", "ready to die", modal phrasing ("should I just
  kill myself"), "end things", "lethal dose", "how many pills would kill me",
  past attempts, and hyperbole overridden by "no seriously".
- **P2-R1-F4 (blocking):** reminder hours were unbounded. A value of `1e20` or
  `inf` raised `OverflowError` in resolution or settings.
- **Non-blocking:**
  - detector timing and the 50,000-character window;
  - stale docs: `http-api.md`, `user-profiles-and-usernames.md`,
    `data-layer.md` and `data-model.md`;
  - a missing `crisis-protocol.md` link target;
  - plan deviations not yet recorded;
  - `lock()` lacked `populate_existing`;
  - take `now` after the lock in Phase 3;
  - missing tests: relaxed interval, notice disabled, warning hook, the desktop
    environment test;
  - the unnamed float parse error.

#### Code Review #1 Revisions

- **F1 accepted.**
  - The journey sends `adult_confirmed`, with 422 cases for a missing or false
    value.
  - The macOS smoke records `adult_confirmation_required` and ticks the box.
  - `smoke-policy.mjs` and its test now require that check.
- **F2 and F3 accepted.**
  - Every probe became a fixture: 16 positive and 23 negative added.
  - The detector gained idiom and compound lookaheads, sentence-level
    exclusions for self-harm accidents and games, a reported-speech guard,
    modal and past-attempt patterns, "end things", lethal-dose and
    kill-me patterns, and an earnest override for hyperbole.
  - All 110 fixtures pass.
- **F4 accepted.**
  - `valid_reminder_hours` bounds both the operator and owner values to a
    finite (0, 168] range. Invalid owner values are ignored; invalid operator
    values fail settings with a named error.
  - `_env_float` names the variable on a parse error.
- **Non-blocking accepted:**
  - The window is now the first and last 10,000 characters of a longer
    message, with worst-case timing tests.
  - `lock()` uses `populate_existing`.
  - Added tests for a huge owner interval and for the notice disabled.
  - Deviations are recorded above.
  - The stale docs join the Phase 5 list.
  - Phase 3 takes `now` after the lock.
  - The desktop environment test stays in Phase 4.

#### Code Review #2 Findings

Targeted recheck. F1, the 20,000-character window and `populate_existing` were
resolved. Blocking findings:

- **P2-R2-F1:** the sentence-wide exclusions and the reported-speech guard hid
  genuine statements.
- **P2-R2-F2:** the new patterns matched benign phrases: modal idioms,
  "caffeine will kill me", "how many people have to die", "end things on a good
  note" and "dead tired".
- **P2-R2-F3:** a 400-digit integer preference still overflowed.

Evidence: DB tests pass, 36 tests, with Docker responding again. The full
`make check-test` before this round passed: 1978 passed, 7 skipped.

#### Code Review #2 Revisions

- **F1 and F2 accepted.**
  - The exclusions are now tied to the text right after the match.
  - The game context is the only sentence-level exclusion.
  - Reported speech skips the speaker "i".
  - Kill-me and lethal-dose now require a medication noun.
  - The guards were extended.
  - All probes became fixtures: 62 positive and 85 negative, all passing.
- **F3 accepted.** `valid_reminder_hours` catches `OverflowError` and bounds to
  [0.25, 168] hours.

#### Code Review #3 Findings

Final targeted recheck (repair budget exhausted). P2-R2-F3 is resolved, but
blocked by:

- **P2-R3-F1:** the new guards hide genuine statements:
  - "kill myself at midnight" and "kill myself for what I did";
  - "end things now" and "end things for good";
  - "cutting myself on the arms" and "hurting myself out of anger";
  - "I just said I want to kill myself".
- **P2-R3-F2:** the new patterns match benign phrases:
  - "tired of living paycheck to paycheck";
  - "can't stop cutting carbs";
  - "cut my wrist on a broken glass";
  - "jump off the cliff into the lake";
  - "take all my meds with breakfast".
- Worst-case timing is 7.4 ms on repeated `"i "` text (the test bound is
  50 ms).

The reviewer observed that each round of stop-list guards fixes the probed
phrases and opens neighboring gaps.

#### Code Review #3 Revisions

Stopped at the repair limit, per SDLC bounded review. Phase 2 is not committed
and awaits an owner decision: accept the documented gaps, or authorize a further
bounded pass against a broader, pre-agreed corpus.

#### Owner-authorized detector pass (after Code Review #3)

- **Corpus.** An independent agent, without access to the detector source,
  wrote `tests/fixtures/safety/crisis_corpus.json`:
  - 150 crisis and 270 ordinary messages, split in half into tune and holdout;
  - hard cases in both directions.
- **Baseline.** The pattern detector measured:
  - tune: precision 0.97, recall 0.44;
  - holdout: precision 0.955, recall 0.28.

  Enumerated phrases do not generalize.
- **Redesign.** The detector is now a weighted-signal scorer:
  - It adds up weights for first-person death and self-injury, plan and means,
    method-seeking, and intent and immediacy cues. A window crosses the
    threshold at a score of 3 with at least one strong signal.
  - A window is each sentence and each adjacent pair of sentences.
  - Impersonal method questions ("quickest way to die", lethal dose of a
    medication) do not need a first-person subject.
  - Benign context cancels a match: games and fiction, third-party subjects,
    reported speech, negation, recovery, academic or "how do I talk to" framing,
    and hyperbole without an earnest marker.
  - The scan window is the first and last 4,000 characters.
- **Result.** Tuned on the tune split and the existing fixtures only:
  - tune: precision 1.00, recall 1.00;
  - existing fixtures: all pass. The category assertion was dropped because
    the category only labels the strongest signal, and the card is identical
    for every category;
  - holdout, measured once after tuning: precision 0.833, recall 0.533.
- **Regression floors.** The tests enforce the holdout values as floors:
  precision ≥ 0.83 and recall ≥ 0.53.
- **Timing.** Worst case 3.1–4.9 ms on 100,000-character input; about 15 µs on
  a typical turn.
- **Interpretation.** The tune/holdout gap shows the ceiling of a local pattern
  scorer. It misses about half of unseen crisis phrasings, and about 6% of
  unseen ordinary messages trigger it. OpenAI Responses inline moderation and the
  guardrail's in-character crisis behavior remain the complementary layers.

#### Detector pass review findings

Independent review of the detector pass. Holdout integrity is plausible and the
metrics reproduce. Blocking findings:

- **P2-X-F1:** window-wide benign cancellations suppress explicit first-person
  intent that has unrelated context in the same sentence ("He broke up with me
  and I want to kill myself", "I used to be happy but now I want to kill
  myself"). The corpus does not measure this class.
- **P2-X-F2:** the medication meal/prescription guard never fires because the
  optional group backtracks.
- **P2-X-F3:** plan-context signals with no death or injury anchor plus a
  common cue reach the threshold ("set a date for the wedding. I'm planning
  everything").

Optional findings:

- **F4:** `.*` makes the worst case quadratic, about 40 ms on adversarial text.
- **F5:** further false positives and false negatives to record as
  limitations.
- **F6:** dropping the category assertion is acceptable.
- **F7:** the regression floors have no slack.
- **F8:** tidy-ups.

The pass stopped here pending an owner decision.

#### Detector pass revisions (owner-authorized)

- **F1 accepted.** Subject, reported-speech, negation, recovery and study
  context now cancel only the clause that contains an anchoring match. Clauses
  split on commas, "and", "but", "so", "because" and "then"/"now". Game,
  fiction, joke and method-benign context still cancel the whole window.
- **F2 accepted.** The medication guard is evaluated after the whole phrase.
- **F3 accepted.** Preparation context ("picked a date", "bought a rope") adds to
  a score but cannot anchor a crisis.
- **F4 accepted.** `.*` is bounded to 80 characters. The adversarial worst
  case is 5.2 ms.
- **F5 partly accepted.** Added "life insurance", "die on this hill" and "like
  this" guards. The other examples are recorded as limitations.
- **F6 accepted.** The category is an approximate log label.
- **F7 accepted.** The floors now sit one case below the measured values, with
  a recorded procedure: precision ≥ 0.81, recall ≥ 0.50.
- **F8 accepted.** The duplicate alternative is removed and the comments and
  docstring are corrected.
- All review examples became fixtures: 73 positive and 94 negative. The tune
  split is 1.00/1.00.
- Holdout, measured once: precision 0.830, recall 0.520. One true positive was
  lost in exchange for correct handling of the mixed-context class.

#### Detector pass targeted recheck

Result: pass with documented limitations.

- **Verified:** F1 to F3 are fixed, and third-party statements still cancel.
- **P2-X2-F2, accepted:** anchors come from every match (`finditer`). "my
  friend is suicidal and i am suicidal too" is now a positive fixture.
- **P2-X2-F1, recorded as a known limitation:** clause scoping lets benign
  context in an earlier clause miss a later one. These are false positives
  only:
  - "I would never, ever kill myself";
  - "He said, I want to kill myself";
  - "Years ago, I tried to kill myself";
  - "For my essay, what's the most painless way to die";
  - "My friend was drunk and said he wanted to die".

  Letting earlier clauses cancel would bring back the missed-crisis class
  fixed by F1.
- **P2-X2-F3, noted:** benign 129,000-character input measured 5.5–8.7 ms in a
  noisy run. The adversarial worst case is about 5 ms, and the test bound is
  50 ms.
- **P2-X2-F4, accepted:** stale moderation text in this plan is updated.
- **Final detector metrics:**
  - fixtures: 75 positive and 94 negative, all passing;
  - tune: 1.00/1.00;
  - holdout: precision 0.830, recall 0.520.

### Phase 3 — Chat-turn integration

Requirements: R2 (event), R3 (routing and moderation), R4 (event), R5 (care
note) and the latency constraint. Depends on Phase 2.

1. **Request.** Add the optional `client_context` to `PyAnimaChatRequest` and
   thread it through turn setup.
2. **Local detection at setup.** When crisis detection is effective, run the
   detector in `prepare_direct_chat_turn` before `DirectChatTurnRequest` is
   built.
   - Pass `care_note=CRISIS_CARE_NOTE` to the assembler on a positive result.
   - Carry the result, the resolved region entry and the preferences on the
     prepared turn.
   - A detector exception is logged without content and treated as negative.
3. **Events.** Add the domain events `AI_NOTICE` and `CRISIS_SUPPORT`, with
   formatters in `sse_events.py`:
   - `{type: "safety.ai_notice", run_id, kind, anima_name}`;
   - `{type: "safety.crisis_support", run_id, source: "local"|"moderation", region, resources}`.

   Neither payload has `text`, `error`, `emotions` or `gesture` keys.
4. **Stream order.** In `_event_stream`, before the provider task is created:
   - decide and record the notice in a short-lived session and yield
     `safety.ai_notice` if due. On a state failure, yield `kind: "start"` and
     log;
   - if local detection was positive, yield `safety.crisis_support`.
5. **Inline moderation (OpenAI Responses only).** When crisis detection is
   effective and the provider is `OpenAIResponsesHTTPAgent`, the Responses
   request builder adds `moderation={"model": "omni-moderation-latest"}` through
   a provider option.
   - The adapter reads `response.moderation.input` from the completed response.
     A `moderation_result` whose `self-harm/intent` or
     `self-harm/instructions` category is flagged, or whose `self-harm` score is
     at or above a named threshold, becomes a content-free signal on the final
     model-client result.
   - The executor turns that signal into a `CRISIS_SUPPORT` domain event, at
     most once per turn and never when the local detector already fired. It is
     emitted before `run.completed`.
   - An `error` result or a missing field logs a content-free warning.
   - Other providers send no moderation field.
6. **Tests** (`MockModelClient` and stubbed Responses results):
   - the order of notice and crisis frames relative to the first
     `user.response`;
   - a positive turn still streams a reply and persists normally, with the
     care note before the guardrail;
   - a negative turn has no extra frames;
   - a detector exception does not interrupt chat;
   - the Responses request carries the moderation field only when detection
     is effective, and other providers never do;
   - a flagged input result emits one frame, while an error or missing result
     emits none;
   - with the global switch off, no notice, detection or moderation occurs,
     and the guardrail is still present;
   - incognito and memory-disabled turns still get the notice and detection.
7. **Latency evidence.** Moderation rides on the provider request and adds no
   awaited step. Record local timing of the setup path with and without
   detection.

Checks: focused SSE and executor tests, then the full backend chain;
`pnpm check` after regenerating the client.

Completion: the tests above pass; ADR 0003 ordering and cancellation are
preserved; review leaves no blockers.

Phase record: to be filled in during implementation.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 4 — Frontend safety surfaces

Requirements: R2, R4, R6, R7 (page) and R8 (UI). Depends on Phase 3.

1. **SSE.** Add types and guards for `safety.ai_notice` and
   `safety.crisis_support` to `useChatSse.ts`, with the callbacks
   `onAiNotice` and `onCrisisSupport`, and wire them through
   `useProductChatSession`. Send `client_context` on every chat request.
2. **State.** Mount `CompanionSafetyProvider` in `AnimaRouteProviders`.
   - Notice visibility is a pure helper in `lib/safety/noticeVisibility.ts`:
     visible from the event until the later of turn completion or failure and
     8 seconds, then a fade, with no animation under reduced motion.
   - The crisis card persists until dismissed. A new positive turn replaces it.
3. **Rendering.**
   - `CompanionSafetySlot` renders the card, then the notice.
   - In `ChatInterfaceView` it sits below `ChatInput`, at bottom-center.
   - In `MainShell` it is shown at bottom-center when
     `canvasMode === "avatar"`.
   - The notice uses `role="status"` with `aria-live="polite"` and muted
     styling, and never moves focus.
   - The card is a labelled region announced once, with keyboard-reachable
     links (tel:, sms:, chat URL), a Safety link and a dismiss button.
4. **Quick Chat.** Add `safety` to `DesktopQuickChatSnapshot` and the
   `dismiss-crisis-card` command. Render the slot below Quick Chat's input, and
   update the desktop bridge types. PiP is unchanged.
5. **First run.** Add to `setup.tsx`:
   - the minors statement;
   - "Animas are AI, not people";
   - a required "I am 18 or older" checkbox and a Safety link.

   Continue stays disabled until the box is checked. The route sends
   `adult_confirmed`. If the owner will not confirm, a short message explains
   that Animama is for adults.
6. **Settings.** Add a **Safety** section to `ApplicationSettingsModal`
   containing:
   - a crisis-resource region select ("Automatic (system: XX)" plus the
     table's regions);
   - an AI-notice reminder select, limited to at most the operator's interval
     (for example 1, 2 or 3 hours);
   - a "Safety and crisis protocol" link.

   When the global switch is off, the section shows only the link and a note
   that the operator has disabled the safety features.
7. **Safety page.** Add `routes/safety.tsx`, reachable before onboarding, which
   renders `docs/safety/crisis-protocol.md` through `?raw` and `react-markdown`.
   - Extend `server.fs.allow` and add `docs/safety` to the web build context.
   - Phase 5 finalizes the document. This phase adds a placeholder with the
     section skeleton, so the build and route are verified.
8. **Tests.**
   - SSE classification of both events, including that neither is mistaken
     for a reply, error or `run.completed`.
   - Notice timing with fake timers: a short turn, a long turn, a failed turn
     and reduced motion.
   - Card persistence across a canvas-mode switch, dismissal and
     replacement.
   - Setup gating.
   - Safety section visibility driven by capabilities, including the global
     switch off and the interval options capped.
   - A desktop test that the backend environment carries no safety variable.
   - Quick Chat snapshot mapping.

Checks, from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`, and `pnpm desktop:check`.

Browser checks on the task stack at desktop size (1440×900), then a narrow
layout:

- notice placement in Avatar + Chat and Chat-only;
- a switch to Avatar-only with a card showing;
- a crisis card from a fixture message, including its links, keyboard use and
  dismissal;
- first-run gating and the Safety page.

Completion: checks pass; browser evidence is recorded without personal content;
review leaves no blockers.

Phase record: to be filled in during implementation.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

### Phase 5 — Protocol, docs, copy audit and desktop acceptance

Requirements: R7 (document), R10, R11 and the manual acceptance items. Depends
on Phase 4.

1. **Protocol document.** Write `docs/safety/crisis-protocol.md` as a
   public-ready document covering every R7 item as implemented. Include
   operator configuration and the global switch, what is sent to OpenAI when
   moderation scores are requested inline, the resource sources with their verification dates, and
   the limitations (pattern detection misses indirect phrasing; no age
   verification).
2. **Current docs.** Update:
   - `docs/backend/runtime/chat.md`: request `client_context`, stream order,
     the new events, the guardrail position, and the stale "system continuity
     message" wording for compaction;
   - `docs/backend/runtime/model-client-providers.md`: moderation;
   - `docs/frontend/features/anima-memory.md`: the sensitive-data rule;
   - the frontend runtime chat doc and the frontend docs README feature list;
   - `docs/backend/operations/development.md`: the variables;
   - `docs/backend/features/memory-manager-and-episodic-memory.md`,
     `docs/backend/architecture/http-api.md` and `docs/backend/features/memory.md`:
     the sensitive-data rule and the trailing developer message (review
     P1-R1-F6);
   - `docs/backend/features/user-profiles-and-usernames.md`,
     `docs/frontend/architecture/data-layer.md` and
     `docs/backend/architecture/data-model.md`: the 18+ requirement,
     `first_run_complete` and `companion_safety_state` (review P2-R1).
3. **ADR and glossary.** Finalize ADR 0008 with status Accepted, pending the
   owner's review in gate G1. Add the glossary entries *AI notice*,
   *continuing interaction* and *companion guardrail*.
4. **Copy audit.** Run
   `rg -n -i "therap|counsel|mental[- ]health|treatment|wellbeing|well-being|emotional support" README.md pyproject.toml docs src --glob '!**/generated/**' --glob '!**/node_modules/**'`.
   Classify every hit as allowed (resource descriptions, negative guardrail
   clauses, this plan and spec) or fix it. Record the result here.
5. **Manual desktop acceptance** (gate G3). Run the packaged or development
   Electron app against the task stack and record the results. Check:
   - notice visibility in Avatar + Chat, Avatar-only (after a mode switch),
     Chat-only, Voice Mode and Quick Chat;
   - the crisis card in the main window and Quick Chat;
   - PiP shows nothing;
   - first-run gating;
   - the Safety settings section: the region and a
     shorter interval;
   - the Safety page;
   - with `ANIMAMA_COMPANION_SAFETY_ENABLED=false`: no notice and no card.

Checks: documentation review; rerun the frontend build if the Safety page
content changed.

Completion: the documents match the implemented behavior; the audit is clean;
gate G3 evidence is recorded.

#### Code Review #1 Findings

Not yet run.

#### Code Review #1 Revisions

Not yet run.

## Final integration review

Run `sdlc-reviewer` over the full branch diff against the spec's acceptance
criteria, reusing still-valid phase evidence. Allow one full review and at most
two repair rounds. Record the findings and revisions here.

## Validation and acceptance

Automated evidence follows the spec's acceptance criteria. Commands:

- Backend: `uv run pytest -q`, `uv run ruff check`, `make check-test`.
- Frontend (from `src/frontend`): `pnpm check`, `pnpm web:lint`,
  `pnpm web:test`, `pnpm build`, `pnpm desktop:check`.
- Root: `bash -n reset.sh` and the Compose `config --quiet` checks, which apply
  because `docker-compose.yml` changes.

Hosted `Validation` runs in full: this change is safety-critical and not
eligible for a local receipt.

Owner gates. These do not block phase progression; all are required before
merge approval.

- **G1, copy:** the owner reviews the guardrail text, the care note, the
  notice and crisis card copy, the first-run copy and ADR 0008.
- **G2, live model:** an opt-in check against the active OpenAI model, using
  the owner's key from the external secrets file. It covers:
  - an identity that claims to be human admits being an AI when sincerely
    asked;
  - farewell and absence prompts show no guilt or loneliness claims;
  - a crisis fixture gets a warm, in-character reply;
  - the moderation threshold is calibrated against the fixtures, with the
    resulting constant recorded.

  Only aggregate results are recorded.
- **G3, desktop:** the manual Electron acceptance in Phase 5.
- **G4, resources:** the owner reviews the crisis-resource numbers and sources.

Release blockers outside this plan, from the spec's follow-ups: public
publication of the protocol, AB 1043 and SB 1119 work before 2027-01-01,
referral counting before 2027-07-01, NY S9051B, and counsel review.

## Idempotence and recovery

- **Schema.** The baseline SQL change needs a fresh development database for
  every stack. Use `./reset.sh --name safety --base-port 8760 --purge` for the
  task stack only. Never purge the owner's main stack without the owner's
  decision. Existing development installs then re-run first run, which is
  expected.
- **Moderation failures** degrade to local-only detection. A notice-state
  failure over-shows the notice. Neither blocks chat.
- **Disabling everything.** The global switch turns every runtime safety
  feature off without a code change, except the guardrail.
- **Detector patterns** are data-tested. Any tuning must keep every fixture
  passing, and new false positives found in use become negative fixtures.
- **Rollback.** The phases are separable commits. Reverting Phase 4 leaves the
  backend emitting events that older clients ignore, because unknown `type`
  events are skipped. Confirm this during Phase 4 testing.

## Outcomes & Retrospective

Not started.
