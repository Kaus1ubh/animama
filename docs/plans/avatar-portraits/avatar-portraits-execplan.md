# Avatar portraits that match the chat canvas

Source agreement: [avatar-portraits-spec.md](avatar-portraits-spec.md)
(proposal, 2026-10-22), from the owner's 2026-10-22 task direction. Q1–Q7 in
the spec are pending owner review.
Authorized scope: none yet. Implementation starts after the owner accepts the
spec and this plan.

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

Related work: `perf/starter-vrm-optimization` re-encodes the starter VRMs.
Portraits link to models by file stem, so either order works. Phase 4 captures
from whatever starter VRM bytes are on `main` when it runs and records their
hashes.

## Progress

- [ ] Owner review of spec and plan (Q1–Q7).
- [ ] Phase 1: chat-look 1024 → 512 capture.
- [ ] Phase 2: one portrait per Avatar in the API.
- [ ] Phase 3: background capture in Create Anima.
- [ ] Phase 4: regenerated Included portraits.
- [ ] Final integration review, full pre-push suite, PR.

## Surprises & Discoveries

- 2026-10-22: `PyRuntimeImageReference` and its zod schema cap presentation
  images at 256², and the browser validates `/v1/animas` responses. Shipping
  512² Included portraits without R3 would break the Anima list. A custom
  Profile image larger than 256² may already trip the same check; Phase 2
  verifies this and records the result.
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
- 2026-10-22, agent proposal (pending): Q1 `method=5`; Q2 follow the setting;
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

Check record: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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

Check record: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

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

Check record: _pending_.

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

1. Capture both starter Avatars at 1024 with the delivered capture (enhanced
   rendering on), canonicalize with `canonicalize_avatar_portrait`, and replace
   the two `.webp` files under the same names. Record the commands and the
   starter VRM hashes used.
2. Update both `.meta.json` files (512, renderer 2, preset 3).
3. Update provenance and hashes in `content/included/licenses/inventory.json`,
   `licenses/source-review.json` and
   `licenses/third-party/art-vroid-review.json`.
4. Run the content and licence checks (`tests/test_starter_content_closure.py`
   and the licence inventory tests) and the starter fixture tests.

Gate: owner visual check of both portraits in the Library and Anima carousel,
light and dark theme. Recorded in the PR; it does not block the PR opening.

Commit `feat(content)[p4]: regenerate the Included Avatar portraits`.

Check record: _pending_.

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
