# Standardized model benchmark for Animama

Status: Agreed
Owner decision: Agreed on 2026-10-25. The owner asked to implement it after
reviewing this spec and its ExecPlan (G1). The decisions come from the
owner's intent-discovery answers on 2026-10-12 and 2026-10-25 and the
owner's spec answers on 2026-10-25. They are recorded in the discovery
briefs on the issue.
Authoritative source: https://github.com/raymond-van/animama/issues/470.
This file is a snapshot of it (see Spec below). Discovery briefs:
https://github.com/raymond-van/animama/issues/470#issuecomment-6134798047
(2026-10-12) and
https://github.com/raymond-van/animama/issues/470#issuecomment-6406329265
(2026-10-25, which extends the first).

## Problem and intended users

Animama lets the installation owner choose the model that drives each Anima,
and a default chat model for new Animas. There is no standard, repeatable way
to tell which model and settings give the best experience in the app.

The immediate decision is which built-in chat model performs better in
Animama: `gpt-6-luna` on OpenAI Responses or `claude-haiku-5-5` on native
Anthropic. A second decision depends on the same evidence. Episodic memory can
be saved through the structured reply's `remember` field, through the Anima's
own `MEMORIES.md` with its write tools, or both. The owner may keep either
mechanism or both.

#409 (PR #462) ran a one-off comparison of these two models through chat's
real turn executor, at reasoning effort none, low and medium, over 60
single-turn items and two 30-turn scripted chats. The owner then kept Luna at
effort none as the default. The comparison and its harness are recorded in
[the gesture catalog ExecPlan](../gesture-catalog-expansion/gesture-catalog-expansion-execplan.md)
and [its inputs](../gesture-catalog-expansion/gesture-selection-eval.md). That
comparison has these limits:

- It was assembled by hand, and its judging and report were done outside the
  harness.
- It measured avatar expression only. Reply quality beyond a single "speech"
  score and long-chat behavior were not measured.
- Memory was off, no voice was selected (so the prompt forbade Audio tags) and
  every prompt was in English.
- It used one neutral persona, so character consistency could not be judged.
- Its judges were Claude sub-agents, and their model and prompt were not
  pinned in a reproducible way.

Since then the chat instructions have changed (#704, PR #710): one shared
response guidance for every provider, a voice-aware Speech section, a memory
section that defines the three memory stores, and the Companion Guardrails
once per turn. Earlier results do not describe the current prompts.

Intended users:

- **The owner**, first. They choose the default and recommended chat models,
  decide the episodic-memory design, and check new model releases and
  provider changes.
- **Contributors**, later. They reuse the same suite to catch quality, latency
  or cost regressions when prompts, content or providers change.
- **Users**, eventually. They would read owner-reviewed guidance derived from
  reports. They would not use the tool itself.

## Goals, scope and non-goals

Goal: an on-demand benchmark, packaged as one agent skill with checked-in
tooling. It scores built-in catalog chat models in the agreed benchmark areas
through the app's real code paths. Its output is a blind-judged scorecard per
area, shown beside latency, tokens and cost, which the owner uses to choose
models and the episodic-memory design. v1 includes the first decision run.

In scope:

- **Core turn.** Every turn exercises all of these:
  - chat replies;
  - avatar expression, including Gesture, tone and intensity distributions;
  - Audio tags and spoken style in `speech` for the ElevenLabs voice;
  - structured-output reliability;
  - operations (latency, tokens, cost, errors).
- **Multi-turn and memory:**
  - long scripted chats;
  - in-chat memory, including memory tool use;
  - the episodic-memory comparison across three memory arms;
  - Memory Manager runs.
- **Japanese.** A paired Japanese subset that shows whether Japanese input
  changes the rest of the structured reply.
- **Content:** a tracked, versioned, public-safe prompt set and rubrics, with a
  held-out slice.
- **Judging:** one judge run on the owner's Claude subscription, and a
  one-time calibration against the owner.
- **Reports:** a tracked, public-safe report per run.
- **Tooling:** a shared evaluation core in `scripts/evals/`, reused by the
  existing Gesture selection harness.

Non-goals:

- New runtime features, automatic model selection at runtime, and production
  metrics or telemetry.
  - Small refactors are allowed when the harness needs them to call real code
    paths, as the Gesture harness's refactor of `response_format.py` and
    `direct_executor.py` did.
  - The benchmark-only memory arms (R6) are also allowed. They leave
    production behavior unchanged.
- Adopting an episodic-memory design. The benchmark informs that decision, and
  any change is separate work. Moving episodic memory into the per-Anima
  `MEMORIES.md` would amend
  [ADR 0009](../../adr/0009-shared-user-memory-and-per-anima-relationship-memory.md).
- These areas are deferred, as later additions to the same skill:
  - safety and Companion Guardrails, including crisis handling;
  - tools: web search, attachments and image understanding. Benchmark turns
    offer no web search;
  - utility jobs (chat titles, and compaction as a Utility-role job);
  - Korean and Chinese conversations.
- Text-to-speech audio. No speech is synthesized; only the `speech` text is
  measured.
- In-app guidance (Library or model picker). Publishing results to users is a
  later owner decision.
- Training or fine-tuning.
- CI integration. Runs stay manual, and paid runs need approval.
- A composite score or disqualifying gates. The output is a scorecard only.
- Gemini contestants. They wait until a Gemini chat provider exists; Gemini is
  text-to-speech only today.

### Terminology

This spec uses these terms. R20 adds Benchmark area and Benchmark run to the glossary.

- **Benchmark area.** A group of related measures, such as core turn, or
  multi-turn and memory. The spec avoids "domain" because the repository
  already uses that word for domain documentation and the backend `domain`
  layer.
- **Configuration.** One model catalog row plus its settings, such as
  reasoning effort, being benchmarked. The issue calls this a "contestant".
- **Judge.** A model that scores replies against a rubric. A judge is never a
  configuration in the same benchmark run.
- **Benchmark run.** One approved execution over a fixed set of configurations
  and a fixed prompt-set version. It produces raw results, judge scores and
  one report.
- **Memory arm.** One way of saving episodic memory, used in the
  episodic-memory comparison (R6).

Existing glossary terms keep their meaning: Gesture, Audio tag, Locale (UI
Locale), Conversation language, Anima memories and Reflection.

## Required behavior

### Skill and flow

- **R1 — One skill.** One agent skill, working name `animama-model-benchmark`,
  runs the whole flow in these steps:
  1. A dry run shows the plan and estimate.
  2. The owner approves the run with a cap.
  3. The run executes the configurations.
  4. The judge scores the replies.
  5. The report is written.
  Each step is also a documented command, so the benchmark can be run and
  audited without the skill. The skill is an optional local tool, and nothing
  in the build, tests or app depends on it.
- **R2 — Real code paths, no user data.** Every configuration runs through the
  app's own code paths, not a reimplementation:
  - chat's turn executor, prompt assembly, structured reply schema, repair and
    salvage, and Gesture validation;
  - the chat model's memory tools and `remember` handling;
  - the Memory Manager runtimes.
  In-memory or disposable stand-ins replace persistence, so no Anima, chat,
  memory or user data of the installation is read or written. Credentials come
  only from the app's configured credential mechanism and are never printed or
  logged.
  - **Voice.** Every turn carries the chat options of an enabled ElevenLabs
    voice, so the prompt has the ElevenLabs Audio-tag rules. No text-to-speech
    request is sent.
  - **Language.** English turns send UI Locale `en`, which adds nothing to
    the prompt. Japanese turns send UI Locale `ja`, so they get the
    reply-language instruction and the Japanese speech language code, as
    [ADR 0024](../../adr/0024-ui-locale-is-the-conversation-language.md)
    defines.
  - **Tools.** Turns request no native tools, so web search is never offered.
    Memory tools follow the area and memory arm.
  - **Provider storage** (accepted at G1):
    - Core-turn and long-chat turns run incognito, with provider storage off
      where the provider supports it.
    - Memory turns can write memory only with incognito off. On OpenAI
      Responses, incognito off means `store=true`.
    - The OpenAI Memory Manager runtime always stores its calls. It also
      traces them on the built-in OpenAI connection.
    - Those turns keep the app's real provider settings, because every prompt
      and fixture is synthetic and public-safe. Only the Memory Manager's
      tracing may be turned off by the harness, since tracing does not change
      model output.

### Configurations

- **R3 — Standard set.** By default, a benchmark run covers every built-in
  catalog chat row at reasoning effort **none and low**. Today that is four
  configurations: `gpt-6-luna` on OpenAI Responses and `claude-haiku-5-5` on
  native Anthropic, each at both efforts.
  - **Other rows.** The owner can name other catalog rows by id (owner-added,
    local or OpenRouter) and choose other efforts. A configuration that fails
    a capability check, such as structured output or the requested effort, is
    reported as not run, with the reason.
  - **Records.** Each configuration records its catalog row id, connection
    protocol, effort and the relevant client settings, such as native context
    compaction. It also records the model the provider reports serving. OpenAI
    reports this; Anthropic echoes the requested id.

### Benchmark areas and measures

- **R4 — Core turn.** For every single-turn item and scripted-chat turn:
  - **Chat replies (judged).** Relevance, warmth, persona and character
    consistency, spoken style and length.
  - **Avatar expression.**
    - Judged: Gesture fit, emotional tone, intensity, and coherence with the
      words.
    - Measured: deterministic Gesture fit against each item's acceptable list,
      as #409 measured it.
    - **Distributions (measured).** For each configuration, the Gesture
      distribution and the tone and intensity distributions, shown side by
      side:
      - the null rate;
      - the top-N share;
      - variety (distinct values);
      - repeats in a row within scripted chats.
      There is no target distribution.
  - **Audio tags and spoken style.**
    - Measured against the current ElevenLabs and Speech rules in
      `app/chat/speech_tags.py`:
      - tag count and tag kinds per reply;
      - replies over the two-sound limit;
      - tags not in English square brackets;
      - tags in `display`;
      - `speech` that is empty apart from tags;
      - accent requests;
      - links, URLs, paths, code, markdown, lists, tables or emoji in
        `speech`.
    - Judged: whether each tag fits the moment and the reply's tone.
  - **Structured-output reliability (measured).** For each turn, which
    recovery path produced the reply: strict parse, lenient recovery, repair
    request, salvage or plain-text fallback. Also dropped invalid or unknown
    Gestures and failed turns.
  - **Operations (measured).** These carry over from the Gesture harness:
    - turn latency, time to first token and time to first speech, each as
      median, p90 and mean;
    - input, cached-input, cache-write, output and reasoning tokens;
    - estimated cost from catalog or supplied prices;
    - error and retry counts.
- **R5 — Multi-turn and in-chat memory.**
  - **Long chats.** Scripted chats of 30 or more turns, judged on context
    retention, repetition and character consistency across the chat. They use
    the app's own history handling and pre-send compaction behavior.
  - **In-chat memory.** Chats with memory on, against a memory store seeded
    from tracked fixtures:
    - judged: whether the model saves what a reasonable companion would, and
      whether its memory tool use is appropriate (it reads when the turn needs
      memory and writes only what is notable);
    - measured: memory tool calls per turn, their success rate (calls that
      complete without a tool error or version conflict), and recall of facts
      planted earlier or in the seeded memories, checked deterministically
      where an item defines the expected answer.
  - **User turns.** Every multi-turn chat is scripted. Its user messages are
    tracked and identical for every configuration. No AI-simulated user is
    used.
- **R6 — Episodic-memory comparison.** Each configuration runs the tracked
  memory chats in three memory arms:

  | Arm | Episodic channel | `remember` | `MEMORIES.md` writes | Shared-file writes |
  | --- | --- | --- | --- | --- |
  | (a) `remember` only | Episode log | Yes | No | Yes |
  | (b) `MEMORIES.md` only | `MEMORIES.md` | No (removed from schema and guidance) | Yes, with candidate episodic guidance | Yes |
  | (c) Both | Both | Yes | Yes, current guidance | Yes |

  - **Real app.** Arm (c) is the current app behavior. Arms (a) and (b) are
    benchmark-only variants reached through narrow seams in the real code;
    they leave the production defaults unchanged.
  - **Candidate guidance.** The candidate episodic guidance is a tracked part
    of the prompt set (R8). It lets `MEMORIES.md` hold the notable facts,
    events, decisions and plans that `remember` holds today.
  - **Shared files and reads.** Shared memory files such as `PROFILE.md`, and
    the tools that write them, are present in every arm. Memory reads are the
    same in every arm: the memory map, `MEMORIES.md` in the prompt, and the
    read and search tools.
  - **Capture.** The memory chats plant must-keep facts, events and plans,
    with noise that should not be kept and probes of the sensitive-memory
    rule. Each arm's saved memory (episode items, `MEMORIES.md` and shared
    files) is scored against the chat's tracked checklist: items kept, items
    missed, noise kept, and sensitive-rule breaks.
  - **Recall.** A later fresh chat, starting from the memory that arm saved,
    probes the planted items through the arm's real read path:
    - episode content is found through `search_memory_files`, including its
      full-text search behavior;
    - `MEMORIES.md` is included in the prompt.
    Recall is checked deterministically where a probe defines the expected
    answer, and judged otherwise. Memory Manager episode processing is not
    part of the comparison; in the app it is owner-started.
  - **Report.** The report compares the arms per configuration on capture,
    recall, memory tool use, latency and tokens.
- **R7 — Memory Manager.** General, episode-processing and Reflection runs on
  tracked fixture turns and memories. They are judged on the quality, accuracy
  and restraint of the edits they propose.
  - The runtime pauses at each proposal. The harness records it, then
    approves it, applying the edit only to the fixture store so the run can
    continue.
  - No edit reaches app data.
  - Approving every proposal is the documented, fixed policy for every
    configuration.

### Prompt set, languages and personas

- **R8 — Prompt set.** A tracked, public-safe, versioned prompt set per
  benchmark area. It contains:
  - single-turn items;
  - scripted chats;
  - memory fixtures and memory checklists;
  - the candidate episodic guidance for arm (b);
  - expected outcomes or acceptable lists where a measure is deterministic;
  - a rubric per judged measure.
  Further rules:
  - **Authoring.** The set starts from #409's 60 items and two scripted chats.
    Agents draft additions, and the owner approves the set before its first
    paid use.
  - **Size.** The set is sized so that one full benchmark run of the standard
    set fits R14's time bound. Single-turn items repeat 1–2 times.
  - **Content.** No licensed or private content: no sound-pack material, no
    personal data, no real chats. Items do not depend on current events or
    other information that would need web search.
  - **Versions.** Any change to items, fixtures, checklists, guidance,
    acceptable lists or rubrics makes a new version. Reports name the version
    and the input hashes.
- **R9 — Japanese subset.** Agents translate a subset of the English
  single-turn items and scripted chats into Japanese, with no further
  translation check. The subset includes at least one memory chat, so memory
  behavior is covered too.
  - Each Japanese item runs with UI Locale `ja` (R2).
  - Each Japanese result is paired with its English original. The report shows
    the paired differences in Gesture, tone, intensity, Audio tags, memory
    behavior and the judged scores.
  - Korean and Chinese are later additions.
- **R10 — Held-out slice.** About 20% of each benchmark area's items are
  tracked but marked held-out.
  - Tuning work (chat prompts, AI descriptions, rubrics, the candidate
    episodic guidance) must not use held-out items. The skill and the
    prompt-set documentation state this.
  - Reports show tuned and held-out scores side by side.
- **R11 — Personas.** Items run as two personas:
  - the harness's neutral identity;
  - the starter Anima Annie (`starter:annie`), with the identity text the app
    ships.
  Character consistency is judged against the persona's identity text.

### Judging

- **R12 — Judge.** One judge, Claude Opus 5.5 (`claude-opus-5-5`), at one
  pinned reasoning effort, medium or high.
  - **Blind.** The judge scores every judged reply. Replies are shuffled
    across configurations and memory arms, and the model identity,
    configuration and arm are hidden.
  - **Family caveat.** The judge shares a model family with Haiku, a
    contestant. The owner accepted this on 2026-10-25 instead of a
    cross-family panel. Every report states the caveat. Calibration (R13) is
    the check on it.
  - **Bias controls.** Rubrics are anchored, and each reply's length is
    reported beside its scores, so verbosity effects are visible.
  - **Scope.** Deterministic measures are never judged.
  - **Changes.** Changing the judge model, its effort or a rubric starts a new
    results series. Reports from different series are not compared as like
    for like.
  - **Runtime.** The judge runs on the owner's Claude subscription through the
    headless CLI (`claude -p`), not through a paid API key.
    - **Calls.** Each judge call uses the pinned model and effort, a versioned
      rubric prompt, a JSON output schema and a fixed-size blind batch.
      Malformed judge output is retried a bounded number of times, then
      recorded as missing. It is never guessed.
    - **Records.** Each score records the judge model, effort, CLI version,
      rubric version and batch.
    - **Resume.** Judging that stops on a subscription usage limit or an
      interruption resumes later without rescoring completed batches. A
      report states any missing scores.
    - **Data.** The judge receives only benchmark prompts, persona text,
      memory fixtures and configuration replies or saved memory, never
      credentials or user data.
- **R13 — Calibration.** When the suite is first built, the owner blind-rates
  a stratified sample of English replies with the same rubrics. The
  judge-to-owner agreement for each measure is recorded with the prompt-set
  version.
  - Later runs do not need owner rating.
  - Japanese replies are judged by Opus alone.
  - The sample also settles the judge effort. Both medium and high score it;
    the one that agrees better with the owner is pinned, and medium is chosen
    on a tie.
  - Calibration is repeated when a rubric or the judge changes.

### Cost, conditions and statistics

- **R14 — Budget and duration.** Every paid run follows these rules:
  - It starts with a dry run, which needs no database or model. The dry run
    shows:
    - the configurations, memory arms, items and repeats;
    - the planned contestant calls, and an upper bound including repairs;
    - approximate input tokens and estimated USD cost;
    - the judge batches;
    - an estimated wall time for the whole run, including judging.
  - **Time bound.** One full benchmark run of the standard set fits in
    **4 hours** of wall time, including judging. A plan whose estimate exceeds
    4 hours must be trimmed, or the owner must grant an explicit exception for
    that run.
  - **Approval.** The run starts only after the owner approves it, with a hard
    cap on contestant calls and USD. The tooling enforces the cap: a plan over
    the cap does not start, and no call beyond the cap is sent.
  - **Free runs.** A run against the mock model (`ANIMAMA_LLM_SKIP=1`) needs
    no approval.
  - **Judge cost.** Judge calls cost no API money. The dry run still shows
    their count and batches, so subscription usage is visible.
  - **Cost authority.** Billing remains the authority for cost. The report
    states its price source.
- **R15 — Run conditions.** Benchmark runs use a development task stack from
  the checkout, as #409 did.
  - **Order.** Contestant calls run one at a time. Configurations are
    interleaved item by item, and each configuration has one discarded warm-up
    call.
  - **Records.** The report records the date and time window, machine, network
    and stack revision.
  - **Comparisons.** Latency is compared only within one run. Quality can be
    compared across runs that use the same prompt-set version and results
    series.
- **R16 — Statistical honesty** (from the issue's proposal; accepted at G1).
  - Single-turn items repeat a configurable number of times.
  - Reports give sample sizes and the spread or confidence interval for each
    score.
  - Reports do not claim a ranking between configurations, memory arms or
    languages whose difference is within that spread.

### Outputs

- **R17 — Report.** Each benchmark run writes a scorecard: configurations
  against benchmark areas and measures, with quality, latency, tokens and
  cost side by side. The report contains:
  - the conditions (R15) and judge records (R12);
  - the judge's family caveat (R12);
  - the prompt-set version and input hashes;
  - the distributions (R4);
  - the memory-arm comparison (R6);
  - the English–Japanese pairs (R9);
  - tuned and held-out splits (R10);
  - calibration agreement (R13).
  The owner writes the recommendation and its reasoning, for the default
  model and the episodic-memory design; the tooling does not produce one.
  - **Where it goes.** The public-safe report, without raw replies, is
    tracked in a dated benchmark report under `docs/` (location proposed
    below) and linked from the issue or plan it informed.
  - **Raw data.** Raw replies, saved memory, judge batches and per-item scores
    stay in the git-ignored drafts folder.
  - **Optional page.** A private artifact page may provide drill-down.
- **R18 — Failure and recovery.**
  - **Partial results.** A run that stops at its cap, fails or is interrupted
    still writes partial raw results and a summary that marks it partial.
  - **Failures.** Failed contestant calls are recorded with their error class
    and counted in reliability. They are not silently retried beyond the
    app's own repair and retry behavior.
  - **Re-rendering.** A report can be regenerated from recorded raw results
    and scores without new model calls.
- **R19 — Compatibility.** `scripts/evals/gesture_selection.py` keeps its
  command line, inputs and outputs for loadout comparisons. Its tests keep
  passing after the shared core is extracted. The tracked #409 inputs remain
  usable.
- **R20 — Documentation.** These are documented together:
  - the tooling and its commands;
  - the prompt-set format and held-out rule;
  - the memory arms and their seams;
  - rubrics and judge setup, including the CLI sign-in prerequisite;
  - how to read a report.
  Glossary entries: Benchmark area and Benchmark run.

## Constraints

- **Credentials.** Contestants use the app's configured connections and key
  storage. The judge uses the owner's signed-in Claude CLI. Keys and tokens
  are never printed, logged, written to results or sent to the judge.
- **Spend and time.** Paid contestant calls need the owner's approval for each
  run and an enforced cap (R14). A full run fits 4 hours unless the owner
  grants an exception.
- **Privacy and licensing.** Prompts, fixtures, results and reports contain no
  licensed sound-pack content, personal data or real chats. Tracked files are
  public-safe.
- **Repository boundaries.** No Cloud imports or private dependencies. The
  tooling runs from a public checkout.
- **Subscription.** Judging depends on the owner's Claude subscription limits,
  which may stretch a run beyond its estimate (R12 resume).
- **Runtime.** Production chat behavior is unchanged. Refactors and
  memory-arm seams preserve the current defaults and are covered by tests.
- **Prompt text.** Prompt-dependent fixtures, the candidate guidance and every
  run use a `main` that includes #704 (`18d2bebd` or later).

## Acceptance criteria

- [ ] **Dry run.** A documented command prints, for the standard set across
      all agreed areas, memory arms and the Japanese subset:
      - the plan;
      - call counts, with the repair upper bound;
      - approximate tokens and estimated cost;
      - the judge batches;
      - the estimated wall time.
      It needs no database or model, and a full plan estimates no more than
      4 hours. Evidence: command output recorded in the plan.
- [ ] **Free end-to-end run.** A mock-model run (`ANIMAMA_LLM_SKIP=1`) and a
      stub judge produce raw results, judge records and a rendered report for
      every area, memory arm and the Japanese subset, with no writes to app
      data. Evidence: tests, and the run recorded in the plan.
- [ ] **Turn options.** Recorded requests show four things:
      - the ElevenLabs voice options on every turn;
      - UI Locale `ja` on exactly the Japanese turns, and `en` on the rest;
      - no native tools;
      - no text-to-speech request.
      Evidence: automated tests.
- [ ] **Memory arms.** Each arm's turns offer exactly the channels the R6 table
      lists. With no seam selected, prompts, schema and tools match the
      current app. Evidence: automated tests over the assembled requests.
- [ ] **Budget enforcement.** A plan over its cap does not start. A run never
      sends a contestant call beyond the cap. An interrupted run writes
      partial results marked partial. Evidence: automated tests.
- [ ] **Blind judging.** Judge batches contain no model, configuration or arm
      identity, and replies are shuffled across configurations and arms.
      Malformed judge output is retried, then recorded as missing. Judging
      resumes without rescoring completed batches. Evidence: automated tests
      over recorded batches.
- [ ] **Measures.** Deterministic measures match hand-computed values on
      fixtures. These are:
      - Gesture fit and distributions;
      - the Audio-tag and spoken-style checks;
      - the recovery path;
      - memory tool success;
      - capture against the checklist, and recall checks;
      - latency, tokens and cost.
      Evidence: automated tests.
- [ ] **Compatibility (R19).** Existing Gesture-harness tests pass, and its
      documented dry run on the tracked #409 inputs prints the same plan.
- [ ] **Prompt set.** A versioned prompt set for every area, including the
      Japanese subset, memory checklists, candidate episodic guidance,
      rubrics and a marked held-out slice, is tracked and owner-approved.
      Evidence: the owner's approval recorded in the plan.
- [ ] **Calibration (R13).** The owner's blind ratings of the calibration
      sample, judge-to-owner agreement per measure and the pinned judge effort
      are recorded. Evidence: the summary recorded in the plan; raw ratings in
      drafts.
- [ ] **First decision run.** After a dry run and the owner's approval with a
      cap, one benchmark run of the standard set completes. It produces a
      tracked report under `docs/` with everything R17 lists, linked from
      #470. The same report re-renders from recorded results without new
      calls. Evidence: the report, the run's actual wall time, and a
      re-render diff recorded in the plan.
- [ ] **Skill.** The skill runs the whole flow (R1), stops for approval before
      any paid call, and its documented commands work without the skill.
      Evidence: a mock-model rehearsal recorded in the plan.
- [ ] **Local checks.** `uv run pytest -q`, `uv run ruff check`,
      `make format-check` and `make check-test` pass.

## Open questions and decisions

Agreed by the owner on 2026-10-12 (first discovery). These still stand except
where 2026-10-25 replaced them:

- **Decision served.** The owner's default and recommended model comes first.
  Regression checks and user guidance come later. Runs are on demand.
- **Benchmark areas.** v1 covers the core turn, and multi-turn and memory,
  including Memory Manager runs. Compaction at its trigger threshold (about
  90k tokens) is not a v1 measure.
- **Roll-up.** A scorecard only.
- **Prompt set.** Agents draft it and the owner approves it. It is public-safe
  and tracked, with a tracked held-out slice of about 20%.
- **Personas.** The neutral identity and Annie.
- **Other rows.** Other catalog rows can be run on request.
- **Budget.** Approval for each run, with an enforced cap.
- **Conditions.** Serial, interleaved runs with recorded conditions on a
  development task stack.
- **Outputs.** A tracked, public-safe report, with raw data in drafts.
- **Skill shape.** One skill with a shared core in `scripts/evals/` and a
  module per area.

Agreed by the owner on 2026-10-25 (second discovery and spec questions):

- **Decision.** The first decision is Luna against Haiku in the app. v1
  includes the first decision run and its report.
- **Efforts.** None and low, replacing none, low and medium.
- **Judge.** Claude Opus 5.5 alone, at medium or high effort, on the owner's
  subscription through `claude -p`. This replaces the Claude and GPT panel,
  and the owner accepted the shared family with Haiku.
- **User turns.** Scripted, not simulated.
- **Voice.** ElevenLabs on every turn. No speech is synthesized.
- **Japanese.** Japanese is in v1, replacing "English only". It is a paired,
  agent-translated subset run under UI Locale `ja`, with no translation
  check.
- **Distributions.** Shown side by side, with no target.
- **Episodic memory.** The comparison is `remember` against `MEMORIES.md`,
  measured by capture and later recall, in three arms. Arm (b) uses candidate
  episodic guidance, and shared-file writes stay in every arm.
- **Web search.** Off, as in #409.
- **Run size.** One full run of 4 hours at most, including judging, with a
  trimmed set and 1–2 repeats.

Accepted at G1 on 2026-10-25, when the owner asked to implement after
reviewing this spec and the ExecPlan:

- **R2 provider storage.** Memory turns and OpenAI Memory Manager runs keep
  the app's real provider storage. This is because:
  - memory writes require incognito off;
  - Responses tool rounds continue from stored responses;
  - the Agents SDK runtime sends `store=true`.
  Content is synthetic. Only tracing may be turned off.
- **R7 approval policy.** The harness approves every Memory Manager proposal
  against the fixture store.
- **R13 judge effort.** Choose medium or high on the calibration sample; on a
  tie, choose medium.
- **R13 recalibration.** Calibrate again when a rubric or the judge changes.
- **R16 statistical honesty.** Repeats, spread and confidence intervals, and
  no ranking within the noise.
- **Report location.** `docs/benchmarks/<YYYY-MM-DD>-<slug>.md`, with prompt
  sets and rubrics under `docs/benchmarks/inputs/`.
- **Terminology.** "Benchmark area" replaces "domain". Glossary entries
  Benchmark area and Benchmark run are proposed.
- **Standard-set protocol.** Luna runs on OpenAI Responses, its default
  protocol. Luna on Chat Completions is run only on request.

Open, and not blocking the spec (resolve in the ExecPlan):

- **Judge runtime.** The `claude -p` flags that pin the model and effort.
  Whether the subscription's rate limits let judging fit the 4-hour bound,
  and the batch size that follows.
- **Sizes.** Item counts and repeats per area within the bound. The #704
  session measured an Annie first turn at about 14.3k input tokens on Luna
  with web search, about 4.4k of which is the search tool. The same turn is
  about 28% larger on Haiku.
- **Episode search.** How the `remember` arm's episode search keeps the app's
  PostgreSQL full-text search behavior: a disposable database on the task
  stack, or a faithful stand-in.
- **Calibration sample.** Its size (discovery suggested 30–40 replies) and
  how it is stratified.
- **Rubrics.** The rubric and scoring for Memory Manager proposals and for
  memory capture matching.
- **Smoke subset.** The free smoke subset used for regression checks, and its
  size.
- **Compaction settings.** Whether the native Anthropic and OpenAI Responses
  compaction settings need pinning for comparability.

Flagged against existing decisions:

- **ADR 0009 (memory split).** The episode log is shared across Animas, while
  `MEMORIES.md` belongs to one Anima. Arm (b) tests a design that would amend
  ADR 0009 if the owner adopts it. The benchmark changes no decision.
- **Fairness proposal on #470.** The issue proposed judges from another family
  than the contestants, or several judges with agreement reported. The owner
  replaced that with a single Opus 5.5 judge (R12). The caveat is reported,
  and calibration is the check on it.
- **ADR 0023 moderation gap.** Crisis moderation runs only on OpenAI Responses
  turns. Safety is deferred, so v1 does not measure this difference. A later
  safety area must account for it.
- **Glossary.** "Domain" would collide with domain documentation, so this spec
  uses "benchmark area" (see Terminology).

## Spec

Snapshot of https://github.com/raymond-van/animama/issues/470, captured from
its body as published at `2026-10-26T02:24:13Z` (issue `updatedAt`). The
issue is authoritative: refresh this file from it before resuming, and do
not edit this file as a competing source of requirements.

## ExecPlan

[model-benchmark-execplan.md](https://github.com/raymond-van/animama/blob/53adb22fdf4dbb147b6e330bd631973425fa3c20/docs/plans/model-benchmark/model-benchmark-execplan.md)
at its reviewed revision `53adb22f`. The tracked plan on the delivery branch
holds its current progress and evidence.

## Delivery links

Prior art: #409, PR #462, and the 2026-10-12 model comparison in
[the gesture catalog ExecPlan](../gesture-catalog-expansion/gesture-catalog-expansion-execplan.md).
Prompt change this spec depends on: #704, PR #710.
