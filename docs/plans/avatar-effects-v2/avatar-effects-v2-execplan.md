# Deliver Avatar Effects v2 and the unified effects creator (Plan 1, platform)

Source agreement: [#298](https://github.com/raymond-van/animama/issues/298)
(snapshot: [avatar-effects-v2-spec.md](avatar-effects-v2-spec.md)). On 2026-10-06
the owner accepted its proposals, added the template picker and effect-intent
requirements, and asked for this plan.
Authorized scope: all phases, P1–P11 (owner, 2026-10-06). Explicit gates G2–G5
still apply.
Starting revision: `9abfc771` (`origin/main`).
Branch: `feat/avatar-effects-v2`, in a dedicated task worktree. One branch and
one PR for this plan.
Issues: parent #298; phases P1 #299, P2 #300, P3 #301, P4 #302, P5 #303,
P6 #304, P7 #305, P8 #306, P9 #307, P10 #308, P11 #309. Related: #297 (deferred Particle and Scene work), #282 and #289
(track-based clips and the motion preview tool), #291 (wave 2 reactions).

## Purpose and context

Plan 1 delivers the platform half of the spec (R1–R11):

- definition fixes and Save validation;
- the `animama/avatar-effect/2` definition, with one source shared by the
  frontend and backend;
- a one-time conversion of every `/1` effect;
- face and eye part detection that does not rely on material names, with user
  corrections;
- body, offset-sticker and silhouette-overlay attachments;
- event fades;
- a template picker and shared infrastructure for the three effect creators;
- a redesigned Avatar Effect editor with direct manipulation;
- headless and headed effect previews.

Plan 2 (content: skills, assets, about 25 effects, Reaction wiring and promotion,
R12–R16) is planned after this plan merges. The spec owns behavior and
acceptance; this plan owns delivery.

Commands run from the repository root unless a working directory is stated.
Frontend commands run from `src/frontend` or `src/frontend/web` as noted. No
Cloud checkout is needed.

### Implementation orientation

Frontend paths are relative to `src/frontend/web/src/`; backend paths to
`src/backend/animama/`. Line numbers are from the starting revision and drift as
work proceeds.

| Area | Current entry points and significance |
| --- | --- |
| Definition parsing | `lib/avatar/vfx/catalog.ts`: `parseAvatarVFXCatalogEntry` (:823) → `normalizeCatalogEntry` (:795) switches on `kind`. It drops unknown keys and **never checks `definition.schema`**, so a `/2` payload would be misread as `/1`. Enums and entry types: `lib/avatar/vfx/types.ts` (:3–102, :195–290). |
| Runtime loading | `lib/runtime-content/AnimaRuntimeMediaCatalog.ts`: `loadAvatarVFX` (:305), `loadPrivateAvatarVFX` (:574–641; exactly one logical image, ≤16 MiB), `resolveAppAvatarVFX` (:899, the bundled `assets/effects/vfx/catalog.json`, 14 entries). No Included effect uses `runtime_catalog` sources. |
| Controller | `lib/avatar/vfx/AvatarVFXController.ts` (~3,800 lines). Apply: :2076–2181, :2345–2558. Bindings: `_rebuildBindings` (:2890) via name regexes in `vfx/avatarRuntimeTargeting.ts` and `vfx/profiles.ts`. Composite: `_redrawBindingTextureComposite` (:3084), `drawCompositedLayerCanvas` (:1326). Hover: `_createHoverEffectGroup` (:3454–3679; parented to the normalized head bone; renderOrder 950, backdrop 949). Placement: `resolveHoverPlacementInstances` (:1485). Tick: `update` (:2202, 30 FPS). Regions: :3358. Forced blink: :3404. There is no transient transform update; every apply reloads its image. |
| Face landmarks | `AvatarFaceLandmarks.ts` (face and iris meshes chosen by name; eye islands; `_assignEyes` :405) and `AvatarFaceTextureAnchors.ts` (UV projection :919–987; expression-based mouth :642–770). Both are built once in `Avatar.load` (`Avatar.ts:494–500`), with no rebuild path. Box-hover hair clearance matches `hair|bang|fringe` names. Primitive identity: `lib/avatar/vrmEditorInspection.ts` `buildRuntimePrimitiveBindings` (:883), keyed by glTF `node:mesh:primitive`, which is stable for identical file bytes. |
| Clip events | `lib/avatar/poses/PoseController.ts` (applied ids :584, tracking :666, `update` :440) and `lib/avatar/reaction/ReactionClipPlayer.ts` (:583, :476, `update` :228) → `Avatar._applyClipOwnedAvatarVFX` (`Avatar.ts:2380–2445`; sink :2268). Envelope types: `animaPoseClip/schema.ts:184–212`; the sanitizer (:812–851) allows an envelope only with a `duration`. `events.ts` `sampleAnimaPoseClipVFXEventState` (:152) is used only by creator preview sampling. The runtime ignores envelopes and parameter keyframes. |
| Body anchors | `lib/avatar/particle-vfx/runtime.ts` `resolveParticleVFXAnchorLocalPosition` (:105–162), with private bone fallback chains (:19–30). |
| Avatar Effect creator | `ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx` (1,980 lines), `useAvatarEffectSave.ts`, `useAvatarEffectHistory.ts`, editor document `lib/avatar/vfx/editor/`. Preview: `ui/avatar-preview/AvatarPreviewSurface.tsx` (R3F, OrbitControls). `ui/content-creator/useContentCreatorAvatar.ts`. `useContentCreatorModelPreview.ts` offers only the last active Anima's model. Views: `ui/main/canvas/sceneCameraPresets.ts` (Face and Portrait; no ¾). Guides: `AvatarEffectGuideRenderer.tsx`, `placementGuideCanvas.ts`. Undo groups: `ui/creator-history/CreatorHistory.tsx` (`beginGroup`/`endGroup`). Gizmo precedent: `ui/avatar-preview/AvatarTransformControls.tsx`. No `Raycaster` exists in `src`. |
| Other creators | Particle: `ui/particle-vfx-creator/ParticleVFXCreatorPage.tsx` (4,775 lines), `useParticleVFXSave.ts` (recovery only on Save), `lib/content/particleVFXRecovery.ts`. Scene: `ui/scene-effect-creator/SceneEffectCreatorPage.tsx`, `useSceneEffectSave.ts`, `lib/scene-vfx/editor/recovery.ts`. Shared: `lib/content/contentRecoveryLifecycle.ts`, `hooks/useContentEditorSaveSource.ts`, `hooks/useContentSaveFailure.ts`, `lib/content/catalogApi.ts` `saveCatalogItem`. Leave guards compare only `pathname`. New-draft recovery uses the key `new`. |
| Entry points | `ui/sidebar/SidebarCreateMenu.tsx` (:66–86, :234–314), `ui/create/CreateHubPage.tsx` (:66–95), routes `routes/_app/{avatar,particle,scene}-effects.*.tsx`. Route-dialog precedent: `routes/_app/animas/$animaId/identity.tsx`. Modal frame: `ui/components/sectioned-modal-frame.tsx`. Tests asserting today's links: `ui/create/CreatorEntryPoints.test.ts` and `src/frontend/e2e/helpers/creator-surfaces.ts:66–112`. Library Edit: `ui/library/LibraryContentInventory.tsx:217–227`. |
| Rendering tools | `web/scripts/animation-render.mjs` and `animation-render/render.ts` (Vite plus headless Playwright with SwiftShader; samples clips without the `Avatar` class). Standalone real-`Avatar` precedents: `ui/create/CreateAnimaAvatarPreviewScene.tsx` and #289's preview page (`feat/track-based-pose-clips`). Portrait capture: `lib/avatar/portrait/captureAvatarPortrait.ts`. Chat canvas: `ui/main/canvas/Scene.tsx:272–280` (R3F defaults: ACES Filmic, sRGB; no stencil buffer; lights `sceneCameraPresets.ts:64–72`). There is no frame-cost instrumentation. |
| Backend Save | `server/routers/typed_content.py` (`_install_family_routes` :165–291) → `server/routers/content.py` `save_content_item` (:180) → `app/services/content_save_service.py` `save_descriptor_streams` (:359–480; Idle Style validation precedent at :441–457). `_raise_content_mutation` (`content.py:156–177`) drops the error message. Registry: `app/services/content_kind_registry.py` (avatar effect :1652, Avatar :1606, fields :135–182). |
| Backend validation and packages | `app/services/content_package_capabilities.py`: `SUPPORTED_CAPABILITIES` (:50), `_avatar_effect` (:215–306; omits `forceBlink`, `autoDisableEyeMaterials`, `faceCleanup`), `derive_document_capabilities` (:406). Export: `content_package_export.py`. Import: `content_package_archive.py`, `content_package_import.py`. |
| Conversion precedent | `app/services/content_transition_service.py` (:67–89) and `action_clip_transition.py`. Runs at startup, on `POST /v1/content:rescan`, and from `uv run python -m animama.server.content_cli`. |
| Avatar metadata | Optional `.meta.json` sidecar (`adapters/content_store/filesystem_store.py:495–540`, save :1499–1560). A sidecar change changes the Avatar's revision. There is no metadata-only update route; the portrait route (`typed_content.py:392–428`) is the precedent for one. Projections: `PyAvatarContent` (`server/schemas/typed_content.py:234`), `PyRuntimeAvatar` (`server/schemas/runtime_content.py:123`), frontend `runtimeSnapshotAdapter.ts:175–199`. Anima export: `app/services/anima_package_source_service.py`. Baseline: `alembic/versions/0001_baseline.sql`, `0001_baseline.py` `_BASELINE_TABLES`, `tests/test_alembic_fresh_install.py`. |
| Shared contracts | Pydantic contracts in `app/contracts/` → OpenAPI → `src/frontend/packages/runtime-contracts/src/generated` (TypeScript and zod) via `pnpm openapi-ts`. Parity fixtures under frontend `lib/` are read by pytest and vitest (`lib/content/fixtures/package-capabilities.json`). |
| Content | `content/included/vfx/avatar/<id>/<id>.json`: 16 `/1` effects (9 hover, 1 face decal, 6 texture). No Included hover has a non-zero x offset. Licence rules: `content/included/licenses/inventory.json` (`vfx/avatar/**/*` owner-authored; Annie renders follow the pixiv VRoid preset rule). |

## Progress

- [x] Spec agreed (2026-10-06); repository surveyed; plan drafted.
- [x] Owner review of this plan; P1–P11 authorized (2026-10-06).
- [x] Workspace: parent #298 published and read back; phase issues #299–#309
      created as sub-issues with dependencies (2026-10-06).
- [x] Phase 1: Definition fixes and Save validation.
- [x] Phase 2: Effect render harness, baselines and thumbnail capture.
- [x] Phase 3: Creator prototype. Superseded: the owner withdrew G1 and kept
      the existing creator UI (2026-10-06).
- [x] Phase 4: Avatar Effect v2, one definition source, envelope and conversion.
      Renders are identical, so G2 is not needed.
- [x] Phase 5: Model-agnostic face and eye parts, with corrections. The G3
      spike passed on both Avatars.
- [x] Phase 6: Attachments beyond the face and the performance budget
      (budget met: added mean GPU time is at most 1.15 ms).
- [x] Phase 7: Shared creator save, undo and draft recovery.
- [x] Phase 8: Template picker and entry points (existing UI components).
- [x] Phase 9: Avatar Effect creator `/2` controls and direct manipulation
      (existing layout and styling). "keep Eye" still needs a quiet-machine
      rerun before the PR.
- [x] Paused for G4 until #311 merged on 2026-10-07. The branch merged `main`
      (`777e9a79`) and fixed a mypy failure that came in from `main` in
      `idle_clip_validation.py` (`40bab4fc`).
- [ ] Phase 10: Headed effect preview. Gate G4.
- [ ] Phase 11: Documentation and acceptance. Gate G5.
- [ ] Final integration review and PR.

## Surprises & Discoveries

Planning research, 2026-10-06 (source reading at `9abfc771`, plus one image
probe):

- The export validator omits three fields the creator always writes for eye and
  mouth hovers and mouth decals. No backend test covers them. Nothing validates
  an Avatar Effect definition on Save.
- The frontend parser never checks the schema string (see orientation), so the
  `/2` parser needs an explicit schema gate.
- Clip envelopes are sampled only by creator previews. The clip schema allows an
  envelope only on an event with a duration.
- Landmarks, texture anchors and bindings are built once per load. A part
  correction needs a new rebuild path.
- Hover offsets are not mirrored for the mirrored eye, unlike decal offsets.
  Forced blink overrides any other manual `blink` override.
- Without eye bones, eye-island side assignment may mislabel one VRM version.
  Both Included Avatars have eye bones.
- Avatars already support an optional `.meta.json` sidecar. Saving identical VRM
  bytes as a new item ignores new metadata.
- Seeding the Avatar creator from a template would collide with the `new`
  recovery key and with pathname-only leave guards.
- #289's preview tool merges only with the whole #282 PR (one PR per plan), which
  does not exist yet. It also fails silently on a Library Reaction's avatar
  effects.
- Embedded desktop builds do not serve the `/effects/vfx/*` aliases, so template
  bytes must come from the catalog API or the bundle.
- A Codex image-generation probe returned real RGBA, with art pixels at alpha
  250–254 (relevant to Plan 2's asset checks).
- A new worktree has no `node_modules`. `uv sync` may select Python 3.14, which
  makes `pnpm openapi-ts` output differ from CI's.

## Decision Log

- **2026-10-06, owner:** the decisions and accepted proposals are recorded in the
  spec's Open questions and decisions. They include the two plans, the template
  picker with Annie thumbnails, direct manipulation, flipbooks, direct
  conversion, part corrections saved with the Avatar, the 2 ms budget and the
  prototype gate.
- **2026-10-06, owner (plan review):** development databases are reset for the
  new correction table; no migration is needed.
- **2026-10-07, sync after #311:** `origin/main` (`15816819`) was merged
  into this branch (`777e9a79`). Conflicts were resolved as follows:
  - The players kept #311's `parseAnyAnimaPoseClip` alongside P4's envelope
    sampling. 2.0 clips reuse the 1.0 event rules, so fades survive 2.0
    saves.
  - The player tests kept all tests from both sides.
  - The Playwright allowlist, the `package.json` scripts, the
    browser-journey docs and the capability test parameters were combined.
  - `make check` failed on `main` itself: mypy reported 4 errors in
    `idle_clip_validation.py` from #311. They are fixed in `40bab4fc`.
  - Checks after the merge:
    - full `pnpm web:test`: 405 files, 3,114 tests passed;
    - `pnpm check` and `openapi-ts:check` pass;
    - affected backend pytest: 241 passed, and the idle-clip tests 136
      passed;
    - `make check` passes.
- **2026-10-07, owner:** the Plan 2 Avatar Effect skill (R13) follows the
  `animama-animation` pipeline, including a gated Promote to Included step
  modelled on #310.
- **2026-10-07, owner (G4):** #282's PR #311 is still open. Work pauses after
  P9 until #311 merges. Then this branch syncs with `main`, and P10, P11 and
  the PR follow. The headed preview is not delivered separately.
- **2026-10-06, owner (prototype review, refined):** the effect creators keep
  their existing layout and styling; this is not a visual redesign. UX still
  improves: direct manipulation (drag, scale, rotate) on the preview, new and
  simpler controls where needed, and removal or replacement of deprecated,
  legacy or confusing controls. P8 and P9 reuse existing
  components (for example `sectioned-modal-frame` and the current inspector
  controls) and extend the current Avatar Effect creator layout. G1 and the
  prototype are withdrawn. The spec's R7–R9 were narrowed to match.
- **2026-10-06, planning (agent; implementation choices revisable within the
  accepted scope):**
  1. **One definition source.**
     - Strict Pydantic `/2` models (`extra="forbid"`, literal enums, a union
       discriminated by attachment) live in `app/contracts/avatar_effect.py`.
     - They type the Avatar Effect API models, so `pnpm openapi-ts` emits the
       TypeScript types and zod validators that the runtime and creator use.
     - Shared fixtures prove parity.
     - Considered and rejected: a hand-written JSON Schema file, which would need
       new validators on both sides.
  2. **Save validation.** It is a kind branch in `save_descriptor_streams`,
     following the Idle Style precedent, so the registry parse stays lenient
     enough for the transition to read `/1`. Errors carry a JSON path in a new
     optional `field`.
  3. **Conversion.**
     - One Python converter serves both an `AvatarEffectTransitionService` for
       Local content (automatic at startup and on rescan; `content_cli` is the
       documented command) and a repository script for Included files.
     - After conversion, `/1` is refused at Save, preview, loadout, package import
       and in the frontend parser.
  4. **Fades.**
     - Envelopes are honoured for events with a duration; the event shape is
       unchanged.
     - "With Action" events still end immediately.
     - Parameter keyframes remain unsupported for Avatar Effects, because the
       effect owns its motion.
     - The Gesture/Reaction inspector gains Fade in and Fade out fields.
  5. **Part corrections.**
     - **Local Avatars:** a typed field in the existing `.meta.json`. A new
       `<name>.avatar.json` would be ignored by the scanner.
     - **Included Avatars:** a new owner-scoped table keyed by Avatar item ID
       and revision.
     - **Part references:** glTF `node:mesh:primitive` keys plus the VRM file
       digest; a correction with a mismatched digest is ignored with a
       diagnostic.
     - **Updates:** a metadata-only update route.
  6. **Silhouette overlay.**
     - A spike compares geometry overlays (meshes sharing each avatar
       primitive's geometry, skeleton and morph influences) with a stencil pass.
     - The default is geometry overlays, which change no materials or canvas
       options.
  7. **Template thumbnails.**
     - Thumbnails are captured on Annie by the render harness and bundled as
       frontend assets, with a provenance README and notices. They are
       regenerated by one command.
     - Considered and rejected: registered thumbnail files inside Included
       effects, which change their revisions, need export filtering and need
       role-aware Library thumbnails.
     - Starter templates use placeholder art drawn at runtime, and Save requires
       replacing it.
  8. **Render fidelity.**
     - The harness uses the chat canvas's settings: ACES Filmic, sRGB and the
       default scene lights.
     - Frames advance in fixed steps, with automatic animation off.
  9. **Performance** is measured in headed Chromium on the development Mac with
     its GPU. SwiftShader timings are not representative.
  10. **Shared creator infrastructure** keeps each kind's existing recovery
      storage names, so current drafts survive. Particle recovery becomes
      autosave like the other two creators.
  11. **Old drafts.** Avatar editor drafts in the old editor format are dropped
      with a notice when the editor document changes (pre-launch).
  12. **Offset mirroring.** `/2` mirrors offsets for mirrored eye placements.
      No Included effect has an x offset, so conversion is unaffected.
  13. **ADR.** The definition source and model-agnostic face parts are recorded
      in a new ADR, numbered with the next free number when written (#282 may
      also add one).

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G1 | Withdrawn 2026-10-06 | — | The owner kept the existing creator UI; P8 and P9 proceed without a prototype |
| G2 | P4, only if converted renders differ from baselines | Owner accepts or rejects each difference | P4 completes after acceptance or a fix |
| G3 | P5, only if the spike cannot find face skin or an eye without names on an Included Avatar | Owner decides whether name fallback is acceptable for that part | P5 continues as decided |
| G4 | Before P10 | #282's PR (with #289) must be merged; otherwise the owner decides to wait or to deliver the headed preview separately | 2026-10-07: the owner chose to wait for #311; P10 starts after it merges |
| G5 | P11 | Owner reviews the final browser walkthrough | Acceptance evidence; merge approval stays separate |

If the performance budget is exceeded after reasonable optimization, the result
goes to the owner before P6 completes.

## Preparation (workspace setup)

1. Recheck the root and scoped `AGENTS.md`, the branch, HEAD and dirty state.
   Preserve the spec and plan.
2. `workspace-setup`:
   - publish the spec to a new parent issue and read it back;
   - record the snapshot time in the spec;
   - create phase issues P1–P11 as sub-issues with dependencies;
   - link #297, #282, #289 and #291;
   - record the issue numbers here.
3. Dependencies:
   - From `src/frontend`: `pnpm install --frozen-lockfile`, `pnpm packages:build`
     and `pnpm e2e:install` (Playwright Chromium).
   - Backend: `uv sync --python 3.12.13`; check with `uv run python -V`.
   - Backend tests need the container runtime that testcontainers uses (OrbStack
     on the development Mac).
4. Task stack, started when a phase first needs the app:
   - `./reset.sh --name avatar-fx --base-port <free port>`; record the URL and
     source `.animama-stack.env`.
   - Use test Animas and content only. The main stack on :3000 serves `main` and
     is not changed.
   - Restart the stack's `web` service after package rebuilds, before browser
     checks.
5. Wrap delegated test runs in `timeout` (for example
   `timeout 900 uv run pytest -q …`).
6. Work test-first (`tdd`): focused vitest from `src/frontend/web` with
   `pnpm exec vitest run <paths>`, and focused pytest with
   `uv run pytest -q tests/<file>`.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass, except
P3, whose gate runs alongside P4–P7. Record per phase:

- the starting SHA and issue;
- commits (`<type>(<scope>)[p#]: …`; scopes such as `vfx`, `creator`, `content`
  or `avatar`);
- commands and results;
- review records (`sdlc-reviewer`; one full review and at most two repair
  rounds);
- remaining gates.

### Phase 1 — Definition fixes and Save validation (R1, first part)

Requirements: R1. The shared definition source arrives with `/2` in P4.

1. **Export fields.**
   - Add `forceBlink`, `autoDisableEyeMaterials` and `faceCleanup` (booleans) to
     `_avatar_effect`'s allowlist.
   - Add the current kinds to `lib/content/fixtures/package-capabilities.json`:
     eye, mouth and box hover; single, span and mouth decals; and texture. Each
     carries the fields the creator writes.
   - Extend `tests/test_content_package_import_resources.py` (Save → export →
     import → re-export) and `packageCapabilities.compatibility.test.ts` over
     them.
2. **Save validation.**
   - In `save_descriptor_streams`, validate `AVATAR_EFFECT` definitions with the
     export validator before writing.
   - Raise `ContentDocumentError(code="avatar_effect_definition_invalid",
     field=<json path>)`.
   - Add an optional `field` to the error and return it from
     `_raise_content_mutation` as `{"code":"content_invalid","reason":…,"field":…}`.
   - If the OpenAPI error model changes, regenerate with `pnpm openapi-ts`.
   - Map `field` to a field-specific message in `lib/content/contentSaveErrors.ts`
     and show it in the creator.
   - Test with `PUT /v1/avatar-effects/{entry}`: an invalid definition returns 422
     with `field`, and a valid one saves.
3. **Legacy fields.**
   - Remove `lifetime` and `emotions` from the 16 Included effect files.
   - Delete `normalizeLifetime`, `normalizeEmotions`, `getAvatarVFXLifetime`,
     `isEmotionSelectableVFXEntry` and the editor's `lifetime`.
   - The `/1` validator keeps accepting the fields until P4 converts everything.
4. **Retire the bundled catalog.**
   - Delete `assets/effects/vfx/catalog.json`.
   - Remove its consumers: the `vfx/runtime.ts` lookup and
     `resolveAppAvatarVFX`. A `runtime_catalog` Avatar Effect source now reports
     `avatar_vfx_source_unsupported`.
   - Point any debug tools at the Anima's runtime catalog.
5. **Checks:**
   - Focused pytest for the files above.
   - `uv run ruff check`; `make format-check`.
   - Focused vitest.
   - From `src/frontend`: `pnpm check`, `pnpm web:lint` and `pnpm prettier:check`.

Completion: every current kind round-trips through export and import; an invalid
definition is refused at Save with its field; nothing reads `lifetime`,
`emotions` or the bundled catalog.

#### Phase 1 record

Starting source and issue: `5e8adf03`, #299.

Delivered:

- Export accepts `forceBlink`, `autoDisableEyeMaterials` and `faceCleanup`
  (booleans). The package fixtures hold one creator-shaped effect per current
  kind (eye, mouth and box hover; single, span and mouth decals; texture). A
  vitest proves each fixture is exactly what the creator writes, and pytest
  round-trips each through Save → export → import → re-export.
- `validate_avatar_effect_document` is shared by export and Save. Save refuses an
  invalid definition with 422
  `{code: content_invalid, reason: avatar_effect_definition_invalid, message, field}`,
  where `field` is a JSON path, before any write. The creator's message names the
  setting.
- `lifetime` was removed from 15 Included effects (none had `emotions`), along
  with every frontend reader. Old editor drafts drop a leftover `lifetime`. The
  backend `/1` validator still accepts `lifetime` until P4; it never accepted
  `emotions`, which the creator never wrote.
- The bundled `assets/effects/vfx/catalog.json` was deleted. A `runtime_catalog`
  Avatar Effect source reports `avatar_vfx_source_unsupported`. Its backend copy
  (`resources/vfx-catalog.json`) and the unused emotion-driven selector
  `domain/vfx.py` were removed with their audit, Dockerfile and packaging
  entries. The creator never used the bundled catalog; templates return in P8.

Checks (agent, 2026-10-06):

- Focused backend pytest over 46 content/package/save files: 661 passed. Boundary
  and packaging files: 181 passed, 1 failed. The failure is
  `test_runtime_resource_audit_has_schema_and_starter_resources`, at the gruut
  phonemizer step after the resource checks pass, because gruut is not
  installed in this venv.
- `uv run ruff check`, `make format-check`, the import-boundary check and the
  `shared_catalogs.py` drift check pass.
- Full web vitest: 376 files, 2,555 tests passed. `pnpm check` and
  `pnpm web:lint` pass. `pnpm prettier:check` passes for web; the desktop package
  fails on `desktop/tests/feature-packs.test.ts`, which is unchanged from `main`.
- Not run: the browser Save error notice, `pnpm build`, Compose config checks.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `5e8adf03`. Result: **pass**, no blocking
findings. Non-blocking:

1. Comments called the returned `message` a "fixed validator sentence", but
   `_fields` quotes a submitted key.
2. `content/included/vfx/avatar/face/**` and the `/effects/vfx/face` Vite alias
   appear orphaned now that the bundled catalog is gone.
3. `_child` joins JSON paths without escaping keys that contain `.` or `[`.
4. A failure on `definition.image` does not highlight the creator's image
   control; the message still names the setting.
5. The Phase 1 record was not filled in.

#### Code Review #1 Revisions

1. Fixed: both comments now say "validator message"
   (`server/routers/content.py`, `lib/content/contentSaveErrors.ts`); ruff passes.
2. Deferred to P4, which rewrites the Included effects and their support images.
3. Accepted: the path only appears in an error message.
4. Deferred to P9, whose editor maps definition paths to controls.
5. Fixed: this record.

### Phase 2 — Effect render harness, baselines and thumbnail capture (R10 headless; supports R3 and R7)

1. **Command.** Add `pnpm -s effects:render` (`web/scripts/effect-render.mjs`
   plus `effect-render/{index.html,render.ts}`).
   - Follow the `animation-render.mjs` pattern: a programmatic Vite server on
     `127.0.0.1` and headless Playwright Chromium.
   - Allow only the web root, `content/included/avatars`,
     `content/included/vfx/avatar` and an optional `--local-content <dir>`.
2. **Page.**
   - Mount a real `Avatar` per Included Avatar:
     `new Avatar(camera, canvas, {motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
     mediaCatalog})`, then `load({filePath})`.
   - Render like the chat canvas: ACES Filmic, sRGB, the default scene lights and
     a transparent clear.
   - Turn automatic animation off.
   - Step fixed frames from the moment of applying, in the order effects →
     `vrm.update` → particles. Reuse or extract the
     `poseCreatorAvatarFrame.ts` ordering.
3. **Sources:**
   - an effect folder or descriptor file;
   - `library:[included/|local/]<stem|content_id|name>`;
   - `--all-included`.

   Apply with the runtime parser and `applyAvatarVFXEffectById` using
   `effectEntry`. The run fails if the controller snapshot has warnings or no
   active effect, because apply calls never throw.
4. **Contact sheet.**
   - Rows are times after applying (default 0.1, 0.5, 1 and 2 s).
   - Columns are front, ¾ and face views for each Avatar.
   - Options: `--times`, `--tile`, `--views`, `--expression`.
   - Add `--with-clip <path|library:…>` to render while a Gesture plays (used in
     P6).
5. **Thumbnails.**
   - `--thumbnail <out.webp>`: Annie only, at 256×256 or larger.
   - Use `captureAvatarPortrait`'s head framing, with a new option that skips
     its forced happy expression.
6. **Diff.** `pnpm -s effects:render --diff <a.png> <b.png>` reports the share
   of differing pixels and the maximum channel delta, and writes a diff image.
   Document the tolerance.
7. **Baselines.**
   - Render all 16 Included effects at this phase's commit, on the `/1` runtime.
   - Keep the sheets outside the repository.
   - Record file names, dimensions and sha256 in the Phase 2 record.
   - Recovery: regenerate them from a temporary worktree at that commit.
8. **Tests:**
   - `scripts/effect-render.browser.test.mjs` renders a hover and a texture
     effect on both Avatars, checks the sheet size and active-effect count, and
     checks that a warning fails the run.
   - Unit tests cover source resolution.
9. **Checks:** `node --test scripts/effect-render.browser.test.mjs`, focused
   vitest, `pnpm check`, `pnpm web:lint` and `pnpm prettier:check`.

Completion: sheets exist for all 16 effects on both Avatars, and the agent has
checked them visually; thumbnails render on Annie.

#### Phase 2 record

Starting source and issue: `023a8d14`, #300. P1 commit: `023a8d14`.

Delivered:

- `pnpm -s effects:render` (`web/scripts/effect-render.mjs`,
  `effect-render-sources.mjs` and `effect-render/{index.html,render.ts}`).
  - Vite binds to 127.0.0.1 with `fs.strict`; only the web root, the Included
    Avatars, Included Avatar Effects and an optional `--local-content` root
    are served. A path source outside those roots is inlined only after its
    real path (symlinks resolved) is checked to be inside its folder.
  - Each effect gets a fresh real `Avatar` per Included Avatar, with automatic
    animation off, a 1 s settle pre-roll, chat-canvas rendering and fixed 1/60 s
    steps through `updatePoseCreatorAvatarFrame`. Renders are deterministic
    (repeat runs differ by 0 pixels).
  - A warning, a failed apply or no active effect fails the run (exit 1) after
    every sheet is written; usage errors exit 2.
  - Options: `--times` (0–30 s), `--tile`, `--views`, `--expression`,
    `--with-clip` (Anima Clip Gestures; pose and expressions only),
    `--thumbnail` (Annie, `captureAvatarPortrait` with the new
    `expression: "live"`), `--diff` (threshold 8/255).
- `Avatar.runWithPortraitCaptureState` gained `keepLiveExpressions`; the app's
  only caller keeps the old behaviour.
- Docs: `docs/frontend/runtime/avatar-vfx.md` §10.

Baselines: 16 sheets (1600×1308) and 3 Annie thumbnails, rendered on the `/1`
runtime, are kept outside the repository in
`worktrees/avatar-effects-v2-baselines/` with a `MANIFEST.txt` of digests.
Sample digests: `eye_vv_pair.png` `ddad150b…`, `texture_sick_2.png`
`0356bff4…`, `star.png` `6d7edfc2…`. After the review revisions both re-render
with 0 differing pixels. To recover, rerun `--all-included` from this phase's
commit.

Agent visual check: all 16 effects are visible and placed as expected on both
Avatars. Existing `/1` traits to watch at G2:

- Eye hovers draw over Annie's bangs.
- On Annie, the face textures show a lighter band at the hairline.
- `texture_sick_1` puts a green patch on Y_0's right temple.

Checks: `node --test scripts/effect-render-sources.test.mjs
scripts/effect-render.browser.test.mjs` 8/8; the animation-render browser test
passes; vitest for `src/lib/avatar/portrait` and the new
`AvatarPortraitCaptureState.test.ts` 30/30; `pnpm check`, `pnpm web:lint`;
prettier and eslint clean on the changed files. Not run: full `pnpm web:test`.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `023a8d14`. Result: **blocking findings
remain**.

1. **Blocking.** Source containment compared unresolved paths, so a symlinked
   image or clip inside an effect folder could point anywhere. It was then
   inlined into the page, and parse errors could quote its contents.
2. `parseTimes` accepted empty entries as 0 s and had no upper bound.
3. `withRendererPage` skipped `server.close()` when `browser.close()` rejected.
4. `renderThumbnail` skipped `renderer.dispose()` if opening the session failed.
5. The `keepLiveExpressions` branch had no test, and its interaction with
   `expressionName` was undocumented.
6. The Vite and Playwright setup duplicates `animation-render.mjs`.
7. `render.ts` is outside `tsc -b`, as is the precedent's.
8. The sources test hard-codes 16 Included effects.
9. The baseline manifest names an uncommitted source.

#### Code Review #1 Revisions

1. Fixed: containment uses the real paths of the folder and the file, for
   images and clips; `readJson` no longer echoes parser messages. A unit test
   covers a symlink.
2. Fixed: rejects empty, negative, non-finite and values over 30 s.
3. Fixed: nested `try`/`finally`.
4. Fixed: the renderer is disposed in `finally`.
5. Fixed: a doc comment and `AvatarPortraitCaptureState.test.ts`.
6. Accepted: the plan asked to follow the precedent; extraction can come with P10.
7. Accepted: same as the precedent; the agent and reviewer type-checked
   `render.ts` with a scratch tsconfig.
8. Accepted: Included content is fixed for this plan; P4 updates the count if
   it changes.
9. Fixed: this record names the phase commit, and the re-renders match.

#### Code Review #2 (repair round 1)

Result: **pass**. The reviewer reproduced the symlink escape again for images and
clips, by library spec and by path, and both are now rejected. All revisions
were confirmed with no regressions. One non-blocking note: a descriptor
symlinked from outside a library root now fails every `library:` lookup for that
root instead of being skipped. This is accepted as an explicit failure.

### Phase 3 — Creator prototype (R9, gate G1; superseded 2026-10-06)

1. Build a self-contained, clickable HTML prototype that does not use app code.
   It covers:
   - **Entry points:** the sidebar Create menu, the Create page and
     `/effects/new` opening the template picker.
   - **The picker:** sections per kind, with the Avatar section first and
     grouped by intent.
     - It uses real Annie thumbnails of the Included effects from P2 and starter
       cards for each attachment.
     - The Particle and Scene sections lead to their creators.
   - **The Avatar editor:**
     - an attachment chooser in plain language;
     - default and Advanced controls;
     - art (single image, other-eye image, flipbook), appearance and motion;
     - mocked direct manipulation (drag, scale and rotate over an Annie render);
     - the part panel, including uncertain and missing states and the correction
       flow;
     - loading, empty, error and unsaved states;
     - narrow width.
2. Share it privately with the owner, for example as a private Artifact. Do not
   commit it. Iterate on feedback.
3. **G1:** record the approval date and the approved decisions in the Decision
   Log, as a screen list and choices. That record lets P8 and P9 proceed without
   the prototype file.

P4–P7 continue while G1 is pending.

#### Phase 3 record

Issue #301. On 2026-10-06 a private, owner-only prototype was published as a
Design canvas Artifact. It is not committed and its link is not recorded here.
It has three boards:

- **Flow (interactive).** Covers the sidebar **New → Effect…** entry, the
  Create page **Effect** card and the `/effects/new` picker:
  - Avatar Effects come first, grouped by intent: Eyes, Whole face, Above the
    head, Mouth (marked preview only) and Start from scratch. The thumbnails
    are real Annie captures from `effects:render --thumbnail`.
  - The Particle and Scene sections open their creators.
  - Choosing a template seeds an editor at
    `/avatar-effects/new?template=<id>`. If a dirty draft exists, the user is
    asked to continue it or discard it.
  - The editor has a plain-language attachment chooser, then Spot, Which eyes,
    Art (other-eye image, flipbook), Look (opacity, blend, tint), Motion, Eyes
    underneath and Advanced (numeric fields in cm, ×, °; keyframes).
  - Direct manipulation: drag to move, a corner handle to scale, a round
    handle to rotate, one undo step per drag, and arrow-key nudges.
  - Face, Front and ¾ views on Annie and Y_0.
  - A Face parts tab shows each part's status (Found, Uncertain, Missing,
    Corrected). Click-to-correct saves the correction with the Avatar.
  - A leave guard.
- **States.** Loading skeletons, a starter with placeholder art, a Save error
  naming its field, and a missing part on the selected model.
- **Narrow width.** 760 px.

**G1:** withdrawn on 2026-10-06. The owner could not judge the final product
from the prototype and chose to keep the existing creator UI and styling. The
prototype is not used further.

### Phase 4 — Avatar Effect v2, one definition source, envelope and conversion (R1, R2 except new attachment rendering, R3, R6)

1. **Schema.** Add the Pydantic models in `app/contracts/avatar_effect.py`. Draft
   shape, finalized with tests in this phase:

   ```text
   schema: "animama/avatar-effect/2"
   attachment (discriminated by kind):
     face_surface:  part (face_skin | eye_iris | eye_highlight | eyeline | eyelash),
                    area (full | eyes | undereye | blush | mouth), layout?, side?,
                    mirror?, mode (overlay | replace), pivot?, offset{x,y} (UV
                    fraction), scale{x,y}, rotationDeg
     face_landmark: landmark (eyes | mouth | forehead | top | top_edge),
                    position? (left | middle | right | left_corner | right_corner),
                    side?, mirror?, offset{x,y,z} (m, head space), scale{x,y},
                    rotationDeg{x,y,z}
     body:          bone (root | hips | spine | chest | neck | head | leftHand |
                    rightHand | leftFoot | rightFoot), offset{x,y,z} (m), size (m),
                    facing (camera | bone), rotationDeg
     sticker:       around (head | body), offset{x,y} (fraction of avatar height),
                    size (fraction of avatar height), rotationDeg
     silhouette:    fill (pattern | tint), patternScale, scroll{x,y}
   art:        image, otherEyeImage?, flipbook? {columns, rows, frames, fps,
               loop (loop | once | pingpong)}
   appearance: opacity (0–1), tint? (#rrggbb), blend (normal | additive | multiply)
   motion:     preset parameters (pulse, spin, drift, as in /1), keyframes?
               [{t, opacity?, scale?, rotationDeg?, offset?}]
   eyes?:      forceBlink, hideEyeDetails, faceCleanup, skinBackdrop, hideParts[]
   region:     eyes | undereye | blush | mouth | emote | full_face | body |
               sticker | silhouette
   soundAlias?
   ```

   - Type the Avatar Effect API definition fields (`PyAvatarEffect.definition`
     and the runtime projection) with the models.
   - Run `pnpm openapi-ts`, then `pnpm prettier` on the generated output and
     `pnpm packages:build`.
2. **Backend.**
   - Replace `_avatar_effect`'s hand-written checks with `model_validate`, plus
     resource checks: `image` and `otherEyeImage` are registered `image` files,
     and the sound alias names a Sound dependency.
   - Add `animama/avatar-effect/2` to `SUPPORTED_CAPABILITIES`.
   - P1's Save hook validates `/2`.
   - `/1` is refused at Save with `avatar_effect_conversion_required` and a hint,
     and at preview, loadout and package import, following the Idle Style
     conversion precedents.
3. **Frontend parser.**
   - A new `parseAvatarEffectDefinition` validates with the generated zod
     schema, refuses any other schema with a diagnostic, and normalizes into the
     controller's internal entry types.
   - Before deleting the `/1` normalizers, snapshot their output for the 16
     Included effects as a fixture, and assert that the `/2` parser produces
     equivalent entries.
   - Delete the `/1` parsers and the duplicate enums.
   - `loadPrivateAvatarVFX` accepts `image` plus an optional `otherEyeImage`.
4. **Runtime features in the controller:**
   - **Appearance.**
     - Composite effects use `globalAlpha` and `globalCompositeOperation` in
       `drawCompositedLayerCanvas`, and tint through a cached pre-tinted copy.
       `replace` at opacity below 1 draws the original slot beneath.
     - Hover planes set material `opacity`, `color` and blending, and the skin
       backdrop fades with them.
   - **Other-eye image:** each placement selects its image; the mirrored eye
     uses `otherEyeImage`, unmirrored, when present.
   - **Flipbook:**
     - hover textures use `repeat`/`offset`, and plane aspect comes from the
       frame size;
     - composites use source-rectangle `drawImage`;
     - frames advance on the 30 FPS tick and count as animated.
   - **Keyframes** are evaluated on the effect's own timeline and combined with
     the presets.
   - Mirrored eye placements mirror their offsets.
5. **Envelope.**
   - In `PoseController.update` and `ReactionClipPlayer.update`, sample
     `sampleAnimaPoseClipVFXEventState` for active `avatar_vfx` events that have
     a duration.
   - Pass the value through a new sink method to
     `AvatarVFXController.setEffectIntensity(appliedId, value)`. It is held
     pending until the async apply finishes and multiplies opacity.
   - Add Fade in and Fade out fields (seconds) to the effect event inspector
     (`ui/pose-creator/PoseCreatorClipWorkspaceInspector.tsx:336–367`) when End is
     "After", writing `envelope.intensity`.
   - Tests: fade timing in both players, and a pending value before apply.
   - #282 edits the same inspector and players; keep these changes small and
     re-check after syncing with `main`.
6. **Conversion.**
   - `app/services/avatar_effect_conversion.py` converts `/1` to `/2`:
     - hover `eye_hover` becomes `face_landmark/eyes`;
     - `mouth_hover` becomes `face_landmark/mouth`;
     - `box_hover` placements map to `face_landmark` `forehead`, `top` or
       `top_edge` with a position;
     - `face_anchored` becomes `face_surface` on face skin with the same area,
       layout, side, mirror and pivot;
     - `texture` becomes `face_surface` (`single_eye`/`double_eye` → `eyes`,
       `full_face` → `full`);
     - rotations go from radians to degrees;
     - animation, region, sound and eye options are kept; `lifetime` and
       `emotions` are dropped.
   - Golden `/1` → `/2` pairs in a shared fixture are tested by pytest. While P9
     is pending, vitest also tests them against the temporary creator adapter.
   - `AvatarEffectTransitionService`, registered in `ContentTransitionService`
     after the `ActionClipTransitionService` pattern:
     - converts Local `/1` descriptors in place, keeping their identity;
     - uses a deterministic operation ID;
     - keeps originals and records failures.

     Test conversion, idempotence, a malformed input and a retained original.
   - Convert the 16 Included files with
     `uv run python scripts/content/convert_avatar_effects.py --write
     content/included/vfx/avatar` (dry run by default). Update fixtures and tests:
     `test_content_package_capabilities.py` (:42–45 and the shipped-content
     test), `test_included_content_catalog.py` and
     `includedVfxProjection.test.ts`.
7. **Creator.** Until P9, the current creator saves and hydrates `/2` through a
   temporary adapter from its editor document. The adapter is tested against the
   golden pairs and deleted in P9.
8. **Render comparison.**
   - Update `effects:render` for `/2`.
   - Render the converted effects and diff them against the P2 baselines.
   - Investigate any difference. **G2:** show any remaining difference to the
     owner with both sheets.
9. **Checks:**
   - focused and affected pytest; `make check`;
   - `pnpm openapi-ts` freshness (the CI source check);
   - from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
     `pnpm build` and `pnpm prettier:check`;
   - the render browser test.

Completion: every Included effect is `/2` and renders as before (or G2 is
settled); `/1` is refused everywhere with the hint; envelopes fade; the creator
saves `/2`; the frontend and backend share one definition source.

#### Phase 4 record

Starting source and issue: `2f214bab` (code), `429d87ae` (docs head), #302.

Delivered:

- **One definition source.** `app/contracts/avatar_effect.py` holds strict
  `/2` models (`extra="forbid"`, `strict=True`). Their validation-mode JSON
  Schema types `PyAvatarEffect.definition` and the new
  `PyRuntimeAvatarEffect`, which feed the generated TypeScript and zod. The
  frontend enums derive from the generated schema.
- **Final `/2` shape.**
  - `attachment` is one of `face_surface`, `face_landmark`, `body`, `sticker`
    or `silhouette`.
  - `art` holds `image`, an optional `otherEyeImage` (only with a mirrored or
    paired eye) and an optional `flipbook`.
  - `appearance` holds `opacity`, `tint` and `blend`.
  - `motion` holds `pulse`, `spin`, `drift` and `keyframes`.
  - `faceOptions` are accepted only where the renderer honours them.
  - `region` must match the attachment family; `soundAlias` is optional.
  - Body, sticker and silhouette effects parse, and the controller reports
    "not yet supported" until P6.
- **Limits.**

  | What | Limit |
  | --- | --- |
  | Image size | 16 MiB |
  | Image dimensions | 4096 px per side, 16.7 M pixels; read from the header before decode and checked again before upload |
  | Definition size | 64 KiB |
  | Flipbook | grid at most 16×16, at most 256 frames, at most 60 fps |
  | Keyframes | at most 64, t ≤ 600 s |
  | Scale | at most 20 |
  | Rotation | ±3600° |

  Effect images are not canonicalized on the backend, which admits up to
  16,384 px. Larger Local or imported images fail closed on load.
- **Refusing `/1`.**
  - Refused at Save, preview, batch preview, loadout and package import with
    `avatar_effect_conversion_required`.
  - The Local hint says conversion happens automatically at startup or Rescan,
    or with `content_cli`, and points to Content Health when a conversion
    failed.
  - The package hint says to convert in the exporting installation and export
    again, because the manifest and member digests make in-place package
    conversion impossible.
  - API projections tolerate a stored `/1` through `definition_error`.
- **Conversion.**
  - `app/services/avatar_effect_conversion.py` does the conversion.
    `AvatarEffectTransitionService` runs after the Action clip transition. It
    converts in place, uses a deterministic operation ID, keeps originals and
    records failures.
  - `scripts/content/convert_avatar_effects.py` converts descriptor folders;
    it is a dry run by default.
  - All 16 Included effects are converted. Golden pairs are in
    `lib/content/fixtures/avatar-effect-conversion.json`: the 16 Included
    effects, 7 creator kinds and 3 edge cases.
- **Offset mirroring (Decision 12).**
  - Only an effect's own mirrored copy mirrors its offsets, tracked by the
    `effectMirror` flag.
  - A Local `/1` mirrored eye effect with a nonzero `offset.x` therefore
    changes after conversion. The transition logs
    `avatar_effect_offset_mirrored` and the script prints a note. No Included
    effect is affected.
- **Runtime.**
  - Appearance (multiply on planes uses premultiplied blending), the
    other-eye image, flipbooks and keyframes.
  - Envelope fades are sampled in both players and passed through
    `Avatar.setAvatarVFXIntensity` to
    `AvatarVFXController.setEffectIntensity`. The value is held until the
    apply finishes and dropped if it fails. A finished fade stops redrawing.
  - The inspector has Fade in and Fade out fields: "With Action" removes the
    envelope, and changing the duration re-clamps the fades.
- **Creator.** A temporary `editor/legacyDefinitionAdapter.ts`, deleted in P9.
  It refuses to reopen effects that use features it cannot edit.
- **Removed.**
  - The `/1` parser (`vfx/catalog.ts`).
  - The orphaned `content/included/vfx/avatar/face/**` support images, their
    Vite alias and their licence records.

Render comparison (G2): all 16 converted effects re-render with 0 differing
pixels and identical sha256 against the P2 baselines, before and after the
review revisions (`worktrees/avatar-effects-v2-after/`). G2 needs no owner
decision.

Known limits: the Gesture creator's own preview sync does not apply fades;
chat and the runtime players do.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `429d87ae`. Result: **blocking findings
remain**.

1. **Blocking:** `make check` failed on 16 mypy errors in changed files.
2. **Blocking:** the package-import hint told users to convert an unpacked
   package with the script. A repacked package still fails, because of its
   manifest capability and member digests.
3. **Blocking:** offset mirroring keyed on `mirrorX`, which the profile's
   `mirrorRight` also sets. An unmirrored single-eye texture with an x offset
   flipped on one eye.

Non-blocking:

4. Local `/1` effects with x offsets change on conversion.
5. zod is looser than Pydantic.
6. `populate_by_name` accepted `schema_`.
7. Hand-written blend and loop unions.
8. Dead code.
9. An image-limit comment overstated canonicalization.
10. Finished fades kept composites redrawing.
11. A held intensity leaked after a failed apply.
12. Fade inspector leftovers.
13. Eye options ignore the fade.
14. Refusal messages varied.
15. Edge cases in the schema.

#### Code Review #1 Revisions

1. Fixed: typing fixes. `make check` passes and mypy is clean on 688 files.
2. Fixed: separate Local and package hints, with corrected docs and script
   docstring. The batch message points to Content Health. A new HTTP test in
   `test_content_package_http.py` covers the package refusal.
3. Fixed: an explicit `effectMirror` flag. Tests cover mirrored and unmirrored
   texture and hover placements, with static and keyframe offsets.
4. Documented, and flagged by `mirrors_offset_differently()`: the transition
   logs a warning and the script prints a note.
5. Accepted: the API validates with Pydantic before the frontend parses.
6. Fixed, with a test.
7. Fixed: derived from the generated types.
8. Fixed: removed.
9. Fixed: the comment and docs now describe the real limits.
10. Fixed: `hasOwnMotion`, with a test.
11. Fixed: `_applyTracked`, with a test.
12. Fixed, with tests.
13. Accepted: only the art and skin backdrop fade, a documented limit.
14. Fixed with item 2. The loadout 409 keeps its code-only body, as other
    loadout conflicts do.
15. Accepted: the runtime ignores these cases.

Also removed during revision: the orphaned `face/**` images, their Vite alias
and licence records, and their test line.

Checks after revisions (agent):

- `make check` passes.
- Focused pytest over 18 files: 295 passed. Inventory and release-prep tests:
  96 passed.
- `pnpm -s openapi-ts:check` reports the SDK is current. `pnpm check` and
  `pnpm web:lint` pass; web prettier is clean.
- Focused vitest: 846 passed. Render tests: 8/8.
- The `--all-included` diff shows 0 pixels for all 16 effects.

Checks run by me after the revisions: full `pnpm web:test` (379 files, 2,611
tests) and `pnpm build` pass.

#### Code Review #2 (repair round 1)

Result: **pass**. All three blocking findings are fixed, and the reviewer's
failure scenarios no longer reproduce. No regressions were found. The
reviewer's own runs:

- `make check` passes.
- Focused pytest: 205 passed.
- Vitest: 846 passed (3 runs).
- `openapi-ts:check`, `pnpm check` and `web:lint` pass.

Non-blocking, accepted:

- `PackageRoute` would return the import-oriented hint if an export ever hit
  the error, which cannot happen after startup conversion.
- An apply that replaces a same-ID effect can leave a held value until it is
  removed. The leak is bounded.
- One vitest file failed to load under concurrent load; three reruns passed.

### Phase 5 — Model-agnostic face and eye parts, with corrections (R4)

1. **Spike (G3).** Add `lib/avatar/vfx/faceParts.ts`
   `detectAvatarFaceParts(vrm, gltf)`, using spec signals only (names disabled):
   - **Eyes:** primitives skinned mostly to the humanoid `leftEye`/`rightEye`
     bones. Iris, white and highlight are separated by size and depth order.
     VRM 1 iris texture-transform look-at binds are used where present.
   - **Face skin:** the head-skinned primitive of the mesh that the `blink` and
     `aa` expressions morph, with the largest area around the eye landmarks,
     excluding eye-bone primitives.
   - **Eye lines and eyelashes:** small primitives of that mesh with strong
     `blink` displacement near the eyes.
   - **Hair (for box-hover clearance):** primitives skinned mostly to spring-bone
     joints under the head.

   Each part reports bindings and a source (`signals`, `names`, `corrected` or
   `missing`) with a confidence. Test on both Included Avatars, loaded with real
   geometry through `lib/avatar/motion-authoring/testing/includedAvatars.ts`. If face skin or an eye cannot be
   found without names, stop for G3. Record per-Avatar results.
2. **Integration.**
   - `_rebuildBindings`, `AvatarFaceLandmarks` and `AvatarFaceTextureAnchors`
     consume the part map, with names as a per-role fallback.
   - Add `Avatar.setFacePartCorrections(corrections)`. It rebuilds the part map,
     landmarks, anchors and bindings, then re-applies active effects.
3. **Correction shape.**
   `{schema:"animama/avatar-face-parts/1", vrm_sha256, parts:{face_skin, eye_left,
   eye_right, eye_highlight?, eyeline?, eyelash?, hair?: ["node:mesh:primitive", …]}}`.
   A correction whose digest does not match the VRM is ignored with a diagnostic.
4. **Persistence.**
   - **Local Avatars:** a typed `face_parts` field in `.meta.json`, added to
     Avatar `_KIND_FIELDS`, `AvatarDocumentV1`, parsing and projection.
   - **Included Avatars:** a new table `avatar_face_part_overrides`
     (owner_id, avatar_item_id, avatar_revision_sha256, parts, updated_at). It
     needs the ORM, `0001_baseline.sql`, `_BASELINE_TABLES`, the
     `BASELINE_SHA256` and the table count in `tests/test_alembic_fresh_install.py`.
     Existing development databases are reset to pick up the table (owner
     decision, 2026-10-06); no migration or manual statement is provided.
   - **Route:** `PUT /v1/avatar-content/{item_id}/face-parts`, with an expected
     revision, writes the sidecar field (Local) or the override (Included).
     `GET` returns the effective parts. The portrait route is the precedent.
   - **Projections:** the effective parts appear in `PyAvatarContent` and
     `PyRuntimeAvatar`, and `runtimeSnapshotAdapter.ts` forwards them. Run
     `pnpm openapi-ts`.
   - **Packages:**
     - Avatar export carries the sidecar field.
     - Anima export merges an Included Avatar's override into the exported
       Avatar's portable document and digest; import creates a Local copy with
       the sidecar.
   - **Tests:**
     - routes for Local and Included;
     - a stale revision or digest;
     - an Avatar package round trip;
     - an Anima export carrying an override.
5. **Chat.**
   - The canvas passes the corrections to `Avatar.load`.
   - An effect whose part is unavailable is not applied, and is logged once as a
     structured warning visible in the debug panel. Today the failure is counted
     silently in `PoseController`.
   - Unit tests cover the skip.
6. **Checks:** as P4, plus the Alembic fresh-install test.

Completion: name-free detection finds face skin and both eyes on both Included
Avatars (or G3 is settled); a correction persists, survives reload and applies
in chat (tests); packages carry corrections. The correction UI is in P9.

#### Phase 5 record

Starting source and issue: `4bc11d71`, #303.

**G3 spike (names disabled): passed.** Face skin and both eyes come from VRM
signals on both Included Avatars, and every role matches today's name
matching. Detection takes about 7 ms per Avatar. In both models one primitive
holds both eyes, and the eye whites are skinned to the head.

| Part | Annie (`A_1_New`, VRM 1) | `Y_0` (VRM 0) |
| --- | --- | --- |
| face_skin | `91:0:3` (signals 0.9) | `143:0:3` (signals 0.9) |
| eye_left / eye_right | `91:0:1` (signals 0.9) | `143:0:1` (signals 0.9) |
| eye_highlight | `91:0:2` (0.8) | `143:0:2` (0.8) |
| eyeline | `91:0:6` (0.7) | `143:0:7` (0.6) |
| eyelash | missing (none on the model) | `143:0:6` (0.6) |
| hair | `93:2:0`–`93:2:3` (0.8) | `145:2:0`, `145:2:1` (0.8) |

Delivered:

- **Detection.** `lib/avatar/vfx/faceParts.ts` uses these rules; material
  names are a per-role fallback.
  - **Eyes:** ≥50% of the skin weight is on the eye bones, and ≥80% on one
    side assigns the side. Look-at texture-transform irises take priority.
    Iris, white and highlight are told apart by size and depth.
  - **Face skin:** the ≥90% head-skinned primitive of the mesh morphed by both
    `blink` and `aa`, with the largest area in an eye window.
  - **Eye lines and eyelashes:** strong `blink` displacement near the eyes.
  - **Hair:** ≥90% in the head subtree with at least a 10% share on spring
    joints. This departs from the plan, because VRoid bangs put 54–73% of
    their weight on the head bone.
  - Detection never writes world matrices. Writing them skewed Y_0's VRM 0
    landmarks during development; a regression test covers it.
- **Integration.** Bindings, `AvatarFaceLandmarks` (including hair clearance)
  and `AvatarFaceTextureAnchors` read the part map.
  `Avatar.setFacePartCorrections` → `AvatarVFXController.refreshFaceParts`
  rebuilds them and re-applies the active effects.
- **Corrections.** The contract is `app/contracts/avatar_face_parts.py`
  (`animama/avatar-face-parts/1`), shared through OpenAPI.
  - Keys are `node:mesh:primitive`, unique, with at most 64 per part.
  - A missing or mismatched `vrm_sha256` ignores the whole correction with a
    diagnostic.
  - An empty optional part means the part is absent.
- **Persistence.**
  - **Local Avatars:** the `.meta.json` field `face_parts`. Writes go through
    `save_standalone_stream`, which rewrites the same VRM bytes; an unchanged
    value creates no new revision.
  - **Included Avatars:** the `avatar_face_part_overrides` table (primary key
    `owner_user_id`, `avatar_item_id`) in `0001_baseline.sql`, with 45
    tables. There is no Alembic revision: development databases are reset.
  - **Routes:** `GET` and `PUT` `/v1/avatar-content/{item_id}/face-parts`,
    with an expected revision. A digest mismatch returns 422 `content_invalid`
    with reason `avatar_face_parts_digest_mismatch`.
  - **Projections:** `PyAvatarContent` and `PyRuntimeAvatar` carry the parts.
    An Included override changes the runtime revision, so chat reloads.
  - **Packages:** Avatar export carries the correction. Anima export merges
    an Included override, dropping stale values, and import re-checks the
    digest.
- **Chat.** The canvas passes the corrections and the VRM digest to
  `Avatar.load`.
  - An effect whose required part is unavailable is skipped, with no
    exception, so the clip continues.
  - It is logged once as `avatar_effect_face_part_unavailable` and shown in
    the debug panel's warnings.

Checks (agent):

- `make check` passes, with mypy clean on 695 files.
- Focused pytest: 359 passed. A wider run over 49 files: 562 passed.
- `openapi-ts:check` passes.
- `pnpm check`, `web:lint` and prettier pass.
- Full `pnpm web:test`: 382 files, 2,630 tests passed. `pnpm build` passes.
- Render tests: 8/8.
- The `--all-included` diff shows 0 pixels for all 16 effects
  (`worktrees/avatar-effects-v2-after-p5`).

Not done:

- No browser check.
- A saved correction reloads the Avatar in chat; the live
  `setFacePartCorrections` call arrives in P9.
- The look-at texture-transform rule and the no-eye-bone fallback have no
  test on a real model.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `4bc11d71`. Result: **blocking findings
remain**.

1. **Blocking.** `refreshFaceParts` races with `removeEffect` and with
   applies already in flight.
   - An effect removed during the awaited re-apply loop is re-applied anyway,
     and nothing owns it.
   - An apply started before the rebuild writes through a stale binding,
     which is never released.
2. A model with separate left and right iris meshes finds only one eye.
3. A detection error fails the whole Avatar load.
4. Preview and prepare responses omit an Included Avatar's override.
5. Concurrent Included saves are last-write-wins.
6. A Local correction save rewrites the whole VRM.
7. An invalid sidecar `face_parts` invalidates the whole Local Avatar.
8. `refreshFaceParts` loses an explicit `bindingKey`, restarts animations, and
   does not restore effects skipped for a missing part.
9. The Phase 5 record was empty.

The reviewer verified owner scoping, key validation, digest gating, side
effects, the chat skip path, the baseline schema and import boundaries with no
findings.

#### Code Review #1 Revisions

1. Fixed.
   - `refreshFaceParts` records each effect's apply token before it clears
     the effects, and skips any effect whose token changed before its turn.
   - After the image loads, `_applyResolvedEffectToBinding` checks whether its
     binding is still current. If the binding was rebuilt, it re-runs on the
     new bindings, or reports the skip if the part is now missing. Nothing is
     created before that check.
   - Tests cover an effect removed during a re-apply and an apply already
     loading when a refresh starts. Both assert that no planes or materials are
     left behind, and both fail without the guards.
2. Fixed: irises are classified per side when an eye-bone primitive belongs to
   one side, with a synthetic two-mesh test.
3. Fixed: a detection error falls back to name matching and logs
   `avatar_face_parts_detection_failed`, with a test.
4. Fixed: `_overlay_face_parts` also covers the family `:preview` route and
   `previews:prepare`, with test assertions.
5. Accepted: there is a single local owner, and the docstring states it.
6. Accepted: the write is correct and atomic, and the revision is rechecked
   under the source lock.
7. Accepted (fail closed): this matches the repository's rule that an invalid
   typed document field invalidates the entry, which then appears in Content
   Health. A non-fatal path would need a new catalog warning channel.
8. Deferred to P9: its part panel calls `setFacePartCorrections` live.
9. Fixed: this record.

Checks after revisions:

- Agent: `make check` passes; focused pytest 359 passed; focused vitest 496
  passed; `pnpm check`, `web:lint` and prettier pass; render tests 8/8; the
  `--all-included` diff is 0 pixels.
- Me: full `pnpm web:test` (382 files, 2,634 tests) and `pnpm build` pass.

#### Code Review #2 (repair round 1)

Result: **pass**. Both scenarios for finding 1 are fixed, and the revisions
caused no regressions.

Non-blocking, accepted: a re-run on a stale binding whose own image load then
fails keeps its pending intensity. This is a rare, bounded leak, cleared by
`removeEffect` or dispose.

### Phase 6 — Attachments beyond the face and the performance budget (R5, performance)

1. **Body.**
   - Extract `resolveHumanoidAnchorObject(avatar, anchor)` from the particle
     runtime's fallback chains and share it.
   - Planes are parented to the normalized bone and are camera-facing by
     default.
2. **Offset sticker.**
   - A camera-facing quad under an avatar-following root (head or body centre),
     offset in the screen-aligned plane.
   - Size and offset are fractions of the avatar's height, measured at load.
   - `depthTest:false` and renderOrder 960, so stickers stay readable in front of
     the avatar.
3. **Silhouette overlay.** Spike geometry overlays against a stencil pass on both
   Avatars, measuring fidelity (no gaps or z-fighting, outlines excluded) and
   cost; record the result.
   - **Default, geometry overlays:** a `SkinnedMesh` per avatar primitive sharing
     geometry, skeleton and the `morphTargetInfluences` array. It uses an overlay
     material with screen-space pattern coordinates, `depthFunc: LessEqual` and
     polygon offset.
   - Appearance, flipbook and scroll apply.
4. **Coexistence.** Body, sticker and silhouette effects coexist. At most four
   are active; applying a fifth removes the oldest, with a diagnostic.
5. **Following.** Render sheets with `--with-clip` and an Included Gesture show
   all three attachments following the avatar on both Avatars. Test art is drawn
   in code.
6. **Performance.** Add `pnpm -s effects:bench`.
   - It runs headed Chromium with the GPU on the development Mac, with
     chat-equivalent canvas settings (DPR 2, antialiasing, ACES) and an idle
     Gesture playing.
   - It times `avatar.update` plus `render` on the CPU, and GPU time with
     `EXT_disjoint_timer_query_webgl2` where available, over 600 frames.
   - It compares no effects with the heavy combination (an animated face-surface
     effect, an eye hover, a body effect and a silhouette overlay), per Avatar.
   - Record mean and p95. The mean added frame time must be at most 2 ms.
     Otherwise optimize, then take the result to the owner.
7. **Checks:** focused vitest, the render browser test, `pnpm check`,
   `pnpm web:lint` and `pnpm prettier:check`.

Completion: the attachments render and follow motion on both Avatars; the budget
is met and its numbers are recorded.

#### Phase 6 record

Starting source and issue: `97e1e6c4`, #304.

**Silhouette spike** (flat magenta at 50% opacity, both Included Avatars, real
GPU, 600 frames of `shy-finger-poke-loop`):

- **Fidelity:** geometry overlays and a stencil pass look the same. They differ
  on 0.64% (Y_0) and 0.60% (A_1) of pixels, which is edge antialiasing.
  Neither shows gaps, and outlines are excluded in both.
- **Polygon offset:** factor −1, units −4 double-covered Y_0's layered cuffs, so
  factor 0, units −1 is used.
- **GPU mean added:**

  | Avatar | Geometry overlay | Stencil pass |
  | --- | --- | --- |
  | Y_0 | −0.01 ms | +0.05 ms |
  | A_1 | +0.21 ms | +0.15 ms |

- **Decision:** geometry overlays, as in Decision 6. They need no canvas
  stencil buffer and change no material.

Delivered:

- **Shared anchors:** `lib/avatar/humanoidAnchors.ts`
  (`resolveHumanoidAnchorObject`) is shared with the particle runtime, whose
  results are unchanged.
- **Body:** a plane parented to the normalized bone and camera-facing by
  default. It is oriented in `onBeforeRender`, so each camera sees it face-on.
  - `offset` is in metres in the bone's frame. A VRM 0 yaw correction gives
    the same result on both versions.
  - `size` is the plane height in metres.
  - A bone fallback shows in the snapshot target.
- **Sticker:** follows the head bone, or the hips–head midpoint for the body.
  Size and offset are fractions of the avatar height, measured at load from
  bind-pose bounds and scaled with world scale. `depthTest:false`, renderOrder
  960.
- **Silhouette** (`vfx/silhouetteOverlay.ts`): child overlay meshes share the
  geometry, skeleton and `morphTargetInfluences` of their source.
  - They honour the source's alpha cutout. `LessEqual` depth with polygon
    offset 0/−1, renderOrder 940, one material, so MToon outlines are
    excluded.
  - Transparent layers that write no depth get no overlay: iris, highlight,
    brows, eye lines and lashes.
  - The `pattern` fill tiles in screen space, anchored at the hips. At
    `patternScale` 1 a tile is a quarter of the avatar's on-screen height;
    `scroll` is in tiles per second.
  - The `tint` fill is a flat fill in the art's alpha-weighted average colour
    multiplied by `appearance.tint`. This is the agent's reading; the owner
    was told and may redefine it.
- **Coexistence:** at most four body, sticker or silhouette effects
  (`MAX_ACTIVE_ATTACHMENT_EFFECTS`). A fifth removes the oldest and logs
  `avatar_effect_attachment_limit`. Attachments survive `refreshFaceParts`.
  An attachment and a face effect with the same applied ID replace each
  other.
- **Tools:**
  - `effects:render --together` applies several sources on one sheet.
  - `pnpm -s effects:bench` runs the frame-cost benchmark.

Following motion: test art is drawn in code (a pulsing chest heart, a spinning
star on the right hand, a "DOKI!" sticker by the head and a scrolling stripe
silhouette).

- The sheets `follow-cat-monster-rawr.png` and `follow-soldier-salute.png`
  are in `worktrees/avatar-effects-v2-p6/`, outside the repository.
- They show all four attachments following both Avatars, with no gaps or
  doubled patches.
- The pattern is in screen space, so a hand in front of the face shares the
  face's continuous pattern; the reviewer confirmed it is overlaid.
- `--all-included` still diffs to 0 pixels.

**Performance** (`effects:bench`, headless with a real GPU: `ANGLE Metal
Renderer: Apple M5`; 1600×1200 at DPR 2, antialiasing, ACES,
`shy-finger-poke-loop`, 600 frames after 120 warm-up). The heavy combination
is `texture_sick_1`, `eye_confused_swirl`, a pulsing chest heart and a
scrolling silhouette.

| Avatar | Scenario | CPU mean / p95 | GPU mean / p95 | Draw calls |
| --- | --- | --- | --- | --- |
| Y_0 | No effects | 1.54 / 1.80 ms | 1.11 / 1.94 ms | 26 |
| Y_0 | Heavy | 1.68 / 1.90 ms | 1.69 / 3.29 ms | 41 |
| A_1_New | No effects | 1.08 / 1.20 ms | 0.91 / 1.75 ms | 20 |
| A_1_New | Heavy | 1.33 / 1.60 ms | 1.63 / 3.42 ms | 34 |

Mean added: Y_0 +0.14 ms CPU and +0.58 ms GPU; A_1 +0.25 ms CPU and +0.72 ms
GPU. Both are within the 2 ms budget.

Checks (agent):

- `tsc` clean; focused vitest 552 passed; full `pnpm web:test` 384 files, 2,656
  tests passed.
- `pnpm check`, `web:lint`, prettier and `pnpm build` pass;
  `openapi-ts:check` is current.
- Render tests 9/9.
- `make check` passes; pytest 118 passed.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `97e1e6c4`. Result: **blocking findings
remain**.

1. **Blocking.** The silhouette copies its source's map once. When a face
   texture effect is active, that map is the controller's composite texture.
   Once the face effect disposes it, three re-uploads it on the next bind and
   nothing frees it again. That leaks one face-size GPU texture each time,
   and the cutout uses stale alpha.
2. The cutout uses texture alpha even on opaque materials.
3. The hover skin backdrop draws over the silhouette.
4. Bench method:
   - it runs headless rather than headed, as Decision 9 said;
   - it uses a fixed none→heavy order;
   - the disjoint flag is read once per batch.
5. The spike and bench results were not recorded.
6. The frame-aspect logic is duplicated.
7. A `Vector2` is allocated on every draw.
8. A stale pending intensity is kept after an eviction.
9. A failed attachment apply loses a same-ID face effect.
10. Tests do not cover body and sticker disposal or multiple cameras.

The reviewer verified billboarding per camera, the VRM 0 yaw, sticker scaling,
shared-data immutability, outline exclusion, the cap, clip removal, the limits
and the anchor resolver with no findings.

#### Code Review #1 Revisions

1. Fixed: overlays read map, opacity, alpha test and side from the avatar's
   original material, through a `materialOf` callback that returns a face
   binding's `originalMaterial`. They never hold a composite owned by the
   controller. A test covers the reviewer's sequence (decal → silhouette →
   remove decal → remove silhouette) and fails with the old code.
2. Fixed: the map is sampled only when the material uses alpha test or
   transparency. Tested.
3. Accepted: a design trait recorded for P9 and the G5 walkthrough.
4. Fixed:
   - `none` and `heavy` now alternate over `--rounds` (default 2).
   - A disjoint event voids the queries in flight, and the count is
     reported.
   - `--headed` is documented. It ran once on both Avatars and agrees with
     headless.
5. Fixed: recorded above and below.
6. Fixed: reuses `resolveArtFrameSize`.
7. Fixed: a module-level scratch vector.
8. Accepted: follows the existing face-effect pattern and is harmless unless
   the ID is re-applied.
9. Fixed: a same-ID face effect is removed only after the attachment is
   built. Tested.
10. Fixed: tests for body and sticker disposal and for two cameras.

Bench after revisions (Apple M5, ANGLE Metal; 600 frames per scenario over 2
alternating rounds; no voided GPU samples). Times are mean / p95 in ms.

| Mode | Avatar | No effects, CPU | No effects, GPU | Heavy, CPU | Heavy, GPU | Added mean (CPU / GPU) |
| --- | --- | --- | --- | --- | --- | --- |
| Headless | Y_0 | 1.47 / 1.80 | 1.52 / 2.00 | 1.63 / 1.90 | 2.67 / 5.64 | 0.17 / 1.15 |
| Headless | A_1_New | 1.03 / 1.20 | 1.37 / 1.76 | 1.20 / 1.40 | 2.41 / 4.91 | 0.18 / 1.04 |
| Headed | Y_0 | 1.43 / 1.60 | 1.54 / 2.02 | 1.62 / 1.90 | 2.61 / 5.52 | 0.19 / 1.07 |
| Headed | A_1_New | 1.03 / 1.20 | 1.37 / 1.76 | 1.23 / 1.40 | 2.29 / 4.67 | 0.20 / 0.92 |

- **Budget:** every run is within 2 ms, including `--rounds 1` and
  `--rounds 4`, which added 0.93–1.29 ms GPU. The **performance budget is
  met**.
- **Variance:** GPU baselines vary between sessions. The no-effects GPU time
  rose along with the added time compared with the first run, which suggests
  GPU clock state rather than the revisions.
- **p95:** the heavy GPU p95 appears to come from the animated full-face
  texture re-uploading at 30 FPS. This is inferred from the effect mix, not
  measured per effect.

Checks after revisions (agent):

- Focused vitest 559 passed; full `pnpm web:test` 384 files, 2,663 tests
  passed.
- `pnpm check`, `web:lint`, prettier and `pnpm build` pass.
- Render tests 9/9.
- The `--all-included` diff is 0 pixels.

#### Code Review #2 (repair round 1)

Result: **pass**. Finding 1 is fixed and verified against the reviewer's
scenario, because `originalMaterial` is never a composite clone. The other
revisions caused no regressions. The bench rounds and disjoint handling are
sound.

### Phase 7 — Shared creator save, undo and draft recovery (R7)

1. **Save.** Add `ui/content-creator/useCreatorSave.ts`.
   - It is assembled from the common parts: save source, failure handling,
     `saveCatalogItem`, retry with a reused operation ID, `replace` navigation
     that ignores the blocker, and the "Save paused" notice.
   - A kind adapter supplies the payload, the edit route and optional pre-save
     confirmation (Particle's notices).
2. **Recovery.** Add `lib/content/creatorRecoveryStore.ts`: IndexedDB with a
   localStorage fallback, configured per kind (database, store, schema, size
   cap, payload codec).
   - Existing storage names are kept, so drafts survive.
   - All three kinds use `ContentRecoveryLifecycle` autosave; Particle gains
     autosave.
3. **History.** One `useCreatorDocumentHistory` replaces the three wrappers
   around `useCreatorHistory`.
4. **Leave guard.**
   - `useCreatorLeaveGuard` also compares search parameters on `/new` routes.
   - One shared leave dialog, loading state and inline error replace the copies.
5. **Tests:**
   - unit tests for save, recovery, history and the leave guard;
   - the existing creator tests updated;
   - e2e `creator-foundation` and `accountless-creator-discard(-local)` against
     the task stack.
6. **Manual, per creator:** edit, reload to recover, discard, save and reopen.

Completion: all three creators use the shared modules, and no behavior changes
except Particle autosave.

#### Phase 7 record

Starting source and issue: `7f8be8e4`, #305.

Delivered:

- **Save: `ui/content-creator/useCreatorSave.ts`.**
  - The hook is backed by a React-free `runCreatorSave` pipeline: name, payload,
    Particle notice review, recovery write, `saveCatalogItem`, recovery clear,
    then a `replace` navigation that bypasses the leave guard.
  - A retry reuses the operation ID, and an interrupted save shows "Save paused".
  - The per-kind `use*Save.ts` hooks are now thin adapters.
- **Recovery: `lib/content/creatorRecoveryStore.ts`.** IndexedDB with a
  localStorage fallback, configured per kind. The database, store and fallback
  names, schemas and size caps are unchanged, so existing drafts load; a test
  reads records in the old format.
- **History: `ui/creator-history/useCreatorDocumentHistory.ts`** replaces the
  three history wrappers.
- **Leave guard: `ui/content-creator/useCreatorLeaveGuard.ts`.** A change to
  the search parameters on a `/new` route counts as leaving, ready for P8's
  `?template=`. A shared `CreatorLeaveDialog` and `CreatorStatus` replace the
  per-creator copies. Layout and styling are unchanged.
- **Particle** now autosaves its recovery draft.
- **Deliberate fix: autosave runs only while there are unsaved changes.**
  - The draft is cleared once the document matches what was loaded or saved.
  - Before, all three creators wrote a draft right after opening or saving, so
    reopening a saved Scene or Avatar Effect showed **Unsaved** and asked
    before leaving. The agent reproduced this on the task stack with the old
    code.
  - The reviewer judged the change correct and safe.
- **Docs:** `docs/frontend/architecture/local-content-runtime.md`, with brief
  lines in the runtime guides.

**Task stack:** `animama-avatar-fx`, base port 8600, development build,
http://animama-avatar-fx.localhost:8600. Secrets come from
`COMPOSE_ENV_FILES`. It contains test items named `probe-*`.

**Manual check (Playwright on the task stack):** the agent checked the Avatar,
Particle and Scene creators.

- A new draft is restored after a reload.
- Leaving through Library shows the shared dialog. Discarding clears the draft.
- After saving, the editor shows Saved. It still shows Saved after a reload and
  after reopening, with no recovery notice.
- Editing a saved item and reloading restores the edit.
- No page errors.

**Checks (agent):**

- Focused vitest: 436 passed. Full `pnpm web:test`: 385 files, 2,677 tests
  passed.
- `pnpm check`, `web:lint`, prettier and `pnpm build` pass.
- e2e `accountless-creator-discard`: 9/9.
- `creator-foundation`: 6/6, run through a temporary config. The Playwright
  config does not select this spec.

The Gesture-only `accountless-creator-discard-local` failed once in the
agent's runs. The reviewer found the cause was Vite reloads from concurrent
edits plus a navigation flake, both outside this phase. The reviewer's two
reruns passed 3/3.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `7f8be8e4`. Result: **pass**, with no
blocking findings. Non-blocking:

1. A failed save of an unchanged document clears the recovery record that holds
   the retry ID, so a reload retries under a new ID.
2. On an edit route, Particle's "Discard recovery" after a failed save autosaves
   a blank document.
3. Drafts written by the old code still look unsaved (development data only).
4. `recoveryKey` is unused until P8.
5. Particle Save is enabled while the saved item is still loading. This
   predates P7.
6. Avatar recovery is sometimes written more than 700 ms after an edit, so the
   e2e's fixed 700 ms wait is borderline. This predates P7.
7. There are no tests at the hook level for autosave, restore and discard.
8. The Particle leave dialog wording changed to the shared wording, as
   expected.

The reviewer confirmed that the Gesture failures are unrelated: the Gesture
creator imports no changed module, and the spec passed twice.

#### Code Review #1 Revisions

1. Fixed: a draft that holds an unresolved save (failed, paused or restored
   after a reload) is kept until that save succeeds or is discarded.
2. Fixed: on edit routes, Particle uses the shared `discardRecovery`, which
   keeps the document and issues a new operation ID. `/new` still resets to
   blank.
3. Accepted: this affects development data only.
4. Kept: P8 uses `recoveryKey`.
5. Fixed: Particle passes `ready: loadState.state === "ready"`.
6. Fixed: the e2e test's fixed 700 ms wait is replaced by `waitForStoredDraft`,
   which polls storage for the edited draft.
7. Fixed: added `useCreatorSave.hook.test.tsx`. It runs under `happy-dom`, a
   new dev dependency scoped to that file; the reviewer judged it appropriate,
   since no DOM test environment existed. It covers:
   - restore before autosave;
   - autosave only while changed;
   - clearing when the document is unchanged;
   - the retry ID surviving a reload;
   - `discardRecovery`, `discardChanges` and `resetSession`;
   - Particle recovery after a reload.
8. Accepted: Particle now uses the shared dialog wording.

Checks after revisions (agent):

- vitest: 386 files, 2,684 tests passed.
- `pnpm check`, `web:lint`, prettier, `e2e:check:source` and `pnpm build`
  pass.
- e2e discard and discard-local: 11/11.
- `creator-foundation`: 6/6.

#### Code Review #2 (repair round 1)

Result: **blocking findings remain**. Finding 1 is fixed for its scenario,
finding 2 is fixed, and `happy-dom` and `waitForStoredDraft` are sound. New
blocking finding:

1. While a save is pending, a document that is unchanged is neither cleared
   nor rewritten. So if you undo back to the saved document after a failed
   save, reloading restores the undone edit. The reviewer reproduced this
   with a scratch test.

#### Code Review #2 Revisions

1. Fixed (by me): the autosave timer clears only when the document is
   unchanged and no save is pending. Otherwise it persists the current
   document under the existing session, keeping the operation ID.
   - New test: "stores the unchanged document after undoing to it following
     a failed Save". It fails with the old line (1 of 8) and passes with the
     fix (8/8).
   - Focused vitest: 23 files, 103 tests passed. `tsc`, eslint and prettier
     are clean.

#### Code Review #3 (repair round 2)

Result: **pass**. The finding from Review #2 is fixed and the reviewer's
scenario passes. Scratch tests confirmed there are no regressions:

- a reload followed by a retry keeps the operation ID, then clears;
- `discardRecovery` and `discardChanges` are unchanged;
- behaviour without a pending save is unchanged.

The reviewer's focused vitest run passed 381 tests.

Non-blocking, accepted: a save that fails before the server is reached (for
example Scene's "Reselect…") still marks a save as pending. A clean document
is then stored once with an unused operation ID. Nothing is lost.

### Phase 8 — Template picker and entry points (R7)

Owner decisions (2026-10-06):

- Build the dialog from existing UI components and styling, without a new
  visual design.
- The sidebar create menu's three effect links (`EFFECT_CREATE_LINKS` in
  `SidebarCreateMenu.tsx`) become one **Effects** entry that opens a two-step
  modal:
  1. three centered kind cards (Particle FX, Avatar FX, Scene FX);
  2. that kind's templates plus Start from scratch, with Back.
- A choice redirects to the kind's creator route.

1. **Registry.** `lib/effects/effectTemplates.ts`.
   - **Avatar:** curated Included effect content IDs. Start from scratch opens
     the blank creator, where the attachment is chosen.
   - **Scene:** its existing starting templates (`lib/scene-vfx/editor/defaults.ts`)
     plus Start from scratch.
   - **Particle:** Start from scratch only, until #297 adds templates.
2. **Thumbnails.**
   - `pnpm -s effects:thumbnails` regenerates every template's Annie thumbnail
     into `src/frontend/web/src/assets/effect-templates/` (WebP, lazily imported).
   - A README records provenance. Notices follow the Annie render rule
     (`licenses/third-party/art-NOTICES.md` and the runtime notice inventory).
   - A test checks that every template has a thumbnail and every thumbnail a
     template.
3. **Dialog.** `EffectTemplatePickerDialog`, built on the existing modal frame and
   card styles.
   - Step 1: three centered kind cards. Step 2: the kind's template grid and a
     Start from scratch card, with Back to step 1.
   - Keyboard navigable, with loading, empty and error states for thumbnails.
4. **Entry points.**
   - Replace the sidebar Create menu's effects submenu with a single **Effects**
     item that opens the dialog in place; the Create page's effect entry does
     the same.
   - `routes/_app/effects.new.tsx` renders the Create page with the dialog open;
     closing navigates to `/create`.
   - Closing an in-place dialog leaves the user where they were.
5. **Seeding.**
   - `/avatar-effects/new?template=<id>`: `validateSearch`, and a route key that
     includes the template.
   - An Included template hydrates through `previewCatalogItem` as a new, unsaved
     Local draft.
   - If an unsaved new draft exists, ask whether to continue it or discard it and
     start from the template.
6. **Tests:**
   - update `CreatorEntryPoints.test.ts`, `avatarEffectCreatorRoutes.test.ts`
     and the e2e helper `creator-surfaces.ts`;
   - add registry and thumbnail tests;
   - add an e2e journey: open from each entry point, pick a kind, choose an
     Avatar template, land seeded; Start from scratch for each kind; Back and
     close.
7. **Browser:** desktop and narrow screenshots.

Completion: every entry opens the picker; templates seed drafts; existing routes
and Library Edit links still work.

#### Phase 8 record

Starting source and issue: `9d4f577a`, #306.

Delivered:

- **Registry.** `lib/effects/effectTemplates.ts` defines three kinds:
  - Avatar FX: all 16 Included effects, keyed by their folder stem and grouped
    by intent (Eyes, Whole face, Above the head, Mouth).
  - Scene FX: its 5 existing templates.
  - Particle FX: Start from scratch only.
  - A test checks the IDs, content IDs and names against the descriptors.
- **Thumbnails.** `pnpm -s effects:thumbnails` writes 16 Annie WebPs (320 px,
  about 15 kB each) into `src/assets/effect-templates/` with a provenance
  README. It batch-renders on one page and removes thumbnails that no longer
  have a template. The thumbnails are lazily imported, and a test checks that
  templates and thumbnails match one to one.
- **Licensing.**
  - 16 `licenses/source-review.json` entries, treated like the Annie portrait.
  - A paragraph in `art-NOTICES.md`.
  - A desktop notice group with
    `notices/effect-template-thumbnails-attribution.txt`.
- **Dialog.** `ui/create/EffectTemplatePickerDialog.tsx` is built on the
  existing `ui/components/dialog.tsx` and the Create page's card styles. Those
  styles moved into `CreatorCards.tsx` so both share them.
  - Step 1 shows three centred kind cards.
  - Step 2 shows Start from scratch and the templates in groups, with Back.
  - Thumbnail states (loading, none yet, unavailable) sit in fixed square
    boxes, so the layout does not shift.
  - The picker uses the existing dialog rather than `sectioned-modal-frame`,
    because that frame always shows a section sidebar, which does not fit
    "three centred cards, then Back". The owner was informed.
- **Entry points.**
  - The sidebar's effects submenu and `EFFECT_CREATE_LINKS` were removed. A
    single **Effects** item opens the picker in place.
  - The Create page keeps its three effect cards, renamed Particle FX, Avatar
    FX and Scene FX. Each opens step 2 for its kind, with Back available.
  - `routes/_app/effects.new.tsx` renders the Create page with the picker
    open.
- **Seeding.** `?template=` on `/avatar-effects/new` and `/scene-effects/new`,
  with `validateSearch` and a route key per template. This goes through
  `ui/content-creator/useCreatorTemplateStart.ts` and
  `CreatorTemplateDraftDialog.tsx`.
  - An Avatar template hydrates its Included item through
    `hydrateAvatarEffect`, which uses `previewCatalogItem`. Its image becomes a
    new `File`, and the draft has no `itemId`, so Included content is never
    modified.
  - A Scene template reuses `applySceneEffectTemplate`.
  - A seeded draft gets a name no item uses (for example "Eye VV Pair 1") and
    shows Unsaved until the first Save.
- **Recovery keys (reading of the owner decision).** A plain draft keeps the
  key `new`; a template draft uses `new:template:<id>`, so neither overwrites
  the other.
  - On a template route, a recovered draft continues silently if it matches
    the template. Otherwise a dialog offers "Continue draft" or "Discard and
    use template".
  - A plain `new` draft is not raised on a template route. During a session,
    the `/new` leave guard already asks before leaving a dirty draft for
    `?template=`, and a draft recovered after a crash stays available on
    `/new`.

Screenshots (desktop 1440×900 and narrow 760) are in
`worktrees/avatar-effects-v2-p8/`; the owner was sent the desktop set.
Thumbnails to revisit with the Plan 2 art upgrades: the Emote "!" is cropped
by the head framing, `texture_black_1` reads as a pale wash, and
`texture_sick_3` is faint.

Checks (agent):

- Focused vitest: 227 passed. Full `pnpm web:test`: 2,704 passed.
- `pnpm check`, `web:lint`, prettier and `pnpm build` pass.
- Desktop runtime-packaging: 69 passed. Render tests: 9/9.
- e2e on the task stack: the picker journey plus creator-discard, 11/11.
  `e2e:check:source` passes.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `9d4f577a`. Result: **blocking findings
remain**.

1. **Blocking.** Closing the picker does not return focus to the control that
   opened it; a Playwright probe showed focus on `BODY`. With no trigger and no
   `onCloseAutoFocus`, Radix has nothing to focus, and the sidebar item
   unmounts when the menu closes.
2. Recovery keys: only a draft with the same template key is raised, not a
   plain `new` draft. This is sound, but should be recorded.
3. Template drafts for templates never chosen again stay in IndexedDB.
4. An unedited template draft counts as unsaved.
5. Duplication: the template-start wiring appears in both creators, and
   `sceneTemplateLabel` is defined twice.
6. `TemplateCard` uses a render prop.
7. Closing the picker opened from `/effects/new` pushes `/create`, so browser
   Back reopens the picker.
8. Licensing matches the Annie portrait treatment, and the legacy links are
   fully removed: no defects.
9. Two e2e journeys outside this phase failed in the reviewer's run:
   `accountless-journeys.spec.ts:80` (waits for a button named `JSON`) and
   `accountless-imported-playback.spec.ts:616`.

The reviewer confirmed that Included content is never modified and that
`creator-foundation` (6/6) and both vfx-layout journeys pass through the
picker.

#### Code Review #1 Revisions

1. Fixed. The picker has a `returnFocus` prop, and `onCloseAutoFocus` returns
   focus when the picker is dismissed; after a choice the app navigates away.
   - The Create page refocuses the card that opened the picker.
   - The sidebar refocuses its Create link. A one-shot flag stops that focus
     from reopening the hover menu.
   - A new `EffectTemplatePickerDialog.test.tsx` fails without the fix.
   - The e2e journey asserts focus after closing from each entry point opened
     in place.
2. Accepted as a reading of the owner decision. It is recorded above.
3. Accepted: this is minor development-time storage.
4. Accepted: this matches "Unsaved until first Save".
5. Fixed. `useCreatorTemplateStart` now owns the template-start wiring, and
   each page passes an `install(snapshot)` callback. `sceneEffectTemplateLabel`
   lives in `lib/scene-vfx/editor/defaults.ts`.
6. Fixed. `TemplateCard` takes `to`, `search` and `onChoose`.
7. Fixed. Closing `/effects/new` uses `replace: true`, and the e2e asserts that
   browser Back does not reopen the picker.
8. No change needed.
9. Out of scope.
   - The `JSON` locator failure predates this branch: the label became "View
     JSON" in `99e158fa0` on `main`. It has been split into a separate task.
   - `imported-playback` fails at different steps on different runs and does
     not use the changed helper for effects.

Checks after revisions:

- Agent:
  - focused vitest: 250 passed;
  - `pnpm check`, `web:lint`, prettier, `pnpm build` and `e2e:check:source`
    pass;
  - e2e on the stack: 16/16 (setup, creator-discard 8/8, picker 2/2,
    creator-foundation 5/5).
- Me: full `pnpm web:test`, 389 files and 2,706 tests, passed.

#### Code Review #2 (repair round 1)

Result: **pass**.

- Finding 1 is fixed. The reviewer's focus probes now land on the opening
  card and on the sidebar Create link, where before they landed on `BODY`.
- The sidebar flag works and clears after one use.
- The consolidated hook keeps the old order of operations.
- `playwright.config.ts` differs from HEAD only by the picker allowlist entry.

Non-blocking, accepted: the flag is set before `focus()`. This is theoretical.

### Phase 9 — Avatar Effect creator `/2` controls and direct manipulation (R8, R9, R4 interface)

Owner decision (2026-10-06): keep the current creator layout and styling and
extend it, reusing existing inspector components where possible. Add direct
manipulation and new, simpler controls where needed. Remove or replace
deprecated, legacy or confusing controls: the jargon labels ("Target material
role", "Asset shape", "Effect region"), position fields that do nothing for
some kinds, and the `/1`-only options. No new visual design.

1. **Document.**
   - The editor document mirrors `/2`, with art resources (image, other-eye
     image, flipbook).
   - The export schema becomes `animama/avatar-effect-editor/2`.
   - Older drafts are dropped with a notice.
   - Delete P4's temporary adapter.
2. **Interface, within the existing layout:**
   - an attachment control and only the fields that apply to it, with units
     (degrees), using the existing inspector components;
   - art, appearance, motion (presets and a keyframe list), sound and
     description;
   - validation, loading, empty, error and unsaved states;
   - no layout shifts; keyboard access.
3. **Preview.**
   - The model selector includes both Included Avatars plus the active Anima's
     model (`useContentCreatorModelPreview`).
   - Add a three-quarter view to the creator's presets.
4. **Direct manipulation.**
   - **Controller:** `updateEffectTransform(appliedId, transform)` updates in
     place without reloading the image. Composites redraw at up to 30 FPS.
   - **Face-surface art:** raycast the face mesh with a `Raycaster`, or expose the
     anchors' surface projection, to get a UV, then an anchor-relative offset
     (mirrored on the right side).
   - **Landmark, body and sticker art:** drag in the attachment's local plane.
   - **Handles:** 2D scale and rotate handles over the guide canvas, using
     `projectPlacementGuidePoint` and pointer capture.
   - **Undo:** each drag is one undo step (`beginGroup`/`endGroup`).
   - Fields and art stay in sync, and arrow keys nudge the selected art.
5. **Part panel.**
   - It shows each part's source and status for the selected model.
   - The user corrects a part by clicking an avatar mesh (R3F pointer events
     resolve the binding key) or from a list. The correction saves through the P5
     route, and the preview rebuilds.
6. **Tests:**
   - unit tests for UV and plane drag maths, sync, undo grouping and the `/2`
     document;
   - an e2e journey on the task stack: create → drag → undo → save → reopen →
     correct a part.
7. **Browser:** desktop and narrow screenshots.

Completion: R8 and R9 behaviors work on both Included Avatars, ready for the G5
walkthrough.

#### Phase 9 record

Starting source and issue: `952b4ce3`, #307.

Delivered within the existing creator layout and styling:

- **Document.** `lib/avatar/vfx/editor/` mirrors `/2`
  (`animama/avatar-effect-editor/2`).
  - It covers all five attachments, art (image, the other-eye image, a
    flipbook), appearance, motion presets and keyframes, face options, region,
    sound and description.
  - Default transforms are left out on save, so an unedited definition is
    saved unchanged.
  - Drafts in the old format are dropped with a notice
    (`CreatorRecoveryDroppedError` in the shared save hook).
  - P4's `legacyDefinitionAdapter` is deleted.
- **Legacy controls replaced.**

  | Before | Now |
  | --- | --- |
  | Hover / Face decal / Texture tabs | **Attach to**: Floating on the face, Painted on the face, On the body, Sticker beside the avatar, Fill the silhouette |
  | Hover type and 11 box placements | **Where** and **Position** |
  | Side, Mirror right eye, Mirror opposite side | **Which eyes / Which side** and **Art is drawn for the** |
  | Anchor, Asset shape, Target material role | **Where on the face** and **Paint on** (plain part names) |
  | Apply mode | **Keep the original underneath** |
  | Image pivot | **Image point placed on the face** |
  | Effect region | **Advanced → Replaces** |
  | Offset X/Y/Z for every kind | **Placement** tab with only the axes that apply, in cm, % of the texture or % of the avatar's height; Size; Rotation (°); Tilt (°) for face landmarks |
  | Hidden materials, Force blink, Skin backdrop | **Hide other face parts**, **Close the eyes**, **Skin-coloured backing** |
  | Animation tab (spin in turns/s) | **Motion** tab (spin in °/s, plus keyframes) |

  New: a **Look** tab (opacity, tint, blend), an **Other side image**, an
  **Animated sprite sheet** (flipbook), fields for body, sticker and
  silhouette, and the **Face parts** panel.
- **Preview.** The model selector offers Annie, Caitlyn (Y_0) and the active
  Anima's model, through the `includedAvatars` option. There is a new ¾ view
  for the creator only; chat presets are unchanged.
- **Direct manipulation.**
  - `AvatarVFXController.updateEffectTransform` changes the effect in place
    without reloading the image. Composite redraws are capped at 30 FPS.
    `getManipulationFrame` reports where each copy of the art sits.
  - Face-surface art is placed with a `Raycaster` that finds the UV under the
    pointer (`meshUvLocator.ts`), following `effectMirror`.
  - Landmark and body art moves in the plane of its anchor or bone. Stickers
    move in the screen plane.
  - Corner and rotate handles are provided, and each gesture is one undo step
    (`avatarEffectDrag.ts`). Arrow keys nudge by 4 px, or 20 px with Shift.
  - Fields and art stay in sync.
- **Face parts panel.**
  - Shows each part's source, status and confidence.
  - Parts are corrected with "Pick on the avatar" or a mesh list, and saved
    through `PUT /v1/avatar-content/{item_id}/face-parts`.
  - The preview then rebuilds and re-applies the creator's effect, which
    covers P5's deferred re-apply.
  - When a part is missing, the stage and the toolbar name it.
- **Save errors.** A definition `field` path opens the matching tab and
  outlines the control.
- **e2e.** `accountless-avatar-effect-direct-manipulation.spec.ts` covers
  create, drag, undo and redo, save, reopen, correcting a part, and restoring
  detection.

Screenshots (desktop and 760 px) are in `worktrees/avatar-effects-v2-p9/`. The
owner was sent the desktop set.

Checks (agent):

- `pnpm web:test`: 392 files, 2,740 tests passed, plus the Node and browser
  suites.
- `pnpm check`, `web:lint`, prettier, `pnpm build` and `e2e:check:source`
  pass.
- The `--all-included` render diff is 0 pixels.
- e2e: 17/17.

#### Code Review #1 Findings

Reviewed source: uncommitted tree on `952b4ce3`. Result: **blocking findings
remain**.

1. **Blocking.** A mirrored eye landmark with no side, as produced by the
   `/1` converter and the P4 creator, was shown as "between the eyes".
   Saving it after any edit dropped the mirror and the `otherEyeImage`.
2. **Blocking.** An unsaved face-part draft stayed in place when the model
   changed, so Avatar A's binding keys could be saved into Avatar B's
   correction.
3. **Blocking.** `accountless-vfx-layout` failed at the Guides step on every
   run (3/3): the UV preview popover closes when Guides is clicked.
4. A tick flush did not update `_lastTransformRedrawMs`, so the 30 FPS cap
   was not strict.
5. The Included Avatar preview was keyed by the preview grant. A catalog
   refresh reloaded the preview Avatar mid-session, and a grant could be
   reused after it expired.
6. A failed face-parts save did not refetch the revision.
7. The Replaces select could show blank for a custom region.
8. Duplication: the corner maths, and `sizeUnit` repeated in the Inspector.
9. The e2e journey did not assert the mirrored copy.
10. A main image named like the generated other-eye file gave duplicate
    companion paths.

The reviewer confirmed that the drag maths, undo grouping, texture reuse in
`updateEffectTransform`, the re-apply of skipped effects, the old-draft drop
and the removal of legacy code are sound.

#### Code Review #1 Revisions

1. **Fixed: a sideless mirror is kept.**
   - Normalizing drops only `mirror: false`.
   - `sidesChoice` maps any mirror to "mirrored".
   - "Art is drawn for the" shows `side ?? "right"`.
   - Round-trip tests cover a converted `/1` eye hover, a P4 eye hover with
     other-eye art, and a single-layout iris.
2. **Fixed: face-part edits stay with their Avatar.**
   - `useFacePartDraft.ts` scopes the draft by `itemId:vrmSha256` and resets
     it when the scope changes.
   - `facePartDraftProblem` rejects keys the current model lacks.
   - Tests cover both.
3. **Fixed in code; the test's expectation is unchanged.**
   - The root cause predates P9: the UV preview is a non-modal Radix popover,
     which closes on any outside pointerdown.
   - `CreatorCanvasControls` marks `data-creator-preview-controls`, and the
     popover ignores outside clicks inside it except on controls that open a
     dialog.
4. **Fixed: a grant refresh no longer reloads the Avatar.**
   - The target key is `included-avatar:{itemId}:{revision}`.
   - The grant refreshes 30 s before it expires, and retry fetches a fresh
     grant first.
   - The loader reloads only when the key changes.
5. Fixed: a failed save refetches the face parts.
6. Fixed: the Replaces list includes the current custom region.
7. Fixed: the tick flush updates `_lastTransformRedrawMs`, with a test.
8. Fixed: `manipulationPlacement.ts` is shared, and `sizeUnits` is computed
   once.
9. Fixed: the e2e asserts that the primary moves right and its mirrored copy
   moves left.
10. Fixed: `distinctAvatarEffectImageName`, with a test.

Also fixed:

- Below 1024 px, the Face parts popover opens below the controls with a
  capped height.
- The model label reads "{name} (Anima)".
- The new journey has `test.setTimeout(180_000)`, as `content-sharing`
  already does.

Checks after the revisions (agent):

- Focused vitest: 557 passed. Full `pnpm web:test`: 393 files, 2,746 tests
  passed.
- `pnpm check`, `web:lint`, prettier, `e2e:check:source` and `pnpm build`
  pass.
- The `--all-included` diff is 0 pixels.
- e2e:
  - direct manipulation, creator-foundation (5/5) and creator-discard (8/8)
    pass;
  - template-picker seeding passes, and its entry-points test passed 2/2 on
    rerun.

The machine was heavily loaded (load average 12–25 from other worktrees'
Playwright runs), so `vfx-layout` failed only by test timeouts.

#### Code Review #2 (repair round 1)

Result: **pass**. Findings 1–3 are fixed, and the reviewer's scratch probe now
keeps the mirror. The revisions caused no regressions.

**Remaining check before the PR.** In the reviewer's "keep Eye" rerun
(`--repeat-each 3`), 1 passed in 87.6 s and 2 timed out at 90 s. Line 143 and
every assertion passed, and the traces show the time ran out in the closing
checks. The reviewer judged these load timeouts. Before the PR, P11 reruns
this journey on a quiet machine, and raises its timeout if the duration stays
near the budget.

### Phase 10 — Headed effect preview (R10). Gate G4.

**Before starting:** #282's PR, including #289, must be merged. Sync this branch
with `main` and resolve conflicts, especially in `PoseController`, the inspector
and the players. If #282 has not merged, the owner decides (G4).

1. **Sources.** Extend `animation:preview` with:
   - effect sources: a descriptor file or folder, or
     `library:avatar-effect/<id>`;
   - looping or `--duration`;
   - scrubbing by removing the effect, re-applying it and stepping frames;
   - watching image files, with the version hash covering them;
   - unchanged review notes.
2. **Reactions with effects.** A media provider built from meta dependencies
   resolves event aliases to parsed entries with served image URLs, fixing the
   silent failure.
3. **Consolidation.** Consider sharing page code with `effects:render`.
4. **Tests:** extend the preview browser test with an effect source and a
   Reaction with an effect.

Completion: the owner can review an effect and a Reaction with effects live on
both Avatars, with notes.

#### Phase 10 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 11 — Documentation and acceptance (R11). Gate G5.

1. **Documentation:**
   - rewrite `docs/frontend/runtime/avatar-vfx.md` for `/2`: parts and
     corrections, attachments, fades, the picker and limits;
   - mention the picker in the Particle and Scene guides;
   - add glossary entries for Avatar Effect, Particle Effect and Scene Effect;
   - the ADR (Decision 13);
   - the `animama-vrm` materials reference;
   - document the conversion command, the required database reset and the
     `effects:render`, `effects:thumbnails` and `effects:bench` usage;
   - mark the `animama-avatar-vfx` skill's outdated sections, since Plan 2
     reworks it.
2. **Chat on the task stack:**
   - a Reaction with a converted effect;
   - a fading event;
   - body, sticker and silhouette effects through a Reaction or Gesture;
   - a corrected part.
3. **G5 walkthrough.** Run the spec's R7–R9 journey at desktop and narrow widths,
   with screenshots, and give it to the owner for review.
4. **Full checks** (see Validation), then the final integration review and the
   PR.

#### Phase 11 record

## Final integration review

`sdlc-reviewer` reviews the combined scope against the spec's acceptance criteria,
reusing still-valid phase evidence. It gets one full review and at most two
repair rounds. Record findings and revisions here. Agent readiness does not
replace G5 or merge approval.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| R1 | Export round-trip and Save-validation tests; parity fixtures; no legacy readers | P1, P4 |
| R2, R3 | Converted Included files; schema and feature tests; before/after render diffs (G2); `/1` refusal tests; Gestures and Reactions play converted effects | P4 |
| R4 | Name-free detection tests on both Avatars (G3); correction persistence, reload and chat tests; package tests; browser correction | P5, P9 |
| R5, R6 | `--with-clip` sheets; envelope tests; chat check | P4, P6, P11 |
| Performance | `effects:bench` numbers ≤ 2 ms mean added | P6 |
| R7–R9 | e2e journeys; screenshots; G5 walkthrough | P7–P9, P11 |
| R10 | Render and preview browser tests; owner use | P2, P10 |
| R11 | Documentation diff | P11 |

Before the PR, run the full suites:

- from the repository root: `uv run pytest -q`, `make check` and
  `uv run ruff check`;
- from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
  `pnpm build`, `pnpm prettier:check` and `pnpm openapi-ts` freshness;
- the e2e journeys above against the task stack.

This plan is high risk (schema, conversion, database and creator changes), so it
keeps full hosted validation. Check that the hosted workflow is enabled; if it is
not, the PR states that no hosted checks ran.

## Idempotence and recovery

- **Conversion:**
  - It is deterministic and idempotent: a `/2` input is unchanged.
  - The Local transition keeps originals and records failures.
  - Included conversion is a reviewed commit and can be reverted with Git.
- **Baselines:** regenerable from the P2 commit in a temporary worktree.
- **Database:** the new table is in the baseline. Existing development databases,
  including the task stack's and the main stack's, are reset after the change
  (owner decision, 2026-10-06). No Alembic revision is added.
- **Recovery storage:** per-kind storage names are unchanged. Old-format Avatar
  editor drafts are dropped with a notice.
- **Corrections:** stored separately from VRM bytes and invalidated by digest or
  revision mismatch, never applied to the wrong model. Removing one restores
  detection.
- **Task stack:** it uses its own Compose project and Local content. The main
  stack is never stopped or purged.

## Outcomes & Retrospective

To be completed at the end of the plan.
