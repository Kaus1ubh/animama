---
name: animama-model-benchmark
description: Run the Animama model benchmark end to end - dry-run plan and estimate, owner approval of the caps, the contestant run in a task stack, the one-time judge calibration, blind judging through the Claude CLI on the owner's subscription, and the public-safe report - or a free mock rehearsal of the same flow. Use when the owner asks to benchmark or compare chat models, efforts or the episodic-memory arms, to resume a stopped judge, or to re-render a benchmark report.
---

# Animama Model Benchmark

The benchmark scores catalog chat models through chat's own turn path and a
blind judge. [`docs/benchmarks/README.md`](../../../docs/benchmarks/README.md)
explains the areas, inputs, memory arms, judge and report; read it first. Every
step is a documented command, so run each one yourself and report its output;
the references hold the exact commands.

## Rules

- **No paid call without the owner's approval of that run's caps.** Show the
  `plan` output, including the wall time, and ask for `--max-calls` and
  `--max-usd`. A mock rehearsal (`ANIMAMA_LLM_SKIP=1`) needs no approval.
- **Judging uses the owner's Claude subscription** through the `claude` CLI on
  the host. Never pass an API key, never use `--bare`, and never change the
  judge's isolation to get past a stop; report the stop to the owner.
- **Raw results stay in `.animama-drafts/model-benchmark/`.** Only the report
  is tracked, and only after its safety check passed.
- **Credentials:** start the stack with the secrets file selected through
  `COMPOSE_ENV_FILES`; never print, copy or source it.
- Use only project-scoped `docker compose -p <project>` commands, run
  `cleanup` only between runs, and take the task stack down after its last use.
- Do not edit the tracked inputs or rubrics during a run; a change makes a new
  prompt-set version or results series.

## Workflow

1. **Check the setup.** Use `animama-local-stacks` to start or reuse a task
   stack from this checkout ([commands](references/commands.md#stack)); confirm
   `models` lists the rows to run. On the host, check `claude --version`, that
   the owner is signed in, and that there is no user `~/.claude/CLAUDE.md`
   (judging refuses to start while one exists).
2. **Plan.** Run `plan` with the prompt set, tier and configurations. Check
   that it fits the 4-hour bound and that every configuration runs.
3. **Ask for approval.** Present the configurations, calls, estimated cost,
   wall time and judge batches; ask the owner for the caps (and for
   `--over-time-approved` if the plan is over 4 hours). Record the approval.
4. **Run.** Run `run` in the backend container with the approved caps and a
   new `--output-dir` under `/app/.animama-drafts/model-benchmark/`. A run
   stopped by a cap or an interruption keeps its results; the owner decides
   whether to approve another. If turns failed on connection errors, ask the
   owner whether to retry them with `--retry-from`
   ([commands](references/commands.md#retrying-connection-errors)). When the
   run is done, check that `cleanup` has nothing to drop, then take the stack
   down.
5. **Calibrate (first run only, gate G4).** `calibrate export`, then ask the
   owner to rate `calibration/sheet.md` into `ratings.json`;
   `calibrate import`; `calibrate pilot` pins the judge effort
   ([judge](references/judge.md#calibration)).
6. **Judge.** `judge --effort <pinned>` on the host. On a usage limit, tell the
   owner and rerun the same command after the limit resets; on missing
   batches, rerun to retry them ([judge](references/judge.md)).
7. **Report.** `report`; if it refuses because raw text would appear, find the
   source it names rather than weakening the check
   ([reports](references/reports.md)).
8. **Recommendations.** Ask the owner to write the recommendations in a
   Markdown file kept with the run, render the report again with
   `--recommendations <file> --overwrite`, track it at
   `docs/benchmarks/<YYYY-MM-DD>-<slug>.md`, check `--rerender` with the same
   file, and link it from the issue it informs.

For a rehearsal, run the same steps on the smoke tier with
`ANIMAMA_LLM_SKIP=1` and a stub judge ([commands](references/commands.md#rehearsal)).

## References

- [Commands](references/commands.md): the stack, every command and the
  rehearsal.
- [Inputs and memory arms](references/inputs.md): the prompt set, held-out
  rule and the arms.
- [Judge](references/judge.md): sign-in, isolation, resuming and calibration.
- [Reports](references/reports.md): reading, the safety check and
  re-rendering.
