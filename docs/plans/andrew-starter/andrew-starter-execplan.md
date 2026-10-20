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

- [ ] Phase 1: Michael becomes a core voice.
- [ ] Phase 2: Andrew is an Included Avatar with a portrait and licence records.
- [ ] Phase 3: the `starter:andrew` starter replaces `starter:caitlyn`.
- [ ] Phase 4: Y_0 is retired to a test fixture, and tooling and baselines cover
  Annie and Andrew.
- [ ] Phase 5: documentation, glossary and ADR wording.
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

Check record: _to be filled._
Phase commit: `feat(voice)[p1]: ship Michael as a core voice`.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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

Check record: _to be filled._
Phase commit: `feat(content)[p2]: add the Andrew Included Avatar`.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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

Check record: _to be filled._
Phase commit: `feat(starters)[p3]: replace Caitlyn with the Andrew starter`.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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

Check record: _to be filled._
Phase commit: `refactor(content)[p4]: retire Y_0 and cover Andrew in tooling`.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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
