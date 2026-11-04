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
- [ ] Phase 1: sealed end of updates and packs.
- [ ] Phase 2: model downloads end in the backend.
- [ ] Phase 3: download controls explain the end.
- [ ] Phase 4: packaged notices.
- [ ] Phase 5: script defaults.
- [ ] Phase 6: documentation, version and runbook.
- [ ] Final integration review; full pre-push suite and fast browser journeys.
- [ ] PR opened with local evidence.
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

Check record: _to be filled._

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
   `local-http` contract minor version, and, if the `runtime-contracts`
   declarations change, bump that package as earlier bump commits do
   (`package.json` and the version line in `contracts/hosted-web.md`).
5. Development override: none. The dev stack's speech sets still come from the
   host (`ANIMAMA_PARAKEET_SOURCE=operator`).

Checks: `uv run pytest -q tests/test_model_assets.py tests/test_model_asset_sets.py
tests/test_parakeet_model_sources.py tests/test_pocket_voice_set.py` plus the
route and runtime-capability tests; `uv run ruff check`; `pnpm openapi-ts:check`
(or the repository's SDK freshness check) under Python 3.12.13.

Recovery: passing `downloads_offered=True` in the composition restores
downloads; installed assets are never touched.

Completion: commit `feat(models)[p2]: end model downloads in local compositions`.

Check record: _to be filled._

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

Check record: _to be filled._

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

Check record: _to be filled._

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

Check record: _to be filled._

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
   `docs/frontend/desktop/feature-packs.md` where it promises downloads.
3. `docs/frontend/desktop/releases.md`: "What people see" for the final build,
   and a new "Ending distribution" section with the runbook (G1 to G3 below,
   including Cloud follow-ups and rollback); `release-process.md` gates note
   the ended state and fresh receipts.
4. `src/frontend/desktop/package.json` version `0.1.3` (decision 1); the
   runbook targets macOS only (decision 2).

Checks: link check of touched Markdown through the repository's docs test if
one covers it; `crisisProtocolTranslations.test.ts`; no Prettier on Markdown.

Completion: commit `docs(release)[p6]: describe the final release and the cut-off`.

Check record: _to be filled._

## Final integration review

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
  links, privacy terms, operator dashboard's download analytics, and its copy
  of the Included-content attribution.

## Idempotence and recovery

Every phase is source-only and repeatable. Staging writes only ignored
`.desktop-runtime/` output. No phase touches installed apps, user data,
release storage or the R2 bucket. Rollback before G3 is a revert; after G3,
reconnecting the custom domain restores service while the bucket exists.

## Outcomes & Retrospective

Pending.
