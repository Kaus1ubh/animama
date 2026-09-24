# Discard creator drafts permanently

Source agreement: the owner's 2026-09-24 report and authorization to reproduce and
fix discarded Avatar/Scene settings returning on a later edit, and investigate
other creators. Reuse `feat/vfx-creator-polish` at starting source `82d9c34`.
Keep commits and validation notes local; do not publish issues, push or open a PR.

## Purpose and context

Explicit **Discard and continue** must remove the current unsaved document's
browser recovery as well as leave its workspace. Reopening an existing item must
load its saved definition; opening New after discarding a new draft must start
with defaults. Saving and Library previews remain unchanged. Recovery following
reload/crash or an interrupted Save remains available unless explicitly discarded.

Avatar/Scene creators persist recovery after a 350ms debounce, but their leave
buttons only resolve navigation. Their save hooks prefer recovery over catalog
hydration. Gesture/Reaction has the same mismatch with localStorage recovery.
Particle writes recovery during Save, so its matching defect requires a failed or
interrupted Save. These stores are scoped by owner and route item identity.

Source boundaries are the Avatar/Scene creator pages and save hooks, Action editor
page, Particle page/save hook, and narrow shared recovery lifecycle support. The
recovery write and deletion order must be deterministic, including writes already
awaiting IndexedDB. Generated routes/clients, content definitions and backend
storage contracts are out of scope. Preserve concurrent work in this task branch.

## Progress

- [x] Inspect discard, hydration and recovery ownership across creators.
- [x] Reproduce Avatar/Scene existing-item resurrection in production browser.
- [x] Implement explicit discard, race protection and precise busy-operation copy.
- [x] Validate same/new/other-item navigation, crash recovery and affected creators.
- [x] Independent bounded review, local commit and evidence handoff.

## Surprises & Discoveries

- Browser run `run-0924144838` reproduced the changed name returning after discard
  for Included Avatar `Eye =` and Scene `Kawaii`; catalog/mutation guards stayed
  clean. New-draft-to-Included navigation passed for both, so a cross-key collision
  is not established. Revisit-New coverage tests whether its own draft remains.
- Local Scene reproduced the same defect in `run-0924145931`, using a newly saved,
  ledger-owned fixture. Its saved revision remained unchanged and exact cleanup
  restored the catalog.
- Included Gesture did not reproduce: its copy has no active Local item identity,
  so restoration rejects the recovery payload for the Included route. Local Action
  recovery has matching identities. Local Gesture reproduced the resurrection in
  `run-0924150602`; the owned fixture was deleted and its catalog restored.
- Gesture/Reaction persists dirty edit recovery; Particle persists only during
  attempted Save. Pose has no matching durable draft resurrection, and Music/Idle
  expose no explicit discard flow. Their exact-route failed-save recovery remains
  intentional. Create Anima already clears recovery on explicit discard.
- Existing recovery deletion helpers swallow storage failures. Explicit discard
  needs a narrow strict-clear path so it does not navigate after a failed delete.

## Decision Log

- 2026-09-24, owner: investigate both reported paths and fix affected creators.
- 2026-09-24, implementation: clear only the selected draft; never purge all browser
  data. Fence old timers/restores and drain outstanding writes before deletion.
- 2026-09-24, implementation: busy operations retain recovery, with a truthful
  **Leave and keep recovery** action. This change does not cancel an admitted Save.

## Phased implementation

### Phase 1: Correct discard and recovery boundaries

Starting revision `82d9c34`; whole phase authorized. Tracker publication remains
withheld by owner instruction. No separate product decision is required.

1. Reproduce existing edit/discard/reopen and new/discard/reopen paths through real
   Library navigation. Compare portable documents and canonical catalog data.
2. Add a narrow recovery lifetime/write barrier for asynchronous Avatar/Scene
   storage. Stop future work synchronously, invalidate delayed restores/timers,
   await old writes, then delete the exact owner's route key. Reuse it for explicit
   New/reset boundaries without interrupting legitimate new draft recovery.
3. Await discard before resolving navigation; keep the dialog while deletion runs
   and stay with a useful error if deletion fails. Keep explicit Save-in-progress
   leave behavior distinct. Fix matching Action/Particle paths without broadening
   storage architecture or changing intentional failed-save recovery elsewhere.
4. Cover a late write, delayed restore, quick discard, normal reload recovery,
   current-item reopening, New defaults and cross-item isolation. Use meaningful
   unit ordering tests plus browser behavior; helper-only checks are insufficient.
5. Run local checks and independent analysis/check reviews, then commit only owned
   changes. One initial review and at most two targeted repair rounds apply.

Completion: discarded changes cannot reappear; normal recovery and saving retain
their contracts. No remaining supported code/verification blocker. Owner visual
acceptance, hosted CI and native packaging remain separate.

### Code Review #1 Findings

Independent analysis of the task-owned diff against `82d9c34` found two required
failure-path fixes:

- CR-01 (P2): Action discard sets its autosave fence before localStorage deletion.
  A thrown removal leaves recovery disabled and provides no useful error.
- CR-02 (P2): Particle discard calls best-effort deletion and navigates even when
  browser storage cannot delete its failed-save recovery.

No additional supported findings in Avatar/Scene ordering, restoration fencing or
New/reset fingerprint handoff. Independent checks and browser evidence are recorded
below.

### Code Review #1 Revisions

Both findings accepted. Repair round 1 restores Action recovery eligibility and
shows a retry error on failed deletion; Particle receives strict deletion with
transaction-commit/error handling and a pending/error-aware leave dialog.
Targeted source recheck resolved both findings. Repair rounds used: 1/2.

### Code Review #2 Findings and Revisions

Independent targeted analysis passed CR-01 and CR-02 after repair. No supported
regression in that boundary. Separate review passed the exact-origin preview
preparation allowance added to the test mutation guard. No further revision
required; final integration reuses the completed browser results below.

## Validation and acceptance

From `src/frontend`, run affected recovery/lifecycle/creator unit tests, web and
E2E source typechecks, web lint and changed-file read-only formatting. Build the
owned isolated production stack at port 8620; retain the development stack on 8200.
Use the explicit `accountless-creator-discard.spec.ts` Chromium journey against the
disposable installation. Preserve fixture ownership and compare the catalog before
and after unsaved editor cases. Any created Local fixture must be ledger-owned and
cleaned up through the existing test fixture workflow.

Required observations: Avatar/Scene existing edits discarded and reloaded cleanly;
new drafts discarded and reopened with defaults; no new-to-existing contamination;
representative Gesture/Reaction discard; Particle failed-save discard where
feasible; reload recovery remains usable; clear failure does not falsely navigate.
Report source-confirmed cases separately from browser-confirmed cases. Keep any
unperformed case explicit rather than silently claiming every creator is tested.

### Local evidence

- `pnpm --filter animama-web exec vitest run`: **286 files, 1,660 tests pass**
  (`/tmp/e1d7-discard-web-tests-final.log`). Loopback binding required sandbox
  escalation for existing proxy/server tests. An earlier run without that
  permission produced environmental `listen EPERM` failures.
- The first full run exposed a stale particle-event assertion from `c46d391`,
  already present at base `82d9c34`: it expected catalog duration despite the
  accepted end-with-Action default. Updated only that assertion and test title;
  runtime behavior is unchanged. Independent history inspection confirmed this.
- Recovery-focused initial integration: seven files, 25 tests pass. Particle's
  strict-delete repair adds five cases; combined full-suite pass includes them.
- Web source typecheck passed after package builds completed. An earlier parallel
  invocation raced a package-output rebuild and was not valid typecheck evidence.
- Independent checks passed: web source typecheck, E2E source typecheck, full
  `pnpm web:lint` (zero warnings), changed TS/TSX Prettier, and `git diff --check`.
  The Scene manual's unrelated nested-list formatting mismatch also exists at the
  base revision; the new recovery paragraph introduces none.
- `pnpm e2e:test:unit`: 16 pass. This includes the exact-origin batch preview
  endpoint allowance required by Local Action previews and rejection of wrong
  origins, methods and adjacent writes. E2E typecheck/formatting reran after that
  harness change.
- Production build/reset passed on owned `animama-guides-e1d7` at
  `http://animama-guides-e1d7.localhost:8620` with `ANIMAMA_LLM_SKIP=1`; only FastAPI
  publishes loopback port 8620, PostgreSQL remains private, optional profiles off.
  The HMR development stack remains at `http://animama-vfx-e1d7.localhost:8200`.
- Production Local Gesture journey `run-0924151132`: **3/3 including setup**.
  Covers normal discard/reopen and injected storage deletion failure, Stay/edit,
  reload recovery, successful retry/discard and reopening the exact saved JSON.
  Saved revisions stayed unchanged; both ledger-owned fixtures were deleted and
  the catalog restored. The earlier combined run exposed test-ledger duplicate
  verification/identity errors, corrected without product changes.
- Production main creator journey `run-0924151236`: **9/9 including setup**.
  Avatar Position Offset and Scene Duration changes return to exact original JSON
  after discard. Avatar reload first retains the changed JSON. New drafts discard
  cleanly, edit Included content without carrying settings, and reopen New with
  defaults. Immediate navigation omits an intentional debounce wait; deterministic
  timer/in-flight-write timing is covered in unit tests. Included Gesture passes.
  Local Scene preserves exact saved JSON/revision and deletes its owned fixture.
  Catalog and mutation guards pass. Together the two runs cover ten product cases.
- Test-only corrections selected the visible Scene field, followed the Included
  copy's legitimate leave confirmation, and used valid fixture-ledger transitions.
  No production code changed after the successful build. E2E source/format checks
  passed on the corrected tests.
- Limits: no separate Reaction browser journey or Particle failed-Save browser
  journey. Gesture exercises the shared Action component; Particle's strict
  deletion/failure/retry path is source-reviewed and unit-tested. Hosted CI,
  native desktop packaging and visual/audio fidelity checks were not run.

## Final integration review

Independent final integration verdict: **PASS for the implemented discard-recovery
scope**. CR-01 and CR-02 are resolved; all applicable local checks and ten product
browser scenarios pass. No supported code blocker remains. The limits above stay
explicit. Repair rounds used: 1/2. Deliver as a local phase commit on
`feat/vfx-creator-polish`; no publication authorized.

## Idempotence and recovery

Deletion is exact-owner/exact-document only. Do not clear unrelated drafts, Local
content, shared storage or stack volumes. Canceling the confirmation preserves the
draft. A failed deletion keeps the editor visible for retry. Browser reload/crash
recovery is not an implicit discard. Retry storage work safely; late writes must
not recreate an explicitly deleted draft. Preserve unrelated Git work and stage
only this fix's files/hunks. No external tracker writes are authorized.

## Outcomes & Retrospective

Avatar/Scene and Local Gesture resurrection was reproduced and fixed. The suspected
New-to-existing cross-key collision was not reproduced. Explicit discard now
clears the selected recovery record and fences stale work, while reload recovery
and saved catalog content retain their behavior. Local validation passes; no
external issues, comments, pushes or PRs were created.
