# Named PocketTTS voices in Anima Loadout

Source agreement: owner follow-up on 2026-09-28 to issue [#194](https://github.com/raymond-van/animama/issues/194).
Authorized scope: the complete phase below, on the existing `feat/anima-loadout-voices` branch and PR #195.

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
