# Faster, passing Playwright journey suite

Source agreement: issue
[raymond-van/animama#319](https://github.com/raymond-van/animama/issues/319)
(body and both owner scope comments), read back 2026-10-07. The owner's
2026-10-07 task instruction authorizes the whole plan on one branch and PR.

Authorized scope: all phases below. Branch `perf/journey-suite-speed` in a task
worktree, starting from `main` at `d9fc7f91`.

## Purpose and context

`pnpm e2e:test` (35 tests in 11 files) is too slow to run routinely, and several
journeys fail on `main`. This plan records where the time goes, fixes each failing
journey where it belongs, narrows the development file watchers, and documents a
routine command with its expected duration. It must not remove journeys or loosen
assertions without owner approval, and it must not hide timing failures behind
longer timeouts.

Relevant source, relative to the repository root:

- `src/frontend/playwright.config.ts`, `src/frontend/scripts/run-playwright-e2e.mjs`:
  runner, single worker, SwiftShader WebGL in headless runs.
- `src/frontend/e2e/helpers/`: shared journey helpers, including
  `CreatorMutationGuard` (`preview-network.ts`) and `selectAnnieFromSidebar`
  (`preview-surfaces.ts`).
- `src/frontend/web/src/hooks/useRememberLastActiveAnima.ts`: persists the
  last visited Anima from the `/$animaId` route.
- `src/backend/animama/local/http/server.py`, `src/backend/animama/server/compose_entrypoint.py`,
  `src/backend/animama/server/native_entrypoint.py`: the single Uvicorn
  configuration and its reload flag.
- `docker-compose.yml`, `docker-compose.development.yml`: `WATCHFILES_FORCE_POLLING`,
  `CHOKIDAR_USEPOLLING` and the `.:/app` backend mount.
- `docs/frontend/testing/browser-journeys.md`: routine command and stack guidance.

## Progress

- [x] Baseline: full suite on a fresh disposable development stack (below).
- [x] Phase 1: failing journeys fixed where they belong (review #2 pass).
- [x] Phase 2: development watchers narrowed and measured (review #3 pass).
- [x] Phase 3: serving mode and render path measured; routine command documented (review #2 pass).
- [x] Phase 4: full suite passes on a fresh disposable stack (35 passed, 10.8 min); final review below.

## Baseline (2026-10-07)

Environment: macOS 26.6.2 on Apple M5 (10 cores), OrbStack 2.1.0 (Docker 29.4.0,
10 CPUs, about 11.7 GiB VM memory), Node 24.15.0, Playwright 1.58.2, headless
Chromium with SwiftShader WebGL. Fresh named development stack
`animama-e2edev` (`ANIMAMA_LLM_SKIP=1 ./reset.sh --name e2edev --base-port 8700`)
at `d9fc7f91`; no other Animama stacks running.

Result: 32 passed, 3 failed, 32.4 min (1,939 s summed test time).

| Test | Duration |
| --- | ---: |
| imported playback complete Anima retains imported Avatar, appearance and loadout | 513.6 s |
| local content sharing complete Anima export, reviewed install and persistence | 459.4 s |
| imported playback covers every supported content kind | 277.4 s |
| pose content Local save edit reopen and browser storage independence | 73.6 s |
| local content sharing single and multiple content export | 57.4 s |
| 30 remaining tests | 557.6 s total, each 1.6 to 38.1 s |

Main contributors:

1. The two complete-Anima journeys take 973 s, half of the suite. Backend request
   timing shows two server-side phases: about 3 minutes committing the starter
   package import, then about 2 s per `DELETE /v1/content/items/{id}` across
   roughly 135 owned items during exact-ledger cleanup. Each delete runs a full
   Local rescan that re-hashes every file. The content watcher also re-triggers
   rescans from the store's own `.animama-mutations` staging. This is product
   content-store cost, not runner overhead. The owner chose a separate follow-up
   issue for it (Decision Log).
2. Imported playback (277 s) is about 25 creator and Library preview steps of
   4 to 28 s each, dominated by Avatar loading and canvas rendering.
3. The idle development backend uses about 100% of one CPU. Uvicorn's reloader
   polls the whole worktree (`WATCHFILES_FORCE_POLLING=true`, no `reload_dirs`),
   including host `node_modules`, `.animama-stacks/` and `.animama-e2e/`.
4. Fixed `waitForTimeout` calls total only a few seconds across the suite.

## Surprises & Discoveries

- OrbStack delivers inotify events through bind mounts. A non-polling
  `watchfiles` watcher in the backend container reported host writes in
  `.animama-stacks/`. The VM's `fs.inotify.max_user_watches` and
  `max_user_instances` are both 1,048,576, so they are not a constraint.
- The Vite watcher is small: about 1,400 files under `web/`, about 3% CPU idle.
  Vite already ignores `node_modules`, `test-results`, its cache and emptied out
  directories.
- `useRememberLastActiveAnima` retried a failed preference write on every effect
  run. The effect re-runs as soon as mutation state changes, so a failing
  `PATCH /v1/users/me/settings` repeated about 15 times a second (119 requests in
  one 18 s journey).
- Journeys share the remembered Anima. A complete-Anima journey opens its
  imported Anima, which becomes the remembered one, then deletes it. The next
  journey to open Annie therefore writes the preference again.

## Decision Log

- 2026-10-07, owner: failure 8 keeps standard popover dismissal; update the
  journey rather than the product.
- 2026-10-07, owner: content-store rescan and hashing cost goes to a separate
  follow-up issue; this plan keeps to runner, fixtures, watchers, serving mode and
  the failing journeys.

## Phased implementation

### Phase 1: Failing journeys fixed where they belong

Root causes, from the baseline run and trace evidence:

| # | Journey | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | discard-local "reopens saved content" | Shared fixture state, plus a product bug. The guard was attached before Annie was selected, so Annie's preference write was blocked, and the hook then retried it in a tight loop. | Product: one attempt per visit (`lastActiveAnimaAttempts.ts`, unit-tested). Test: select Annie before attaching the guard. |
| 2 | creator-discard (scene `:188`, avatar `:62`) and discard-local "storage failure" | Scene: same as #1 (order-dependent). Avatar and storage-failure: timing. The next sidebar click landed after the URL changed to `/library` but before the blocked navigation committed, and was absorbed. | Shared `discardToLibrary` waits for the Library heading; scene Local discard selects Annie before its guard. |
| 3 | 1.0-to-2.0 Gesture reopen | Timing: `page.reload()` could run before Save's navigation to `/gestures/<id>/edit`. Passed in the baseline. | Wait for the saved item's edit URL before reloading (an added assertion). |
| 4 | imported playback | Timing under load. Each observation sample took four browser calls, and each call queued behind SwiftShader rendering, so samples were about 1.2 s apart and a short particle burst could fall between them. It passed in the baseline (277 s); the issue's earlier runs had five stacks up. It reproduced during Phase 2 measurement. | Phase 3: read each observation in one browser call (same checks). With GPU WebGL on macOS, the main thread also stays free. |
| 5–7 | pose content `:24/:134/:409` | Outdated expectation, already fixed by #321 (copy names derived from the catalog). Passed in the baseline. | None. |
| 8 | vfx guides keep Eye = playing | Outdated expectation: the UV preview is a popover and dismisses on the outside Guides click. | Owner-approved test update: assert dismissal, then reopen with Guides off. |

Checks: unit test `src/hooks/lastActiveAnimaAttempts.test.ts`; `pnpm e2e:check`;
targeted journeys on the development stack with the remembered Anima set to
Caitlyn first, to reproduce the original condition.

Results: 19 of 19 passed in the four affected spec files (7.0 min). After the
review revisions, the three Local discard journeys passed again (1.5 min).

#### Code Review #1 Findings

Independent reviewer, working tree on `d9fc7f91`, Phase 1 files only. It confirmed
the four root-cause claims against the code. Checks: hook and pose-preview vitest
(15 tests), `pnpm e2e:check`, ESLint on `src/hooks`, Prettier on the changed code.
Result: pass, no blocking findings.

- R1-F1 (optional): after a failed write, visiting an Anima that was already
  remembered did not end the attempt, so returning to the first Anima never
  retried. That contradicted the helper's own comment.
- R1-F2 (optional): the explicit Annie selection is followed by a default
  `selectAnnie` in `prepareLibraryPreview`/`openCreatorStage`. It is harmless, but
  passing `selectAnnie: false` makes the order explicit.

#### Code Review #1 Revisions

- R1-F1 accepted: a different route Anima now clears the attempt. A new test
  ("tries again after visiting an Anima that is already remembered") failed
  before the fix and passes after it (4 of 4).
- R1-F2 accepted: both guarded journeys pass `selectAnnie: false`.

#### Code Review #2 Findings

Targeted recheck of R1-F1 and R1-F2: no findings; same checks pass. Result: pass.
Repair budget remaining: one round.

### Phase 2: Development watchers narrowed and measured

Changes:

- `serve()` passes `reload_dirs=[src/backend/animama]` whenever reload is on, so
  both the Compose and native development launchers watch only backend Python.
  Uvicorn's default reload excludes (dot files, compiled Python, editor swap
  files) already cover that package, so no extra excludes are needed. The launcher
  wiring test asserts the directory for reloading launchers and its absence
  otherwise.
- `WATCHFILES_FORCE_POLLING` now defaults to empty, which lets watchfiles choose:
  native events, or polling under WSL. `CHOKIDAR_USEPOLLING` defaults to false.
  `ANIMAMA_FILE_WATCH_POLLING=true` turns polling back on for both. This also
  covers the Local content watcher, which reads the same variable.
- The base image no longer sets `WATCHFILES_FORCE_POLLING=true`, so Compose is
  the single owner of the default.
- Vite ignores coverage and motion review notes (`*.review.json`, `*.review/`),
  which are written to the working directory or beside the globbed Included
  clips. Vite already ignores `node_modules`, `test-results` and its cache, and
  watches only `web/` and imported files, so journey output under
  `.animama-e2e/` never reaches it.

Measurements on `animama-e2edev`, with the imported playback content-kind journey
as the load (SwiftShader both times; `docker stats` every 3 s):

| | Backend CPU | Backend memory | Web CPU | Web memory |
| --- | --- | --- | --- | --- |
| Idle, before | 73–105% | 404–423 MiB | 2.5–3.8% | 1.54–1.68 GiB |
| Idle, `reload_dirs` only (still polling) | 3.7–7.2% | 301 MiB | — | — |
| Idle, after | 0.1–3.3% | 307–311 MiB | 0.0% | 339–363 MiB |
| Journey, before (mean / max) | 116.6% / 199% | 1,212 / 1,228 MiB | 9.2% / 54.6% | 1,356 / 1,392 MiB |
| Journey, after (mean / max) | 13.2% / 81.2% | 1,051 / 1,059 MiB | 5.1% / 75.1% | 510 / 528 MiB |

The web memory drop partly reflects the recreated container (fresh Vite process).
Native events were verified on the recreated stack: a Python edit logged
"WatchFiles detected changes ... Reloading", and a web source edit produced a Vite
HMR update.

Checks: `uv run pytest -q tests/test_local_http_wiring.py tests/test_compose_network_boundaries.py`
(144 passed); `ruff check` and `ruff format --check` on the changed Python;
both Compose `config --quiet` commands; `bash -n reset.sh`; Prettier and ESLint on
`vite.config.ts`.

#### Code Review #1 Findings

Independent reviewer, uncommitted Phase 2 tree on `72638ce9`. It confirmed the
reload directory in the container (editable install under `/app`) and natively,
Uvicorn 0.38's `*.py`-only filter and default excludes, watchfiles 1.1.1's
empty-means-auto rule, and chokidar's `CHOKIDAR_USEPOLLING` parsing. Same checks
pass.

- R1-F1 (required): the plan's recovery note said watcher changes affect
  development reload only. The base Compose default also governs the Local content
  watcher in built stacks.
- R1-F2 (optional): the Dockerfile base image still set
  `WATCHFILES_FORCE_POLLING=true`, a second owner of the default.
- R1-F3 (optional): values other than empty, `true` and `false` are parsed
  differently by watchfiles and chokidar (for example `0`).
- R1-F4 (optional): two Vite ignore globs (`playwright-report`, `.animama-e2e`)
  can never match, because Vite watches only `web/` and imported files.
- R1-F5 (optional, pre-existing): the Included clip glob in
  `web/src/lib/avatar/poses/catalog.ts` would bundle a `*.review.json` sidecar.

#### Code Review #1 Revisions

- R1-F1 accepted: recovery note corrected.
- R1-F2 accepted: Dockerfile ENV removed; no test, script or Cloud reference
  depended on it.
- R1-F3 accepted: `.env.example` and the development guide say "true, or leave
  empty".
- R1-F4 accepted: the two globs removed.
- R1-F5 deferred: outside this plan; offered as a separate task.

#### Code Review #2 Findings

- R2-F1 (required): the plan's Phase 2 change list still named the removed Vite
  globs and omitted the Dockerfile change.
- R2-F2 (optional): uneven wrapping and a repeated "otherwise" in the
  development guide.

#### Code Review #2 Revisions

Both accepted and fixed.

#### Code Review #3 Findings

Targeted recheck: no findings. Result: pass. Repair budget exhausted for this phase.

### Phase 3: Serving mode, render path and routine command

Changes:

- `playwright.config.ts` selects the headless WebGL renderer with
  `ANIMAMA_E2E_WEBGL`. The default is `metal` on macOS: headless Chromium reports
  "ANGLE Metal Renderer: Apple M5" with `--use-angle=metal`, while plain headless
  reports no WebGL. Other platforms keep SwiftShader. Headed runs are unchanged.
  The suite has no screenshot baselines, so the renderer change affects no
  snapshot comparison.
- `readPlaybackObservation` reads count, schema version and text in one browser
  call instead of four. Under SwiftShader load each call queued behind rendering:
  the failure 4 reproduction during Phase 2 measurement (run `run-1007200634`) got
  6 samples in 5 s, about 1.2 s apart, and missed a short particle burst. The same proof under SwiftShader now samples
  every 0.4 to 0.7 s and passes. The checks are unchanged.
- Pose content: Insert loads the saved Pose asynchronously. The journey now
  waits for the inserted non-Base beat on the timeline before reading Clip JSON.
  On the faster built stack it had read the empty document (`Unexpected end of
  JSON input`). This is another timing fix that adds an assertion.
- The two complete-Anima package journeys carry an `@complete-anima` title tag.
  `pnpm e2e:test:fast` runs everything else.
- `docs/frontend/testing/browser-journeys.md` documents built stacks for journeys
  and agent live checks, the full and fast commands with durations, when to use a
  development stack, and the WebGL override.

Measurements (Apple M5, OrbStack, one other stack idle):

| Run | Stack | WebGL | Result | Duration |
| --- | --- | --- | --- | --- |
| Baseline | development, polling | SwiftShader | 32 passed, 3 failed | 32.4 min |
| Imported playback (`:632`) only | development, narrowed | SwiftShader | passed | 4.3 min (baseline 4.6) |
| Imported playback (`:632`) only | development, narrowed | Metal | passed | 2.9 min |
| Full suite | development, narrowed | Metal | 35 passed | 25.0 min |
| Full suite | built (fresh) | Metal | 34 passed, 1 failed (pose timing, fixed above) | 10.5 min |
| Fast subset | built | Metal | 33 passed | 4.7 min |

Attribution, by summed test time: baseline 1,939 s; development with Metal and
narrowed watchers 1,494 s; built with Metal 627 s. Metal mostly helps
render-heavy journeys (imported playback content kinds 277 → 162 s on
development). The built application helps everything, and the complete-Anima
journeys most: 529 → 203 s and 458 → 143 s against development with Metal.
Their remaining cost is server-side and is tracked in #330.

Per-test durations on the built stack with Metal, compared with the baseline:
complete-Anima imported playback 513.6 → 202.6 s, complete-Anima sharing
459.4 → 143.1 s, imported playback content kinds 277.4 → 82.9 s, content sharing
57.4 → 22.0 s, and pose content Local save 73.6 → 14.9–16.2 s (from the
pose-content rerun after its fix). Creator journeys
dropped from 10–38 s to about 5–14 s.

Parallel workers remain at one. Several journeys assert that the whole Local
catalog is unchanged, and the server serializes content writes behind one
advisory lock. Concurrent workers would therefore need a stack each or weaker
catalog assertions. Neither is justified now that the full suite takes about
11 minutes.

#### Code Review #1 Findings

Independent reviewer, uncommitted Phase 3 tree on `e9a7681b`. It confirmed the
single-call read keeps every check (count, version, non-empty, parse), and that
the beat wait cannot pass early: a new Gesture draft has only Base beats until
the insert commits. It also confirmed the WebGL config validation, the
docs/reset behaviour and that no ledger key depends on test titles. Checks:
`pnpm e2e:check`, `pnpm e2e:test:unit` (19 pass), Prettier, and `e2e:list`
filters (35, 33, and 2 plus setup).

- R1-F1 (required): the built-stack guidance said it has "no file watchers"; the
  Local content watcher still runs there.
- R1-F2 (required): the docs said "no other stacks running", while the plan says
  one other idle stack.
- R1-F3 (optional): the 32-minute development figure was history in durable docs.
- R1-F4 (optional): `webglArgs[webgl]` accepted inherited keys such as
  `constructor`.
- R1-F5 (optional): match the inserted Pose's name instead of a negative
  lookahead.

#### Code Review #1 Revisions

All accepted. Docs now say "no reload watcher or Vite" and "one other idle
stack", and state the current development-stack duration (25 minutes, measured)
instead of the baseline. The config uses `Object.hasOwn`. The beat wait matches
`^${name} keyframe at ` (`name` is `pose-e2e-<hex>`). `pnpm e2e:check` passes.

#### Code Review #2 Findings

Targeted recheck of all five revisions: no blocking findings (one cosmetic
wrapping note, applied). `e2e:check`, `e2e:list` filters, the
`ANIMAMA_E2E_WEBGL=constructor` rejection and Prettier pass. Result: pass. One
repair round remains.

### Phase 4: Full run and final review

Source: `a982924e` (Phases 1–3 plus a merge of `main` at `5f93876c`, which
touched only `.gitignore` and the Included clip glob). Fresh named built stack
`animama-e2efinal`:
`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name e2efinal --base-port 8960`.
Metal WebGL. Two other tasks' stacks were running during the run; this task's
earlier stacks were stopped with their data retained.

Result: `pnpm e2e:test`: 35 passed, 10.8 minutes (650 s wall; 644 s summed test
time). Run `run-1007212158`. The backend averaged 49% CPU (maximum 111%).

| Test | Baseline (s) | Final (s) |
| --- | ---: | ---: |
| installation setup | 1.6 | 1.4 |
| content sharing: single and multiple export | 57.4 | 25.5 |
| content sharing: complete Anima `@complete-anima` | 459.4 | 147.5 |
| Local Gesture discard reopens saved content | 18.5 (failed) | 11.0 |
| Local Gesture discard storage failure | 32.3 (failed) | 12.0 |
| avatar creator discard existing / new / immediate | 17.3 / 23.1 / 19.9 | 5.0 / 5.1 / 3.7 |
| scene creator discard existing / new / immediate | 14.9 / 22.0 / 14.0 | 4.6 / 5.2 / 3.8 |
| gesture creator discard existing | 10.8 | 4.0 |
| Local scene creator discard | 22.4 | 10.1 |
| generated Gesture round trip | 33.2 | 11.1 |
| 1.0 Gesture / Reaction saves as 2.0 | 24.5 / 23.7 | 10.8 / 10.2 |
| imported playback: every content kind | 277.4 | 81.8 |
| imported playback: complete Anima `@complete-anima` | 513.6 | 203.8 |
| selection, Stop and persisted reply | 9.8 | 2.5 |
| Scene JSON import, preview, save | 21.7 | 4.7 |
| scene / avatar / particle Save reachable | 13.2 / 19.3 / 16.6 | 1.4 / 2.3 / 1.9 |
| Library smoke | 1.7 | 0.7 |
| built-in pose playback | 6.0 | 3.0 |
| SFX volume numeric input | 25.3 | 7.6 |
| pose content: Included discovery | 13.2 | 4.6 |
| pose content: Local save, edit, reopen | 73.6 | 17.6 |
| pose content: failed detail load recovery | 13.8 | 9.3 |
| pose content: load panels and sidebars | 33.8 | 6.0 |
| vfx guides keep Eye = playing | 29.0 (failed) | 14.2 |
| vfx guides preserve authored JSON | 38.1 | 3.7 |
| vfx guides Particle Avatar and Outline | 11.1 | 2.6 |
| loadout scene fills viewport | 10.1 | 2.5 |
| scene creator fills viewport | 16.7 | 2.7 |
| **Summed test time** | **1,939** | **644** |

Other checks at `3107c7d2` (Phase 3), before the merge of `main`:

- From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test` (395 files,
  2,957 tests), `pnpm e2e:test:unit`, `node --test scripts/e2e/*.test.mjs` and
  `pnpm e2e:check`. All pass.
- From the root: `uv run ruff check` passes. `uv run pytest -q`: 3,159 passed,
  10 skipped, with one test deselected. That test,
  `tests/test_desktop_runtime_packaging.py::test_runtime_resource_audit_has_schema_and_starter_resources`
  ("Packaged gruut phonemizer produced no lip-sync phonemes"), fails identically
  on `main`.
- `make check-test` fails at mypy on four errors in
  `src/backend/animama/app/services/idle_clip_validation.py`, a file this branch does not touch. The
  same errors occur on `main`.

## Final integration review

Reviewed `a982924e` plus the Phase 4 plan update against the issue's full
acceptance list and both scope comments, reusing the phase evidence.
Cross-phase checks found no defects:

- Every creator mutation guard is attached after Annie is selected.
- The watcher default and the docs agree for built and development stacks.
- The plan, the journey guide and the development guide give consistent numbers.
- The merge of `main` touched nothing in scope.

Findings (review #1):

- F1 (required): Phase 1 row 4 still recorded failure 4 as "No change", while
  Phase 3 fixed it.
- F2 (optional): the optional OrbStack memory note was absent.
- F3 (optional): the built-stack guidance was missing from the development
  guide's parallel-stack section.
- F4 (optional): one path in the plan was not repository-relative.

Revisions: all accepted. Row 4 now records the cause and the Phase 3 fix, with
the reproduction run named. The journey guide gained the memory-limit sentence.
The development guide points to built stacks for journeys. The path is fixed.

Review #2 (targeted): pass, including the anchor link. One repair round remains.

## Validation and acceptance

Acceptance follows the issue's list. Local evidence only: hosted Validation is
disabled. The raw run evidence stays in ignored `.animama-e2e/runs/`; this plan
records the summaries.

## Idempotence and recovery

Journeys run only on disposable named stacks. The runner's exact content ledger
owns cleanup; `pnpm e2e:cleanup -- RUN_ID` recovers an interrupted run. The
watcher default covers development reload, Vite and the Local content watcher in
both development and built Compose. Set `ANIMAMA_FILE_WATCH_POLLING=true` and
recreate the stack to restore polling on hosts without bind-mount file events.

## Outcomes & Retrospective

- **Speed:** the suite went from 32.4 minutes with 3 failures to 10.8 minutes with
  all 35 passing. The fast subset (`pnpm e2e:test:fast`) takes about 5 minutes.
  The largest gains came from serving the built application (25.0 → 10.5
  minutes, both with Metal) and from GPU WebGL on macOS. Narrowing the watchers
  freed about one CPU core per idle development stack.
- **Failures:** every one of the eight issue-listed failures has a recorded root
  cause and a fix in its proper place. One further timing race (pose Insert)
  surfaced only once the suite ran faster.
- **Optional OrbStack memory note:** added to the journey guide as a safety
  margin for several parallel stacks, not as the fix.
- **Follow-ups:**
  - #330: server-side content rescan and journal cost. It is now most of the full
    suite, and development stacks pay about 3 times more than built ones.
  - #332 (merged): Included clip globs no longer bundle review sidecars.
- **Lesson:** speeding a suite up exposes hidden ordering and timing assumptions.
  Rerun at the new speed before declaring a fix complete.
