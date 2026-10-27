# Standardized model benchmark execution plan

Status: In progress. G1 passed on 2026-10-25 and G2 on 2026-10-26.
Phases 1–9 are done and the final integration review passed; the full
pre-push suite runs on the final candidate. G3 passed on 2026-10-26; the
owner waived G4 and moved the judge to Claude Fable 5.1 the same day (D17).
The first decision run's report, with the owner's recommendations, is
tracked at [`docs/benchmarks/2026-10-26-first-decision-run.md`](../../benchmarks/2026-10-26-first-decision-run.md).

Source agreement: the spec, published as the body of
[#470](https://github.com/raymond-van/animama/issues/470) at
`2026-10-26T02:24:13Z`, which is authoritative. On `2026-10-27T04:17:27Z` the
body was revised for D17. The tracked [snapshot](model-benchmark-spec.md)
records that capture. The spec follows
the owner's discovery answers of 2026-10-12 and 2026-10-25 and the owner's
spec answers of 2026-10-25, recorded on #470 in the
[2026-10-12 brief](https://github.com/raymond-van/animama/issues/470#issuecomment-6134798047)
and the
[2026-10-25 brief](https://github.com/raymond-van/animama/issues/470#issuecomment-6406329265).
The owner reviewed it at `cb9c50a4` and this plan at `53adb22f`.

Authorized scope: the whole plan. The owner invoked `/implement` on
2026-10-25 after reviewing the spec and this plan. Gates G2 and G3 passed and
the owner waived G4 (D17). Exact-candidate merge approval stays separate.

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
4. A Claude judge scores the replies blind through the owner's Claude
   subscription (`claude -p`): Opus 5.5 as planned, Fable 5.1 since D17.
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
  - On the host, `uv run --no-sync python -m scripts.evals.benchmark …`
    runs the judge, calibration and report from the checkout's environment;
    they import the app's packages but need no database or keys.
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
- [x] Workspace setup (2026-10-25, recorded under Setup and execution
      rules).
- [x] Phase 1: Shared evaluation core extracted; Gesture harness unchanged.
      Passed review #2 on 2026-10-25.
- [x] Phase 2: Core-turn runner, turn options and dry run. Passed review #2 on
      2026-10-25.
- [x] Phase 3: Memory-arm seams in chat, with defaults unchanged. Passed
      review #2 (high risk) on 2026-10-25.
- [x] Phase 4: Multi-turn, memory-arm and Memory Manager runners. Passed
      review #3 (high risk) on 2026-10-26, with both repair rounds used.
- [x] Phase 5: Prompt set v1, Japanese subset, fixtures and rubrics (gate
      G2). G2 passed on 2026-10-26: approved as drafted.
- [x] Phase 6: Blind judging through `claude -p`. Passed review #3 on
      2026-10-26, with both repair rounds used.
- [x] Phase 7: Scores, statistics and report. Passed review #2 on
      2026-10-26, with one repair round used.
- [x] Phase 8: Skill, documentation and glossary. Rehearsed on a mock
      stack on 2026-10-26; covered by the final integration review.
- [x] Phase 9: First decision run and calibration (gates G3, G4). G3 passed
      and G4 was waived (D17) on 2026-10-26; the report was tracked on
      2026-10-27.
- [x] Final integration review. Passed review #2 on 2026-10-26, with both
      repair rounds used; the full pre-push suite runs on the final
      candidate after Phase 9.

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
  - **Confirmed in Phase 4** (2026-10-25, the stack's PostgreSQL):
    - `to_tsvector('english', '週末に京都で抹茶を飲みました。')` is the single
      token `'週末に京都で抹茶を飲みました'`;
    - `websearch_to_tsquery('english', '京都')` and `… '抹茶'` do not match;
    - only the whole sentence matches.

    Episode search through `search_memory_files` therefore finds Japanese
    `remember` notes only by their exact text.
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

### 2026-10-26, Phase 6 judge

- **Structured output.** With `--json-schema`, the CLI offers one
  `StructuredOutput` tool, even with `--tools ""`, and its result event
  carries the validated object as `structured_output` (and as text in
  `result`). A call takes two turns. Its stream-json start-up event lists
  the model, tools, MCP servers, skills, plugins and `apiKeySource`, which
  the judge checks on every call.
- **Prompt caching.** The CLI writes the prompt to the cache: the same
  batch sent again, at the other effort, read almost all its input from it.
  Whether different batches of a rubric share more than the system prompt
  is not measured.

### 2026-10-26, Phase 4 review

- **Memory Manager effort.** Neither Memory Manager runtime takes chat's
  reasoning effort. The Anthropic runtime sends its role default (`medium`,
  adaptive thinking) when the row offers it; the OpenAI Agents runtime sends
  no reasoning setting, so the provider's default applies. See D16.
- **Memory tools differ by row.** OpenAI Responses rows offer memory writes
  through native `apply_patch`, not `memory_write_file` and
  `memory_apply_patch`. Turn records list the offered tools, so the report
  compares tool use within each row's own tool set.
- **Recovery and tool calls come from chat's own record.** A memory turn's
  tool rounds are model calls with an empty final text, and chat rejects
  some tool calls before its memory service sees them (an unknown tool,
  invalid arguments, the round limit). Chat persists every tool exchange and
  the reply's `structured_recovery` for a memory turn, so the runner reads
  them back from the benchmark database.
- **Japanese search, live.** The stack smoke reconfirmed the planning-time
  finding: `京都` and `抹茶` do not match the Japanese sentence; only the whole
  sentence does.

### 2026-10-27, recall in the first decision run

- **Saved episode notes rarely reach a fresh chat.** In arms (a) and (c),
  recall matched 0–2 of 9 per configuration, although capture kept 15 of 15.
  - A fresh chat's context carries no episode notes, so a recall turn that
    does not search cannot find them. Across the 96 recall turns in those
    arms, the model searched memory in 12, and all 3 matches came from those
    searches.
  - Memory search uses `websearch_to_tsquery`, which requires every query
    word to appear in one note. Multi-word searches therefore missed saved
    notes, while single-word and `OR` searches matched.

  This is app behaviour, not the harness, so the report's recall measures
  search. The recommendations ask for a search fix and a rerun of the memory
  arms before a retrieval design is chosen.

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
- **2026-10-26, owner (G2):** the v1 inputs at `8b9f725c` are approved as
  drafted (Phase 5), which settles D14 and the loadout: the current Included
  set of 140 Gestures.
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
  - **Phase 7 implementation (2026-10-26, from review).** A resampled group
    is a single-turn item with all its personas and repeats, or a whole
    conversation (a scripted, memory or recall chat in one arm) with all its
    turns; English–Japanese differences are grouped by item. Kept-rate
    differences between arms pair each must-keep checklist entry, since a run
    has too few memory chats to resample whole. No ranking or "apart"
    verdict rests on fewer than five groups (`MIN_GROUPS`); such results
    read "too few to compare". The owner may change the threshold.
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

- **D16 (Phase 4 review, 2026-10-26; the owner confirms it with the run plan
  at G3). Memory Manager runs once per catalog row.**
  - The runtimes ignore chat's effort (see Discoveries), so a row's `none`
    and `low` configurations would repeat the same run and double its paid
    calls.
  - Each row runs every Memory Manager fixture once, as its first
    configuration and under that configuration's price. The record names the
    row and the effort the runtime applied.
  - The dry run counts these calls once per row.
- **D17 (owner, 2026-10-26). Fable 5.1 judges; G4 waived.** After the paid
  run, the owner asked for the judge to be Claude Fable 5.1
  (`claude-fable-5-1`) at medium effort, and waived the calibration (G4)
  rather than rate the sample. The judge model changes for this and every
  later run (D6, spec R12); the waiver covers this run only (D15, spec R13),
  so a later run of the same prompt-set version still needs a calibration.
  The spec snapshot records the revision. With the owner's agreement, #470's
  body was updated to match on 2026-10-27.
  - `JUDGE_MODEL` is `claude-fable-5-1`; the isolation check confirms it on
    every call, as before.
  - `calibrate waive --effort medium` records the waiver in
    `calibration/result.json`. The report says the scores are not checked
    against the owner's ratings, and its family caveat says so too: Fable 5.1
    shares a family with the Haiku contestant.
  - The calibration sample exported earlier was planned for the Opus judge,
    so the pilot refuses it. A later calibration with Fable 5.1 starts with a
    fresh `calibrate export` in a copy of the run (its `manifest.json` and
    `turns.jsonl`).
  - A live check on 2026-10-26 judged the two `recall` batches of the run of
    record: both `ok`, model and served model `claude-fable-5-1`, CLI
    `2.1.310 (Claude Code)`, about 25 s each.
  - Review (standard, independent `sdlc-reviewer`, on tree `31c3d9a6`):
    no code defect; the model is pinned in the CLI arguments, the plan
    fingerprint and the result check, and the waived report is accurate and
    public-safe. Required wording and record fixes, all accepted: FJ-F1 (the
    README still said Opus), FJ-F2 (this entry claimed the Opus-planned
    sample could be reused, and read as if the model change were per run),
    FJ-F3 (the spec snapshot; #470 waits for the owner) and FJ-F4 (the
    Status line, Purpose, Phase 9 steps 5–6 and Completion now point here).
    Optional, accepted: `waive` refuses once owner ratings are imported; the
    docs say a waiver covers its run only; a stub mode now tests a CLI that
    serves another model (non-resumable stop); `waive` is in the README
    table and the docstrings; `__all__` is sorted. Verified by the
    coordinator: 189 benchmark tests, `ruff check`, `ruff format --check`,
    `make mypy` and `mypy scripts/evals` pass.

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
   - **Workspace record (2026-10-25):**
     - **Repository:** `raymond-van/animama`.
     - **Checkout:** `worktrees/animama/model-benchmark-discovery-d321cc`
       (Git root verified).
     - **Branch:** `feat/model-benchmark`, tracking `origin/feat/model-benchmark`.
     - **Base:** `main`, with `a94f8369` merged at `165b2a09`.
     - **Spec authority:** the #470 body at `2026-10-26T02:24:13Z`, read back
       byte-equal to the published file. The issue was retitled
       "feat: standardized model benchmark skill for chat models".
     - **Environment:** `.venv` on Python 3.12.13 (`uv sync --python 3.12.13`).
     - **Stack:** `animama-bench` (`./reset.sh --name bench --base-port
       8900`, `http://animama-bench.localhost:8900`; base port 9100 for the
       final integration rehearsal, when another stack held 8900), started
       for each smoke and rehearsal with `ANIMAMA_LLM_SKIP=1` and taken down
       after it; the phase records give each start.
     - **Gates outstanding:** G3, G4 (G2 passed on 2026-10-26).
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

Check record (2026-10-25). Every command ran from the repository root on
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

Check record (2026-10-25). Every command ran from the repository root on
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

Starting source: `c191ded9` (Phase 2's commit). Its chat code is unchanged
from `18d2bebd`.

**Delivered:**
- `app/chat/memory_arm.py`: `EpisodicMemoryArm` and
  `DEFAULT_EPISODIC_MEMORY_ARM`.
- `DirectChatTurnExecutor(episodic_memory_arm=…)` passes the arm to the
  places it controls:
  - the reply model (`build_main_structured_response_model(remember=…)`);
  - prompt assembly (`remember_field`, `anima_memories_write_guidance`, and
    `anima_memories_writable` combined with `anima_memories_writes`);
  - the turn's `AnimaMemoriesTurn(writable=…)`.
- **The reply model.** `PyMainAgentResponse` is split into
  `PyMainAgentResponseBase` (every field but `remember`) plus chat's
  `PyMainAgentResponse`, which adds `remember`. Field order and schema are
  unchanged.
- **Guidance follows the reply model.** The response guidance and the
  JSON-mode prompt read `output_type.model_fields`:
  - `main_structured_response_guidance` uses `main_structured_output_guidance(remember=…)`
    and `anthropic_main_structured_output_guidance(remember=…)`;
  - the memory guidance comes from `memory_system_guidance(remember=…)`.

  The existing constants keep their exact text.
- **Read-only `MEMORIES.md`.** `memory_write_file`, `memory_apply_patch` and
  native Apply Patch on `[self]/MEMORIES.md` return a `read_only` tool error
  when `AnimaMemoriesTurn.writable` is false. Reads of the alias and
  shared-file writes keep working.

**Discoveries:**
- **Recovery bug, fixed.** Chat's lenient recovery
  (`recover_main_structured_response`) added `remember: None` to the data
  even when the reply model lacks the field, so a recovered arm-(b) reply
  failed validation. It now sets the nullable fields only when the model has
  them. Chat's own model always has them, so its behavior is unchanged.
- **Tool descriptions still name the alias.** In arm (a), the
  function-tool descriptions of `memory_write_file` and `memory_apply_patch`
  still say `[self]/MEMORIES.md` can be edited "when it is available". The
  prompt no longer invites edits, and any attempt is refused as `read_only`.
  The memory-tool measures count those refused calls. Tool specs are left
  unchanged, to keep the runtime change narrow; Responses Luna uses native
  Apply Patch and has no such descriptions.

**Check record (2026-10-25).** Every command ran from the repository root.

Goldens and tests, on working tree `0c777611`:

| Check | Command | Result |
| --- | --- | --- |
| Goldens | `PYTHONPATH=. uv run --no-sync python <scratch>/p3_golden.py <file> [a\|b\|c]` on `c191ded9` and on the tree, then `cmp` | See below |
| Arm and tool tests | `uv run --no-sync pytest -q tests/test_episodic_memory_arm.py` and `tests/test_memory_file_tools.py -k "read_only_turn or self_memories"` | 11 passed; 23 passed |

`p3_golden.py` is a scratch script. It prepares one turn through
`DirectChatTurnExecutor.prepare_turn` for three rows (Luna on Responses, Luna
on Chat Completions, Haiku on Anthropic) and three memory setups (memory on
with `MEMORIES.md`, memory on without it, incognito with memory off). It dumps
the prompt messages and tools, the provider options, the response format, the
strict schema, the response guidance and the JSON-mode prompt. Results:
- **No arm, and arm (c):** byte-identical to the baseline in all 9 captures.
- **Arm (a):** only the prompt of the three "memory on with `MEMORIES.md`"
  captures changes, and only by losing the write guidance. Tools, schema and
  guidance are unchanged.
- **Arm (b):** the schema, output fields, guidance, JSON-mode prompt and
  memory guidance change in every capture. None mentions `remember`, and the
  candidate text replaces the write guidance.

The full pre-push suite ran twice through the heavy-job slot:
- **First run** (tree `0c777611`):
  `python3 scripts/heavy-slot.py -- make check-test` failed at mypy, on the
  return type of `build_main_response_model_from_schema`.
- **Fix:** that builder now casts its result to chat's model, which always
  has `remember`. `make mypy` then passed, and ruff and the format check
  passed.
- **Second run** (tree `33992033`): 36 failures and 2 errors, all content
  tests reading Git LFS files, such as `Andrew.vrm` failing media
  validation. This worktree held LFS pointers (533 files unfetched), the
  known worktree LFS pitfall. No failure touched the chat code.
- **Third run:** after `git lfs pull` (533 files fetched), on the same code,
  `python3 scripts/heavy-slot.py -- make check-test` passed:
  - the typed-content audit;
  - ruff format and ruff check;
  - mypy (868 files);
  - pytest: 4944 passed, 29 skipped.
- **Later edits:** after `33992033`, only this plan's records changed.

Repair round 1 is recorded under the revisions below.

Commits: Phase 2 is `c191ded9`. This phase's commit is
`feat(chat)[p3]: add benchmark-only episodic memory arms with unchanged
defaults`.

#### Code Review #1 Findings

The review ran in two parts, both independent `sdlc-reviewer` subagents at
the high-risk tier, on working tree `67010553` (src `544d2dd5`, tests
`9c6607fc`) against `c191ded9`.

**Checks reviewer.** Every check passed, with no P3-C findings. It reran:
- `tests/test_episodic_memory_arm.py` and all of
  `tests/test_memory_file_tools.py`: 75 passed;
- 33 test files that exercise the executor, prompts, structured replies,
  memory, Anthropic and the benchmark: 985 passed. The live-provider tests
  were left out;
- `ruff check` and `make mypy`: passed;
- its own default-path byte comparison against a `git archive` copy of
  `c191ded9`. It dumped guidance constants, schemas, JSON-mode prompts,
  response formats, lenient recovery and 16 assembled prompts per row,
  138 sections in all. Both trees gave the same sha256.

It noted that the implementer's goldens ran on an earlier source tree. They
were rerun on the final tree with the same results: no arm and arm (c)
identical to the baseline, arms (a) and (b) as recorded.

**Analysis reviewer.** Its result: changes required.

It verified:
- the default path is byte-identical (its own probe);
- arm (b) can never record an episode, through any of strict parsing,
  recovery, salvage or plain text;
- arm (a) refuses every write path, including native create and update,
  for every spelling of the alias;
- no request or production route reaches the arm;
- the `PyMainAgentResponse` split has no importers outside its module, in
  this repository or in Cloud.

Required:
- **P3-F1.** Nothing tests the executor line that gives
  `AnimaMemoriesTurn` the arm's `writable`. A mutation that deletes it
  leaves every test green, and arm (a) would then silently accept
  `MEMORIES.md` writes.

Optional:
- **P3-F2.** Arm (b)'s salvaged or plain-text replay text still holds
  `"remember":null`.
- **P3-F3.** The prompt's fallback response guidance ignores
  `remember_field`.
- **P3-F4.** An arm that does nothing is accepted silently: empty guidance,
  guidance without writes, or neither channel.
- **P3-F5.** The candidate guidance replaces the only prompt text that
  names `[self]/MEMORIES.md` and its editing rules. A note for Phase 5.
- **P3-F6.** The sensitive-memory comment drifted onto a helper string.
- **P3-F7.** Test notes: alias spelling variants are not covered, and
  default identity rests on the goldens.
- **Mock client.** Chat's mock client always sends `"remember": None`, so
  arm (b)'s mock replies parse only through lenient recovery. A note for
  Phase 4.

#### Code Review #1 Revisions

- **P3-F1: accepted.**
  - `_executor` in `tests/test_direct_chat_turn_executor.py` takes
    `episodic_memory_arm`.
  - The new test
    `test_the_episodic_memory_arm_decides_whether_the_turns_memories_are_writable`
    streams a turn and asserts the tool context's `writable` for the default
    arm (true) and for arm (a) (false).
- **P3-F2: accepted.** `render_main_structured_json(parsed, remember=…)`
  omits the note when false, and the executor passes the arm's `remember`.
  The default output is unchanged. Covered by
  `test_replayed_replies_follow_the_arms_fields`.
- **P3-F3: accepted.** The fallback is now
  `main_structured_output_guidance(remember=remember_field)`.
- **P3-F4: accepted.** `EpisodicMemoryArm.__post_init__` rejects an arm
  with neither channel, empty guidance, or guidance without writes. Covered
  by `test_an_arm_that_would_do_nothing_is_rejected`.
- **P3-F5: accepted as a Phase 5 requirement.** The candidate guidance must
  restate the `[self]/MEMORIES.md` path and the editing rules. Phase 5 adds
  a check that arm (b)'s prompt names the alias.
- **P3-F6: accepted.** The comment is back above `MEMORY_SYSTEM_GUIDANCE`.
- **P3-F7: accepted in part.**
  - The read-only tool test now runs for three alias spellings.
  - Byte identity with the baseline stays phase evidence (the goldens and
    the checks reviewer's comparison) rather than a tracked golden file.
    A permanent copy of the prompt text would break on every legitimate
    prompt change.
- **Mock-client note: carried to Phase 4.** Phase 4's mock smoke reads
  arm (b) recovery counts knowing the mock sends `remember`.
- **Arm (a) tool descriptions:** the recorded limitation stands. The Phase 7
  report states it.

**Repair check record (2026-10-25):**
- the three touched test files (`test_episodic_memory_arm.py`,
  `test_memory_file_tools.py`, `test_direct_chat_turn_executor.py`): 179
  passed;
- `ruff check`, `ruff format --check src/backend/animama tests` and
  `make mypy`: passed;
- the goldens rerun: no arm and arm (c) still identical to the baseline,
  arm (b) unchanged.

The full pre-push suite on the repaired tree (`8675dfba`: src `1acfeab1`,
tests `cbb5695d`), run as `python3 scripts/heavy-slot.py -- make check-test`,
passed:
- the typed-content audit;
- ruff format and ruff check;
- mypy;
- pytest: 4952 passed, 29 skipped.

The repairs went to a targeted recheck by both reviewers (Code Review #2).
Phase 3 passed with one repair round used.

#### Code Review #2 Findings

- **Analysis reviewer** (targeted recheck on `8675dfba`): pass.
  - All accepted repairs are resolved.
  - Its repeated mutation probe now fails the arm-(a) case and passes on
    the real tree.
  - Default bytes, including the replay rendering, are identical to the
    baseline.
  - Optional:
    - **P3-F8.** The mock-client note was missing from the Phase 4
      section.
    - **P3-F9.** `core.chat.replayed_reply` still renders `remember` for a
      model without it.
    - No test covers the executor's `remember=` argument to the replay
      renderer.
- **Checks reviewer** (targeted recheck; src `1acfeab1`, tests
  `cbb5695d`): checks pass, with no findings. It reran:
  - the three touched test files: 179 passed;
  - the 33-file affected set: 993 passed;
  - `ruff check` and `make mypy`: passed;
  - its default-path byte comparison against a fresh `git archive` copy of
    `c191ded9`, now covering replay rendering, strict parses and the
    fallback guidance: 261 sections, identical (sha256 `17e3d815…`).

#### Code Review #2 Revisions

- **P3-F8: accepted.** The note is added to Phase 4's mock smoke.
- **P3-F9: accepted, moved to Phase 4.** It changes `scripts/evals/core`,
  which Phase 4 uses. It is a planned Phase 4 change, recorded there.
- **The untested executor argument: rejected.** It is an optional repair
  with small impact. The renderer's own test and the analysis reviewer's
  byte probe cover it.

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
- **Replay helper.** `core.chat.replayed_reply` renders its replay with
  `remember` only when `output_type` has the field, as the executor does
  since Phase 3 (P3-F9).
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
  Chat's mock client always sends `"remember": None`, so arm (b)'s mock
  replies parse only through lenient recovery. Read the smoke's recovery
  counts knowing this (Phase 3, P3-F8).
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

Starting source: `e90e6345` (Phase 3's commit).

**Delivered** (`scripts/evals/benchmark/`):
- `memory_db.py`. The disposable database:
  - created next to the application database in the same PostgreSQL;
  - holds every application table, built from the ORM metadata as the
    test suite builds its databases;
  - dropped on exit, error or cancellation;
  - named afresh for each run (`animama_benchmark_<run directory>_<UTC
    time>_<random>`), recorded in the manifest before the run starts, and
    checked against `animama_benchmark_*`; an existing name fails as an
    input error;
  - holds one idle connection for the whole run, so `cleanup`, which drops
    leftovers that no session is using and never the application database,
    always keeps a running benchmark's database;
  - also holds the read-only Japanese search probe.
- `memory_runner.py`. Memory chats in arms (a), (b) and (c), the capture
  snapshot, and the recall chat.
  - Each configuration, arm and chat gets its own owner and Anima.
  - Each store is seeded with the persona's `IDENTITY.md`, the fixture's
    `MEMORIES.md` and its shared files.
- `manager_runner.py`. General, episode-processing and Reflection runs, each
  through the real `MemoryManagerService` with `auto_approve_diffs`.
  - Each catalog row runs once, at the effort its runtime applies (D16).
  - The OpenAI Agents and Anthropic SDK calls are wrapped so they count
    against the shared budget before they are sent, and record usage and
    the served model.
  - The `run` command turns Agents SDK tracing off for its process.
- **Prompt-set format:** `memory_fixtures`, `memory_chats` (each with a
  checklist and recall probes), `episodic_guidance` (pinned by sha256, and it
  must name `[self]/MEMORIES.md`, per P3-F5) and `memory_manager`.
- **Run loop:** core turns, then memory chats, then Memory Manager runs,
  all under one call and USD budget.
- **Turn records:**
  - every turn records `offered_tools`: the function tools, native tools and
    native `apply_patch` chat offered;
  - memory and recall turns add `arm`, `tool_calls` (tool, path, ok, code),
    `memory_cue`, `remember`, `probe_id`, `expect` and `recall_match`
    (`None` for a failed turn). Their tool calls, recovery and reply come
    from the rows chat persisted for the turn, including the calls chat
    rejected;
  - `capture` lines hold the checklist and the store snapshot;
  - `memory_manager` lines hold the run's messages, proposals and store.
- **Dry run:** memory turns (about 2 calls each, per configuration) and
  Memory Manager runs (about 6 calls each, once per row) count toward the
  planned calls, cost and time.
- **Manifest:** records `benchmark_database`, `japanese_search_probe` and
  `options.memory_arms`.
- **Core changes:**
  - `execute_turn` accepts `chats=None` for turns chat persists itself;
  - the stand-ins `NoAnimaProfile` and `SelectedModelProvider` are public;
  - `replayed_reply` renders `remember` only when the model has it (P3-F9);
  - `CallRecord.tool_calls` and `reply_calls` leave tool rounds out of the
    replayed reply and the recovery path;
  - `execute_turn`'s `on_prepared` may be a coroutine function: a memory
    turn closes its setup session there, as `chat:sse` does;
  - `CallBudget.admit` and `settle` serve both budget wrappers, and
    `catalog.llm_skip` is the one reading of `ANIMAMA_LLM_SKIP`;
  - `turn_record` is shared by core and memory turns.

**Deviations from the planned Changes:**
- **More real repositories.** Memory runs use the production repository
  bundle (`SQLAlchemyProductRepositories`) for Animas, chats, chat messages,
  memory, episodes and Memory Manager data, not only for memory. They also
  reuse production's session-backed turn recorder, episode recorder and
  memory tool service through a `TurnSessions` stand-in
  (`BenchmarkSessions`).
  - The plan had kept chats and the Anima in memory. A real Anima row and
    real chats cost nothing in a disposable database. They let OpenAI
    Responses memory chats continue from `previous_response_id`, as in
    production, and let Reflection read real chat turns.
  - Only the model catalog and the Anima chat profile remain stand-ins.
- **Schema source.** The database is built from the ORM metadata, not from
  `0001_baseline.sql`, matching the test suite.
- **Memory Manager composition.** It mirrors `server/memory_manager.py`,
  because that function cannot take the configuration's row or the budget
  hooks.
- **No pre-send compaction on memory turns.** Memory chats of about 12
  turns stay far below the compaction threshold; the runner composes no
  compactor.
- **Approvals.** The harness relies on production's `auto_approve_diffs`,
  which the existing suite tests. The benchmark tests assert the approvals
  each deterministic run makes, and the Anthropic runtime's budget path runs
  on the suite's fake SDK client.
- **Long chats.** The Phase 2 scripted-chat runner is unchanged.
  - Incognito turns skip pre-send compaction in the app.
  - The 30-turn chats stay far below the compaction threshold of about 90k
    tokens.
  - Compaction is not a v1 measure (spec).

Check record (2026-10-25). Every command ran from the repository root unless
stated, on code subtrees `scripts` `6661e5d9`, `src` `1acfeab1` (unchanged
since Phase 3) and `tests` `9765651f`. The full pre-push suite
(`python3 scripts/heavy-slot.py -- make check-test`) passed:
- the typed-content audit;
- ruff format and ruff check;
- mypy;
- pytest: 4958 passed, 29 skipped.

| Check | Command | Result |
| --- | --- | --- |
| Tests | `uv run --no-sync pytest -q tests/test_model_benchmark_memory.py tests/test_model_benchmark_runner.py tests/test_model_benchmark_core.py tests/test_gesture_selection_eval.py tests/test_episodic_memory_arm.py` | 114 passed |
| Lint and types | `uv run --no-sync ruff check`; `ruff format --check scripts/evals tests`; `make mypy` | Passed |
| Benchmark dry run | `… plan --prompts tests/fixtures/model_benchmark/memory_prompts.json --standard` | 148 calls (296 with repairs), about $0.053, 0.10 h |
| Stack smoke | See below | Passed |

The database tests in `tests/test_model_benchmark_memory.py` run on the
suite's PostgreSQL. They cover:
- a memory chat in each arm, checking channels, refusals, episodes,
  `MEMORIES.md` edits, shared files and recall;
- all three Memory Manager kinds under the deterministic runtime;
- the `run` command on the mock client, with its database dropped
  afterwards;
- `cleanup`;
- the name guard;
- both Memory Manager budget wrappers, with fake SDK objects.

**Stack smoke.**
- **Stack:** `ANIMAMA_LLM_SKIP=1 ./reset.sh --name bench --base-port 8900`,
  at `http://animama-bench.localhost:8900`, Compose project `animama-bench`.
- **Command:**
  `docker compose -p animama-bench exec -T -e ANIMAMA_LLM_SKIP=1 animama-server python -m scripts.evals.benchmark run --prompts /app/tests/fixtures/model_benchmark/memory_prompts.json --tier smoke --standard --max-calls 300 --max-usd 1 --price input=0.10,cached_input=0.01,cache_write=0.125,output=0.50 --output-dir /app/.animama-drafts/model-benchmark/p4-smoke`.
- **Result:** no abort and no errors.
  - 40 calls: 4 warm-ups plus 9 memory and recall turns × 4 configurations.
    The deterministic Memory Manager makes no model calls.
  - Every configuration had 3 captures, 6 memory turns, 3 recall turns and
    3 Memory Manager runs.
  - Arm (b)'s 12 memory turns recovered as `lenient`, because chat's mock
    client always sends `remember` (P3-F8). The other arms were `strict`.
  - The run's database `animama_benchmark_p4_smoke_20261026t040403` was
    dropped. The databases afterwards were `animama`, `postgres`,
    `template0` and `template1`.
  - Application database counts before and after were identical
    (`memory_entries|chats|chat_messages|memory_episode_items|anima|memory_manager_runs`
    = `5|0|0|0|2|0`).
  - `conditions.machine` recorded the container id; `--machine-label`
    overrides it.

Commits: Phase 3 is `e90e6345`. This phase's commit is
`feat(evals)[p4]: add the multi-turn, memory-arm and Memory Manager
runners`.

#### Code Review #1 Findings

Both high-risk reviewers reviewed the working tree on code subtrees
`scripts` `6661e5d9`, `src` `1acfeab1` and `tests` `9765651f` (baseline
`e90e6345`). Result: changes required.

**Analysis reviewer** (blocking):
- **P4-F1.** `execute_turn` passes tool-round calls (final text `""`) to
  `replayed_reply`, so a memory turn that uses a tool is recorded as
  `repaired`, and salvage reads the tool round's stream. A probe showed
  every arm's first turn as `repaired` with no repair. Chat marks a repair
  only from its own metadata.
- **P4-F2.** `tool_calls` misses the calls the executor rejects before the
  memory service (`unsupported_tool`, `invalid_arguments`,
  `memory_tool_round_limit`, `tool_call_id_reused`,
  `unsupported_tool_type`), inflating R5's success rate. The offered tools
  are not recorded, and no test checks them per option, row and arm.
- **P4-F3.** The Memory Manager runtimes ignore the configuration's effort,
  yet records carry it; a row's runs are paid twice. At minimum record the
  applied effort; the owner may choose one run per row.
- **P4-F4.** The cleanup test force-drops every `animama_benchmark_*`
  database in the PostgreSQL container that all xdist workers share, so it
  can kill another worker's test.
- **P4-F5.** Planned high-risk tests are missing: drop on error or
  cancellation, no application-database session or writes, the approvals,
  and budget wiring through the real runtimes (the non-skip branch of
  `_service` never runs).

**Checks reviewer** (every rerun passed: 114 tests, ruff, mypy, the dry
run, a stack smoke with all 46 application table counts unchanged, and live
cap, error, SIGINT, SIGKILL and cleanup probes; blocking):
- **P4-C1.** No test drops the database after an error (same gap as
  P4-F5).
- **P4-C2.** No test shows that memory work leaves the application database
  alone (same gap as P4-F5).

**Non-blocking** (both reviewers; numbered here):
- **P4-N1.** The database name truncates the run id after the timestamp is
  added, so a long directory name loses the timestamp; a rerun then
  collides with a leftover and fails with a raw `DuplicateDatabaseError`.
- **P4-N2.** The manifest written before the run has no database name.
- **P4-N3.** The every-arm test leaves its probe session unclosed.
- **P4-N4.** The plan's language list ignores memory work.
- **P4-N5.** `cleanup` force-drops databases in use and does not exclude
  the application database's name.
- **P4-N6.** `application_database_url` loses the SSL `connect_args` built
  from `PGSSLMODE`.
- **P4-N7.** The memory turn's setup session stays open across the stream;
  production closes it first.
- **P4-N8.** Memory turns have no pre-send compactor.
- **P4-N9.** `_BudgetedAgentsModel` does not forward `get_retry_advice`,
  `_supports_default_prompt_cache_key` or `close`.
- **P4-N10.** The Memory Manager's served model is not recorded.
- **P4-N11.** The capture snapshot excludes identity by path, omits
  descriptions, and does not mark seeded files.
- **P4-N12.** `recall_match` is `False` rather than `None` for a failed
  turn.
- **P4-N13.** The dry run prices memory calls at the core first turn's size.
- **P4-N14.** `set_tracing_disabled(True)` is process-global and leaks into
  later tests.
- **P4-N15.** DRY: three `_llm_skip` copies (one without `"y"`);
  `ManagerCalls` repeats the budget's admit and charge; `_ANIMA_MEMORIES_KIND`
  and `SELF_MEMORIES_ALIAS` duplicate domain constants; `_episodic_guidance`
  reuses `_LOADOUT_KEYS`; `_memory_turn_sink(unit: Any)`.
- **P4-N16.** The `cli` and `runner` docstrings are stale.
- **P4-N17.** No negative loader tests for the memory sections, no planner
  allowance test and no `recall_match` miss test.

#### Code Review #1 Revisions

- **P4-F1: accepted.** `CallRecord.tool_calls` counts the tools a call's
  final asked for, and `reply_calls` leaves tool rounds and failed calls out
  of the replay and of `recovery_path`. A memory turn's recovery and reply
  now come from the assistant row chat persisted (`structured_recovery`,
  and the content chat replays). The every-arm test asserts 3 calls and
  `strict` (`lenient` in arm (b)) on the tool-using turn;
  `test_reply_calls_leave_out_tool_rounds_and_failed_calls` covers the
  helper.
- **P4-F2: accepted.** The recording tool wrapper is gone: tool calls are
  read from the tool exchange chat persisted for the turn, so a rejected
  call is recorded with its code. Every turn records `offered_tools`. The
  fake model now also calls `web_search`, recorded as `unsupported_tool`;
  the test asserts the memory tools offered in every arm, no web search, and
  no tools on incognito turns.
- **P4-F3: accepted; one run per row (D16).** The agent decided rather than
  waiting, since the effort cannot apply and the halved spend only helps;
  the owner confirms D16 with the run plan at G3. Records name the row, and
  their `effort` is what `applied_effort` returns (`medium` for Haiku;
  `None`, the provider default, for OpenAI rows). The planner counts the runs once per row.
  `test_the_memory_manager_runs_once_per_row_at_the_runtime_effort` and the
  planner test cover it.
- **P4-F4: accepted.** `drop_leftover_databases` takes a `prefix` (it must
  start with `animama_benchmark_`); the test uses a prefix of its own and
  can no longer touch another worker's database.
- **P4-F5, P4-C1, P4-C2: accepted.** New tests:
  - `test_the_benchmark_database_is_dropped_on_error_and_on_cancellation`;
  - the every-arm test compares seven application table counts before and
    after, and makes `animama.local.database.get_engine` fail while the run
    works;
  - the every-arm test asserts the approvals: none for the general run, one
    approved create for episode processing, one approved `MEMORIES.md`
    update for Reflection;
  - `test_the_anthropic_runtime_calls_through_the_run_budget` runs the real
    Anthropic runtime on the suite's fake SDK client, with and without room
    in the cap. It found that the wrapper built the SDK stream before
    admitting the call; the stream is now built only after admission.
  - `test_the_openai_runtime_gets_the_budgeted_model_wrapper` checks the
    OpenAI runtime's `model_wrapper` counts against the budget. Driving the
    Agents SDK end to end is left to the paid run's smoke.
- **P4-N1, P4-N2: accepted.** Names are `animama_benchmark_<label>_<UTC
  time>_<random>`, chosen before the first manifest, which records them. A
  failed `CREATE` is an `EvalInputError`
  (`test_an_existing_benchmark_database_is_a_clear_input_error`).
- **P4-N3, P4-N4: accepted.**
- **P4-N5: accepted.** `cleanup` drops without `FORCE`, reports a database
  in use as kept, and skips the application database's name.
- **P4-N6: deferred.** The benchmark targets the task stack's loopback
  PostgreSQL, which uses no TLS; a TLS-only server fails at connect, clearly.
- **P4-N7: accepted.** The memory turn closes its setup session in
  `on_prepared`.
- **P4-N8: rejected.** Recorded as a deviation: memory chats stay far below
  the compaction threshold.
- **P4-N9, P4-N10: accepted.** The wrapper forwards the three hooks; the
  Anthropic and streamed Agents calls record the served model, and records
  list `served_models`. A non-streamed Agents response carries no model.
- **P4-N11: accepted in part.** The snapshot excludes identity by kind and
  includes descriptions. Seeded files are not marked: Phase 7 scores a
  capture against the chat's fixture, which holds the seed.
- **P4-N12: accepted.**
- **P4-N13: accepted as documentation.** The planner docstring says memory
  calls are priced at the core size, and the USD cap bounds the spend.
- **P4-N14: accepted.** Only the CLI's `main` turns tracing off.
- **P4-N15: accepted.** One `catalog.llm_skip`; `CallBudget.admit` and
  `settle`; the domain constants; `_PINNED_FILE_KEYS`; `MemoryTurn` is
  typed.
- **P4-N16: accepted.**
- **P4-N17: accepted in part.** Seven negative loader cases and a planner
  allowance test are added. A `recall_match` miss is left to Phase 7's
  scoring tests, which own the recall measure.

**Repair check record (2026-10-26)**, on code subtrees `scripts`
`37aea34b`, `src` `1acfeab1` (unchanged) and `tests` `311c5597`:

| Check | Command | Result |
| --- | --- | --- |
| Tests | `uv run --no-sync pytest -q tests/test_model_benchmark_memory.py tests/test_model_benchmark_runner.py tests/test_model_benchmark_core.py tests/test_gesture_selection_eval.py tests/test_episodic_memory_arm.py` | 129 passed |
| Lint and types | `uv run --no-sync ruff check`; `ruff format --check scripts/evals tests`; `make format-check`; `make mypy`; `uv run --no-sync mypy scripts/evals` | Passed |
| Benchmark dry run | `… plan --prompts tests/fixtures/model_benchmark/memory_prompts.json --standard` | 112 calls (224 with repairs), about $0.040, 0.08 h; Memory Manager calls once per row |
| Stack smoke | The Phase 4 smoke command, `--output-dir /app/.animama-drafts/model-benchmark/p4-repair1-smoke-2` | Passed |
| Full suite | `python3 scripts/heavy-slot.py -- make check-test` | Passed: typed-content audit, ruff format and check, mypy; pytest 4973 passed, 29 skipped |

The stack smoke made 40 calls with no abort and no errors. Arm (b)'s 12
memory and recall turns recovered as `lenient` (P3-F8) and the others as
`strict`. Memory Manager lines name each row once, with effort `medium` for
Haiku and `None` for Luna. The run's database was dropped, the application
counts stayed `5|0|0|0|2|0`, and `cleanup` found nothing to drop.

The repairs went to a targeted recheck by both reviewers (Code Review #2).

#### Code Review #2 Findings

- **Analysis reviewer** (targeted recheck on `scripts` `37aea34b`, `src`
  `1acfeab1`, `tests` `311c5597`): pass. Every blocking finding is
  repaired, with no blocking regression; it accepts the N6, N8, N13 and N17
  dispositions. Its probes confirmed the scoped cleanup with two workers and
  an OpenAI Responses row's native `apply_patch` records. Non-blocking:
  - **P4-R2-N1.** A failed memory turn records `tool_calls: []`, hiding
    tools that ran before the failure.
  - **P4-R2-N2.** `drop_leftover_databases` reports any drop error, such as
    a permission error, as "in use".
  - **P4-R2-N3.** `applied_effort` cannot tell the provider default from an
    Anthropic role default of `none`.
  - **P4-R2-N4.** No test covers an OpenAI Responses row's native
    `apply_patch` in `offered_tools` and the saved tool calls.
- **Checks reviewer** (same tree; every rerun passed: 129 tests, ruff, both
  mypy runs, the dry run, a stack smoke with all 46 application table counts
  and the write counters unchanged, SIGKILL and in-use cleanup probes):
  checks fail. P4-C1 and P4-C2 are fixed.
  - **P4-C3 (blocking).** `cleanup` says it keeps a running benchmark's
    database, but the run's engine holds no connection between sessions. In
    61% of samples during a mock run no session was connected, and a
    `cleanup` during the run dropped the database; the run then failed with
    `InvalidCatalogNameError`. The cleanup test held a connection by hand.
  - Non-blocking: the P4-R2-N2 point; the P4-F3 revision named the record
    field `applied_effort` (it is `effort`); Memory Manager lines add a
    configuration key per row, which Phase 7 must expect.

#### Code Review #2 Revisions

- **P4-C3: accepted.** `benchmark_database` holds one idle connection once
  the schema is built, so a drop without `FORCE` fails while a run is under
  way (review #3 found a short window at startup: P4-R3-C-N1). The test now runs `cleanup` inside a live `benchmark_database`
  context, after its only session has closed. With the held connection
  removed, the test fails.
- **P4-R2-N1: accepted.** A failed memory turn records `tool_calls: null`
  (unknown). Phase 7's changes say the tool measures leave such turns out.
- **P4-R2-N2: accepted.** Only SQLSTATE `55006` (object in use) counts as
  in use; any other drop error is an `EvalInputError` naming the database.
- **P4-R2-N3: rejected.** The runtime's role default is the constant
  `medium`, which `offered_effort` either returns or drops, so the call
  cannot resolve to `none`.
- **P4-R2-N4: accepted.**
  `test_an_openai_responses_row_writes_memory_through_native_apply_patch`
  covers the offered tools, the saved call and the recovery in every arm.
- **Field name and record shape: accepted.** The P4-F3 revision now names
  `effort`, and Phase 7's changes describe the row-level Memory Manager
  lines.

**Repair round 2 check record (2026-10-26)**, on code subtrees `scripts`
`56a035fc`, `src` `1acfeab1` (unchanged) and `tests` `f5074c05`:
- the five targeted test files: 130 passed;
- `ruff check`, `ruff format` on `scripts/evals` and the memory tests,
  `make format-check`, `make mypy` and `mypy scripts/evals`: passed;
- the full pre-push suite (`python3 scripts/heavy-slot.py -- make
  check-test`): the typed-content audit, ruff format and check, and mypy
  passed; pytest 4974 passed, 29 skipped;
- a stack smoke on `animama-bench` with `cleanup` called repeatedly during
  the run (`--output-dir /app/.animama-drafts/model-benchmark/p4-repair2-smoke`):
  the one call that overlapped the run reported its database as kept, in
  use; the run finished with no abort and 40 calls; its database was then
  dropped, and the application counts stayed `5|0|0|0|2|0`.

The repairs went to a final targeted recheck by both reviewers (Code Review
#3), the last one the review budget allows.

#### Code Review #3 Findings

- **Analysis reviewer** (scripts `56a035fc`, src `1acfeab1`, tests
  `f5074c05`; 130 targeted tests rerun with two workers): pass. The held
  connection closes on error and cancellation before the `FORCE` drop in
  `finally`; only SQLSTATE `55006` counts as in use; no regression in the
  core or the Gesture harness. Non-blocking: the startup window below, and
  no test asserts `tool_calls: null` for a failed memory turn.
- **Checks reviewer** (same tree): checks pass. It reran the 130 tests (no
  `SAWarning`), ruff, `make mypy` and `mypy scripts/evals`, and sampled four
  mock runs every 20 ms: a connection was open in 110–117 of 112–118
  samples, the gaps at startup and at the run's own drop. A `cleanup` 4 s
  into a run kept the database, and the run finished with 40 calls and no
  errors; repeated `cleanup` from early in a run never dropped it. All 46
  application table counts and the write counters were unchanged.
  Non-blocking:
  - **P4-R3-C-N1.** A `cleanup` right after `CREATE DATABASE`, or between
    schema creation and the held connection, still drops a starting run's
    database; the run then fails before any model call.
  - **P4-R3-C-N2.** A `cleanup` during a run waits about 5 s for the run's
    sessions before failing with `55006`, and blocks the run's new
    connections meanwhile, which distorts latency.

#### Code Review #3 Revisions

- **P4-R3-C-N1 and P4-R3-C-N2: deferred to documentation.** The review
  budget is spent, so no code changes after review #3. Both failures need
  `cleanup` to run during a run; Phase 8's README and skill say to run it
  between runs. A startup collision fails before any spend.
- **The untested `tool_calls: null`: accepted as is.** The branch is one
  line with a comment, and Phase 7 consumes it.

Phase 4 passed with both repair rounds used.

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
  existing size and sensitivity rules. It restates the `[self]/MEMORIES.md` path and the editing rules
  (small edits; no create, delete, move or rename), because it replaces the
  only prompt text that names them (P3-F5). A check asserts that arm (b)'s
  assembled prompt names the alias.
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

Starting source: `a601a416` (Phase 4's commit).

**Delivered** (`docs/benchmarks/inputs/`, drafted by sub-agents and
assembled under seed 470 for the held-out choice):
- `prompts.json`, version `2026-10-26.1`:
  - 97 single-turn items: 73 English (tags: emotions and named emotions,
    conversation beats, neutral, greetings and goodbyes, jokes, surprise,
    praise, celebration, thinking, 7 style traps, 6 Audio-tag moments and 2
    no-tag moments) and 24 Japanese, each paired with its English original;
  - three scripted chats: `stressful-week` (Annie, 30 turns),
    `trip-and-hobby` (neutral, 30 turns) and `smoke-short-chat` (6 turns,
    smoke tier only);
  - two memory fixtures and three memory chats of 12 turns with 9 checklist
    items and 4 recall probes each: `new-job`, `busy-week` and
    `new-job-ja` (the Japanese pair of `new-job`);
  - six Memory Manager runs, two of each kind;
  - personas `neutral` and Annie (the starter identity, D14).
- `loadout-starter-v1.json`: the 140 Gestures of the current Included set,
  sorted by selector and pinned by sha256 (see G2).
- `episodic-guidance.md`: the candidate guidance for arm (b). It names
  `[self]/MEMORIES.md` and the editing rules (P3-F5), keeps the existing
  size and sensitivity rules, and adds a `## What's been happening` section
  for news and decisions.
- `rubrics.json`, version `rubrics-1`: eight rubrics (`reply`,
  `expression`, `audio_tags`, `long_chat`, `memory_turn`, `capture`,
  `recall`, `memory_manager`), each criterion with 1–5 anchors and an
  example per anchor. `capture` judges each checklist item present or
  absent, with evidence. Phase 6 builds the output schemas from them.
- `tests/test_model_benchmark_inputs.py`: the tracked set validates, has
  both languages and a smoke tier; the held-out share per item area is
  18–22% and Japanese items follow their English pair; every criterion has
  five anchors; and arm (b)'s assembled prompt names `[self]/MEMORIES.md`
  only through the tracked guidance, on all three built-in rows.

**Smoke tier against D10** (approved with the set at G2): 16 single-turn
items (4 Japanese) under both personas rather than about 20 under one, the
6-turn `smoke-short-chat`, the `new-job` memory chat in all three arms, and
one Memory Manager run of each kind rather than one in all. It stays a cheap
wiring and regression tier: 576 planned calls.

**Held-out shares** (seed 470):

| Area | Held out |
| --- | --- |
| Single-turn items (`core`) | 18 of 97 (18.6%): 15 of 73 English and 3 of 24 Japanese, the pairs of held-out English items |
| Long chats | 0 of 3 |
| Memory chats | 1 of 3 (`busy-week`) |
| Memory Manager runs | 1 of 6 (`episodes-busy-month`) |

The small areas cannot reach 18–22%; G2 decides whether a long chat is held
out (one of two full chats is 50%).

Check record (2026-10-26), on the tracked inputs above:

| Check | Command | Result |
| --- | --- | --- |
| Manifest, selectors and pairs | `load_prompt_set(docs/benchmarks/inputs/prompts.json)` | Valid: every `acceptable` selector is in the loadout, every Japanese item names an existing English pair |
| Input tests | `uv run --no-sync pytest -q tests/test_model_benchmark_inputs.py` | 6 passed |
| Privacy scan | email, phone, URL, IP, card-number and key patterns over the prompts, guidance and rubrics | No personal data; one `https://example.com/recipe` link in a style-trap item and the version string matched as a phone number |
| Full tier dry run | `… plan --prompts docs/benchmarks/inputs/prompts.json --standard --tier full` | 2,268 calls (4,536 with repairs), about $2.43, 1.57 h before judging; about 9.7k input tokens per first turn |
| Smoke tier dry run | `… --tier smoke` | 576 calls, about $0.62, 0.40 h |

**For the owner at G2** (the drafting agents flagged these):
- **Loadout:** the current Included set of 140 Gestures, rather than the
  plan's 95 non-idle Gestures. It matches what a new Anima equips; the 95
  would cut prompt tokens.
- **Acceptable Gestures:** some items' acceptable lists are judgement calls.
- **Translations:** the 24 Japanese items and `new-job-ja` are agent
  translations with no further check (as agreed).
- **Candidate guidance:** the new `## What's been happening` section.
- **Checklists:** for example, a food allergy (kiwi) is a must-keep item,
  not a sensitive one.
- **Held out:** the choices above, and whether to hold out a long chat.

**G2 (2026-10-26, owner): approved as drafted.** The owner approved the
140-Gesture loadout, the acceptable lists, the translations, the candidate
guidance with its `## What's been happening` section, the checklists and the
held-out choices, with no long chat held out. D14's personas stand as
drafted. No notes were raised.

Commits: `8b9f725c` (`feat(evals)[p5]: add the v1 benchmark prompt set and
rubrics`), then this G2 record.

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

Starting source: `50ec9681` (the G2 record).

**Delivered** (`scripts/evals/benchmark/`):
- `rubrics.py`: loads and checks the tracked rubrics (unique ids, known
  kinds, five anchors per criterion, or capture's item judgement); renders
  the system prompt (instructions, then every criterion's anchors, then the
  output rule) and the batch output schema; validates an output against the
  schema and the batch's ids (and, for capture, exactly the checklist).
- `judge_items.py`: one blind item per rubric and record. Items carry the
  persona by id, up to six earlier exchanges of the same chat, the reply,
  and per rubric: lengths (reply), each Gesture's name and description
  (expression), only tagged replies (Audio tags), the remember note, each
  memory tool call in provider-neutral terms (action list, read, search or
  write; path; outcome succeeded, refused or failed) and the turn's memory
  changes as diffs of the stored files (memory turn), the checklist texts as the reference for open
  recall probes, a capture snapshot in the same three sections for every
  arm, and a Memory Manager run's input, store before, edits and final
  message. Whole scripted chats are judged only when complete. Failed turns
  and the warm-up are not judged.
- `judge.py`:
  - `plan_judging`/`load_or_plan`: opaque ids and a seeded shuffle per
    rubric, fixed batch sizes (`BATCH_SIZES`), and `judge/plan.json`,
    `judge/batches/<id>.json` (each batch's items, naming personas by id)
    and `judge/mapping.json` (never sent). The prompt sent adds each
    persona's identity text once, and for expression the equipped Gestures;
    each result records its sha256. A plan is reused only for the same
    turns, prompt set, rubrics, judge model, seed and batch sizes.
  - `ClaudeCli`: `claude -p` with the D7 flags plus `--strict-mcp-config`,
    `--disable-slash-commands` and stream-json output, from a new empty
    directory in its own process group. It inherits only `PATH`, `HOME`,
    `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TMPDIR`, `TERM`,
    `CLAUDE_CONFIG_DIR` and the proxy and certificate variables, so no API
    key, endpoint, provider switch or calling Claude session's settings
    reach it. Each call's start-up event must show
    the subscription (`apiKeySource: none`), only the structured-output
    tool, no MCP servers, skills, slash commands or non-built-in plugins,
    and the pinned model; otherwise judging stops, and a CLI that cannot
    start stops it too.
  - `run_judging`: up to `--concurrency` calls at once; three attempts per
    batch, then `missing`; one result file per batch and effort under
    `judge/<effort>/` with the served model, effort, CLI version, rubric
    version and hash, the sent prompt's sha256, attempts, timestamps and
    usage. A usage limit or a sign-in problem stops cleanly and can resume;
    broken isolation needs fixing first. A rerun skips completed batches,
    retries missing ones, and refuses a result from another judge model or
    rubric version. A timeout, an interruption, SIGTERM or SIGHUP kills the
    calls' process groups; a signal ends the run as a resumable stop.
- `cli.py`: `judge --run-dir --prompts --effort [--concurrency] [--rubric]
  [--batch] [--claude] [--timeout]`, which checks the prompt set against the
  run's manifest, refuses a run still marked running unless
  `--allow-unfinished`, and refuses unknown `--rubric` or `--batch` values.
  Exit 0 when every batch is scored, 1 with missing scores, 2 for an input
  error, 3 when stopped. `plan` and `run` add the judging estimate
  (`--judge-effort`, `--judge-concurrency`) to the wall time and the
  4-hour check.
- `planner.py`: `judged_items` and `judge_estimate`: items per rubric from
  each rubric's kinds in the rubric file, with Audio-tag items at an
  assumed 30% of replies; batches; and seconds and input tokens per batch,
  measured for reply and expression (`JUDGE_SECONDS_PER_BATCH`,
  `JUDGE_INPUT_TOKENS_PER_BATCH`). The other rubrics assume the slowest
  measured seconds and show no token figure.
- `memory_runner.py`: each memory and recall turn snapshots the store before
  and after it and records `memory_changes`, one diff with no context per
  changed file (`[self]/` for the Anima's own files), so an edit reads the
  same whichever provider's tool made it. Tool-call records keep the call's
  other arguments for audits; the judge never sees them.
- `results.py`: `write_json`, the atomic write the manifest and the judge
  files share; a malformed `turns.jsonl` line is an input error.
- Tests: `tests/test_model_benchmark_judge.py` (23) with a stub CLI;
  `tests/fixtures/model_benchmark/judge_run/`, 20 hand-written single-turn
  replies on the v1 set, for the tests and the live smoke.

**Deviations:**
- `calibrate export|import|pilot` move to Phase 7 with the agreement
  statistics; Phase 6 supplies the pilot mechanics (`judge --batch` at each
  effort).
- Memory-turn items take their diffs from store snapshots around each turn,
  which the plan did not list; they cost two database reads per turn and no
  model call.
- The expression rubric's batch lists the 140 equipped Gestures once, so the
  judge can tell whether a better choice was available.

**Live smoke (D6, D8; 2026-10-26).** All on the owner's subscription, with
no API spend.
- **D6 confirmation:** one tiny isolated call (a two-field schema) reported
  model `claude-opus-5-5`, CLI `2.1.303 (Claude Code)`, `apiKeySource:
  none`, tools `["StructuredOutput"]`, and no MCP servers, slash commands or
  skills; only the built-in plugins were present. About 1.4k input tokens
  were cached in total, so no `CLAUDE.md`, memory or user output style
  reached the judge (there is no user `CLAUDE.md` or user hook on this
  machine, and restricted mode ignores the settings files).
- **Four batches:** `judge --rubric reply --rubric expression
  --concurrency 2` on a copy of `tests/fixtures/model_benchmark/judge_run`
  in `.animama-drafts/model-benchmark/judge-smoke`, at medium and then high.
  Every call passed the isolation check and was scored on its first attempt.

  | Batch (20 items) | Medium | High |
  | --- | --- | --- |
  | `reply` | 8.7 s, 1,065 output tokens | 17.9 s, 2,039 output tokens |
  | `expression` (with the 140 equipped Gestures) | 26.9 s, 2,760 output tokens | 31.8 s, 3,532 output tokens |

  - Two calls at a time ran with no usage-limit stop, so the default
    concurrency stays 2. `JUDGE_SECONDS_PER_BATCH` rounds these up per
    rubric (reply 10 s and 20 s, expression 30 s and 35 s), and other
    rubrics assume the slowest (30 s and 35 s).
  - The three deliberately weak replies averaged about 2 on both rubrics at
    both efforts; the others averaged 4.3–4.7.
- **Estimate with judging:** the full tier is 2,268 contestant calls and
  223 judge batches: about 2.28 h with the judge at medium (0.70 h of it
  judging), or 2.49 h at high, within the 4-hour bound.
- **After review #1:** one more tiny call through the repaired adapter, with
  the environment allowlist, confirmed `claude-opus-5-5`, `apiKeySource:
  none` and the same isolation on CLI `2.1.310`; the calling session's
  entrypoint no longer reached the CLI.

Check record before review (2026-10-26), on code subtrees `scripts`
`83884a4a`, `src` `1acfeab1` and `tests` `f036703e`: 154 targeted tests;
`ruff check`, `ruff format --check scripts/evals tests`, `make
format-check`, `make mypy` and `mypy scripts/evals` passed; the full-tier
dry run planned 2,268 calls and 223 judge batches; the live smoke above.

Commits: `feat(evals)[p6]: add blind judging through the Claude CLI`.

#### Code Review #1 Findings

Analysis reviewer (standard tier, initial; `scripts` `83884a4a`, `src`
`1acfeab1`, `tests` `f036703e`): changes required. It reused the check
record and probed with stubs only.
- **P6-F1 (blocking).** Memory-turn items passed provider tool names and
  argument shapes through (`apply_patch` with `update_file` diffs on
  OpenAI Responses rows, `memory_apply_patch` with `replacements`
  elsewhere), so the judge could tell the models apart (R12 blind). The
  blindness test covered only one provider.
- **P6-F2 (blocking).** The planned tokens per judge batch were neither
  printed nor recorded as a deviation.
- Non-blocking:
  - **P6-F3.** The memory-turn rubric promises edits as diffs; items held
    raw arguments.
  - **P6-F4.** A three-variable deny-list let a calling Claude session's
    variables and provider switches reach the CLI.
  - **P6-F5.** A missing `apiKeySource` passed the isolation check.
  - **P6-F6.** A missing CLI, a malformed `turns.jsonl` or a missing batch
    file exited 1, the "missing scores" code, with a traceback.
  - **P6-F7.** Unknown `--rubric` or `--batch` values selected nothing and
    exited 0.
  - **P6-F8.** The ledger did not check a result's model or rubric version.
  - **P6-F9.** Three recovery messages misled: the plan-mismatch advice,
    "resume" after broken isolation, and Ctrl+C's "turns" wording.
  - **P6-F10.** Judging a run still marked running would lock the plan to
    partial turns.
  - **P6-F11.** A timeout or cancellation killed only the CLI, not its
    children.
  - **P6-F12.** The plan called the batch files "exactly what is sent".
  - **P6-F13.** DRY and robustness: the planner repeated each rubric's
    kinds; `BATCH_SIZES` had a silent default; the atomic write was
    duplicated; a misleading variable name; a `KeyError` on a malformed
    rubric file.
  - **P6-F14.** No tests for the sign-in stop, a rejected rate limit, or
    the timeout kill.
  - **P6-F15.** One seconds-per-batch figure for every rubric.

#### Code Review #1 Revisions

- **P6-F1, P6-F3: accepted.** Each tool call becomes provider-neutral: an
  action, the path, the outcome and the change as `-`/`+` lines (search
  adds its query). The blindness test now includes an OpenAI `apply_patch`
  call and fails on `apply_patch`, `memory_write_file`, `update_file` or
  `replacements` anywhere in a prompt; it asserts both providers' calls
  have the same fields.
- **P6-F2, P6-F15: accepted.** The dry run prints, per rubric, the items,
  batches, seconds and input tokens per batch, marking the reply and
  expression figures as measured and the rest as assumed (the slowest
  measured figure).
- **P6-F4, P6-F5: accepted.** An allowlist replaces the deny-list, and
  `apiKeySource` must be `none`. A tiny call confirmed the allowlist still
  signs in (Live smoke).
- **P6-F6, P6-F7, P6-F9, P6-F10: accepted.** A CLI that cannot start stops
  judging (exit 3, "fix this, then rerun"); a malformed `turns.jsonl` line
  or batch file is an input error (exit 2); unknown selections are input
  errors; stop messages say whether a rerun resumes; Ctrl+C names
  batches; a run marked running needs `--allow-unfinished`.
- **P6-F8: accepted.** The plan fingerprint includes the judge model, and a
  completed result from another model or rubric version is an input error.
- **P6-F11: accepted.** Each call runs in its own process group, killed on
  a timeout or an interruption. A test checks that timed-out calls are
  gone and recorded as missing after three attempts.
- **P6-F12: accepted.** The plan wording is corrected, and each result
  records the sent prompt's sha256.
- **P6-F13: accepted.** Rubric kinds come from the rubric file, with the
  two filters (`TAGGED_REPLIES_ONLY`, `OPEN_PROBES_ONLY`) shared by the
  items and the planner; an unknown rubric has no batch size and is an
  error; `results.write_json` serves both; the rest are fixed.
- **P6-F14: accepted.** Tests cover a rejected rate limit, a signed-out
  CLI, the timeout kill, an API-key credential source, a missing CLI, a
  mismatched result and an unfinished run.

**Repair check record (2026-10-26)**, on code subtrees `scripts`
`abad1c7a`, `src` `1acfeab1` (unchanged) and `tests` `475e34b1`:
- the seven affected test files: 158 passed;
- `ruff check`, `ruff format --check scripts/evals tests`, `make
  format-check`, `make mypy` and `mypy scripts/evals`: passed;
- the full-tier dry run: 2,268 calls, 223 judge batches, 2.49 h with the
  judge at high;
- one tiny live call through the repaired adapter (Live smoke).

#### Code Review #2 Findings

Analysis reviewer (targeted recheck on `scripts` `abad1c7a`, `src`
`1acfeab1`, `tests` `475e34b1`): changes required. It confirmed P6-F2 to
P6-F15 resolved, with the notes below.
- **P6-F1 (blocking, partly repaired).** Tool names were hidden, but the
  same edit still rendered differently by provider: a replacement repeats
  its unchanged anchor line as removed and added, while a V4A patch shows
  only the added line; `replace` and `delete` each came from one provider
  only; a whole-file write showed every line as added. The test compared
  different edits.
- Non-blocking:
  - **P6-R1.** With its own process group, a call no longer received
    SIGTERM or SIGHUP sent to the judge's group, and Python's default
    SIGTERM handling skipped the cleanup, leaving the CLI running.
  - **P6-R2.** Two docstrings still said the batch files are what the judge
    receives.
  - **P6-R3.** A Delivered sentence suggested token figures were assumed
    for unmeasured rubrics.
  - **P6-R4.** The allowlist dropped proxy and certificate variables.
  - **P6-R5.** A timeout of `claude --version` ended in a traceback.

#### Code Review #2 Revisions

- **P6-F1: accepted, with the reviewer's more faithful option.** Each memory
  and recall turn snapshots the store before and after it, and records
  `memory_changes`: a no-context diff per changed file. Memory-turn items
  show tool calls only as action (list, read, search or write), path and
  outcome, plus those diffs. The judge test gives a Haiku and a Luna turn
  the same edit through `memory_apply_patch` and native `apply_patch` and
  asserts their items are identical; the database tests check the diffs,
  and the Responses-row test shows that a patch rewriting an unchanged
  line yields only the added line.
- **P6-R1: accepted.** The run installs SIGTERM and SIGHUP handlers that
  cancel it, so every call's process group is killed; the stop is
  resumable. `_stop` kills the group even after the CLI exited.
  `test_sigterm_stops_judging_and_kills_the_running_calls` covers it.
- **P6-R2, P6-R3: accepted.** The wording is fixed.
- **P6-R4: accepted.** Proxy and certificate variables are kept.
- **P6-R5: accepted.** A version timeout stops judging (not resumable).

**Repair round 2 check record (2026-10-26)**, on code subtrees `scripts`
`86e25d54`, `src` `1acfeab1` (unchanged) and `tests` `718c91be`:
- the seven affected test files: 159 passed; the judge tests also pass
  under two xdist workers (23);
- `ruff check`, `ruff format --check scripts/evals tests`, `make
  format-check`, `make mypy` and `mypy scripts/evals`: passed.

The repairs went to the final targeted recheck (Code Review #3).

#### Code Review #3 Findings

Analysis reviewer (`scripts` `86e25d54`, `src` `1acfeab1`, `tests`
`718c91be`): pass, with no blocking findings. It confirmed the rest of P6-F1
(an insertion renders once, with no anchor line; a whole-file replace shows
only the changed line; Haiku and Luna items for the same edit are equal) and
P6-R1 to P6-R5, including a SIGTERM probe through the `judge` command that
left no stub running and no result written. The dry run was unchanged.
Non-blocking:
- **P6-N1.** Dropping lines that start with `---` or `+++` to remove the
  diff headers also dropped a removed `--`/`---` line of the file itself; a
  trailing-newline-only change gave an empty diff.
- **P6-N2.** The SIGTERM test signalled on a fixed timer, which a slow
  runner could beat.
- **P6-N3.** `run_judging` must run on the main thread and resets SIGTERM
  and SIGHUP to their defaults afterwards; worth a note for Phase 7.

#### Code Review #3 Revisions

The review budget is spent; these are small standard-tier repairs the
coordinator verified itself.
- **P6-N1: accepted.** `memory_changes` drops exactly the two header lines
  and skips files whose lines are equal.
  `test_memory_changes_diff_the_stored_files_line_by_line` covers a created
  file, a deleted file, a removed `---` divider and a trailing newline.
- **P6-N2: accepted.** The test signals once both calls are running, and
  allows killed stubs up to 5 s to exit and be reaped: in ten runs before
  this change, a few left a killed stub briefly unreaped at the moment the
  run returned (each was gone moments later, since every stub sleeps 30 s).
  Ten further runs passed.
- **P6-N3: accepted.** `run_judging`'s docstring says so.

**Final check record (2026-10-26)**, on code subtrees `scripts` `8c494fef`,
`src` `1acfeab1` (unchanged) and `tests` `5c772079`: the seven affected test
files, 160 passed; the judge and memory tests under two xdist workers, 45
passed; `ruff check`, `ruff format --check scripts/evals tests`, `make
format-check`, `make mypy` and `mypy scripts/evals` passed.

Phase 6 passed review #3 with both repair rounds used.

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
- **Calibration commands (D2, D15).** `calibrate export` draws the
  stratified blind sample from a run's judge plan and writes a rating sheet
  that shows each item as the judge sees it; `calibrate import` reads the
  owner's ratings; `calibrate pilot` runs `judge --batch` on the sample's
  batches at medium and high, computes the agreement and pins the effort.
  Phase 6 supplies the blind items, batches and per-effort results.
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
- **Phase 4 record shapes.**
  - Memory Manager lines carry the row id as `configuration` (D16), so
    `turns.jsonl` has one more key per row than the configurations.
  - A failed memory turn records `tool_calls: null`: chat persisted none of
    its tool exchange. The tool measures leave failed turns out, and the
    report counts them.
  - Seeded files are recognized by comparing a capture with the chat's
    fixture (P4-N11).
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

Starting source: `9b94c721` (Phase 6's commit).

**Delivered** (`scripts/evals/benchmark/`):
- `intervals.py` (D9, standard library only): `bootstrap_mean` resamples
  whole groups 2,000 times with seed 470 for a 95% interval;
  `bootstrap_paired` resamples pairs; `distinguishable` is false when
  intervals overlap or either rests on fewer than `MIN_GROUPS` (5) groups;
  `agreement` and `agreement_table` give quadratic-weighted kappa, exact and
  within-one agreement.
- `scores.py`: `load_judge_results` joins one effort's batch results back
  to the records through the blind mapping; every planned item without a
  completed score stays in the results as missing, with batch counts, the
  served models, CLI versions and rubric version.
- `report.py`: `build_report` computes, per configuration, the judged reply,
  expression, Audio-tag and long-chat scores with intervals and missing
  counts, every criterion, Gesture fit with an interval, the other
  deterministic measures with their counts (recovery paths, speech checks,
  latency, tokens, cost, priced or not), reply length, the distributions,
  rankings (only pairs whose intervals are apart), English–Japanese pairs
  (reply, expression, Gesture fit, same Gesture and tone, intensity and
  tagged replies, grouped by item; and each Japanese memory chat's kept
  entries and recall against its original), tuned and held-out splits, the
  memory arms (capture kept, missed, noise kept, sensitive breaks and
  unjudged captures; notes and changed files against the fixture's seed;
  recall matches with failed turns; judged recall and memory-turn
  criteria; tool calls per turn and success, with failed turns counted
  apart; latency and input tokens; paired kept-rate differences), the
  Memory Manager per row, the judge record with the family caveat,
  calibration, conditions with each configuration's price source, and
  inputs. `render_report` writes Markdown with the limitations and the
  owner's recommendations, from `--recommendations` or as placeholders.
  `check_public_safe` refuses a report that holds any reply, saved-memory,
  tool-argument, prompt, persona, fixture or guidance line of 20 characters
  or more that holds a letter, and names the sources it found.
- `calibrate.py` (D15): `export` samples up to 18 English items each of the
  `reply` and `expression` rubrics, in turn across configurations and
  areas, as their own blind judge plan under `calibration/judge/`, with a
  rating sheet showing each batch as the judge receives it and a
  `ratings.json` to fill; `import_ratings` checks the owner's scores;
  `pilot` judges the sample at medium and high, records each effort's
  agreement per criterion, and pins the higher mean kappa over the criteria
  both efforts scored (`pin_effort`, medium on a tie) in
  `calibration/result.json` with the prompt-set version. Sampling gives
  each configuration an equal share, then cycles its areas.
- `cli.py`: `calibrate export|import|pilot` and `report [--effort]
  [--output] [--title] [--recommendations] [--overwrite] [--rerender]`,
  sharing the run checks of `judge`. `report` checks the judge plan's
  fingerprint, takes the pinned effort or the one judged effort (an input
  error otherwise), refuses to replace a differing report without
  `--overwrite`, and with `--rerender` exits 1 unless the rebuilt report
  matches byte for byte.
- `judge.py`: `load_plan` and `inputs_fingerprint`, shared with the
  calibration plan.
- Tests: `tests/test_model_benchmark_report.py` (16): seeded and paired
  intervals against fixed values, kappa against hand-computed examples
  (including one that separates quadratic weights), the minimum-groups
  rule, capture totals per arm, held-out totals, English–Japanese pairs,
  the long-chat and Memory Manager joins, the safety guard (sources, and no
  refusal for dividers), byte-equal re-rendering with owner text, the
  report's effort, overwrite and fingerprint checks, equal sampling, effort
  pinning, and the whole calibration flow on the stub CLI with a resumed
  pilot. The judge fixture's records now carry every field a run records.

**Deviations:**
- Calibration covers the `reply` and `expression` rubrics, 36 items at
  most, so the owner's rating stays within D15's 30–40 replies; the other
  rubrics are judged by Opus alone. The spec's acceptance asks for agreement
  per measure, so the owner confirms this scope at G4. The sample cannot be
  stratified by score range, since it is drawn before any judging; it is
  stratified by configuration, then area.

**Sample report.** The Phase 4 mock smoke run, judged with the stub CLI and
rendered with `report --title "Model benchmark report (mock smoke
sample)"`, is in `.animama-drafts/model-benchmark/p7-sample/report.md` (223
lines); `report --rerender` matched it byte for byte, and the safety guard
passed. That run holds memory work only; Phase 8's mock rehearsal on a task
stack renders a full report.

Check record before review (2026-10-26), on code subtrees `scripts`
`e5001fea`, `src` `1acfeab1` and `tests` `d5658cc0`: 167 tests across the
eight benchmark test files; `ruff check`, `ruff format --check scripts/evals
tests`, `make format-check`, `make mypy` and `mypy scripts/evals` passed;
the sample report rendered and re-rendered identically.

Commits: `feat(evals)[p7]: add benchmark scoring and reports`.

#### Code Review #1 Findings

Analysis reviewer (standard tier, initial; `scripts` `e5001fea`, `src`
`1acfeab1`, `tests` `d5658cc0`): changes required. It reused the check
record and probed with stubs only.
- **P7-F1 (blocking).** The bootstrap grouped each item and persona apart
  (and each chat turn apart), and English–Japanese pairs were resampled one
  by one, against D9's "an item's repeats and personas" together; intervals
  came out too narrow.
- **P7-F2 (blocking).** Rankings and "apart" verdicts could rest on one or
  two groups (two long-chat transcripts per configuration).
- **P7-F3 (blocking).** `report` without `--effort` on an uncalibrated run
  said the run was not judged and nothing was missing.
- **P7-F4 (blocking).** English–Japanese pairs compared only the overall
  reply score; R9 also asks for Gesture, tone, intensity, Audio tags, memory
  behavior and the other judged scores.
- **P7-F5 (blocking).** The memory table left out computed tokens, failed
  turns and unjudged captures; the token mean counted unreported usage as
  zero.
- **P7-F6 (blocking).** The scorecard had no token column, cost showed no
  price source, and unpriced turns read as $0.
- **P7-F7 (blocking).** Rates (Gesture fit, strict parse, tagged replies,
  tool success) had no sample size or interval.
- Non-blocking: **P7-N1** uneven sampling across configurations; **P7-N2**
  the guard refused harmless dividers and named no source, and missed the
  Memory Manager store and tool arguments; **P7-N3** `report` overwrote
  owner text; **P7-N4** `report` did not check the judge plan's
  fingerprint; **P7-N5** a stopped pilot printed nothing; **P7-N6** mean
  kappa over different criteria per effort; **P7-N7** duplicate long-chat
  lookup; **P7-N8** kappa examples that do not prove the weighting, and
  untested joins, verdicts, pinning, resume and sampling; **P7-N9** plan
  wording on score ranges, the per-measure acceptance and the prompt-set
  version in calibration results; **P7-N10** no reply-length column and no
  memory split; **P7-N11** hard-coded memory criteria and loose typing;
  **P7-N12** the sample report covers memory work only; **P7-N13**
  correlated turns within a conversation.

#### Code Review #1 Revisions

- **P7-F1, P7-N13: accepted.** A group is a single-turn item with all its
  personas and repeats, or a whole conversation; English–Japanese
  differences are grouped by item. Kept-rate differences keep pairing
  checklist entries, since a run has too few memory chats to resample
  whole; D9 records both.
- **P7-F2: accepted.** `MIN_GROUPS` (5): fewer groups give "too few to
  compare" and no ranking. Recorded in D9 for the owner.
- **P7-F3: accepted.** With a judge plan and no effort, `report` uses the
  pinned effort or the one judged effort, and otherwise asks for
  `--effort`. The `load_judge_results` docstring is corrected.
- **P7-F4: accepted.** Pairs add expression, Gesture fit, same Gesture and
  tone, intensity and tagged-reply differences, and each Japanese memory
  chat's kept entries and recall against its original.
- **P7-F5, P7-F6, P7-F7, P7-N10 (length): accepted.** The memory table adds
  input tokens (unreported usage left out), failed turns and unjudged
  captures; the scorecard adds tokens and shows "unpriced"; the conditions
  table shows each configuration's price source; rates show their counts,
  and Gesture fit has an interval; the reply criteria table adds the median
  speech length.
- **P7-N1, P7-N2, P7-N3, P7-N4, P7-N5, P7-N6, P7-N7, P7-N8, P7-N9,
  P7-N11: accepted** as described in Delivered and the tests above.
- **P7-N10 (memory split): rejected.** One held-out memory chat per
  configuration cannot be compared to two tuned ones; the split stays on
  reply scores.
- **P7-N12: deferred** to Phase 8's mock rehearsal on a task stack, which
  renders a full report.

**Repair check record (2026-10-26)**, on code subtrees `scripts`
`66aa957f`, `src` `1acfeab1` (unchanged) and `tests` `d7a0b3cc`: the eight
benchmark test files, 176 passed; `ruff check`, `ruff format --check
scripts/evals tests`, `make format-check`, `make mypy` and `mypy
scripts/evals` passed; the sample report re-rendered and re-checked
identically.

The repairs went to a targeted recheck (Code Review #2).

#### Code Review #2 Findings

Analysis reviewer (`scripts` `66aa957f`, `src` `1acfeab1`, `tests`
`d7a0b3cc`): one trivial residual; everything else accepted is resolved,
with no regressions. Its probes confirmed the effort fallback, the
two-group verdict, the balanced sample and the unchanged re-render.
- **P7-F7 (residual).** The memory table's tool success was still a bare
  percentage.
- Non-blocking: an unreadable `--recommendations` file ended in a traceback;
  a calibrated run with no judge plan rendered as judged at the pinned
  effort; "Same Gesture" counts no Gesture in both replies as the same;
  Phases 8 and 9 did not say where the owner's recommendations go; the
  `bootstrap_mean` docstring still described only item groups.

#### Code Review #2 Revisions

The reviewer marked the residual a trivial standard-tier repair; the
coordinator verified these itself.
- **P7-F7 (residual): accepted.** `_tools` returns the call and success
  counts, and the cell shows them.
- **Recommendations file: accepted.** An unreadable file is an input error.
- **No judge plan: accepted.** Without `judge/plan.json` the report reads
  "not judged" whatever calibration pinned.
- **Same Gesture: kept, and stated.** No Gesture is a valid choice, so the
  report says no Gesture in both replies counts as the same.
- **Plan wording: accepted.** Phase 8's skill steps and Phase 9 keep the
  owner's recommendations in a file passed to `report` and `--rerender`.
- **Docstring: accepted.**

**Final check record (2026-10-26)**, on code subtrees `scripts` `6a52a235`,
`src` `1acfeab1` (unchanged) and `tests` `4b35bb14`: the eight benchmark
test files, 176 passed; `ruff check`, `ruff format --check scripts/evals
tests`, `make format-check`, `make mypy` and `mypy scripts/evals` passed;
the sample report re-rendered identically.

Phase 7 passed with one repair round used.

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
    8. Ask the owner to write the recommendations in a Markdown file kept with
       the run, render the report again with `--recommendations <file>`
       (and `--overwrite`), and link the report. Later `report` and
       `--rerender` runs pass the same file.
  - The skill never starts a paid run without explicit approval of that
    run's caps.
  - `agents/openai.yaml`, and `references/` for the commands, the input
    format, the memory arms, the rubrics and judge, and reading reports.
- **Documentation.**
  - A benchmark README beside the inputs (location per G1) covering:
    - the commands;
    - the prompt-set format and the held-out rule;
    - the memory arms and the benchmark database, including that
      `cleanup` runs between runs, not during one (P4-R3-C-N1, P4-R3-C-N2);
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

Starting source: `33027554` (Phase 7's commit).

**Delivered:**
- `.agents/skills/animama-model-benchmark/`: `SKILL.md` (rules, including
  no paid call without approved caps, the subscription-only judge and raw
  results in drafts; the eight-step flow above), `agents/openai.yaml`, and
  `references/` for commands (stack, plan, run, cleanup, judging, reports,
  rehearsal), inputs and memory arms, the judge (running, stops, exit codes,
  calibration) and reports (options, the safety check, reading).
  `.claude/skills` is a tracked link to `.agents/skills`, so Claude Code sees
  it too.
- `docs/benchmarks/README.md`: the commands, inputs and held-out rule, memory
  arms and the benchmark database (with `cleanup` between runs), the judge's
  sign-in, isolation and calibration, conditions and the time bound, reading
  a report, and limitations.
- `docs/backend/features/memory-manager-and-episodic-memory.md`: a "Benchmark
  memory arms" section saying the arms exist for benchmarking only;
  `docs/backend/README.md` points to the benchmark README.
- `GLOSSARY.md`: Benchmark run and Benchmark area.
- `scripts/evals/benchmark/stub_claude.py`: an executable stand-in for the
  Claude CLI (every criterion 3, every capture entry not saved) for free
  rehearsals, with a test that it judges a whole run.

**Deviations:**
- The stand-in CLI is new: the rehearsal needs a judge that costs nothing,
  and the test stub's failure modes do not belong in an owner-facing tool.

**Rehearsal (2026-10-26)**, following the skill on a mock task stack
(`ANIMAMA_LLM_SKIP=1 ./reset.sh --name bench --base-port 8900`, Compose
project `animama-bench`, `http://animama-bench.localhost:8900`):
- `models` listed the three built-in rows (Luna on Chat Completions hidden).
- `plan --tier smoke --standard`: 576 calls, about $0.62, 55 judge batches,
  0.58 h.
- `run` with `-e ANIMAMA_LLM_SKIP=1` on the smoke tier, into
  `.animama-drafts/model-benchmark/p8-rehearsal`: exit 0 in 22 s; 348 calls
  and 366 records (single 128, chat 24, memory 144, recall 48, capture 12,
  Memory Manager 6, warm-up 4) with no errors. Its database was dropped;
  application counts stayed `5|0|0|0|2|0` before and after.
- `judge --effort medium --claude scripts/evals/benchmark/stub_claude.py`:
  49 batches, none missing.
- `report`, then `report --rerender`: 223 lines, identical. The memory-only
  smoke chat and the full-tier Japanese memory chat are absent from the smoke
  tier, so their pair row is left out.
- `cleanup`: nothing to drop. The stack was taken down afterwards.

The rehearsal found three faults, fixed in this phase with tests where they
apply: a relative `--claude` path failed because calls run from an empty
directory (now resolved first); the Japanese memory-pair row appeared for a
chat the tier did not run; and a judge plan with no results gave a confusing
"no effort" message.

Check record (2026-10-26):
- The full pre-push suite (`python3 scripts/heavy-slot.py -- make
  check-test`) on code subtrees `scripts` `d8e5dec9`, `src` `1acfeab1` and
  `tests` `524ad0b0`: the typed-content audit, ruff format and check, and
  mypy passed; pytest 5021 passed, 29 skipped.
- After it, one test was added
  (`test_a_japanese_memory_pair_shows_only_when_both_chats_ran`); on `tests`
  `69d4483b` (scripts unchanged) the eight benchmark test files passed
  (178), and `ruff check`, `make format-check` and `make mypy` passed.
- Every link in the new and changed docs and skill files resolves, anchors
  included.

Commits: `feat(evals)[p8]: add the model benchmark skill and docs`.

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
4. Run `run`. Run `cleanup`, which must find no benchmark database, then take
   the stack down. Raw results stay in the drafts folder.
5. **G4 (owner), waived for this run on 2026-10-26 (D17):** `calibrate
   waive --effort medium` records it instead of the steps below.
   - `calibrate export` draws a stratified blind sample of up to 36 English
     `reply` and `expression` items, spread evenly over configurations, then
     areas (Phase 7 deviation: no score ranges before judging).
   - The owner rates it with the rubrics, and `calibrate import` records the
     ratings.
   - `calibrate pilot` judges the sample at medium and at high effort.
     Record the agreement at each effort and pin the effort (D15).
6. Run `judge` at the pinned effort (medium under D17), resuming across usage windows. Record
   the batches, missing scores and elapsed time.
7. Run `report`. Then:
   - Have the owner write the recommendations in a Markdown file kept with
     the run, and render the report with `--recommendations <file>`.
   - Track the report at the location agreed at G1.
   - Verify that `report --rerender`, with the same recommendations file,
     reproduces it byte for byte.
   - Record the run's actual wall time against the 4-hour bound, excluding
     the one-time calibration.
   - Link the report from #470.

Recovery:
- A run stopped by a cap or an interruption keeps its partial results. The
  owner decides whether to approve a continuation. No continuation tooling
  is planned: rerun with a new cap.
- Turns that failed on connection errors can run again with
  `run --retry-from` (deviation below).
- A judge stopped by a usage limit resumes later.

**Deviation: retrying connection errors (owner request, 2026-10-26).** During
the paid run, two short network drops failed turns on all four
configurations at once with `anthropic_connection_error` and
`openai_connection_error`. The owner asked for those turns to run again
rather than count as failures. `run --retry-from <run>` (`retry.py`):
- needs the earlier run's own tier, prompt set, repeats, configurations
  (their full identity), options, prices, caps and mock-model setting, and
  refuses a run still marked running, one stopped at a cap, and a retry that
  stopped early;
- selects every unit with a connection error and reruns it whole, since its
  turns depend on each other: a single-turn item for one persona and repeat,
  a whole scripted chat, a memory chat in one arm with its capture and recall
  chat, or a Memory Manager run. Warm-ups are never retried, and other errors
  stay counted;
- writes a new run directory: the earlier run's other records copied, the
  rerun records appended, and the retry's warm-ups run but not recorded. The
  earlier run is not changed;
- spends only what is left of the same caps, and its manifest keeps the
  earlier run's window and conditions, adds the calls and spend, and lists
  the retry under `retries`, which the report's Conditions show.

A Memory Manager runtime records a dropped connection as a failed run rather
than raising it, so the benchmark's call wrappers now keep the last call's
exception class, and a run that ended failed gets that as its `error` (or
`run_failed`). Such runs are counted as errors and no longer judged; before,
the judge read their failure message, which named the provider.

Tests: `test_a_retry_takes_every_unit_with_a_connection_error_whole`,
`test_a_retry_reruns_the_failed_units_into_a_new_run_under_the_same_caps`,
`test_a_retry_needs_a_matching_run_with_connection_errors_and_the_caps_left`
and `test_a_retry_selection_runs_only_the_chosen_memory_chat_arm_and_manager_run`,
plus `test_a_memory_manager_run_that_lost_its_connection_is_recorded_for_a_retry`.

##### Retry review #1 Findings

Reviewer: an independent `sdlc-reviewer` subagent at the standard tier, on
working tree `f7372ce3` against `874f760c`. It reused the check record, reran
the runner and memory tests (76 passed) and ran two scratch probes. It
confirmed the unit boundaries match how the judge items, measures and report
group records, that no record is duplicated, and that the earlier run stays
unchanged. Its result: changes required.

- **RT-F1 (required).** A Memory Manager run that loses its connection is never
  retried: the runtimes record a failed run instead of raising, so the
  record's `error` stays empty (probe: status failed, no units selected).
- **RT-F2 (required).** A retry on the mock model was accepted against a paid
  run, and configurations were compared by label only.
- **RT-F3 (low).** A retry counted `turns_recorded` over every record, while a
  run counts chat turns only (not captures or Memory Manager runs).
- **RT-F4 (low).** A run stopped at a cap was not refused, and the retry's
  fresh budget would admit one call the earlier budget had refused.
- **RT-N1.** An interrupted retry drops the units it never reached from a
  retry of it.
- **RT-N2.** The report's retry line omits the retry's machine and network.
- **RT-N3.** `_Retry` and its checks live in `cli.py`, not `retry.py`.
- **RT-N4.** A run directory without `turns.jsonl` raised a bare error.
- **RT-N5.** Retry warm-ups run for every configuration (one call each).
- **RT-N6.** A failed Memory Manager run is judged with its failure message,
  which names the provider.

##### Retry review #1 Revisions

- **RT-F1: accepted.** The call wrappers keep the last call's exception class,
  and a run that ended failed records it as `error` (else `run_failed`). New
  test `test_a_memory_manager_run_that_lost_its_connection_is_recorded_for_a_retry`
  runs the real Anthropic runtime against a client that drops the connection.
- **RT-F2: accepted.** The settings check compares each configuration's full
  identity and the mock-model setting. Tested.
- **RT-F3: accepted.** Both count the kinds in `retry.COUNTED_TURNS`.
- **RT-F4: accepted.** A run stopped at a cap is refused. Tested.
- **RT-N1: accepted.** A retry that stopped early is refused, naming the run
  to retry instead. Tested.
- **RT-N2: rejected.** The retry runs from the same stack; its own conditions
  stay in the manifest's `retries` entry.
- **RT-N3: rejected.** `retry.py` would have to import the runner, which
  imports it for the selection: a cycle for no behaviour.
- **RT-N4: accepted.** It is an input error now.
- **RT-N5: rejected.** Four calls, within the caps; every configuration keeps
  the same warm-up rule.
- **RT-N6: accepted** through RT-F1: failed runs are no longer judged.

Check record on working tree `29dc218e` (scripts `e35e400c`, tests
`4a90fe2d`): the benchmark tests as in the final integration record, 188
passed; `ruff check`, `ruff format --check`, `make mypy` (872 files) and
`mypy scripts/evals` (34 files) pass.

Retry review #2 (targeted recheck, same reviewer, on `57991500`): pass. It
reran its two probes against the repairs (the Memory Manager run is now
selected; a mock-model retry is refused) and confirmed the paid run is
retryable. Its one note, that a retry's fresh budget can pass what is left of
`--max-usd` by one call's whole cost, is now stated in the README.

Completion: G3 and the G4 waiver are recorded, the report is tracked and the re-render
is verified. Commit `docs(evals)[p9]: record the first model benchmark`.

**G3 (2026-10-26):** the owner approved the full tier with `--standard`,
`--max-calls 4600 --max-usd 6` and
`--price input=0.10,cached_input=0.01,cache_write=0.125,output=0.50`, on the
dry run of `874f760c`: 4 configurations, 2,268 estimated calls (up to 4,536
with repairs), about $2.43, 223 judge batches and 2.28 h against the 4-hour
bound.

Run record (stack `animama-bench`, `./reset.sh --name bench --base-port 9100`
with only the secrets file in `COMPOSE_ENV_FILES`; `models` listed both
visible built-in rows):

| Step | Result |
| --- | --- |
| Dry run | `plan --tier full --standard --max-calls 4600 --price …` on `874f760c`: as approved at G3 |
| Paid run | `2026-10-26-first-decision-run`, source `874f760c`: 17:19:36 to 18:29:58 UTC (70 minutes of contestant calls), exit 0, not aborted; 1,726 calls, ~0.452 USD at the approved rates; 1,668 records (1,620 turns). Two short network drops failed 20 turns on all four configurations: 9 single-turn and 11 memory turns, all `anthropic_connection_error` or `openai_connection_error` |
| Retry (owner request) | `2026-10-26-first-decision-run-retry`, source `2cd7cf7d`: 18:36:07 to 18:39:38 UTC, exit 0; 13 units (9 single-turn items, and `new-job` in arm (b) for each configuration), 77 records replaced; 88 calls, ~0.046 USD; no failed turns remain. Run totals: 1,814 calls, ~0.498 USD, within the G3 caps |
| Cleanup | "no benchmark databases to drop"; application database 0 chats, 0 messages, no `animama_benchmark_*`; stack taken down and `.animama-stack.env` removed |
| Calibration export | `calibrate export` on the retry run: 36 items. The owner then waived G4 (D17); `calibrate waive --effort medium` is recorded in the run |
| Judging | `judge --effort medium` with Claude Fable 5.1 on the host: 19:45 to 20:37 UTC (52 minutes), 204 of 205 batches; `expression-0008` came back missing one item on all three attempts, and a rerun scored it. 205 batches scored, no missing items; served model `claude-fable-5-1`, CLI `2.1.310 (Claude Code)` |
| Report | `report`, then `report --rerender`: written and byte-identical, before the owner's recommendations |
| Recommendations | On 2026-10-27 the owner asked for the agent's recommendations and adopted them as written. They are kept as `recommendations.md` in the run |
| Tracked report | `report --recommendations … --overwrite` in the run, then `--output docs/benchmarks/2026-10-26-first-decision-run.md`: written, and the safety check passed. `report --rerender` with the same file matches byte for byte, and the run's `report.md` is identical |
| Wall time | 70 minutes of contestant calls, 3.5 minutes of retry and 52 minutes of judging: about 2.1 hours against the 4-hour bound, with no calibration |

The retry run is the run of record: calibration, judging and the report use
it.

On 2026-10-27, with the owner's OK, #470's body was updated with the D17
revision, and
[a comment](https://github.com/raymond-van/animama/issues/470#issuecomment-6433628394)
links the tracked report.

Check record: the report and re-render steps above. The full pre-push suite
runs on the final candidate.

Commits: `2cd7cf7d` (`feat(evals)[p9]: retry units that failed on connection
errors`), `f09aef59` (`docs(evals)[p9]: record the paid run and its retry`),
`2436d279` (`feat(evals)[p9]: judge with Fable 5.1 and record the owner's G4
waiver`) and `docs(evals)[p9]: record the first model benchmark`.

#### Code Review #1 Findings

Light phase: covered by the final integration review unless a review is
requested. The retry tooling had its own review (above).

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

### Final Integration Review Findings

Reviewer: an independent `sdlc-reviewer` subagent, on HEAD `5f026caf`
(clean) against `a94f8369`, covering Phases 1–8 and reviewing the light
Phases 5 and 8 in full. It reused the Phase 8 full suite and the 178
benchmark tests, whose trees matched HEAD, and ran two read-only `plan`
probes. Its result: blocked, with Phase 9 still to run.

It confirmed that the Phase 3 seams stay production-safe (constructor-only,
not passed by chat's turn setup, default bytes unchanged), and that keys,
database names, the read-only catalog session, the judge's environment and
the report guard hold.

The findings:
- **FI-F1 (required).** The report leaves out R4 measures the code already
  computes: time to first token, first-speech p90 and mean, latency mean,
  cached-input, cache-write and reasoning tokens, scripted-chat latency and
  tokens, error codes, tag kinds, non-English tags, tags in `display`,
  tags-only speech, accent requests and style violations by kind.
- **FI-F2 (required).** Nothing runs a Japanese memory or recall turn: the
  rehearsal used the smoke tier, `memory_turn_options` has no test, and the
  memory fixture is English only. The paid run would be its first run.
- **FI-F3 (required).** `plan` resolves `--config` only against the built-in
  rows, so an owner-added or OpenRouter row has no dry run (R3, R14), while
  the docs say it does.
- **FI-N1.** SKILL.md and Phase 9 step 4 run `cleanup` after taking the
  stack down; it runs in the container, so the order is reversed.
- **FI-N2.** The documented `run` has no `--machine-label`, so R15's machine
  would be the container id.
- **FI-N3.** A real `judge` on a stand-in-judged directory would skip every
  batch silently.
- **FI-N4.** The `reply` and `audio_tags` scores of memory and recall turns
  are judged but never reported.
- **FI-N5.** Stale plan text: the Status line, the workspace stack record,
  and the claim that the judge and report never import `animama`.
- **FI-N6.** The smoke tier differs from D10 with no recorded deviation.
- **FI-N7.** The dry run's "up to 2N" is not a bound for memory tool rounds
  or Memory Manager runs.
- **FI-N8.** The `--max-usd` overshoot is documented only in a docstring,
  and the rehearsal note omits that `run` still needs `--price`.
- **FI-N9.** Later runs' reports say "Not calibrated in this run" with no
  pointer, and the family caveat names Haiku even when no run includes it.
- **FI-N10.** Phase 8 recorded no `mypy scripts/evals`, which is the only
  check that reaches `stub_claude.py`.
- **FI-N11.** R19's dry-run parity was last recorded in Phase 2.
- **FI-N12.** "Four benchmark areas" in the README and glossary differ in
  wording from the spec's areas.
- **FI-N13.** The judge does not detect a user `~/.claude/CLAUDE.md`.

### Final Integration Review Revisions

- **FI-F1: accepted.** The report gains a Structured output table (errors by
  code), an Audio tags and spoken style table (every tag measure and each
  style violation by kind, plus the tag kinds), and an Operations table per
  configuration and part (single, chat) with median, p90 and mean latency,
  first token and first speech, and the token means. Rendering only.
- **FI-F2: accepted.** The new test
  `test_a_japanese_memory_chat_runs_in_japanese_and_pairs_with_its_original`
  runs a Japanese memory chat and asserts its turns' system prompt carries
  the Japanese reply instruction (and English turns' does not); the runner
  tests assert `memory_turn_options` sets `conversation_language` and
  `tts.language_code` to `ja`. A free full-tier mock run (below) covers
  the Japanese memory chat, its pair row, the held-out memory chat and the
  30-turn chats end to end.
- **FI-F3: accepted.** `plan` reads the catalog read-only when a `--config`
  is not a built-in row; the new test
  `test_plan_reads_the_catalog_for_a_row_that_is_not_built_in` covers it,
  and the README says it then needs the stack.
- **FI-N1: accepted.** SKILL.md and Phase 9 step 4 run `cleanup` first.
- **FI-N2: accepted.** commands.md passes `--machine-label "$(hostname)"`.
- **FI-N3: accepted.** `judge` refuses results made by the other kind of CLI
  (stand-in or real) and says to judge a copy; the docs say never to
  stand-in-judge a paid run's directory. Tested.
- **FI-N4: accepted.** The memory table shows each arm's judged `reply` and
  `audio_tags` scores.
- **FI-N5: accepted.** The three passages are corrected.
- **FI-N6: accepted.** Recorded as "Smoke tier against D10" under Phase 5.
- **FI-N7: accepted.** The dry run says memory tool rounds can add more and
  that `--max-calls` bounds them all.
- **FI-N8: accepted.** The README and commands.md state the overshoot, and
  the rehearsal note says `run` still needs `--price`.
- **FI-N9: accepted.** The uncalibrated note says where the pinned effort is
  recorded, and the family caveat shows only when a configuration's model is
  a Claude model.
- **FI-N10: accepted.** `mypy scripts/evals` is in the check record below.
- **FI-N11: accepted.** The Phase 1 dry-run diff against `23cf9faf` was
  rerun; see the check record.
- **FI-N12: rejected.** The README and glossary name the prompt set's four
  areas (`prompt_set.AREAS`); the spec's areas map onto them (core turns,
  long chats, memory with its arms, and the Memory Manager), and the
  Japanese subset spans them. No reader acts differently on the wording.
- **FI-N13: accepted.** `judge` stops, not resumable, when a user
  `CLAUDE.md` exists, and the skill and README say to move it aside. Tested.

Check record for repair round 1, on working tree `d1fc13c4` (scripts
`7ae0eacb`, src `1acfeab1`, tests `679e5145`), from the worktree root:

| Check | Command | Result |
| --- | --- | --- |
| Benchmark tests | `uv run --no-sync pytest -q tests/test_model_benchmark_*.py tests/test_gesture_selection_eval.py tests/test_episodic_memory_arm.py` | 181 passed |
| Lint and format | `uv run --no-sync ruff check`; `ruff format --check scripts/evals tests`; `make format-check` | pass |
| Types | `make mypy` (872 files); `uv run --no-sync mypy scripts/evals` (33 files) | pass |
| R19 parity | Phase 1's Gesture harness `--dry-run` from `git archive 23cf9faf scripts/evals` against the working tree | identical, both exit 0 |
| Full-tier mock run | `ANIMAMA_LLM_SKIP=1 ./reset.sh --name bench --base-port 9100`, then `run --tier full --standard` with `-e ANIMAMA_LLM_SKIP=1`, `--max-calls 5000 --max-usd 20` and `--price` | exit 0 in 75 s; 1,620 turns, not aborted: 776 single (192 Japanese), 264 chat, 432 memory (144 Japanese), 144 recall (48 Japanese), 36 capture (12 Japanese), 12 Memory Manager |
| Stand-in judge | `judge --effort medium --claude scripts/evals/benchmark/stub_claude.py --concurrency 4` on the host | 198 batches judged, 0 missing |
| Report | `report`, then `report --rerender` | written; re-render byte-identical. It shows the new Structured output, Audio tags and Operations tables, each arm's `reply` scores, the `new-job-ja` pair rows in all three arms, the held-out slice and the 30-turn chats' scores |
| Cleanup and database | `cleanup` before `down`; application database counts | "no benchmark databases to drop"; 0 chats, 0 chat messages, no `animama_benchmark_*` database. Stack taken down and `.animama-stack.env` removed |

### Final Integration Review #2 Findings

The same reviewer's targeted recheck, on tree `e144d0ae` (equal to
`d1fc13c4` apart from this record), reusing repair round 1's checks. It
verified FI-F1–FI-F3, FI-N1, FI-N3–FI-N11 and FI-N13, accepted the FI-N12
rejection, and found no regression in the Phase 3 seams or re-render
determinism. Its result: blocked on one new finding.

- **FI-R1 (required).** The FI-N2 repair documents
  `--machine-label "$(hostname)"`. On the owner's host that is a
  hardware-style network id, which the mock report already showed in its
  Conditions; Phase 9 would publish it, and the safety check cannot catch
  it.
- **FI-R2.** The README's command table still says `plan` needs no
  database.
- **FI-R3.** A mistyped built-in id makes `plan` on the host fail with a
  database connection traceback.
- **FI-R4.** The Tag kinds line prints raw tag labels: a reply that is one
  long lowercase tag would make the safety check refuse the report, and
  angle-bracket tags vanish in rendered Markdown.
- **FI-R5.** The Operations table's "Turns" column holds the part and "n"
  the count.
- **FI-R6.** `judge` now needs the CLI and the `CLAUDE.md` check even when
  every batch is done.
- **FI-R7.** The plan test's owner row copies a built-in row, so it keeps
  `source=builtin`.
- **FI-R8.** The FI-F2 revision overstated what the new memory test asserts.

### Final Integration Review #2 Revisions

- **FI-R1: accepted.** commands.md asks the owner for a model and memory
  description and says never to use a host name or hardware id. Verified by
  the coordinator (documentation only).
- **FI-R2: accepted.** The table says `plan` runs anywhere, or in the
  backend container for rows that are not built in.
- **FI-R3: accepted.** `plan` turns a failed catalog read into an input
  error naming the unknown ids (exit 2). New test
  `test_plan_for_an_unknown_row_without_a_database_names_the_row`.
- **FI-R4: accepted.** Tag labels render as code, and a label of 20
  characters or more (or with a backtick) is counted as "longer, not shown".
  New test `test_tag_kinds_show_short_labels_as_code_and_only_count_long_ones`.
- **FI-R5: accepted.** The columns are "Part" and "Turns".
- **FI-R6: rejected.** A complete rerun is rare, and failing on a missing
  CLI or a `CLAUDE.md` before anything is sent is harmless.
- **FI-R7: rejected.** Cosmetic: the test needs only an id that is not
  built in.
- **FI-R8: accepted.** The FI-F2 revision now says what each test asserts.

Check record for repair round 2, on working tree `243fe515` (scripts
`d17f553a`, tests `fac6738e`; src unchanged):

| Check | Command | Result |
| --- | --- | --- |
| Benchmark tests | as in round 1 | 183 passed |
| Lint, format and types | `ruff check scripts/evals tests`; `ruff format --check scripts/evals tests`; `make mypy`; `mypy scripts/evals` | pass |
| Mock report | `report --overwrite`, then `--rerender`, on the full-tier mock run | written; byte-identical; "Part" column and code-formatted tag kinds |

The repairs are small and each has its test or is documentation, so the
coordinator verified them without a third reviewer round (bounded-review
policy, final targeted review). Result: pass, with Phase 9 (G3, G4) still to
run.

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

Delivered: the benchmark tooling, skill and documentation (Phases 1–8), and
the first decision run (Phase 9) with its
[tracked report](../../benchmarks/2026-10-26-first-decision-run.md).

- **Default model.** The recommendations choose GPT-6 Luna at effort low.
  - Its reply quality is not distinguishable from Claude Haiku 5.5's.
  - Its expression ranks above Haiku's.
  - It uses about 40% fewer input tokens per turn.
- **Episodic memory.** Capture through the remember tool kept every
  must-keep entry, while MEMORIES.md alone kept almost none. Recall is not
  yet a design signal; see the 2026-10-27 discovery.
- **Budget and time.** The run used 1,814 calls and about $0.50 of the
  approved 4,600 calls and $6. It took about 2.1 hours against the 4-hour
  bound.
- **Deviations.**
  - Units that failed on connection errors ran again with `run --retry-from`,
    at the owner's request.
  - The owner waived G4 and moved the judge to Claude Fable 5.1 at medium
    (D17). As a result, the judge's agreement with the owner is unmeasured,
    and the judge shares a model family with a contestant.
- **Lessons.**
  - Short network drops hit every configuration at once, so retry tooling
    belongs in the first version of a paid harness.
  - A recall result near zero across every model points at the app's
    retrieval path before the models.
