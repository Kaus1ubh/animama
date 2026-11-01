# Reports

```bash
uv run --no-sync python -m scripts.evals.benchmark report --run-dir <run> \
  --prompts docs/benchmarks/inputs/prompts.json [--effort <effort>] [--output <path>] \
  [--title <title>] [--recommendations <file>] [--overwrite] [--rerender]
```

- The effort defaults to the pinned one, or the only effort judged; with two
  and nothing pinned, pass `--effort`. A run not judged yet still reports its
  measured values.
- The default output is `report.md` in the run. A differing existing file is
  kept unless `--overwrite` is passed, so the owner's text is never lost by
  accident.
- `--recommendations <file>` puts the owner's Markdown in the Recommendations
  section; without it the section holds placeholders. Keep the file with the
  run and pass it on every later render.
- `--rerender` rebuilds the report and exits 0 only when it matches `--output`
  byte for byte; it writes nothing.

## The safety check

The report may hold ids, labels, counts and scores only. `report` refuses to
write when any line of a reply, saved memory, tool argument, prompt, persona,
fixture or the guidance (20 characters or more, with a letter) appears in it,
and names where the text came from. Find the cause in the rendering rather
than shortening or hiding lines.

## Reading

- **Scorecard:** judged scores (1–5) with a 95% interval and the number of
  judged replies; rates with their counts; latency, tokens and cost, or
  "unpriced".
- **Rankings:** only configuration pairs whose intervals are apart, each
  resting on at least five items or conversations. Everything else is not
  distinguishable; do not describe one as better.
- **Memory arms:** per configuration, what each arm kept, missed, kept by
  mistake (noise) or broke (sensitive), recall, tool use and cost, and the
  kept-rate differences between arms.
- **English and Japanese pairs, tuned and held-out items, Memory Manager,
  Judge, Calibration, Conditions and Limitations:** read the limitations
  before drawing conclusions; missing judge scores are counted under Judge.

Track the owner-approved report at `docs/benchmarks/<YYYY-MM-DD>-<slug>.md`
and link it from the issue it informs. Raw results stay in the drafts folder.
