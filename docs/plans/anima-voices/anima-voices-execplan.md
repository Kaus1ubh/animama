# Named PocketTTS voices in Anima Loadout

Source agreement: owner follow-up on 2026-09-28 to issue [#194](https://github.com/raymond-van/animama/issues/194).
Authorized scope: Phases 1 and 2 below, on the existing `feat/anima-loadout-voices` branch and PR #195.

## Purpose and context

Keep TTS Provider as a label and right-aligned dropdown above the selected
provider's borderless controls. PocketTTS has a distinct Voice Cloning section
where the installation owner can save multiple named clones, reuse them across
Animas, and retain their original recordings. Clones survive reload and runtime
restart. The provider choice preserves each provider's voice configuration.

The existing temporary `custom` voice has one browser-session slot and does not
retain source audio. `catalog-builder.ts` can already serialize a reusable
Pocket catalog containing a `neutral` embedding. Typed Local Voice content and
the single voice loadout binding already provide ownership, durable identity,
optimistic writes, registered bytes and deletion reference checks. Use these
contracts rather than a new database or browser-persistent library.

## Progress

- [x] Inspect current upload, content storage, loadout and playback paths.
- [x] Implement provider-specific borderless layout and focused tests.
- [x] Phase 1: durable named clone authoring, selection and playback.
- [x] Independent review, browser validation and final integration review.
- [x] Commit and hand off through the existing PR #195; exact candidate lives in
  the PR's compact revision reference. Owner merge approval remains pending.

## Surprises & Discoveries

- The old upload discards the encoded embedding and the original after populating
  one global `custom` slot. A saved `custom` preference is not durable identity.
- Voice content can be equipped but has no runtime projection yet. The legacy
  `pocket_voice_catalog_url` response field is not populated by the current mapper.
- The worker gives an Anima catalog precedence over a preset and strips query
  strings from its cache key. Mount-owned Blob URLs provide fresh identity;
  selecting a preset must remove the clone binding.
- The task's existing development stack is in use. Preserve its data and settings;
  use task-only fixtures for validation and never purge the stack.

## Decision Log

- 2026-09-28, owner: provider selector sits outside cards; show only the selected
  provider's controls; PocketTTS has Voice Cloning and named multiple uploads.
- 2026-09-28, owner-confirmed choice: shared installation-owner Local Voice
  library, retaining the original recording and an encoded neutral catalog.
  This uses existing content and loadout ownership contracts. The owner explicitly
  selected the shared library with retained samples in the follow-up question.
- 2026-09-28, implementation choice: saving a clone and equipping it are separate
  operations. Failed equip leaves the saved clone reusable and reports the error.
  In-use deletion remains blocked until the clone is unequipped.
- No new Alembic revision, database table, vendored Pocket core change, paid
  provider call, hosted workflow change or merge is part of this work.

## Phased implementation

### Phase 1: durable named clones and selected-provider controls

Issue: #194. Starting source: `a31cc5a78a3c3b4ddb5cc755cd3ceb226fd89f32`.
Dependencies: existing accountless owner, typed content Save/Preview/Delete,
voice loadout plan/commit, runtime mounting, pinned Pocket encoder assets.

1. Keep the new provider layout and conditional controls. Preserve settings for
   hidden providers, including TTS-off editing and honest Browser inheritance.
2. Represent a clone with a versioned Voice descriptor, stable identity, name,
   original audio file and `neutral` Pocket catalog. Bound and validate source
   audio/catalog admission through existing typed content handlers. Retain
   encoder-format provenance. Reuse revision checks and ownership checks.
3. Add a voice runtime projection for the selected catalog. Prepare and verify
   catalog bytes during mount; use the mount-owned resource in Pocket playback.
   Keep original recordings in library authoring/preview, outside executable
   runtime files. A clone selection is an existing voice binding; selecting a
   preset removes that binding. Never silently play a different clone.
4. Add owner-scoped query/mutation helpers and a compact Voice Cloning editor:
   name and sample upload, saved named clones, original sample preview, select,
   rename and delete. Keep draft/error state on failed saves. Encode once locally,
   save exact original bytes and the encoded file, and distinguish save/equip errors.
5. Regenerate the API SDK offline for additive runtime contracts. Update voice
   and content documentation where current guidance would otherwise mislead.

Completion requires focused backend ownership/admission/runtime tests, frontend
selection/persistence/preview tests, applicable lint/type/build checks, independent
review, and browser checks at desktop and narrow widths. Browser verification
covers two named clones, source retention, rename, reload, per-Anima selection,
preset restoration, protected in-use deletion, and clone playback from persisted
bytes after a fresh runtime. Use a synthetic audio fixture where possible.
Human judgment of voice fidelity and native packaged acceptance remain owner gates.

Phase commit: `feat(voice)[p1]: save reusable named PocketTTS clones` (the commit
containing this completed phase record).

#### Code Review #1 Findings

Independent backend analysis reviewed the complete working-tree backend delta
from the starting revision, including new parser/admission and regression tests:
no actionable findings. Frontend analysis covered UI, library mutations,
selection/invalidation and mounted playback. One confirmed required finding:

- CR1-F1: real typed Voice responses include a descriptor file alongside the
  source and catalog. Rename required exactly two returned files, so every real
  saved clone was rejected. Browser/API evidence exposed this difference from
  the original test fixture.

Earlier presentation-only findings remain resolved; this review is the new
durable storage and playback scope.

#### Code Review #1 Revisions

CR1-F1 accepted and fixed: rename filters the two companion roles, preserving the
descriptor as metadata instead of fetching/uploading it as a companion. The
three-file response regression failed before the fix and passed afterward;
14 affected helper/invalidation tests and targeted ESLint passed. Independent
targeted source recheck confirmed the fix. One repair round used, one remains.

## Final integration review

Passed against the final working tree and issue #194, reusing valid evidence for
unchanged preset filtering, source samples, starter defaults and provider settings.
Independent backend analysis and frontend analysis found no remaining required
fixes after CR1-F1. Final integration accepted combined selection, retention,
provider display, playback and cleanup evidence. The final wrapping format-hint
adjustment was reviewed and its affected checks/build refreshed. One phase repair
round used; no integration repair round. Owner acceptance/merge remain pending.

## Validation and acceptance

Checks run against the final Phase 1 working tree:

- Backend focused admission/CRUD/runtime/parser group: 115 checks passed;
  the final affected group after preserving generic voice limits: 58 passed.
  Ruff/format, import-boundary and typed-content audits passed. Final full mypy:
  no issues in 560 source files after fixing a test-only return annotation.
- Runtime frontend: 58 tests passed across five affected files. Library helpers:
  18 tests passed; invalidation follow-up: 13 passed. UI/player: 19 passed.
- Final combined frontend run: 142 tests across 17 files passed. `pnpm lint`,
  30 authored TypeScript file Prettier checks, `pnpm build:source` and
  `pnpm check:source` passed. After moving the truncated format/limit hint into
  wrapping text, 12 UI tests, targeted lint/format and production build passed.
  Generated SDK and public packages built successfully. The existing large-chunk
  build advisory remains.
- Browser saved two synthetic named clones independently of the current voice.
  Registered-byte reads confirmed both original recordings exactly match all
  144,044 uploaded bytes. Selecting a clone and reloading retained selection;
  its original sample reached playback through the selected voice button.
  Rename completed in the UI and retained exact source bytes; the library was
  visible to both Animas without changing the second Anima's selection. Provider
  switching showed only the selected provider while preserving both configurations.
  Selecting a second clone worked; selecting Eve removed the catalog binding.
  In-use Delete returned `409 catalog_item_in_use`; deletion succeeded after
  unequipping. Desktop 1280×900 and narrow 390×844 layouts passed, with viewport
  override reset afterward.
- A fresh browser page prepared a persisted clone catalog as a verified Blob and
  generated five audio chunks through the real guarded Pocket runtime. The test
  used a synthetic three-second source, so it establishes persistence/processing,
  not voice fidelity. A temporary development probe avoided paid chat/provider
  calls and was removed completely before final checks. The two task-only clones
  were archived and removed; the three modified voice preference fields were
  restored with concurrency guards. The owner's existing Anima was left unchanged.
- Rebuilding shared frontend packages briefly left the running development tab
  with stale/missing compiled artifacts. A completed package rebuild and reload
  resolved this; the final browser flow passed on the current artifacts.

Exact backend test command from the repository root:

```bash
.venv/bin/python -m pytest -q tests/test_pocket_voice_content.py tests/test_pocket_voice_catalog.py tests/test_content_audio.py tests/test_anima_voice_catalog_api.py tests/test_content_save_service.py tests/test_content_type_handlers.py tests/test_typed_content_apis.py tests/test_anima_runtime_closure.py tests/test_anima_runtime_delivery.py tests/test_anima_runtime_json_bundle.py tests/test_anima_runtime_item_admission.py --tb=short --disable-warnings
.venv/bin/python -m pytest -q tests/test_pocket_voice_content.py tests/test_content_type_handlers.py --tb=short --disable-warnings -k 'not library_retains'
.venv/bin/python -m ruff check src/backend/animama tests
.venv/bin/python -m ruff format --check src/backend/animama tests
.venv/bin/python -m mypy src/backend/animama tests --exclude web-ui --exclude deprecated --exclude templates
bash scripts/audit-typed-content.sh
.venv/bin/python scripts/repository-boundary/check-python-imports.py
```

Results respectively: 115 passed; 58 passed/1 deselected; Ruff clean; 560 files
formatted; 560 files type-clean; typed-content audit passed; zero forbidden
imports. The full backend suite was not rerun.

Exact combined frontend test command from `src/frontend/web`:

```bash
pnpm exec vitest run src/ui/animas/VoiceLoadoutSection.test.tsx src/lib/speech/pocket/voice-sample-player.test.ts src/hooks/use-pocket-tts-runtime.test.ts src/lib/runtime-content/RuntimeMountPreparer.test.ts src/lib/speech/pocket/anima-voice-selection.test.ts src/lib/speech/pocket/voice-clones.test.ts src/query/mutations/useVoiceCloneActions.test.ts src/query/mutations/useVoiceSelection.test.ts src/query/contentCatalogInvalidation.test.ts src/query/animaLoadoutInvalidation.test.ts src/lib/settings/preferences.test.ts tests/speech/pocketVoiceFallback.test.ts tests/speech/pocketVoiceCatalog.test.ts tests/speech/pocketRuntime.test.ts tests/speech/pocketVoiceDownloads.test.ts src/ui/main/header/PocketVoiceDownloadIcon.test.tsx src/ui/main/chat/useChatSession.test.ts
```

Hosted Validation remains `disabled_manually` at handoff; local checks are not
hosted CI or an owner-reviewed substitution. No native release or human
voice-quality acceptance is claimed. The earlier preset-download endpoint timeout
remains outside this clone-storage change; successful preset installation was not
retested.

## Idempotence and recovery

Save through existing operation receipts, source transactions and revision checks.
Keep successful clones if selecting them fails; retry selection independently.
Use stable logical identities and new catalog file identities for changed encoded
bytes. Preserve user data across backend reloads. Remove only disposable validation
fixtures, first removing their own loadout references. Do not restore stale snapshots
over concurrently changed owner settings. Keep the worktree and named stack for
owner review; merge needs separate approval of the exact candidate.

## Outcomes & Retrospective

Delivered a shared named clone library with durable originals, encoded catalogs,
provider-specific borderless controls and guarded mounted playback. Reusing typed
content avoided a new database or persistent browser cache. Browser verification
was necessary to expose the descriptor-member rename bug missed by the initial
two-file mock. The existing development stack remains running for owner review at
`http://animama-voices.localhost:8580`; task checkout/branch are retained through
PR #195. No merge or release approval is implied.

## Phase 2: choose a voice during creation

Owner-authorized follow-up on 2026-09-28, tracked in [issue #196](https://github.com/raymond-van/animama/issues/196). Starting revision:
`678a58d2d57ae5864e307093f7446288679bee96`, clean working tree, same task
checkout and branch. The existing development stack is retained.

The wizard becomes Avatar → Voice → Identity → Actions → Review. Voice reuses
Loadout's Pocket picker and named clone library, including previews and retained
samples. It exposes an explicit PocketTTS/ElevenLabs provider choice, shows the
selected provider's controls, and preserves both configurations while switching.
New drafts seed their voice from application preferences; unsupported/session-only
Pocket choices fall back to Eve. Review summarizes the selected voice.

A strict additive creation voice field saves preferences and a pinned shared
clone binding in the existing creation transaction. Clone ownership, kind, revision,
codec and dependencies use existing catalog admission. Selecting a clone in the
wizard changes only the draft; saving a new clone explicitly adds it to the shared
library even if creation is cancelled. Creation must not call a speech provider.

Saved four-step drafts migrate without losing edits. Frozen pending creation
requests retain their original payload/key, and legacy server receipt hashes stay
unchanged when the new voice field is omitted. Explicit new choices participate
in validation and idempotency hashing.

- [x] Add backend atomic creation voice contract, admission and persistence.
- [x] Add reusable Voice step, draft migration, validation and Review summary.
- [x] Verify meaningful regression tests, static checks and desktop/narrow browser flows.
- [ ] Review, commit and update PR #195 with evidence and remaining owner gates.

Validation targets: creation contract/service tests (preset, clone, stale/foreign
source, rollback, receipt replay); wizard tests (step order, both provider drafts,
shared clone selection, legacy migration and exact retry); scoped type/lint/build
checks; desktop browser creation and narrower layout. Existing Phase 1 voice tests
cover clone encoding/retention, so the creation phase verifies reuse and binding.
No native packaged or human voice-fidelity acceptance is implied.

This side conversation explicitly prohibits subagents. Perform a focused local
self-review; record independent review as outstanding rather than claiming the
usual delegated review gate passed. The owner requested commit, push, merge and
task cleanup on 2026-09-28; outstanding validation gates are recorded below.


### Phase 2 verification and integration handoff

The creation commit integrates the completed shared-control refinements to
`VoiceCloneLibrary`, `PocketVoicePicker`, `VoiceLoadoutSection` and clone naming.
The original editor task is idle and reported 37 focused tests, lint, formatting,
browser checks and independent review without findings for those refinements.
Its full build was blocked by creation work still in progress; the final combined
build below passes. Optional clone names default to the recording filename,
deletion sits beside Play, and the duplicate clone list and rename controls are
removed. The creation-only shared-library explanation was removed at owner request.

Local verification:

- Backend: `tests/test_anima_creation_voice.py`, `tests/test_anima_creation.py`,
  `tests/test_shared_backend_boundary.py`, `tests/test_pocket_voice_content.py`:
  69 passed. New coverage includes both providers, preset/clone persistence,
  foreign/stale sources, invalid preset/ElevenLabs ID, rollback after binding,
  shared-original retention and legacy receipt hashing.
- Frontend: `src/ui/create-anima`, `src/query/hooks/useAnimaCreation.test.ts`,
  `src/ui/animas/VoiceLoadoutSection.test.tsx`,
  `src/lib/speech/pocket/voice-clones.test.ts`: 129 passed. After final local typing
  and test cleanup, the three affected draft/voice/storage files passed 45 tests.
  After removing the creation explanation, the complete 129-test group passed
  again, with targeted ESLint and Prettier checks for the Voice step.
- `pnpm build` passed (the existing chunk-size warning remains); web TypeScript
  ran through that build. `pnpm web:lint` passed. Backend mypy passed all 561
  source/test files. Scoped Ruff and formatting checks passed.
- SDK regenerated offline and public package artifacts built. The additional
  Pocket preset resource is checked against `scripts/voices/selection.json` by
  the existing shared-catalog boundary test.
- Browser at the existing development origin: Avatar → Voice → Identity → Actions
  → Review; both provider drafts survive switching; Review displays PocketTTS ·
  Azelma; reload resumes the draft; desktop and 820px layouts checked. No sample
  fidelity or new clone upload/encoding acceptance is claimed by this phase.
- Automatic approval review initially blocked the final browser Create action.
  The owner then explicitly approved creating **Voice creation QA**. Creation
  succeeded, opened its chat without sending a message, and its Loadout displayed
  PocketTTS with Azelma. A read of its saved speech settings also confirmed the
  inactive ElevenLabs ID `creation-qa-voice`. The approved test Anima remains at
  `http://animama-voices.localhost:8580/a/animas/anima-c708a59dcfcf483980955e1624964e3e`.
  No existing Anima or clone was edited or removed.

### Phase 2 self-review findings and revisions

The side-conversation boundary prohibits subagents. The code-review skill explicitly
says a self-review cannot satisfy an independent review gate. Independent review is
therefore outstanding, not passed; Phase 2 is not marked fully complete. No hosted
CI result, native packaged acceptance or merge is claimed.

Self-review checked request hashing/replay, old schema migration, source ownership
and transaction boundaries, selected-provider rendering, busy/navigation handling,
and integration with the existing shared controls. During implementation, explicit
clone reselection was made to clear its old evidence so refreshed revisions can be
accepted; source repair also updates the draft clone reference. The five-step nav
was adjusted after the desktop browser check showed crowded horizontal labels.
Compiler-detected union narrowing errors and test lint findings were fixed, with
checks refreshed. No known unresolved implementation defect remains from this
self-review. The owner requested the combined commit and PR update followed by
merge and cleanup. Independent creation/final integration review remains pending,
and GitHub's `Validation` workflow remains disabled with no check on the candidate.
These are disclosed merge gates; no exception or passing hosted result is claimed.
