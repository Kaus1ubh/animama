# Avatar portraits that match the chat canvas

Source agreement: [avatar-portraits-spec.md](avatar-portraits-spec.md),
accepted by the owner on 2026-10-22 with the proposed answers to Q1–Q7.
Parent issue: https://github.com/raymond-van/animama/issues/658
Authorized scope: the whole plan (Phases 1–4), authorized 2026-10-22.

## Purpose and context

Every Avatar portrait should look like the Avatar on the chat canvas, be 512²,
and exist for Local Avatars as well as Included ones. Requirement IDs (R1–R14)
refer to the spec.

Starting source: `main` at `4354978f`. Task branch `feat/avatar-portraits` in
the worktree assigned to this task. One PR in this repository; no Cloud change.

Relevant code:

- Capture: `src/frontend/web/src/lib/avatar/portrait/` —
  `captureAvatarPortrait.ts` (render, read-back, WebP encode),
  `generationCoordinator.ts` (one attempt per key per session, coalesced
  subscribers), `framing.ts`, `expression.ts`. Chat look sources:
  `lib/avatar/enhanced-rendering/` (`applyAvatarToneMapping`,
  `isEnhancedRenderingEnabled`, `CHAT_CANVAS_GRADE`) and
  `ui/main/canvas/sceneCameraPresets.ts` (`avatarSceneLights`). Other caller:
  `src/frontend/web/scripts/effect-render/render.ts` (effect thumbnails) and
  the development harness `ui/create/CreateAnimaAvatarPreviewScene.tsx`.
- Create Anima: `ui/create-anima/CreateAnimaStage.tsx` (`CreationStageActor`
  loads the Avatar and reports `ready`), `CreateAnimaAvatarStep.tsx` (upload →
  save → `onSelect` reloads the stage as a Local Avatar),
  `useCreateAnimaController.ts`.
- Save: `PUT /v1/avatar-content/{item_id}/portrait` in
  `src/backend/animama/product_http/routes/typed_content.py` →
  `ContentSaveService.save_standalone_stream(portrait_source=...)` in
  `app/services/content_save_service.py`, which writes metadata `name`,
  `avatar_model`, `presentation.avatar_item_id`, `width`, `height` and
  canonicalizes through `canonicalize_avatar_portrait` /
  `_encode_bounded_webp` in `app/services/content_image.py`.
- Portrait lookup exists three times: `routes/avatars.py`
  (`list_avatar_catalog`: exact `presentation.avatar_item_id`, then Included
  stem), `app/services/content_package_export.py` (`_portraits`, same rule) and
  `adapters/repositories/sqlalchemy/anima_presentation_repo.py` (Included stem
  only). `PyAvatarContent` responses already get a per-request overlay for face
  parts (`_overlay_face_parts` in `typed_content.py`); the portrait field can
  follow that pattern.
- Presentation bound: `PyRuntimeImageReference` in
  `app/contracts/anima.py` caps width/height at 256, mirrored in the
  generated `zod.gen.ts`, and `/v1/animas` uses a response validator.
- Included portraits: `content/included/appearances/avatar-portraits/`
  (`app-avatar-model-andrew-v1.*`, `app-avatar-model-avatarsample-a-1-new-v1.*`),
  recorded in `content/included/licenses/inventory.json`,
  `licenses/source-review.json` and `licenses/third-party/art-vroid-review.json`.

Boundaries: backend changes under `src/backend` and `docs/backend`; frontend
under `src/frontend` and `docs/frontend`; SDK regenerated only through
`pnpm openapi-ts`; no Alembic revision (none is expected: portraits are
ordinary catalog items).

Related work: `perf/starter-vrm-optimization`
(`docs/plans/starter-vrm-optimization/`) re-encodes the starter VRMs, replaces
Andrew with a new VRoid export and changes only Annie's VRM metadata. Its Phase
4 captures Andrew's portrait with whatever generator is on `main`. Both plans
touch `app-avatar-model-andrew-v1.*` and the `portrait_sha256` entries in
`licenses/third-party/art-vroid-review.json`; whichever merges second rebases
and regenerates. Portraits link to models by file stem, so links survive either
order.

## Progress

- [x] Owner review of spec and plan (Q1–Q7): accepted 2026-10-22.
- [x] Phase 1: chat-look 1024 → 512 capture (`9b7e529f`; review passed after one repair round).
- [ ] Phase 2: one portrait per Avatar in the API (`122a1887`; independent checks passed, analysis review pending).
- [ ] Phase 3: background capture in Create Anima (`651e9e0f`; review pending).
- [ ] Phase 4: regenerated Included portraits (Annie only; Andrew waits for his replacement model; owner visual gate open).
- [ ] Final integration review, full pre-push suite, PR.

## Surprises & Discoveries

- 2026-10-22: `PyRuntimeImageReference` and its zod schema cap presentation
  images at 256². Correction found in Phase 2: the list route returns a plain
  `JSONResponse` and `useAnimas` calls the SDK with `responseValidator:
  undefined`, so neither side enforced the cap at run time; 512² portraits
  (and larger custom Profile images) were never rejected. R3 still aligns the
  published contract with the stored portraits.
- 2026-10-22: Local Appearance lists (`useAppearanceImages`) include every
  Local Appearance, so auto-saved portraits would appear among Profile and
  Background choices (spec Q5).
- 2026-10-22: the effect review renderer reuses `captureAvatarPortrait` for
  Library thumbnails (spec Q7).
- 2026-10-22: `CHAT_CANVAS_GRADE` is `brightness(1.04) contrast(0.92)
  saturate(0.88)`, a linear colour transform that a fragment shader can apply
  directly (spec Q4).

## Decision Log

- 2026-10-22, owner: 512² stored portraits in the chat canvas's enhanced look;
  capture in Create Anima; this work regenerates the Included portraits.
- 2026-10-22, owner (relayed by the starter VRM optimization session): Andrew
  is replaced by a new model shipped through the starter VRM plan; do not
  regenerate his portrait from the current `Andrew.vrm`. Annie's model is
  unchanged, so her portrait is regenerated here.
- 2026-10-22, agent (implementation detail within Q4, to report to the owner
  with the PR): the grade runs on the CPU over the read-back pixels instead of
  in the output shader. Q4's aim, no dependence on the canvas `filter`
  property, is met either way; the CPU version is a pure function with exact
  unit tests, and costs about 12 ms per 1024² capture.
- 2026-10-22, owner accepted the agent proposals: Q1 `method=5`; Q2 follow the setting;
  Q3 no embedded-thumbnail fallback; Q4 shader grade and 8-bit fallback; Q5
  hide generated portraits from Appearance lists; Q6 defer deletion; Q7 one
  pipeline for portraits and effect thumbnails.

## Phased implementation

### Phase 1: Chat-look 1024 → 512 capture

Review tier: standard. Behaviour change in one capture module and one
canonicalizer; no schema or API shape change.

Requirements: R1, R2; Q1 and Q4 as decided.

Steps:

1. Port the prototype's capture changes onto the branch: chat lights from
   `avatarSceneLights(enhanced)`, `applyAvatarToneMapping`, a 4x MSAA
   half-float scene target, `OutputPass` into an 8-bit target, read-back, live
   state restored in `finally`, versions 2/3, default size 1024.
2. Per Q4, apply the grade in the output pass's shader (CSS filter-function
   matrices for brightness, contrast and saturate on sRGB values) instead of a
   2D canvas filter, and choose an 8-bit scene target when the renderer lacks
   `EXT_color_buffer_float`. Tests: grade applied when enhanced and absent when
   classic, fallback target type, state restored on failure and abort.
3. Backend: admit 1024², store 512²; per Q1 set the shared WebP encoder to
   `method=5`. Update `tests/test_content_image.py`,
   `tests/test_creation_content_admission.py` and
   `tests/anima_creation_service_support.py` as in the prototype.
4. Measure against the chat reference for both Included Avatars with the
   prototype's bench (headless Chromium, ANGLE Metal): mean |Δ| RGB ≤ 3/255
   (R1). Record capture and save timings. If available, run the same capture
   in Playwright WebKit and record whether it succeeds and which path it took.
5. Update the two prototype doc paragraphs
   (`docs/backend/architecture/local-content-storage.md`,
   `docs/frontend/runtime/avatar-animation.md`) and the portrait sentence in
   `docs/backend/architecture/http-api.md` (512 → 1024 source, 256 → 512
   stored).

Checks: `uv run pytest -q tests/test_content_image.py
tests/test_creation_content_admission.py tests/test_content_portrait_mutation_replay.py`,
`uv run ruff check`; from `src/frontend`: `pnpm web:test -- portrait`,
`pnpm check`, `pnpm web:lint`.

Completion: checks pass, reference difference recorded within bound, review
passes. Commit `feat(avatar)[p1]: capture portraits in the chat canvas look`.

Recovery: capture is client-only and saves are unchanged in shape; reverting
the phase restores the old look. 256² portraits saved before this phase stay
valid.

Starting source: `cabe6d43`. Implementation notes:

- The grade is applied on the CPU to the read-back 8-bit sRGB pixels
  (`applyChatCanvasGrade` in `lib/avatar/enhanced-rendering/backdropGlow.ts`,
  the CSS Filter Effects brightness, contrast and saturate formulas in order,
  clamped, alpha unchanged) rather than in the output shader. It meets Q4's
  aim (no canvas `filter`), is a pure tested function and costs about 12 ms at
  1024². `CHAT_CANVAS_GRADE` is now built from the same factors.
- The scene target is half-float when the renderer reports
  `EXT_color_buffer_float` or `EXT_color_buffer_half_float`, else 8-bit.
- The shared WebP encoder uses `method=5` (Q1).

Check record (tree `bb4609b9`, working tree on `cabe6d43`):

| Command | Directory | Result |
| --- | --- | --- |
| `uv run pytest -q -p no:cacheprovider tests/test_content_image.py tests/test_creation_content_admission.py tests/test_content_portrait_mutation_replay.py` | root | 34 passed |
| `uv run ruff check src/backend tests` | root | passed |
| `uv run ruff format --check` (4 touched Python files) | root | formatted |
| `npx vitest run src/lib/avatar` | `src/frontend/web` | 1237 passed, 1 skipped |
| `pnpm -s check` | `src/frontend` | passed |
| `npx eslint src/lib/avatar/portrait src/lib/avatar/enhanced-rendering scripts/effect-render` | `src/frontend/web` | passed |
| `npx prettier --check` (touched TypeScript) | `src/frontend/web` | formatted |

Measurement (Apple M5, Playwright headless Chromium with ANGLE Metal, the
prototype bench, n=1 per variant): mean |Δ| RGB against a chat-canvas render
with the same framing is 1.03–1.20/255 for the 512 capture and 1.21–1.51/255
for 1024 → 512 (Andrew, Annie), against 11.7–19.2/255 for the current
capture: within the 3/255 bound. A warm 1024 capture takes about 22 ms to
render and 70 ms to grade and encode. Backend canonicalization of a 1024²
capture now takes 32–35 ms in total (the `method=6` encode took 2.5–2.8 s).
Playwright WebKit is not installed on this machine, so no WebKit or Safari
check was run.

#### Code Review #1 Findings

Reviewed source: the uncommitted Phase 1 files on `cabe6d43` (Phase 2 edits
started in other files during the review). Standard tier, initial review. The
reviewer reran the starter, creation, catalog and package backend tests (130
passed on the mixed tree) and `node --test
scripts/effect-thumbnails.browser.test.mjs` (2 passed).

- P1-1 (blocking): blending over the transparent clear and the MSAA resolve
  leave premultiplied colour in the scene target; the output pass tone-mapped
  and encoded it, and the result was stored as straight alpha, so antialiased
  edges and translucent parts came out darker than on the chat canvas.
- P1-2 (blocking): the CPU grade departs from the plan's shader grade without
  a Decision Log entry.
- P1-3 (blocking): the failure test did not check the renderer state this
  phase changes (render target, tone mapping, exposure, colour space), and no
  test cancelled after allocation.
- Non-blocking: the Included starter fixture stored a 1024² image under
  512×512 metadata; `createChatLights` repeats the effect renderer's
  `addChatLights`; the effect template README claims re-renders reproduce old
  pixels; the filter math, state handling, float fallback and callers were
  confirmed correct.

#### Code Review #1 Revisions

- P1-1 fixed: `createStraightAlphaOutputPass` divides colour by alpha before
  tone mapping (guarded against an upstream shader change), with a unit test.
  Bench rerun (same setup): edge pixels (alpha 5–250) of the 512 capture went
  from 12.4 and 9.4/255 darker than the chat reference (Annie, Andrew) to 1.8
  and 5.0/255 lighter; mean |Δ| over all pixels is 0.93–1.44/255.
- P1-2 fixed: Decision Log entry added; the owner is told in the PR.
- P1-3 fixed: `expectStageRestored` checks the scene's children and
  visibility, render target, tone mapping, exposure, colour space, autoClear,
  scissor test, clear colour and disposal after a render error and after a
  cancellation inside the capture.
- Fixture: the Included starter portrait is written at 512²
  (`image_bytes(portrait_size=512)`). README: notes the new look and to
  re-render all templates together. `addChatLights` reuse is left as is: it is
  a review script with its own light setup.
- Repair budget: two rounds remain; P1-1 gets a targeted recheck.

Check record after the revisions (staged Phase 1 tree `cbe7b9b6`; backend run
from an export of that tree with `PYTHONPATH` pointing at it, frontend run in
the worktree, which held no other frontend changes):

| Command | Directory | Result |
| --- | --- | --- |
| `pytest -q -n 2` on `test_content_image`, `test_creation_content_admission`, `test_content_portrait_mutation_replay`, `test_product_http_typed_content`, `test_typed_content_save_replay`, `test_starter_content_closure`, `test_anima_starters`, `test_anima_creation` | export of `cbe7b9b6` | 128 passed, 3 failed: the tracked-checkout tests, which need the LFS model files the export lacks |
| the 3 tracked-checkout tests | worktree | 3 passed |
| `pnpm -s check` | `src/frontend` | passed |
| `npx eslint src/lib/avatar scripts/effect-render` | `src/frontend/web` | passed |
| `npx prettier --check` (touched files) | `src/frontend/web` | formatted |
| `npx vitest run src/lib/avatar` | `src/frontend/web` | 1239 passed, 1 skipped |
| `python3 ../../../scripts/heavy-slot.py -- node --test scripts/effect-thumbnails.browser.test.mjs scripts/animation-preview.browser.test.mjs scripts/animation-reel.browser.test.mjs` | `src/frontend/web` | 12 passed (started before the P1-1 revision; the reviewer's own effect-thumbnail run also passed) |

Phase commit: `9b7e529f` `feat(avatar)[p1]: capture portraits in the chat canvas look`.

#### Code Review #2 Findings

Targeted recheck of `9b7e529f` (repair round 1). P1-1, P1-2 and P1-3 verified
fixed; no blocking findings. The reviewer reran `node --test
scripts/effect-thumbnails.browser.test.mjs` on the repaired pipeline: 2
passed. Non-blocking: the output pass was created after the render targets, so
its guard could leak them; the README sentence described the change rather
than current behaviour; the 8-bit fallback magnifies quantisation at the
faintest edges (accepted under Q4).

#### Code Review #2 Revisions

Both trivial fixes are carried in the Phase 2 commit: the pass is created
before the targets, and the README describes current behaviour. Verified by
rerunning `npx vitest run src/lib/avatar/portrait` (see the Phase 2 check
record). Result: Phase 1 passes; one repair round used.

### Phase 2: One portrait per Avatar in the API

Review tier: high risk. Changes the public HTTP contract and generated
client, content persistence (replace in place), ownership checks and
concurrent saves.

Requirements: R3, R4, R5, R9, R12. Depends on nothing in Phase 1 except the
512² size used in tests.

Steps:

1. Extract one portrait resolver (exact `presentation.avatar_item_id` for
   owner-visible valid Appearances, then Included-only stem fallback, ambiguity
   reported as today) and use it from `list_avatar_catalog`, export
   `_portraits` and the new `PyAvatarContent` overlay. Existing export/import
   portrait tests must pass unchanged (R12).
2. Upsert (R4): in the portrait save, under a lock keyed by the Avatar item,
   find the caller's existing Local portrait for that Avatar and replace it in
   place (its catalog item and expected revision); otherwise create one. The
   server derives the entry name from the Avatar name, so the client no longer
   chooses it (drop or ignore `entry_name`; the only caller is in this repo).
   Record `avatar_revision_sha256`, `renderer_version` and
   `capture_preset_version` in the portrait metadata; the latter two arrive as
   form fields validated as small positive integers.
   Tests: second save replaces (one item, new revision), idempotent replay,
   concurrent saves end with one item, stale Avatar revision `409`, another
   owner's Avatar `404`, non-Avatar `404`.
3. Portrait field (R5): add an optional `portrait` object to
   `PyAvatarContent` (`url`, `avatar_revision_sha256` or null for Included,
   `renderer_version`, `capture_preset_version`), filled by the overlay for list,
   get and save responses. Tests for Local with, Local without and Included.
4. Presentation (R3, R9): raise `PyRuntimeImageReference` width/height to 512;
   verify whether a > 256² custom Profile image fails today and record it; if
   so, decide with the owner whether to raise the bound to the canonical image
   maximum instead. Add the exact Local join to `anima_presentation_repo.py`
   (portrait whose `presentation.avatar_item_id` equals the Anima's Avatar
   catalog item, owner-scoped, valid), preferring it over the stem match.
   Repository tests in `tests/test_anima_presentations.py`.
5. Regenerate the SDK from `src/frontend` with `pnpm openapi-ts` (use the
   Python 3.12 venv) and update the frontend call sites that send
   `entry_name`.
6. Update `docs/backend/architecture/http-api.md` (portrait endpoint, Avatar
   content field, presentation bound) and
   `docs/backend/features/custom-animas-and-content.md` if its portrait
   sentence changes.

Checks: targeted pytest for the touched tests plus
`tests/test_avatar_content.py tests/test_typed_content_apis.py
tests/test_product_http_typed_content.py tests/test_content_package_export_review.py
tests/test_content_package_import_avatar.py`; `uv run ruff check`;
`pnpm check` and `pnpm web:test` for the SDK consumers. High risk: the full
pre-push suite (`python3 scripts/heavy-slot.py -- make check-test`, plus
frontend `pnpm verify` and `pnpm prettier:check`) before review, and a checks
subagent reruns the affected checks.

Completion: checks pass, review passes, each repair rechecked. Commit
`feat(avatar)[p2]: keep one portrait per Avatar`.

Recovery: no schema change. Duplicate portraits saved before this phase are
reported ambiguous by export as today; a development database may be reset at
the owner's discretion.

Starting source: `9b7e529f`. Implementation notes:

- The save writes `appearances/avatar-portrait-{avatar item id}.webp`
  (`avatar_portrait_entry_name`), replacing the portrait there in place. (Review
  revision: the first version also adopted any other exact portrait; see P2-1.)
  The client no longer sends `entry_name`; it sends `renderer_version` and
  `capture_preset_version`.
- Only Local Avatars are captured: an Included Avatar returns
  `409 portrait_requires_local_avatar`. Included Avatars ship their portraits,
  and a per-Avatar destination for an Included Avatar would be shared by every
  owner of an installation.
- Portrait metadata: `presentation` holds `avatar_item_id` and
  `avatar_revision_sha256`; `renderer_version` and `capture_preset_version`
  are new optional `AppearanceDocumentV1` fields in the catalog projection.
- `app/services/avatar_portraits.py` (`portrait_matches`,
  `portrait_image_url`) replaces the two copies in the Avatar catalog route and
  the export; the typed Avatar routes use it for `portrait`.
- The Anima presentation join ranks exact owner-visible portraits per Avatar
  catalog item and prefers them over the Included stem match. The stem match
  still applies to any Avatar whose file stem names an Included portrait, as
  before.
- `PyRuntimeImageReference` allows 512 (R3); the SDK was regenerated with
  `pnpm openapi-ts`. No frontend caller sent `entry_name`. The spec's R3
  sentence that the browser rejects the response is stale (see Surprises).
- Unverified risk: package import may give two exact portraits to one Avatar
  when it reuses an identical Avatar; export then reports
  `package_portrait_ambiguous`, as before. Not changed here.

Check record (full pre-push suite through `scripts/heavy-slot.py`, tree
`c4420e82`, i.e. `9b7e529f` plus the Phase 2 working tree and the two Phase 1
Review #2 fixes, with the Phase 3 drafts set aside):

| Command | Directory | Result |
| --- | --- | --- |
| targeted pytest while implementing (`test_content_portrait_mutation_replay`, `test_avatar_portraits`, `test_creation_content_admission`, `test_anima_presentations`, `test_product_http_typed_content`, `test_typed_content_save_replay`, `test_avatar_content`, `test_typed_content_apis`, `test_content_retirement_admission`, `test_product_http_avatars`, package export/import, starters, closure, preview batch) | root | all passed (50 + 91 + 8 + 3) |
| `make check-test` | root | 4730 passed, 29 skipped, 1 failed: `test_shared_product_contracts::test_every_server_schema_module_supports_star_import` (the compatibility module `server/schemas/typed_content.py` lacked `PyAvatarPortrait`) |
| fix, then `uv run pytest -q tests/test_shared_product_contracts.py` and `uv run ruff check` | root | 2 passed; clean |
| `pnpm verify` | `src/frontend` | passed (5401 web tests passed, 1 skipped) |
| `pnpm prettier:check` | `src/frontend` | passed |
| `pnpm openapi-ts`, `pnpm -s packages:build` | `src/frontend` | regenerated SDK, built |


Phase commit: `122a1887` `feat(avatar)[p2]: keep one portrait per Local Avatar`.

#### Code Review #1 Findings

Reviewed source `122a1887` (tree `26951bb8`), high-risk tier, initial review:
one analysis subagent and one checks subagent.

Checks subagent (clean tree `26951bb8`): the 17 listed pytest files, 146
passed; 23 further files importing the changed modules, 468 passed; `ruff
check` and `ruff format --check` clean; `vitest` on the portrait and contract
tests, 39 passed; `pnpm -s check` passed; `pnpm -s openapi-ts:check`: SDK
current. Result: pass. (This also covers the re-export fixed after the
implementer's `make check-test`.)

Analysis findings:

- P2-1 (blocking): adopting "an older exact portrait" redirected the save to
  any exact Appearance of the Avatar, including imported `.png` or
  descriptor-backed ones; the canonical WebP then failed validation on every
  attempt.
- P2-2 (blocking): no test for the Included `portrait` field, a stale capture
  with an existing portrait, a non-Avatar item or the adoption path.
- P2-3: the new projection keys were always present, so every Appearance's
  revision would change once.
- P2-4: replacing in place changes an Anima that bound the portrait as Profile
  or Background; adopting an imported item dropped its provenance.
- P2-5: the writer preferred its destination while readers take the lowest id.
- P2-6: comments and plan wording on locking and "oldest" were inaccurate (all
  of `apply()` runs under the Local source lock; ids are random).
- P2-7: the presentation test could not detect a missing owner filter.
- P2-8: Preview and Save Avatar responses do not carry `portrait`; docs said
  all responses do.
- P2-9: `http-api.md` claimed the 512 bound holds for custom Profile images.
- P2-10, P2-11: catalog duplicate selection now takes the lowest id (agrees
  with SQL); overlay loads the visible catalog per request (acceptable).
- P2-12: an exception between allocating the pass and the `try` could leak;
  comment wording.
- Verified: SDK diff, replay digest shape, Included rejection, another owner's
  Avatar `404`, presentation SQL (no row multiplication, owner/scope filter,
  custom Profile image still wins).

#### Code Review #1 Revisions

- P2-1, P2-4, P2-5 fixed together: the save replaces only the portrait at
  `appearances/avatar-portrait-{id}.webp`. Another exact portrait of the
  Avatar is kept and the save returns `409 avatar_portrait_exists`; an
  unrelated item at the destination returns `409 content_path_exists`. So
  there is never more than one exact portrait from saves and readers agree.
  Phase 3 never recaptures an Avatar whose portrait has no capture revision.
  Replacing the Avatar's own portrait still updates an Anima that bound that
  exact Appearance (now documented); Q5 keeps generated portraits out of the
  Profile and Background pickers.
- P2-2 fixed: tests for the Included Avatar's shipped portrait (and a Local
  Avatar not borrowing it by name), a stale capture leaving the current
  portrait unchanged, an imported PNG exact portrait being kept with `409`,
  and a non-Avatar item `404`. Concurrency is not tested with two sessions: the
  Local source lock serializes the lookup and write, as the comment now says.
- P2-3 fixed: the version keys are projected only when set, so only portraits'
  revisions change. Cloud's Included seed still needs its normal rebuild for
  the new Included portrait.
- P2-6 fixed: comment and plan wording.
- P2-7 fixed: the other owner's portrait now sorts first.
- P2-8 fixed by narrowing the docs and contract comment to List and Get.
- P2-9 fixed in `http-api.md`; raising the schema bound to the canonical image
  maximum is a follow-up for the owner.
- P2-12: comment reworded; the remaining window holds no GPU allocation and is
  left as is.
- Checks after the revisions (working tree on `4514e905`): 23 backend files,
  237 passed; `ruff check` clean. Repair round 1 recheck: pending.

### Phase 3: Background capture in Create Anima

Review tier: standard. Frontend behaviour using the Phase 2 contract.

Requirements: R6, R7, R8, R10, R11 (per Q5). Depends on Phases 1 and 2.

Steps:

1. Give `CreateAnimaStage` the selected Avatar's source and `portrait` state
   from the controller's Avatar list. In `CreationStageActor`, after `ready`
   and a short settle (spring bones at rest), if the Avatar is Local and its
   portrait is missing or from another revision, run
   `AvatarPortraitGenerationCoordinator.run` with key
   `<item_id>:<revision_sha256>`, a 15 s timeout signal combined with the
   actor's abort signal, capture from the stage renderer/scene/camera, then
   PUT the blob with the expected Avatar revision.
2. Never await it from navigation, draft or submission paths. On success
   invalidate the Avatar content, Avatar catalog and Anima list queries; on
   failure log and stop.
3. Per Q5, filter generated portraits (Appearances with
   `presentation.avatar_item_id`) from `useAppearanceImages`.
4. Tests (`CreateAnimaStage.test.tsx` and a coordinator wiring test): runs
   once for Local without a current portrait; not for Included, unsaved file
   or current portrait; timeout and source change abort without a save;
   submission proceeds while capture is pending; a failed attempt is not
   retried for the same revision.
5. Browser check on a task stack (`./reset.sh --name portraits --base-port
   <free port>`, `git lfs pull` first): upload a VRM in Create Anima, save it,
   finish creation, and confirm the portrait in the Library and Anima list
   without a reload; confirm no stage flash. Record the stack URL. Run
   `pnpm e2e:test:fast` from `src/frontend` through the heavy slot against a
   disposable built stack.
6. Update `docs/frontend/features/avatar-releases-and-appearance.md` (Create
   Anima now captures portraits) and `docs/frontend/features/library.md` if
   needed.

Checks: `pnpm web:test` for touched specs, `pnpm check`, `pnpm web:lint`,
browser evidence above.

Completion: checks and browser evidence recorded, review passes. Commit
`feat(create)[p3]: capture a portrait for Local Avatars in Create Anima`.

Recovery: the capture is fire-and-forget; disabling the hook leaves creation
unchanged.

Starting source: `122a1887`. Implementation notes:

- `ui/create-anima/createAnimaPortrait.ts`: `creationPortraitTarget` (a saved
  Local Avatar without a portrait, or with one captured from another revision;
  shipped and imported portraits, which carry no capture revision, are kept),
  `CreationPortraits` (the coordinator plus a per-session failure set and the
  15 s timeout) and the `useCreationPortraitCapture` hook used by
  `CreationStageActor`. The capture uses a fresh front `PerspectiveCamera`, so
  the user's orbit does not turn the portrait.
- `query/mutations/useSaveAvatarPortrait.ts` sends the blob as
  `portrait.webp` with a fresh operation id and the capture versions;
  `invalidateAvatarPortraitPresentation` (previously unused) now also refreshes
  the Avatar catalog and the Create Anima Avatar list.
- `useAppearanceImages` drops Appearances with `presentation.avatar_item_id`
  (Q5).
- The Create Anima Avatar cards still show an icon rather than the portrait;
  they never showed portraits and the spec does not ask for it.

Check record (tree `54b4a07f`, working tree on `122a1887`):

| Command | Directory | Result |
| --- | --- | --- |
| `npx vitest run src/ui/create-anima src/query` | `src/frontend/web` | 44 files, 260 passed |
| `pnpm -s check` | `src/frontend` | passed |
| `npx eslint src/ui/create-anima src/query` and `npx prettier --check` (same) | `src/frontend/web` | passed |

Browser check (task stack `animama-portraits`, development build, base port
9100, Chromium in the app's browser pane at 1440×900): after first-run setup,
a 15.6 MB VRM was given to the Create Anima upload input and saved as Local
Avatar "Portrait Test". Without further action the Avatar's `portrait`
appeared with its current revision, renderer 2 and preset 3; the stored image
is a 512² WebP (35 KB), front-facing with the happy expression in the chat
look, at `appearances/avatar-portrait-{item id}.webp`. After finishing
creation the new Anima's `/v1/animas` thumbnail is that portrait at 512, the
sidebar shows it without a reload, and the Library Avatar row shows it. The
Included Avatars report their shipped portraits (renderer 1, preset 2). Not
observed: a stage flash (none seen; a single frame cannot be ruled out by
eye). `pnpm e2e:test:fast` is folded into the full `pnpm e2e:test` run before
merge (see Final integration review).

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 4: Regenerated Included portraits

Review tier: light. Two content images, their metadata and licence records;
the final integration review covers it.

Requirements: R13, R14. Depends on Phase 1 (the capture used must be the
delivered one, so the prototype candidates are recaptured rather than reused).

Steps:

1. Fetch `origin/main` and check whether the starter VRM plan has merged (the
   replacement Andrew is on `main`). If it has, rebase this branch first and
   regenerate both portraits. If not, regenerate Annie's only and leave
   Andrew's 256² portrait and its records untouched; the starter plan then
   captures the new Andrew with this generator.
2. Capture each portrait being regenerated at 1024 with the delivered capture
   (enhanced rendering on), canonicalize with `canonicalize_avatar_portrait`,
   and replace the `.webp` under the same name. Record the commands and the
   starter VRM hashes used.
3. Update the matching `.meta.json` files (512, renderer 2, preset 3).
4. Update provenance and hashes in `content/included/licenses/inventory.json`,
   `licenses/source-review.json` and
   `licenses/third-party/art-vroid-review.json` for the regenerated portraits.
5. Run the content and licence checks (`tests/test_starter_content_closure.py`
   and the licence inventory tests) and the starter fixture tests.

Gate: owner visual check of the regenerated portraits in the Library and Anima carousel,
light and dark theme. Recorded in the PR; it does not block the PR opening.

Commit `feat(content)[p4]: regenerate the Included Avatar portraits`.

Result (2026-10-22): `origin/main` (`623897bd`) does not contain the starter VRM
plan and its branch is not published, so only Annie's portrait was
regenerated; Andrew keeps his 256² renderer-1 portrait and records. Annie was
captured from `content/included/avatars/AvatarSample_A_1_New.vrm` (SHA-256
`1119bfc6…`) by the committed `captureAvatarPortrait` at its defaults (1024²,
happy expression, enhanced rendering) in headless Chromium with ANGLE Metal on
an Apple M5, through a temporary local bench page that loads the production
`Avatar` from the VRM bytes, settles one second of rest pose and captures from
a front camera; the development `/avatar-portrait-debug` route runs the same
capture. `canonicalize_avatar_portrait` reduced it to 512² (40,886 bytes,
SHA-256 `586d9d61…`). Two captures from separate browser sessions were
byte-identical. Against a chat-canvas render with the same framing: mean
|Δ| 1.25/255 over all pixels.

Check record (working tree on `651e9e0f`):

| Command | Directory | Result |
| --- | --- | --- |
| `pytest -q -n 2 tests/test_starter_content_closure.py tests/test_anima_starters.py tests/test_included_content_integrity.py tests/test_included_content_catalog.py tests/test_action_effect_override_save.py tests/test_anima_presentations.py` | root | 77 passed |
| `python -m pytest -q scripts/public-release/test_prepare_source.py` | root | 12 passed |
| `/v1/animas` on the task stack after the file change | browser | Annie's thumbnail is the new 512² file (`586d9d61…`); Andrew unchanged (256²) |

Owner gate (open): look at Annie's new portrait in the Library and the Anima
carousel in light and dark themes.

## Final integration review

Covers combined acceptance R1–R14, Phase 4 (light) and Phase 1–3 evidence.
Then the full pre-push suite once on the final candidate through the heavy
slot. Because the change touches Anima presentation and export, run the full
`pnpm e2e:test` before merge. Results go in the PR.

## Validation and acceptance

The spec's acceptance criteria, evidenced by the phase check records, the
reference-difference measurement (Phase 1), the browser check (Phase 3) and
the owner's visual checks. Unperformed checks to state in the PR unless done:
real Safari, Windows desktop, packaged Electron.

## Idempotence and recovery

Portrait saves are idempotent by `operation_id` and, after Phase 2, by Avatar.
Re-running Phase 4 overwrites the same two files. The task stack is torn down
after its last use; nothing else is purged.

## Outcomes & Retrospective

_Pending._
