# Standardized model benchmark execution plan

Status: In progress. G1 passed on 2026-10-25. The remaining gates are G2,
G3 and G4.

Source agreement: the spec, published as the body of
[#470](https://github.com/raymond-van/animama/issues/470) at
`2026-10-26T02:24:13Z`, which is authoritative. The tracked
[snapshot](model-benchmark-spec.md) records that capture. The spec follows
the owner's discovery answers of 2026-10-12 and 2026-10-25 and the owner's
spec answers of 2026-10-25, recorded on #470 in the
[2026-10-12 brief](https://github.com/raymond-van/animama/issues/470#issuecomment-6134798047)
and the
[2026-10-25 brief](https://github.com/raymond-van/animama/issues/470#issuecomment-6406329265).
The owner reviewed it at `cb9c50a4` and this plan at `53adb22f`.

Authorized scope: the whole plan. The owner invoked `/implement` on
2026-10-25 after reviewing the spec and this plan. Gates G2, G3 and G4 still
require the owner's action. Exact-candidate merge approval stays separate.

Starting source: `18d2bebd` (`origin/main`, 2026-10-25, which includes the
#704 prompt cleanup from PR #710). `origin/main` `a94f8369` was merged into
the branch at `165b2a09` before implementation; it touched no chat or
evaluation code. Checkout `worktrees/animama/model-benchmark-discovery-d321cc`,
branch `feat/model-benchmark` (renamed from `docs/model-benchmark-spec`),
pushed to `origin`. One branch and one PR carry the spec, the plan and the
implementation.

## Purpose and context

After this plan, the owner can benchmark Animama's chat models with one
skill, `animama-model-benchmark`, or with its documented commands. The first
use decides between `gpt-6-luna` and `claude-haiku-5-5`, and informs the
episodic-memory design. The flow:

1. A dry run states the calls, the estimated cost, the judge batches and the
   estimated wall time.
2. The owner approves a capped run.
3. Four configurations (Luna and Haiku, each at reasoning effort none and
   low) run through the app's real chat and Memory Manager code on a
   development task stack. Every turn carries ElevenLabs voice options.
   Japanese turns carry UI Locale `ja`. Memory chats run in three memory
   arms.
4. Claude Opus 5.5 scores the replies blind through the owner's Claude
   subscription (`claude -p`).
5. A tracked, public-safe report gives a scorecard per benchmark area,
   beside latency, tokens and cost.

The first decision run is part of this plan, together with the one-time
calibration against the owner. The calibration also settles the judge's
reasoning effort.

Benchmark areas in v1:
- **Core turn** (spec R4): chat replies, avatar expression and its
  distributions, Audio tags and spoken style, structured-output reliability,
  and operations.
- **Multi-turn and memory** (spec R5–R7): long chats, in-chat memory, the
  episodic-memory comparison and Memory Manager runs.
- **Japanese** (spec R9): a paired subset across both areas.

Ownership and boundaries:

- **Tooling.** All benchmark code lives under `scripts/evals/`, with tests
  under `tests/`.
  - The repository import-boundary check
    (`scripts/repository-boundary/check-python-imports.py`) audits only
    `src/backend`. Benchmark code therefore stays in `scripts/` and never
    moves into `animama.app`.
  - mypy reaches `scripts/evals` only through the tests that import it, so
    every module gets a typed test.
- **Runtime.** Only Phase 3 changes `src/backend`. It adds the memory-arm
  seams (spec R6) as executor-level parameters whose defaults are today's
  behavior. Production wiring never sets them, and HTTP request options
  cannot reach them.
  - The structured recovery outcome may also need a small,
    behavior-preserving refactor; Phase 2 checks whether it does.
  - No other runtime change is planned (spec non-goal).
- **The two parts run in different places:**
  - **Contestants** run inside the backend container of a development task
    stack. The configured model connections and keys live there. Only the
    development Compose selection bind-mounts the checkout at `/app`, and the
    built image has no `scripts/`.
  - **The judge** runs on the host, where the owner's `claude` CLI is signed
    in.
  - The judge and report modules use only the standard library and never
    import `animama`, so plain `uv run python -m …` on the host works.
  - Raw results move between the two through the bind-mounted, git-ignored
    `.animama-drafts/` folder.
- **Memory storage** (D4). Memory runs use the real SQLAlchemy memory
  repositories, over a disposable benchmark database in the task stack's
  PostgreSQL. The stack's application database is never opened for writes.
- **Skills.** Skill source lives under `.agents/skills/<name>/`, with
  `SKILL.md`, `agents/openai.yaml` and `references/`, and `.claude/skills`
  points there.
- **Prior art.** The Gesture selection harness
  `scripts/evals/gesture_selection.py` (#409, PR #462) and its tracked inputs
  under `docs/plans/gesture-catalog-expansion/`. Its CLI, inputs and outputs
  must not change (spec R19).

## Progress

- [x] G1: the owner agrees the spec and this plan, including every decision
      marked "proposed" in the Decision Log and the spec's unconfirmed
      proposals. Passed on 2026-10-25: the owner invoked `/implement` (see
      the Decision Log).
- [x] Workspace setup (2026-10-26, recorded under Setup and execution
      rules).
- [x] Phase 1: Shared evaluation core extracted; Gesture harness unchanged.
      Passed review #2 on 2026-10-26.
- [x] Phase 2: Core-turn runner, turn options and dry run. Passed review #2 on
      2026-10-26.
- [ ] Phase 3: Memory-arm seams in chat, with defaults unchanged.
- [ ] Phase 4: Multi-turn, memory-arm and Memory Manager runners.
- [ ] Phase 5: Prompt set v1, Japanese subset, fixtures and rubrics (gate
      G2).
- [ ] Phase 6: Blind judging through `claude -p`.
- [ ] Phase 7: Scores, statistics and report.
- [ ] Phase 8: Skill, documentation and glossary.
- [ ] Phase 9: First decision run and calibration (gates G3, G4).
- [ ] Final integration review.

## Surprises & Discoveries

### 2026-10-12, planning-time inspection of `95a2db39`

These findings were made before any implementation. The line numbers are
from that revision; locate the code by name on later revisions. The names
were rechecked on `18d2bebd`.

- **In-chat memory writes require incognito off.**
  - `build_memory_tool_config` (`app/chat/direct_turn/provider_state.py`)
    enables memory writes only when updates are on and the turn is not
    incognito.
  - On OpenAI Responses, incognito off means `store=true`, and tool rounds
    continue from `previous_response_id`.
  - A non-incognito turn also calls `chat_manager.record_turn` and the
    episode recorder (`app/chat/direct_executor.py`). The harness's chat
    stand-in must capture these calls; today's `_EvalChats` cannot.
- **No in-memory memory repository ships in `src`.** The test fakes in
  `tests/test_memory_files.py` use substring search. See D4.
- **The Memory Manager can run outside the HTTP flow.**
  - Its runtimes (`adapters/memory_manager/`) read only from
    `MemoryEntryService`. Proposals come back as
    `MemoryManagerRuntimeApprovalRequest` objects
    (`app/ports/memory_manager_runtime.py`).
  - Each proposal pauses the run, and resuming with "approve" assumes the
    edit was already applied. The harness therefore applies each edit to its
    own store before it resumes (spec R7).
- **The OpenAI Memory Manager runtime bypasses `ModelClient`.**
  - It uses the OpenAI Agents SDK with its own `AsyncOpenAI` client, sends
    `store=true` and traces on the built-in connection.
  - Its `model_wrapper` hook lets the harness count calls, enforce the cap
    and read full usage. The Anthropic runtime offers a `client_factory`
    hook.
  - Both runtimes report only requests, input, output and total tokens.
    Cached and reasoning tokens need the wrapper.
- **The persona enters through the memory context.** The Anima's identity
  reaches the prompt through `DirectChatMemoryContext.anima_identity` and
  `anima_name`. The Gesture harness injects its neutral identity this way
  (`_NeutralMemoryContext`). Annie's text is `STARTER_ANIMA_SPECS`' first
  entry's `identity_markdown` (`app/services/anima_starter_service.py`).
- **Model snapshot.** The Gesture harness does not record the model the
  provider served. `ModelClientFinal.raw_provider_metadata["model"]` carries
  it for both OpenAI protocols; Anthropic echoes the requested id.
- **Harness seams.** The generic pieces in
  `scripts/evals/gesture_selection.py` are:
  - the budgeted client (`_BudgetedModelClient`) and call records;
  - the stand-ins;
  - executor setup;
  - usage and cost;
  - replay;
  - statistics;
  - catalog and registry helpers.
  Tests patch `gesture_selection.load_model_provider` and `build_registry`,
  and call `_read_only_model_providers` and `_run` on that module. Those
  names must stay there. The database import must stay lazy for the
  conftest's engine patch.
- **Formatting.** `make format-check` formats only `src/backend/animama` and
  `tests`, while `ruff check` covers `scripts/`. Each phase adds
  `uv run ruff format --check scripts/evals`.

### 2026-10-25, planning-time inspection of `18d2bebd`

- **Where `MEMORIES.md` writes are allowed.** Two places decide it:
  - The write guidance (`ANIMA_MEMORIES_WRITE_GUIDANCE`) enters the prompt
    only when the executor passes `anima_memories_writable`, which needs a
    write tool and an opened `MEMORIES.md` version.
  - The tools accept the `[self]/MEMORIES.md` alias only when
    `MemoryToolExecutionContext.anima_memories` is set. `None` refuses reads
    and writes alike.
  - So arm (a) needs a seam that refuses only writes, keeping the alias's
    reads (spec R6: reads are the same in every arm).
- **Where `remember` lives.** In `app/main_structured_response.py`:
  - the output model;
  - the strict JSON schema builder;
  - the JSON-mode instruction, which lists the property order;
  - parsing.

  Its guidance is in `app/chat/memory_context.py` (the memory-store list
  and the response guidance) and in `app/chat/anthropic_instructions.py`.
  Arm (b) needs a schema variant and guidance variants. Parsing already
  treats a missing `remember` as `None`.
- **Memory search is PostgreSQL full-text search.**
  `SQLAlchemyMemoryEntryRepository.search_files` uses
  `websearch_to_tsquery('english', …)` and `ts_rank_cd` over a stored
  generated `to_tsvector('english', path || description || content)` column.
  - Memory tables have no foreign keys to owner, Anima or chat tables; only
    `memory_entries.parent_id` references itself. A database holding only
    the baseline schema can therefore run the real repositories without
    seeding owners or Animas.
  - The test suite already creates a database per xdist worker in a shared
    container (`tests/conftest.py`).
- **Japanese episode search is likely weak in the real app.**
  - The `english` configuration does not segment Japanese, so a Japanese
    query probably matches only identical unbroken character runs.
  - Arm (a)'s Japanese recall may therefore fail through the app's own
    search, not through a benchmark fault.
  - Phase 4 confirms this with a read-only SQL probe, and the report states
    it as an app finding. Changing search is out of scope.
- **Turn options.**
  - `DirectChatOptions.tts` (`enabled`, `provider`, `language_code`) selects
    the Speech and Audio-tag section (`app/chat/speech_tags.py`), and the
    executor itself never calls text-to-speech.
  - `native_tools` empty means no web search, hosted or application.
  - HTTP turn setup (`product_http/chat/turn_setup.py`) resolves
    `conversation_language(ui_locale)` and applies `with_speech_language`;
    the harness reuses both helpers.
  - Turn setup also prepares companion safety, including provider moderation
    on OpenAI Responses. Phase 2 checks which of this the Gesture harness
    mirrors, and the report records the setting.
- **Judge CLI.** On the owner's machine, `claude` is version 2.1.303. It
  supports `--model`, `--effort` (low, medium, high, xhigh, max),
  `--json-schema`, `--output-format json`, `--system-prompt`, `--tools ""`,
  `--no-session-persistence` and `--restricted`, which ignores user, project
  and local settings files.
  - `--bare` is not used: it reads only `ANTHROPIC_API_KEY`, which would bill
    the API instead of the subscription.
  - The Codex CLI is no longer needed (spec R12).
- **Prompt sizes after #704.** The #704 session measured an Annie first turn
  at about 14.3k input tokens on Luna, of which the Gesture list is about 6k
  and the web search tool about 4.4k. Haiku counts about 28% more for the
  same turn.
  - Without web search (spec R2), a first turn is roughly 10k tokens on Luna
    and 12.5k on Haiku.
  - The dry run replaces these figures.

## Decision Log

- **2026-10-12, owner (first discovery):** the decisions listed as agreed in
  the spec.
- **2026-10-25, owner (second discovery and spec answers):** the decisions
  listed as agreed in the spec:
  - efforts none and low;
  - Opus 5.5 as the only judge;
  - scripted turns;
  - ElevenLabs on every turn;
  - a paired Japanese subset;
  - side-by-side distributions;
  - three memory arms with candidate guidance and shared files kept;
  - web search off;
  - a 4-hour run bound;
  - the first decision run inside v1.
- **2026-10-25, owner (workspace):** the 2026-10-12 drafts were moved from
  `worktrees/animama/model-benchmark-spec` into this checkout. That worktree
  and its empty branch were removed.
- **2026-10-25, owner (task instruction):** the owner invoked `/to-execplan`
  after the revised spec. That instruction did not accept the spec's
  proposals or the proposed decisions below; they stayed open until G1.
- **2026-10-25, owner (G1, task instruction):** the owner invoked
  `/implement` after reviewing the spec at `cb9c50a4` and this plan at
  `53adb22f`. That accepts:
  - the spec's proposals;
  - the decisions D1–D13 and D15 below, with D14 settled at G2;
  - the Phase 6 subscription smoke (D8).
  The spec was published to #470 with those proposals marked accepted.
  "Proposed (G1)" below now means agreed at G1.
- **D1 (proposed, G1). Code layout.**
  - `scripts/evals/core/` holds the extracted generic pieces.
  - `scripts/evals/benchmark/` holds the benchmark, with one module per area,
    and runs as `python -m scripts.evals.benchmark <command>`.
  - `gesture_selection.py` imports the core and keeps its own CLI and its
    patched names.
- **D2 (proposed, G1). Commands.** The skill runs these in order:
  - `plan`: the dry run, which needs no database or model;
  - `run`: runs the configurations in the container;
  - `calibrate export|import|pilot`: the one-time calibration and the judge
    effort pilot;
  - `judge`: runs the judge on the host and can resume;
  - `report`: renders, and re-renders, from recorded data;
  - `models`: lists catalog rows;
  - `cleanup`: drops leftover benchmark databases.
- **D3 (proposed, G1). Raw results.**
  - Contestant turns are appended as JSON Lines, one line per turn, under a
    run manifest, so an interrupted run keeps every finished turn (spec R18).
  - Judge outputs are kept per batch file.
  - Everything goes under `.animama-drafts/model-benchmark/<run-id>/`.
- **D4 (proposed, G1; replaces the 2026-10-12 in-memory store). Memory
  storage.**
  - **Database.** Memory runs use the real SQLAlchemy memory-entry and
    episode repositories, the real `MemoryEntryService`,
    `DirectChatMemoryContextService`, `DirectChatMemoryToolService` (with
    `AgentsSDKV4AMemoryPatchPlanner`) and the real episode recorder. They
    run over a disposable database `animama_benchmark_<run id>` in the task
    stack's PostgreSQL.
    - The database is created from `alembic/versions/0001_baseline.sql` and
      seeded from tracked fixtures.
    - Each memory arm, configuration and chat gets its own user id, so
      their stores never mix.
    - The database is dropped when the run ends.
    - Chats, the Anima and other repositories remain in-memory stand-ins.
  - **Why.** Spec R6 requires the app's full-text search behavior. Memory
    tables need no owner or Anima rows (see Discoveries), so the 2026-10-12
    reason for rejecting a database no longer holds. The 2026-10-12
    token-match stand-in would misreport search, especially for Japanese.
  - **Guards.** The harness never opens the application database for
    writes. Database creation and dropping refuse any name without the
    `animama_benchmark_` prefix.
- **D5 (proposed, G1). Provider storage (spec R2).**
  - Core-turn and long-chat turns run incognito (`store=false`).
  - Memory turns and OpenAI Memory Manager runs keep the app's real storage.
  - The harness turns off Agents SDK tracing for Memory Manager runs only,
    if a hook allows that without changing the requests the model sees.
    Otherwise the report records that tracing was on.
- **D6 (proposed, G1). Judge model.** `claude-opus-5-5`, pinned by full id.
  - Phase 6 confirms the id with a tiny call and records it.
  - The effort is medium or high, chosen by the calibration pilot (D15).
- **D7 (proposed, G1). Judge isolation.**
  - The judge runs `claude -p --restricted --tools "" --system-prompt
    <rubric> --no-session-persistence --output-format json --json-schema
    <schema> --model claude-opus-5-5 --effort <level>`, from an empty
    temporary directory.
  - Phase 6 checks that no user instructions, memory, hooks or project files
    reach the judge. If any do, it records how they were excluded.
- **D8 (proposed, G1). Phase 6 subscription use.** G1 approval also covers a
  live judge smoke: at most four fixture batches (two at medium effort, two
  at high) on the owner's Claude subscription, with no API spend.
- **D9 (proposed, G1). Statistics (spec R16).** Implemented in pure Python,
  with no new dependency (`numpy` is only in the `voice` extra).
  - **Spread:** a seeded bootstrap that resamples items, keeping repeats
    together (2,000 resamples), giving a 95% interval.
  - **Paired differences:** a paired bootstrap over English–Japanese item
    pairs and over memory-chat checklists across arms.
  - **Judge-to-owner agreement:** quadratic-weighted kappa, plus exact and
    within-one agreement.
  - **Ranking language:** two configurations, arms or languages are "not
    distinguishable" when their intervals overlap.
- **D10 (proposed, G1). Smoke tier.**
  - `--tier smoke` takes a fixed, tracked subset of the prompt set: about 20
    single-turn items (4 of them Japanese), one persona, one repeat, one
    shortened scripted chat, one memory chat in all three arms with its
    recall chat, and one Memory Manager run.
  - It is used on the mock model for wiring checks, or as a cheap paid
    regression run under the same approval rule.
  - `--tier full` is the decision run.
- **D11 (proposed, G1). Memory-arm seam design (spec R6, Phase 3).**
  - One frozen value, working name `EpisodicMemoryArm`, with three fields:
    - `remember: bool`, default true;
    - `anima_memories_writes: bool`, default true;
    - `anima_memories_write_guidance: str | None`, default `None`, meaning
      today's text.
  - It is passed to `DirectChatTurnExecutor`'s constructor. Production
    wiring (`product_http/chat/turn_setup.py`) does not pass it, and
    `DirectChatOptions` does not carry it, so HTTP request options cannot
    set it.
  - Arm (a) sets `anima_memories_writes=false`. Arm (b) sets
    `remember=false` and supplies the tracked candidate guidance text. Arm
    (c) uses the defaults.
  - The candidate text lives in the prompt set, never in `src`.
  - The defaults produce byte-identical prompts, schemas and tool lists for
    both providers, which Phase 3 proves with golden comparisons.
- **D12 (proposed, G1). Duration estimate (spec R14).**
  - The dry run's estimate is:
    - contestant calls × seconds per call, using provider defaults from
      #409's medians (about 2 s) plus a memory-turn allowance for tool
      rounds, overridable with `--seconds-per-call`;
    - plus judge batches × seconds per batch, divided by judge concurrency.
  - Seconds per batch and the concurrency (proposed: two parallel `claude
    -p` processes) are measured in Phase 6 and stored as tracked defaults.
  - A plan over 4 hours does not start unless `--over-time-approved` is
    passed. That flag records the owner's exception in the manifest.
- **D13 (proposed, G1; sizes are set at G2). Planning estimate per
  configuration:**

  | Part | Turns |
  | --- | --- |
  | Single-turn English: about 72 items × 2 personas × 1 repeat | 144 |
  | Long chats: 2 × 30 turns | 60 |
  | Japanese: about 24 items × 2 personas | 48 |
  | Memory: 3 arms × (3 memory chats of about 12 turns, one of them Japanese, plus 3 recall chats of about 4 turns) | about 144 |
  | Memory Manager: 6 runs | about 30 calls |

  - That is about 400 turns per configuration, or about 1,600 turns and
    2,200 calls in total, including tool rounds and repairs. At about 2.5 s
    per call this takes about 1.5 hours.
  - About 1,250 judged items in batches of about 20 give about 65 judge
    batches.
  - The estimated contestant cost is about $1–3 at catalog rates.
- **D14 (proposed, G2). Personas.**
  - Single-turn items, English and Japanese, run under both personas.
  - Each long chat runs under one persona, one chat per persona.
  - Memory chats run as Annie, whose `MEMORIES.md` fixture they use.
  - G2 may cross the chats with both personas if the time bound allows.
- **D15 (proposed, G1). Calibration and the effort pilot (spec R13).**
  1. After the contestant run, `calibrate export` draws a stratified, blind
     sample of 30–40 English replies.
  2. The owner rates it (G4).
  3. `calibrate pilot` judges the same sample at medium and at high effort.
     The effort with the higher weighted kappa against the owner is pinned,
     and medium wins a tie.
  4. Full judging then runs at the pinned effort.

  Calibration and the owner's rating time are a one-time cost of the first
  run and do not count toward the 4-hour bound. Later runs reuse the pinned
  effort.

## Implementation orientation

The executor and its wiring:
- `DirectChatTurnExecutor` is in `src/backend/animama/app/chat/direct_executor.py`.
  Its prompt assembly passes `anima_memories_writable` to the prompt
  assembler. Its structured parse and `remember` capture follow the final
  model call.
- Production wiring is in `src/backend/animama/product_http/chat/turn_setup.py`,
  including `conversation_language` and `with_speech_language`.

The real pieces the harness reuses:
- the memory context (`app/chat/memory_context.py`) and the prompt assembler
  (`app/chat/openai_prompt.py`; `app/chat/anthropic_instructions.py` for the
  Anthropic text);
- the memory tool service (`app/chat/memory_tools.py`), with
  `AgentsSDKV4AMemoryPatchPlanner` (`adapters/memory_patch.py`);
- `MemoryEntryService` (`app/services/memory_entry_service.py`) and
  `SQLAlchemyMemoryEntryRepository`
  (`adapters/repositories/sqlalchemy/memory_entry_repo.py`);
- the structured response model and schema
  (`app/main_structured_response.py`);
- the Speech and Audio-tag section (`app/chat/speech_tags.py`);
- the Memory Manager runtime selector
  (`adapters/memory_manager/runtime_selector.py`);
- the episode-processing and Reflection task inputs
  (`adapters/memory_manager/episode_processing.py`, `reflection.py`).

Useful test patterns:
- the fakes in `tests/test_direct_chat_turn_executor.py` (`_FakeChatManager`,
  `_FakeMemoryEpisodeRecorder`) and `tests/test_memory_files.py`;
- `tests/anthropic_fakes.py`;
- the Agents model wrapper in `tests/test_model_call_boundary.py`;
- the per-worker database creation in `tests/conftest.py`.

Turn options:
- core turn: `DirectChatOptions(incognito=True, tts=<ElevenLabs enabled>)`,
  with no `native_tools`;
- memory turns: `incognito=False`, `disable_memory_influence=False` and
  `disable_memory_updates=False`, with the same `tts`;
- Japanese turns: the above, after `with_speech_language(options,
  conversation_language("ja"))`, with the request's `conversation_language`
  set to match.

A model row with `allow_memory_writes=false` removes write tools.
`build_memory_tool_config` records which tools a turn actually had.

## Setup and execution rules

When implementation is authorized:

1. Run `workspace-setup`. It publishes the agreed spec to #470 and reads it
   back, marks the spec file as a snapshot, and renames the branch (see
   Starting source).
   - No phase issues are created. One session implements the plan in one
     repository with no separately assigned phase, so the parent and the
     phase sections track it (SDLC artifact ownership).
   - **Workspace record (2026-10-26):**
     - **Repository:** `raymond-van/animama`.
     - **Checkout:** `worktrees/animama/model-benchmark-discovery-d321cc`
       (Git root verified).
     - **Branch:** `feat/model-benchmark`, tracking `origin/feat/model-benchmark`.
     - **Base:** `main`, with `a94f8369` merged at `165b2a09`.
     - **Spec authority:** the #470 body at `2026-10-26T02:24:13Z`, read back
       byte-equal to the published file. The issue was retitled
       "feat: standardized model benchmark skill for chat models".
     - **Environment:** `.venv` on Python 3.12.13 (`uv sync --python 3.12.13`).
     - **Stack:** none started yet. Phase 2's smoke starts a named stack and
       records its URL here.
     - **Gates outstanding:** G2, G3, G4.
2. Work test-first. Offline tests use the existing fake model clients and
   scripted streams, and never use keys, the network or the judge CLI. Judge
   tests use a stub CLI script. Database tests use the suite's PostgreSQL
   fixtures.
3. Use a named task stack only for container smoke runs (Phases 2, 4 and 8)
   and the paid run (Phase 9). Check `docker ps` for port conflicts first.

   ```bash
   ANIMAMA_LLM_SKIP=1 ./reset.sh --name bench --base-port <free port>
   source .animama-stack.env
   ```

   The paid run uses a stack started with
   `COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"`.
   Never copy, source or print secret files. Run `git lfs pull` first if the
   worktree holds LFS pointers. Take the stack down right after its last use.
4. If a worktree venv resolves to Python 3.14, run
   `uv sync --python 3.12.13`.
5. Before each phase commit:
   - Run the phase checks and keep the check record (SDLC check records).
   - Get an independent `sdlc-reviewer` review at the phase's tier: one full
     initial review and at most two repair rounds. Light phases may skip
     their own review; the final integration review then covers them.
   - Commit as `<type>(evals)[p#]: <summary>`. Phase 3 uses scope `chat`.
   - Stop and report blockers left after the repair budget.
6. Phases run in order, with two exceptions:
   - Phases 6–8 may proceed while G2 is pending.
   - Phase 5's drafting may start once Phase 2's format exists.
   Phase 9 needs G2, G3 and G4.
7. No paid contestant call before G3. No subscription judge call before G1,
   which covers the Phase 6 smoke (D8). Free mock runs need no approval.

Standard checks for each phase, run from the repository root:

```bash
uv run pytest -q tests/test_gesture_selection_eval.py tests/test_model_benchmark_*.py
uv run ruff check
uv run ruff format --check scripts/evals tests
make format-check
make mypy
```

The high-risk phases (3 and 4) also run the full pre-push suite before their
review, as a heavy job:

```bash
python3 scripts/heavy-slot.py -- make check-test
```

Frontend checks are not needed, because there is no frontend change.

## Phased implementation

### Phase 1: Shared evaluation core extracted; Gesture harness unchanged

Review tier: standard. A behavior-preserving refactor across several
`scripts/evals` modules, with a parity check against the existing tests.

Requirements: R19, and the groundwork for R2, R14 and R18.
Starting source: `18d2bebd`, after G1.

Changes (`scripts/evals/core/`, D1):
- **What moves.** The generic pieces listed under Discoveries:
  - the budgeted model client and call records;
  - pricing and cost;
  - usage and timing helpers;
  - statistics;
  - the read-only catalog, registry and model listing;
  - the executor builder and turn options;
  - replay and history;
  - writing outputs with an injected renderer.
- **Parameters.** The turn request builder takes the Gesture list, `tts`,
  conversation language and native tools as parameters. The Gesture harness
  passes its current values: no `tts`, no language, no tools. The stand-ins
  take an identity and a name instead of hard-coding the neutral persona.
- **The Gesture harness.** `gesture_selection.py` imports the core and keeps:
  - `load_model_provider`, `build_registry`, `_read_only_model_providers` and
    `_run` as module-level names that the tests patch;
  - its `__all__`;
  - lazy database imports.
- **Two additions:**
  - the budgeted client records the provider-reported model from
    `raw_provider_metadata`;
  - the budgeted wrapper becomes reusable for any client.

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

Completion: the checks pass and the review passes. Commit
`refactor(evals)[p1]: extract the shared evaluation core`.

Recovery: a pure refactor. Revert the commit if the parity diff cannot be
made clean.

Check record (2026-10-26). Every command ran from the repository root on
working tree `baac7590` (index-copy hash; starting commit `23cf9faf`):

| Check | Command | Result |
| --- | --- | --- |
| Dry-run parity | The documented dry run in `gesture-selection-eval.md`, `--repeats 3 --scripted-repeats 1 --max-calls 800`, on `23cf9faf` and on the tree, then `diff` | Identical; exit 0 |
| Run parity | `PYTHONPATH=. uv run --no-sync python <scratch>/p1_parity.py <dir>` on both | Identical `results.json` (wall-clock timestamps removed) and `summary.md`; 263 calls, 240 turns, 23 repairs |
| Tests | `uv run --no-sync pytest -q tests/test_model_benchmark_core.py tests/test_gesture_selection_eval.py` | 44 passed (30 existing, unchanged; 14 new) |
| Lint | `uv run --no-sync ruff check` | Passed |
| Format | `uv run --no-sync ruff format --check scripts/evals tests`; `make format-check` | Passed |
| Types | `make mypy` | Passed (865 files) |

- **Run parity.** `p1_parity.py` is a scratch script, not tracked. It loads
  the tracked baseline and candidate loadouts and the #409 prompt set, and
  runs `run_evaluation` against a deterministic fake client and fake clock.
  The fake answers every eleventh call with invalid JSON, so structured
  repairs are exercised.
- **Mock composition.** The existing test
  `test_cli_composition_runs_against_the_mock_model_client` covers the
  `ANIMAMA_LLM_SKIP=1` composition through `_run`, so no stack smoke was
  needed for parity.
- **Intended differences:**
  - `_NoAnimaProfile`'s never-expected error now reads "The evaluation
    always names its model provider";
  - call records gain `served_model`, which the Gesture harness does not
    output;
  - the file can no longer run as a plain script. Its documented
    `python -m scripts.evals.gesture_selection` form is unchanged.
- **Deviations from the planned Changes:**
  - `write_outputs` stays in the Gesture harness. The benchmark writes JSON
    Lines and a manifest (D3), not `results.json` and `summary.md`, so a
    shared writer would have one user.
  - The turn request builder takes `conversation_language` and
    `provider_moderation`, defaulting to an English turn without
    moderation. Native tools stay `DirectChatOptions`' default empty tuple,
    so no turn offers web search (spec R2). No parameter is needed for a
    value that never changes.

Repair round 1 re-ran every check above on working tree `48a1736e` (`scripts/evals` subtree `12103475`; the plan holds only its own records). The
dry-run and run parity were identical again, 46 tests passed, and ruff,
both format checks and `make mypy` passed.

Commits: `refactor(evals)[p1]: extract the shared evaluation core` (its hash is
recorded in Phase 2's record).

#### Code Review #1 Findings

Reviewer: an independent `sdlc-reviewer` subagent at the standard tier, on
working tree `baac7590` against `23cf9faf`. It reused every check in the
record and reran none; it ran three read-only `--help` probes as evidence for
P1-F6. Its result: changes required.

It confirmed:
- the extraction is faithful apart from the declared differences;
- the R19 surface is unchanged: the docstring, `__all__`, the CLI and the
  result schema;
- the patched names still resolve through module globals, and database
  imports stay lazy;
- budget, refusal, abort and history-replay semantics are unchanged;
- the new tests cover what the plan requires.

The findings:
- **P1-F1 (required).** The plan lists "writing outputs with an injected
  renderer" as moving, but `write_outputs` stayed in the harness and the
  record does not say so.
- **P1-F2 (required).** The plan says the request builder takes the
  conversation language and native tools, but `turn_request` takes neither,
  and that is not recorded. Phase 2's Japanese turns need the language.
- **P1-F3 (optional).** Measuring the prompt after the stream leaves
  `instruction_bytes` and the token estimate `null` when the first turn of a
  loadout is interrupted. That is a partial-result change beyond the
  declared latency difference.
- **P1-F4 (optional).** `build_executor(memory_context: object)` disables
  type checking on the parameter that Phases 3 and 4 vary.
- **P1-F5 (optional).** The new comment claims #409 measured the no-tags
  speech rules. The Speech section postdates #409 (`dfbcbc46`, 2026-10-14).
- **P1-F6 (optional).** The leftover shebang suggests the file runs as a
  plain script. Relative imports now prevent that; the `-m` form still
  works.

#### Code Review #1 Revisions

- **P1-F1: accepted.** `write_outputs` stays in the harness, and the
  deviation is recorded above with its reason.
- **P1-F2: accepted.**
  - `core.chat.turn_request` gained `conversation_language` and
    `provider_moderation` (defaults: none, false).
  - The new test `test_turn_request_carries_the_language_and_moderation`
    covers them.
  - Native tools are recorded as a deviation (above).
- **P1-F3: accepted.**
  - `core.turns.execute_turn` gained `on_prepared`, called after prepare and
    before the stream.
  - The harness measures the prompt there, as the baseline did, so the
    latency difference is withdrawn from the declared list.
  - The new test `test_execute_turn_shows_the_prepared_turn_before_it_streams`
    covers the order. Run parity stays identical.
- **P1-F4: accepted.** `build_executor` takes
  `DirectChatMemoryContextService | StaticMemoryContext`. The cast for the
  stand-in remains, with a comment.
- **P1-F5: accepted.** The comment now reads "No voice, as in #409's runs;
  the prompt now carries the no-tags speech rules."
- **P1-F6: accepted.** The shebang is removed. The plain-script change is
  declared above.

Verification: the repair-round check record above. P1-F5 and P1-F6 are
trivial repairs, verified by the checks. P1-F2, P1-F3 and P1-F4 go to a
targeted recheck (Code Review #2). Repair rounds left after this one: 1.

#### Code Review #2 Findings

Reviewer: the same independent `sdlc-reviewer`, in a targeted recheck (repair
round 1) on working tree `48a1736e` against `23cf9faf`. It reused the
repair-round checks and reran none. Its result: pass.

- **P1-F2, P1-F3 and P1-F4:** resolved, with no regression. `on_prepared`
  restores the baseline's measurement point.
- **P1-F1, P1-F5 and P1-F6:** no problem.
- **P1-F7 (optional):** a leftover empty `Code Review #1 Revisions` heading in
  this plan.

#### Code Review #2 Revisions

- **P1-F7: accepted.** The stray heading was replaced by these sections.

Phase 1 passed with one repair round used.

### Phase 2: Core-turn runner, turn options and dry run

Review tier: standard. New benchmark behavior in `scripts/`. A possible
small runtime refactor for the recovery outcome must preserve behavior and
is covered by its own test.

Requirements: R1 (commands), R2 (voice, language, tools), R3, R4, R8
(format), R14, R15, R18.

Changes (`scripts/evals/benchmark/`):
- **Prompt-set format v1.** A JSON manifest containing:
  - `version`;
  - `loadout`, a path to a loadout file and its sha256;
  - `personas`;
  - `items`, each with `id`, `area`, `language` (`en` or `ja`),
    `pair_id` (the English original of a Japanese item), `message`, `tags`,
    `acceptable`, `held_out` and `tier`;
  - `scripted_chats`, each with `id`, `area`, `language`, `pair_id`,
    `persona`, `turns`, `held_out` and `tier`;
  - `memory_chats`, each with a checklist and recall probes (filled in by
    Phase 4);
  - `memory_fixtures`;
  - `guidance`, the candidate episodic text for arm (b) and its hash.
  A loader validates the manifest and computes input hashes. A format doc
  sits beside the inputs (location per G1).
- **Configurations.**
  - `--standard` resolves every visible built-in chat row in the catalog at
    efforts none and low.
  - `--config <row id>[:<effort>]` can be repeated.
  - A capability check (structured output, streaming, the requested effort)
    marks a configuration "not run", with its reason (R3).
- **Turn options (R2).**
  - Every turn carries enabled ElevenLabs `tts` options.
  - Japanese items apply `with_speech_language` and `conversation_language`
    with `ja`.
  - No `native_tools` are requested.
  - Companion-safety parity is decided here: mirror production's setting for
    OpenAI Responses moderation, or record why the harness differs.
- **Personas.** The neutral identity, and Annie from `STARTER_ANIMA_SPECS`,
  through the memory-context stand-in.
- **The run loop.**
  - Serial and interleaved: repeat, then item, then persona, then
    configuration.
  - One discarded warm-up turn per configuration, recorded but excluded from
    the measures.
  - Scripted chats run turn by turn, interleaved by chat.
  - The cap covers warm-ups, repairs and retries (R14).
  - JSON Lines output (D3), with the run conditions in the manifest: date,
    time window, host, network label and stack revision (R15).
- **Measures (R4).**
  - Gesture fit against the acceptable lists, reusing the Gesture harness's
    scoring.
  - Distributions per configuration: null rate, top-N share, distinct values
    and repeats in a row, for Gesture, tone and intensity.
  - The Audio-tag and spoken-style checks over `speech` and `display`. The
    rules are taken from `speech_tags.py`'s ElevenLabs and Speech sections
    and listed in the format doc, so a prompt change shows up as a reviewed
    check change:
    - tag count and kinds, and replies over the two-sound limit;
    - tags not in English square brackets;
    - tags in `display`;
    - `speech` that is empty apart from tags;
    - accent requests;
    - links, URLs, paths, code, markdown, lists, tables or emoji in
      `speech`.
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
  - Configurations, items by area, language and tier, and repeats.
  - Planned calls, plus an upper bound that includes repairs.
  - Approximate first-turn input tokens per configuration.
  - Estimated USD from catalog rates or `--price`.
  - Judge batch counts, filled in by Phase 6.
  - Estimated wall time (D12), and refusal over 4 hours without
    `--over-time-approved`.
  It needs no database or model.
- **`run`.**
  - It runs in the container.
  - It refuses to start without `--max-calls` and `--max-usd`, and stops at
    whichever cap it reaches first.
  - The USD estimate is updated from reported usage after each call.

Checks:
- Unit tests over the fake client:
  - interleaving order and warm-up exclusion;
  - capability refusal;
  - the cap on calls and on USD;
  - a partial run marked partial;
  - the recovery path for each outcome;
  - Annie's identity reaching the prompt;
  - input hashes;
  - each Audio-tag and spoken-style check on hand-written replies;
  - distribution statistics;
  - the duration estimate and the over-time refusal.
- **Turn-option tests (spec "Turn options").** Assembled requests show:
  - the ElevenLabs Audio-tag section on every turn;
  - the reply-language instruction and `language_code` `ja` exactly on the
    Japanese turns;
  - no web search tool;
  - no text-to-speech request.
- A mock smoke in the task stack:
  `run --tier smoke --standard --max-calls 200 --max-usd 0` with
  `ANIMAMA_LLM_SKIP=1`. It writes JSON Lines and a manifest, with no
  database writes.

Completion: the tests and the smoke pass, and the review passes. Commit
`feat(evals)[p2]: add the core-turn model benchmark runner`.

Starting source: `02328d2a` (Phase 1's commit).

**Delivered** (`scripts/evals/benchmark/`):
- `prompt_set.py`: format v1 and its validation. The format is documented
  in the module docstring.
- `configs.py`: the standard set, `--config` and the capability check.
- `options.py`: ElevenLabs voice options, Japanese, no native tools and
  moderation.
- `speech_checks.py`: Audio-tag and spoken-style checks over chat's own tag
  grammar (`animama.domain.audio_tags`).
- `measures.py`: recovery path, distributions, chat runs and
  per-configuration summaries.
- `results.py`: `turns.jsonl` and the manifest.
- `runner.py`: the loop.
- `planner.py`: the dry run.
- `cli.py` and `__main__.py`: `plan`, `run` and `models`.
- Two additions to the core:
  - `CallBudget`, a call-and-USD cap shared by every configuration's
    budgeted client. It refuses a call when the spend plus the largest call
    seen so far would pass the cap.
  - `core/loadouts.py`, moved out of the Gesture harness, which re-exports
    it.
- `tests/fixtures/model_benchmark/`: a small fixture prompt set.

**Decisions within scope:**
- **Companion-safety parity.** Benchmark turns set `provider_moderation`
  true, which is production's value with crisis detection at its default.
  Chat requests it only on OpenAI Responses.
- **Recovery path.** No runtime refactor was needed. Chat's `repaired`,
  `salvaged` and `plain_text` are reconstructed as the Gesture harness does.
  `strict` versus `lenient` comes from `parse_main_structured_response` on
  the final text.
- **The run requires `--price`.** The catalog records no cache-write rate,
  so it cannot price every Anthropic call. A USD cap therefore needs
  explicit published rates, which also gives the report one price source.
  The dry run falls back to catalog rates.

**Deviations from the planned Changes and Checks:**
- **Format docs.** The format and the Audio-tag rules are documented in the
  module docstrings. The inputs README comes with Phase 5's prompt set.
- **Stack smoke.** The planned mock smoke in a task stack is replaced by an
  automated composition test:
  `test_the_run_composition_reads_the_catalog_and_runs_chats_mock_client`.
  It reads the test database's real catalog, read-only, and runs chat's real
  registry under `ANIMAMA_LLM_SKIP=1` for both providers. This mirrors the
  Gesture harness's composition test. The container paths are first
  exercised by Phase 4's stack smoke.
- **Turn options.** "No text-to-speech request" holds by construction: the
  executor has no speech port, and the fake registry serves only chat
  calls.
- **`--config` syntax.** It takes `<row id>@<effort>` rather than the
  planned `[:<effort>]`, because row ids contain `:`.

Check record (2026-10-26). Every command ran from the repository root on
working tree `bf865276`, starting from `02328d2a`:

| Check | Command | Result |
| --- | --- | --- |
| Tests | `uv run --no-sync pytest -q tests/test_model_benchmark_runner.py tests/test_model_benchmark_core.py tests/test_gesture_selection_eval.py` | 79 passed (33 new runner tests) |
| Gesture parity | The Phase 1 dry-run and run-parity commands, compared with the `23cf9faf` baseline | Identical |
| Dry run | `uv run --no-sync python -m scripts.evals.benchmark plan --prompts tests/fixtures/model_benchmark/prompts.json --standard --max-calls 100` | 4 configurations, 40 calls (80 with repairs), about 2.5k first-turn tokens, ~0.0143 USD, 0.03 h |
| Lint | `uv run --no-sync ruff check` | Passed |
| Format | `uv run --no-sync ruff format --check scripts/evals tests`; `make format-check` | Passed |
| Types | `make mypy` | Passed (866 files) |

Commits: Phase 1 is `02328d2a`. This phase's commit is
`feat(evals)[p2]: add the core-turn model benchmark runner`.

Repair round 1 re-ran every check above on working tree `f4a5c19d`:
- the tests: 93 passed, 14 of them new for the findings;
- Gesture dry-run and run parity: identical;
- the benchmark dry run, which now shows the items and chats by area,
  language and held-out count;
- ruff, both format checks and `make mypy`: all passed.

#### Code Review #1 Findings

Reviewer: an independent `sdlc-reviewer` subagent at the standard tier, on
code identical to `bf865276`, against `02328d2a`. It reused the record and
added read-only probes, which it kept in the scratchpad. Its result: changes
required.

It confirmed:
- the interleaving and warm-up exclusion;
- the call cap refusing before a call is sent;
- English and Japanese options matching `turn_setup.py`;
- moderation parity;
- the order of the recovery paths;
- Gesture harness behavior;
- no key output;
- interrupted and failed runs keeping their turns (by probe).

Required:
- **P2-F1.** A plan over `--max-usd` still started; only calls and time
  were checked.
- **P2-F2.** Labels were `<model>@<effort>`, so two rows of one model (Luna
  on Chat Completions and on Responses) collided and could not run
  together.
- **P2-F3.** One `--price` priced every configuration, so a row with other
  rates would be priced, and capped, at the wrong rates.
- **P2-F4.** Turns recorded `cost_usd`, but the shared token summary reads
  `estimated_cost_usd`, so per-turn cost statistics were always null. The
  test fixture carried both keys.
- **P2-F5.** `tags_only_speech` missed tags followed only by punctuation,
  such as `[sighs]...`.
- **P2-F6.** Single-asterisk and single-underscore emphasis, such as
  `*smiles*`, was not detected as markdown.
- **P2-F7.** No test covered an interrupted or failed run, or a cap stop as
  written to the manifest.

Optional:
- the `CallBudget` overshoot wording;
- `--seconds-per-call` accepting 0, negative values or `nan`;
- an error before the run loop leaving `aborted: "interrupted"` or
  `"running"`;
- `platform.node()` recording a container id instead of the machine;
- the link to the README that does not exist yet;
- the dry run not showing items by area, language and tier, and the
  "upper estimate" wording;
- the undeclared `--config <row>@<effort>` syntax;
- memory off in core turns not recorded as a run condition;
- unknown prompt-set keys ignored silently, and loadout sorting unchecked;
- the web-search test not checking `provider_options.native_tools`;
- the speech checks re-implementing private Audio-tag helpers, and the emoji
  pattern missing flag letters;
- the turn record duplicating the Gesture harness's.

#### Code Review #1 Revisions

Required findings, all accepted:
- **P2-F1.**
  - `planner.estimate_usd` and `total_usd` now feed both the dry run, which
    prints a budget line, and `run`, which refuses when the estimate
    exceeds `--max-usd`.
  - A test case covers the refusal.
- **P2-F2.**
  - Labels are `<row id>@<effort>`.
  - `test_two_rows_of_one_model_are_separate_configurations` plans the
    standard set plus Luna on Chat Completions.
- **P2-F3.**
  - `--row-price ROW_ID RATES` (repeatable) prices one row's
    configurations.
  - `--price` prices the rest, and only when their catalog rates agree;
    otherwise the run refuses with a pointer to `--row-price`.
  - The manifest records the price source per configuration.
  - Covered by `test_one_price_cannot_cover_rows_with_different_catalog_rates`.
- **P2-F4.** Turns record `estimated_cost_usd`, and the fixture's duplicate
  key is removed.
- **P2-F5.** The check now requires a letter or a number outside the tags.
  Test added.
- **P2-F6.**
  - Single `*…*` and `_…_` emphasis counts as markdown.
  - A lone `*`, arithmetic and `snake_case` do not. Test added.
- **P2-F7.**
  - `test_an_interrupted_or_failed_run_keeps_its_turns_and_says_why` covers
    an interrupted run (exit 130) and a failed one.
  - `test_a_cap_stop_is_recorded_in_the_manifest` covers a cap reached by
    repairs.
  - `test_a_registry_that_cannot_be_built_is_recorded_as_an_error` covers a
    failed setup.
  - `test_an_unregistered_provider_is_recorded_as_an_error` covers a
    missing client.

Optional findings:
- **Accepted:**
  - the `CallBudget` docstring states the overshoot and that unreported
    usage goes uncharged;
  - `--seconds-per-call` must be a positive, finite number (test added);
  - contestant setup and building the registry now sit inside the run's
    error handling, so their failures are recorded as `error: <type>`;
  - `--machine-label` (default: the host name) is recorded as
    `conditions.machine`;
  - the dry run lists items and chats by area and language with held-out
    counts, and the docstring explains how the USD estimate differs from
    the cap;
  - the manifest's `options.memory` records `"off"` for core and long-chat
    turns, and memory runs come in Phase 4;
  - unknown keys are rejected at every level, and the loadout must be
    sorted by selector (test added);
  - the web-search test asserts `provider_options.native_tools == ()`;
  - the emoji pattern adds `Regional_Indicator`, as the app's speech text
    does.
- **Deferred to Phase 8:** the README link. Phase 8 writes
  `docs/benchmarks/README.md`.
- **Recorded as a deviation:** `--config` takes `<row id>@<effort>` rather
  than the planned `[:<effort>]`, because row ids contain `:`.
- **Rejected, with reasons:**
  - The private Audio-tag helpers (neutral lookup, accent test, tag class)
    stay mirrored. Exporting them would change `animama.domain.audio_tags`,
    a runtime module this phase does not change. The mirror is small and
    uses the public `classify_audio_tag`.
  - The turn-record duplication with the Gesture harness stays. The two
    record schemas differ, and the Gesture output must stay byte-identical.
    A shared builder would add an abstraction with two diverging users.

Verification: the repair-round check record above. P2-F1, P2-F2, P2-F3 and
P2-F7 go to a targeted recheck (Code Review #2). Repair rounds left after
this one: 1.

#### Code Review #2 Findings

Reviewer: the same independent `sdlc-reviewer`, in a targeted recheck (repair
round 1) on code identical to `f4a5c19d`. It reused the record and ran
read-only probes. Its result: pass.

- **Required findings:** all seven fixed, with no regression.
- **Accepted optional items:** all verified.
- **Rejections and the deferral:** sound.
- **Optional findings:**
  - **P2-F8.** The P2-F6 underscore pattern flags two kaomoji in one reply,
    such as `(^_^) … (^_^)`, as markdown.
  - **P2-F9.** The `--max-usd` help names only `--price`.
  - **P2-F10.** Rows without catalog rates all compare alike under one
    `--price`; worth a help note.
  - **Record placement.** The `--config` deviation is recorded only under
    the revisions.

#### Code Review #2 Revisions

All four accepted, as trivial repairs:
- **P2-F8.** The underscore branch now needs a word character just inside
  both underscores. The kaomoji case was added to the test's negatives.
- **P2-F9.** The `--max-usd` help now reads "(needs --price or
  --row-price)".
- **P2-F10.** The `--price` help notes that rows the catalog does not price
  count as alike.
- **Record placement.** The `--config` syntax was added to the deviations
  list above.

Verified by rerunning `tests/test_model_benchmark_runner.py` (47 passed) and
`ruff check` (passed). Phase 2 passed with one repair round used.

### Phase 3: Memory-arm seams in chat, with defaults unchanged

Review tier: high risk. It changes production prompt assembly, the
structured-response schema and the memory write path. These are shared
contracts and a persistence boundary, and a byte change to the default
prompt would also break prompt caching
(`docs/backend/runtime/prompt-caching.md`).

Requirements: R6 (seams). Spec acceptance "Memory arms".
Dependencies: Phase 1.

Changes (`src/backend/animama/app/`, D11):
- `EpisodicMemoryArm` is a frozen dataclass in `app/chat`. It is accepted by
  `DirectChatTurnExecutor` and threaded to the places it controls:
  - **`remember=false`:**
    - the structured output model, the strict schema, the JSON-mode
      instruction and its property order all omit `remember`;
    - the memory-store list and the response guidance omit their `remember`
      lines, for both the OpenAI and Anthropic text;
    - capture stays as it is: a missing `remember` already skips it.
  - **`anima_memories_writes=false`:**
    - write tools and native Apply Patch refuse `[self]/MEMORIES.md` with a
      tool error that tells the model the file is read-only;
    - reads of the alias keep working;
    - the prompt omits the `MEMORIES.md` write guidance, as it does today
      when writes are off.
  - **`anima_memories_write_guidance`:** when set, the supplied text
    replaces `ANIMA_MEMORIES_WRITE_GUIDANCE` where that guidance is used
    today.
- Production wiring and `DirectChatOptions` are unchanged.

Checks:
- **Golden defaults.** With no arm passed, or the default arm, the assembled
  system text, turn context, response schema and tool list are byte-identical
  to `18d2bebd`. This holds for OpenAI Responses and native Anthropic, on a
  fixed memory context with and without `MEMORIES.md`. The goldens are
  captured from `18d2bebd` before the change.
- **Arm tests:**
  - (a): `[self]/MEMORIES.md` writes fail without changing the entry, reads
    succeed, and the write guidance is absent;
  - (b): the schema and both providers' prompts carry no `remember`, a reply
    without `remember` parses, and the candidate guidance text appears
    instead of the default;
  - (c): it equals the default.
- **Not reachable from HTTP.** A test asserts that `merge_chat_request_options`
  and `DirectChatOptions.from_value` ignore arm-like keys, and that
  `turn_setup` constructs the executor without an arm.
- The existing executor, memory-tool, prompt and structured-response tests
  pass unchanged.
- The full pre-push suite runs as a heavy job before the review.

Completion: the checks pass, and the high-risk review passes, with a checks
subagent rerunning the affected tests and a recheck of every repair. Commit
`feat(chat)[p3]: add benchmark-only episodic memory arms with unchanged
defaults`.

Recovery:
- If byte-identical defaults cannot be kept for a provider, stop and report
  to the owner. Do not change the production prompt to make the goldens
  pass.
- The phase is revertible as one commit.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 4: Multi-turn, memory-arm and Memory Manager runners

Review tier: high risk. It creates, seeds and drops a PostgreSQL database in
the task stack (D4), and it runs non-incognito turns with provider storage
on (D5).

Requirements: R2 (storage), R5, R6 (runner, capture, recall), R7.
Dependencies: Phases 2 and 3.

Changes:
- **Long chats.** The scripted-chat runner supports 30+ turns per persona,
  with the app's own history replay and pre-send compaction behavior. The
  utility role resolves the way chat resolves it.
- **Benchmark database** (D4).
  - The harness creates `animama_benchmark_<run id>` in the stack's
    PostgreSQL from the baseline SQL, with the same connection settings the
    container uses.
  - It builds SQLAlchemy sessions for the memory repositories over that
    database only.
  - It drops the database when the run ends, including on error.
  - `cleanup` drops leftover `animama_benchmark_*` databases.
  - A guard refuses any other database name.
- **In-chat memory and memory arms** (D5, D11).
  - Seed each arm's store from tracked fixtures: the Anima's `IDENTITY.md`
    and `MEMORIES.md`, and the user's `PROFILE.md` and other files, under a
    fresh user id per arm, configuration and chat.
  - Use the real memory services and episode recorder over the benchmark
    database. Fake `AnimaRepository` and chat manager stand-ins capture
    `record_turn`.
  - Run each memory chat in arms (a), (b) and (c) by constructing the
    executor with the matching `EpisodicMemoryArm` and the tracked
    candidate guidance.
  - Each memory turn records:
    - the tools offered and used, with each call's outcome;
    - the `remember` cue;
    - the store diff after the chat.
  - **Capture (R6).** After each memory chat, snapshot every saved item:
    episode items, `MEMORIES.md` and shared files. These feed the
    checklist scoring in Phase 7.
  - **Recall (R6).** Each memory chat is followed by a fresh recall chat on
    the same store. It uses the app's own read paths: the memory map,
    `MEMORIES.md` in the prompt, and `search_memory_files` over the real
    full-text search. Probes with an `expect_recall` answer get a
    deterministic, case-insensitive match over `speech`; the rest are left
    for the judge.
  - **Japanese search probe.** A read-only `SELECT` of `to_tsvector` and
    `websearch_to_tsquery` on Japanese fixture text. The result is recorded
    under Discoveries.
- **Memory Manager (R7).**
  - The harness builds `MemoryManagerRun` and its messages, with episode and
    chat-message sources for the episode-processing and Reflection task
    inputs.
  - It calls the runtime chosen by `runtime_selector` directly.
  - For each approval request, it records the proposal, applies the edit to
    the benchmark database through the real patch planner, and resumes.
  - Budget, usage (including cached and reasoning tokens) and the served
    model come from the `model_wrapper` hook (OpenAI Agents) and the
    `client_factory` hook (Anthropic). They count against the same cap.
  - Agents SDK tracing is turned off as D5 decides.

Checks:
- Unit and database tests, using the suite's PostgreSQL fixtures:
  - memory tools are offered according to the options, the row and the arm;
  - writes land only in the benchmark database, under the arm's user id;
  - the guard refuses non-benchmark database names, and drop-on-error works;
  - no session on the application database is opened;
  - capture snapshots and recall matching;
  - the approval loop with a fake runtime returning several proposals;
  - wrapper counting and the cap on both Memory Manager runtimes, using fake
    SDK clients.
- A mock smoke in the task stack covers one memory chat in all three arms
  with its recall chat, and one run of each Memory Manager kind.
  `DeterministicMemoryManagerRuntime` is used when LLM calls are skipped.
  Afterwards, `\l` shows no leftover benchmark database and the application
  database's row counts are unchanged.
- The full pre-push suite runs as a heavy job before the review.

Recovery:
- If a real path cannot run against the benchmark database, stop. Record the
  blocker and present the alternatives to the owner. Do not change runtime
  code to get around it.
- An interrupted run's leftover database is removed with `cleanup`.

Completion: the tests and smokes pass, and the high-risk review passes.
Commit `feat(evals)[p4]: add the multi-turn, memory-arm and Memory Manager
runners`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 5: Prompt set v1, Japanese subset, fixtures and rubrics (gate G2)

Review tier: light. Tracked benchmark data, rubrics and documentation, plus
a small validator inside one module that its own tests cover. The final
integration review covers it.

Requirements: R8, R9, R10, R11, and the rubric parts of R12.
Dependencies: Phase 2's format and Phase 4's memory-chat fields.

Changes:
- **Drafting.** Sub-agents draft the set from #409's 60 items and two
  scripted chats, within D13's sizes and the 4-hour bound. The items cover:
  - emotions, conversation beats, small talk, praise and jokes;
  - advice and disagreement;
  - spoken-style traps, such as requests for lists, links, code or emoji;
  - moments that invite an Audio tag, and moments that should not.
  Items never depend on current events.
- **Long chats.** Two chats of 30 turns, one per persona (D14).
- **Memory chats.** Three memory chats of about 12 turns, one of them in
  Japanese:
  - each plants must-keep facts, events and plans, noise, and a probe of the
    sensitive-memory rule;
  - each has a tracked checklist and a recall chat of about 4 probes, with
    `expect_recall` answers where possible.
- **Candidate episodic guidance (arm b).** A drafted replacement for the
  `MEMORIES.md` write guidance. It lets the file hold notable facts, events,
  decisions and plans, alongside the relationship sections, within the
  existing size and sensitivity rules.
- **Japanese subset (R9).** About 24 single-turn items, plus the memory chat
  above, agent-translated from their English originals and linked by
  `pair_id`, with no further translation check.
- **Memory Manager fixtures.** Seeded memories, episodes and turns for
  general, episode-processing and Reflection runs.
- **Gesture loadout.** The 95 non-idle Included Gestures pinned by hash,
  unless G2 chooses the current Included set.
- **Held-out slice (R10).** About 20% of items and chats per area,
  stratified by tag and chosen with a recorded seed. It is marked
  `held_out`, and the documentation states the no-tuning rule, including for
  the candidate guidance.
- **Rubrics.** One per judged measure, with 1–5 anchors and an example for
  each anchor:
  - chat replies: relevance, warmth, persona consistency, spoken style and
    length;
  - avatar expression: Gesture, tone, intensity and coherence;
  - Audio-tag fit;
  - long chats: retention, repetition and consistency;
  - memory: what is kept and tool use;
  - capture matching: whether each checklist item is present in the saved
    memory;
  - recall for probes without an expected answer;
  - Memory Manager: proposal quality, accuracy and restraint.
  Each rubric has a JSON output schema.
- **Smoke subset** (D10), marked `tier: smoke`.
- **Content rules.** Everything is public-safe and synthetic: no personal
  data and no licensed content.

Checks:
- The manifest validates.
- Every `acceptable` selector exists in the pinned loadout.
- Every Japanese item has an English `pair_id` that exists.
- The held-out share is 18–22% for each area.
- The `plan` output for the full and smoke tiers is recorded here, and the
  full tier's estimate is no more than 4 hours.
- A privacy scan, for example for email addresses and phone numbers, runs
  over the set.

**G2 (owner):** the owner reviews and approves:
- the prompt set and the Japanese subset;
- the fixtures and checklists;
- the candidate guidance;
- the rubrics;
- the sizes, personas (D14) and loadout.

Notes are resolved and the approval is recorded here. Until G2, Phases 6–8
may continue, but Phase 9 may not start.

Completion: G2 is recorded. Commit
`feat(evals)[p5]: add the v1 benchmark prompt set and rubrics`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

Light phase: covered by the final integration review unless a review is
requested.

#### Code Review #1 Revisions

### Phase 6: Blind judging through `claude -p`

Review tier: standard. A subprocess adapter on the host. Its isolation
checks keep user settings and credentials away from the judge.

Requirements: R12, and R13's pilot mechanics.
Dependencies: Phase 2's results format.

Changes (`scripts/evals/benchmark/judge.py` and related modules; standard
library only):
- **Blind batches.**
  - Judged items get opaque random ids, with a seeded shuffle across
    configurations, memory arms and languages.
  - Batches have a fixed size per rubric.
  - The id-to-configuration mapping is kept in a separate file that is
    never sent to the judge.
  - A reply batch carries:
    - the persona text;
    - the user message and recent context for chat turns;
    - the reply's speech, display, tone, intensity and Gesture (its name and
      AI description);
    - reply lengths.
  - Capture batches carry a checklist and a saved-memory snapshot, with
    their channel names normalized so the arm stays hidden.
- **CLI adapter** (D6, D7).
  - It runs `claude -p` with the pinned model and effort, the rubric as the
    system prompt, and the JSON schema.
  - It validates the output against the schema and the batch ids.
  - Malformed output is retried twice, then recorded as missing.
- **Resume.** A ledger records one result file per batch and effort. A rerun
  skips batches already completed.
- **Usage limits.** The adapter detects the CLI's usage-limit or
  authentication failures, stops cleanly, and prints how to resume.
- **Concurrency.** Up to N parallel judge processes. N defaults to the value
  measured in the smoke (D12).
- **Records (R12).** The judge model id, effort, CLI version, rubric version
  and hash, batch id and timestamps.
- **`plan` additions.** Judge batch counts, tokens per batch, and seconds per
  batch for the duration estimate.

Checks:
- Unit tests with a stub CLI executable:
  - no configuration, arm or language identity appears in any batch prompt;
  - shuffle determinism;
  - schema and id validation;
  - retry, then missing;
  - resume without rescoring;
  - usage-limit stop;
  - bounded concurrency.
- A live smoke, authorized by D8 at G1: four fixture batches built from
  tracked hand-written replies, two at medium effort and two at high.
  - Record the model id, the CLI version, the seconds per batch at each
    effort, and the concurrency that ran without usage-limit errors.
  - Inspect the JSON events to check that no user or project instructions,
    hooks or memory were loaded (D7).

Completion: the tests and the smoke pass, and the review passes. Commit
`feat(evals)[p6]: add blind judging through the Claude CLI`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 7: Scores, statistics and report

Review tier: standard. Pure computation and rendering. Its public-safety
guard keeps raw replies out of the tracked report.

Requirements: R4 (distributions), R6 (arm comparison), R9 (pairs), R10
(split), R12 (family caveat), R13 (agreement section), R16, R17, R18
(re-render).

Changes:
- **Score merging.** Deterministic measures and judge scores are merged per
  item, with missing scores counted and shown.
- **Capture scoring (R6).** Each checklist item gets the judge's
  present-or-absent verdict, combined with deterministic counts. The result
  is kept, missed, noise kept, and sensitive-rule breaks, for each arm and
  configuration.
- **Statistics** (D9). Bootstrap intervals, paired English–Japanese and
  arm differences, judge-to-owner agreement, and the "not distinguishable"
  ranking language.
- **Report (R17).**
  - The scorecard has configurations as rows and areas and measures as
    column groups, with quality, latency, tokens and cost side by side.
  - Separate sections cover:
    - distributions;
    - the memory-arm comparison;
    - the English–Japanese pairs;
    - tuned and held-out results;
    - the judge, with the family caveat stated;
    - calibration and the pinned effort (filled in by Phase 9);
    - conditions, inputs and hashes;
    - limitations: D5 storage and tracing, the Japanese search finding, and
      the companion-safety parity from Phase 2.
  - There are placeholders for the owner's recommendations on the default
    model and on the episodic-memory design.
- **Public-safety guard.** `report` refuses to write when any judged reply,
  saved memory or prompt text appears in the output. Only ids, numbers and
  tracked identifiers are allowed.
- **`report --rerender`.** Rebuilds the report from recorded JSON Lines and
  judge files without any calls.

Checks:
- Unit tests on fixture data:
  - bootstrap and paired intervals with a fixed seed against known values;
  - kappa against hand-computed examples;
  - capture totals per arm;
  - held-out split totals;
  - the safety guard;
  - byte equality on re-render.
- A rendered sample report from the mock smoke run is attached to the phase
  record.

Completion: the tests pass and the review passes. Commit
`feat(evals)[p7]: add benchmark scoring and reports`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 8: Skill, documentation and glossary

Review tier: light. Skill instructions and documentation only. The final
integration review covers it.

Requirements: R1, R20.

Changes:
- **The skill** `.agents/skills/animama-model-benchmark/`:
  - `SKILL.md` with this flow:
    1. Check the stack and the CLI.
    2. Run `plan`.
    3. Present the estimate, including the time, and ask for approval and
       caps.
    4. Run `run`.
    5. On the first run, run calibration (G4) and the effort pilot.
    6. Run `judge`, resuming across usage limits.
    7. Run `report`.
    8. Ask the owner to write the recommendations and link the report.
  - The skill never starts a paid run without explicit approval of that
    run's caps.
  - `agents/openai.yaml`, and `references/` for the commands, the input
    format, the memory arms, the rubrics and judge, and reading reports.
- **Documentation.**
  - A benchmark README beside the inputs (location per G1) covering:
    - the commands;
    - the prompt-set format and the held-out rule;
    - the memory arms and the benchmark database;
    - judge setup, including CLI sign-in and isolation;
    - the conditions and the time bound;
    - limitations.
  - A short note in the backend chat or memory documentation that the
    episodic-memory arms exist for benchmarking only.
  - A pointer from `docs/backend/README.md`.
- **Glossary.** "Benchmark area" and "Benchmark run" are added to
  `GLOSSARY.md` if G1 accepts them.

Checks:
- A mock-model rehearsal of the full skill flow on the task stack: smoke
  tier, a stub judge and a rendered report.
- Docs links resolve.
- The full `uv run pytest -q`.

Completion: the rehearsal is recorded. Commit
`feat(evals)[p8]: add the model benchmark skill and docs`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

Light phase: covered by the final integration review unless a review is
requested.

#### Code Review #1 Revisions

### Phase 9: First decision run and calibration (gates G3, G4)

Review tier: light. It produces the tracked report and plan records with the
tooling already reviewed. The final integration review covers it.

Requirements: the acceptance items "First decision run" and "Calibration"
(R13, R14, R17).

Steps:
1. Start a development task stack from this checkout with the secrets env
   file. Confirm that `models` lists both built-in chat rows.
2. Run `plan --tier full --standard` and record its output here.
   - The planning estimate is D13: about 2,200 contestant calls, about $1–3,
     about 1.5 hours of contestant calls, and about 65 judge batches.
   - The dry run replaces this estimate. It must show 4 hours or less.
3. **G3 (owner):** the owner approves this run with `--max-calls` and
   `--max-usd`. Record the approval and the caps.
4. Run `run`, then take the stack down. Raw results stay in the drafts
   folder, and `cleanup` confirms no benchmark database remains.
5. **G4 (owner):**
   - `calibrate export` draws a stratified blind sample of 30–40 English
     replies across areas, configurations and score ranges.
   - The owner rates it with the rubrics, and `calibrate import` records the
     ratings.
   - `calibrate pilot` judges the sample at medium and at high effort.
     Record the agreement at each effort and pin the effort (D15).
6. Run `judge` at the pinned effort, resuming across usage windows. Record
   the batches, missing scores and elapsed time.
7. Run `report`. Then:
   - Track the report at the location agreed at G1.
   - Verify that `report --rerender` reproduces it byte for byte.
   - Record the run's actual wall time against the 4-hour bound, excluding
     the one-time calibration.
   - Have the owner write the recommendations.
   - Link the report from #470.

Recovery:
- A run stopped by a cap or an interruption keeps its partial results. The
  owner decides whether to approve a continuation. No continuation tooling
  is planned: rerun with a new cap.
- A judge stopped by a usage limit resumes later.

Completion: G3 and G4 are recorded, the report is tracked and the re-render
is verified. Commit `docs(evals)[p9]: record the first model benchmark`.

Check record: none yet.

Commits: none yet.

#### Code Review #1 Findings

Light phase: covered by the final integration review unless a review is
requested.

#### Code Review #1 Revisions

## Final integration review

- **Scope.** Combined acceptance against the spec's acceptance criteria, on
  the final candidate after merging `main`.
- **Light phases.** It covers Phases 5, 8 and 9 explicitly.
- **Evidence.** It reuses phase evidence that is still valid and runs no
  checks of its own.
- **Budget.** One full review and at most two repair rounds.
- **Pre-push suite.** After its repairs, the full suite runs once on the
  final candidate, as a heavy job:
  `python3 scripts/heavy-slot.py -- make check-test`. Its results go in the
  PR.

## Validation and acceptance

Spec acceptance mapped to evidence:

| Spec criterion | Evidence |
| --- | --- |
| Dry run | `plan` outputs (Phases 2, 5, 9), including the time estimate |
| Free end-to-end run | Phase 8 mock rehearsal |
| Turn options | Phase 2 turn-option tests |
| Memory arms | Phase 3 golden and arm tests; Phase 4 runner tests |
| Budget enforcement | Phase 2 and 4 tests |
| Blind judging | Phase 6 tests and smoke |
| Measures | Phase 2, 4 and 7 tests |
| Compatibility | Phase 1 parity diff and tests |
| Prompt set | G2 |
| Calibration | G4, the pilot record and the pinned effort |
| First decision run | Phase 9 report, wall time and re-render |
| Skill | Phase 8 rehearsal |
| Local checks | The full pre-push suite on the final candidate |

Hosted `Validation` stays disabled unless the owner approves a single run.
The PR records local evidence and the actual hosted scope separately.

## Idempotence and recovery

- `plan`, `report --rerender` and mock runs are free and repeatable.
- `run` always writes to a new run directory and never overwrites. Finished
  turns survive an interruption.
- The benchmark database is per run, created and dropped by `run`. A
  leftover database from an interrupted run is removed by `cleanup`, which
  touches only `animama_benchmark_*` names.
- `judge` resumes from its ledger and never rescores a completed batch.
  Deleting a batch file rescores only that batch.
- Task stacks are named and project-scoped. Take them down after their last
  use, and never stop another task's stack.
- Phase 1 is a revertible refactor. Phase 3's seams default to today's
  behavior, proven by golden tests, and revert as one commit.

## Outcomes & Retrospective

Not started.
