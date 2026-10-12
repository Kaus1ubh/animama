# Gesture selection evaluation inputs

Inputs for the Gesture selection evaluation in issue #414 (Phase 3 of the
[ExecPlan](gesture-catalog-expansion-execplan.md), spec R7). The harness is
`scripts/evals/gesture_selection.py`; its docstring defines the input formats
and scoring.

These files are the inputs of the final run (2026-10-11), tracked beside the
plan so the reported fit rates can be reproduced:

| File | Contents |
| --- | --- |
| `gesture-selection-eval-loadout-baseline.json` | The 20 starters before this change, with their names and AI descriptions at the time (20 Gestures). |
| `gesture-selection-eval-loadout-candidate.json` | The same 20 with the final G3 descriptions, plus Explain with Open Palms, Goodbye Wave, Tear Wipe, Apology Bow and Prayer Hands Thanks (25). |
| `gesture-selection-eval-loadout-all.json` | All 43 earlier Included Gestures with the final G3 descriptions, plus all 64 new Gestures, including the 12 idles and the 22 R1b Gestures (107). |
| `gesture-selection-eval-prompts.json` | 60 single-turn items and two scripted chats of 30 user turns each, with each item's acceptable Gestures (the expected fits). |
| `gesture-selection-eval-loadout-95.json` | The 95 non-idle Included Gestures (all 107 minus the 12 dependencies of the Streamer Idle style) with their shipped AI descriptions, sorted by selector. The loadout of the 2026-10-12 model comparison. |

The generators below (`build_inputs.py`, `extend_prompts_r1b.py`) read the
git-ignored drafts and promotion package, so they stay in the ignored
`eval/` folder; the tracked JSON files are their output.

The 2026-10-10 inputs (73-Gesture catalog, evaluated descriptions) are kept in
`.animama-drafts/gesture-catalog-expansion/eval-runs/inputs-2026-10-10/`; their
hashes match the `luna-*` runs' `results.json`.

## Loadouts

Each loadout is a JSON list of `{selector, name, description}`, sorted by
selector because chat lists an Anima's equipped Gestures in that order. The
generator reads:

- the starters from `src/backend/animama/resources/starter-loadout.v1.json`;
- the selector (`semantic_key`), name and current `ai_description` from
  `content/included/gestures/<slug>/<slug>.meta.json`;
- the final, owner-approved descriptions from the G3 promotion package,
  `.animama-drafts/gesture-catalog-expansion/promotion/`: the new Gestures'
  names, selectors and descriptions from `gestures-add.json`; the existing
  Gestures' descriptions from `gestures-replace-after-effects.json`,
  `gestures-replace.json` and the `descriptions` of `hand-edits.json`, which
  together must cover all 43 Included Gestures once (PACKAGE.md Appendix B).

Regenerate after the descriptions or drafts change:

```bash
uv run python docs/plans/gesture-catalog-expansion/eval/build_inputs.py
```

Then copy the regenerated `eval/*.json` over the tracked
`gesture-selection-eval-*.json` files.

The drafts folder is git-ignored. Without the package, the script rewrites
only the baseline and keeps the existing candidate and all-Gestures files.
Warnings report a package name or `current` text that differs from the
Included metadata. The baseline reads the Included metadata, so once the
descriptions are promoted, regenerating it no longer reproduces today's text:
pass `--keep-baseline` and use the existing file (sha256 `f94e7d58…`).

The 95-Gesture loadout is derived from the shipped Included metadata, not the
promotion package. Regenerate it from the repository root (sha256 `dc132bd7…`
as of 2026-10-12):

```bash
uv run python - > docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-95.json <<'PY'
import json, pathlib
root = pathlib.Path("content/included")
style = json.loads((root / "idle-styles/streamer-idle/streamer-idle.json").read_text())
idle = {dependency["ref"] for dependency in style["dependencies"]}
metas = [json.loads(path.read_text()) for path in root.glob("gestures/*/*.meta.json")]
loadout = [
    {"selector": meta["semantic_key"], "name": meta["name"], "description": meta["ai_description"]}
    for meta in metas
    if meta["content_id"] not in idle
]
print(json.dumps(sorted(loadout, key=lambda gesture: gesture["selector"]), indent=2, ensure_ascii=False))
PY
```

## Prompt set

The 60 single-turn items are short messages to a friendly companion:

| Group (`tags`) | Items |
| --- | ---: |
| `emotion`: two each for sadness, anger, disgust, fear, embarrassment, desire, optimism, remorse and gratitude | 18 |
| `beat`: two each for explain, compare, list, meh, wait, secret and sarcasm; one each for emphasise and invite | 16 |
| `greeting`, `goodbye` | 3 + 3 |
| `praise`, `celebration`, `joke`, `thinking`, `surprise` | 2 each |
| `neutral` | 10 |

Each item also carries an `emotion:<name>` or `beat:<moment>` tag where one
applies. `acceptable` lists every selector from the 107-Gesture catalog that a
reasonable reviewer would accept for the companion's reply, judged on the
visible action. For example, Wave Hello also fits a goodbye. `null` is
acceptable on the neutral turns and on a few others where a plain reply is
fine: grief, a simple explanation, steps and pros and cons. Strong moments
expect a Gesture. No item lists Cat Monster Rawr, Cat Paws Nya, Drumroll or
Hands on Hips.

The lists were first judged against the 73-Gesture catalog. On 2026-10-11,
`extend_prompts_r1b.py` added 49 selectors to 35 items for the R1b Gestures
and idles; its `ADD` table is the record. For example, Virtual Hug fits grief
and good news, Fingers Crossed and Fist Bump fit "wish me luck", and Zip Lips,
Pinky Promise and Scheming Hands fit secrets. Tehepero and Flustered Fan fit
embarrassment; Downcast Sigh, Simmering Huff and Nervous Fidget fit their
emotions; Hmm Drift and Pon! fit the thinking items. Nothing was added to a
neutral item. No item is about relief or a correct guess, so Phew Brow Wipe
and Big Circle appear in no list.

The scripted chats are `stressful-week`, a hard week that turns out well, and
`trip-and-hobby`, which plans a hiking holiday and starts watercolour
painting. Their turns change topic and tone so that the evaluation can show
repetition.

## Dry run

```bash
uv run python -m scripts.evals.gesture_selection --dry-run \
  --loadout docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-baseline.json \
  --loadout docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-candidate.json \
  --loadout docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-all.json \
  --prompts docs/plans/gesture-catalog-expansion/gesture-selection-eval-prompts.json \
  --repeats 3 --scripted-repeats 1 --max-calls 800
```

Output on 2026-10-10 (73-Gesture inputs):

```text
Gesture selection evaluation plan
Prompt set: 60 single-turn items, 2 scripted chats (60 turns)
Repeats per loadout: 3 for single-turn items, 1 for scripted chats
Loadouts:
  - loadout-baseline: 20 Gestures, 3005 gesture-list bytes, 49/60 items coverable
  - loadout-candidate: 25 Gestures, 4990 gesture-list bytes, 51/60 items coverable
  - loadout-all: 73 Gestures, 15480 gesture-list bytes, 60/60 items coverable
Estimated model calls: 720 (240 per loadout); up to 1440 if every reply needs chat's structured repair request
Approximate input tokens (chat's conservative estimate for a JSON-schema model; scripted turns grow with their history):
  - loadout-baseline: ~3230 input tokens per first turn
  - loadout-candidate: ~3753 input tokens per first turn
  - loadout-all: ~6600 input tokens per first turn
Budget: the estimate is within --max-calls 800; repairs and context retries also count, and no call beyond the cap is sent
```

Output on 2026-10-11 (final inputs, after the merge of `main`): the same
720 calls; baseline 20 Gestures, 3005 bytes, ~3602 tokens per first turn;
candidate 25, 5126 bytes, ~4160 tokens; all 107, 23868 bytes, ~9224 tokens,
60/60 items coverable. The baseline's token estimate rose from ~3230 with the
same loadout because chat's instructions changed in the merge, so compare
loadouts within one run rather than across the 2026-10-10 and 2026-10-11 runs.

At first-turn size, the 720 calls need about 3.26 million input tokens
(240 × (3,230 + 3,753 + 6,600)). Scripted turns add their growing history, and
repairs add calls. Multiply by the chosen model's catalog prices, as the
harness docstring describes, to estimate the cost for the owner before a paid
run.

## Real run

A paid run needs the owner's consent to the estimated cost, and a development
stack started from this checkout, which bind-mounts it at `/app`:

```bash
./reset.sh --name <name> --base-port <port>   # only if no stack serves this checkout
source .animama-stack.env
docker compose -p "$COMPOSE_PROJECT_NAME" exec animama-server \
  python -m scripts.evals.gesture_selection --list-models
docker compose -p "$COMPOSE_PROJECT_NAME" exec animama-server \
  python -m scripts.evals.gesture_selection \
  --loadout /app/docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-baseline.json \
  --loadout /app/docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-candidate.json \
  --loadout /app/docs/plans/gesture-catalog-expansion/gesture-selection-eval-loadout-all.json \
  --prompts /app/docs/plans/gesture-catalog-expansion/gesture-selection-eval-prompts.json \
  --model-provider-id <model-provider-id> \
  --repeats 3 --scripted-repeats 1 --max-calls 800 \
  --output-dir /app/.animama-drafts/gesture-eval/<run>
```

`--list-models` prints the active chat rows; `<model-provider-id>` is the
owner's row id. For a free smoke run against the mock model, add
`-e ANIMAMA_LLM_SKIP=1` after `exec`. The run writes `results.json` and
`summary.md` to the git-ignored drafts folder. Record the summary table in the
ExecPlan, without raw model output.
