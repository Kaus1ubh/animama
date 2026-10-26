# Model benchmark

The model benchmark scores the app's chat models in the conditions chat really
uses: chat's own turn executor, prompt assembly, reply schema and memory tools,
with a blind judge for the measures a program cannot check. It informs two
decisions: the default chat model, and how episodic memory should be saved.
The agreed requirements are in [issue #470](https://github.com/raymond-van/animama/issues/470);
the [`animama-model-benchmark` skill](../../.agents/skills/animama-model-benchmark/SKILL.md)
runs the whole flow, and every step below is also a command you can run
yourself.

A **benchmark run** is one approved execution over a fixed set of
configurations (a catalog row at a reasoning effort) and one prompt-set
version. It covers four **benchmark areas**: core turns, long chats, in-chat
memory with the episodic-memory arms, and the Memory Manager.

## Commands

Every command is `python -m scripts.evals.benchmark <command>` from the
repository root.

| Command | Where | What it does |
| --- | --- | --- |
| `plan` | anywhere | The dry run: planned calls, tokens, cost and wall time, judging included, against the 4-hour bound. No database or model. |
| `run` | the backend container of a task stack | Runs the configurations and writes `turns.jsonl` and `manifest.json` to `--output-dir`. Needs `--max-calls` and `--max-usd`, the owner's caps. |
| `judge` | the host, signed in to Claude | Judges the run blind at one `--effort`; rerun it to resume. |
| `calibrate export` / `import` / `pilot` | the host | The one-time calibration against the owner's ratings. |
| `report` | anywhere | Renders the public-safe report from the recorded results. |
| `models` | the backend container | Lists the catalog's active chat rows. |
| `cleanup` | the backend container | Drops benchmark databases a killed run left behind. |

A free rehearsal runs everything against chat's mock model: add
`-e ANIMAMA_LLM_SKIP=1` after `docker compose exec`. A paid run starts only
after the owner approves its `plan` output and caps. Raw results hold replies
and saved memory; keep them under the git-ignored
`.animama-drafts/model-benchmark/`.

```bash
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" exec animama-server \
  python -m scripts.evals.benchmark plan --prompts docs/benchmarks/inputs/prompts.json --standard
```

`--standard` takes every visible built-in chat row at efforts none and low;
`--config <row id>@<effort>` names others. `--tier smoke` takes the tracked
smoke subset.

## Inputs

[`inputs/`](inputs/) holds the tracked, owner-approved inputs:

- `prompts.json`: the prompt set (format v1, documented in
  [`prompt_set.py`](../../scripts/evals/benchmark/prompt_set.py)): personas,
  single-turn items with their acceptable Gestures, scripted chats, memory
  fixtures, memory chats with checklists and recall probes, and Memory Manager
  runs. Files it names are pinned by sha256.
- `loadout-starter-v1.json`: the equipped Gestures every turn sees.
- `episodic-guidance.md`: the candidate `MEMORIES.md` guidance for memory arm (b).
- `rubrics.json`: the judge's rubrics, with 1–5 anchors and an example for each.

Any change to these makes a new prompt-set version; a changed rubric or judge
starts a new results series, so reports from different series are not
compared as like for like. Japanese items are agent translations, each paired
with its English original by `pair_id`. About a fifth of the items are
**held out**: nobody tunes prompts, Gesture descriptions, guidance or rubrics
against them, and the report shows them apart.

## Memory arms

Each configuration runs the memory chats in three arms, which decide how
episodic memory is saved:

| Arm | `remember` note | `MEMORIES.md` writes |
| --- | --- | --- |
| (a) `remember` only | Yes | No (read-only) |
| (b) `MEMORIES.md` only | No | Yes, with the candidate guidance |
| (c) both (the current app) | Yes | Yes |

Shared files such as `PROFILE.md`, and memory reads, are the same in every
arm. The arms are benchmark-only seams in chat (see
[Memory Manager and episodic memory](../backend/features/memory-manager-and-episodic-memory.md#benchmark-memory-arms));
production never sets them.

Memory work runs on a disposable PostgreSQL database,
`animama_benchmark_<run>_<time>_<random>`, created next to the application
database and dropped when the run ends; the application database is only read
for the model catalog. Run `cleanup` **between runs, not during one**: a
`cleanup` that lands while a run starts can drop its database, and one during
a run slows its turns.

## Judge

The judge is Claude Opus 5.5 (`claude-opus-5-5`) through the Claude CLI on the
owner's subscription, never an API key. Sign in once with `claude` on the host.
Each call runs from an empty directory in restricted mode with no tools except
structured output, no MCP servers, skills or settings, and only a short list of
environment variables; a call that loads anything else, or is not signed in
through the subscription, stops judging.

Items are shuffled across configurations, arms and languages, under opaque
ids; nothing sent names a model, configuration, effort, arm or language.
Memory edits reach the judge as diffs of the stored files, so every provider's
tools read alike. Output that does not match the rubric's schema is retried
twice, then recorded as missing. A usage limit stops judging cleanly; run the
same command later to continue.

The judge shares a model family with Claude Haiku, a contestant, which the
owner accepted. Calibration checks it: on the first run, `calibrate export`
samples up to 36 English `reply` and `expression` items, the owner rates them
in `calibration/sheet.md` and `ratings.json`, `calibrate import` checks the
ratings, and `calibrate pilot` judges the sample at medium and high and pins
the effort that agrees better with the owner (medium on a tie). Later runs
reuse the pinned effort.

## Conditions and time

Run from a development task stack built from the checkout. Contestant calls run
one at a time, interleaved by configuration, after one discarded warm-up each.
`plan` estimates the wall time from calls and judge batches; a run over 4 hours
starts only with `--over-time-approved`, the owner's exception. Latency compares
only within one run.

## Reading a report

`report --run-dir <run> --prompts docs/benchmarks/inputs/prompts.json` writes
`report.md`. The owner's recommendations go in a Markdown file passed with
`--recommendations`; later `report` and `report --rerender` runs pass the same
file, and `--rerender` checks the report rebuilds byte for byte.

- Judged scores are means on the 1–5 scale with a 95% bootstrap interval and
  the number of judged replies. Rates give their counts.
- Configurations are ranked only when their intervals are apart and each rests
  on at least five items or conversations; otherwise the report says they are
  not distinguishable or too few to compare.
- Missing judge scores, failed turns and unpriced costs are counted, never
  filled in. A run that stopped early is marked partial.
- The report holds ids, labels, counts and scores only; it refuses to write if
  any reply, saved memory or prompt text would appear in it.

## Limitations

- Memory turns and OpenAI Memory Manager runs keep the provider's real storage.
- PostgreSQL's english text search does not split Japanese into words, so
  Japanese episode notes are found only by their exact text.
- In arm (a) the memory tools still describe `MEMORIES.md` edits, which they
  then refuse.
- The Memory Manager runs once per catalog row at its own effort, since its
  runtimes take no chat effort.
- Calibration covers the `reply` and `expression` rubrics; the others are
  judged by Opus alone.
