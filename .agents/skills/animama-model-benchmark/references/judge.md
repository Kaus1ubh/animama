# Judge

`judge` scores a run blind with Claude Opus 5.5 through `claude -p` on the
owner's subscription. It runs on the host.

## Before judging

- `claude --version` works, and the owner is signed in (`claude` once,
  interactively). The judge removes API-key variables from its environment, so
  it can only use the subscription sign-in.
- There is no user `~/.claude/CLAUDE.md` (or `$CLAUDE_CONFIG_DIR/CLAUDE.md`):
  the CLI loads it into every session, so judging refuses to start. Ask the
  owner to move it aside while judging.
- The run is finished. A run whose manifest still says `running` (killed)
  needs `--allow-unfinished`, and its judge plan then covers only the turns it
  has.

## Running

```bash
uv run --no-sync python -m scripts.evals.benchmark judge --run-dir <run> \
  --prompts docs/benchmarks/inputs/prompts.json --effort <pinned> [--concurrency 2] \
  [--rubric <id>] [--batch <id>] [--timeout 900]
```

- The first call writes `judge/plan.json`, `judge/batches/` and
  `judge/mapping.json` in the run. The mapping links opaque ids to records;
  never paste it, or the batches, into a judge or a report.
- Results go to `judge/<effort>/<batch>.json`, one per batch. A rerun skips
  completed batches and retries missing ones.
- Exit codes: 0 every selected batch scored; 1 some batches missing after
  three attempts (rerun to retry); 2 an input error; 3 stopped.
- **Stopped, resumable:** a usage limit, a sign-in problem, SIGTERM or SIGHUP.
  Tell the owner, then rerun the same command once the limit resets or the
  owner has signed in.
- **Stopped, not resumable:** broken isolation (a call loaded tools, MCP
  servers, skills or plugins, used an API key, or ran another model) or a CLI
  that will not start. Report it to the owner; do not loosen the checks.
- A changed rubric, judge model, seed or set of turns refuses the existing
  plan: that is a new results series, judged in a copy of the run (its
  `manifest.json` and `turns.jsonl` in a new directory).

## Calibration

On the first run of a prompt-set version and rubric (gate G4):

1. `calibrate export --run-dir <run> --prompts …` samples up to 36 English
   `reply` and `expression` items into `calibration/`.
2. The owner rates every item in `calibration/sheet.md` and fills in a copy
   of `calibration/ratings.json` (integers 1–5). Do not suggest scores.
3. `calibrate import --run-dir <run> --prompts … --ratings <file>` checks and
   keeps them.
4. `calibrate pilot --run-dir <run> --prompts …` judges the sample at medium
   and high and writes `calibration/result.json` with each effort's agreement
   and the pinned effort (medium on a tie). It resumes like `judge`.

Then run `judge --effort <pinned>` on the whole run. Later runs reuse the
pinned effort without calibrating again, unless a rubric or the judge
changed.
