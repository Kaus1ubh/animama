# Male starter Anima Andrew replaces Caitlyn

Source agreement: [andrew-starter-spec.md](andrew-starter-spec.md). The draft was
agreed on 2026-10-19 through the owner's discovery answers, voice choice
(Michael), VRM meta decision and VRM 0 fixture decision. Published as parent
issue https://github.com/raymond-van/animama/issues/618, which is authoritative.
Authorized scope: all phases (1-5); owner instruction 2026-10-19.

## Purpose and context

A fresh installation will create the starters Annie and Andrew instead of Annie
and Caitlyn. Andrew uses the owner's Andrew 1.0 VRM (an edited VRoid sample),
speaks with PocketTTS Michael as a core offline voice, and has a calm butler
identity. Caitlyn's Avatar `AvatarSample_Y_0` leaves Included content and remains
only as a test fixture for VRM 0. The spec's requirements R1–R9 are the contract;
this plan only describes how to deliver them.

Orientation, verified against `fd99708c` on 2026-10-19:

- **Starters.**
  - `src/backend/animama/app/services/anima_starter_service.py` holds
    `StarterAnimaSpec` and `STARTER_ANIMA_SPECS`. `ensure()` creates each
    starter, writes its Pocket voice into the new Anima's settings, and adopts a
    legacy row matched by `legacy_avatar_id` and `legacy_profile_url`.
  - The starter-id `Literal` is repeated in `app/anima_creation_contract.py`,
    `orm/anima_creation.py` (a CHECK constraint), `alembic/versions/0001_baseline.sql`
    (`ck_anima_starter_receipts_starter_identity`), the generated client
    (`types.gen.ts`, `zod.gen.ts`) and
    `scripts/repository-boundary/consumers/catalog_seed.py`.
  - The legacy Avatar seed is `alembic/seeds/02-seed-avatars.sql`. Retired rows
    are deleted there and listed in `_RETIRED_BUILTINS` in
    `src/backend/animama/product_http/routes/avatars.py`.
  - The starter content inventory is derived from the specs in
    `src/backend/animama/runtime/starter_content.py`.
- **Included content.** The backend scans `content/included`; there is no
  catalogue file. Every file needs a licence rule in
  `content/included/licenses/inventory.json`, and a missing rule is a hard
  failure. `.gitattributes` already stores `content/included/**/*.vrm` in Git LFS.
  The portrait key is `builtin:avatar-portrait:<VRM stem>`, and portraits are
  256×256 WebP files with a `.meta.json` sidecar.
- **Voices.** `scripts/voices/selection.json` is the single source of truth for
  the voice set. `scripts/voices/voices.py release` regenerates the voice and
  runtime manifests, the `pocket-voice-*` entries in
  `src/backend/animama/resources/model-assets.v1.json`,
  `src/frontend/web/src/lib/speech/pocket/voice-catalog.ts`, the desktop
  attribution notice and the `browser-pocket` licence entries.
- **Per-Avatar tooling.**
  - `INCLUDED_AVATAR_FILES` in `src/frontend/web/src/lib/avatar/motion-authoring/headlessVrm.ts`
    and the eyelid profile table in `src/frontend/web/src/lib/avatar/eyelidClosure.ts`,
    which is keyed by VRM sha256.
  - The Avatar lists and `caitlyn` aliases in `src/frontend/web/scripts`:
    `effect-render.mjs`, `animation-render.mjs`, `animation-preview.mjs`,
    `animation-reel.mjs` and `content-tune.mjs`.
  - Hand-preset and face-part expectations in tests, and the Included clip-sample
    baseline.
  - The desktop `smoke-journey.mjs` and `audit.mjs` checks.
  - Authoring skills under `.agents/skills`.

Boundaries:

- This repository only; no Cloud changes. Hosted parity is limited to the voice
  manifests, which `voices.py release` keeps consistent.
- Per AGENTS.md, there is no Alembic revision. Edit the baseline SQL and the ORM
  directly, and reset development databases.
- Do not hand-edit the generated client. Run `pnpm openapi-ts` from `src/frontend`.
- The source VRM is supplied by the owner: Andrew 1.0, 15,608,996 bytes, sha256
  `895d48c91d285ad1b63cef9acda5f84d8de6f1387a78cd5be6a914721140c98f`. Its
  location on the owner's machine is not recorded here.

Workspace: this task's worktree on branch `feat/andrew-starter`, started from
`main` at `87a2ed68` (orientation above was verified at `fd99708c`; main since
added equipped Library Gestures to the shared starter loadout). Run `git lfs pull` first, because
the worktree currently holds LFS pointer files. Use a named stack
(`./reset.sh --name andrew --base-port <free port>`) for live and browser checks,
and purge it after baseline changes, because the starter set is created on first
run.

## Progress

- [x] Phase 1: Michael becomes a core voice (review #1 repaired; Cloud follow-up
  tracked separately).
- [x] Phases 2–4 (one commit `42ffbed4`, merged with main in `0344fdd2`):
  Andrew Included Avatar, starter swap, Y_0 retired to a fixture, tooling and
  baselines on Annie and Andrew. Review #1 is repaired.
- [x] Phase 5: documentation (`150f6193`); the final integration review
  covers it.
- [ ] Final integration review, full pre-push suite and full `pnpm e2e:test`.
- [ ] Owner gates G1–G3 (listed under Validation and acceptance).

## Surprises & Discoveries

- 2026-10-19: this worktree's `.vrm` files are 133-byte LFS pointers, so any
  avatar-loading test needs `git lfs pull` first.
- 2026-10-19: Annie's eyelid-profile key in `eyelidClosure.ts` (`37a01dc…`) no
  longer matches her current VRM (LFS oid `1119bfc…`, changed by the 2026-10-16
  recolour), so Annie silently gets the default auto-measured profile. This is
  out of scope here and should be a separate fix.
- 2026-10-19: Annie's Avatar and Andrew's are both VRM 1.0. Without a fixture,
  the VRM 0 paths would lose their only test model. The owner chose to keep Y_0
  as a fixture.
- 2026-10-19: no repository tool edits VRM meta. The backend validates only
  `specVersion` and the humanoid rig (`content_gltf.py`). Any meta edit changes
  the file's sha256, which is pinned by the licence review, the eyelid key and
  the LFS oid.
- 2026-10-19: Michael is a Kyutai state rather than a VCTK speaker. Making him
  core removes him from the hosted download set (36 voices become 35) and adds
  7,275,768 bytes to the core payload.

- 2026-10-19: Phase 2 cannot commit on its own. The starter content inventory
  requires every valid tracked Included item to be in the desktop core
  partition (`test_reviewed_library_ships_in_core_without_equipping_starters`),
  and an Avatar enters core only as a starter root. Andrew is not a starter
  until Phase 3. Once Caitlyn stops being a starter, the tracked Y_0 file
  would fall into the expanded partition until Phase 4 moves it. So Phases 2,
  3 and 4 share one commit, `feat(starters)[p2-p4]`, a range form of the
  `[p#]` subject marker.
- 2026-10-20: Phase 1 missed `scripts/package-sets/application.py`, which also
  pinned 21 baseline runtime files; the Cloud agent found it (P1-F4). It is
  fixed in the Phases 2–4 commit. `BASELINE_RUNTIME_FILES = 22` now has a test
  that it equals the file count of `models/browser-runtime/manifest.json`.

## Decision Log

- 2026-10-19, owner: replace Caitlyn with a male starter, Andrew, to offer a male
  option; resetting development databases is acceptable.
- 2026-10-19, owner: remove Y_0 from Included content; Andrew takes its place in
  all tooling.
- 2026-10-19, owner: Michael becomes a core voice; Azelma stays core.
- 2026-10-19, owner: keep the shared starter loadout.
- 2026-10-19, owner: Andrew is a calm butler type, and Andrew 1.0 is final for
  now.
- 2026-10-19, owner: clean up the VRM meta (name `Andrew`, `corporation`, no
  redistribution, `prohibited` modification, `onlySeparatelyLicensedPerson`).
- 2026-10-19, owner: keep Y_0 as a test-only VRM 0 fixture.
- 2026-10-19, agent: a new starter has no legacy history, so its legacy
  adoption fields become optional (`None` skips adoption) rather than carrying
  placeholder values.
- 2026-10-19, owner: after review finding P1-F1, fix Cloud's hard-coded hosted
  baseline count in this task, as a separate Cloud issue and PR. After P2-N6,
  the same Cloud PR also switches the hosted starters to `starter:andrew`
  through a new Cloud migration. This amends
  the "no Cloud changes" boundary. Animama still has no Cloud code dependency.
- 2026-10-20, owner: the Phase 4 motion gate fired. 24 Included Gestures fail
  their motion checks on Andrew because of his wider shoulders (0.31 m against
  0.16 m) and broader torso; all Reactions pass. The owner chose to retune
  those 24 Gestures in this PR so they pass on both Annie and Andrew. No check
  thresholds or exemptions change.
- 2026-10-20, owner: after reviewing before/after renders and video, keep all
  24 original Gesture clips. The Andrew-only faults are not visible at chat
  framing. The retuned drafts are parked outside the repository for possible
  later use. `includedGestures.test.ts` lists the 24 in
  `KNOWN_ANDREW_FAILURES`: each must still pass on Annie, and stays listed
  only while it fails on Andrew. This supersedes the plan's no-exemptions
  wording for these clips; thresholds are unchanged.
- 2026-10-19, agent: make the meta edit with a small one-off script. It rewrites
  only the JSON chunk of the GLB, padded to 4 bytes, and leaves the binary chunk
  byte-identical. Reviewers verify the edit by diffing the decoded JSON.

## Phased implementation

Order: Phase 1 is independent. Phases 2, 3 and 4 run in sequence (Avatar, then
starter, then retirement), so every intermediate commit has a valid starter set.
Phase 5 comes last.

### Phase 1: Michael becomes a core voice

Review tier: high risk, because it changes packaging, model inventories and
hosted manifests.

Requirements: R4 (core delivery) and R9 (voice documentation).

Steps, from the repository root:

1. Set michael's `"delivery"` to `"core"` in `scripts/voices/selection.json`.
2. Run `uv run scripts/voices/voices.py fetch` so that
   `kyutai-states/michael.safetensors` exists in the work directory.
3. Run `uv run scripts/voices/voices.py release --model-inputs "$(python3 scripts/models/browser_speech.py path)"`.
4. Run `uv run --no-sync python src/backend/packaging/shared_catalogs.py --write`.
5. Re-acquire the local stores offline from the release's import directories:
   `python3 scripts/models/browser_speech.py acquire --offline --import-from <work>/import-store`
   and `python3 scripts/models/pocket_voices.py acquire --offline --import-from <work>/import-set`.
6. Hand-update the counts and sizes that the release does not generate (core
   payload 280,549,335 → 287,825,103 bytes; hosted voices 36 → 35):
   - `tests/test_voice_tools.py`, `tests/test_browser_model_store.py` and
     `tests/test_pocket_voice_set.py`;
   - `src/frontend/scripts/browser-runtime-assets.mjs`;
   - `scripts/repository-boundary/consumers/hosted-app/verify.mjs`.
   Check `VoiceLoadoutSection.test.tsx` for groupings by gender.

Checks:

- `uv run pytest -q tests/test_voice_tools.py tests/test_browser_model_store.py tests/test_pocket_voice_set.py`
- `uv run ruff check`
- From `src/frontend`: `pnpm web:test -- pocket` and `pnpm check`.
- `git diff --stat` shows only generated voice artifacts and the hand edits above.

Completion: Michael is listed as `delivery: "core"` and is absent from the
downloadable `pocket-voice-*` assets, the manifests verify offline, and all the
checks pass.

Recovery: the release is deterministic from `selection.json`. To undo, revert
the delivery change and rerun steps 3–5.

Check record (2026-10-19, base `38acd494`; Python 3.12.13):

- `voices.py fetch` reported 133 files plus speaker info verified. The encoded
  VCTK states were seeded from the installed voice set, and `release` checked
  each one against `encoded-states.json`. `release --model-inputs <store>`
  reported 3 core, 35 downloadable, a hosted set of 37 files, 11 model files and
  22 runtime files. `shared_catalogs.py --write`, then the offline `acquire` of
  both stores, passed.
- The new core payload is 22 runtime files and 287,825,103 bytes, measured
  from `models/browser-runtime/manifest.json`.
- Root, tree `44e86a40`:
  - `timeout 600 uv run pytest -q tests/test_voice_tools.py tests/test_browser_model_store.py tests/test_pocket_voice_set.py`
    passed.
  - Full pre-push run through `scripts/heavy-slot.py`: `make check-test` passed
    (4714 passed, 29 skipped, 243 s); `pnpm prettier:check` passed;
    `pnpm web:test:browser` passed (122/122).
  - `pnpm verify` failed: `tests/browserRuntimeAssets.test.ts` hard-coded 21
    runtime files. Fixed to 22.
- From `src/frontend`, tree `88c406be`: `pnpm verify` passed after the fix,
  and `pnpm exec vitest run tests/speech src/lib/speech src/ui/animas/VoiceLoadoutSection.test.tsx`
  passed (355/355).

Phase commit: `feat(voice)[p1]: ship Michael as a core voice`.

#### Code Review #1 Findings

Reviewed the uncommitted tree on `38acd494`, high-risk tier, round 1. An
analysis subagent reviewed the change, and a checks subagent independently
reran the affected checks on tree `68aa6422`. All of these passed:

- the voice, browser-model-store, voice-set and model-asset pytest files
  (130 passed);
- `ruff check`;
- vitest on the runtime-asset, speech and voice-loadout tests (370 passed);
- `pnpm check`;
- `shared_catalogs.py` in verify mode;
- `browser_speech.py path` and `pocket_voices.py path`, which verify against
  the new manifests;
- `pnpm -s verify:tts-assets` (22 files, 287,825,103 bytes).

Not run: hosted `verify.mjs`, which needs a built hosted candidate.

- **P1-F1 (blocking).** Cloud's artifact admission
  (`services/hosted-api/src/animama_hosted/artifacts/application.py` on Cloud
  `c8985d2`) requires exactly 21 baseline runtime files, and
  `contracts/hosted-web.md` states 21 files and 280,549,335 bytes. A hosted
  build of this candidate would fail with "Incomplete baseline runtime".
- **P1-F2 (blocking).** The `browser-pocket` revision text in
  `licenses/third-party/code-and-models.json` still says Eve and Azelma are
  bundled with 36 hosted voices.
- **P1-F3 (blocking).** The `browser-pocket` licence field in
  `src/frontend/desktop/runtime/license-sources.json` still says "2 core voice
  states", contradicting the updated source field. Both fields are rendered
  into the desktop notice.
- **Non-blocking.**
  - Phase 5 covers the stale prose counts in `pocket_voices.py`,
    `scripts/models/README.md` and `contracts/hosted-web.md`.
  - The published voice-set `ATTRIBUTION.md` is the old version. URLs are
    content-addressed, and republishing is owner-run.
  - The desktop size budget was not measured; the extra 7.3 MB is probably
    within it.

#### Code Review #1 Revisions

- **P1-F1: accepted.** On 2026-10-19 the owner chose to fix Cloud within this
  task, as a separate Cloud issue and PR. The hosted contract wording is
  updated in Phase 5. The plan boundary "no Cloud changes" is amended in the
  Decision Log. The Cloud PR must merge before a hosted deploy of an Animama
  build that contains this change.
- **P1-F2: accepted.** The text now reads "bundles Eve, Azelma and Michael and
  hosts the other 35 on-demand voices (11 Kyutai states and all 24 …)". The
  JSON parses.
- **P1-F3: accepted.** The text now reads "3 core voice states". The JSON
  parses.
- Verification: the P1-F2 and P1-F3 changes are licence prose and need no
  behaviour test. The Cloud change carries its own checks. The repair budget
  is 2 rounds; no recheck is needed for prose-only fixes, and the coordinator
  verified both with grep and a JSON parse.

### Phase 2: Andrew becomes an Included Avatar

Review tier: high risk, because it changes packaged Included content and the
licence and redistribution records.

Requirements: R2, R3 and R8.

Steps:

1. Meta edit: copy the owner's VRM into the scratch directory and confirm its
   sha256 matches the value under Boundaries. Rewrite `VRMC_vrm.meta` to the
   values in R8. Save the result as
   `content/included/avatars/Andrew_1_0.vrm` (LFS). Record the new sha256 and
   the JSON diff in this plan.
2. Portrait: on the task stack with `VITE_ENABLE_DEBUG_PANEL=true`, load the
   Avatar in `/avatar-portrait-debug` and use Capture portrait (512 px, renderer
   1, preset 2). Downscale the capture to 256×256 and save it as
   `content/included/appearances/avatar-portraits/app-avatar-model-andrew-1-0-v1.webp`.
   Add a `.meta.json` with `content_id` set to
   `builtin:avatar-portrait:Andrew_1_0`, `avatar_model` set to `Andrew_1_0`,
   width and height 256, `renderer_version` 1 and `capture_preset_version` 2.
3. Licences:
   - add rules for both files in `content/included/licenses/inventory.json`,
     recording them as an owner-authored edit of a VRoid A–Z sample preset under
     VRoid's sample and component terms;
   - record both sha256 values and the embedded meta in
     `licenses/third-party/art-vroid-review.json`;
   - update `licenses/source-review.json`, `licenses/third-party/art-NOTICES.md`
     and `licenses/README.md`;
   - correct the stale Caitlyn sentence in
     `docs/frontend/desktop/redistribution-review.md`.
4. Optionally add an eyelid profile entry for Andrew's sha256. If the owner's
   live check (G2) finds his blinks wrong, a hand-measured entry is required.

Checks:

- `uv run pytest -q tests/test_starter_content_closure.py`, plus the
  licence and source-review tests.
- `make check-test` filtered to the licence and content tests, if present.
- On the task stack, Andrew appears in Library and the creator and loads with
  no console errors.

Completion: Andrew is a verified Included Avatar with a portrait and complete
licence records. Caitlyn is still the second starter at this point.

Recovery: remove the two files and their licence entries; nothing persistent
references them yet.

Check record (2026-10-19):

- Meta edit with a one-off GLB JSON-chunk rewrite: the source sha256 is
  `895d48c9…` (15,608,996 bytes). The output, `content/included/avatars/Andrew.vrm`,
  has sha256 `fdcb8f78967be017f8adaf4debe375790d37f66109c0b5e7a7b1e246c17b2bc9`
  (15,608,968 bytes). The BIN chunk is byte-identical, and the parsed JSON is
  equal except for `VRMC_vrm.meta`. The five R8 values were changed: name
  `Andrew1.0\t` → `Andrew`, commercialUsage `personalProfit` → `corporation`,
  allowRedistribution true → false, modification `allowModification` →
  `prohibited`, and avatarPermission `everyone` → `onlySeparatelyLicensedPerson`.
- The file is named `Andrew.vrm`, not `Andrew_1_0.vrm`, because Included Avatar
  display names derive from the file stem (`content_kind_registry.py`).
- Portrait: captured with `/avatar-portrait-debug` on stack `animama-andrew` (512
  WebP), downscaled with PIL Lanczos to 256 px WebP q90, and saved as
  `app-avatar-model-andrew-v1.webp` (sha256 `b07fc187…`) with
  `content_id` `builtin:avatar-portrait:Andrew`.
- Root, Andrew files untracked:
  - `timeout 900 uv run --no-sync pytest -q tests/test_included_content_integrity.py tests/test_included_content_catalog.py tests/test_starter_content_closure.py tests/test_model_assets.py tests/test_anima_starters.py tests/test_local_content_scan.py tests/test_content_portability.py scripts/public-release/test_prepare_source.py scripts/package-sets/test_hosted_application.py`
    passed (168).
  - Full pre-push run on tree `4c13d922` passed: check-test 4714/29 skipped,
    `pnpm verify`, prettier, and browser 122/122.
- On the stack, Andrew is selectable as an Included Avatar in the creator and
  loads with no console errors.
- With the Andrew files staged, the same backend set plus the content-package
  tests found 1 failure in 152:
  `test_reviewed_library_ships_in_core_without_equipping_starters`. Andrew's
  two files land in the `expanded` partition. The invariant says desktop core
  equals self-host, so no Included item may be left for the expanded pack.
  Andrew joins core once he is a starter root, in Phase 3.

Phase commit: Phases 2 and 3 land as one commit (see the Surprises entry).

#### Code Review #1 Findings

Reviewed the uncommitted and untracked tree on `c567d481`, high-risk tier,
round 1. The analysis subagent also reran the content and packaging pytest
set (71 passed).

- **P2-F1 (blocking).** `licenses/README.md` was not updated, although the
  plan step listed it.
- **P2-N1.** Checks that list only Git-tracked files did not see the
  untracked Andrew files. Rerun them on the staged or committed tree.
- **P2-N2.** Andrew's meta has no `otherLicenseUrl`/`thirdPartyLicenses`
  pointer to the VRoid preset terms, which follows R8 ("other meta unchanged").
  Adding one is an owner decision.
- **P2-N3.** The interim docs (`content/included/README.md`,
  `runtime-staging.md`) still list only Annie and Caitlyn. Phases 4 and 5
  cover them.
- **P2-N4.** Pre-existing condition text in `art-vroid-review.json` and
  `source-review.json` still calls Caitlyn the owner's own creation, and the
  "Both embedded authors arrays" remark is outdated. Clean them up in Phase 4.
- **P2-N5.** The Phase 1 voice counts in prose belong to Phase 5.
- **P2-N6.** Cloud hard-codes `starter:caitlyn` in hosted migration 007,
  `policy.py` and tests.

#### Code Review #1 Revisions

- **P2-F1: accepted.** `licenses/README.md` now records Andrew's 2026-10-19
  approval with restrictive owner-set metadata. The coordinator verified it by
  reading it back; it is prose only.
- **P2-N1: accepted.** The checks were rerun with the files staged and caught
  the core-partition invariant above. Phases 2 and 3 are therefore committed
  together.
- **P2-N2: no change.** This follows agreed R8. It is noted for the owner.
- **P2-N3, P2-N4 and P2-N5: deferred** to Phases 4 and 5, as planned.
- **P2-N6: accepted.** On 2026-10-19 the owner extended the Cloud PR to switch
  hosted starters to `starter:andrew` through a new Cloud migration.
- Remaining repair budget: 2 rounds.

### Phase 3: the Andrew starter replaces Caitlyn

Review tier: high risk, because it changes a persistence CHECK constraint, a
shared API contract and the generated client.

Requirements: R1 and R5. It depends on Phases 1 and 2.

Steps:

1. In `anima_starter_service.py`:
   - replace the Caitlyn spec with `starter:andrew`, version 1;
   - set its display name to `Andrew`;
   - set `avatar_locator` to `avatars/Andrew_1_0.vrm` and `pocket_voice` to
     `michael`;
   - leave `legacy_avatar_id` and `legacy_profile_url` as `None`.
   Make those two fields optional, and skip the legacy-candidate lookup when
   both are `None`.
2. Draft Andrew's identity in the same section structure and length as Annie's:
   English, he/him, a calm butler, with a description of his actual outfit. The
   owner reviews it (G1).
3. Replace the `starter:caitlyn` `Literal` with `starter:andrew` in the creation
   contract, the ORM CHECK, the `0001_baseline.sql` CHECK and `catalog_seed.py`.
   Remove the `avt_caitlyn` row from `alembic/seeds/02-seed-avatars.sql`, and
   add it to the retired DELETE list if legacy installs need cleanup.
4. From `src/frontend`, run `pnpm openapi-ts`, then `pnpm openapi-ts:check`.
5. Update the backend tests: `test_anima_starters.py`, `test_owner_bootstrap.py`,
   `test_db_bootstrap.py`, `test_avatar_access.py`,
   `test_anima_avatar_mapping.py`, `test_anima_presentations.py`,
   `test_installation_personalization.py` and
   `anima_creation_service_support.py`. Add a test that rejects
   `starter:caitlyn` and a test that a new starter without legacy fields is
   created without an adoption lookup.

Checks:

- `uv run pytest -q tests/test_anima_starters.py tests/test_owner_bootstrap.py tests/test_db_bootstrap.py tests/test_starter_content_closure.py tests/test_avatar_access.py tests/test_anima_avatar_mapping.py tests/test_anima_presentations.py tests/test_installation_personalization.py`
- `uv run ruff check`
- From `src/frontend`: `pnpm check`.
- Fresh stack: `./reset.sh --name andrew --base-port <port> --purge`, complete
  first-run setup, and confirm that the roster lists exactly Annie and Andrew,
  each with a portrait, and that Andrew's settings voice is Michael.

Completion: a fresh ensure creates only Annie and Andrew, and all the checks
pass.

Recovery: development databases are reset with `--purge`. Because the
baseline is edited in place, a stale development database must be reset and
not migrated.

Check record (2026-10-20). All commands ran at the root unless noted.

- Tests:
  - `uv run --no-sync pytest -q tests/test_anima_starters.py` passed (all,
    including the new no-legacy-lookup and starter-set tests).
  - `tests/test_starter_content_closure.py` passed (22).
  - `tests/test_owner_bootstrap.py`, `tests/test_db_bootstrap.py`,
    `tests/test_avatar_access.py`, `tests/test_anima_avatar_mapping.py`,
    `tests/test_anima_presentations.py`,
    `tests/test_installation_personalization.py` and
    `tests/test_anima_creation_voice.py` passed (53).
  - `scripts/package-sets` passed (28).
  - `tests/test_alembic_fresh_install.py` passed (7) once the deliberate
    baseline SQL change was re-fingerprinted.
- Lint and client:
  - `uv run --no-sync ruff check` passed.
  - From `src/frontend`, `pnpm openapi-ts` then `pnpm openapi-ts:check`
    reported "Generated SDK is current".
- Stack `animama-andrew`:
  - `./reset.sh --name andrew --base-port 8800 --purge` was followed by
    first-run setup.
  - `/v1/animas` lists exactly Annie and Andrew.
  - Andrew's settings have `tts_pocket_anima_voice: michael`. His chat renders
    the Avatar, and his portrait shows in the sidebar.

The phase commit is shared with Phases 2 and 4.

#### Code Review #1

Reviewed with Phase 4 (shared commit); see the Phase 4 findings and revisions.

### Phase 4: retire Y_0 and cover Annie and Andrew

Review tier: high risk, because it deletes packaged content and changes the
retired-built-in lists.

Requirements: R6 and R7. It depends on Phase 3.

Steps:

1. Move `content/included/avatars/AvatarSample_Y_0.vrm` to a test-only LFS
   location, for example `tests/fixtures/assets/vrm0/AvatarSample_Y_0.vrm`, and
   add the matching `.gitattributes` rule. Delete the Y_0 portrait files and
   their licence-inventory rules. Keep or move the fixture's licence record so
   the source review still covers a file the repository tracks.
2. Add Y_0 to `_RETIRED_BUILTINS` and to the seed DELETE list, if they track
   locators.
3. Point the VRM 0 tests at the fixture path: `checks.test.ts`,
   `anatomy.test.ts`, `prepareV2.test.ts` and the others that load Y_0
   specifically as VRM 0.
4. Switch every "both Included Avatars" list to Annie and Andrew:
   - `headlessVrm.ts`;
   - in `src/frontend/web/scripts`: `effect-render.mjs`, `animation-render.mjs`,
     `animation-preview.mjs`, plus `animation-reel.mjs` and `content-tune.mjs`
     (rename the `caitlyn` alias to `andrew`) and their `.test.mjs` files;
   - in the desktop scripts: `smoke-journey.mjs` and `audit.mjs`;
   - the skill references under `.agents/skills`.
5. Regenerate or retune the per-Avatar expectations for Andrew:
   - From `src/frontend/web`, run
     `UPDATE_CLIP_BASELINE=1 pnpm exec vitest run src/lib/avatar/motion-authoring/includedClipBaseline.test.ts`.
   - Update the `handPresets.test.ts` digests and the `faceParts.test.ts`,
     `handOffsets`, `beatEditing`, `pose-creator-store.v2` and `eyelidClosure`
     expectations from the failing output, after checking each change is
     plausible.
6. Run the motion checks for every Included Gesture and Reaction on Andrew,
   using `includedGestures.test.ts` and the effects checks.

Checks:

- From `src/frontend`: `pnpm verify`.
- `node --test` for the changed script tests.
- `rg -n "AvatarSample_Y_0|starter:caitlyn|avt_caitlyn"` lists only the fixture
  path, the VRM 0 tests and historical plans.
- Review renders for Andrew from `pnpm -s effects:render` and
  `pnpm animation:render`, inspected by the agent.

Gate: if Included Gestures or Reactions fail their motion checks on Andrew,
stop and report the failing clips with their measured faults. Retuning shared
content is a scope decision for the owner and does not proceed automatically.

Completion: Y_0 is no longer Included, the VRM 0 tests use the fixture, all
per-Avatar checks pass on Annie and Andrew, and the reference search is clean.

Recovery: the fixture move is a Git rename, and the regenerated baselines are
derived from tests, so reverting the phase commit restores the previous state.

Check record (2026-10-20):

- Motion checks on all 320 Included clips: Reactions 168/168 pass on Annie,
  Andrew and the VRM 0 fixture. 24 Gestures fail on Andrew only (gate). The
  owner kept the originals, and the test lists them in `KNOWN_ANDREW_FAILURES`.
- Effects checks: there are no Andrew-only failures once each effect is posed
  with its Gesture.
- From `src/frontend/web`:
  - `node --test scripts/effects.test.mjs scripts/animation-reel.test.mjs scripts/content-tune.test.mjs`
    passed (46).
  - The clip baseline was regenerated with `UPDATE_CLIP_BASELINE=1`. Annie's
    samples and every file hash are unchanged.
  - `includedGestures.test.ts` passed (173).
- Full pre-push run through `heavy-slot` on tree `65094a9e`:
  - `pnpm verify` passed (5296).
  - `pnpm prettier:check` passed.
  - `pnpm web:test:browser` passed (122).
  - `make check-test` had 1 failure: the deliberate baseline-SQL fingerprint,
    which was then updated.
- Allowed remaining "Caitlyn" references:
  - the retirement entries in `alembic/seeds/02-seed-avatars.sql` and
    `_RETIRED_BUILTINS`;
  - the tests that retire `avt_caitlyn` and reject `starter:caitlyn`;
  - dated licence history in `art-vroid-review.json` `owner_confirmation`;
  - fixture provenance in `licenses/README.md`, `art-NOTICES.md` and
    `content/included/README.md`;
  - generic test names.

The phase commit is shared with Phases 2 and 3.

#### Code Review #1 Findings

Reviewed `0344fdd2` (tree `65094a9e`), covering Phases 3 and 4, the P2-F1
repair, P1-F4 and the merge resolution. High-risk tier, round 1. The reviewer
reran these on that tree, and all passed:

- `ruff check` on the touched backend files;
- the package-set unittest (17);
- `generate-openapi-client --check`;
- `node --test` on the script tests (46);
- vitest on eyelid, legs and arms (136).

- **P34-F1 (blocking).** The shipped `content/included/licenses/inventory.json`
  provenance for the former Chibi 2 model still said "Former Caitlyn model",
  which breaks R6. New licence-history text also names Caitlyn. The Phase 4
  search pattern could not detect either.
- **Non-blocking:**
  - Stale text:
    - `licenses/README.md` voice counts;
    - `avatar-lipsync.md` "Avatar A/Y" wording;
    - skill measurement notes in `human-movement.md` and `clip-format.md`.
  - Plan records: the commit note left out Phase 4, and P1-F4 was not
    recorded.
  - Spec/issue R7 acceptance wording predates the `KNOWN_ANDREW_FAILURES`
    decision.
  - The `arms.test.ts` precondition was widened to 0.1 m for every rig.
  - There is no guard against stale entries in the exempt and known-failure
    lists.
  - Some composed editing tests moved from Y_0 to Andrew, so their VRM 0
    coverage is gone. The underlying VRM 0 code keeps fixture coverage.
  - The backend starter swap, VRM meta and merge resolution were checked with
    no defects.

#### Code Review #1 Revisions

- **P34-F1: accepted.** The two shipped provenance strings now say "Former
  starter model". The remaining historical and retirement mentions are
  recorded above as allowed references, and the spec and issue were amended
  the same way.
- **Stale text: accepted.** The licence README counts (3 core, 35 on demand),
  the lipsync wording (Annie and Andrew, both VRM 1) and both skill notes are
  fixed.
- **Plan records: accepted.** They are updated in this plan.
- **R7 wording: accepted.** The spec and issue #618 were amended to describe
  `KNOWN_ANDREW_FAILURES`.
- **`arms.test.ts` precondition: accepted.** It is now 0.06 m for Annie and the
  fixture and 0.1 m for Andrew.
- **List guard: accepted.** A new test checks that every exempt or
  known-failure slug names an existing Included Gesture.
- **Moved editing tests: no change.** VRM 0 coverage of the underlying solvers
  remains through the fixture.
- Verification:
  - vitest `arms.test.ts` and `includedGestures.test.ts` passed (294).
  - `tests/test_alembic_fresh_install.py` passed (7).
  - The prose fixes were read back.
- Remaining repair budget: 1 round. A targeted recheck is part of the final
  integration review.

### Phase 5: documentation

Review tier: light, because the changes are documentation only. The final
integration review covers this phase.

Requirements: R9, and the documentation parts of R6 and R8.

Steps:

- Update the current docs: `content/included/README.md`,
  `docs/backend/features/custom-animas-and-content.md`,
  `docs/backend/architecture/data-model.md`,
  `docs/frontend/desktop/installation.md` and `runtime-staging.md`,
  `docs/frontend/runtime/avatar-animation.md`, `docs/frontend/runtime/voice.md`,
  `docs/frontend/desktop/feature-packs.md`,
  `docs/backend/operations/model-assets.md`, `contracts/hosted-web.md`,
  `scripts/models/README.md` and `src/frontend/desktop/runtime/license-sources.json`.
- Update the comments in `pocket_voices.py` and `browser_speech.py`.
- Check that ADR 0010 still reads "both starter voices", and add only the
  third core voice if its wording needs it.
- Add a "Starter Anima" glossary entry if the docs need the term.

Checks: `pnpm prettier:check`, or the repository's docs formatting check, and
link checks if configured.

Phase commit: `docs(starters)[p5]: describe the Annie and Andrew starters`.

## Final integration review

The final review covers the combined acceptance of R1–R9 and folds in Phase 5.
It reuses the phase check records. After its repairs, run the full pre-push
suite once on the final candidate, as a heavy job: `uv run pytest -q`,
`uv run ruff check`, `make check-test`, `pnpm verify` and `pnpm web:test:browser`.
Then run the full `pnpm e2e:test` (about 35 minutes) against a disposable built
stack, as AGENTS.md requires for changes to Animas and content. Record the
results in the PR.

## Validation and acceptance

Spec acceptance mapping:

- R1: Phase 3 backend tests, plus the fresh-stack roster check.
- R2 and R3: Phase 2 and Phase 3 stack checks, plus owner gate G2.
- R4: Phase 1 tests, plus G3.
- R5: owner gate G1.
- R6: Phase 4 reference search.
- R7: `pnpm verify`, the motion checks and the review renders.
- R8: the licence tests and the meta diff recorded in Phase 2.
- R9: the final review.

Owner gates (recorded in the PR; these are not phases):

- **G1:** the owner approves Andrew's identity text.
- **G2:** the owner checks Andrew live on the task stack: he blinks, emotes,
  lip-syncs and gestures without clipping, and the portrait framing looks
  right.
- **G3:** on a fresh installation with no downloaded voices and no network
  voice installs, Andrew speaks with Michael.

## Idempotence and recovery

- Every phase is a single revertible commit.
- The voice release and the clip baseline are regenerated deterministically
  from source.
- Development databases are rebuilt with `./reset.sh --purge`. No migration is
  provided, because an installation that still holds Caitlyn is unsupported and
  must be reset (spec constraint).
- The owner's original VRM stays untouched; only the meta-edited copy is
  committed.
- Tear down the task stack once its last check is done.

## Outcomes & Retrospective

_To be written at completion._
