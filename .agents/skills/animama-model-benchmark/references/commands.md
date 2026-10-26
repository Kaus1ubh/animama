# Commands

Run benchmark commands as `python -m scripts.evals.benchmark <command>`.
Contestant work (`models`, `plan` with catalog rows, `run`, `cleanup`) runs in
the backend container of a task stack; judging, calibration and reports run on
the host with `uv run --no-sync`. Paths below are from the repository root.

## Stack

Start the task stack with `animama-local-stacks`. A paid run needs the
connection keys, selected without printing them:

```bash
export COMPOSE_ENV_FILES="$HOME/.config/animama/dev-secrets.env,$PWD/.env"
./reset.sh --name bench --base-port 8900
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T animama-server python -m scripts.evals.benchmark models
```

A rehearsal starts the stack with `ANIMAMA_LLM_SKIP=1 ./reset.sh ...` instead
and needs no keys. When the work is done, take the stack down with
`docker compose -p "$COMPOSE_PROJECT_NAME" down` and remove
`.animama-stack.env`.

## Plan and run

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T animama-server python -m scripts.evals.benchmark plan \
  --prompts docs/benchmarks/inputs/prompts.json --standard --tier full
```

- `--standard`: every visible built-in chat row at efforts none and low;
  `--config <row id>@<effort>` (repeatable) adds others; `models` lists rows.
- `--tier smoke|full`, `--repeats`, `--scripted-repeats`.
- `--judge-effort medium|high` and `--judge-concurrency` set the judging part
  of the wall-time estimate.

`run` takes the same options plus the owner's caps and prices:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T animama-server python -m scripts.evals.benchmark run \
  --prompts docs/benchmarks/inputs/prompts.json --standard --tier full \
  --max-calls <approved> --max-usd <approved> --price input=…,cached_input=…,cache_write=…,output=… \
  --source-revision "$(git rev-parse HEAD)" --network-label <network> \
  --output-dir /app/.animama-drafts/model-benchmark/<date>-<slug>
```

`--price` (USD per million tokens) prices every configuration whose catalog
rates agree; `--row-price <row id> <rates>` prices one row. `run` refuses to
start when the plan exceeds `--max-calls`, its estimate exceeds `--max-usd`,
or its wall time exceeds 4 hours without `--over-time-approved`. It exits 0
for a complete run, 1 when a cap or an error stopped it, 2 for an input error
and 130 when interrupted; `manifest.json` records why it stopped.

## Cleanup

`cleanup` (in the container) drops `animama_benchmark_*` databases that no
session uses. Run it only between runs.

## Judging, calibration and reports

On the host, from the repository root, with the run copied or mounted at
`.animama-drafts/model-benchmark/<run>`:

```bash
uv run --no-sync python -m scripts.evals.benchmark judge --run-dir .animama-drafts/model-benchmark/<run> \
  --prompts docs/benchmarks/inputs/prompts.json --effort medium
uv run --no-sync python -m scripts.evals.benchmark report --run-dir .animama-drafts/model-benchmark/<run> \
  --prompts docs/benchmarks/inputs/prompts.json
```

See [judge](judge.md) and [reports](reports.md) for their options and exit
codes.

## Rehearsal

A free run of the whole flow: start the stack with `ANIMAMA_LLM_SKIP=1`, run
`plan` and `run` with `-e ANIMAMA_LLM_SKIP=1` after `exec` on `--tier smoke`
(any caps; no calls are billed), then judge with the stand-in CLI and render
the report:

```bash
uv run --no-sync python -m scripts.evals.benchmark judge --run-dir <run> \
  --prompts docs/benchmarks/inputs/prompts.json --effort medium --claude scripts/evals/benchmark/stub_claude.py
```

The stand-in scores every criterion 3 and reads every capture entry as not
saved; its report checks the wiring, not any model.
