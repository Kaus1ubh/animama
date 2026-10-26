# Standardized model benchmark execution plan

Status: Draft for owner review (gate G1). Nothing is authorized for
implementation yet. Stale: this draft predates the owner's 2026-10-25
decisions in the revised [spec](model-benchmark-spec.md), which change the
efforts, judge, voice, languages, memory arms, web search and run-time bound.
Revise it with `to-execplan` before G1. Its checkout and starting source
below are also out of date: the work now lives in
`worktrees/animama/model-benchmark-discovery-d321cc` on branch
`docs/model-benchmark-spec`, starting from `18d2bebd`.

Source agreement: [spec](model-benchmark-spec.md), status Proposal. It was
drafted from the owner's discovery answers on 2026-10-12, recorded on
[#470](https://github.com/raymond-van/animama/issues/470#issuecomment-6134798047).
The spec is authoritative until `workspace-setup` publishes it to #470.

Authorized scope: none until G1. Exact-candidate merge approval stays
separate.

Starting source: `95a2db39` (`origin/main`, 2026-10-12). Checkout
`worktrees/animama/model-benchmark-spec`, branch `docs/model-benchmark-spec`,
which holds the spec and this plan. Proposal: before the first
implementation commit, rename it to `feat/model-benchmark`, so the spec, the
plan and the implementation share one branch and one PR.

## Purpose and context

After this plan, the owner can benchmark Animama's chat models with one
skill, `animama-model-benchmark`, or with its documented commands. The flow:

1. A dry run states the calls, the estimated cost and the judge batches.
2. The owner approves a capped run.
3. Every configuration runs through the app's real chat and Memory Manager
   code on a development task stack.
4. A Claude judge and a GPT judge score the replies blind, through the
   owner's subscriptions.
5. A tracked, public-safe report gives a scorecard per benchmark area,
   beside latency, tokens and cost.

The first benchmark run is part of this plan, together with the one-time
calibration against the owner.

Benchmark areas in v1 (spec R4, R5):
- **Core turn:** chat replies, avatar expression, structured-output
  reliability and operations.
- **Multi-turn and memory:** long chats, in-chat memory and Memory Manager
  runs.

Ownership and boundaries:

- **Tooling.** All new code lives under `scripts/evals/`, with tests under
  `tests/`.
  - The repository import-boundary check
    (`scripts/repository-boundary/check-python-imports.py`) audits only
    `src/backend`. Benchmark code therefore stays in `scripts/` and never
    moves into `animama.app`.
  - mypy reaches `scripts/evals` only through the tests that import it, so
    every module gets a typed test.
- **Runtime.** No behavior change (spec non-goal). The exception is a small
  refactor that preserves behavior, and only if the harness cannot otherwise
  observe a real code path's outcome. Phase 2 checks whether the structured
  recovery outcome needs one.
- **The two parts run in different places:**
  - **Contestants** run inside the backend container of a development task
    stack, because the configured model connections and keys live there.
    Only the development Compose selection bind-mounts the checkout at
    `/app`, and the built image has no `scripts/`.
  - **Judges** run on the host, where the owner's `claude` and `codex` CLIs
    are signed in.
  - The judge and report modules use only the standard library and never
    import `animama`, so plain `uv run python -m …` on the host works.
  - Raw results move between the two through the bind-mounted, git-ignored
    `.animama-drafts/` folder.
- **Skills.** Skill source lives under `.agents/skills/<name>/`, with
  `SKILL.md`, `agents/openai.yaml` and `references/`, and `.claude/skills`
  points there.
- **Prior art.** The Gesture selection harness
  `scripts/evals/gesture_selection.py` (#409, PR #462) and its tracked inputs
  under `docs/plans/gesture-catalog-expansion/`. Its CLI, inputs and outputs
  must not change (spec R17).

## Progress

- [ ] G1: the owner agrees the spec and this plan, including the decisions
      marked "proposed" in the Decision Log.
- [ ] Phase 1: Shared evaluation core extracted; Gesture harness unchanged.
- [ ] Phase 2: Core-turn benchmark runner and dry run.
- [ ] Phase 3: Multi-turn and memory runners.
- [ ] Phase 4: Prompt set v1, fixtures and rubrics (gate G2).
- [ ] Phase 5: Blind judging through the subscription CLIs.
- [ ] Phase 6: Scores, statistics and report.
- [ ] Phase 7: Skill, documentation and glossary.
- [ ] Phase 8: First benchmark run and calibration (gates G3, G4).
- [ ] Final integration review.

## Surprises & Discoveries

These are 2026-10-12 findings from planning-time code inspection on
`95a2db39`, made before any implementation.

- **In-chat memory writes require incognito off.**
  - `build_memory_tool_config`
    (`src/backend/animama/app/chat/direct_turn/provider_state.py:189`)
    enables memory writes only when updates are on and the turn is not
    incognito.
  - On OpenAI Responses, incognito off means `store=true` (`:232`), and tool
    rounds continue from `previous_response_id` (`:342`).
  - A non-incognito turn also calls `chat_manager.record_turn` and the
    episode recorder (`app/chat/direct_executor.py:867`, `:1295`). The
    harness's chat stand-in must capture these calls. Today's `_EvalChats`
    cannot.
  - Spec R2 was revised (proposed, G1) so these turns keep real provider
    storage.
- **No in-memory memory repository ships in `src`.**
  - The test fakes (`tests/test_memory_files.py:92`) use substring search.
    Production uses Postgres full-text search, so `search_memory_files`
    results would differ.
  - The real `MemoryEntryService`, `DirectChatMemoryContextService` and
    `DirectChatMemoryToolService`, with the local patch planner
    `AgentsSDKV4AMemoryPatchPlanner`, run over any repository that
    implements `MemoryEntryRepository` (`app/ports/memory_entry_port.py:25`).
- **The Memory Manager can run in memory.**
  - Its runtimes (`adapters/memory_manager/`) only read from
    `MemoryEntryService`. Proposals come back as
    `MemoryManagerRuntimeApprovalRequest` objects
    (`app/ports/memory_manager_runtime.py`).
  - Each proposal pauses the run, and resuming with "approve" assumes the
    edit was already applied. The harness therefore applies each edit to its
    fake store before it resumes (spec R5, revised).
- **The OpenAI Memory Manager runtime bypasses `ModelClient`.**
  - It uses the OpenAI Agents SDK with its own `AsyncOpenAI` client
    (`openai_agents_runtime.py:396`), sends `store=true` (`:496`) and
    traces on the built-in connection (`:536`).
  - Its `model_wrapper` hook (`:127`, applied at `:525`) lets the harness
    count calls, enforce the cap and read full usage. The Anthropic runtime
    offers a `client_factory` hook (`anthropic_runtime.py:235`).
  - Both runtimes report only requests, input, output and total tokens.
    Cached and reasoning tokens need the wrapper.
- **The persona enters through the memory context.**
  - The Anima's identity reaches the prompt through
    `DirectChatMemoryContext.anima_identity` and `anima_name`.
  - The Gesture harness injects its neutral identity this way
    (`_NeutralMemoryContext`).
  - Annie's text is `STARTER_ANIMA_SPECS[0].identity_markdown`
    (`app/services/anima_starter_service.py:46`).
- **Model snapshot.** The Gesture harness does not record the model the
  provider served. `ModelClientFinal.raw_provider_metadata["model"]` carries
  it for both OpenAI protocols; Anthropic echoes the requested id.
- **Judge CLIs.** The CLIs and their versions on the owner's machine:
  `claude` 2.1.285, `codex-cli` 0.160.1.
  - **`claude -p`.** It supports `--model <full id>`, `--json-schema`,
    `--output-format json`, `--system-prompt`, `--tools ""`,
    `--no-session-persistence` and `--restricted`, which ignores user,
    project and local settings.
    - `--bare` must not be used: it reads only `ANTHROPIC_API_KEY`, which
      would bill the API instead of the subscription.
  - **`codex exec`.** It supports `-m`,
    `-c model_reasoning_effort=…`, `--output-schema <file>`,
    `-o <file>`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`,
    `-s read-only`, `--skip-git-repo-check` and `-C <dir>`.
- **Harness seams** (`scripts/evals/gesture_selection.py`). Generic pieces:
  - the budgeted client and call records (592–663);
  - stand-ins (666–739);
  - executor setup (742–784);
  - usage and cost (790–856);
  - replay (859–942);
  - statistics (1242–1296);
  - catalog and registry helpers (1615–1659).
  Tests patch `gesture_selection.load_model_provider` and `build_registry`,
  and call `_read_only_model_providers` and `_run` on that module. Those
  names must stay there. The database import must stay lazy for the
  conftest's engine patch.
- **Formatting.** `make format-check` formats only `src/backend/animama` and
  `tests`. `ruff check` covers `scripts/`. This plan adds
  `uv run ruff format --check scripts/evals` to each phase's checks.

## Decision Log

- **2026-10-12, owner (discovery):** the agreed decisions listed in the spec
  under "Open questions and decisions".
- **2026-10-12, owner (task instruction):** the owner invoked `/to-execplan`
  after the spec draft. That instruction does not accept the spec's
  proposals, which stay open until G1.
- **D1 (proposed, G1). Code layout.**
  - `scripts/evals/core/` holds the extracted generic pieces.
  - `scripts/evals/benchmark/` holds the benchmark, with one module per
    area, and runs as `python -m scripts.evals.benchmark <command>`.
  - `gesture_selection.py` imports the core and keeps its own CLI and its
    patched names.
- **D2 (proposed, G1). Commands.**
  - `plan`: the dry run, which needs no database or model.
  - `run`: runs the configurations in the container.
  - `judge`: runs the judges on the host and can resume.
  - `calibrate export|import`.
  - `report`: renders, and re-renders, from recorded data.
  - `models`: lists catalog rows.
  The skill runs these in order.
- **D3 (proposed, G1). Raw results.**
  - Contestant turns are appended as JSON Lines, one line per turn, under
    a run manifest, so an interrupted run keeps every finished turn
    (spec R16).
  - Judge outputs are kept per batch file.
  - Everything goes under `.animama-drafts/model-benchmark/<run-id>/`.
- **D4 (proposed, G1). In-memory memory store.**
  - The harness provides an in-memory `MemoryEntryRepository` and runs the
    real memory services over it.
  - Its search is a simple token match, which is a documented limitation:
    ranking differs from Postgres full-text search.
  - Recall items test memory context and file reads, not search ranking.
  - The alternative was a disposable benchmark database in the task stack,
    with real repositories and search. It was rejected for now: it needs
    seeded owner, Anima, chat and episode rows, and could touch the stack's
    database.
- **D5 (proposed, G1). Provider storage (spec R2 revision).**
  - Core-turn and long-chat turns run incognito (`store=false`).
  - In-chat memory turns and OpenAI Memory Manager runs keep the app's real
    storage.
  - The harness turns off Agents SDK tracing for Memory Manager runs only,
    if a hook allows it without changing requests the model sees.
    Otherwise the report records that tracing was on.
- **D6 (proposed, G1). Judge models.** Each subscription's most capable
  model at Phase 5, pinned by full id.
  - Candidates on 2026-10-12: `claude-fable-5-1` or `claude-opus-5-5` for
    Claude, and `gpt-6-astra` for GPT, the Codex default model on the
    owner's machine.
  - Phase 5 confirms each id with a tiny call and records it.
- **D7 (proposed, G1). Judge isolation.**
  - The Claude judge runs `claude -p --restricted --tools ""
    --system-prompt <rubric> --no-session-persistence --output-format json
    --json-schema <schema> --model <id>` from an empty temporary directory.
  - The Codex judge runs `codex exec --ephemeral --ignore-user-config
    --ignore-rules -s read-only --skip-git-repo-check -C <empty dir> -m <id>
    --output-schema <file> -o <file>`.
  - Phase 5 checks that no user instructions, memory or project files reach
    either judge. If any do, it records how they were excluded.
- **D8 (proposed, G1). Phase 5 subscription use.** G1 approval also covers a
  live judge smoke: at most two fixture batches per CLI on the owner's
  subscriptions, with no API spend.
- **D9 (proposed, G1). Statistics (spec R14).** Implemented in pure Python,
  with no new dependency. `numpy` is only in the `voice` extra.
  - **Spread:** a seeded bootstrap that resamples items, keeping repeats
    together (2,000 resamples), giving a 95% interval.
  - **Inter-judge and judge-to-owner agreement:** quadratic-weighted kappa,
    plus exact and within-one agreement.
  - **Own-family preference:** for judge J, J's mean on its own family minus
    the other judge's mean on that family, minus the same difference on the
    other family.
  - **Ranking language:** the report calls two configurations "not
    distinguishable" when their intervals overlap.
- **D10 (proposed, G1). Smoke tier.**
  - `--tier smoke` takes a fixed, tracked subset of the prompt set: about 20
    single-turn items, one persona, one repeat, one shortened scripted chat
    and one memory chat.
  - It is used on the mock model for wiring checks, or as a cheap paid
    regression run with the same approval rule.
  - `--tier full` is the decision run.

## Implementation orientation

The executor and its wiring:
- `DirectChatTurnExecutor`'s constructor is at
  `src/backend/animama/app/chat/direct_executor.py:345`.
- Production wiring is in
  `src/backend/animama/product_http/chat/turn_setup.py:209`.

The real pieces the harness reuses:
- the memory context service (`app/chat/memory_context.py:135`);
- the memory tool service (`app/chat/memory_tools.py:110`), with
  `AgentsSDKV4AMemoryPatchPlanner` (`adapters/memory_patch.py:56`);
- `MemoryEntryService` (`app/services/memory_entry_service.py:329`);
- the Memory Manager runtime selector (`adapters/memory_manager/runtime_selector.py`);
- the episode-processing and Reflection task inputs
  (`adapters/memory_manager/episode_processing.py`, `reflection.py`).

Useful test patterns:
- the fakes in `tests/test_direct_chat_turn_executor.py` (`_FakeChatManager`,
  `_FakeMemoryEpisodeRecorder`) and `tests/test_memory_files.py`;
- `tests/anthropic_fakes.py`;
- the Agents model wrapper in `tests/test_model_call_boundary.py:289`.

Turn options:
- core turn: `DirectChatOptions(incognito=True)`, as the Gesture harness uses;
- memory turns: `incognito=False, disable_memory_influence=False,
  disable_memory_updates=False`.
A model row with `allow_memory_writes=false` removes write tools.
`build_memory_tool_config` records which tools a turn actually had.

## Setup and execution rules

When implementation is authorized:

1. Run `workspace-setup`. It publishes the agreed spec to #470 and reads it
   back, marks the spec file as a snapshot, and creates one sub-issue per
   phase with blocked-by links. Rename the branch (see Starting source).
2. Work test-first. Offline tests use the existing fake model clients and
   scripted streams. They never use keys, the network or the judge CLIs.
   Judge tests use a stub CLI script.
3. Use a named task stack only for container smoke runs (Phases 2, 3, 7) and
   the paid run (Phase 8). Check `docker ps` for port conflicts first.

   ```bash
   ANIMAMA_LLM_SKIP=1 ./reset.sh --name bench --base-port <free port>
   source .animama-stack.env
   ```

   The paid run uses a stack started with
   `COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"`.
   Never copy, source or print secret files. Take the stack down right after
   its last use.
4. If a worktree venv resolves to Python 3.14, run
   `uv sync --python 3.12.13`.
5. Before each phase commit:
   - Run the phase checks.
   - Get an independent `sdlc-reviewer` review: one full initial review and
     at most two repair rounds.
   - Commit as `<type>(evals)[p#]: <summary>`, or with scope `chat` or
     `memory` for an allowed runtime refactor.
   Stop and report blockers left after the repair budget.
6. Phases run in order, with one exception: Phases 5–7 may proceed while G2
   is pending. Phase 8 needs G2, G3 and G4.
7. No paid contestant call before G3. No subscription judge call before G1,
   which covers the Phase 5 smoke (D8). Free mock runs need no approval.

Standard checks for each phase, run from the repository root:

```bash
uv run pytest -q tests/test_gesture_selection_eval.py tests/test_model_benchmark_*.py
uv run ruff check
uv run ruff format --check scripts/evals tests
make format-check
make mypy
```

Run the full `uv run pytest -q` and `make check-test` in Phase 7 and in the
final integration review. Frontend checks are not needed, because there is
no frontend change.

## Phased implementation

### Phase 1: Shared evaluation core extracted; Gesture harness unchanged

Requirements: R17, and the groundwork for R2, R12 and R16.

Changes (`scripts/evals/core/`, D1):
- **What moves.** The generic pieces listed under Surprises &
  Discoveries:
  - the budgeted model client and call records;
  - pricing and cost;
  - usage and timing helpers;
  - statistics;
  - the read-only catalog, registry and model listing;
  - the executor builder and turn options;
  - replay and history;
  - writing outputs with an injected renderer.
- **Parameters.** `_turn_request` takes the Gesture list as a parameter.
  The stand-ins take an identity and a name instead of hard-coding the
  neutral persona.
- **The Gesture harness.** `gesture_selection.py` imports the core and keeps:
  - `load_model_provider`, `build_registry`, `_read_only_model_providers`
    and `_run` as module-level names that the tests patch;
  - its `__all__`;
  - lazy database imports.
- **Two additions:**
  - the budgeted client records the provider-reported model from
    `raw_provider_metadata`;
  - a `_BudgetedModelClient`-style wrapper becomes reusable for any client.

Checks and expected observations:
- The Gesture harness tests pass unchanged. Any edit to a test is justified
  in the phase record.
- Dry-run output on the tracked #409 inputs is byte-identical before and
  after: run the "Dry run" command in
  `docs/plans/gesture-catalog-expansion/gesture-selection-eval.md` on both
  revisions and `diff` the outputs.
- A mock run (`ANIMAMA_LLM_SKIP=1`) of the Gesture harness gives the same
  `summary.md`, apart from timestamps and timings.
- New core unit tests cover the budget cap, pricing parsing, the p90 and
  distribution, and the snapshot capture.

Completion: the checks above pass and the review passes. Commit
`refactor(evals)[p1]: extract the shared evaluation core`.

Recovery: a pure refactor. Revert the commit if the parity diff cannot be
made clean.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 2: Core-turn benchmark runner and dry run

Requirements: R1 (commands), R3, R4, R6 (format), R8, R12, R13, R16.

Changes (`scripts/evals/benchmark/`):
- **Prompt-set format v1.** A JSON manifest containing:
  - `version`;
  - `loadout`, a path to a loadout file and its sha256;
  - `personas`;
  - `items`, each with `id`, `area`, `message`, `tags`, `acceptable`,
    `held_out`, `expect_recall` and `tier`;
  - `scripted_chats`, each with `id`, `area`, `turns`, `held_out` and
    `tier`;
  - `memory_fixtures`.
  A loader validates the manifest and computes input hashes. A format doc
  sits beside the inputs (location per G1).
- **Configurations.**
  - `--standard` resolves every visible built-in chat row in the catalog at
    efforts none, low and medium.
  - `--config <row id>[:<effort>]` can be repeated.
  - A capability check (structured output, streaming, the requested
    effort) marks a configuration "not run" with its reason (R3).
- **Personas.** The neutral identity, and Annie from
  `STARTER_ANIMA_SPECS`, through the memory-context stand-in.
- **The run loop.**
  - Serial and interleaved: repeat, then item, then persona, then
    configuration.
  - One discarded warm-up turn per configuration, recorded but excluded
    from the measures.
  - Scripted chats run turn by turn, interleaved by chat.
  - The cap covers warm-ups, repairs and retries (R12).
  - JSON Lines output (D3), with the run conditions in the manifest: date,
    time window, host, network label and stack revision (R13).
- **Measures (R4).**
  - Gesture fit, null rate and repetition, reusing the Gesture harness's
    scoring.
  - The structured recovery path. First look for an existing observation
    point: events, the final reply, or the repair call sequence the budgeted
    client sees. Only if none distinguishes strict, lenient, repaired,
    salvaged and plain text, make a small refactor that exposes the outcome
    the executor already computes. It needs its own test and must preserve
    behavior.
  - Dropped invalid or unknown Gestures.
  - Latency, time to first token and time to first speech.
  - Tokens, cost, and errors and retries.
- **`plan` (dry run).**
  - Configurations, items by area and tier, repeats.
  - Planned calls, plus an upper bound that includes repairs.
  - Approximate first-turn input tokens per configuration.
  - Estimated USD from catalog rates or `--price`.
  - Judge batch counts, filled in by Phase 5.
  It needs no database or model.
- **`run`.** Runs in the container. It refuses to start without
  `--max-calls` and `--max-usd`, and it stops at whichever cap it reaches
  first. The USD estimate is updated from reported usage after each call.

Checks:
- Unit tests over the fake client:
  - interleaving order and warm-up exclusion;
  - capability refusal;
  - the cap on calls and on USD;
  - a partial run marked partial;
  - the recovery path for each outcome;
  - Annie's identity reaching the prompt;
  - input hashes.
- A mock smoke in the task stack:
  `run --tier smoke --standard --max-calls 200 --max-usd 0` with
  `ANIMAMA_LLM_SKIP=1`. It writes JSON Lines and a manifest, with no
  database writes.

Completion: tests and the smoke pass, and the review passes. Commit
`feat(evals)[p2]: add the core-turn model benchmark runner`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 3: Multi-turn and memory runners

Requirements: R2 (as revised), R5.

Changes:
- **Long chats.** The scripted-chat runner supports 30+ turns per persona,
  with the app's own history replay and pre-send compaction behavior. The
  utility role resolves the way chat resolves it.
- **In-chat memory** (D4, D5).
  - An in-memory `MemoryEntryRepository` and a no-op unit of work, plus a
    fake `AnimaRepository` with `is_owned_by_user`, `get` and
    `lock_definition`.
  - Stores are seeded from tracked fixtures: the Anima's `IDENTITY.md` and
    `MEMORIES.md`, and the user's `PROFILE.md` and other files.
  - The harness uses the real `MemoryEntryService`,
    `DirectChatMemoryContextService` and `DirectChatMemoryToolService`
    (with `AgentsSDKV4AMemoryPatchPlanner`).
  - A capturing chat manager and episode recorder record `record_turn` and
    the episode items.
  - Each memory turn records:
    - the memory tools offered and used;
    - the `remember` cues;
    - a diff of the store after the chat.
  - Recall is scored deterministically against `expect_recall`, a
    case-insensitive match over the spoken reply, wherever an item defines
    it.
- **Memory Manager.**
  - The harness builds `MemoryManagerRun` and its messages in memory, with
    fake episode and chat-message sources for the episode-processing and
    Reflection task inputs.
  - It calls the runtime chosen by `runtime_selector` directly.
  - For each approval request, it records the proposal, applies the edit to
    the fake store with the real patch planner, and resumes (spec R5,
    revised).
  - Budget, usage (including cached and reasoning tokens) and the served
    model come from the `model_wrapper` hook (OpenAI Agents) and the
    `client_factory` hook (Anthropic), which count against the same cap.
  - Agents SDK tracing is turned off as D5 decides.

Checks:
- Unit tests:
  - memory tools are offered according to the options and the row;
  - writes land only in the fake store;
  - no session or database access; a test asserts that
    `animama.local.database` is never imported by these runners;
  - recall scoring;
  - the approval loop with a fake runtime returning several proposals;
  - wrapper counting and the cap on both Memory Manager runtimes, using
    fake SDK clients.
- A mock smoke in the task stack covers one memory chat and one run of each
  Memory Manager kind. `DeterministicMemoryManagerRuntime` is used when LLM
  calls are skipped.

Recovery: if a real path cannot run without the database, stop. Record the
blocker, then present the D4 alternative (a disposable benchmark database)
to the owner. Do not change runtime code to get around it.

Completion: tests and smokes pass, and the review passes. Commit
`feat(evals)[p3]: add the multi-turn and memory benchmark runners`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 4: Prompt set v1, fixtures and rubrics (gate G2)

Requirements: R6, R7, R8, and the rubric parts of R9.

Changes:
- **Drafting.** Sub-agents draft the set from #409's 60 items and two
  scripted chats, in the Phase 2 format. Targets, to be confirmed at G2:
  - about 100–150 core-turn single-turn items, covering emotions,
    conversation beats, small talk, praise, jokes, advice, disagreement and
    spoken-style traps such as lists or code requests;
  - two to four long chats of 30 or more turns;
  - two to four memory chats, which plant facts and test recall, what is
    remembered and memory tool use;
  - Memory Manager fixtures: seeded memories, episodes and turns for general,
    episode-processing and Reflection runs.
- **Gesture loadout.** The 95 non-idle Included Gestures, pinned by hash,
  unless G2 chooses the current Included set.
- **Held-out slice (R7).** About 20% of items and chats per area, stratified
  by tag and chosen with a recorded seed. It is marked `held_out`, and the
  documentation states the no-tuning rule.
- **Rubrics.** One rubric per judged measure, with 1–5 anchors and an example
  for each anchor:
  - chat replies: relevance, warmth, persona consistency, spoken style and
    length;
  - avatar expression: Gesture, tone, intensity and coherence;
  - long chats: retention, repetition and consistency;
  - memory: remembering choices and tool use;
  - Memory Manager: proposal quality, accuracy and restraint.
  Each rubric has a JSON output schema.
- **Smoke subset** (D10), marked `tier: smoke`.
- **Content rules.** Everything is public-safe and synthetic. No personal
  data, no licensed content, English only.

Checks:
- The manifest validates.
- Every `acceptable` selector exists in the pinned loadout.
- The held-out share is 18–22% for each area.
- The `plan` output for full and smoke tiers is recorded here.
- A privacy scan (for example, no email addresses or phone numbers) runs
  over the set.

**G2 (owner):** the owner reviews and approves the prompt set, fixtures,
rubrics, sizes and loadout. Notes are resolved and the approval is recorded
here. Until G2, Phases 5–7 may continue, but Phase 8 may not start.

Completion: G2 recorded and the review passes. Commit
`feat(evals)[p4]: add the v1 benchmark prompt set and rubrics`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 5: Blind judging through the subscription CLIs

Requirements: R9, R10.

Changes (`scripts/evals/benchmark/judge.py` and related modules; standard
library only):
- **Blind batches.**
  - Judged replies get opaque random ids, with a seeded shuffle across
    configurations.
  - Batches have a fixed size per rubric.
  - The id-to-configuration mapping is kept in a separate file that is
    never sent to a judge.
  - A batch carries the persona text, the user message, recent context for
    chat turns, the reply's speech and its tone, intensity and Gesture
    (name and AI description), and reply lengths.
- **CLI adapters** (D7).
  - The Claude adapter runs `claude -p` and the Codex adapter runs
    `codex exec`, each with the pinned model (D6), the rubric as the system
    prompt or instruction, and the JSON schema.
  - The adapters validate the output against the schema and the batch ids.
  - Malformed output is retried twice, then recorded as missing.
- **Resume.** A ledger records one result file per batch and judge. A rerun
  skips batches already completed.
- **Usage limits.** The adapter detects the CLI's usage-limit or
  authentication failures, stops cleanly, and prints how to resume.
- **Records (R10).** Judge model id, CLI name and version, rubric version
  and hash, batch id and timestamps.
- **`plan` additions.** Judge batch counts and an estimate of tokens per
  batch for each judge.

Checks:
- Unit tests with a stub CLI executable:
  - no configuration identity appears in any batch prompt;
  - shuffle determinism;
  - schema and id validation;
  - retry, then missing;
  - resume without rescoring;
  - usage-limit stop.
- A live smoke, authorized by D8 at G1: two fixture batches per CLI, built
  from tracked hand-written replies.
  - Record the model ids, the CLI versions and the time per batch.
  - Inspect the JSON events to check that no user or project instructions
    were loaded (D7).

Completion: tests and the smoke pass, and the review passes. Commit
`feat(evals)[p5]: add blind subscription judging`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 6: Scores, statistics and report

Requirements: R7 (split), R9 (bias and agreement), R11 (agreement section),
R14, R15, R16 (re-render).

Changes:
- **Score merging.** Deterministic measures and judge scores are merged per
  reply. The headline is the mean of the two judges for each measure, with
  missing scores counted and shown.
- **Statistics** (D9). Bootstrap intervals, judge agreement, own-family
  preference, and the "not distinguishable" ranking language.
- **Report.**
  - The scorecard has configurations as rows and areas and measures as
    column groups, with quality, latency, tokens and cost side by side.
  - Separate sections cover tuned and held-out results, judges, calibration
    (filled in Phase 8), conditions, inputs and hashes, and limitations
    (D4 search ranking, D5 storage and tracing).
  - A placeholder for the owner's recommendation.
- **Public-safety guard.** `report` refuses to write when any judged reply or
  prompt text appears in the output. Only ids, numbers and tracked
  identifiers are allowed.
- **`report --rerender`.** Rebuilds the report from recorded JSON Lines and
  judge files without any calls.

Checks:
- Unit tests on fixture data:
  - bootstrap intervals with a fixed seed against known values;
  - kappa against hand-computed examples;
  - the own-family preference formula;
  - held-out split totals;
  - the safety guard;
  - re-render byte equality.
- A rendered sample report from the mock smoke run is attached to the phase
  record.

Completion: tests pass and the review passes. Commit
`feat(evals)[p6]: add benchmark scoring and reports`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 7: Skill, documentation and glossary

Requirements: R1, R18.

Changes:
- **The skill** `.agents/skills/animama-model-benchmark/`:
  - `SKILL.md` with this flow:
    1. Check the stack and CLIs.
    2. Run `plan`.
    3. Present the estimate and ask for approval and caps.
    4. Run `run`.
    5. Run `judge`, resuming across usage limits.
    6. Run `report`.
    7. Ask the owner to write the recommendation and link the report.
  - The skill never starts a paid run without explicit approval of that
    run's caps.
  - `agents/openai.yaml` and `references/` for the commands, the input
    format, the rubrics and judges, and reading reports.
- **Documentation.**
  - A benchmark README beside the inputs (location per G1) covering:
    - commands;
    - the prompt-set format and the held-out rule;
    - judge setup, including CLI sign-in and isolation;
    - conditions;
    - limitations.
  - A pointer from `docs/backend/README.md` or the closest model
    documentation.
- **Glossary.** "Benchmark area" and "Benchmark run" are added to
  `GLOSSARY.md` if G1 accepts them.

Checks:
- A mock-model rehearsal of the full skill flow on the task stack: smoke
  tier, stub judge, rendered report.
- Docs links resolve.
- The full `uv run pytest -q`.
- `make check-test`.

Completion: the rehearsal is recorded and the review passes. Commit
`feat(evals)[p7]: add the model benchmark skill and docs`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 8: First benchmark run and calibration (gates G3, G4)

Requirements: the acceptance items "First benchmark run" and "Calibration"
(R11, R15).

Steps:
1. Start a development task stack from this checkout with the secrets env
   file. Confirm `models` lists both built-in chat rows.
2. Run `plan --tier full --standard` and record its output here.
   - Planning-time rough estimate, from a G2-sized set of about 120 items,
     2 personas, 3 repeats, 4 long chats, 4 memory chats and 9 Memory
     Manager runs: about 7,000 contestant calls across six configurations.
   - That is roughly $2–6 at catalog rates, and about four hours of serial
     calls.
   - The dry run replaces this estimate.
3. **G3 (owner):** the owner approves this run with `--max-calls` and
   `--max-usd`. Record the approval and the caps.
4. Run `run`, then take the stack down. Raw results stay in the drafts
   folder.
5. Run `judge` for both judges, resuming across usage windows. Record the
   batches, missing scores and elapsed time.
6. **G4 (owner):**
   - `calibrate export` draws a stratified blind sample of 30–40 replies
     across areas, configurations and score ranges.
   - The owner rates it with the rubrics, and `calibrate import` records
     the ratings.
   - Judge-to-owner agreement is computed per judge and measure.
7. Run `report`. Then:
   - Track the report at the location agreed at G1.
   - Verify that `report --rerender` reproduces it byte for byte.
   - Have the owner write the recommendation.
   - Link the report from #470.

Recovery:
- A run stopped by a cap or interruption keeps its partial results. The
  owner decides whether to approve a continuation. No continuation tooling
  is planned: rerun with a new cap.
- A judge stopped by a usage limit resumes later.

Completion: G3 and G4 recorded, the report tracked, the re-render
verified, and the review passes. Commit
`docs(evals)[p8]: record the first model benchmark`.

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

The review covers combined acceptance against the spec's acceptance criteria
on the final candidate after merging `main`. It reuses phase evidence that
is still valid. One full review and at most two repair rounds.

## Validation and acceptance

Spec acceptance mapped to evidence:

| Spec criterion | Evidence |
| --- | --- |
| Dry run | `plan` outputs (Phases 2, 4, 8) |
| Free end-to-end run | Phase 7 mock rehearsal |
| Budget enforcement | Phase 2 and 3 tests |
| Blind judging | Phase 5 tests and smoke |
| Measures | Phase 2, 3 and 6 tests |
| Compatibility | Phase 1 parity diff and tests |
| Prompt set | G2 |
| Calibration | G4 |
| First benchmark run | Phase 8 report and re-render |
| Skill | Phase 7 rehearsal |
| Local checks | Phase 7 and the final review |

Hosted validation stays the owner's call. The PR records local evidence and
the actual hosted `Validation` scope separately. Changes under `scripts/`
select full CI.

## Idempotence and recovery

- `plan`, `report --rerender` and mock runs are free and repeatable.
- `run` always writes to a new run directory and never overwrites. Finished
  turns survive interruption.
- `judge` resumes from its ledger and never rescores a completed batch.
  Deleting a batch file rescores only that batch.
- Task stacks are named and project-scoped. Take them down after the last
  use, and never stop another task's stack.
- Phase 1 is a revertible refactor. No phase changes runtime behavior; any
  allowed refactor is covered by tests.

## Outcomes & Retrospective

Not started.
