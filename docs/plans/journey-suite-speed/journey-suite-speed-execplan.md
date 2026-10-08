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
- [ ] Phase 2: development watchers narrowed and measured.
- [ ] Phase 3: serving mode and render path measured; routine command documented.
- [ ] Phase 4: full suite passes on a fresh disposable stack; final review.

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
| 4 | imported playback | Environment and timing: passed in the baseline (277 s); the earlier failures ran with five stacks up. | No change. Recheck in the final run. |
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

- Pass `reload_dirs` for the backend package and reload excludes through
  `serve()`, used by both the Compose and native development entrypoints. Keep
  `tests/test_local_http_wiring.py` and `tests/test_compose_network_boundaries.py`
  passing.
- Make polling opt-in (`ANIMAMA_FILE_WATCH_POLLING`, default off) for both the
  backend reloader and Vite, since OrbStack, Docker Desktop's VirtioFS and Linux
  deliver file events. Keep an explicit opt-in for hosts that do not.
- Add Vite `server.watch.ignored` entries for generated and review-output folders.
- Measure backend and web container CPU and memory, idle and during a journey,
  before and after.

### Phase 3: Serving mode, render path and routine command

- Run the suite on a built stack (`ANIMAMA_WEB_BUILD_MODE=production`) and
  compare it with the development baseline.
- Measure GPU-backed headless Chromium against SwiftShader on the heaviest render
  journey, and adopt it only if it is reliable.
- Document the routine full-suite command, its expected duration, and when agents
  should choose built or development stacks, in
  `docs/frontend/testing/browser-journeys.md`. Add a fast subset only if it fits
  existing tags.

### Phase 4: Full run and final review

Run the complete suite on a fresh disposable stack of the documented kind and
record per-test durations next to the baseline. Then run the final integration
review.

## Final integration review

Pending.

## Validation and acceptance

Acceptance follows the issue's list. Local evidence only: hosted Validation is
disabled. The raw run evidence stays in ignored `.animama-e2e/runs/`; this plan
records the summaries.

## Idempotence and recovery

Journeys run only on disposable named stacks. The runner's exact content ledger
owns cleanup; `pnpm e2e:cleanup -- RUN_ID` recovers an interrupted run. Watcher
changes affect development reload only; set `ANIMAMA_FILE_WATCH_POLLING=1` to
restore polling on hosts without file events.

## Outcomes & Retrospective

Pending.
