# Final desktop release before distribution ends

Source agreement: [#837](https://github.com/raymond-van/animama/issues/837),
published from the agreed [spec](final-desktop-release-spec.md) at
2026-11-04T17:24:54Z; it refines D5 of the open-source readiness plan.
Authorized scope: the whole plan (owner approval G0, 2026-11-04). Owner gates
G1 to G3 follow the merge and stay owner-run.
Planning baseline: `origin/main` at `6c405817b`; implementation base
`8ae2d1f05`. Workspace: worktree `stoic-raman-729302`, branch
`build/final-desktop-release`; no Compose stack yet.

## Purpose and context

Refined by [#859](https://github.com/raymond-van/animama/issues/859)
(2026-11-04): after this plan merged, `main` turned updates and model
downloads back on until the final release, which turns both off in one PR.

After this plan, every build from this source is final: a packaged desktop app
never contacts `downloads.animama.ai`, model downloads are switched off in every
local composition with clear wording in their place, the speech scripts default
to Hugging Face, the packaged notices match the licence records, and the release
documentation holds the owner's runbook for the last release and the
disconnection. Releasing and publishing stay owner-run (gates G1 to G3 below).

Orientation, from a read-only survey on 2026-11-04:

- **Updates.** `src/frontend/desktop/src/main.ts` `initializeUpdates()` reads
  the sealed `runtime/update-policy.json` (`validateUpdatePolicy` in
  `main-process/updates/policy.ts`, schema `animama-update-policy/2` with an
  exact key set), checks the app's own publisher, then creates the
  `DesktopUpdateController`. Without a controller the IPC handlers already
  return `{ state: "unavailable" }` and refuse download and restart; the web
  `DesktopUpdatesPanel` and notice render nothing for `unavailable`.
- **Policy source.** `desktop/runtime/release-policy.json`
  (`animama-release-policy/3`) is validated by
  `desktop/scripts/runtime/release-policy.mjs`; `stagedUpdatePolicy()` builds the
  sealed policy at staging, and `release-macos.mjs`/`release-windows.mjs`
  compare the staged copy with it. `feature-pack-releases.json` marks both packs
  `deferred`.
- **Smoke.** `desktop/scripts/runtime/smoke-journey.mjs:223-233` records
  `update_publisher_verified` by requiring an update state other than
  `unavailable`; nothing else consumes that evidence.
- **Model assets.** `src/backend/animama/server/model_assets.py` builds the one
  local `ModelAssetService` (`app/services/model_asset_service.py`) from the
  packaged catalog `resources/model-assets.v1.json` (40 entries pinned to
  `downloads.animama.ai/models/`). `server/routers/model_assets.py` lists
  assets (`PyModelAssetList`: `assets`, `free_bytes`) and maps
  `AssetInstallRefusedError` to 409 `{code, details}`. Cloud parses the same
  catalog through `parse_asset_catalog` and builds `AssetCatalog` positionally,
  so the catalog and its parser stay unchanged.
- **Controls.** `ui/settings/speech/OfflineSetPanel.tsx` (setup through
  `SetupSpeechChoice`, Settings through `SttChoiceTabs`),
  `ui/settings/SpeechLanguageNotice.tsx`, `ui/animas/PocketVoicePicker.tsx`
  with `hooks/usePocketVoiceDownloads.ts` and
  `lib/speech/pocket/voice-downloads.ts`, the fallback in
  `lib/speech/pocket/voice-preferences.ts` (`resolvePocketFallbackVoice`),
  `ui/settings/VoiceDownloads.tsx`, `ui/animas/VoiceCloneLibrary.tsx` and
  `VoiceCloningDownload.tsx`, and the upload toast in
  `hooks/useUserFileUpload.ts`. Operator-managed (hosted) state is the closest
  existing pattern (`useOperatorManagedModelAssets`, `pocketVoiceNotProvided`).
- **Notices.** Desktop: `desktop/scripts/runtime/licenses.mjs` builds
  `THIRD_PARTY_NOTICES.txt` from `runtime/license-sources.json` groups whose
  `notice_files` must be lowercase `.txt` files in `runtime/notices/`. Hosted:
  `src/frontend/scripts/hosted-build-resources.mjs` `addNotices` copies
  `runtime/notices/` (minus the Included-content attribution) plus four fixed
  files from `licenses/`. `scripts/build-typescript-package.mjs` copies the root
  `LICENSE` into each package's `dist/`; `scripts/repository-boundary/check-packed-artifacts.py`
  inspects tarballs but not their licence files.
- **Releases.** Previews 0.1.0 to 0.1.2 for macOS are published (their DMGs
  answer 200); `latest-mac.yml` and `latest.yml` answer 404; no Windows build is
  published. Both redistribution receipts in `release-policy.json` predate
  #845's lockfile changes and the AGPL licence change, so both need fresh owner
  reviews.

## Progress

- [x] Read-only survey and this plan (2026-11-04).
- [x] G0: owner approved the spec and this plan with the recommended answers to
  all seven open decisions (2026-11-04).
- [x] Workspace (2026-11-04): spec published to #837, branch
  `build/final-desktop-release` at `8ae2d1f05`, plan and spec snapshot
  committed.
- [x] Phase 1: sealed end of updates and packs (review #2 passed; one repair round).
- [x] Phase 2: model downloads end in the backend (review #2 passed; one repair round).
- [x] Phase 3: download controls explain the end (review #2 passed; one repair round).
- [x] Phase 4: packaged notices (review #2 passed; one repair round).
- [x] Phase 5: script defaults (review #1; trivial repairs).
- [x] Phase 6: documentation, version and runbook (light; review folded into the final review).
- [x] Final integration review (one round; trivial wording repairs).
- [x] Full pre-push suite and fast browser journeys on the final candidate
  (results in PR #852).
- [x] PR opened with local evidence: #852.
- [ ] G1 to G3 (owner-run, after merge): final release, transition, cut-off.

## Surprises & Discoveries

- The final release cannot reuse 0.1.2: its preview objects are published and
  release folders are immutable. The next version is 0.1.3.
- No stable feed was ever published, so no installed build has updated through
  the feed yet. The transition is the first time preview installs are offered
  an update; the final release's native acceptance must include the forward
  upgrade from the 0.1.2 preview.
- #838's R5 cannot protect any user here: the final build never updates, and
  builds that update to it run their own older updater code.
- `uploads.processingUnavailableDesktop` already tells people to install a pack
  that no build has offered.
- `check_source.py` failed on `f2f9d07fa` (landing files without entries);
  #847 fixed it on `6c405817b`.
- The structural OpenAPI change needs a `local-http` major (22.0.0), not the
  minor the plan first said; `runtime-contracts` becomes 0.22.0, and after the
  bump `pnpm install --frozen-lockfile` must run again before staging.
- The production image's `web-builder` stage copies only what its build reads,
  so the package notices needed `licenses/third-party` copied in.
- Ending downloads made a self-host restore lose installed model assets for
  good (backups omit them and the restore wiped the data root); the restore
  now keeps them in place.

- After #858 and #855 merged, `main` was merged into this branch
  (`202a7524d`). #858's smoke already binds the installed
  `runtime/update-policy.json` to the release source's policy
  (`sealed_update_policy`) and runs the update check on its ad-hoc-signed
  copy (`copy_updates_unavailable`), so this plan's own smoke steps were
  dropped in favour of #858's: with the ended policy, `sealed_update_policy`
  binds the artifact to `"updates": "ended"`, and `openSealedUpdates` (unit
  tested) keeps the app from checking. The `updates_ended` evidence is retired.
  The packed-artifact check keeps both #855's wheel licences and this plan's
  package notices.

## Decision Log

- 2026-11-02, owner (D5): final release, then cut-off; the switch is sealed into
  the release; the host names stay registered.
- 2026-11-04, owner (G0): approved the plan's design: one sealed `updates`
  field governs update checks and packs; the model-asset switch lives in the
  local backend composition and is exposed on the list response; notice texts
  are read from `licenses/third-party/` rather than copied. Answers to the
  spec's decisions: 0.1.3 after the chosen #838 fixes; macOS only; about four
  weeks of transition ending by 2026-12-31; downloads end in every local
  composition; `product-ui` gets a notice too; no import path; keep the R2
  bucket. Approving the plan also approves the single full pre-push run and
  fast browser journeys on the final candidate.

- 2026-11-04, owner: model downloads end as planned (asked whether to keep
  serving model objects after the desktop cut-off).
- 2026-11-04, owner (relayed by the security review session): #838 drops its
  R5 update-download checks; it still delivers R1–R4. Its R3.6 smoke rewrite
  and this plan's R1.5 smoke step both edit the smoke journey, so whichever
  merges second resolves the overlap.
- 2026-11-04, owner, after #852 merged: keep making desktop releases and keep
  model downloads working until the final release (#859). `main` turns both
  switches back on (`"updates": "offered"`, `MODEL_DOWNLOADS_OFFERED = True`),
  and the final release turns both off in one PR, as the first step of the
  Ending distribution runbook in `docs/frontend/desktop/releases.md`. The ended
  behaviour, its wording and its tests stay.

## Phased implementation

### Workspace setup

After G0, in the existing worktree:

1. Publish the agreed spec as #837's body (parent-form sections), read it back,
   and mark the spec file as a snapshot with the issue's update time.
2. `git branch -m build/final-desktop-release`, `git merge origin/main`, then
   `uv sync --python 3.12.13`, `pnpm install` in `src/frontend`, and
   `git lfs pull` before backend content tests.
3. Commit the plan and spec snapshot:
   `docs(release)[p0]: plan the final desktop release`.

Tell the hardening session (#838) which shared files this branch edits
(`main.ts`, `smoke-journey.mjs`, `docs/frontend/desktop/releases.md`,
`docs/safety/crisis-protocol*.md`) through the shared notes folder.

### Phase 1: Sealed end of updates and packs

Review tier: high risk (release tooling and the packaged update path).

Requirements: R1.1 to R1.5.

Steps (tests first in `desktop/tests/desktop-updates.test.ts`,
`runtime-packaging.test.mjs` and `feature-packs.test.ts`):

1. `release-policy.json` gains `"updates": "ended"` (schema
   `animama-release-policy/4`, values `offered` or `ended`).
   `validateReleasePolicy` requires the field and refuses an `active` pack in
   `feature-pack-releases.json` while updates have ended.
2. `stagedUpdatePolicy()` seals `updates` into the runtime policy (schema
   `animama-update-policy/3`). `validateUpdatePolicy` requires it in the exact
   key set for both platforms.
3. `main.ts` `initializeUpdates()`: after validating the policy, return when
   `updates === "ended"`, before the publisher check and before any adapter or
   session exists. Status stays `unavailable`.
4. `smoke-journey.mjs`: read the installed app's sealed policy; when updates
   have ended, record `updates_ended` (state `unavailable`) instead of
   `update_publisher_verified`. The publisher is still checked by the install
   step's signature verification.
5. Fixtures and tests that build update policies move to the new schemas.

Checks: `pnpm desktop:test`; `pnpm --filter animama-desktop check`;
`pnpm desktop:runtime:stage -- --platform darwin --arch arm64` through the
heavy slot (after confirming no pack is running), then confirm the staged
`runtime/update-policy.json` carries `"updates": "ended"` and the pack catalog
is empty.

Recovery: setting `"updates": "offered"` restores the previous behavior; no
installed data changes.

Completion: commit `build(desktop)[p1]: seal the end of update checks into the build`.

Check record (from `src/frontend` unless noted):

- Red first: the five update/policy test files failed 8 tests before the change.
- Tree `34754509` (initial): `pnpm --filter animama-desktop exec vitest run
  tests/desktop-updates.test.ts tests/runtime-packaging.test.mjs
  tests/windows-release.test.mjs tests/feature-packs.test.ts
  tests/desktop-updater-adapter.test.ts` 174 passed; `pnpm --filter
  animama-desktop check` passed; `pnpm desktop:test` 599 passed, 14 skipped;
  `cd desktop && pnpm -s prettier:check` passed;
  `python3 ../../scripts/heavy-slot.py -- pnpm desktop:runtime:stage --
  --platform darwin --arch arm64` exit 0, staged `update-policy.json` is
  schema `/3` with `"updates": "ended"`, `pack-catalog.json` entries `[]`.
- Tree `1df902b6` (after repair round 1): `pnpm --filter animama-desktop check`
  passed; `pnpm desktop:test` 603 passed, 14 skipped; desktop
  `prettier:check` passed.

#### Code Review #1 Findings

Reviewed tree `34754509` (staged Phase 1), high risk; the reviewer reran the
five update/policy test files (174 passed) and `tsc`.

- P1-R1-F1 (blocking): no unit test pinned the main-process decision; a merge
  could move the early return below the publisher check unnoticed.
- P1-R1-F2: the smoke took its expectation from the artifact under test.
- P1-R1-F3: stable macOS acceptance required pack checks a build without packs
  cannot exercise.
- P1-R1-F4: `releases.md` lines on the startup publisher check, the policy row
  and the smoke's update check become misleading (Phase 6).
- P1-R1-F5: the policy comment's reason for keeping the distribution was wrong.
- P1-R1-F6: no win32 ended case and no `release-policy/3` rejection test.

#### Code Review #1 Revisions

- F1 accepted: `openSealedUpdates` in `updates/policy.ts` validates, returns
  before the publisher check and controller when ended, and is used by
  `main.ts`; four tests cover ended, offered, cancelled and invalid.
- F2 accepted: both smoke installs record `sealed_update_policy` against the
  release source's policy before the journey branches.
- F3 accepted: `validateManualAcceptance(..., { packs })` skips the three pack
  checks when no pack is active; `publish-release.mjs` passes it.
  `offline_dictation` stays: it is exercised by upgrading from a 0.1.2 preview
  that has offline speech installed (Phase 6 runbook).
- F4 deferred to Phase 6. F5 and F6 accepted. The ended smoke step is named
  `updates-ended`. The `publish-macos-models` fixture gains `activePackIds`.

#### Code Review #2 Findings

Targeted recheck of tree `1df902b6`; the reviewer reran eight affected desktop
test files (206 passed) and the whole desktop suite (603 passed, 14 skipped).
All dispositions verified; no blocking findings. P1-R2-F1 (optional): the VM
guest smoke does not forward `ANIMAMA_RELEASE_DISTRIBUTION`, so a GitHub-built
candidate fails `sealed_update_policy` there; it fails closed and R2 is the
release distribution, so the Phase 6 runbook notes it. Phase 1 passes.

### Phase 2: Model downloads end in the backend

Review tier: high risk (shared HTTP contract and generated client).

Requirements: R2.1 to R2.4.

Steps (tests first in `tests/test_model_assets.py` and the route tests):

1. `ModelAssetService` takes `downloads_offered` (keyword, default `True` so
   existing callers and download tests keep their behavior). When false,
   `install` of an asset that is not installed raises
   `AssetInstallRefusedError("model_downloads_ended", {})` before staging or
   fetching; an installed asset returns its state.
2. `server/model_assets.py` builds the local service with downloads not
   offered, with a comment naming the end of Animama's distribution.
3. `PyModelAssetList` gains `downloads_offered: bool = True` (optional in the
   contract, so hosted responses stay valid). The install route documents the
   new 409 code.
4. Regenerate the OpenAPI document and SDK offline (`pnpm openapi-ts`), bump the
   `local-http` contract major version (package-set `compare` requires a major
   for any structural OpenAPI change), and bump `runtime-contracts`, whose
   declarations change, as earlier bump commits do (`package.json` and the
   version line in `contracts/hosted-web.md`).
5. Development override: none. The dev stack's speech sets still come from the
   host (`ANIMAMA_PARAKEET_SOURCE=operator`).

Checks: `uv run pytest -q tests/test_model_assets.py tests/test_model_asset_sets.py
tests/test_parakeet_model_sources.py tests/test_pocket_voice_set.py` plus the
route and runtime-capability tests; `uv run ruff check`; `pnpm openapi-ts:check`
(or the repository's SDK freshness check) under Python 3.12.13.

Recovery: passing `downloads_offered=True` in the composition restores
downloads; installed assets are never touched.

Completion: commit `feat(models)[p2]: end model downloads in local compositions`.

Check record (repository root unless noted):

- Red first: the three new tests in `tests/test_model_assets.py` failed.
- Tree `3ed3d838` (initial): model-asset, set, Parakeet-source, Pocket-voice
  and SenseVoice store tests 127 passed; with the runtime-capability, port and
  Compose-boundary tests 251 passed; `ruff check`, `ruff format --check`,
  `mypy` on the touched files and `make audit-typed-content` passed;
  `pnpm openapi-ts:check` (Python 3.12.13) current; runtime-contracts
  `pnpm -s test` 10 passed.
- Tree `eb7a0e3a` (after repair round 1): the same pytest set plus
  `tests/test_local_state_scripts.py` 325 passed; ruff, ruff format and mypy
  clean; `bash -n` on the restore scripts; `docker compose -f
  docker-compose.yml config --quiet` exit 0.
- After the optional round-2 fixes: `tests/test_local_state_scripts.py` 16
  passed; `bash -n` on both scripts.

#### Code Review #1 Findings

Reviewed tree `3ed3d838`, high risk; the reviewer reran the pytest set (306
passed), ruff, mypy, the import-boundary check, `openapi-ts:check` and the
runtime-contracts tests.

- P2-R1-F1 (blocking): a self-host restore wiped the data root while backups
  and rollbacks omit model assets, so installed sets were lost with no way to
  download them again.
- P2-R1-F2 (blocking): the HTTP API reference did not describe
  `downloads_offered` or `model_downloads_ended`.
- P2-R1-F3: the plan said a minor contract bump; a major is required.
- P2-R1-F4: other text now false (Compose comment, module docstrings,
  development and agent guides, hosted contract, ADRs 0012 and 0029).
- P2-R1-F5: staged prefixes of interrupted downloads could never resume and
  stayed on disk.
- P2-R1-F6: small test gaps (refusal on the real composition, refusal before
  requirements).

#### Code Review #1 Revisions

- F1 accepted: `animama_state_replace_data_root` keeps
  `internal/model-assets` across a restore; behavioural test added; the
  model-asset operations page corrected.
- F2 accepted: the Model Assets section documents both.
- F3 accepted: step 4 and Surprises corrected.
- F4: Compose comment and docstrings fixed; the documents are on Phase 6's
  list.
- F5 accepted: a service that offers no downloads discards staging at
  construction, with a test.
- F6 accepted: both tests added; a lease test was not, since leases do not
  read the flag.

#### Code Review #2 Findings

Targeted recheck of tree `eb7a0e3a`; the reviewer reran the pytest set (325
passed), ruff, mypy, the boundary check, `bash -n`, Compose config and
`openapi-ts:check`, and exercised the restore helper on scratch directories
(failed extraction, interrupted rerun, nothing installed). All dispositions
verified; no blocking findings. Optional: P2-R2-F1 "before any other check"
overstated the order (busy comes first); P2-R2-F2 a failed extraction leaves
the kept sets at `.restore-model-assets` without saying so, and backups would
include that folder; P2-R2-F3 the operations page's startup-staging sentence
(Phase 6).

#### Code Review #2 Revisions

P2-R2-F1 and P2-R2-F2 accepted as trivial repairs (doc wording; one tar
exclude in each script and a line in the restore failure message), verified by
the rerun above and left for the final integration review to confirm.
P2-R2-F3 is on Phase 6's list. Phase 2 passes.

### Phase 3: Download controls explain the end

Review tier: standard (UI behavior and copy).

Requirements: R3.1 to R3.5.

Steps (Vitest first, extending the existing component tests):

1. A small selector over `useModelAssets` reports downloads ended when the list
   says `downloads_offered === false`; operator-managed state keeps precedence.
2. `OfflineSetPanel`, `SttChoiceTabs` labels and `SpeechLanguageNotice`: no
   Download/Retry or size for uninstalled sets; one explanation; Remove stays.
3. Pocket voices: treat uninstalled downloadable voices like unprovided ones
   (disabled, "not available"), never auto-install on pick, and in
   `resolvePocketFallbackVoice` speak with the default and show a
   session notice instead of requesting an install.
4. Voice cloning status and dialog: explanation instead of the download offer
   when the encoder is not installed.
5. Desktop upload toast: say document processing is not available in this app.
6. Strings in `voice`, `setup`, `animas` and `app` namespaces for English and the
   four beta catalogs with the term list; regenerate i18n types.

Checks: the touched Vitest files plus `ModelDownloads.test.tsx` and
`usePocketVoiceDownloads.test.tsx`; `pnpm i18n:check`; `pnpm web:lint`;
`pnpm check`; the browser tests whose fixtures cover these controls
(`setup-downloads`, `model-download-coordination`, `voice-clone-library`)
because their fixtures may need the new list field.

Recovery: the controls follow the list field; with downloads offered they render
as before.

Completion: commit `feat(voice)[p3]: explain that model downloads have ended`.

Check record (from `src/frontend/web` unless noted):

- Red first: 13 new or changed tests failed before the source change.
- Tree `fdeac870` (initial): the 14 affected Vitest files 162 passed; from
  `src/frontend`, `pnpm -s i18n:extract` then `pnpm -s i18n:check` ("Every
  translated catalog is complete") and `pnpm -s check` passed; eslint on the
  touched sources and `pnpm -s prettier:check` passed. After `pnpm
  packages:build`, the setup-downloads, model-download-coordination and
  voice-clone-library browser files: 35 passed and 1 failed (the voice-clone
  route stub refused the new list request); with the list stubbed,
  voice-clone-library 5/5.
- Tree `021db05e` (after repair round 1): `pnpm exec vitest related --run` on
  the 18 changed sources, 40 files and 407 tests passed;
  `client-parakeet/client.test.ts` 12 passed; `pnpm -s check`, eslint and
  `prettier:check` passed; `python3 scripts/public-release/check_source.py`
  covers every tracked file exactly once.

Design notes: a pure `modelDownloadsEnded(list)` and
`fetchModelDownloadsEnded(apiClient)` in `query/model-download-coordination.ts`;
a `useModelDownloadsEnded()` hook in its own module, so tests that mock
`useModelAssets` still apply; one shared note, `models:downloadsEnded.note`,
beside the operator-managed note, which keeps precedence everywhere.

#### Code Review #1 Findings

Standard tier, tree `fdeac870`; the reviewer ran `vitest related` on the 15
changed sources (30 files, 235 passed) and eslint on the tests.

- P3-R1-F1 (blocking): dictation and Voice Mode still told people to install
  offline speech recognition in Settings.
- P3-R1-F2: `docs/frontend/runtime/voice.md` was missing from Phase 6.
- P3-R1-F3: in Vite development the ended note could sit beside the host-model
  commands.
- P3-R1-F4: the list-unavailable setup sentence is untrue locally (rare).
- P3-R1-F5: four comments still described offered downloads.
- P3-R1-F6: the clone flow did not map `model_downloads_ended`.
- P3-R1-F7: the new hook fetched the list even where models are
  operator-managed.

#### Code Review #1 Revisions

F1 accepted: `useDictation` and the offline worker clients ask
`fetchModelDownloadsEnded` on the missing-model path and use new
`offlineSpeechEnded`/`languageSpeechEnded` strings in all five locales, with a
client test. F2 added to Phase 6. F3, F5, F6 and F7 accepted. F4 left: rare,
and still true for hosted.

#### Code Review #2 Findings

Targeted recheck of tree `021db05e`; the reviewer reran voice-clone-library's
browser file (5 passed). All dispositions verified; no blocking findings.
P3-R2-F1 (optional, left): with offline speech turned off by a self-host
operator while a set is installed, the new error says it can no longer be
downloaded; the previous wording was equally wrong there. Phase 3 passes.

### Phase 4: Packaged notices

Review tier: high risk (packaging and redistribution inputs).

Requirements: R5.1 to R5.5.

Steps:

1. `licenses.mjs`: a group may name `licence_record_files`, read from
   `licenses/third-party/` with a strict name rule (`adapted-code.md` or
   `code-*-LICENSE.*`/`code-Apache-2.0.txt`). Add an `adapted-code` group to
   `license-sources.json` listing `adapted-code.md` and the nine upstream
   texts. Test the loader and the path rule in `runtime-packaging.test.mjs`.
2. `hosted-build-resources.mjs` copies the same group's files to
   `notices/source/third-party/`, reading the list from `license-sources.json`
   so both bundles share it.
3. `build-typescript-package.mjs` writes a package notice into `dist/` from the
   licence records for packages that contain third-party code
   (`runtime-contracts`: Hey API; `product-ui`: its adapted UI code, decision 5).
   `check-packed-artifacts.py` requires `LICENSE` and that notice in those
   tarballs, with a test.
4. `included-content-attribution.txt`: drop the LeLu paragraph; reword the
   Kenney and Brackeys lines. Record Cloud's byte copy as a follow-up.
5. `licenses/source-review.json` entries for every new or changed file;
   `licenses/README.md`, `docs/frontend/desktop/redistribution-review.md` and
   `packages/runtime-contracts/README.md` say where the notices go.

Checks: `pnpm desktop:test`; `python3 scripts/public-release/check_source.py`;
`uv run pytest -q scripts/repository-boundary` (packed-artifact tests);
`pnpm packages:pack` and a `tar -tzf` listing of the runtime-contracts tarball;
`pnpm web:build:hosted` and a listing of `web/dist-hosted/**/notices/`;
restage darwin-arm64 through the heavy slot and search the staged
`THIRD_PARTY_NOTICES.txt` for Hey API, shadcn and LeLu. Check the
`product-ui` declaration hash list is unchanged (a notice adds no `.d.ts`).

Recovery: notice files are additive data; removing the group restores the old
bundle.

Completion: commit `build(licenses)[p4]: ship the adapted-code and Hey API notices`.

Check record (from `src/frontend` unless noted):

- Red first: 7 new runtime-packaging tests and 2 packed-artifact tests failed.
- Tree `a49841d9` (initial): `runtime-packaging.test.mjs` 82 passed;
  `pnpm desktop:test` 610 passed, 14 skipped; desktop `prettier:check` and
  `prettier:workspace --check` passed; repo root
  `scripts/repository-boundary/test_packed_artifacts.py` 9 passed and ruff
  passed. `pnpm -s packages:pack` to a scratch folder: product-ui and
  runtime-contracts carry `dist/LICENSE` and `dist/THIRD_PARTY_NOTICES.md`,
  discover-client `dist/LICENSE`; `inspect_tarball` accepts all three.
  `pnpm -s web:build:hosted`: `notices/source/third-party/` holds
  `adapted-code.md` and ten upstream texts, all listed in `.hosted-build.json`.
  A darwin-arm64 stage through the heavy slot (after `pnpm install
  --frozen-lockfile`) carries the Hey API, shadcn and Letta texts and the
  `adapted-code.md` section in `THIRD_PARTY_NOTICES.txt`, no LeLu anywhere in
  its licences, and an `adapted-code` record with 11 notices.
- Tree `833ca1ed` (after repair round 1): `runtime-packaging.test.mjs` 82
  passed; `pnpm desktop:test` 610 passed, 14 skipped; Prettier checks passed;
  packed-artifact tests 10 passed; ruff passed; `check_source.py` passes;
  `docker buildx build --target web-builder` through the heavy slot exit 0.
  The earlier stage predates the repair's `license-sources.json` text change,
  so it is not evidence for the final bytes; the owner restages at G1. The
  product-ui declaration list is unchanged by construction (only a `.md` file
  is added).

#### Code Review #1 Findings

High risk, tree `8a4f5109` (the recorded tree plus plan records); the reviewer
reran the runtime-packaging tests, `desktop:test`, the packed-artifact tests,
ruff, `check_source.py` and `pnpm pack` in each package, and compared the
hosted and staged notices with the records.

- P4-R1-F1 (blocking): the production image's `web-builder` stage had no
  `licenses/third-party`, so `pnpm packages:build` would fail there.
- N1: the Included-content group still named "source-specific permissive
  terms" and packaged readme files. N2: the public wheel's `license-files`
  covers only the AGPL licence although it ships Letta and OpenAI Agents code.
  N3: the landing site's notices lack Motion Primitives' text for
  `text-shimmer.tsx`. N4: the hosted copy did not apply the strict name rule.
  N5: wording said the bundles carry every text `adapted-code.md` links. N6:
  two hand-kept maps and no product-ui checker test. N7: the Windows receipt
  list is incomplete. N8: Cloud impact and the declaration check.

#### Code Review #1 Revisions

F1 accepted: the stage copies `licenses/third-party`, verified by building it.
N1, N4 and N5 accepted; N6 partly (a product-ui test and a README note naming
both maps). N2 and N3 are follow-ups outside the agreed spec. N7 left: no
Windows release, and any Windows stage needs a fresh review. N8 recorded above.

#### Code Review #2 Findings

Targeted recheck of tree `833ca1ed`; the reviewer reran the runtime-packaging
tests (82), `desktop:test` (610 passed, 14 skipped), the packed-artifact tests
(10), ruff, `check_source.py`, called `licenseRecordFiles` with bad names, and
rebuilt the `web-builder` stage without its cache (exit 0). All dispositions
verified; no blocking findings. Phase 4 passes.

### Phase 5: Script defaults

Review tier: standard (developer-facing default with network effect).

Requirements: R4.1, R4.2.

Steps: `parakeet.py` and `sensevoice.py` default `--source` to `upstream`;
`animama` stays a choice whose help names the cut-off; update error hints,
`scripts/models/README.md` and `pocket_voices.py`'s documentation. Tests in
`tests/test_parakeet_model_sources.py` and `tests/test_sensevoice_model_store.py`
assert the default through `main()` with a fake transport.

Checks: those tests; `uv run ruff check scripts/models`; one real
`parakeet.py acquire --root <scratch store>` is optional and needs network.

Completion: commit `chore(models)[p5]: acquire speech models from upstream by default`.

Check record (repository root): red first, the two new default tests failed;
then `uv run pytest -q tests/test_model_store.py
tests/test_sensevoice_model_store.py` 76 passed, 6 skipped; `uv run ruff
check scripts/models` and `ruff format --check` on the two test files passed.
The Parakeet CLI tests live in `tests/test_model_store.py`, not the
server-source tests the step named. After the review's repairs: the same files
plus `tests/test_release_model_inputs.py` 80 passed, 6 skipped; ruff passed.
No real `acquire` was run.

#### Code Review #1 Findings

Standard tier, working-tree tree `4fc90c85`; the reviewer reran the three
test files (80 passed, 6 skipped) and ruff, refused `--source` with `path` and
`verify` by hand, simulated `--source animama` after the cut-off (exit 1 with
a connectivity message, nothing activated), and confirmed with `HEAD`
requests that all seven pinned upstream files answer `200` with their
manifest sizes through the allowed Hugging Face hosts.

- P5-R1-F1 (blocking, wording): the README's host list still named Animama's
  origin as the normal one.
- P5-R1-F2 (blocking, wording): `parakeet.py` comments said the base sets use
  Animama's objects by default.
- Non-blocking: a SenseVoice test name and its untested `--source animama`
  mapping; a colon that made the README example read as the failure; README
  lines on packaged downloads and on `pocket_cloning.py`; `README.md`,
  `model-assets.md` and `runtime-staging.md` sentences for Phase 6.

#### Code Review #1 Revisions

F1 and F2 fixed as trivial repairs (no recheck needed below the high-risk
tier; verified by the rerun above). The SenseVoice test now runs
`main([... "--source", "animama"])`; the README punctuation, packaged-download
and `pocket_cloning.py` lines are fixed; the Phase 6 documents carry the rest.
Phase 5 passes.

### Phase 6: Documentation, version and runbook

Review tier: light (documentation and a non-dependency version string); its
review folds into the final integration review.

Requirements: R6.1, R6.2, R7.1, R7.2.

Steps:

1. `docs/frontend/desktop/installation.md`: published previews, the final
   release's behavior, what still works, the end of downloads.
2. `README.md` distribution and connection paragraphs;
   `docs/safety/crisis-protocol.md` and its four translations (the desktop
   connection list); `docs/backend/operations/model-assets.md`;
   `docs/frontend/desktop/feature-packs.md` where it promises downloads;
   `docs/backend/operations/model-assets.md` startup staging sentence;
   `docs/frontend/runtime/voice.md` where it describes offered downloads;
   `docs/backend/operations/development.md` and `src/frontend/AGENTS.md` where
   they say built installs download speech sets; `contracts/hosted-web.md`
   where it names the download workflow; an amendment to ADRs 0012 and 0029
   recording the end of backend downloads. Say plainly that a new built
   self-host cannot get offline speech recognition (script-acquired sets serve
   only the development stack).
3. `docs/frontend/desktop/releases.md`: "What people see" for the final build
   (including the startup publisher check, the `release-policy.json` row and
   the smoke's update step, which the Phase 1 review named), and a new
   "Ending distribution" section with the runbook (G1 to G3 below, including
   Cloud follow-ups and rollback); `release-process.md` gates note the ended
   state, fresh receipts, pack checks that need no attestation without packs,
   offline dictation checked by upgrading a 0.1.2 preview that already has it,
   and that the VM guest smoke selects the R2 distribution.
4. `src/frontend/desktop/package.json` version `0.1.3` (decision 1); the
   runbook targets macOS only (decision 2).

Checks: link check of touched Markdown through the repository's docs test if
one covers it; `crisisProtocolTranslations.test.ts`; no Prettier on Markdown.

Completion: commit `docs(release)[p6]: describe the final release and the cut-off`.

Check record: a relative-link and anchor check over the 25 changed Markdown
files found no broken link; `pnpm exec vitest run
src/ui/safety/crisisProtocolTranslations.test.ts` 5 passed; `pnpm desktop:test`
after the version bump 610 passed, 14 skipped. Documents changed:
`installation.md`, `releases.md` (including the new Ending distribution
runbook), `release-process.md`, `feature-packs.md`, `troubleshooting.md`,
`overview.md` and `runtime-staging.md` under `docs/frontend/desktop`; the
README; the crisis protocol in five languages; `model-assets.md` and
`development.md`; `src/frontend/AGENTS.md`; `contracts/hosted-web.md`; ADRs
0010, 0012 and 0029 and the ADR index; `docs/frontend/runtime/voice.md`. Light
tier: the final integration review covers it.

## Final integration review

### Code Review #1 Findings (final integration)

Reviewed HEAD `b75c80257` against `8ae2d1f05`, reusing each phase's recorded
evidence and running no checks. R1, R2, R4, R5 and R7 met; R3 met pending the
stack screenshots; the Phase 2 round-2 repairs confirmed; installed 0.1.2 sets
stay valid in 0.1.3 (catalog and store unchanged since the 0.1.2 version
commit); the final release contacts the download host for nothing.

- FIR-F1 (blocking, wording): current documents still said packaged desktop
  and built self-host install or download speech sets (`model-assets.md`,
  `feature-packs.md`, `voice.md`, `content-and-workers.md`).
- FIR-F2 (blocking, wording): the clean-Mac, platform and staging acceptance
  steps still required a real offline speech download.
- Optional: remaining download wording in `voice.md`, `model-assets.md`,
  `i18n.md`, the profile and creation feature pages, `redistribution-review.md`
  and `releases.md`; the Pocket TTS packaged notice and its license-source
  entry naming the download URL as current; backups restored on another host
  have no models; the crisis protocol date and two translation words; the
  upgrade-test example version; the README's "Closed beta"; the runbook's
  tracking-issue step and the R2 build note; ADR amendment style.
- Follow-ups: Cloud's trial-complete "Download Animama" call to action;
  development stacks lose the downloadable voices and encoder after the
  cut-off; optional model assets in self-host backups; the Vite-development
  wording of the ended dictation error.

### Code Review #1 Revisions (final integration)

FIR-F1 and FIR-F2 fixed as trivial wording repairs, and every optional item
except the ADR style taken. Verified by the relative-link and anchor check over
the 34 changed Markdown files (no broken link),
`crisisProtocolTranslations.test.ts` (5 passed) and `runtime-packaging.test.mjs`
(82 passed, for the notice and license-source text) and desktop
`prettier:check`. The final review passes; the follow-ups go to the PR.

The full pre-push suite then failed on that candidate (`029bc90a1`): the
reworded `pocket-tts-attribution.txt` is a size- and hash-pinned file of the
browser speech model set, so `browser_speech.py` refused the store,
`test_voice_tools.py` no longer matched its generator, and the web bundle
could not resolve the browser speech assets. The notice keeps its wording (it
now describes earlier versions' downloads); changing it needs a new browser
speech manifest and is a follow-up. After the revert,
`tests/test_voice_tools.py` and `tests/test_browser_model_store.py` pass (62)
and `browser_speech.py path --offline` resolves.

One independent review of combined acceptance, including Phase 6. Then, with
the owner's go-ahead at G0, the full pre-push suite once on the final candidate
through the heavy slot (`make check-test`, `pnpm verify`,
`pnpm web:test:browser`, `pnpm prettier:check`) and `pnpm e2e:test:fast`
against a disposable built task stack. A desktop-width stack check of setup,
Settings → Voice, the voice picker and voice cloning, with screenshots for the
PR. Results go in the PR.

## Validation and acceptance

The spec's acceptance criteria, with the evidence named per phase above. Not
covered locally, and recorded as owner gates: the signed candidate's smoke and
native network check (G1), real forward upgrade from the 0.1.2 preview (G1),
and the cut-off verification (G3).

Owner gates after merge (not phases):

- **G1 Final release.** From `main` after this PR (and the chosen #838 fixes):
  stage each selected target, review `THIRD_PARTY_NOTICES.txt` and the
  inventory, record fresh receipts in `release-policy.json` (owner-only),
  dependency audits, signed candidate, smoke (expects `updates_ended`), native
  acceptance including the forward upgrade from 0.1.2, stable publication with
  the feed promoted last.
- **G2 Transition.** The feed stays up for the chosen length; preview installs
  are offered 0.1.3.
- **G3 Cut-off.** Merge a small docs PR (README, installation and release pages
  in the past tense; the landing download page); disconnect the custom domain
  from the `animama-releases` bucket; verify from outside that the feed, a DMG
  and a model URL are no longer served (purge exact URLs if one still is); keep
  `animama.ai` registered and the `downloads` name unused; revoke the R2 write
  token; record the outcome on #235. Cloud follow-ups: its landing download
  links, privacy terms, operator dashboard's download analytics, its copy of
  the Included-content attribution, and admitting `local-http` 22 and
  `runtime-contracts` 0.22.0 at its next repin.

## Idempotence and recovery

Every phase is source-only and repeatable. Staging writes only ignored
`.desktop-runtime/` output. No phase touches installed apps, user data,
release storage or the R2 bucket. Rollback before G3 is a revert; after G3,
reconnecting the custom domain restores service while the bucket exists.

## Outcomes & Retrospective

Pending.
