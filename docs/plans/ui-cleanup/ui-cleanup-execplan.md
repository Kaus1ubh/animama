# UI cleanup follow-up

Source agreement: owner request on 2026-09-20; issue #31 and PR #32.
Authorized scope: all four requested follow-ups on existing chore/ui-copy-cleanup,
starting at b49bf601c79cab80191f1194e309cb9843954496. Retain the task stack.

## Purpose and context

Replace camera cycling with preset selection. Hide healthy content status and
show actionable diagnostics with Retry scan only when attention is needed.
Propagate detected catalog changes to cached Library/Appearance rows. Remove
obsolete built-in Avatar seeds and safely reconcile unreferenced obsolete rows;
preserve valid models and existing Anima references. Show Avatar-owned generated
portraits and consistent primary creation actions.

## Phase 1: integrated follow-up

1. Inspect catalog watcher/query boundaries, model seeds and all Avatar references.
2. Update camera and Library presentation using existing selectors and protected
   portrait delivery. Preserve unique descriptions and functional controls.
3. Make content health an attention-only popover; refresh owner-scoped derived
   queries on semantic catalog changes, ignoring scan timestamps.
4. Remove known obsolete seeds; apply narrowly scoped reference-safe reconciliation
   through existing startup/bootstrap paths. Never purge or mutate the main stack.
5. Run focused behavior tests for query refresh, health recovery and Avatar
   retention/deletion, plus web type/lint/build checks and backend checks relevant
   to changed persistence. Verify the current isolated stack in a browser.
6. Independent code review plus delegated checks, at most two repair rounds.
   Commit, push and update PR #32; owner browser acceptance/merge remain separate.

## Validation and recovery

Use synthetic test fixtures and the task-owned stack. Verify healthy silence,
affected-item details, retry error/recovery, and automatic visible row updates.
Check referenced obsolete avatars survive, valid/custom avatars survive, obsolete
unreferenced rows disappear, and fresh seeds omit removed models. No schema change
or migration revision is intended. Restore test-only content after watcher probes.
If reconciliation is unsafe, preserve the row and report why rather than cascade.
Revert the task commit for code recovery; keep stack data and services for review.

## Progress

- [x] Verified clean task branch at the prior PR candidate; inspected query gap.
- [x] Implementation and focused validation.
- [x] Independent review passed; commit and PR update prepared.
- [ ] Owner browser acceptance (separate from agent completion).

## Surprises & discoveries

Health polls every 15 seconds but typed Library queries do not refresh with it.

## Decision log

- Keep this work on the existing PR and stack, per owner request.
- Compare catalog content, not scan timestamps, to avoid background refetch churn.
- Never delete referenced stale Avatar records merely to hide obsolete Library rows.

## Code Review #1 Findings

FR1-1: initial portrait lookup covered only Included portraits and could associate
a Local model by a matching basename. Accepted: generated Local portraits now
carry exact presentation.avatar_item_id metadata; catalog lookup uses owner-visible
valid exact associations, with basename fallback restricted to Included models.
No other actionable findings in the follow-up scope.

## Code Review #1 Revisions

FR1-1 fixed and targeted independent recheck passed. One repair round used;
no unresolved findings. Tests cover Local associations, basename collisions,
private/invalid portraits and persisted generated metadata.

## Outcomes & retrospective

Local evidence:

- `pnpm web:check`, `pnpm web:lint`, changed-file Prettier checks: passed.
- Focused Vitest health/camera/invalidation/library/setup suites: 40 tests passed
  in 7 files. Invalidation tests first reproduced stale rows, then passed.
- `source ../../.animama-stack.env && pnpm build`: passed; existing chunk-size
  warning only. No API schema changes or SDK regeneration.
- Backend focused Avatar/bootstrap/portrait replay suites: 21 tests passed;
  affected Ruff lint and format checks passed.
- `git diff --check`: passed.
- Named development stack: animama-ui-cleanup-7d93, loopback application port
  8200, private backend/Postgres, no optional profiles. Before seed cleanup:
  7 obsolete rows, 0 Anima references, 0 upload references. After: 2 valid Avatar
  rows, 0 obsolete rows. Only this task stack was changed.
- Browser: Avatar portraits and Create Anima verified; camera switched directly
  Full body -> Portrait -> Full body. Profile and Background modals show no
  healthy scan control. Synthetic Scene FX appeared automatically after a host
  edit; invalidating its schema removed its row and exposed diagnostic details.
  Retry scan after correction restored the row and hid the indicator. Synthetic
  files and their three catalog records were removed after verification.

Independent source review and delegated checks passed. Owner browser acceptance
and exact-candidate merge approval remain pending. No full backend suite, native
Electron/audio acceptance or main-stack data mutation. Hosted results are reported
separately on PR #32. Existing pre-association Local portraits fall back to the
icon until regenerated; ambiguous basename matching is intentionally avoided.
