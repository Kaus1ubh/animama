# Avatar Effects v2, a unified effects creator and agent-authored Avatar Effects

Status: Agreed
Owner decision: Intent discovery on 2026-10-06 settled the problem, scope, the
two-plan delivery and the decisions listed under
[Open questions and decisions](#open-questions-and-decisions). Later on
2026-10-06 the owner reviewed this draft, accepted its proposals, added the
template picker (R7) and effect-intent (R14, R15) requirements, and asked for
the Plan 1 ExecPlan. That request accepts this specification as the planning
basis.
Authoritative source: [#298](https://github.com/raymond-van/animama/issues/298).
This file is a snapshot of the issue as last updated on 2026-10-07T21:34Z.
Related: [#297](https://github.com/raymond-van/animama/issues/297) (deferred
Particle and Scene Effect work), [#282](https://github.com/raymond-van/animama/issues/282)
(track-based Anima Pose Clips), [#289](https://github.com/raymond-van/animama/issues/289)
(interactive motion preview tool), [#291](https://github.com/raymond-van/animama/issues/291)
(wave 2 reactions). PR #267 delivered the agent Gesture pipeline this work
mirrors.

## Problem and intended users

Avatar, Particle and Scene Effects are meant to make chatting with an Anima feel
engaging and a little magical. Avatar and Scene Effects borrow from anime, for
emphasis and comedy. Particle Effects borrow from selfie filters and gacha games.
Today they fall short in four ways.

**The Avatar Effect model is inflexible.** It predates most of the current app:

- Art attaches only to the face. An effect is a face texture, a face decal at
  one of three anchors (under-eye, blush, mouth), or a flat "hover" plane at the
  eyes, the mouth or one of 11 fixed forehead and top-edge positions. Nothing can
  attach to the body, sit beside the avatar or cover its whole figure.
- Each effect has exactly one image. Motion is limited to procedural pulse, spin
  and drift. There is no opacity, tint, blend mode or frame animation.
- Placement is resolved once, when the effect is applied, and hover planes follow
  only the head bone.
- Effects depend on VRoid-style material names. Face skin, irises, eyelashes, eye
  lines and highlights are found by matching material names against patterns
  (`src/frontend/web/src/lib/avatar/vfx/profiles.ts`). The VRM specification does
  not define material names, so a valid model from another tool may show no
  effects.
- The `envelope` and `parameterKeyframes` fields on `avatar_vfx` clip events are
  parsed and authored but ignored at runtime.

**The definition has drifted.** Its enums are copied in four places (runtime
types, the catalog parser, the backend export validator and the creator). The
backend stores definitions unchecked on Save and validates them only on package
export. The export validator's field list
(`src/backend/animama/app/services/content_package_capabilities.py`) omits
`forceBlink`, `autoDisableEyeMaterials` and `faceCleanup`, which the creator
always writes for eye and mouth hovers and mouth decals. Those effects are
therefore expected to fail export; this was found by reading the source, not by
running an export. Included effects also carry legacy `lifetime` and `emotions`
fields that the creator drops on re-save, and the creator's template catalog
(14 entries) does not match the 16 Included effects.

**The creators are hard to use.** Avatar, Particle and Scene Effects each have a
separate creator route, with about 9,000 page lines in total and three copies of
save, undo and draft recovery. The Avatar Effect creator exposes 35–40 controls
with jargon such as "Target material role", "Asset shape" and "Effect region",
plus position fields that do nothing for some kinds. Only the Scene creator
offers starting templates.

**The library is thin and mostly below launch quality.** There are 16 Included
Avatar Effects: 12 eye, mouth or emote hovers and 4 face textures, with no
blush, tears or body effects. Chat never selects an effect directly; effects
appear only through the Reactions (24 emotions × 3 intensities) and Gestures
that use them, and only 36 of the 94 Included Actions use any effect. There is
no agent pipeline for effects comparable to the `animama-animation` skill. The
existing `animama-avatar-vfx` and `animama-particle-vfx` skills are operating
manuals without generation, checks or renders.

Intended users:

- **Anima users** see richer, better-crafted effects during chat.
- **Creators**, including new users, make their own effects from templates by
  placing art directly on the avatar.
- **Coding agents** author textures and Avatar Effects with repository skills,
  for owner review.
- **The owner** reviews effects in a live preview before they enter the launch
  library.

## Goals, scope and non-goals

Delivery uses two ExecPlans under this one specification, each with its own
branch and PR:

- **Plan 1, platform:** R1–R11.
- **Plan 2, content:** R12–R16. It starts after Plan 1 merges.

In scope:

1. Correcting the current Avatar Effect definition and export gaps.
2. An `animama/avatar-effect/2` definition with new attachments, appearance
   controls, frame animation and keyframed motion; a one-time conversion of
   every `/1` effect.
3. Face and eye part detection that does not depend on material names, with a
   user correction saved with the Avatar.
4. Effects attached to the body, offset stickers beside the avatar and a
   silhouette overlay.
5. A template picker for all three effect kinds, shared creator infrastructure,
   and the existing Avatar Effect creator extended for `/2` with direct
   manipulation, keeping the current UI and styling.
6. A headed and headless effect preview on both Included Avatars.
7. A shared effect-asset skill and a reworked Avatar Effect authoring skill.
8. About 25 high-quality Avatar Effects, Reactions wired per emotion, and
   promotion of the approved set to Included content.

Non-goals and deferrals:

- New Particle and Scene content, a redesign of the Particle and Scene inspectors,
  their skills and removal of low-quality Included Particle and Scene Effects
  ([#297](https://github.com/raymond-van/animama/issues/297)).
- Comic text generated at runtime from words in an Anima's reply (stretch goal).
- Dragging an asset from a tray onto the avatar to choose its attachment
  (stretch goal). Direct manipulation of art already placed is in scope.
- Changes applied across every avatar material (for example turning the whole
  model to stone).
- Proof on VRM models other than the two Included Avatars. Detection must not
  rely on material names, but acceptance uses only the Included Avatars.
- Use of mouth effects in Idle Styles (a later decision).
- Chat selecting effects directly rather than through Actions.
- A new content kind that bundles several effects; a Reaction already composes
  avatar, particle, scene and sound events on one timeline.

## Required behavior

### Plan 1 — platform

#### R1 — Current definition and export fixes

- Package export accepts every field the creator writes, including
  `forceBlink`, `autoDisableEyeMaterials` and `faceCleanup`. A test exports and
  re-imports one effect of each current kind.
- Saving an effect validates its definition on the backend with the same rules as
  export, so an invalid definition is rejected at Save with a message naming the
  field.
- The Avatar Effect definition has one source of truth for its fields and enums,
  used by the frontend runtime, the creator and the backend.
- Legacy `lifetime` and `emotions` fields are removed from Included effects and
  the creator template catalog, and nothing reads them. Action events own timing.
- Creator templates come from the same source as the Included effects, so the
  creator and the Library cannot disagree.

#### R2 — The `animama/avatar-effect/2` definition

A v2 effect describes four separate things:

- **Attachment — where the art goes:**
  - *face surface*: painted onto the face, eye or other detected part, as an
    overlay or a replacement (today's texture and face-decal behavior);
  - *face landmark*: a plane in front of an eye, the mouth, the forehead or above
    the head, with a free offset (today's hover behavior, without the fixed list
    of 11 positions);
  - *body*: a plane attached to a humanoid body point, at least the Particle
    Effect anchor set (root, hips, spine, chest, neck, head, hands and feet);
  - *offset sticker*: a camera-facing image placed beside or around the avatar
    that follows it, for comic lettering and stickers;
  - *silhouette overlay*: art drawn only where the avatar is visible, masked to
    its outline, without changing its materials.
- **Appearance:** opacity, tint and blend mode (normal, additive, multiply).
- **Art:** a single image; an optional separate image for the other eye, so
  asymmetric designs such as a wink do not need two effects; or a flipbook
  (frames on a grid, with a frame rate and loop setting).
- **Motion:** the existing pulse, spin and drift presets, plus keyframed changes
  to position, scale, rotation and opacity over the effect's own timeline.

Eye-related options that exist today (hiding eye details, forced blink, face
cleanup and skin backdrop) remain available where they apply. Every v1 effect
can be expressed in v2 without visible change.

#### R3 — Conversion from `/1`

- A conversion rewrites every Included `/1` effect as `/2` in the repository.
- A documented command converts `/1` effects in a Local library.
- After conversion the app accepts only `/2`. A `/1` definition, whether Local or
  in an imported package, is rejected with a message that names the conversion
  command.
- Converted effects keep their content IDs, so Gestures and Reactions that
  reference them keep working without edits.

#### R4 — Model-agnostic face and eye parts

- When an Avatar loads, the app identifies its face skin, left and right eyes and,
  where possible, eyelashes, eye lines and eye highlights. It uses VRM signals
  such as the humanoid eye bones, skin weights and the meshes that the `blink` and
  `aa` expressions morph, and falls back to material names only when those
  signals are insufficient.
- The creator shows the detected parts for the selected Avatar and flags parts
  that are missing or uncertain.
- The user can correct a part by choosing it on the preview avatar or from a
  list. The correction is saved with the Avatar and used by every effect on that
  model, both in the creator and in chat.
- An effect whose required part is unavailable on a model is not applied there.
  The creator explains why; chat continues without the effect and records a
  diagnostic.

#### R5 — Attachments beyond the face

- Body, offset-sticker and silhouette-overlay effects follow the avatar while it
  moves during Gestures, Reactions and idle motion.
- Offset stickers keep a readable size relative to the avatar and are not hidden
  behind it.
- A silhouette overlay covers only the avatar's visible pixels and does not alter
  its materials, expressions or other effects.

#### R6 — Timing, fade and motion ownership

- The effect owns its intrinsic motion (presets, keyframes and flipbook frames).
- The Gesture or Reaction event owns when the effect starts and ends and its fade
  in and out. The runtime honours the event `envelope`, which today is parsed but
  ignored.
- The `avatar_vfx` event shape is unchanged, so `animaPoseClip/1.0` and `2.0`
  clips keep referencing effects the same way.

#### R7 — Unified effects creator

- **Template picker.** The sidebar's create menu has a single **Effects** entry
  in place of today's three separate effect links (Particle VFX, Avatar VFX,
  Scene VFX). It, the Create page and the `/effects/new` route open one modal
  with two steps:
  1. **Choose a kind.** Three centered cards: Particle FX, Avatar FX and Scene
     FX.
  2. **Choose a starting point.** The chosen kind's templates plus **Start from
     scratch**, with a way back to step 1.
     - Avatar FX templates show thumbnails captured on the Included Avatar
       "Annie" (`AvatarSample_A_1_New`), drawn from the Included Avatar
       Effects.
     - Scene FX offers its existing starting templates.
     - Particle FX offers Start from scratch until its thumbnail templates
       arrive with #297.
  - Choosing a template or Start from scratch goes to that kind's creator route,
    with a new, unsaved Local draft based on the choice. Included content is
    never modified. Closing the modal returns the user to where they were.
- All three effect kinds share one implementation of save, undo and draft
  recovery. Each creator keeps its existing layout and styling (owner,
  2026-10-06: no UI redesign at this point).
- The picker and creator changes reuse the existing UI components and styling.
  The Particle and Scene editors keep their current inspector controls.
- Existing creator routes and Library Edit links keep working.

#### R8 — Avatar Effect editor and direct manipulation

- The existing Avatar Effect creator layout and styling are kept and extended
  for `/2`, reusing existing inspector components. It shows only the controls
  that apply to the chosen attachment, labelled in plain language with units
  that match the attachment (rotation in degrees). Simpler controls are added
  where needed, and deprecated, legacy or confusing controls are removed or
  replaced.
- The user positions art by dragging it on the preview avatar. It moves along its
  attachment: across the face for face-surface art, and in the attachment's plane
  for landmark, body and sticker art. Handles scale and rotate it.
- Each drag is one undo step. The Advanced fields and the on-canvas art stay in
  sync both ways.
- Front, three-quarter and face views and both Included Avatars are available
  while editing.

#### R9 — Creator quality

- The creator has defined loading, empty, error and unsaved-change states, and no
  layout shifts while previews load or panels change.
- Every editing action can be undone.
- Controls are reachable by keyboard and labelled; direct manipulation has a
  numeric equivalent.
- The layout works at desktop sizes first and remains usable at narrower widths.

#### R10 — Effect preview

- A headed preview, built on the interactive motion preview tool from #289, shows
  an effect source or Library item on both Included Avatars side by side. It
  applies the effect on a loop or over a chosen duration, offers the tool's camera
  presets and transport, reloads when the source changes, and supports review
  notes.
- It can also play a Gesture or Reaction with its effects, as in chat.
- A headless mode writes a contact sheet of effect frames on both Included Avatars
  for agent review.

#### R11 — Documentation

The Avatar Effect runtime guide (`docs/frontend/runtime/avatar-vfx.md`), the
glossary, the `animama-vrm` skill's materials reference and the conversion
command's usage describe v2, part detection and correction, and the unified
creator.

### Plan 2 — content

#### R12 — Shared effect-asset skill

A repository skill turns an art brief into textures that are ready to use:

- It generates images through an image generator that produces real RGBA PNGs.
  The owner's environment uses the global `image-gen` skill (Codex image
  generation).
- Repository scripts check and fix each image: real transparency (no painted
  checkerboard), near-opaque pixels set to fully opaque (a probe on 2026-10-06
  returned art at alpha 250–254), transparent padding trimmed, size reduced to a
  stated budget, and flipbook frames assembled on a grid.
- It records provenance for each generated file: who generated it and with which
  tool.
- It is reusable by #297 for particle textures, sprite sheets and scene tiles.

#### R13 — Avatar Effect authoring skill

The `animama-avatar-vfx` skill becomes a generation pipeline that follows the
`animama-animation` skill's shape: brief → assets (R12) → v2 definition →
checks → headless renders → the owner's review in the headed preview → creator
Import and Save as Local content → reopen → an explicit, owner-approved
**Promote to Included** step (R16), modelled on the Gesture promotion tool and
skill step from #310. The checks
cover definition validity, image budgets, a resolved attachment on both Included
Avatars and visible art in the rendered frames. A fresh-agent dry run follows the
skill end to end, and the gaps it finds are fixed.

#### R14 — Avatar Effect library

About 25 high-quality Avatar Effects of varied attachment kinds, using one effect
per emotion as inspiration.

Each effect has a written brief before its art is made, stating what it
expresses, the comedic or emotional beat it lands (comedic uses are preferred),
its attachment and placement, the Reaction intensities (1–3) it suits, and how it
moves and how long it lasts. Its assets and settings follow the brief, and the
owner reviews the brief together with the rendered effect.

The existing effects are mostly kept but get upgraded
art. Confirmed upgrades: Eye =, Eye 0, Eye Confused Swirl, Eye O, Mouth w and
Star3. Eye VV Pair merges into the single-eye Eye VV. The proposed list below
has 28 candidates covering all 24 Reaction emotions; the owner trims and edits
it before Plan 2 starts.

| # | Effect | Attachment | Status | Emotions |
| --- | --- | --- | --- | --- |
| 1 | Anger mark | Face landmark (forehead) | Keep, review art | anger, annoyance |
| 2 | Exclamation (Emote !) | Face landmark (above head) | Keep, review art | fear, curiosity |
| 3 | Eye = | Face landmark (eyes) | Upgrade | disapproval, disgust |
| 4 | Eye 0 | Face landmark (eyes) | Upgrade | fear, grief |
| 5 | Eye Confused Swirl | Face landmark (eyes), flipbook | Upgrade | confusion |
| 6 | Eye O | Face landmark (eyes) | Upgrade | curiosity, fear |
| 7 | Eye VV (absorbs Eye VV Pair) | Face landmark (eyes) | Keep | amusement, embarrassment |
| 8 | Mouth Hover w | Face landmark (mouth) | Keep, preview only | (not wired; see R15) |
| 9 | Mouth w | Face surface (mouth) | Upgrade, preview only | (not wired; see R15) |
| 10 | Star eyes | Face surface (irises) | Keep | admiration, excitement |
| 11 | Star3 | Face surface (irises) | Upgrade | admiration, joy |
| 12 | Gloom face | Face surface (face) | Keep | grief, remorse |
| 13 | Sick face 1 | Face surface (face) | Keep | disgust |
| 14 | Sick face 2 | Face surface (face) | Keep | disgust |
| 15 | Sick face 3 | Face surface (face) | Keep | disgust |
| 16 | Blush | Face surface (cheeks) | New | embarrassment, love |
| 17 | Streaming tears | Face surface (under eyes), flipbook | New | sadness, grief, gratitude |
| 18 | Sweat drop | Face landmark (temple) | New | nervousness, embarrassment |
| 19 | Gloom lines | Face landmark (forehead) | New | disappointment, remorse |
| 20 | Heart eyes | Face surface (irises) | New | love, desire |
| 21 | Sparkle eyes | Face surface (eye highlights) | New | optimism, excitement |
| 22 | Steam puffs | Face landmark (above head), flipbook | New | anger, annoyance |
| 23 | Heart throb | Body (chest) | New | caring, love, gratitude |
| 24 | Comic "DOKI DOKI" | Offset sticker | New | love, nervousness |
| 25 | Idea light bulb | Offset sticker | New | curiosity, confidence |
| 26 | Music notes | Offset sticker | New | joy, amusement |
| 27 | Despair shade | Silhouette overlay | New | grief, fear |
| 28 | Respect shine | Face landmark (around head), flipbook | New | respect, confidence |

#### R15 — Reactions wired per emotion

- Each of the 24 Reaction emotions has at least one Reaction variant that uses a
  fitting Avatar Effect from R14.
- Each assignment follows the effect's brief: the effect suits the Reaction's
  emotion and intensity tier, and its timing and placement work with the
  Reaction's expression. A Reaction uses an effect only when it adds a clear
  beat, not to reach coverage.
- Effects applied to the lip-synced mouth (Mouth w, Mouth Hover w) are not used
  in any Reaction or Gesture. They are removed from `amusement-2` and
  `amusement-3`, which use them today.
- The `shy-finger-poke` Gesture switches from Eye VV Pair to Eye VV.
- Reaction edits use the clip format current when Plan 2 runs. After #282 merges,
  saves write `animaPoseClip/2.0`.

#### R16 — Promotion to Included content

- Each R14 effect and each R15 Reaction change is promoted to `content/included/`
  only after the owner approves it in the headed preview on both Included
  Avatars.
- Promotion is an explicit, owner-approved step in Plan 2's PR. Agents otherwise
  never write Included content.
- Each promoted file is covered by a record in
  `content/included/licenses/inventory.json` stating its provenance, including
  that generated art was generated by the owner with the named tool. The included
  content integrity and starter closure tests pass.

## Constraints

- **Compatibility:**
  - The content kind stays `avatar_effect`, and content IDs are unchanged.
  - `avatar_vfx` events in `animaPoseClip/1.0` and `2.0` are unchanged.
  - Existing Gestures and Reactions play without edits, apart from the R15
    changes.
  - Converted effects look the same as before. Comparison renders before and
    after conversion are the evidence.
- **Data:**
  - Saving a correction with an Avatar changes the Avatar content model. Avatars
    are bare `.vrm` files today with no descriptor, and Included Avatars are
    read-only.
  - During development, update ORM and `alembic/versions/0001_baseline.sql`
    directly; add no Alembic revisions.
  - Portable packages must carry what an imported effect or Avatar needs.
- **Security:**
  - Images and definitions are untrusted input. Enforce size, dimension and frame
    limits before decoding or uploading to the GPU.
  - Effects make no network requests.
- **Performance:**
  - Frame cost is measured on the chat canvas with a heavy combination active
    (a face-surface effect, an eye effect, a body effect and a silhouette
    overlay) and compared with no effects. The budget is 2 ms (see the
    accepted decisions).
  - Texture uploads for animated art stay throttled, as today's 30 FPS effect
    animation is.
- **Accessibility:** see R9. The `presentation.disable_vfx` preference continues
  to suppress clip-owned effects.
- **Repository boundaries:**
  - The build, tests and app must not depend on the owner's image generator,
    Codex or any skill. The skills are optional authoring tools.
  - Asset-processing scripts must work on any PNG.
  - No Cloud dependencies.
- **Sequencing:**
  - R10 depends on #289 merging.
  - Plan 2's Reaction edits come after #282 and #291, so the same Reactions are
    not edited twice.
- **Desktop first:** UI work is verified at desktop sizes, then at narrower widths.

## Acceptance criteria

- [ ] **R1:** Tests export and re-import one effect of each current kind; reject
      an invalid definition at Save with a field-specific message; and show the
      frontend and backend sharing one definition source. No code reads
      `lifetime` or `emotions`.
- [ ] **R2, R3:** Every Included effect converts to `/2`. Headless renders of
      each effect on both Included Avatars, before and after conversion, match
      visually, and the owner confirms any differences. Each existing Gesture and
      Reaction that uses an effect plays it after conversion. A `/1` import is
      rejected with the conversion hint. Tests cover the v2 schema, flipbooks,
      the other-eye image, appearance controls and keyframes.
- [ ] **R4:** With material-name matching disabled, detection finds face skin
      and both eyes on both Included Avatars. A test shows that a corrected part
      persists with the Avatar, survives reload and applies in chat. Browser
      evidence shows an effect with a missing part reported in the creator and
      skipped in chat without errors.
- [ ] **R5, R6:** In the headed preview and in chat on both Included Avatars, a
      body effect, an offset sticker and a silhouette overlay follow the avatar
      through a Gesture, and an event's fade in and out is visible. Tests cover
      the envelope timing.
- [ ] **R7–R9:** A browser walkthrough with screenshots at desktop and
      narrow widths covers: creating each kind from a template; placing art by
      dragging, scaling and rotating; undo and redo; correcting a part; save and
      reopen; recovering a draft; and opening each kind from a Library Edit link
      and an old route. The owner reviews the walkthrough.
- [ ] **R10:** The headed preview plays an effect source and a Library Reaction
      with effects on both Avatars, reloads on change and records a note. The
      headless mode writes a contact sheet. A browser test covers the headless
      mode.
- [ ] **Performance:** a recorded measurement of the heavy combination meets the
      agreed budget.
- [ ] **R11:** The listed documentation is updated.
- [ ] **R12, R13:** A fresh agent following the skills produces one new effect
      from a brief, passes the checks and renders, and saves it as Local content.
      Asset checks have tests (alpha, near-opaque fix, trim, size, frame grid).
- [ ] **R14–R16:** Each listed effect, as finally agreed, has been approved by the
      owner in the headed preview on both Avatars. Every emotion has a Reaction
      variant using one. Mouth effects are used by no Action. The promoted
      content passes `tests/test_included_content_integrity.py` and the starter
      content closure tests, with licence inventory records.
- [ ] Applicable checks pass, with any unperformed checks stated: from
      `src/frontend`, `pnpm check`, `pnpm web:lint`, `pnpm web:test` and
      `pnpm build`; from the repository root, `uv run pytest -q` for the affected
      backend tests and `uv run ruff check`.

## Open questions and decisions

Decisions (owner, 2026-10-06):

- The Avatar Effect model is the bottleneck and will be reworked; existing
  effects must keep working.
- Delivery is two plans, platform then content, under this spec. Particle and
  Scene content, their inspector redesign and their skills move to #297.
- The unified creator covers all three kinds through a shared shell and a
  template picker. Only the Avatar Effect editor is redesigned now. (Narrowed on
  2026-10-06: the existing UI and styling are kept; see Later decisions.)
- Proof uses the two Included Avatars. Detection must not depend on material
  names. When detection fails, the user chooses the right part, and the choice is
  saved with the Avatar.
- In scope beyond the face: body-anchored art, offset stickers and silhouette
  overlays. Comic text from chat words and tray drag-and-drop are stretch goals,
  out of scope.
- Placement is by direct manipulation, with numeric fields under Advanced.
- Flipbook art is part of v2.
- `/1` effects are converted directly rather than read permanently.
- An effect owns its own motion; the Action event owns timing and fade.
- ~~The owner approves a clickable prototype before creator implementation.~~
  Withdrawn on 2026-10-06; see Later decisions.
- Texture generation uses a shared effect-asset skill built on the owner's global
  `image-gen` skill.
- Reactions are wired per emotion. Effects applied to the lip-synced mouth are
  not used in Reactions or Gestures but are still upgraded and previewed.
- Single-eye Eye VV replaces Eye VV Pair.
- The export bug and the creator/Included gaps are fixed in Plan 1.

Accepted proposals (owner, 2026-10-06, on review of this draft):

- **Part corrections.** A correction is stored in a new optional Avatar
  descriptor beside a Local Avatar's `.vrm` and exported with the Avatar. A
  correction to an Included Avatar is stored as a Local override keyed to that
  Avatar's content ID and revision, and is included in Anima package exports.
- **Name-free detection checkpoint.** If an early Plan 1 spike cannot identify
  face skin or an eye on an Included Avatar without names, the owner decides
  whether name fallback is acceptable for that part.
- **Replacement rules.** Effects on the same face region replace each other as
  today. Body, sticker and silhouette effects coexist, up to a stated maximum
  number of active effects.
- **Performance budget.** The heavy combination adds no more than 2 ms of frame
  time on the owner's development Mac compared with no effects.
- **Conversion.** `/1` effects are converted once; afterwards only `/2` is
  accepted, and a `/1` definition is rejected with the conversion hint.
- **Included content.** Promotion in Plan 2 (R16) is the only place an agent
  writes `content/included/`, and only after the owner's approval in the PR.

Additions (owner, 2026-10-07):

- The Avatar Effect skill (R13) mirrors the `animama-animation` pipeline,
  including a gated Promote to Included step like the one #310 adds for
  Gestures.

Additions (owner, 2026-10-06):

- The effect entry point is a template picker modal with a section per kind and
  Annie thumbnails, starting with Avatar Effects (R7).
- Every new effect, its assets and its Reaction assignments follow a written
  brief with a clear intent, preferring comedic uses (R14, R15).

Later decisions (owner, 2026-10-06, after the prototype review):

- The effect creators keep their existing layout and styling; this work is not
  a visual redesign. Existing UI components are reused where possible. UX still
  improves: art is dragged, scaled and rotated on the preview; new, simpler
  controls are added where needed; and deprecated, legacy or confusing controls
  are removed or replaced (for example jargon such as "Target material role" or
  "Asset shape", and position fields that do nothing for some kinds). The
  prototype gate is withdrawn.
- The sidebar's three effect links become one **Effects** entry that opens the
  two-step picker modal (kind cards, then templates or Start from scratch),
  which redirects to the chosen creator route (R7).

Open:

- **Final effect list (before Plan 2).** The owner edits the R14 table.
- **Dependency on #289.** The headed preview (R10) builds on #289's preview
  tool, which merges with the whole #282 plan. If #282 has not merged when
  Plan 1 reaches R10, the owner decides whether to wait or to deliver the headed
  preview separately.
- **Deferred:** whether mouth effects are offered through Idle Styles.

## Spec

[#298](https://github.com/raymond-van/animama/issues/298); this file is its
2026-10-06 snapshot.

## ExecPlan

Plan 1 (R1–R11): [avatar-effects-v2-execplan.md](avatar-effects-v2-execplan.md),
approved; the owner authorized P1–P11 on 2026-10-06. Plan 2 (R12–R16) is planned after Plan 1 merges.

## Delivery links

Parent: #298. Plan 1 phase issues: #299 (P1) – #309 (P11). Follow-up: #297.
