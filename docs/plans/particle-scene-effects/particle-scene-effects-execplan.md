# Particle and Scene Effect platform and pipelines (Plan 1, platform)

Source agreement: [#297](https://github.com/raymond-van/animama/issues/297)
(snapshot: [particle-scene-effects-spec.md](particle-scene-effects-spec.md)),
requirements R1–R8. The owner agreed the spec on 2026-10-09; it was published
to #297 the same day.
Authorized scope: all phases, P1–P9 (owner, 2026-10-09). Gates G1–G4 still
apply.
Starting revision: `4c9ab2c` (`feat/particle-scene-effects`, based on `main`
`bfc0de4`).
Branch: `feat/particle-scene-effects`, in a dedicated task worktree. One branch
and one PR for this plan.
Issues: parent #297; phases P1 #386, P2 #387, P3 #388, P4 #389, P5 #390,
P6 #391, P7 #392, P8 #393, P9 #394, linked as sub-issues, each blocked by its
predecessor and P5 also by P1. Related: #298 (Avatar Effects v2, whose tooling,
skills and promotion this plan extends).

## Purpose and context

Plan 1 delivers the platform half of the spec:

- **R1:** the Particle creator imports PNG textures and sprite sheets, and keeps
  textures that are not in its built-in list through open, Save, recovery and
  Portable packages.
- **R2:** Scene layer capabilities that the approved background designs need,
  fixed by an early design step (owner decision, 2026-10-09).
- **R3–R5:** `effects check`, `effects:render`, the headed preview, `effects
  save` and `effects promote` work for Particle and Scene Effects as they do for
  Avatar Effects.
- **R6:** named art budgets for particle textures, sprite sheets, Scene stickers,
  pattern tiles and full backgrounds, enforced by the scripts and the app.
- **R7:** `animama-particle-vfx` becomes a pipeline skill and
  `animama-scene-vfx` is added, each proven by a fresh-agent dry run.
- **R8:** runtime guides, glossary and effect skills describe the result.

Plan 2 (content, R9–R14) and Plan 3 (creators, R15–R17) are written after their
predecessors merge. Plan 1 writes no Included effect content: the R2 design step
produces briefs and mock renders, not library art, and promotion is proven only
on a throwaway branch (gate G3). The spec owns behavior and acceptance; this
plan owns delivery.

Commands run from the repository root unless a working directory is stated.
Frontend scripts run from `src/frontend/web`. No Cloud checkout is needed. The
build, tests and app must not depend on Codex, `image-gen` or any skill.

### Implementation orientation

Paths: frontend relative to `src/frontend/web/`, backend to
`src/backend/animama/`, content to `content/included/`. Line numbers are from
`4c9ab2c` and drift as work proceeds.

| Area | Current state and significance |
| --- | --- |
| Particle content | `vfx/particle/quark/<stem>/`: `<stem>.json` (`content_type: "particle_effect"`, ID `builtin:particle-effect:<stem>`, `runtime_defaults.slots.particle_vfx` with anchor, duration, transform, `max_particles`; `files` lists `particle.json` as `manifest` and `textures/*.png` as `texture`). 19 effects; only hearts, sparkles, stars, question-marks, exclamation and rain-cloud are used (Reactions at intensity 2–3, pinned in `tests/avatar/reactionClips.test.ts`). Some descriptors have no `dependencies` key. Bundled duplicates: `lib/avatar/particle-vfx/catalog.ts`. Runtime limits: 4 active effects, 512 declared particles (`ParticleVFXController.ts`). |
| Scene content | `vfx/scene/<stem>/<stem>.json` (`animama/scene-effect/1`); IDs carry a lane, e.g. `builtin:scene-effect:background:<stem>` and `builtin:scene-effect:focus:<stem>`. 19 emotion backgrounds (played only by `<emotion>-3` Reactions through `scene_vfx` events with `sceneKind` and `presetId`), plus `comic-pop`, `dark`, `kawaii-sparkles`, `light-streak`, `shoujo-hearts`. Art is Twemoji SVG copies (`emoji-*.svg`). Bundled duplicate: `assets/effects/scene-vfx/catalog.json`. Emoji path: `lib/scene-vfx/emoji.ts`, backend `BUILTIN_EMOJI` in `app/services/content_package_capabilities.py`. |
| Scene rendering | DOM, CSS and inline SVG only, outside the WebGL canvas (`ui/main/scene-vfx/*`; `docs/frontend/runtime/scene-vfx.md` §5). The marquee animates with the CSS keyframes `scene-vfx-marquee-shift` (`styles/globals.css` :35). Surfaces: chat (`ui/main/canvas/Scene.tsx` :270 underlay, `AvatarSceneHost.tsx` :603 overlay; `stores/scene-vfx-store.ts`), creator and Library preview dock (`ui/avatar-preview/AvatarPreviewSurface.tsx` :135–195 via `ContentPreviewScene.tsx`), Action editor (`ActionEditorScene.tsx`) and desktop picture-in-picture (`routes/desktop/pip/$animaId.tsx` :128; state crosses windows as JSON through `lib/desktop-pip/visual-state.ts`). |
| Particle creator | Page `ui/particle-vfx-creator/ParticleVFXCreatorPage.tsx` (~4,800 lines); editor library `lib/avatar/particle-vfx/editor/`. Textures live in the three.quarks manifest (`particle.json`): `ps.material` → `materials[].map` → `textures[].image` → `images[].url`, a package-relative path such as `textures/heart.png`. Sprite sheets use `ps.uTileCount`/`vTileCount`/`blendTiles` and a `FrameOverLife` behavior (`editor/renderer.ts`, `editor/behaviors.ts`). The 38 built-in textures (`editor/textureManifest.ts`, `editor/constants.ts`; files in `vfx/particle/particle-vfx/textures/`) are matched by basename in `editor/textures.ts` `textureIdFromUrl` (:314); anything else becomes `textureId: null`. Consequences: `EmitterTexturePanel` (page :2420–2560) has no file input; Duplicate and Add emitter replace a `null` texture with `soft-dot` (`editor/draft.ts` :188, :221–229); the preview maps unknown URLs to a missing public path (`editor/preview.ts`); readiness reports `unresolved-texture` (`editor/contentReadiness.ts` :147–153); Save passes `resources: []`, so `particleVFXContentPackage.ts` `resolveTextureSource` (:206–235) throws; reopen (page :352–415) fetches only `particle.json`, never texture bytes. `ParticleVFXContentPackageResource` (:31–36) is already a seam for user blobs. Package limits (:12–17): 16 textures, 25 MiB per texture, 64 MiB, 512 particles. Recovery (`lib/content/particleVFXRecovery.ts`) stores JSON only, no Blobs (5 MiB; the Avatar and Scene stores keep Blobs). Undo history: `useCreatorDocumentHistory`; the Avatar Effect creator keeps image resources in its history snapshots (`avatarEffectCreatorBehavior.ts`). |
| Image import precedent | `lib/avatar/vfx/effect-image-limits.ts` (`readImageDimensions` reads PNG/WebP/JPEG headers; `assertAvatarEffectImageWithinLimits` reads 256 KiB of header) and `effect-image.ts` (re-checks after decode). Flow: `AvatarEffectCreatorPage.tsx` `chooseImage` (:597–662) → type, bytes, header dimensions, `preflightContentFile`, `sha256File`, history dispatch; reopen downloads bytes (`hydrateAvatarEffect`, :1502–1569). |
| Scene definition and creator | Types `lib/scene-vfx/types.ts`: `background_layers` (`solid`; `pattern` none/polkadot/heart/star with colour, size, spacing, opacity; `marquee` items, size, gaps, nine directions, rotation mode, speed, opacity) and `focus_lines`. Parser `catalog.ts` `parseSceneVFXEntry` (:800–926) checks types and enums only and ignores unknown fields. Stored items are `kind: "image"` with a logical name, projected to blob URLs by `AnimaRuntimeMediaCatalog.ts` `loadPrivateSceneVFX` (:690–776). Editor `lib/scene-vfx/editor/` (`document.ts` `validateSceneEffectDocument` :233–406: ≤ 64 marquee items, ≤ 16 images, 32 MiB; `defaults.ts` five swatch templates). Page `ui/scene-effect-creator/SceneEffectCreatorPage.tsx` (~2,300 lines; `choosePrivateImage` :492–586 has no dimension check). |
| Backend validation | `app/services/content_package_capabilities.py`: `_particle` (:565–606) checks structure, allowlists and that `images[].url` names a registered texture file, but none of the frontend count, byte or particle limits; `_scene_effect` (:309–390) checks closed field lists but no ranges or item counts; `BUILTIN_EMOJI` (:69–72). Companion images get a magic-header check only (`content_kind_registry.py` `validate_standalone_file` :321–381). `app/services/content_image.py` `validate_image_stream` (:139–168) and `_open_bounded_image` (:347) can check dimensions but are unused outside the module. Save path: `PUT /v1/{particle,scene}-effects/{entry}` → `server/routers/content.py` `save_content_item`. Packages: `content_package_export.py`, `content_package_import.py` (member paths kept). |
| Effect tooling | `scripts/effects.mjs` (`check` → `effect-check.mjs`, `save` → `effect-save.mjs`, `promote` → `effect-promote.mjs`), `effect-render.mjs` with the page `effect-render/{render.ts,stage.ts}`, `effect-thumbnails.mjs`, `effect-bench.mjs` (+ `effect-bench/bench.ts`), `effect-assets.mjs`. All are Avatar-Effect-only. Shared source resolution `effect-render-sources.mjs`: `KINDS` (:32) has `effect`, `gesture` and `particle` but no scene; `loadEffectDescriptor` (:276) requires `avatar_effect`; `resolveParticleRef` (:425) already returns a particle manifest, textures and defaults, but only for content-ID references. |
| Check and render harness | Vite (strict `fs.allow`) + headless Playwright Chromium with SwiftShader (`withRendererPage`, `effect-render.mjs` :108). `checkEffect` (`render.ts` :345) diffs effect frames against a baseline on both Included Avatars (`AvatarSample_Y_0`, `AvatarSample_A_1_New`); `summarizeCheck` (`effect-check.mjs` :75) fails below a visible share of 0.001. The stage builds the `Avatar` with `EMPTY_RUNTIME_MEDIA_PROVIDER`, so particles cannot resolve; frames are copied from the WebGL canvas, so DOM Scene layers are not captured. Frame stepping (`updatePoseCreatorAvatarFrame`) already updates the particle controller. |
| Headed preview | `animation-preview.mjs` + `animation-preview-media.mjs` (`effectSpecFor` :130 accepts only Avatar Effects; `media()` :213 resolves Avatar and Particle dependencies and silently ignores Scene and sound; `choices()` :275 lists only Avatar Effects). `lib/avatar/motion-authoring/preview/previewMedia.ts`: Scene lookups return nothing (:129–139) and a notice says the chat scene draws it (:178–181). The page (`scripts/animation-preview/preview.ts`) draws every cell with one WebGL renderer through scissor viewports (`createCell` :189, `render` :452); there is no DOM layer per cell. `sources.ts` source types are `clip` and `effect`. |
| Save and promote | `effect-save.mjs` drives the Avatar Effect creator headlessly (Import dialog, image inputs, Save, read back, reopen); names follow `ENTRY_NAME` (:25). The Particle and Scene creators already have JSON import dialogs ("Import Particle VFX JSON", "Import Scene Effect JSON") and `/v1/particle-effects`, `/v1/scene-effects` routes. `effect-promote.mjs`: kinds `avatar_effect`, `reaction`, `gesture`; add/replace/delete; requires the `vfx/avatar/**/*` inventory rule; copies the first `vfx/avatar` source-review record form; `EVENT_DEPENDENCIES` (:81) already maps `particle_vfx` and `scene_vfx`. |
| Asset budgets | `effect-assets.mjs` `BUDGETS` (:39): landmark/body/sticker 512 px · 256 KiB, surface/silhouette 1024 px · 512 KiB, flipbook 2048 px · 1 MiB; runtime limits 16 MiB, 4096 px, 4096² px; `checkImage` fails non-PNG and missing alpha. `effect-assets.test.mjs` keeps limits in sync with the app and contract. |
| Licences | `licenses/inventory.json` (first match): `vfx/avatar/**/*` owner-authored; `vfx/particle/quark/**` "generated by `generate-particle-vfx-assets.mjs`" from CC0 inputs; `vfx/scene/**/emoji-*.svg` Twemoji CC BY 4.0; `vfx/scene/**/svg-*.svg` owner AI-generated; Scene descriptors fall to `**/*`. Repo-root `licenses/source-review.json` needs a record per tracked file. |
| Skills | `.claude/skills` → `.agents/skills`. `animama-avatar-vfx` (pipeline, steps 0–9; references `batch.md`, `brief.md`, `effect-folder.md`, `how.md`, `promote.md`, `what.md`). `animama-particle-vfx` (operating manual; references `creator.md`, `integration.md`, `three-quarks.md`). `animama-effect-assets` (budgets defer Particle/Scene to "their skill"). No Scene skill. |
| Docs | `docs/frontend/runtime/avatar-particle-vfx.md` and `scene-vfx.md` have no tooling sections; tools are documented in `avatar-vfx.md` §9 (:452–629). `GLOSSARY.md` Avatar Effect (:105–112) and Particle Effect (:114–118). |

## Progress

- [x] Spec drafted; owner review decisions recorded; spec agreed (2026-10-09);
      repository surveyed; plan drafted; D1 decided.
- [x] Owner review of this plan; P1–P9 authorized (2026-10-09).
- [x] Workspace (2026-10-09): spec published to #297 and read back; phase
      issues #386–#394 created as sub-issues with dependencies; worktree
      `animama-particle-scene-effects` on `feat/particle-scene-effects`. No task
      stack yet.
- [ ] P1 — Scene family designs (R2 input). Briefs, mocks and capability list ready (2026-10-09); waiting for G1.
- [x] P2 — Art budgets and shared import limits (R6). Review passed at round 3.
- [x] P3 — Particle texture import (R1). Review passed at round 2.
- [ ] P4 — Check, render and bench for Particle and Scene Effects (R3).
- [ ] P5 — Scene layer capabilities (R2). Waits for G1.
- [ ] P6 — Headed preview for Particle and Scene Effects (R4).
- [ ] P7 — Save and promote (R5). Gate G3.
- [ ] P8 — Pipeline skills and fresh-agent dry runs (R7). Gate G2.
- [ ] P9 — Documentation and acceptance (R8). Gate G4.
- [ ] Final integration review and PR.

## Surprises & Discoveries

- 2026-10-09 (planning): Scene layers are DOM/SVG hosts outside the WebGL
  canvas, while the render harness and the headed preview read pixels from, or
  draw everything into, one WebGL canvas. R3 and R4 need a DOM layer stack
  around the canvas and page-level capture, not a canvas readback.
- 2026-10-09 (planning): the licence inventory has no truthful rule for new
  Particle or Scene art. `vfx/particle/quark/**` describes generator output from
  CC0 inputs, and new Scene PNGs would fall to the catch-all `**/*`. The owner
  decided D1 (Decision Log).
- 2026-10-09 (planning): Particle texture limits exist only in the frontend.
  The backend does not enforce texture count, bytes, dimensions or particle
  totals, and the runtime's private particle loader checks no dimensions.
  Scene's backend validator has no ranges or item counts, and the Scene creator
  checks no image dimensions. R1 and R2 require both sides.
- 2026-10-09 (planning, unverified): the Scene creator names uploaded raster
  images with a `.webp` logical name whatever their format, and picture-in-picture
  receives Scene state as JSON that may carry window-local blob URLs. P5 checks
  both before relying on image capabilities there.
- 2026-10-09 (planning): `effects:assets check` fails any PNG without alpha, so
  an opaque full Scene background cannot pass today; the background budget needs
  an opaque-allowed mode.

## Decision Log

- **2026-10-09, owner (intent discovery):** recorded in the spec's Open
  questions and decisions.
- **2026-10-09, owner (spec review):** single long-lived particles are a valid
  particle layer and the glossary is clarified; Plan 1 starts with a Scene
  family design step whose approval fixes the R2 list; the performance budget is
  **4 ms** of added frame time for the heaviest intensity-3 Reaction's Particle
  and Scene Effects on the owner's development Mac; Local emoji items are marked
  missing and skipped; Plan 3 keeps the creator UI; sounds, more Gesture use and
  runtime changes are allowed when a design needs them; R9/R10 lists are trimmed
  before Plan 2.
- **2026-10-09, agent (planning), within the spec:**
  - Drafts, briefs, mock renders and review notes live under the ignored
    `.animama-drafts/`; the committed record of each family brief is a short
    entry in this plan (the #298 Plan 2 convention).
  - Proposed budget values are in P2; the owner may change them at plan review.
  - R6's "the app enforces the same limits": each art type has one set of hard
    limits (format, bytes, side, pixels, frame grid, counts and totals) shared
    by the scripts, the frontend import checks, the backend and the runtime
    loader. The named budgets are stricter authoring targets that the scripts
    enforce; the app does not refuse a user's art for exceeding a budget, only
    a hard limit.
  - Dry-run effects (P8) stay Local drafts. They may become Plan 2 candidates
    but are not promoted in Plan 1.
- **2026-10-09, owner (plan review):** the spec is agreed (Status: Agreed).
- **2026-10-09, owner:** all phases, P1–P9, are authorized. The proposed P2
  budget and limit values were not changed at review; P2 fixes them against
  the P1 designs.
- **2026-10-09, owner — D1, licence rules for new art** (amends the spec's R14
  wording). #298 had promoted files follow existing inventory rules without
  per-effect wording, but for Particle Effects the existing rule misstates new
  art's origin. Promotion writes new Particle and Scene art under
  owner-authored rules worded like `vfx/avatar/**/*`:
  - Particle: `effects promote` inserts a per-stem rule
    `vfx/particle/quark/<stem>/**` before `vfx/particle/quark/**`, as
    `animation promote` does per Gesture. Plan 2 may collapse the per-stem rules
    once the legacy effects are removed.
  - Scene: one kind-wide rule `vfx/scene/**/*.png` before `**/*`, added in P7.
  - Source-review records use the owner-authored form of the `vfx/avatar`
    records, not the CC0 or Twemoji forms.

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G1 | End of P1 | Owner reviews the eight Scene family briefs and mock renders, and may move emotions between families | Fixes the R2 capability list recorded in P5; P2–P4 do not wait for it |
| G2 | P8, before each dry-run effect is saved | Owner reviews the dry-run Particle and Scene effects in the headed preview on both Included Avatars | The skill's live-preview approval step is exercised; approved drafts are saved as Local content, others revised once or recorded as gaps |
| G3 | P7 and always | Owner | Plan 1 writes nothing under `content/included/` except approved licence rules (D1). The promote demonstration runs on a throwaway local branch that is never pushed. Any Included write needs the owner's explicit approval of each item |
| G4 | P9 | Owner reviews the browser walkthrough (texture import, the new Scene capabilities in chat, creator and preview dock) | Acceptance evidence; merge approval stays separate |

If a new Scene capability alone, or the current heaviest intensity-3 Reaction,
exceeds the 4 ms budget after reasonable optimization, the measurement goes to
the owner before the phase completes. Image generation needs the owner's Codex
login; a failed or quota-limited generation pauses the affected mock or dry run,
not the plan.

## Preparation (workspace setup)

1. Recheck the root and scoped `AGENTS.md` (`src/frontend/AGENTS.md`,
   `src/backend/AGENTS.md`), branch, HEAD and dirty state. Preserve the spec and
   plan. Run `git lfs pull` if a PNG reads as a pointer.
2. `workspace-setup`, once implementation is authorized:
   - publish the spec to #297 and read it back; record the snapshot time in the
     spec;
   - create phase issues P1–P9 as sub-issues of #297, each blocked by its
     predecessor and P5 also by P1 (G1);
   - record the issue numbers here. Do not create gate-only issues.
   Done 2026-10-09: #386–#394.
3. Dependencies: from `src/frontend`, `pnpm install --frozen-lockfile`,
   `pnpm packages:build`, `pnpm e2e:install`; backend `uv sync --python 3.12.13`
   (check `uv run python -V`). Backend tests need the container runtime that
   testcontainers uses.
4. Task stack, started when a phase first needs the app (P3):
   `./reset.sh --name particle-fx --base-port <free port>`, then
   `source .animama-stack.env`; record the URL here. Test content only; the main
   stack on :3000 is not changed. Restart the stack's `web` service after
   package rebuilds.
5. Wrap delegated test runs in `timeout` (for example
   `timeout 900 uv run pytest -q …`). Work test-first (`tdd`) for scripts,
   parsers, validators and limits.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass (one
full `sdlc-reviewer` review, at most two repair rounds), except that P1's gate
runs alongside P2–P4 and P5 waits for G1. Record per phase: issue, starting SHA,
commits (`<type>(<scope>)[p#]: …`, scopes such as `vfx`, `scene`, `particle`,
`creator`, `effects`, `skills`, `docs`), commands and results, review records
and remaining gates.

### P1 — Scene family designs (R2 input). Gate G1. #386

Outcome: the owner has approved a design direction per emotion family, and the
Scene capability list R2 builds is fixed.

1. For each of the eight families in the spec's R10 table, write a brief under
   `.animama-drafts/scene-families/<family>/brief.md`:
   - what the background expresses and how it escalates the intensity-3
     Reaction;
   - its emotions, with each emotion's colour and art motif;
   - its layers, from back to front, with motion (speed, direction, loop) and
     what each layer needs from the renderer;
   - art direction (distinct from Particle art) and the art each emotion needs
     (stickers, tiles, a full background or none);
   - how it coexists with the Avatar and Avatar Effects (contrast, the face
     kept clear).
2. Make a mock render per family: two still frames over an `effects:render`
   frame of an Included Avatar, built from CSS/SVG layers in a scratch page and
   sample art from `animama-effect-assets` (optionally `image-gen`). Mocks are
   drafts, not library art.
3. Derive the capability list: for each layer, the existing layer kind that
   covers it or the new capability it needs (candidates: linear and radial
   gradients, custom image pattern tiles, procedural screens such as gloom lines
   and radiating rays, per-item size, rotation and opacity variation, and
   frame-animated items). Note each new capability's data shape, limits and
   expected cost.
4. Present the briefs, mocks and capability list on one review sheet (G1). The
   owner may move emotions between families or change directions.
5. Record the approved families and the capability list in this plan (the P1
   record and the Decision Log).

Checks: none automated; the G1 decision is the evidence.

Completion: G1 approved; the R2 list is recorded. Capabilities no approved
design uses are not built.

#### P1 record

Starting source and issue: `ab21768f` (this branch after merging `main`
`42d38faf`), #386.

Delivered (drafts under `.animama-drafts/scene-families/`, not committed):

- Eight briefs (`<family>/brief.md`) and one live review page with an animated
  mock per family over an Included Avatar (both Avatars alternate), plus two
  still frames per family (0.12 s and 2.5 s). Mocks are plain CSS/SVG layers
  in the order the chat underlay draws them; sample art is one generated
  sticker per family (draft direction only), each passing
  `effects:assets check --budget sticker` after `fix`.
- Art direction proposed for Scene art: flat anime background motifs (bold
  silhouettes, flat colour with at most one cel-shade step, thin tinted
  outlines), distinct from Particle art's glossy glow polish.

| Family | Direction (lead emotion shown) | Layers |
| --- | --- | --- |
| Affection | Shoujo bloom (love) | radial glow, drifting bokeh tile, tumbling petals with twinkling sparkles |
| Esteem | Radiance (confidence) | radial back-light, rotating rays, rising twinkling glints |
| Delight | Festive pop (joy) | diagonal pop gradient, halftone dots, bouncing stars and confetti |
| Drive | Anticipation (optimism) | sky gradient, drifting star-field tile, rising twinkles |
| Alarm | Shock (fear) | entry flash, dark gradient, shock lines, flickering lightning |
| Rejection | Rage (anger) | hot radial vignette, throbbing spiky rays, popping anger marks |
| Revulsion | Queasy (disgust) | sickly gradient, spinning spirals, rising bubbles |
| Gloom | Gloom (sadness) | overcast gradient, swaying gloom lines, falling drops |

Proposed capability list for G1 (all additive to `animama/scene-effect/1`):

- **C1 gradient fill** (linear or radial, 2–4 stops): all families.
- **C2 image pattern tile with drift**: Affection, Drive.
- **C3 procedural screen** (rays: count, centre, rotation, spiky, throb;
  lines: count, lengths, width, sway): Esteem, Alarm, Rejection, Gloom.
- **C4 scatter layout and per-item variation** (size, rotation, opacity
  ranges, seed): all families.
- **C5 per-item motion** (spin; twinkle, pop or flicker pulse; still items
  among drifting ones): seven families.
- **C6 entry flash**: Alarm (and Delight's excitement).
- Not built: frame-animated items; no design needs them.

Recommendation for G1: move embarrassment from Revulsion to Affection (its
blush-and-steam fluster trope fits Affection's layers, not a nausea swirl).

Remaining: **G1** (owner approval of the families and the capability list).

#### Code Review #1 Findings

Not applicable: P1 commits only this record; the mock page and briefs are
drafts.

### P2 — Art budgets and shared import limits (R6). #387

Outcome: named budgets for Particle and Scene art exist in one place that the
asset scripts, the app's import checks and the backend validators agree on.

1. Add budgets to `scripts/effect-assets.mjs` `BUDGETS` (proposed values; the
   owner may change them):

   | Budget | Longest side | File size | Notes |
   | --- | --- | --- | --- |
   | `particle-texture` | 512 px | 256 KiB | single sprite, alpha required |
   | `particle-sheet` | 2048 px | 1 MiB | frames ≤ 256 px; grid ≤ 16×16, ≤ 256 frames |
   | `scene-sticker` | 512 px | 256 KiB | alpha required |
   | `scene-tile` | 512 px | 256 KiB | pattern tile; opaque allowed |
   | `scene-background` | 2048 px | 1 MiB | full background; opaque allowed |

   Add an opaque-allowed mode to `checkImage` for `scene-tile` and
   `scene-background` (it skips `no_alpha`, `solid_background` and
   `opaque_border`, keeps every other check).
2. Hard limits (proposed), enforced by the app on import, by the backend at
   Save and package import, and by the runtime loaders:
   - particle texture or sheet: ≤ 2048 px side, ≤ 4 MiB, grid ≤ 16×16 and
     ≤ 256 frames; ≤ 16 textures and ≤ 32 MiB per effect (today's frontend
     limits of 16 textures and 64 MiB per package stay as outer bounds). The
     creator imports PNG only (R1); the backend keeps accepting the texture
     formats it accepts today, within the same limits;
   - Scene image: the formats accepted today (raster and the restricted SVG),
     ≤ 4096 px side, ≤ 8 MiB; ≤ 16 images and ≤ 32 MiB per effect (today's
     editor limits).
   Fix the values against the P1 designs.
3. One frontend limits module for particle textures and Scene images, reusing
   `readImageDimensions` from `lib/avatar/vfx/effect-image-limits.ts`, and
   matching backend constants checked with `content_image.py`'s bounded
   header reader. Extend `effect-assets.test.mjs`'s sync check and the package
   capability parity fixtures so the script, frontend and backend values
   cannot drift.
4. Update `animama-effect-assets` `SKILL.md` budgets (R8 content lands here
   because the skill names the budgets).

Checks: `pnpm -s test:source` (or the focused `node --test
scripts/effect-assets.test.mjs`), focused vitest, focused pytest,
`pnpm check`, `pnpm web:lint`, `uv run ruff check`.

Completion: `effects:assets check --budget particle-sheet` and the others pass
good art and fail oversized or wrong-format art; the limit sync test fails when
one copy changes.

#### P2 record

Starting source and issue: `050265ef`, #387.

Delivered:

- `effects:assets` budgets `particle-texture` (512 px, 256 KiB),
  `particle-sheet` (2048 px, 1 MiB), `scene-sticker` (512 px, 256 KiB),
  `scene-tile` (512 px, 256 KiB) and `scene-background` (2048 px, 1 MiB).
  Each names its kind's hard limits, and `check` reports those limits. Tiles
  and backgrounds may be opaque (no `no_alpha`, `solid_background` or
  `opaque_border`; a painted checkerboard still fails) and keep their framing
  (`fix` refuses `--trim`, `--square` and `--pad`, as for face-surface art).
- Hard limits in one record,
  `src/frontend/web/src/lib/content/fixtures/effect-art-limits.json`, read by
  the script and compared with `lib/effects/effectArtLimits.ts` (vitest) and
  `app/contracts/effect_art_limits.py` (pytest): Particle textures 4 MiB,
  2048 px, grid 16, 16 per effect, 32 MiB in total; Scene images 8 MiB,
  4096 px, 16 per effect, 32 MiB in total. `inspectEffectArt` checks bytes,
  format and header dimensions without decoding and names the limit it broke.
  Applying the limits in the creators, backend validators and runtime loaders
  is P3 and P5.
- `animama-effect-assets` lists the new budgets and limits.
- Values checked against the P1 designs: every family uses stickers and
  tiles within 512 px, gradients and screens are procedural, and no design
  needs a full background image; `scene-background` exists for user art and
  R6.

Checks (agent, 2026-10-09): `node --test scripts/effect-assets.test.mjs`
(33 pass), `pnpm exec vitest run src/lib/effects/effectArtLimits.test.ts`
(6 pass), `uv run pytest -q tests/test_effect_art_limits.py` (2 pass),
`pnpm check`, `pnpm web:lint`, Prettier on the changed files, `uv run ruff
check` and `ruff format --check` on the new Python files.

#### Code Review #1 Findings

Reviewed source: working tree on `050265ef`; full initial review
(`sdlc-reviewer`).

- **P2-R1-F1 (required):** opaque-allowed budgets skipped the checkerboard
  FAIL as well as the three checks the plan names, so a tile with a painted
  checkerboard passed.
- P2-R1-F2 (optional): reusing `keepsLayout` for tiles also suppresses the
  `interior_translucency` warning.
- P2-R1-F3 (optional): `fix --canvas` was not refused for budgets that keep
  their framing.
- P2-R1-F4 (optional): the backend parity test compared fields one by one, so
  a new fixture key would not fail it.
- P2-R1-F5 (optional): nothing ties the Particle grid limit to the flipbook
  grid that `flipbook` uses for sheets.
- P2-R1-F6 (optional): `inspectEffectArt` repeats container signature checks
  (the Particle package builder has a third copy).
- P2-R1-F7, F8 (notes for P5): SVG Scene images need a path besides
  `inspectEffectArt`; `SCENE_IMAGE_LIMITS` duplicates the Scene editor's
  private count and byte limits.
- P2-R1-F9 (note for P9): `avatar-vfx.md` lists only Avatar budgets.
- P2-R1-F10 (record): this record was empty.

#### Code Review #1 Revisions

- F1 accepted: `detectBackground` always runs; opaque budgets skip only
  `no_alpha`, `solid_background` and `opaque_border`. Test: a checkered tile
  fails with `checkerboard` and without `no_alpha`.
- F2 rejected: Scene tiles are often see-through by design (soft bokeh,
  glows), the same reason face tints skip the warning.
- F3 accepted, then reverted after Code Review #2: refusing `--canvas` for
  every budget that keeps its layout also blocked the documented
  `--budget surface --canvas` reframing of iris and decal art.
- F4 accepted: the pytest compares the whole mapping with the fixture.
- F5 accepted as a sync test: the Particle grid limit equals the flipbook
  grid.
- F6 deferred to P3, which replaces the package builder's signature check
  with the shared one so one detector remains.
- F7 and F8 recorded for P5; F9 for P9; F10 done above.
- Checks after revisions: `node --test scripts/effect-assets.test.mjs`
  (33 pass), the P2 pytest (2 pass), Prettier and ruff on the changed files.

#### Code Review #2 (repair round 1)

- F1, F4 and F5 verified fixed; dispositions consistent.
- **P2-R2-F1 (required):** the F3 change refused `fix --budget surface
  --canvas`, which the Avatar Effect skill and guide document for iris and
  decal art. Fixed by reverting F3 (message and skill restored); `fix
  --budget surface --canvas 512 --art-size 168` is accepted again.

#### Code Review #3 (repair round 2)

Pass: the revert restores the surface `--canvas` workflow; the other guards
and the F1 fix hold; tests 33 and 2 pass. No findings.

### P3 — Particle texture import (R1). #388

Outcome: a user can add their own PNG or sprite sheet to an emitter, and every
texture an effect carries survives open, Save, reopen, recovery and Portable
packages.

1. **Texture identity.** Replace basename matching (`textureIdFromUrl` in
   `lib/avatar/particle-vfx/editor/textures.ts` against `textureManifest.ts`)
   with an effect texture table: each emitter refers to a texture by its
   package-relative path (`textures/<file>.png`), and the table maps it to a
   built-in entry or to imported bytes (`{file, sha256}`, as the Avatar Effect
   creator holds images). Built-in textures stay selectable and are copied into
   the effect when used, as today. A texture that is not built in is kept, never
   resolved to `null`; Duplicate and Add emitter keep it; the preview resolves it
   through a blob URL.
2. **Import.** In the Particle creator's texture control, add "Import PNG…" with
   an optional frame grid (columns × rows, frame count) that sets the emitter's
   tile counts.
   - Before decoding or GPU upload: sniff the PNG signature, read IHDR
     dimensions, check bytes, side, pixel count and grid against the P2 limits.
     Refuse with a message naming the limit; the draft is unchanged.
   - Only then decode and upload.
3. **Opening existing effects.** Reopening an Included or Local item, a
   template or an imported Portable package downloads every texture file the
   descriptor lists (as `hydrateAvatarEffect` does) into the table. Imported
   creator JSON keeps its texture references: a reference with no bytes shows
   as missing with a control to supply the file, and readiness blocks Save until
   it is supplied or replaced. This "Import JSON, then supply textures" path is
   what `effects save` drives in P7.
4. **Save and packages.** Save passes the table's bytes as
   `ParticleVFXContentPackageResource`s with role `texture`; reopen restores
   them. Backend: enforce the P2 hard limits for particle textures at Save and
   package import (PNG signature, bounded header dimensions before any full
   decode, bytes, grid, count and total) with field-specific errors as #298 P1
   did; the runtime's private loader (`loadPrivateParticle`) checks dimensions
   too. Extend the package capability fixtures and the export → import →
   re-export tests.
5. **Recovery.** Move particle recovery to a Blob-carrying record, like the
   Scene and Avatar stores (new recovery schema version; older records still
   restore their JSON). Imported bytes are kept up to the P2 per-effect total;
   above it, recovery keeps the definition, marks the textures missing and says
   so. Undo and redo cover texture import, replacement and removal, with
   resources held in the history snapshots.
6. **Tests:** frontend unit tests for header sniffing and refusals (oversized,
   malformed, non-PNG, too many frames) and for the texture table round-trip;
   backend Save and package tests; a browser test on the task stack that imports
   a PNG and a sprite sheet into an Included effect with non-built-in textures
   and into a new effect, saves, reopens, recovers a draft and round-trips a
   Portable package.

Checks: focused vitest and pytest, `pnpm check`, `pnpm web:lint`,
`uv run ruff check`, `make format-check`, `pnpm openapi-ts` freshness if a
contract changes, and the browser test against the task stack.

Completion: the R1 acceptance items pass on the task stack; existing Local
Particle Effects that use built-in textures still open and play.

#### P3 record

Starting source and issue: `c246cb64`, #388. Task stack `animama-particle-fx`
(development build) at http://animama-particle-fx.localhost:8620; only the
`web` service publishes a port.

Delivered:

- **Texture table.** `ParticleVFXEditorDraft.textureFiles` holds the bytes of
  every texture the effect carries, keyed by its package-relative path. A
  reference is never reused for different bytes (imports get
  `textures/<stem>-<n>.png`), so undo and redo restore textures by restoring
  the JSON; the fingerprint counts used textures by hash. Duplicate and Add
  emitter keep a carried texture (`editor/textureFiles.ts`, `draft.ts`,
  `textures.ts`).
- **Import.** "Import PNG texture" in the emitter's Texture section
  (`EmitterCarriedTextures.tsx`, existing components) checks size, format and
  header dimensions with `inspectEffectArt` before anything decodes it; a
  refusal names the limit and leaves the draft unchanged. The Atlas tile
  fields (now capped at 16) state a sprite sheet's grid; an imported sheet's
  tile counts are its atlas for validation.
- **Reopen, JSON import.** Reopening an item downloads every texture file it
  lists. Imported JSON keeps its texture references: embedded PNG data
  becomes texture files, and a reference without bytes shows "Texture … is
  missing" with a file chooser; readiness blocks Save until it is supplied.
- **Save and packages.** The package builder takes bytes from the draft,
  enforces the P2 limits (bytes, side, total) and returns the saved draft with
  every packaged texture's bytes. The backend checks the same limits and the
  sprite-sheet grid at Save, scan and package install
  (`app/services/effect_art_validation.py` through the kind's companion-file
  validation) and in package capability checks (`_particle`). The runtime's
  private particle loader checks count, total and header dimensions before
  creating object URLs.
- **Recovery.** Particle recovery records (`animama/particle-effect-recovery/3`)
  keep the used textures' Blobs in IndexedDB, up to 37 MiB in all (5 MiB of
  JSON plus the 32 MiB texture total); a larger draft is not stored and the
  creator warns. The text fallback keeps the JSON and says which textures must
  be chosen again; `/2` records still restore.
- **Journey.** `e2e/journeys/accountless-particle-texture-import.spec.ts`
  (allowlisted; `docs/frontend/testing/browser-journeys.md` updated): refusals,
  a PNG and a 4×4 sheet in two emitters, recovery after reload, Save, reopen,
  desktop and narrow screenshots, a Portable package export and import with
  textures intact, and supplying a texture imported JSON refers to.

Included effects today use only built-in texture names, so the "Included
effect with non-built-in textures" case is covered by reopening Local and
imported items through the same code path; P7's throwaway-branch promotion
exercises an Included one.

Checks (agent, 2026-10-09):

- Frontend: focused vitest over the particle, content, effects and runtime
  folders (751 pass); `pnpm check`; `pnpm web:lint`; Prettier on changed
  files; `pnpm e2e:check`.
- `pnpm web:test`: 3,359 pass; 4 fail in `tests/local-api-proxy.test.ts`
  because another session's dev server holds host port 5173 (environmental).
  Script browser tests: the two hosted sign-out tests failed on a fixture
  that wrote `/3` records without `textures`; the fixture now writes texture
  Blobs and both pass. "hosted Library restores mobile navigation after
  Escape" timed out under load and passes alone.
- Backend: `uv run pytest -q -k "content or package or particle or catalog or
  effect" tests` (932 pass, including the new `test_particle_texture_limits.py`
  and the Included content integrity and catalog tests); `uv run ruff check`;
  `ruff format --check`; mypy on the new modules.
- Browser: `pnpm e2e:test -- --project chromium --grep "Particle texture
  import"` on the task stack: 2 passed (setup and the journey, 26 s); the
  content ledger has nothing unresolved.

#### Code Review #1 Findings

Reviewed source: working tree on `c246cb64`, P3 files and hunks only (P4 work
had started in `scripts/` and the Scene hunk of `AnimaRuntimeMediaCatalog.ts`);
full initial review (`sdlc-reviewer`).

- **P3-R1-F1 (required):** the backend checked only files declared with role
  `texture`; a Quarks image may name a file declared `image`, and undeclared
  companions are scanned as textures, so an oversized texture could be admitted
  through Save or a package.
- **P3-R1-F2 (required):** embedded-data extraction named files
  `textures/embedded-<n>.png` from 1 without avoiding references the JSON or
  the carried table already use, so new bytes could replace an existing
  texture.
- P3-R1-F3 (optional): the `sr-only` file input added a second, invisible tab
  stop beside its button.
- P3-R1-F4 (optional): a fetch-path message still said 25 MiB.
- P3-R1-F5 (optional): Pillow's decompression-bomb refusal was reported as a
  format error instead of the size limit.
- P3-R1-F6 (optional): the preview failed as a whole for refused embedded or
  remote images and echoed the URL.
- P3-R1-F7 (optional): the recovery cap is 37 MiB for JSON and textures
  together, and an over-cap IndexedDB record is not stored, not stored without
  textures as step 5 says.
- P3-R1-F8 (optional): built-in identity still matched by basename, so
  `images/heart.png` showed as both the built-in Heart and missing.
- P3-R1-F9 (optional): no test showed a Local scan or package refusing an
  over-limit texture, or reopen failing.
- P3-R1-F10 (optional): duplicated SHA-256 and inspection code; the backend
  wrapped one emitter in a fake manifest.
- P3-R1-F11 (optional): Duplicate gives a carried texture the default
  (additive) blending, as it does for built-in textures.

#### Code Review #1 Revisions

- F1 accepted: `effect_art_validation._texture_paths` checks every companion
  except JSON and text notes, whatever its role; the creator's reopen also
  downloads files registered as `image`. Tests: oversized textures declared
  `image` or undeclared are refused at Save; a Local scan reports an
  oversized texture.
- F2 accepted: extraction allocates references with the same unique-reference
  helper as imports and skips the draft's carried references. Test.
- F3 accepted: the input is `hidden`, as in `SoundUploadButton`.
- F4 accepted: the message names the shared limit.
- F5 accepted: a decompression-bomb refusal reports the 2048 px limit. Test
  with a 30000 × 30000 header.
- F6 accepted: any image that is neither carried nor built in previews as the
  default texture; no URL is shown.
- F7 accepted as recorded behaviour: recovery stores JSON and texture Blobs up
  to 37 MiB together; a larger draft (only possible beyond the Save limits)
  is not stored and the store's "too large" warning shows. The P3 record is
  corrected below.
- F8 accepted: built-in identity matches the exact `textures/<file>` path.
  Test.
- F9 accepted in part: the Local scan test above (package install shares that
  scan) and a `loadParticleVFXTextureFiles` test; a full package round trip
  with an invalid texture is not constructible through Save.
- F10 accepted: the package builder uses `readParticleVFXTextureFile` (one
  inspection and hash); the backend has `emitter_grid_issue`.
- F11 rejected: Duplicate's blending is existing behaviour for every texture
  and outside R1.
- Also fixed: the journey polled recovery before the typed name was stored,
  so a reload could restore an unnamed draft; it now waits for both.
- Checks after revisions: `uv run pytest -q tests/test_particle_texture_limits.py
  tests/test_content_package_capabilities.py` (84 pass); focused vitest over
  the particle, content and creator folders (626 pass); the journey on the task
  stack (2 passed).

#### Code Review #2 (repair round 1)

Pass. F1 and F2 verified fixed (the reviewer's role and size probes now refuse
every case); the other accepted fixes verified. Noted: a Particle entry's
companions other than JSON, text notes and PNG, JPEG or WebP textures (for
example `.svg` or `.wav`) are now refused; no current content has any. Checks:
175 backend tests over the particle, package and content-store files, 367
vitest, eslint and `e2e:check:source` clean.

### P4 — Check, render and bench for Particle and Scene Effects (R3). #389

Outcome: `effects check` and `effects:render` give verdicts and contact sheets
for Particle and Scene effect folders and Library items on both Included
Avatars, alone or together with a Reaction's other effects; `effects:bench`
can measure a Reaction with all its effects.

1. **Sources.** In `effect-render-sources.mjs`, add `particle` and `scene`
   effect folders (`<stem>.json` with `particle_effect` or `scene_effect`) and
   `library:particle-effect/<id>`, `library:scene-effect/<id>` specs, sharing
   `resolveParticleRef` and a new Scene resolver. Allow `vfx/particle` and
   `vfx/scene` in the Vite `fs.allow` list.
2. **Particles in the harness.** Give the stage a media provider (reusing
   `PreviewMediaProvider`) instead of `EMPTY_RUNTIME_MEDIA_PROVIDER`, so effects
   and clip events resolve particles. Seed `Math.random` in the page so frames
   are reproducible.
3. **Scene layers in the harness.** Mount the chat's Scene underlay and overlay
   hosts around a transparent canvas in the render page, pause their CSS
   animations and seek them to the harness frame time (Web Animations API
   `document.getAnimations()`), and capture tiles from the page (Playwright clip
   screenshots) rather than the canvas. Scene Effects render behind and in front
   of the Avatar as the chat scene draws them.
4. **Check.** For each kind: art against its P2 budget; parse with the runtime
   parser and name any bad field; particle counts against the declared budget
   and the runtime limits (4 effects, 512 particles); play on both Avatars and
   prove visibility against a no-effect baseline. Keep the PASS/WARN/FAIL output
   and exit codes.
5. **Render.** `effects:render` writes contact sheets for both kinds and
   `--together`/`--with-clip` show a Reaction's Avatar, Particle and Scene
   Effects as chat would.
6. **Bench.** Extend `effects:bench` with a Reaction mode that measures a
   Reaction with and without its Particle and Scene Effects, including the DOM
   Scene layers (whole-frame time from tracing or frame intervals, plus the GPU
   timer for the canvas). Set its budget constant to 4 ms for this mode. Record
   a baseline for the current heaviest intensity-3 Reaction on the owner's
   development Mac.
7. **Tests:** extend `effects.test.mjs`, `effect-render-sources.test.mjs`,
   `effect-check.browser.test.mjs` and `effect-render.browser.test.mjs` with a
   Particle and a Scene fixture folder, including an invisible effect and an
   over-budget particle count.

Checks: `pnpm -s test:source`, `pnpm check`, `pnpm web:lint`; a sample
`effects check` and `effects:render` of an Included Particle and Scene Effect,
and a Reaction with all three kinds, recorded here; the bench baseline.

Completion: verdicts and contact sheets for both kinds on both Avatars; the
bench reports the Reaction-mode baseline.

#### P4 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P5 — Scene layer capabilities (R2). Waits for G1. #390

Outcome: each capability on the G1 list works in chat, the creator, the Library
preview dock and desktop picture-in-picture, and survives Save and Portable
packages.

1. Record the G1 capability list and its data shapes here before coding.
2. For each capability:
   - types and parser (`lib/scene-vfx/types.ts`, `catalog.ts`) and the
     backend `_scene_effect` validator, with size and count limits on both
     sides and parity fixtures;
   - the renderer in the shared Scene layer hosts, so every surface that shows
     scene layers today shows it;
   - creator controls in the existing Scene creator layout and components
     (Advanced placement is Plan 3's concern; P5 adds the controls where layers
     are edited today);
   - image capabilities use the P2 hard limits and the same pre-decode checks
     as P3.
3. Surfaces: verify that image layers resolve in desktop picture-in-picture
   (blob URLs may be window-local) and that uploaded PNGs keep a matching
   logical name and content type; fix either if broken. Add the missing
   backend range and count checks for existing fields, and pre-decode
   dimension checks to the Scene creator's image import, at the same time (R2
   and the security constraint require both sides), with parity fixtures.
4. Compatibility: existing `animama/scene-effect/1` definitions keep working.
   Additive fields stay `/1`; if a change is incompatible, record how saved
   effects are handled before implementing it.
5. Performance: bench each capability at its densest approved setting with the
   P4 Reaction mode; an over-budget result goes to the owner.
6. Tests: parser and validator tests per capability (frontend and backend),
   Save and package round-trips, a render test per capability through
   `effects:render`, and a browser check in chat and the preview dock.

Checks: focused vitest and pytest, `pnpm check`, `pnpm web:lint`,
`uv run ruff check`, `make format-check`, `pnpm openapi-ts` freshness,
`effects:render` sheets per capability, and the existing saved Scene Effects
still playing.

Completion: the R2 acceptance items pass for every capability on the G1 list.

#### P5 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P6 — Headed preview for Particle and Scene Effects (R4). #391

Outcome: the owner can review a Particle or Scene effect source, or a Reaction
with all its effects, live on both Included Avatars, with review notes.

1. **Sources.** `animation:preview` accepts Particle and Scene effect folders
   and `library:particle-effect/…`, `library:scene-effect/…` specs (extend
   `effectSpecFor`, `choices()` and `sources.ts`). Effect folders reload when
   the definition or any texture or art file changes; review notes and retained
   versions work as for Avatar Effects.
2. **Scene layers per cell.** Add DOM underlay and overlay hosts positioned over
   each cell's scissor viewport, with a transparent canvas clear where a cell
   shows a Scene Effect. Share the stage code with the P4 harness where
   practical.
3. **Reactions.** `previewMedia.ts` resolves `scene_vfx` events from meta
   dependencies (replacing the "not shown" notice), so a Reaction or Gesture
   shows its Scene Effects with its Avatar and Particle Effects.
4. **Tests:** extend `animation-preview.browser.test.mjs` with a Particle
   source, a Scene source and a Reaction with all three kinds;
   `previewMedia.test.ts` and `sources.test.ts`.

Checks: `pnpm -s test:source`, `pnpm check`, `pnpm web:lint`; a headed session
showing each source type, recorded here.

Completion: the R4 acceptance items pass.

#### P6 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P7 — Save and promote (R5). Gate G3. #392

Outcome: Particle and Scene effect folders can be saved as Local content
through their creators and, after owner approval, promoted to Included content.

1. **Save.** `effects save` accepts Particle and Scene items: it opens
   `/particle-effects/new|<id>/edit` or `/scene-effects/new|<id>/edit`, imports
   the definition through the creator's Import dialog, attaches textures or art
   through the creator's file inputs (P3, P5), saves, reads the item back,
   compares it with the source and reopens it. It revises the single Local item
   with the same name and refuses names the app would refuse.
2. **Promote.** `effects promote` gains `particle_effect` and `scene_effect`
   kinds with add, replace and delete:
   - targets `vfx/particle/quark/<stem>/` (ID `builtin:particle-effect:<stem>`)
     and `vfx/scene/<stem>/` (ID with its lane segment);
   - validates the definition and re-checks every image against its budget;
   - writes inventory rules and source-review records as decided in D1;
   - replace keeps the content ID; delete refuses while an Included Action
     depends on the item; Reactions and Gestures that depend on promoted Local
     items are re-pointed in the same run (existing `EVENT_DEPENDENCIES`);
   - `--dry-run` prints every file and record.
3. **Removed dependencies.** Test the spec's pre-launch removal behavior: a
   Local Reaction that references a removed Included Particle or Scene Effect
   plays without it, and its creator reports the missing dependency.
4. **Tests:** `effects.test.mjs` (save item parsing and planning, promote
   dry-run and write into a temporary content root for both kinds, dependency
   refusal); a browser test of `effects save` for both kinds on the task stack.
5. **Demonstration (G3).** On a throwaway local branch that is never pushed,
   promote one saved Particle and one Scene effect, run the Included content
   tests on it, record the result here, then delete the branch.

Checks: `pnpm -s test:source`, `pnpm check`, `pnpm web:lint`, focused pytest
(`tests/test_included_content_integrity.py`,
`tests/test_included_content_catalog.py`,
`scripts/public-release/test_prepare_source.py`) on the demonstration branch.

Completion: the R5 acceptance items pass; no Included content is written on the
task branch.

#### P7 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P8 — Pipeline skills and fresh-agent dry runs (R7). Gate G2. #393

Outcome: a fresh agent can make one new Particle Effect and one new Scene Effect
from a brief to Local content by following the skills alone.

1. Rewrite `.agents/skills/animama-particle-vfx/SKILL.md` as a pipeline in the
   `animama-avatar-vfx` shape (0 interview, 1 brief, 2 art through
   `animama-effect-assets`, 3 effect folder, 4 `effects check`, 5 renders and
   the owner's live preview, 6 `effects save` and reopen, 7 use in a Gesture or
   Reaction, 8 hand-off, 9 owner-gated Promote). Keep `three-quarks.md`,
   `creator.md` and `integration.md` as references, updated for texture import;
   add `brief.md` (the spec's brief fields, including the mechanic, such as one
   long-lived particle, a burst or a stream), `effect-folder.md`, `batch.md` and
   `promote.md`. Update `agents/openai.yaml` with a default prompt.
2. Add `.agents/skills/animama-scene-vfx/` in the same shape, with references
   for layers (including the P5 capabilities), focus lines and the Scene
   creator, plus `brief.md`, `effect-folder.md`, `batch.md` and `promote.md`.
3. Dry runs: a fresh agent with no conversation context follows each skill to
   make one effect from a given brief, through G2 and `effects save`. Proposed
   briefs: a Particle "Sweat spray" (R9 #8, a burst with imported droplet art)
   and one emotion's background from an approved G1 family. Record every point
   where the agent stalled, guessed or broke a rule; fix the skill or tools and
   repeat once if the fixes were material.

Checks: the dry-run records (commands, check output, render sheets, the G2
outcome, the saved Local item reopened).

Completion: the R6/R7 acceptance items pass.

#### P8 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P9 — Documentation and acceptance (R8). Gate G4. #394

1. **Documentation:**
   - `docs/frontend/runtime/avatar-particle-vfx.md`: texture import, the
     texture table, limits, and the tools;
   - `docs/frontend/runtime/scene-vfx.md`: the new capabilities, limits and
     the tools;
   - `docs/frontend/runtime/avatar-vfx.md` §9: say which tools accept all
     three kinds, or move the shared tool reference to one place the three
     guides link;
   - `GLOSSARY.md`: Particle Effect admits a single long-lived particle with
     particle behaviour; the Avatar Effect sentence is aligned (owner decision,
     2026-10-09);
   - the effect skills that refer to Particle or Scene work
     (`animama-avatar-vfx`, `animama-effect-assets`, `animama-animation`).
2. **Chat on the task stack:** an effect with an imported texture and each new
   Scene capability through a Reaction or Gesture on a test Anima.
3. **G4 walkthrough** at desktop and narrow widths, with screenshots, for the
   owner.
4. Full checks (see Validation), the final integration review and the PR.

#### P9 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

`sdlc-reviewer` reviews the combined scope against the spec's R1–R8 acceptance
criteria, reusing still-valid phase evidence. It gets one full review and at
most two repair rounds. Record findings and revisions here. Agent readiness does
not replace G4 or merge approval.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| R1 | Import and refusal unit tests; backend Save and package tests; browser walkthrough (Included and new effect, sprite sheet, recovery, package round-trip) | P3, P9 |
| R2 | G1 record; per-capability parser, validator, render and round-trip tests; chat, creator and preview-dock checks; old Scene Effects still play | P1, P5, P9 |
| R3 | `effects check` verdicts and `effects:render` sheets for a Particle and a Scene folder on both Avatars; script tests | P4 |
| R4 | Preview browser tests; headed session record | P6 |
| R5 | `effects save` browser test for both kinds; promote tests; throwaway-branch demonstration | P7 |
| R6 | Budget and limit-sync tests | P2 |
| R7 | Dry-run records and fixes; G2 | P8 |
| R8 | Documentation diff | P2, P8, P9 |
| Performance | Bench baseline and per-capability measurements within 4 ms (final acceptance on the heaviest intensity-3 Reaction comes with Plan 2 content) | P4, P5 |

Before the PR, run:

- from the repository root: `uv run pytest -q`, `make check`,
  `uv run ruff check`;
- from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
  `pnpm build`, `pnpm desktop:check`, `pnpm prettier:check` and `pnpm
  openapi-ts` freshness;
- from `src/frontend/web`: `pnpm -s test:source`;
- the full `pnpm e2e:test` against a disposable built stack (creator, content
  package and import/export changes).

This plan changes content contracts, validation and creators, so it keeps full
hosted validation. Check that the hosted workflow is enabled; if it is not, the
PR states that no hosted checks ran.

## Idempotence and recovery

- **Definitions:** Scene changes are additive within `animama/scene-effect/1`
  unless P5 records otherwise; Particle descriptors gain only texture files.
  Existing saved effects keep opening and playing.
- **Promotion:** `--dry-run` first; writes are reviewable Git changes on a task
  branch and are reverted with Git. The demonstration branch is local and
  deleted afterwards.
- **Recovery storage:** per-kind storage names are unchanged; drafts above the
  texture bound keep their definition and report missing textures.
- **Database:** no schema change is expected. If one is needed, update the ORM
  and `alembic/versions/0001_baseline.sql` directly and record the reset.
- **Drafts:** briefs, mocks and dry-run sources live under `.animama-drafts/`
  and can be regenerated.
- **Task stack:** its own Compose project and Local content; the main stack is
  never stopped or purged.

## Outcomes & Retrospective

Not started.
