# Ship Mixamo-derived motion as non-portable Included content in desktop and hosted builds

Source agreement: [issue #242](https://github.com/raymond-van/animama/issues/242),
Status Agreed, read back at `2026-10-07T21:54:47Z` (snapshot:
[mixamo-built-in-motion-spec.md](mixamo-built-in-motion-spec.md)). Owner
decisions D1–D7 from intent discovery on 2026-10-07.
Authorized scope: the whole plan, authorized by the owner's `/implement` request
on 2026-10-07. Phase 5 stops at owner gates G1–G3; release gate G4 stays outside
the PR.
Starting revision: `d9fc7f91` (`origin/main`, 2026-10-07, after #310's promotion
merged); first planned at `d4f7028f`.
Branch: `feat/mixamo-built-in-motion` (renamed from `docs/mixamo-built-in-motion`).
One branch and one PR for this plan. Parent #242; phases #323 (P1), #324 (P2),
#325 (P3), #326 (P4) and #327 (P5), linked as sub-issues with dependencies.

## Purpose and context

Desktop and hosted users get the 29 former Mixamo starter clips (23 Gestures and
6 idle loops) and one non-default Included Idle Style that pools the loops. All
of them are **non-portable**: usable and playable, but never exported, copied
into Local content or re-imported. Self-host builds, the source repository and
the public package set never contain them. The spec owns behavior and acceptance
(R1–R10); this plan owns delivery.

Commands run from the repository root unless a working directory is stated.
Frontend commands run from `src/frontend`. No Cloud checkout is needed. Private
inputs (Mixamo downloads, conversions, the private inventory and store
credentials) stay outside the repository in owner-only locations. This plan
names them only by placeholder.

### Implementation orientation

Paths are relative to `src/backend/animama/` (backend) or `src/frontend/web/src/`
(frontend) unless stated otherwise. Line numbers are from the starting revision.

| Area | Current entry point and significance |
| --- | --- |
| Included sources | `server/local_runtime.py` `_included_sources` (:118) parses `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON`: 1–8 immutable sources, a leading `core`, and others restricted to `pack_id == "expanded-included-content"`. Roots must be absolute, non-symlink and disjoint from Local and private data. `domain/content_sources.py` `IncludedContentSource` (`mount_id` = `id@version`). Without the variable, a single `content_root/included` is used (Docker self-host). |
| Per-source scan and licences | `adapters/content_store/filesystem_store.py`: one store per mount (:194); `scan` (:576) tags entries with `source_mount_id`; `_license_inventory` (:314) reads **that source's** `licenses/inventory.json`; `_matched_provenance` attaches the first matching rule to each entry. This is where the non-portable derivation belongs. |
| Distribution policy | `runtime/starter_content.py` `starter_inventory` (:97) accepts `distribution` ∈ {absent, `"excluded"`} and rejects other values (:112). Excluded entries are removed from both starter partitions. Used by desktop staging and `animama content audit` (`runtime/cli.py:157`). |
| Desktop content staging | `pnpm desktop:runtime:stage` / `:audit` run `src/frontend/desktop/scripts/runtime/stage.mjs` and `audit.mjs`. `stage.mjs:58–66` calls `src/backend/packaging/desktop/stage_content.py`, which admits only `git ls-files content/included` (tracked-only gate, `starter_content.py:123–129`), writes `runtime/content/included-core` and `pack-inputs/expanded-included-content`, and re-verifies the staged core. `stage.mjs:172–197` writes the runtime manifest; `audit.mjs:171–184` re-audits the core inventory; `before-build.mjs` refuses unaudited stages. `electron-builder.yml` `extraResources` puts `runtime/` outside ASAR. The tracked-only gate is tested in `tests/test_starter_content_closure.py` (:27, :62, :195–227); `src/frontend/desktop/tests/runtime-packaging.test.mjs` covers notices, review and inventory tampering. `desktop:release:scan` (`release-scan.mjs`, `scan-release-candidate.mjs`) expands archives and scans for secrets; it has no hash deny list. |
| Feature packs | `docs/frontend/desktop/feature-packs.md`: downloadable packs are served **publicly** from the release distribution. The Mixamo pack must therefore ship inside the app's runtime, never as a downloadable feature pack. |
| Package export | `app/services/content_package_export.py` `ContentPackageExportService`: `_selection` (:310, roots or `anima_id`), `summarize` (:375), `prepare` (:380), `_capture_and_prepare` (:400, Anima capture including implicit starter bindings), `_verify_sources` (:525), `_write` (:538). Licence fields are copied by `portable_license` (:72). Anima definitions: `app/services/portable_anima_service.py`, `app/contracts/portable_anima.py`. |
| Package import | `app/services/content_package_import.py`, `app/contracts/content_package_import.py`, capabilities in `app/services/content_package_capabilities.py` (`SUPPORTED_CAPABILITIES` :50; an unknown capability is rejected at :199). |
| Typed save | `app/services/content_save_service.py` (`ContentSaveService`) behind `PUT /v1/{kind}/{entry}`. |
| Byte routes | `server/routers/content.py` (content files and preview files) and the Anima runtime-bundle file route. Only the package-export download sets an attachment `Content-Disposition`. |
| Catalog contract | Catalog item models feed `openapi.json`; the frontend client in `src/frontend/packages/runtime-contracts/src/generated` is regenerated with `pnpm openapi-ts` (never hand-edited). New worktrees may need `uv sync --python 3.12.13` first. |
| Starter | `resources/starter-loadout.v1.json` (21 Gestures, 72 Reactions, no Idle Style); `EXPECTED_STARTER_GESTURE_IDS` in `tests/test_starter_content_closure.py` and `tests/anima_creation_service_support.py`. Unchanged by this plan (D2). |
| Catalog view types | Generated `PyGesture`/`PyIdleStyle`/`PyContentItem` reach the UI through `lib/content/catalogTypes.ts`. `typedCatalogViewItem` and `catalogViewItem` spread fields through; `typedComponentCatalogViewItem`, `lib/content/catalogApi.ts` `typedCatalogTransportItem` and `lib/content/typedPreviewAdapters.ts` `typedActionPreview` list fields explicitly and must add the new property. |
| Library | `ui/library/LibraryContentInventory.tsx:195–322` row actions. **Edit** on an Included Gesture or Idle Style is the de facto Customize. Policy: `lib/content/libraryPresentation.ts` `libraryProductActionPolicy` (:79, `edit: Boolean(card.source)`), with card builders `actionLibraryCard` and `idleStyleLibraryCard`. Gestures and Idle Styles show no origin badge (consistent with D5). There is no Library duplicate, delete, `.vrma`/JSON export or copy action for these kinds. |
| Sharing | `ui/library/LibrarySharingDialog.tsx` is the only export entry point. `ContentExportSelection.tsx` (content checkboxes :151–178, Anima picker :76–111); inventory `query/hooks/useSharingInventory.ts` maps rows to `{item_id, name, kind, description}` (`SharingItem` in `lib/content-sharing/types.ts`). Flow `query/hooks/useLibrarySharingFlow.ts` (has a `notice` channel). `query/mutations/packageSharingApi.ts` keeps only the error `code`, so named-item errors need `details` passed through `lib/content-sharing/errors.ts`. `ContentExportReview.tsx` has no slot for omitted items. `SharingPackageDetails.tsx` `SharingAnimaDetails` would render a reference as a raw ID. `ContentImportReview.tsx` has no rebind or fallback field (`ReviewedPackageImport`, `PortableGestureSelection`). |
| Gesture creator | Routes `routes/_app/gestures.$gestureId.edit.tsx` → `ui/gesture-editor/GestureEditorPage.tsx` → `ui/action-editor/ActionEditorPage.tsx`. **`hydrateCatalogAction` (:334–406) loads an Included VRMA's bytes (`loadCreatorPreviewFile`, `setVrma`) into a dirty Local draft (`"__included_copy__"`), and Save (:600–712) uploads them.** The test "loads Included VRMA metadata as a distinct unsaved Local document" (`actionDocumentLoader.test.ts:322`) pins this. Clip Gestures load into the editable `clipDraft` (`actionDocumentLoader.ts` `ownedSequence`/`builtinSequence`). Header (`ActionEditorHeader.tsx`): Load popover "Starter · Customize as new" (:625–770, filtered by `isCustomizableStarterAction`), Save and Save & Equip (`ActionPrimaryActions` :849–886), View JSON / `ActionJsonDialog` (:1102–1194, copy and download), Import (:888–1100), New/Load, Pose and Clip tabs. Browser recovery autosave (`ActionEditorPage.tsx:509–559`) writes the document to `localStorage`. "Save as Local copy" and duplicate are the Save of an Included-hydrated draft. |
| Sampling paths | `ActionEditorWorkspace.tsx` `captureActionEditorPoseAtPlayhead` (:93–123) and `beginInlineKeyframeEdit` (:340–400) sample a clip draft into pose drafts, which `ui/pose-creator/PoseCreatorLibrarySection.tsx` can save, copy or download as a Local Pose. Pose-creator bone reads (`poseCreatorAuthoring.ts:238–260`). There is no VRMA→clip conversion, no live capture from a playing VRMA and no "insert pose from Gesture". `web/scripts/animation-preview.mjs` reads `library:` sources only from `content/included` and a passed Local directory; `animation-save.mjs` reads clip files, not Gesture bytes. |
| Idle Style editor | `ui/creator/IdleStyleEditorPage.tsx` (`isCopy` for duplicates and Included styles :127; "Save Local copy" :604; pools store Gesture logical keys). Duplicate entry: `ui/animas/IdleStyleLoadoutSection.tsx:217–236`. References only, so R4 needs no change beyond tests. |
| Disabled-with-reason patterns | `ActionTooltip` (`LibraryContentInventory.tsx:177–193`, tooltip in grid only; list layout needs visible text), `GestureLoadoutSection.tsx:150–162`, `ActionEditorEffectsPanel.tsx:595–607` (`title`), `CreatorSaveNotice`, and inline notes like `IdleStyleEditorPage.tsx:400–402`. Radix tooltips do not fire on a `disabled` button. |
| Frontend tests | Unit: `LibraryContentInventory.test.tsx`, `libraryPresentation.test.ts`, `LibrarySharingDialog.test.tsx`, `actionDocumentLoader.test.ts`, `ActionEditorHeader.test.ts`, `actionEditorCapabilities.test.ts`, `ActionEditorWorkspace.test.tsx`, `IdleStyleEditorPage.test.tsx`, `packageSharingApi.test.ts`, `importSession.test.ts`, `catalogApi.test.ts`, `typedPreviewAdapters.test.ts`. E2E (`src/frontend/e2e/journeys/`): `accountless-content-sharing.spec.ts`, `accountless-creator-discard.spec.ts`, `accountless-creator-generated-gesture.spec.ts`, `playback-library.spec.ts` and `playback-anima-loadout.spec.ts` (VRMA channel, `being-cocky` fixture). |
| Local installer | `scripts/acquire-mixamo.py` with `scripts/mixamo-assets.json` (71 assets; 29 `starter_target`, each with a `document` descriptor template using `builtin:gesture:<n>` IDs; plus an `idle_style_document` template for the former starter style). `validate_vrma` checks the GLB and `VRMC_vrm_animation`. It installs editable Local content (`tests/test_mixamo_local_install.py`) and stays unchanged. |
| Licence inventory | `content/included/licenses/inventory.json` still has two Mixamo VRMA rules (`gestures/**/*.vrma`, `idle-styles/starter/animations/*.vrma`) that match no tracked file; `tests/test_included_content_integrity.py:25–26` asserts the first exists and is not excluded. `desktop/scripts/runtime/licenses.mjs` builds the redistribution inventory and review packet from licence IDs. |
| R2 pattern | `src/frontend/desktop/scripts/runtime/r2-objects.mjs`: `r2Credentials()` reads `ANIMAMA_R2_ACCOUNT_ID`, `ANIMAMA_R2_ACCESS_KEY_ID` and `ANIMAMA_R2_SECRET_ACCESS_KEY` without printing values; `aws4fetch` signs HEAD (`r2Exists`) and create-only PUT (`r2Writer`). There is no signed GET helper. Credentials come from the command environment or an owner-only file under `~/.config/animama/`. Cloud's own fetcher uses separate read-only credentials and a private-bucket setting; it is not imported here. `common.mjs` `downloadVerified` shows the pinned-hash, `.partial`-then-rename pattern. |
| Ignore rules and images | `.gitignore` and `.dockerignore` each list the 71 former Mixamo paths exactly (no glob). `Dockerfile:18,45` copies `content/included` into the web-builder and server stages, so `.dockerignore` alone keeps the files out of self-host images. `docker-compose.yml:145–149` also bind-mounts `./content/included` read-only at runtime, so ignored files left in a checkout would be served by a self-host stack. The package-set build (`scripts/package-sets/build.py`) snapshots tracked files only; the wheel and npm packages contain no `content/`. No hash deny list exists anywhere. |

## Progress

- [x] Intent discovery with the owner (2026-10-07); spec agreed, #242 updated and
      read back; snapshot refreshed (`e83936a1`).
- [x] Repository surveyed; plan drafted.
- [x] Implementation authorized for the whole plan (`/implement`, 2026-10-07).
- [x] Workspace: branch rebased onto `d9fc7f91`, renamed and pushed; phase issues
      #323–#327 created as sub-issues of #242 with dependencies; #242 links the
      plan. Task stack: started when a phase first needs it.
- [x] Phase 1: Non-portable class in the backend catalog (#323). Review #2 passed.
- [x] Phase 2: Backend export, import and save enforcement (#324). Review #2 passed.
- [ ] Phase 3: Frontend affordances.
- [ ] Phase 4: Private build inputs, staging allowlist and leak checks.
- [ ] Phase 5: Content acquisition and integration (owner gates G1–G3).
- [ ] Final integration review.
- [ ] PR opened. Hosted CI is disabled; local checks are the evidence.
- [ ] Merge approval.
- [ ] Release gate G4 (R10), recorded in the release review before the first
      release containing the pack. This gate is not part of the PR.

## Surprises & Discoveries

- **Multi-source Included content already exists** (2026-10-07). The backend
  mounts up to eight immutable Included sources, each scanned by its own store
  with its own `licenses/inventory.json`. So the Mixamo motion can be a separate,
  privately built Included source instead of files merged into `content/included`.
  The tracked-only gate on `content/included` stays exactly as it is.
- **`distribution` is already an inventory field** (2026-10-07). It accepts only
  `"excluded"` today, and starter staging enforces it. `non-portable` extends an
  existing field instead of adding a parallel one.
- **Runtime rule matching is per entry folder, and descriptors can override it**
  (2026-10-07). The scanner matches the entry locator (for example
  `gestures/wave`), not each file, against the inventory globs. File globs such as
  `gestures/**/*.vrma` never match and fall through to the catch-all. It then
  merges the descriptor's own `provenance` over the matched rule
  (`filesystem_store.py:442–445`, `:544–546`), so a descriptor could set
  `distribution`. Staging (`starter_content.py`) matches per file with
  `fnmatchcase`. Portability must therefore be computed from the Included mount
  plus the rule match, never read from the merged provenance. The pack inventory
  must use rules that match both locators and files.
- **Startup transitions copy Included content into Local** (2026-10-07).
  `ContentTransitionService.convert_idle_styles` (`content_transition_service.py:91`)
  turns an Included v1 Idle Style into a Local style plus Local
  `local:gesture:idle-*` Gestures that reuse its VRMA bytes.
  `IncludedActionTransitionService.convert` (`included_action_transition.py:78`)
  copies Included Gestures and Reactions with a `content_dependency_ref`, and
  Included v2 Idle Styles that depend on them. Both must skip non-portable
  sources, and the shipped Idle Style must be v2 and pool Gesture items.
- **Package graph completeness** (2026-10-07). `PackageManifest.complete_graph`
  (`app/contracts/content_package.py:194`) requires every Anima reference to be
  a package entry, so a bytes-free reference needs a new field in the manifest or
  in `PortableAnima` (`portable_anima.py:60–118`). `portable_json` falls back to
  the original value for unmapped references (`content_package_export.py:88–118`).
  `portable_license` drops `distribution`.
- **Hash lookups** (2026-10-07). The catalog files table has no `sha256` index and
  every scan rehashes all files. The restricted set is built in memory from
  non-portable rows and the tracked manifest. `ContentPackageArchive._validate_entry`
  (`content_package_archive.py:354–415`) already knows every member's SHA-256,
  and `ContentSaveService` has an Avatar SHA-256 dedupe (`content_save_service.py:263–284`)
  to copy.
- **Pre-existing: the implicit starter Idle Style is missing.**
  `AnimaPackageSourceService.capture` (`anima_package_source_service.py:168–169`)
  adds `builtin:idle-style:starter` when an Anima has no idle row and is not
  marked empty. That style is not in the tracked Included tree, so such Animas
  fail export with `package_anima_starter_unavailable`. This is outside this
  plan's scope; P2 records whether it affects the tests and leaves it alone
  otherwise.
- **Feature packs are public downloads** (2026-10-07). The Mixamo source must ship
  inside the desktop runtime, not through the feature-pack catalog.
- **Legacy Mixamo names ship in a tracked catalog** (2026-10-07).
  `src/backend/animama/resources/animation-manifest.json` (a synced copy of
  `src/frontend/web/src/assets/vrm/animations/manifest.json`) lists legacy
  Mixamo-style clip names, `.vrma` filenames and descriptions, with no motion
  data. It ships in the wheel. P4 decides whether it is obsolete and records the
  outcome; names alone are not Mixamo-derived bytes.
- **Ignored copies in a self-host checkout are served** (2026-10-07) through the
  runtime bind mount of `./content/included`. This is pre-existing. The pack never
  lives there (it uses `build-inputs/`), but the P4 leak checks also scan the
  self-host Included mount source.
- **The orientation reports were partly inaccurate.** Several frontend file paths
  and a backend module path they gave do not exist. Every path in this plan was
  checked against the starting revision.

## Decision Log

- 2026-10-07, owner (intent discovery, recorded in #242 as D1–D7): ship all 29
  former starter clips plus a non-default Included Idle Style, Library only;
  omit-and-rebind Anima export; a private prefix in the existing private R2
  bucket that hosted deploy reads; no Library label; the class is named
  `non-portable`; hosted Cloud is assumed to reach parity; R10 gates the first
  release only.
- 2026-10-07, agent (planning; for owner review with this plan):
  - **Delivery as a separate Included source.** The pack mounts as a third source
    (`id: "mixamo-motion"`, `pack_id: "mixamo-motion"`), bundled in the desktop
    runtime and mounted by hosted deploy. Its `licenses/inventory.json` is a
    tracked, public-safe file copied into the staged source. This fulfils R8's
    "public-safe entry in the public licence inventory" in the pack's own
    tracked inventory, not in `content/included/licenses/inventory.json`. The
    two stale Mixamo rules in `content/included/licenses/inventory.json` are
    removed with a pointer to the new inventory and the ADR. The two inventories
    have the same rule format and licence wording.
  - **Restricted-hash deny list everywhere.** The tracked, public-safe manifest
    of pack file SHA-256 hashes ships as a backend resource. Save and import
    reject matching bytes in every build, self-host included, even where the pack
    is not mounted (R5: "wherever it is stored").
  - **Catalog property.** A read-only `portability: "portable" | "non-portable"`
    on catalog items. The backend derives it from an Included source and its
    matching rule, or from a payload hash match. Descriptors never supply it.
  - **Tracked paths and tool.** The public-safe manifest is the backend resource
    `src/backend/animama/resources/mixamo-motion-manifest.json` (one source of
    truth, superseding the earlier synced-copy idea; revised 2026-10-07 in P1).
    The pack's public-safe inventory lives in `scripts/mixamo-motion/`. The ignored
    build-input directory is `build-inputs/mixamo-motion/`, excluded by
    `.gitignore` and `.dockerignore`. The owner tool is a desktop runtime script,
    `src/frontend/desktop/scripts/runtime/mixamo-motion.mjs`, exposed through
    `pnpm` commands. It reuses `r2-objects.mjs`, which gains a signed GET helper,
    so no new storage dependency is added. Hosted deploy fetches with Cloud's own
    tooling against the documented manifest contract.
- 2026-10-07, agent (Phase 1 implementation and review #1):
  - **Portability is persisted as `provenance["distribution"]`**, written by the
    scanner after the descriptor merge (any descriptor value is dropped), instead
    of a new `CatalogContentEntry` field or column. Reconciliation already
    rewrites provenance on every scan, so no schema change or database reset is
    needed. `content_portability.is_non_portable` is the one reader.
  - **Restricted hashes come only from the tracked manifest**, not from rehashing
    mounted entries. Local-only rescans skip Included content, so mount hashes
    would need a full Included rescan or new state. Staging guarantees a mounted
    pack matches the manifest exactly (P4). Consequence until P5 fills the
    manifest: a Local byte copy of a mounted non-portable file is portable; no
    real pack exists before then.
  - **Staging omits non-portable content** from both core and expanded inputs
    (reason `non_portable`) rather than admitting it; the pack is staged as its
    own source in P4.
  - **Rule matching fails closed.** The scanner matches the locator and every
    file case-sensitively (like staging); any non-portable or unrecognised
    distribution on any path restricts the entry.
  - **`portability` defaults to `"portable"` in the response schema** so the
    many existing frontend fixtures stay valid; the server always sets it.

## Phased implementation

Order: P1 → P2 → P3. P4 depends on P1 only and may run before or after P2/P3. P5
depends on P2, P3 and P4. Every phase uses synthetic fixtures. No Mixamo bytes
enter tests, fixtures or commits.

### Phase 1: Non-portable class in the backend catalog

Requirements: R2, part of R5 (hash index) and R9 (shared service). Depends on
nothing.

Intended changes:

1. Accept `"distribution": "non-portable"` in inventory rules. In
   `runtime/starter_content.py`, non-portable entries are omitted from core and
   expanded inputs (reason `non_portable`). Unknown values are still rejected.
2. Allow `pack_id: "mixamo-motion"` in `_included_sources`, keeping `core`
   first and unique IDs. Document the source in the backend operations docs.
3. Derive portability during the scan (`filesystem_store.py`), separately from
   the merged `provenance`. An Included entry is non-portable when its locator,
   or any of its files, matches a non-portable rule in **its own mount's**
   inventory, read before the descriptor's provenance is merged. Local entries
   are portable unless a payload hash matches step 4. A descriptor's
   `provenance.distribution` never changes the result; add a test where a Local
   and an Included descriptor try both directions. Persist the value as
   `provenance["distribution"]` (Decision Log).
4. Add a restricted-hash set from the tracked manifest resource (empty until
   P5), injectable for tests (Decision Log).
5. Add `portability` to `PyContentItem` (`server/schemas/content.py:72`) and
   `PyTypedContentBase` (`server/schemas/typed_content.py:125`, filled by
   `_base()`). Persist it with the catalog row only if reconciliation needs it;
   then update `alembic/versions/0001_baseline.sql` directly, with no new
   revision. Regenerate `openapi.json` and the frontend client offline
   (`pnpm openapi-ts`; `openapi-ts:check` must pass).
6. Make the startup transitions (`convert_idle_styles`,
   `IncludedActionTransitionService.convert`, `ActionClipTransitionService.convert`)
   skip non-portable entries and never copy a non-portable dependency's bytes.

Tests (TDD; synthetic fixture source with a project-authored clip Gesture and a
fake VRMA payload marked non-portable in a fixture inventory):
`tests/test_local_content_store.py` (derivation per source, descriptor cannot
override, Local hash match), `tests/test_included_content_integrity.py`,
`tests/test_starter_content_closure.py` (starter unchanged), and a catalog API
test for the property.

Checks: `uv run pytest -q`, `uv run ruff check`, `make format-check`; from
`src/frontend`: `pnpm openapi-ts` then `pnpm check`.

Completion: the property is visible in the catalog for a mounted fixture source;
starter and integrity tests pass unchanged; review passes.

Results (2026-10-07, starting revision `b3f5ee68`):

- Implemented: `app/services/content_portability.py` (policy, manifest parsing,
  fail-closed rule resolution), `resources/mixamo-motion-manifest.json` (empty),
  scanner derivation in `filesystem_store.py`, `mixamo-motion` pack id
  (`server/local_runtime.py`), staging omission (`runtime/starter_content.py`),
  transition guards (three services), `portability` on `PyContentItem` and
  `PyTypedContentBase`, regenerated client, and docs
  (`docs/backend/architecture/local-content-storage.md`,
  `docs/backend/operations/desktop-runtime.md`,
  `docs/frontend/desktop/runtime-staging.md`).
- Tests: `tests/test_content_portability.py` (new), additions to
  `test_starter_content_closure.py`, `test_included_action_transition.py`
  (whole-source and dependency-only cases; both shown red without their guard)
  and `test_pose_content.py` (typed and catalog API property).
- Checks: `uv run ruff check` and `make format-check` pass; import-boundary
  check 0 forbidden edges; `pnpm openapi-ts:check` current; `pnpm check` pass;
  full `uv run pytest -q`: 3167 passed, 1 failed
  (`test_desktop_runtime_packaging.py::test_runtime_resource_audit_has_schema_and_starter_resources`,
  "Packaged gruut phonemizer produced no lip-sync phonemes"). That test also
  failed on the pre-change baseline in this worktree's fresh environment; it is
  an environment limitation, not caused by this phase.

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer` agent, staged source on `b3f5ee68`.

- **P1-F1 (required):** startup transitions copied a non-portable dependency's
  bytes into Local: Included action → clip (`included_action_transition.py`),
  idle lane owner (`content_transition_service._gesture`) and Local action →
  Included clip (`action_clip_transition.py`). Only top-level items were checked.
- **P1-F2 (required):** the plan contradicted the implementation (storage in
  provenance, manifest-only hashes, staging omission) without Decision Log
  entries.
- **P1-F3 (required):** step 2's documentation was not done; staging docs named
  only `excluded`.
- **P1-F4 (optional):** scanner matching differed from staging (`fnmatch` vs
  `fnmatchcase`, first-match break) and dropped unknown values, failing open.
- **P1-F5 (optional):** missing tests for a v1 Idle Style skip and a Local
  descriptor claiming `portable` on restricted bytes.
- Checks run by the reviewer: `pnpm openapi-ts:check` current; 32 targeted
  tests passed.

#### Code Review #1 Revisions

- **P1-F1 accepted.** Each copy path raises `content_non_portable` (recorded as
  a transition diagnostic) when the motion, lane owner or clip is non-portable.
  New test `test_portable_actions_never_copy_a_non_portable_clip_into_local`
  (red without the guard, green with it).
- **P1-F2 accepted.** Steps 1, 3, 4 and 6 and the Decision Log updated.
- **P1-F3 accepted.** The three docs listed under Results updated.
- **P1-F4 accepted.** Shared `resolve_rule_distribution`: every path's
  first-matching rule (`fnmatchcase`), and any non-portable or unrecognised
  value restricts the entry. Test `test_an_unknown_or_mixed_distribution_fails_closed`.
- **P1-F5 partly accepted.** The Local "claims portable" case was added to
  `test_local_entries_are_restricted_only_by_byte_match`. The v1 Idle Style
  case is deferred: the legacy v1 conversion has no non-portable producer, and
  the guard is the same one-line check that the action tests cover.
- Verification: 42 targeted tests pass (portability, transitions, starter).

#### Code Review #2 Findings

Targeted recheck (repair round 1) by the same reviewer: **pass**. P1-F1 to F5
resolved; no blocking findings. 40 targeted tests and `ruff check` passed.

- **P1-F6 (optional):** the dependency guards raised `content_non_portable`,
  which `record_transition_failure` turns into an INVALID source with a
  misleading "repair" diagnostic; the included-action guard also ran before the
  completed-copy receipt check.

#### Code Review #2 Revisions

- **P1-F6 accepted for the two action paths.** `included_action_transition` and
  `action_clip_transition` now skip (`continue`) a source whose clip is
  non-portable, after the receipt check, so the source stays valid and playable
  as before. The test asserts the Included actions stay VALID with no
  diagnostics. The idle-lane path (`_gesture`) keeps its failure: a legacy v1
  Style with a non-portable lane cannot be converted without copying the bytes.
- Verification: 22 transition tests pass; `ruff check` passes. Repair budget:
  one round remains for this phase.

### Phase 2: Backend export, import and save enforcement

Requirements: R3, R5, R6 (byte routes), R9. Depends on P1.

Intended changes:

1. **Content package export.** `_selection` rejects roots that are non-portable,
   naming the items. Dependency closure never includes a non-portable item. A
   portable root that depends on one (for example a Local Idle Style pooling
   non-portable Gestures) follows the Anima rule in step 2. `recheck` and
   `_verify_sources` apply the same rule.
2. **Anima export.** `AnimaPackageSourceService.capture` (:56–206) separates
   non-portable bindings, explicit or implicit, from portable ones; `recheck`
   inherits this because it re-runs capture. The portable Anima carries each
   omitted item as a reference (logical key and kind only) in a new
   `PortableAnima` or manifest field that `complete_graph` accepts without an
   entry. `portable_json` must never leave a non-portable key behind through its
   unmapped-value fallback. The export review (`ExportReview`) lists the omitted
   items. Decide by test whether the new field needs a package capability so
   older importers fail clearly rather than misread it, and record the result.
3. **Import.** In `ContentPackageArchive._validate_entry`, reject any member whose
   SHA-256 is in the restricted set, with an error that names the member path and
   never echoes bytes. In `ContentPackageImportService._plan` (:148–218), resolve
   each reference against visible non-portable Included items by logical key and
   kind, and record a rebind or fallback in `ReviewedPackageImport`
   (`app/contracts/content_package_import.py:18–60`). In `_install`, add matched
   entries to `installed` before `resolve_portable_anima` (:389). For unmatched
   ones, drop the slot: no Gesture, or the Default pool without it.
4. **Typed save.** Reject restricted hashes in `LocalContentMutations.apply`
   before the store write (the per-stream SHA-256 is already computed), so typed
   save and any other mutation path share the check.
5. **Byte routes.** Assert that the content-file, preview-file and runtime-bundle
   routes send no attachment `Content-Disposition` for non-portable items.
6. **Missing pack.** Verify that an Anima bound to a non-portable item that later
   disappears (pack absent after an update or on another host) degrades through
   the existing missing-content path without errors. Fix it if not.
7. **Pre-existing Local matches.** A Local item whose payload matches a restricted
   hash is reported as non-portable in the catalog. Its files are not deleted
   (spec Constraints). This also covers files dropped in by hand or by
   `acquire-mixamo.py`, which bypass typed save.
8. **Errors.** Export and save errors include the restricted item names in their
   `details`, so the UI can show them (P3).

Tests: `tests/test_content_package_*`, `tests/test_portable_anima*` and import
tests cover each route in the R2–R5 acceptance criterion: export and summary;
Anima export with explicit and implicit bindings; recheck; crafted-package
import; typed save of re-uploaded bytes; dependent Local Idle Style export; and
an import round trip with rebinding and fallback.

Checks: as in P1, then a regenerated client and `pnpm check`.

Completion: every route enforces the rule server-side; errors name items without
echoing bytes; review passes.

Results (2026-10-07, starting revision `80268f7b`):

- Implemented: export refusal and Idle Style stripping
  (`content_package_export.py` `_strip_non_portable`, run after portraits),
  omitted Anima bindings (`anima_package_source_service.py`
  `OmittedAnimaBinding`), the manifest field `non_portable_references` with
  `PackageNonPortableReference`/`PackageNonPortableUse` and its validator,
  capability `animama/non-portable-references/1`, archive hash rejection,
  import rebind/fallback (`content_package_import.py` `_plan_non_portable`,
  `_restored_idle_refs`, `_rebind_anima`), pool strip/restore helpers
  (`non_portable_packages.py`), typed-save hash rejection
  (`content_portability.reject_restricted_bytes`), `ContentConflictError.items`
  surfaced as `detail.items`, review fields `omitted` and `non_portable`, and
  docs (`docs/backend/features/typed-content-and-marketplace.md`,
  `docs/backend/architecture/http-api.md`).
- Decisions (agent, within the accepted outcome):
  - **Save check placement.** The hash check sits in both `ContentSaveService`
    save paths, not `LocalContentMutations`, which has no shared byte-handling
    entry point. The other Local writers are package import (checked in the
    archive), the startup transitions (guarded in P1) and Pocket voice uploads
    (not motion). Files dropped in by hand are scanned as non-portable.
  - **Dependency rule scope.** Only a portable v2 Idle Style pooling a
    non-portable Gesture is stripped and referenced. Any other dependency on a
    non-portable item refuses the export by name: no other kind can drop a
    dependency without changing what it is, and the Mixamo pack holds only
    Gestures and one Idle Style. The same applies to Anima bindings other than
    Gestures and the Idle Style.
  - **Compatibility.** `non_portable_references` is serialized only when
    present, so every other package is byte-for-byte unchanged. Earlier readers
    reject a package that has references at manifest parsing
    (`package_invalid`, because the manifest forbids unknown fields). The
    capability gives clear rejection in readers that tolerate unknown fields.
  - **Import errors name the entry**, by its display name, not the member path.
  - **Rebinding requires a unique logical key** among all visible items, the
    same rule dependency admission uses; otherwise the item is `unavailable`.
  - **Missing pack.** An Anima bound to a non-portable item that later
    disappears already resolves to an `unresolved:` runtime selection
    (`anima_runtime_service.py`), the generic path for any removed Included
    item. Verified by code reading; no new code.
  - **Implicit starter Idle Style surprise.** It does not affect these tests: the
    fixture's starter style exists. The implicit-starter test makes it v2 to
    mirror the shipped pack.
- Tests: `tests/test_non_portable_packages.py`:
  - helper round trip;
  - content export refusal, Idle Style strip, hostile-manifest validation, and
    import rebind and fallback;
  - restricted bytes refused on save and on import;
  - Anima explicit Gestures, and implicit starter Gestures plus the Idle Style,
    each with rebind and fallback;
  - refusal of other non-portable bindings;
  - prepare recheck after the summary.

  Also `tests/test_content_package_http.py` (409 with `detail.items`) and
  `tests/test_pose_content.py` (no `Content-Disposition` on the file route).
- Checks: `ruff check`, `make format-check`, import boundary (0 forbidden edges),
  `pnpm openapi-ts:check` and `pnpm check` pass; full `uv run pytest -q` before
  review: 3176 passed, 1 failed (the same environment-only gruut failure as P1).

#### Code Review #1 Findings

Reviewer: independent `sdlc-reviewer`, staged source on `80268f7b`.

- **P2-F1 (required):** implicit starter Gesture and Idle Style omission, Idle
  Style rebinding and the refusal of other bindings were untested; the Anima
  test name overclaimed.
- **P2-F2 (required):** the plan record lacked Phase 2 results and decisions
  (save placement, dependency scope, compatibility, error naming, starter
  surprise).
- **P2-F3 (optional):** stripping ran before portraits were added, so a
  non-portable portrait could bypass the name check.
- **P2-F4 (optional):** synthetic rebind ids could shadow a packaged entry;
  rebinding was keyed by logical key alone; validator error paths were untested.
- **P2-F5 (optional):** rebinding accepted a key that dependency admission
  would reject when another visible item shares it.
- **P2-F6 (optional):** the save check rehashed streams even with an empty
  restricted set.
- **P2-F7 (optional):** `_plan_non_portable` computed twice; a duplicate Avatar
  check; `save_descriptor_streams` path untested; missing pack verified by code
  reading only.

#### Code Review #1 Revisions

- **P2-F1 accepted.** Test renamed (`..._explicit_...`), and
  `test_anima_export_omits_implicit_starter_gestures_and_idle_style` (rebind and
  fallback) and `test_anima_export_refuses_other_non_portable_bindings` added.
- **P2-F2 accepted.** Results and decisions recorded above.
- **P2-F3 accepted.** `_strip_non_portable` runs after portrait resolution.
- **P2-F4 accepted.** Synthetic ids skip existing entry ids; rebinding is keyed
  by `(kind, logical_key)`; six hostile manifest variants are rejected in
  `test_content_export_and_import_handle_non_portable_items`.
- **P2-F5 accepted.** Rebinding requires a unique visible logical key.
- **P2-F6 accepted.** Early return when nothing is restricted. The extra hash
  over the save streams remains; it costs one read of the upload.
- **P2-F7 partly accepted.** Computed once; duplicate check removed. The
  descriptor-stream path shares `reject_restricted_bytes` with the tested
  standalone path, and the missing-pack evidence stays code reading. Both are
  recorded limitations.
- Verification: 38 package tests pass (`test_non_portable_packages.py`,
  `test_content_package_http.py`, `test_content_package_export_review.py`,
  `test_content_package_import_anima.py`); `ruff check` passes.

#### Code Review #2 Findings

Targeted recheck (repair round 1): **pass**. P2-F1 to F7 resolved or
acceptably dispositioned; coverage confirms the new paths run (export 91%,
import 81%, Anima source 80% of the touched services). Only the explicit Idle
Style row branch stays unexercised, which the finding allowed.

- **P2-F8 (optional):** the synthetic-id collision branch is untested; a crafted
  manifest forcing long suffixes fails `PortableId` validation safely.

#### Code Review #2 Revisions

- **P2-F8 not changed:** the failure is safe and covered by contract
  validation. One repair round remains for this phase.

### Phase 3: Frontend affordances

Requirements: R4, the UI part of R3, Constraints (accessibility). Depends on P2.

Intended changes:

1. **Property plumbing.** Carry `portability` through the explicit adapters
   (`typedComponentCatalogViewItem`, `typedCatalogTransportItem`,
   `typedActionPreview`), `SharingItem`/`useSharingInventory`, and the new export
   and import review fields from P2. Pass error `details` through
   `packageSharingApi.ts` and `errors.ts`, so named-item errors reach the UI.
2. **Inventory confirmation.** Confirm the sampling and copy paths in the
   orientation table against the code at the phase's starting revision. Record
   each path's disposition here before changing code.
3. **Gesture creator: preview-only branch.** For a non-portable item,
   `hydrateCatalogAction` opens a read-only preview. It never calls `setVrma` into
   a draft, never marks it `"__included_copy__"`, never writes recovery autosave
   and never enables Save. Save, Save & Equip, Customize as new, Import, the Pose
   and Clip tabs, View JSON (copy and download), pose capture and inline keyframe
   edit are unavailable, with a visible text explanation (a `CreatorSaveNotice`
   or an inline note, since tooltips do not fire on disabled buttons).
   `isCustomizableStarterAction` excludes non-portable items. Update the
   "distinct unsaved Local document" test so it still holds for portable items
   and add the restricted case.
4. **Library.** `libraryProductActionPolicy` turns Edit into a non-portable
   preview path (Preview stays) and gives a text reason in both grid and list
   layouts. Add no badge (D5).
5. **Sharing.** `ContentExportSelection.tsx` does not offer non-portable items
   and explains why if they appear. `ContentExportReview.tsx` and
   `SharingAnimaDetails` list items omitted from an Anima export by name, not by
   raw ID. `ContentImportReview.tsx` shows rebinding and fallback notices.
6. **Idle Styles.** Duplicating the non-portable Included Idle Style and saving
   Local styles that reference non-portable Gestures keep working (tests only).

Tests: the unit tests in the orientation table, using catalog fixtures with
`portability: "non-portable"`. Extend `accountless-content-sharing.spec.ts` with
a restricted export, if the e2e harness can mount the fixture source; otherwise
record why the browser check covers it instead.

Browser check: a task stack (`./reset.sh --name mixamo --base-port <port>`) with
the synthetic fixture source mounted through `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON`
in a development-only override. At a desktop viewport, show the unavailable
actions and their explanations, the export omissions, the import notices and
the Idle Style duplicate. Then check a narrow layout for regressions.

Checks (from `src/frontend`): `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`, and the affected e2e journeys.

Completion: the inventory is recorded, the R4 acceptance criterion holds in
tests and the browser, and review passes.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 4: Private build inputs, staging allowlist and leak checks

Requirements: R6 (delivery), R7, R8 (checks), documentation acceptance. Depends
on P1.

Intended changes:

1. **Tracked, public-safe inputs** in `scripts/mixamo-motion/`: `manifest.json`
   (relative paths, sizes and SHA-256 hashes; empty until P5) and
   `inventory.json` (the non-portable rule, creator, licence reference,
   provenance summary and a link to #242 and the ADR; no Adobe ID, account data
   or private path). Its glob must match both entry locators (runtime) and files
   (staging), for example a single `**` rule, because the pack holds nothing
   else. The backend resource from P1 step 4 is generated from, or
   checked against, this manifest.
2. **Owner tool** `src/frontend/desktop/scripts/runtime/mixamo-motion.mjs`,
   following the R2 publish pattern (`r2-objects.mjs` signing plus a new signed GET
   helper, credentials from the command environment or an owner-only file, never
   printed, dry run by default):
   - `fetch` pulls the private prefix into `build-inputs/mixamo-motion/` with
     read-only credentials;
   - `verify` checks an exact manifest match (missing, extra or mismatched files
     fail with the path) and a complete private-inventory record per entry. It
     prints only pass/fail and paths;
   - `scan <path>` hash-scans a directory or archive for manifest hashes;
   - `publish --confirm` uploads a verified pack and private inventory (owner
     only).
3. **Desktop staging.** `stage_content.py` and `stage.mjs` stage the pack as
   `runtime/content/mixamo-motion` only from `build-inputs/mixamo-motion/`, only
   after `verify` passes, and copy the tracked inventory into it. Without the
   input, staging still succeeds (a self-built desktop app without the pack). A
   `--require-mixamo-motion` flag, used for release candidates, fails instead.
   The Electron supervisor declares the source in
   `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON` when the staged pack exists. The
   runtime audit records its files.
4. **Leak checks.** `scan` runs against `git ls-files`, the Docker build context
   (a listing that honours `.dockerignore`), the self-host image filesystem and
   its runtime Included mount source, the built wheel and npm packages, and the
   desktop stage outside `runtime/content/mixamo-motion`. `desktop:release:scan`
   gains the same hash deny list for expanded release archives, allowing the
   pack's hashes only under its own runtime directory. Add `build-inputs/` to
   `.gitignore` and `.dockerignore`. Add tests proving that ignored copies
   elsewhere never satisfy the gate, and that a missing, mismatched or extra file
   fails.
5. **Hosted contract.** Document how a hosted deploy fetches, verifies and mounts
   the pack as an Included source, and serves bytes only through authenticated
   file routes (R6, R9). Cloud implements this in its own plan; record the
   follow-up there when hosted avatar playback exists.
6. **Documentation.** Add ADR 0015 (the non-portable class, private build inputs,
   backend enforcement, alternatives considered) and a glossary entry for
   **Non-portable content**. Update `docs/frontend/desktop/redistribution-review.md`,
   `platforms.md`, `feature-packs.md` (this pack is not a feature pack),
   `runtime-staging.md`, `docs/frontend/runtime/mixamo-acquisition.md`,
   `content/included/README.md`, `README.md`, `licenses/README.md`,
   `licenses/third-party/art-NOTICES.md`, `scripts/public-release/README.md`,
   `docs/backend/operations/development.md` and the backend Included-sources
   docs, leaving no contradictory statement. Update the packaged notice
   `src/frontend/desktop/runtime/notices/included-content-attribution.txt` (and
   `license-sources.json`) and make `licenses.mjs` include the pack's licence in
   the redistribution inventory and review packet. Remove the two stale Mixamo
   rules from `content/included/licenses/inventory.json`, together with the
   assertion in `tests/test_included_content_integrity.py:25–26`. Decide on the
   legacy `animation-manifest.json` (Surprises).

Tests: `src/frontend/desktop/tests/runtime-packaging.test.mjs` and a new test
for `mixamo-motion.mjs` (fixture pack: present, absent, mismatched, extra and
required cases; `verify` and `scan`); `tests/test_starter_content_closure.py`
for the unchanged tracked-only gate; the integrity tests.

Checks: `uv run pytest -q`, `uv run ruff check`, `make format-check`; from
`src/frontend`: `pnpm desktop:check`, `pnpm desktop:test -- runtime-packaging`,
`pnpm desktop:runtime:stage` and `pnpm desktop:runtime:audit` (darwin arm64,
without the pack); then `bash -n reset.sh` and both
`docker compose … config --quiet` checks.

Completion: a fixture pack stages and audits; every leak check passes on a clean
tree; docs and the ADR are drafted for owner acceptance; review passes.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 5: Content acquisition and integration

Requirements: R1, R8, and the R7 acceptance criteria with real content. Depends
on P2, P3 and P4. Contains owner gates.

1. **Gate G1 (owner): private store.** In the existing private R2 bucket that
   hosted deploy reads, confirm in the Cloudflare dashboard that it has no `r2.dev`
   URL and no custom domain. Create a dedicated prefix, a write token for
   publishing and a read-only token for build and deploy, scoped to the bucket
   (and the prefix, where R2 supports it). Store both only in owner-only env
   files. Record a dated, credential-free note in this plan.
2. **Gate G2 (owner): fresh downloads.** With the owner's Adobe account, download
   the 29 `starter_target` clips afresh and record each download in the private
   inventory: animation name and ID, character, export settings, date, licensee,
   conversion tool, version and steps, and resulting hash. Use the existing
   `acquire-mixamo.py --prepare` checklist workspace and `validate_vrma` checks. The agent may run conversion and
   descriptor generation on the owner's machine, but nothing private enters Git.
3. **Pack assembly** (agent, private workspace). Generate the 29 Gesture
   descriptors from the `document` templates in `scripts/mixamo-assets.json`, with
   `builtin:` content IDs (idle loops keep their loop config). Check that no
   content ID or Selector ID collides with core Included content or with #310's
   promoted Gestures. Author one Included Idle Style pooling the six loops by
   emotion, based on the `idle_style_document` template. Run `verify`.
4. **Publish** (owner runs `publish --confirm`). Commit the tracked
   `manifest.json` and `inventory.json` (public-safe review before commit) and
   the regenerated backend hash resource.
5. **Verify builds.** `fetch` + `verify`; stage a desktop runtime with
   `--require-mixamo-motion`; audit it; run every leak check from P4 on the real
   manifest; confirm self-host `./reset.sh` still creates both starters without
   the store, and that the Local installer still installs Local content.
6. **Gate G3 (owner): playback.** In the desktop app, play all 29 clips and the
   Included Idle Style on `AvatarSample_Y_0` (VRM 0) and `AvatarSample_A_1_New`
   (VRM 1). Retargeting and foot contact must look correct. Repeat the export,
   import and creator restrictions with real items. The hosted check is
   recorded as deferred to Cloud's plan while hosted avatar playback does not
   exist.

Recovery: a bad clip is fixed by re-converting it and republishing the pack under
a new pack version, then updating the tracked manifest. Removing the pack from a
build only unmounts it (P2 step 6 covers Animas that referenced it).

Completion: G1–G3 recorded; the R1, R7 and R8 acceptance criteria hold with real
content; review passes.

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

Combined acceptance across R1–R9 using still-valid phase evidence, the leak
checks on the final candidate, and documentation consistency. It ends with one
review and at most two repair rounds.

## Validation and acceptance

The spec's acceptance criteria are the contract. Evidence per criterion:

- R2–R5: backend tests from P1–P2 (`uv run pytest -q`).
- R4 and R3 UI: frontend tests and the P3 desktop-viewport browser check.
- R6: byte-route header tests (P2) and the documentation review (P4).
- R7: P4 fixture tests, and P5 real-manifest leak checks and staging.
- R8: `verify` on the real pack (P5), and review of the public inventory.
- R1: owner gate G3.
- Documentation: ADR 0015 accepted by the owner, and the glossary and guides
  updated (P4).
- R10: release gate G4. It is outside this PR and recorded in the release review.

Never mark an unperformed check as passed. Local, browser and owner evidence are
recorded separately in each phase. Hosted CI is disabled.

## Idempotence and recovery

- `fetch`, `verify`, `scan` and staging are repeatable and write only to ignored
  build-input and stage directories. `publish` is a dry run unless `--confirm` is
  passed.
- Portability is derived on every scan, so removing or replacing the pack takes
  effect on the next reconciliation without data migration.
- No Alembic revisions. If a catalog column is added, it goes into the baseline
  SQL, and development databases may be reset at the owner's discretion.
- If a Mixamo file is ever committed by mistake, stop and tell the owner. History
  rewriting is the owner's decision. Never force-push without approval.

## Outcomes & Retrospective

Not started.
