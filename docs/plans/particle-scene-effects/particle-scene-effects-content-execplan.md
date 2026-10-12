# Particle and Scene Effect launch library (Plan 2, content)

Source agreement: [#297](https://github.com/raymond-van/animama/issues/297)
(snapshot: [particle-scene-effects-spec.md](particle-scene-effects-spec.md)),
requirements R9–R14, with the final lists and the R12 change the owner decided
on 2026-10-10 (Decision Log). The spec's open "Final lists" item is resolved
by those decisions; Preparation publishes them to #297.
Authorized scope: the plan was approved and P1 authorized by the owner on
2026-10-10; P2–P7 wait for the owner's go-ahead. Gates G1–G4 apply.
Starting revision: `f71809f8` (`main` after Plan 1, #441).
Branch: `feat/particle-scene-effects-content`, in a dedicated task worktree.
One branch and one PR for this plan.
Issues: parent #297 (stays open for Plan 3); phases P1 #443, P2 #446,
P3 #447, P4 #444, P5 #448, P6 #449, P7 #445, sub-issues of #297 with their
dependencies. Plan 1:
[particle-scene-effects-execplan.md](particle-scene-effects-execplan.md)
(#386–#394), whose platform, tooling and skills this plan uses.

## Purpose and context

Plan 2 replaces the Included Particle and Scene content with a launch library
built with Plan 1's pipeline, and rewires the Reactions to use it:

- **R9:** 12 Particle Effects (the final list below), at the Heart Burst
  quality level.
- **R10:** eight Scene background families (the G1 designs from Plan 1), with
  a preset per emotion, 24 in all, each with its own art and colour.
- **R11:** an Animama sticker set, made from the R10 art, replaces Twemoji in
  the Scene creator; Twemoji files, catalog entries, allowlist, licence
  records and attribution go.
- **R12:** all 72 Reactions on the escalating ladder: intensity 1 has no
  Particle or Scene Effect, intensity 2 a fitting Particle Effect where one
  fits, intensity 3 the emotion's background with a bigger Particle Effect
  where one fits (owner reading at G1, Decision Log).
- **R13:** every other current Included Particle Effect and every current
  Included Scene Effect is removed or replaced, with bundled duplicates,
  stale tests and unused records.
- **R14:** each item enters `content/included/` only after the owner approves
  it in the live preview, under owner-authored licence rules.

The content is authored as Local content on a task stack with the
`animama-particle-vfx`, `animama-scene-vfx` and `animama-effect-assets` skills,
reviewed by the owner in the headed preview, and promoted with `pnpm -s
effects promote` in one owner-approved run. Code changes are limited to R11
(sticker set, emoji handling, Twemoji removal) and to what R13 removal
requires (bundled catalogs, creator defaults, debug panels, tests).

Commands run from the repository root unless stated. Frontend scripts run from
`src/frontend/web`. The build, tests and app must not depend on Codex,
`image-gen` or any skill; skills and generated drafts are authoring aids.

### Final lists (owner, 2026-10-10)

Particle Effects (R9), 12 of the 13 proposed; Sweat Spray is dropped.

| # | Effect | Stem | Mechanic and layers | Emotions (proposal) | State |
| --- | --- | --- | --- | --- | --- |
| 1 | Heart stream | `hearts-v1` | Steady stream of hearts from the head | love, caring, desire | Kept unchanged (spec) |
| 2 | Heart burst | `heart-burst` | Large heart swells and beats, bursts into small hearts over a glow | love, caring, desire, admiration | Approved Local item (Plan 1 G2) |
| 3 | Twinkle shimmer | `twinkle-shimmer` | Long-lived glints scale in and out among soft bokeh | admiration, gratitude, optimism | New |
| 4 | Halo rays | `halo-rays` | Slow rotating light rays with rising gold motes | respect, confidence, gratitude, optimism | New |
| 5 | Star burst | `star-burst` | Gacha-pull flash, expanding ring, star shards, glitter | excitement, joy | New |
| 6 | Confetti | `confetti` | Confetti and ribbons burst and flutter down | joy, amusement, excitement | New |
| 7 | Question orbit | `question-orbit` | Question marks orbit and bob around the head | curiosity, confusion | New |
| 8 | Fume puffs | `fume-puffs` | Steam puffs vent from the head | annoyance, embarrassment, disapproval | New |
| 9 | Rage aura | `rage-aura` | Layered flame aura with rising embers from the chest | anger | New |
| 10 | Stink miasma | `stink-miasma` | Green wisps and bubbles drifting up | disgust | New |
| 11 | Rain cloud | `rain-cloud` | Cloud with drizzle and splashes over the head | sadness, grief, disappointment | New, replaces the Included `rain-cloud` under its ID |
| 12 | Gloom wisps | `gloom-wisps` | Pale will-o'-wisps drift slowly around the Avatar | grief, remorse, disappointment | New |

Quality bar (owner, 2026-10-10): the level of Heart Burst — glossy, layered
art with a coherent style — not its specific ingredients; an effect may be
simpler, and faint sparkles or rings are not required in every effect.

Scene backgrounds (R10): the eight G1 families (Plan 1, P1 record), with
embarrassment in Affection for its Scene design (the domain group in
`src/backend/animama/domain/emotions.py` is unchanged).

| Family | Direction | Emotions | Layers (G1) |
| --- | --- | --- | --- |
| Affection | Shoujo bloom | admiration, caring, love, embarrassment | radial glow, drifting bokeh tile, tumbling petals with twinkling sparkles |
| Esteem | Radiance | respect, confidence, gratitude | radial back-light, rotating rays, rising twinkling glints |
| Delight | Festive pop | amusement, excitement, joy | diagonal pop gradient, halftone dots, bouncing stars and confetti |
| Drive | Anticipation | desire, curiosity, optimism | sky gradient, drifting star-field tile, rising twinkles |
| Alarm | Shock | fear, nervousness, confusion | entry flash, dark gradient, shock lines, flickering lightning |
| Rejection | Rage | anger, annoyance, disapproval | hot radial vignette, throbbing spiky rays, popping anger marks |
| Revulsion | Queasy | disgust, remorse | sickly gradient, spinning spirals, rising bubbles |
| Gloom | Gloom | disappointment, grief, sadness | overcast gradient, swaying gloom lines, falling drops |

Gloom Sadness (approved Local item, Plan 1 G2) is the Gloom family's sadness
preset and the reference for its siblings.

R12 change (owner, 2026-10-10): the clause rewiring `shy-finger-poke` is
dropped. `main`'s #406 deleted that Gesture, and no Included Gesture plays a
Particle or Scene Effect, so `kawaii-sparkles` and `light-streak` are simply
removed under R13. More Gesture use stays allowed, not required.

### Implementation orientation

Survey of `f71809f8`. Paths: frontend relative to `src/frontend/web/`,
backend to `src/backend/animama/`, content to `content/included/`.

| Area | Current state and significance |
| --- | --- |
| Particle content | 19 folders in `vfx/particle/quark/`. Six are used, all by Reactions: `hearts` (admiration, caring, desire, love at 2–3), `sparkles` (respect, confidence, gratitude, optimism at 2–3; amusement, excitement, joy at 3), `stars` (amusement, excitement, joy at 2), `question-marks` (curiosity-2, confusion-2/3), `exclamation` (curiosity-3), `rain-cloud` (disappointment, grief, sadness at 2–3). Events are `particle-<stem>` at 0.12 s (i2) or 0.1 s (i3). `hearts-v1`, which the spec keeps, is used by nothing. |
| Scene content | 24 folders in `vfx/scene/`: focus presets `dark` and `light-streak`; backgrounds `comic-pop`, `shoujo-hearts`, `kawaii-sparkles` and 19 `scene-vfx-emotion-<e>` (none for caring, desire, confusion, annoyance, remorse). Each emotion background is played only by `<e>-3`, as event `scene-emotion-background` at 0 s with `presetId: scene-vfx-emotion-<e>`. Their marquees use 26 local `emoji-*.svg` image copies. Nothing uses `comic-pop`, `dark`, `kawaii-sparkles`, `light-streak` or `shoujo-hearts`. |
| Reactions | 72 Reactions (`reactions/<emotion>-<1..3>/`, `animaPoseClip/2.0`). Intensity 1 has no events except embarrassment-1 (blush band). Intensity 2–3 Avatar Effects are kept unless an assignment conflicts. `tests/test_included_content_integrity.py:95-111` requires every emotion to have a Reaction that plays an Avatar Effect. |
| Starter content | `resources/starter-loadout.v1.json` names the 72 Reactions (version 1) and 20 Gestures, no effects. Effects reach the desktop core partition through Reaction dependency closure (`runtime/starter_content.py:144-171`), and `resolve_roots` fails on diagnostics, so Reactions must be re-pointed in the same change that removes their effects. Promote `replace` keeps a Reaction's ID and version, so the loadout needs no edit. |
| Bundled duplicates | `lib/avatar/particle-vfx/catalog.ts` lists all 19 Particle Effects (asset paths `/effects/vfx/quark/<stem>/particle.json`); consumers: `particle-vfx/runtime.ts`, `editor/draft.ts:145` (falls back to entry 0, `hearts`), `AnimaRuntimeMediaCatalog.ts:949-975`, `ui/debug/AnimationDebugModal.tsx:1520-1533` (`flame-loop` hard-coded). `assets/effects/scene-vfx/catalog.json`: 22 background presets, 2 focus presets and 28 Twemoji `backgroundLineItems`, loaded by `lib/scene-vfx/catalog.ts`; consumers include the Scene creator's templates and defaults (`lib/scene-vfx/editor/defaults.ts:25-43`, fallback to `kawaii-sparkles` at :212, default focus `dark` at :83), `lib/effects/effectTemplates.ts:161-167`, `ui/action-editor/actionDependencies.ts`, the debug VRM editor's scene drafts and `AnimaRuntimeMediaCatalog.ts`. |
| Twemoji | 26 copies under `vfx/scene/*`, 28 mirrors in `resources/scene-vfx/twemoji/` (Vite alias `vite.config.ts:46-49`), the `twemoji` npm dependency (`web/package.json`, `vite.config.ts:132`). Creator list `SCENE_BACKGROUND_EMOJI_LINE_ITEMS` (`lib/scene-vfx/assets.ts`), picker in `ui/scene-effect-creator/sceneLayerControls.tsx:327-395`, resolver `lib/scene-vfx/emoji.ts`, editor hydrate/serialize `lib/scene-vfx/editor/document.ts:765-797`. Backend `BUILTIN_EMOJI` (28 code points) and capabilities `animama/twemoji/14.0.2/<cp>` in `app/services/content_package_capabilities.py:71-89`; `_scene_items` (:326-346) refuses unknown code points. Records: inventory rules `vfx/scene/**/emoji-*.svg` and `resources/scene-vfx/twemoji/**`, `licenses/third-party/art-twemoji.json` (54 records), `art-NOTICES.md` (keep `art-CC-BY-4.0.txt`: CodeManu's `spark-pop-6x5` also uses it), `desktop/runtime/notices/included-content-attribution.txt`, 55 source-review records. |
| Emoji items today | A Local Scene with an emoji item fails `validate_scene_effect_definition` with `scene_definition_invalid` (Save and scan); a package declaring a Twemoji capability is refused (`package_capability_unsupported`); the frontend would request a missing SVG. R11's "marked missing in the creator, skipped in chat" needs new code on both sides. |
| Curated textures | 38 built-in creator textures (`vfx/particle/particle-vfx/textures/`, `editor/textureManifest.ts`). After R13 only `heart.png` stays used by an Included effect (`hearts-v1`); the rest stay needed by the creator's built-in list, its emitter templates and `DEFAULT_TEXTURE_ID = "soft-dot"`. R13 removes only textures that neither a remaining effect nor the built-in list needs, so none is removed unless the built-in list changes. |
| Pinned tests | `tests/avatar/reactionClips.test.ts` (:29-66 emotion→effect map; :445-480 checks events against the bundled catalogs), `tests/avatar/particleVfx.test.ts` (:343-402 Included IDs and looping set; `flame-loop` cases), `lib/scene-vfx/catalog.test.ts` (:70-140 emotion presets, absence of five backgrounds, Twemoji list), `editor/creatorDocument.test.ts` and `editor/particleEstimate.test.ts` (read `flame-loop`), script tests reading `hearts-v1`, `question-marks`, `sparkles`, `light-streak`, `kawaii-sparkles` and the joy background, e2e `playback-library.spec.ts` and `playback-anima-loadout.spec.ts`, backend `tests/test_included_content_catalog.py` (:71 `hearts`, :127 Twemoji), `tests/test_removed_effect_dependency.py`, `tests/test_scene_svg_content.py`, `tests/test_content_package_capabilities.py`, and the boundary consumer `scripts/repository-boundary/consumers/hosted-app/clip-api.mjs`/`clips.mjs` (`hearts`). |
| Legacy generator | `src/frontend/scripts/generate-particle-vfx-assets.mjs` defines 14 of the old effects and writes a stale flat layout; it is removed or reduced to the curated textures it still owns. |
| Licences | Per-stem Particle rules (`vfx/particle/quark/<stem>/**`) go ahead of the legacy `vfx/particle/quark/**` rule (promote writes them); Scene PNGs fall under the D1 rule `vfx/scene/**/*.png`; the Twemoji rules go. Once no legacy Particle effect remains except `hearts-v1`, the legacy rule narrows to `hearts-v1`. |
| Tooling and skills | Plan 1's `effects check`, `effects:render`, `animation:preview`, `effects:bench --reaction`, `effects save` and `effects promote` (add, replace, delete; Reactions replaced from creator project files in the same run; dependencies on Local effects re-pointed to Included IDs). Skills: `animama-particle-vfx`, `animama-scene-vfx` (each with `batch.md` and `promote.md`), `animama-effect-assets`, `animama-animation` (Reaction edits). |
| Drafts | Plan 1's G1 briefs (`scene-families/<family>/brief.md`, `families.json`, sample stickers), the approved Heart Burst and Gloom Sadness folders and their package (`exports/heart-burst-gloom-sadness.zip`) are in the primary checkout's ignored `.animama-drafts/particle-scene-effects-plan1/`; copy what a phase needs into this worktree's `.animama-drafts/`. The Revulsion brief still lists embarrassment. |

## Progress

- [x] Plan drafted (2026-10-10) from `f71809f8` with the owner's final lists.
- [x] Owner approved the plan and authorized P1 (2026-10-10).
- [x] Preparation (2026-10-10): decisions published to #297 and read back
      (2026-10-10T23:09:17Z), spec snapshot refreshed (`dd01692a`); phase
      issues #443–#449 created. The task stack starts with P2.
- [x] P1 — Briefs, concept board and Reaction ladder draft. G1 approved
      (2026-10-10); review passed at round 2.
- [x] P2 — Particle library: 14 effects saved as Local content (2026-10-12);
      owner approved; platform review passed at round 3.
- [x] P3 — Scene backgrounds and sticker art: 24 presets saved, 44 stickers
      (2026-10-12); G2 pending the owner's morning review.
- [x] P4 — Animama sticker set and Twemoji removal (2026-10-12); review
      passed at round 2.
- [x] P5 — Reaction ladder: 43 project files, benchmarks within budget
      (2026-10-12); G4 pending the owner's review.
- [ ] P6 — Promotion and removal (R13, R14). Gate G3.
- [ ] P7 — Documentation and acceptance.
- [ ] Final integration review and PR.

## Surprises & Discoveries

- 2026-10-10 (planning): `hearts-v1`, the one Particle Effect the spec keeps,
  is used by no Reaction; the Reactions use `hearts`, which R13 removes. Love,
  caring, desire and admiration must be re-pointed regardless.
- 2026-10-10 (planning): the emotion backgrounds' marquee items are `image`
  items naming local `emoji-*.svg` copies, not `emoji` items, so replacing the
  backgrounds removes those copies; the creator's emoji list and the backend
  allowlist are a separate R11 change.
- 2026-10-10 (planning): `reactionClips.test.ts` validates Reaction events
  against the bundled catalogs, so new effects need either bundled entries or
  a test that resolves Included dependencies, as Avatar Effects already do
  (:68-108). The plan prefers the latter (P6).
- 2026-10-10 (planning): today a removed emoji fails a Local Scene's Save and
  scan as invalid; R11's missing-item behaviour is new code.

## Decision Log

- 2026-10-10, owner: R9 final set is the 12 proposed candidates except Sweat
  Spray (rejected in Plan 1's dry run for its idea and art).
- 2026-10-10, owner: the approved Local Heart Burst and Gloom Sadness are used
  as R9 #2 and the Gloom family's sadness preset, as saved.
- 2026-10-10, owner: R12's `shy-finger-poke` clause is dropped (the Gesture was
  deleted by #406).
- 2026-10-10, owner: quality bar is Heart Burst's level; simpler effects are
  fine, and sparkles or rings are not required in each.
- 2026-10-11, owner (P2, G2 notes): raise the Particle emitter limit from 8
  to 16 and any other limit or budget that gets in the way of excellent
  effects (spec's allowed runtime change, reason: layered effects such as
  four-wisp Gloom wisps and continuous auras need more emitters); every new
  Particle Effect lasts 20% longer; the headed preview gains a Portrait
  camera. Per-effect notes: twinkle shimmer yellow without bokeh; halo rays
  whiter and brighter with sparkles instead of beads; question marks upright;
  confetti rains across the screen; rage aura reads as one continuous aura;
  stink miasma becomes an aura; fume puffs become two long-lived ear jets;
  gloom wisps gets a fourth wisp. Star burst and rain cloud had no notes.
- 2026-10-12, owner: approved all 14 P2 Particle Effects (the 10 retuned, the
  three fireworks and Sparkle Hearts) and authorized P2–P7, the final review
  and the PR without waiting at the gates; the owner reviews the results in
  the morning. G2–G4 approvals are therefore recorded as pending owner review,
  with review material prepared for each; nothing merges without the owner's
  separate approval. Ladder slots for the four effects added after G1 are an
  agent proposal for that review (P5).
- 2026-10-12, owner (P2, G2): halo rays returns to its gold look (the white
  version was too bright); gloom wisps returns to its first-review speeds; the
  library gains three fireworks Particle Effects, designed with creative
  freedom and varied (R9 grows to 15; their Reaction tiers are decided with
  the ladder in P5).
- 2026-10-11, owner (P2), the platform changes and their reasons:
  - **Emitter limit 16** (was 8; also the auto-fit `emitter_names` cap):
    layered effects such as four-wisp Gloom wisps and closed auras need more
    emitters; the runtime has no per-emitter cap.
  - **Art budgets** `particle-texture` 1024 px / 512 KiB (was 512 px /
    256 KiB) and `particle-sheet` 2048 px / 2 MiB (was 1 MiB): the halo-rays
    ray fan had to be shrunk to fit; both stay within the 4 MiB / 2048 px
    hard limits.
  - **Particle estimate** is a conservative bound on particles alive at once
    (was every particle emitted): a long loop was refused though few
    particles were on screen. Bounded against three.quarks 0.17.1's emission
    (one clamped frame past a one-shot window, rounding up, trails draining).
  - **Opt-in true white** (`toneMapped: false` on a manifest material, a
    batch renderer that keeps such emitters in untoned batches): white art
    rendered about RGB 194 under ACES Filmic; existing effects stay stock.
  - **OrbitOverLife axis and `prewarm` kept on clone**: three.quarks 0.17.1's
    clones drop both, so instances orbited their local Y; Local effects with
    another axis now orbit as authored.
  - **Portrait camera** in the headed preview, sharing chat's framing.
- 2026-10-09, owner (Plan 1 G1): the eight family designs, capabilities C1–C6,
  embarrassment in Affection.
- 2026-10-10, owner (G1): approved the three proposals below, kept Fume
  puffs, and chose no intensity-3 variants. With the ladder as drafted, this
  reads R12 as: intensity 3 escalates through the emotion's background, with
  a bigger Particle Effect where one fits; where both tiers share an effect,
  the background is the step up, and fear, nervousness and disapproval have
  no Particle Effect at either tier (none fit once Sweat Spray was dropped).
  Published to #297 with the earlier decisions.
- 2026-10-10, agent proposal, approved at G1: **IDs.** Emotion backgrounds
  are replaced under their existing IDs (`scene-vfx-emotion-<e>`), and the five
  missing ones are added with the same naming, so Reactions' `presetId`s stay
  stable; `rain-cloud` is replaced under its ID; other Particle Effects get new
  stems and the old ones are deleted.
- 2026-10-10, agent proposal, approved at G1: **sticker set delivery.**
  The Scene creator's built-in stickers are Included PNGs under
  `resources/scene-vfx/stickers/` listed in a manifest; choosing one copies the
  PNG into the effect as its own image (as the Particle creator packages a
  built-in texture). Saved effects and packages stay self-contained and no new
  package capability is needed. The alternative, a built-in sticker reference
  resolved like Twemoji, keeps effects smaller but adds a capability and an
  allowlist like the one R11 removes.
- 2026-10-10, agent proposal, approved at G1: **focus presets.** `dark`
  and `light-streak` hold no Twemoji and Focus Lines are out of scope; they are
  kept under their IDs with presets unchanged unless G1 asks for new ones,
  which satisfies R13's "replaced under the same content ID" with no user
  change. `comic-pop`, `shoujo-hearts` and `kawaii-sparkles` are deleted.

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G1 | End of P1 | Owner reviews the Particle briefs with their concept stills, the 24 Scene preset briefs, the sticker list, the draft Reaction ladder and the three agent proposals above | Fixes what P2–P5 build; changes are recorded here |
| G2 | P2 and P3, per batch | Owner reviews each effect in the headed preview on both Included Avatars | Approved effects are saved as Local content; others are revised (at most twice) or dropped by the owner |
| G3 | P6, before writing | Owner approves the `effects promote --dry-run` list item by item | Nothing is written under `content/included/` before this; the run writes exactly the approved list |
| G4 | P5 | Owner reviews the wired Reactions (the ladder table and the live preview) | Acceptance of R12; merge approval stays separate |

Image generation needs the owner's Codex login; a failed or quota-limited
generation pauses the affected effect, not the plan. If the heaviest
intensity-3 Reaction exceeds the 4 ms budget after reasonable optimization,
the measurement goes to the owner before P5 completes.

## Preparation (workspace setup)

1. Recheck the root and scoped `AGENTS.md`, branch, HEAD and dirty state; run
   `git lfs pull` if a PNG reads as a pointer.
2. `workspace-setup`, once implementation is authorized:
   - publish the owner's 2026-10-10 decisions to #297 (final lists, the
     dropped R12 clause; R12 and acceptance text no longer name
     `shy-finger-poke`), read it back and refresh the spec snapshot;
   - create phase issues P1–P7 as sub-issues of #297, each blocked by its
     predecessor (P3 also by P1, P4 by P3, P6 by P2–P5); record them here.
     Do not create gate-only issues.
3. Dependencies: from `src/frontend`, `pnpm install --frozen-lockfile`,
   `pnpm packages:build`, `pnpm e2e:install`; backend `uv sync --python
   3.12.13`.
4. Task stack (P2 onwards): `./reset.sh --name particle-content --base-port
   <free port>`, `source .animama-stack.env`; record the URL here. Import
   `heart-burst-gloom-sadness.zip` through Library → Import (or the package
   API) and check both items open in their creators. The main stack on :3000
   is not changed. Stop the stack after its last use.
5. Wrap delegated test runs in `timeout`. Work test-first (`tdd`) for code in
   P4 and P6.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass (one
full `sdlc-reviewer` review, at most two repair rounds), and after its gate
where one applies. Content phases (P1–P3) are reviewed on their records,
briefs and check results; their art is judged at G1 and G2. Record per
phase: issue, starting SHA, commits (`<type>(<scope>)[p#]: …`, scopes such as
`particle`, `scene`, `reactions`, `content`, `effects`, `skills`, `docs`),
commands and results, review records and remaining gates.

### P1 — Briefs, concept board and Reaction ladder draft (R9, R10, R12 input). Gate G1. #443

1. **Particle briefs:** one brief per new effect (10, the "New" rows), in the
   `animama-particle-vfx` brief template, at the agreed quality bar. Each names
   its mechanic, layers, anchor, duration, art direction and budget, and which
   Reactions and tiers it is meant for.
2. **Concept board:** one generated still per new effect in its brief's art
   direction (the owner asked to see the candidates), with `hearts-v1` and
   Heart Burst renders beside them, on one review page. Stills are direction,
   not textures.
3. **Scene preset briefs:** from the G1 family briefs, one brief per emotion
   (23 new; sadness is Gloom Sadness): colours, motifs and the family's layers,
   embarrassment moved into Affection's brief. List the stickers each family
   needs; together they are the Animama sticker set (R11), with per-item
   budgets `scene-sticker`/`scene-tile`.
4. **Reaction ladder draft:** a table of all 72 Reactions: intensity 1 none;
   intensity 2 a fitting Particle Effect where one fits (or none); intensity 3
   the bigger effect or variant plus the emotion's background; the Avatar
   Effects each keeps; event times. Every emotion has a background at
   intensity 3.
5. Present G1: the review page, briefs, sticker list, ladder table and the
   three Decision Log proposals.

Briefs and the board live in `.animama-drafts/` (not committed); the plan
records the approved list, ladder table and any G1 changes. Completion: G1
approved.

#### P1 record

Starting source and issue: `dd01692a`, #443.

Delivered (drafts under `.animama-drafts/plan2/`, not committed):

- **Particle briefs** for the 10 new effects (`particle/<stem>/brief.md`), each
  with mechanic, layers, anchor, duration, art direction, budget (16–96
  declared particles, at most 5 textures) and intended tiers, and a library
  table covering every mechanic (`particle/README.md`).
- **Concept board** (`particle-concept-board.jpg`): one generated still per new
  effect in its brief's direction (Rain cloud regenerated once to avoid
  teardrop drips), beside live renders of `hearts-v1` and Heart Burst.
- **Scene preset briefs** for the 23 new presets
  (`scene/<family>/<emotion>.md`, `family.md` per family, index
  `scene/README.md`), each with a palette, a layer sketch that passes the
  shared Scene limits (the busiest uses 4 images and 44 scatter items),
  stickers, `keepFaceClear` and how it differs from its siblings; all presets
  are held (`durationMs: null`) and named `<Family> <Emotion>`. Departures
  from the G1 mocks: nervousness's line tremble becomes a fast sway;
  confidence's rays stay plain wedges; gratitude's rays throb softly;
  Revulsion uses two scatter layers; embarrassment's design is new (steam and
  blush marks); Drive's twinkle becomes an eight-point star (the G1 sample was
  too close to Esteem's glint). Nervousness keeps its G1 light-topped
  gradient, unlike the rest of Alarm.
- **Sticker set** (`scene/stickers.md`): 36 images the presets need (34
  stickers, 2 tiles; Gloom Sadness provides `raindrop`) plus 8 generic extras
  for users (`family: generic`), 44 in all; P3 builds the extras as their own
  batch.
- **Reaction ladder draft** (`ladder.md`), below.

Risks noted for P2–P5: Fume puffs can read as smoke (keep only if it reads as
an overheat vent); Rage aura needs the hardest art (a flame sheet) and the
anger-3 benchmark; Gloom wisps can read as spooky; diagonal drifters cross
the face where `keepFaceClear` does not apply; some intensity-3 effects repeat
their background's motif (Halo rays and Esteem rays, Confetti and joy, Stink
miasma and disgust bubbles), so each brief says what to cut first.

G1 (owner, 2026-10-10): approved as drafted. Fume puffs is kept (annoyance-3
drops the Avatar `steam_puffs`); no intensity-3 variants (intensity 3 adds the
background where both tiers share an effect); the three Decision Log
proposals (IDs, sticker copy-on-pick, focus presets kept) are approved.
The approved ladder overrides the briefs' **Reactions** lines and the
"Suggested Reactions" column of `particle/README.md` (pre-G1 proposals), and
the variants the briefs name (`halo-rays-bright`, `confetti-cannon`,
`question-orbit-dizzy`, `fume-puffs-boil`, `rage-embers`,
`stink-miasma-thick`, `rain-cloud-downpour`) are not built.

Approved ladder (R12; intensity 1 unchanged and without Particle or Scene
Effects; Particle events at 0.12 s for intensity 2 and 0.1 s for intensity 3,
backgrounds at 0 s):

| Family | Emotion | Intensity 2 (Particle) | Intensity 3 (Particle + background) | Avatar Effect change |
| --- | --- | --- | --- | --- |
| Affection | admiration | twinkle-shimmer | heart-burst + bg | — |
| Affection | caring | hearts-v1 | heart-burst + bg (new bg) | — |
| Affection | love | hearts-v1 | heart-burst + bg | — |
| Affection | embarrassment | — (blush already reads) | fume-puffs + bg | — |
| Esteem | respect | twinkle-shimmer | halo-rays + bg | — |
| Esteem | confidence | — (idea bulb) | halo-rays + bg | — |
| Esteem | gratitude | twinkle-shimmer | halo-rays + bg | — |
| Delight | amusement | — (vv eyes) | confetti + bg | — |
| Delight | excitement | star-burst | star-burst + bg | — |
| Delight | joy | confetti | confetti + star-burst + bg | — |
| Drive | desire | hearts-v1 | heart-burst + bg (new bg) | — |
| Drive | curiosity | question-orbit | question-orbit + bg | i3 keeps its idea bulb; the old `exclamation` particle goes |
| Drive | optimism | twinkle-shimmer | halo-rays + bg | — |
| Alarm | fear | — | bg only (shock flash) | — |
| Alarm | nervousness | — | bg only | — |
| Alarm | confusion | question-orbit | question-orbit + bg (new bg) | — |
| Rejection | anger | fume-puffs | rage-aura + bg | — |
| Rejection | annoyance | fume-puffs | fume-puffs + bg (new bg) | i3 drops `steam_puffs` (the particle replaces it) |
| Rejection | disapproval | — (= eyes) | bg only | — |
| Revulsion | disgust | stink-miasma | stink-miasma + bg | — |
| Revulsion | remorse | — | gloom-wisps + bg (new bg) | — |
| Gloom | disappointment | gloom-wisps | rain-cloud + bg | — |
| Gloom | grief | rain-cloud | rain-cloud + gloom-wisps + bg | — |
| Gloom | sadness | rain-cloud | rain-cloud + bg (Gloom Sadness) | — |

Every emotion has a background at intensity 3 and every one of the 12
Particle Effects is used. Benchmark first: joy-3, grief-3, anger-3, and the
Delight presets (joy and excitement are the busiest backgrounds).

#### Code Review #1 Findings

Round 1 (full review, `sdlc-reviewer`, working tree on `dd01692a`): the
ladder table matches the draft and today's Reactions, every Scene sketch
passes the limits, the sticker counts hold. Required:

- **P1-R1-F1:** the briefs' Reactions lines, the README's suggested column
  and seven named variants contradicted the approved ladder and "no
  variants", without the plan saying the ladder wins.
- **P1-R1-F2:** the ladder departs from R12's "bigger Particle Effect or
  variant" (six shared-effect rows, three background-only rows) without an
  owner decision recorded or published.
- **P1-R1-F3:** no phase built or reviewed the 8 generic extra stickers.
- **P1-R1-F4:** the departures list missed Drive's eight-point twinkle and
  misdescribed nervousness's gradient.

Optional: F5 "at most 4 images and 44 items" read as limits; F6 the draft's
coverage counts were wrong; F7 old Particle event `duration` overrides would
cut new effects short; F8 effects playing together need `can_coexist`.

#### Code Review #1 Revisions

- **F1 accepted:** the G1 paragraph says the ladder overrides the briefs and
  README and the variants are not built; P2 tunes to the ladder; the draft
  README carries a superseded note.
- **F2 accepted:** the owner's G1 answers (no variants, ladder as drafted,
  which listed the background-only rows) are recorded as the R12 reading in
  the Decision Log and Purpose and published to #297 (read back
  2026-10-10T23:42:21Z, snapshot updated).
- **F3 accepted:** P3 builds the generic extras as their own G2 batch.
- **F4 accepted:** departures corrected.
- **F5–F8 accepted:** wording fixed; draft counts fixed; P5 sets event
  durations from the briefs; P2 keeps `can_coexist: true` on effects that
  play together.

#### Code Review #2 Findings

Round 2 (targeted recheck): **pass**; F1–F8 resolved, #297 read back with the
R12 text. Optional: **P1-R2-F1** `hearts-v1` must keep a short duration
override; **P1-R2-F2** say how the generic stickers are reviewed;
**P1-R2-F3** one long line.

#### Code Review #2 Revisions

- **F1, F2 accepted:** P5 keeps a ~3 s override for `hearts-v1`; P3 reviews
  the extras on a contact sheet and in a test Scene. **F3 accepted:**
  rewrapped.

P1 is complete: G1 approved and the review passed at round 2 with one repair
round unused.

### P2 — Particle library (R9). Gate G2 per batch. #446

1. Author the 10 new Particle Effects with `animama-particle-vfx` in batches
   of at most four (its `batch.md`): textures with `animama-effect-assets`
   (`particle-texture`, `particle-sheet`), effect folders, `pnpm -s effects
   check` clean on both Avatars, `effects:render` sheets, then the headed
   preview for the owner (G2). `rain-cloud`'s folder targets a replace of the
   Included item.
2. Save each approved effect as Local content with `pnpm -s effects save`.
   Heart Burst is already saved (imported at Preparation); re-run `effects
   check` on it.
3. Record per effect: brief, check result, particle estimate and budget, G2
   outcome and revision count. Drop or revise per the owner. Tune each effect
   for the tiers the approved ladder gives it (it overrides the briefs'
   Reactions lines) and keep `can_coexist: true` on effects that play
   together (joy-3: confetti and star-burst; grief-3: rain-cloud and
   gloom-wisps).

Completion: all 11 non-kept effects approved and saved (or the owner's
changes recorded), each with a clean `effects check`.

#### P2 record

Starting source and issue: `74c8395e`, #446. Task stack `animama-particle-content`
(built, `http://animama-particle-content.localhost:8620`); Heart Burst and Gloom
Sadness imported from the Plan 1 package and re-checked (pass; only intended
`interior_translucency` warnings on glow art). Headed preview of the drafts on
port 5180.

Drafts (`.animama-drafts/plan2/effects/<stem>/`, built by `<stem>-work/build.py`)
for the 10 new effects passed `effects check` in three batches. At G2 the owner
left notes on seven and asked for the platform changes in the Decision Log; the
effects were revised (twinkle shimmer yellow, no bokeh; halo rays white with
sparkles; upright question marks; confetti raining across the view; closed
oval auras; two ear jets for fume puffs; four gloom wisps) and are being
retuned for true white and a 20% longer visible span.

Platform changes (tests first): emitter limit 16 (readiness and the auto-fit
`emitter_names` cap); art budgets `particle-texture` 1024 px / 512 KiB and
`particle-sheet` 2048 px / 2 MiB; a peak-alive particle estimate bounded
against three.quarks 0.17.1 emission (checked by simulating the real runtime
at 1/144–0.1 s steps: no Included effect's peak exceeds it); opt-in
`toneMapped: false` through `createParticleVFXBatchedRenderer` (white 255 vs
195 in a browser pixel test; stock batching while nothing opts out);
`cloneParticleVFXPrefab` keeping OrbitOverLife axes and `prewarm`; a Portrait
camera preset sharing `chatPortraitFraming` with `effects:render`.

Final library (2026-10-12): the owner approved all 14 effects — the 10 from
the briefs plus Fireworks Show, Heart Fireworks, Golden Willow and Sparkle
Hearts (from an owner reference image: heart outlines traced by small sparkle
particles, built from cone-rim lobes and rectangle sides so Save accepts it).
Every material is `toneMapped: false`, colours matched to the tone-mapped look
(halo rays back to gold); visible spans 1.26–1.5× the first-review versions,
measured frame by frame against a bare-Avatar baseline; budgets equal the
peak-alive estimate. All 14 were saved with `pnpm -s effects save` (read back,
compared with their sources and reopened) on the rebuilt task stack after its
first-run setup; with the imported Heart Burst and Gloom Sadness the stack holds
16 valid Local effects.

| Effect | Emitters | Budget | Duration (s) |
| --- | --- | --- | --- |
| twinkle-shimmer | 3 | 16 | 3.4 |
| halo-rays | 5 | 17 | 4.05 |
| star-burst | 5 | 38 | 1.8 |
| confetti | 3 | 110 | 3.45 |
| question-orbit | 8 | 26 | 3.2 |
| fume-puffs | 5 | 5 | 3.5 |
| rage-aura | 5 | 50 | 4.0 |
| stink-miasma | 5 | 37 | 4.0 |
| rain-cloud | 6 | 22 | 3.75 |
| gloom-wisps | 10 | 18 | 4.5 |
| fireworks-show | 12 | 250 | 3.8 |
| heart-fireworks | 10 | 104 | 3.6 |
| golden-willow | 7 | 130 | 4.2 |
| sparkle-hearts | 15 | 252 | 4.2 |

Known limits for G2 review: Golden Willow's trail length is in frames (half as
long at 120 Hz); Sparkle Hearts is faint on the busy current love background
and its hearts float with the head; fireworks are rendered on neutral grey
only; Rage aura is benchmarked in P5.

Checks: vitest on `src/lib/avatar/particle-vfx`, `particleVFXContentPackage`,
`tests/avatar` and `src/ui/particle-vfx-creator` (359 pass); `node --test`
effect script tests (61 pass); browser tests for effect-check, effect-render
and animation-preview (17 pass, round 1); `pnpm check`, `pnpm web:lint`,
`pnpm prettier:check` pass.

#### Code Review #1 Findings

Platform changes, round 1 (`sdlc-reviewer`, working tree on `74c8395e`):
**P2-R1-F1** (required) the peak-alive estimate undercounted three.quarks
0.17.1's emission (one frame past a one-shot window, rounding up, trails
draining after their life); **P2-R1-F2** (required) the Decision Log did not
record each runtime and limit change with its reason; optional **F3** burst
wording implied `cycle`/`interval` fire, **F4** clones also drop `prewarm`,
**F5** re-Save of older Local effects may need a larger budget.

#### Code Review #1 Revisions

All accepted: the estimate adds one per rate emitter, a 0.1 s frame to one-shot
windows and `startLength` × 0.1 s to trail lives (default 30), with tests from
the reviewer's simulations; a Decision Log entry per change; wording fixed;
`prewarm` copied on clone (test); the re-Save note in the runtime guide. The
controller tests' three.quarks mock was completed and the batch renderer takes
three.quarks' own path while every emitter is tone-mapped.

#### Code Review #2 Findings

Round 2: F1–F5 resolved (simulated peaks within the new estimate). Required:
**P2-R2-F1** Prettier failed on the two estimate files; **P2-R2-F2** the skill's
`effect-folder.md` still described the old estimate. Optional **P2-R2-F3**
fractional burst counts spawn their ceiling.

#### Code Review #2 Revisions

All accepted: formatted; the skill bullet matches the code; `Math.ceil` per
burst with a test.

#### Code Review #3 Findings

Round 3 (final): **pass**; optional **P2-R3-F1** the runtime guide did not say
burst counts round up (fixed).

### P3 — Scene backgrounds and the sticker art (R10). Gate G2 per family. #447

1. Per family, with `animama-scene-vfx`: the family's sticker and tile art
   (`animama-effect-assets`, `scene-sticker`, `scene-tile`, flat anime motifs
   distinct from Particle art), then one effect folder per emotion using the
   family's layers, checked (`effects check`, Scene limits) and rendered on a
   chat-shaped sheet. Gloom Sadness sets the Gloom family's reference.
2. Owner review per family in the headed preview (G2): the family's presets
   side by side. Save approved presets with `effects save`, each targeting a
   replace of `scene-vfx-emotion-<e>` (or an add for caring, desire,
   confusion, annoyance and remorse).
3. Build the 8 generic extra stickers (`scene/stickers.md`) as their own batch;
   the owner reviews them on a contact sheet and in a test Scene (they ship as
   P4 resources, not as Local effects).
4. Collect the approved sticker art and its manifest metadata (label, family,
   budget) for P4.

Completion: 24 presets approved and saved; the sticker set's files listed.

#### P3 record

Starting source and issue: `4de81cf2`, #447. Built by four agents (at most
three at once from 2026-10-12, per the owner), each following
`animama-scene-vfx` and `animama-effect-assets` with generated flat anime art.

All 23 new presets (`.animama-drafts/plan2/scenes/<family>-<emotion>/`, named
`<Family> <Emotion>`) pass `effects check` (Scene limits, image budgets) with no
FAIL, held (`durationMs: null`), no emoji items, every scatter the brief keeps
clear set `keepFaceClear`; each
has a chat-shaped render (960×600, front, both Avatars) and each family a
review sheet; `scene-presets-board.jpg` stacks the eight. All 23 were saved with
`effects save` (read back, compared, reopened); with Gloom Sadness the stack
holds 24 Scene presets. A backup package of the 39 Local Particle and Scene
items is kept outside the worktree (primary checkout
`.animama-drafts/particle-scene-effects-plan1/exports/plan2-library-p3.zip`).

Sticker set: 44 images (`.animama-drafts/plan2/stickers/`, family map in
`families.json`): 36 used by the presets (two `scene-tile`s: `bokeh-tile`,
`star-field-tile`; `steam-puff` shared by Affection and Rejection; `raindrop` is
Gloom Sadness's drop) and 8 generic extras with a contact sheet and a test
Scene (`scenes/generic-test/`). Every image passes its budget. `families.json`
gives each its family, a unique label (taken from the presets' items) and its
budget, for the P4 manifest.

Checks: `POST /v1/content:rescan` → 39 of 39 Local items valid (15 Particle, 24
Scene); `pnpm -s effects check` on each of the 23 folders → all pass (two batch
runs hit harness errors while P4 rebuilt `runtime-contracts`; rerun one at a
time); `pnpm -s effects:assets check --budget scene-sticker|scene-tile` on the
44 stickers → all pass (`leaf` keeps an intended padding warning).

Commit `46c4e231` (this record) also carries P4's staged deletion of the 28
Twemoji mirror SVGs and their README: the P4 agent had staged them in the
shared index. Until P4's commit removes the matching rules, records, alias and
tests, that revision fails `test_builtin_capabilities_match_shared_inventory_and_shipped_resources`
and `test_included_content_catalog.py`'s Twemoji asset check. The pushed
commit is not rewritten; later commits use explicit paths.

Departures from the briefs, for the owner's review: Admiration sparkles 14–34 px;
Embarrassment and Annoyance steam without spin (spin accumulates over a held
Scene and tipped the puffs over), Annoyance's steam tilt ±15° (was ±20°); outlines thickened on the white sparkle and
the gold and silver glints; Amusement 34 items (a diagonal drifter shows only
~40% of its items at once); Nervousness drops 36–60 px; Disappointment drizzle
16–30 px at 0.7–0.95 opacity; seeds chosen from sweeps.

Watch at review: diagonal drifters graze the hair (none crossed the face in
sampled frames); Caring is sparse and its sparkles faint; Respect's silver
glints and Optimism's gold twinkles are low-contrast by design; Nervousness's
drops can read as rain next to Gloom; Remorse versus Alarm Confusion (both
purple spirals); Curiosity shows 1–2 comets at a time. Motion was judged from
stills.

G2 for the presets and stickers: pending the owner's morning review (owner
authorization, 2026-10-12).

#### Code Review #1 Findings

Round 1 (`sdlc-reviewer`, `46c4e231`): records, briefs, saved copies (byte-equal
images), Scene limits and the sticker set verified. Required: **P3-R1-F1** the
P3 commit carried P4's Twemoji mirror deletion, leaving an inconsistent tree.
Optional: F2 `keepFaceClear` wording; F3 an unlisted ±15° tilt; F4 sticker
labels and budgets missing; F5 promote keeps Included names and descriptions on
replace and takes source names on add; F6 sticker records must use the owner
form or promote adds an exact-path rule per copy; F7 no Checks line or commit.

#### Code Review #1 Revisions

- **F1 accepted:** disclosed above; P4's commit completes the removal; the P4
  agent stopped staging and commits use explicit paths.
- **F2, F3, F7 accepted:** wording, departure and Checks added.
- **F4 accepted:** labels and budgets in `families.json`.
- **F5 accepted for P6:** each of the 19 replaces gets its brief's description
  and the 5 adds a deliberate `Emotion <E>` name.
- **F6 accepted for P4:** the sticker records use the owner form.

### P4 — Animama sticker set and Twemoji removal (R11). #444

1. **Sticker set:** the approved P3 stickers as Included resources (proposal:
   `resources/scene-vfx/stickers/<id>.png` plus a manifest); the Scene
   creator's built-in picker lists them instead of Twemoji; choosing one adds
   it as the effect's own image (per the G1 decision on delivery). Users can
   still add their own images.
2. **Emoji items:** a Local Scene Effect with an `emoji` item opens in the
   creator with that item marked missing and asks for a replacement; Save is
   refused until it is replaced or removed; chat and previews skip the item
   without errors; there is no conversion. Backend: scan admits the
   definition with a diagnostic (as P7 of Plan 1 did for removed effects)
   instead of `scene_definition_invalid`; Save and package import refuse the
   emoji item with a named error. Tests first.
3. **Twemoji removal:** `BUILTIN_EMOJI` and the Twemoji capabilities, the
   resolver and provider type, `SCENE_BACKGROUND_EMOJI_LINE_ITEMS` and the
   catalog's `backgroundLineItems`, the mirror folder and its Vite alias, the
   `twemoji` npm dependency and lockfile entry, the inventory rules, the
   third-party records, NOTICES and desktop attribution entries, the
   source-review records, and the docs and skill text that name Twemoji. The
   26 `emoji-*.svg` copies go with their backgrounds in P6.
4. Regenerate the API client if a backend contract changes (`pnpm
   openapi-ts`).

Checks: backend and frontend unit tests for the new handling; `pnpm check`,
`pnpm web:lint`, `pnpm web:test`, `uv run pytest -q` affected tests, `uv run
ruff check`; a browser check of the creator with a Twemoji-era Local Scene.

#### P4 record

Starting source and issue: `46c4e231` (its tree already lacked the Twemoji mirror,
see the P3 record), #444.

- **Sticker set:** `content/included/resources/scene-vfx/stickers/` holds 42 PNGs
  and `stickers.json` (`animama/scene-stickers/1`: id, label, family, file),
  the P3 set without the two tiles (`bokeh-tile`, `star-field-tile`; tile art
  belongs to the Tile layer, not to marquee or scatter items). Families follow
  the plan's order; `generic` shows as "Extras". `lib/scene-vfx/stickers.ts`
  bundles the PNGs with `import.meta.glob` as hashed build assets. This departs
  from the plan's Vite-alias proposal: the alias pattern (like the Twemoji mirror
  and the Particle built-in textures) never reaches the embedded desktop build
  (`copyBuildAliases: false`, and the desktop audit forbids `effects/resources`),
  while bundled assets work in development, built mode and desktop alike. To add
  a sticker: copy the PNG, add its entry to `stickers.json`, add an owner-form
  `licenses/source-review.json` record (the `resources/scene-vfx/stickers/**`
  rule covers it); `stickers.test.ts` fails on an unlisted or missing file.
- **Creator:** the Twemoji select, **Add emoji** and the "Twemoji" label are
  gone; a sticker picker with thumbnails grouped by family adds the chosen PNG
  as the effect's own image through the **Add private image** path, labelled
  with the sticker's name, so Save, recovery and packages carry it. Bytes the
  Scene already carries are reused (stickers and private images alike).
- **Emoji items:** a Local Scene with an `emoji` item scans valid with a
  `scene_emoji_item_removed` diagnostic per item (an Included Scene with one is
  invalid) and is listed in Content Health; the creator marks each "Missing
  emoji" and asks to replace or remove it, blocking Save (named field); chat,
  previews and renders skip it; Save refuses it with `saved_content_invalid`
  (field `scatters.0.items.1` style); package export and import refuse it, and
  any `animama/twemoji/…` capability, with `scene_emoji_item_removed`.
- **Twemoji removed:** `BUILTIN_EMOJI` and the Twemoji capabilities, the
  resolver and provider types (only what recognises legacy items stays), the
  bundled catalog's line items and `marquee.itemIds` (old presets play with
  empty marquees until P6 deletes them), the debug editor's emoji selects, the
  `twemoji` dependency, the mirror's inventory rule and 28 records and its
  source-review records. The 26 `emoji-*.svg` copies in the old emotion
  backgrounds keep their rule, records, NOTICES credit and desktop attribution
  until P6 removes them.
- **Browser check (2026-10-12, task stack rebuilt from this tree):** a Local
  Scene fixture with one Twemoji-era item (`twemoji-era-check`, a copy of
  Rejection Disapproval with an emoji scatter item) scanned valid with the
  diagnostic "Scene item scatters.0.items.1 (Sparkles) is an emoji, which
  Animama no longer provides; it plays without it…"; in the creator its scatter
  inspector showed "Missing emoji" with "Animama no longer provides emoji items.
  Replace each with a sticker or image, or remove it, before saving."; after an
  edit Save stayed disabled with "Unsaved" and "Content needs attention"; the
  sticker picker was present and no Twemoji text remained; `effects:render`
  played it without errors. The fixture stays on the task stack for review.

Checks: backend full `uv run pytest -q` 3652 passed, 10 skipped, then the
content tests after the review fixes (`-k "content or scene or package or
catalog"` 1,031 passed); `uv run ruff check` and `make check` pass; from
`src/frontend` `pnpm check`, `pnpm web:lint`, `pnpm prettier:check`, `pnpm
build` and `pnpm desktop:check` pass; `pnpm web:test` 3,868 passed, 1 skipped;
the Scene browser tests pass. No API contract changed.

#### Code Review #1 Findings

Round 1 (`sdlc-reviewer`): the mirror removal is completed and consistent; the
bundling departure is correct for all three builds; sticker records use the
owner form, so promoted copies count as owner art. Required: **P4-R1-F1** the
sticker flow, the carried-bytes reuse and the image label had no tests (and the
tile reuse left a replaced tile's bytes behind); **P4-R1-F2** no P4 record or
browser check. Optional: F3 dead `marquee.itemIds`; F4 emoji-only scatter
layers dropped, shifting later indices; F5 Save's error code; F6 no
archive-level import test; F7 leftover indirection; F8 copy.

#### Code Review #1 Revisions

- **F1 accepted:** the logic moved to `sceneEffectCreatorBehavior.ts` with tests
  (sticker → labelled image item with bytes; reuse; identical private file
  takes its own label — a bug, fixed; tile reuse drops replaced bytes — fixed;
  failed fetch and non-image refused) and a `label` document test.
- **F2 accepted:** this record and the browser check.
- **F3, F4, F6, F7, F8 accepted:** fixed with tests.
- **F5 declined:** Save keeps `saved_content_invalid` with the item as `field`;
  the creator blocks Save first and the docs describe it.

#### Code Review #2 Findings

Round 2 (targeted recheck): **pass** for the code; F2 open until this record.

### P5 — Reaction ladder (R12) and performance. Gate G4. #448

1. Write each Reaction's change as a creator project file
   (`animamaActionProject/1.0`) from its Included clip, with the effect
   events of the approved ladder and dependencies on the Local effects
   (`animama-animation` conventions; `animaPoseClip/2.0`). Timing works with
   the Reaction's expression and its Avatar Effects. Today's Particle events
   override `duration` (1.2–2.4 s); set each from the new effect's brief or
   drop the override so new effects are not cut short; `hearts-v1` (15 s,
   looping, no brief) keeps an override of about 3 s.
2. Save them as Local Reactions on the task stack and equip a test Anima to
   review them in chat and in the headed preview (`animation:preview
   library:local/<reaction>`).
3. Measure the heaviest intensity-3 Reactions with `pnpm -s effects:bench
   --reaction` (budget 4 ms added frame interval and GPU time, the owner's
   development Mac); record the numbers.
4. G4: the owner reviews the final ladder table and the wired Reactions in
   the live preview.

Completion: G4 approved; every emotion has a background at intensity 3; the
benchmark is within budget or the owner has decided.

#### P5 record

Starting source and issue: `526c0e7e`, #448. Drafts under
`.animama-drafts/plan2/reactions/` (generator `work/build.py`).

- **Project files:** 43 `animamaActionProject/1.0` files, one per Reaction whose
  Particle or Scene Effects change (disapproval-2, embarrassment-2, fear-2,
  nervousness-2 and remorse-2 keep none, and no intensity-1 Reaction has one).
  Each is the Included clip with only its effect events and dependencies
  changed: Particle events at 0.12 s (intensity 2) and 0.1 s (intensity 3),
  each `duration` set to the effect's `duration_seconds` (`hearts-v1` 3 s), the
  background `scene-emotion-background` at 0 s; dependencies carry the Local
  `ref` that promote re-points to the Included ID in the same run.
- **Ladder:** the G1 table with the agent proposals for the four effects added
  later — caring-2 Sparkle Hearts, desire-3 Heart Fireworks, optimism-3 Golden
  Willow, and excitement-3 Star Burst plus Fireworks Show (alone, Fireworks Show
  nearly vanished on the hot Delight Excitement background). Every emotion has a
  background at intensity 3 and all 16 Particle Effects are used. Full table:
  `ladder-final.md`; one frame per intensity-3 Reaction: `ladder-board.jpg`.
- **Validation:** `pnpm -s animation validate` and `pnpm -s animation check` pass
  on all 43 sequences; `effects promote promote.json --dry-run` plans 261
  changes with no `local:` ref left (Reaction replacements need their Local
  effects in the same run, so P6 promotes everything in one run).
- **Performance** (`effects:bench --reaction`, Apple M5, 1600×1200, added mean
  frame interval / GPU in ms, Y_0 and A_1): joy-3 1.59/1.22 and 0.35/0.42;
  grief-3 1.28/1.30 and 0.82/0.73; excitement-3 (both effects) 1.17/1.08 and
  0.25/0.63; admiration-3 1.14/0.98; gratitude-3 0.97/1.05; love-3 0.92/0.93;
  desire-3 0.81/0.93; optimism-3 0.81/0.67 (1.14 over its whole span); anger-3
  0.63/0.95; caring-2 0.39/0.66 (0.44 over its whole span). All within the 4 ms
  budget.

Departure: no Local Reactions were saved and no chat check ran before promotion;
the wired Reactions are checked in chat on the promoted branch content (P7) and
can be previewed now with `pnpm -s animation:preview <emotion>-<n>.project.json`.

For G4 (pending the owner's review): Halo Rays reads olive on Gratitude's pale
peach and blends into Confidence's gold rays; curiosity-3's orbiting question
marks pass over its `idea_bulb` Avatar Effect; joy-3's Star Burst is pale on
yellow; embarrassment-3, joy-3 and disgust-3 repeat their background's motif.
Effects with a `duration` are cleared at start + duration and when the Reaction
ends, so short replies cut the longer new effects short, as before.

#### Code Review #1 Findings

Round 1 (`sdlc-reviewer`, `31d524cd`): every project file changes only effect
events and dependencies; the ladder, aliases, refs and durations match; the dry
run plans 261 changes with no `local:` ref and writes nothing; joy-3 and
excitement-3 re-benchmarked within budget. Required: **P5-R1-F1** the
excitement-3 render, board cell and benchmark row showed the earlier Fireworks
Show–only version. Optional: F2 `promote.json` lacks the P3-agreed names and
descriptions and the deletes (P6 hand-off); F3 a coverage count; F4 stale logs;
F5 rounded caring-2 numbers; F6 the ticked box before G4.

#### Code Review #1 Revisions

- **F1 accepted:** excitement-3 re-rendered (sheet and detail), board rebuilt,
  its benchmark row replaced with the final version's numbers.
- **F2 accepted for P6:** P6's `promote.json` adds the replace descriptions, the
  add names and the deletes.
- **F3, F5 accepted:** fixed. **F4, F6:** noted; the fresh dry run matched.

#### Code Review #2 Findings

Round 2 (targeted recheck): **pass**; F1, F3 and F5 resolved, F2 recorded for
P6. Optional: the excitement-3 full-span cell mixed frame and GPU values, and
concern C1 still read as open.

#### Code Review #2 Revisions

Both accepted: the row reads 1.00 / 0.53 with CPU and p95 filled in, and C1 says
the proposal plays both. The review passed at round 2.

### P6 — Promotion and removal (R13, R14). Gate G3. #449

1. Write one `promote.json`: add or replace each approved Particle and Scene
   Effect (Local sources from the task stack), replace each changed Reaction
   from its project file (dependencies re-pointed to Included IDs in the same
   run), and delete every removed effect: `confusion-orbit-marks`,
   `exclamation`, `exclamation-v1`, `flame-loop`, `hearts`, `hearts-v2`,
   `magic-sparkle-burst`, `question-marks`, `question-v1`, `sad-rain-puff`,
   `sleep-bubbles`, `soft-heart-pop`, `sparkles`, `star-v2`, `stars`,
   `surprise-shock-pop`, `zzz`; `comic-pop`, `shoujo-hearts`,
   `kawaii-sparkles`.
2. `pnpm -s effects promote promote.json --dry-run`; show the owner the full
   list (G3); then run it and `git add` the result. Deletes are refused while
   a dependant remains, so a failed delete shows a missed Reaction.
3. **Bundled duplicates and code that names removed content:** remove the
   removed entries from `lib/avatar/particle-vfx/catalog.ts` and
   `assets/effects/scene-vfx/catalog.json`; prefer resolving Included content
   over adding new bundled copies, and keep a bundled entry only where a
   consumer has no catalog access (record which). Update `editor/draft.ts`'s
   fallback, the Scene creator's templates and defaults (`defaults.ts`,
   `effectTemplates.ts`) to new presets, the debug modal's `flame-loop`
   shortcut (switch to a remaining effect or drop it, per R13), the debug VRM
   scene drafts, `actionDependencies.ts`, and the legacy generator.
4. **Tests:** switch `reactionClips.test.ts` to the Included aliases and the
   new map; update `particleVfx.test.ts`, `lib/scene-vfx/catalog.test.ts`
   (the five new backgrounds exist; no Twemoji), the script, e2e and backend
   tests listed in the orientation, and the boundary consumer's `hearts`
   reference.
5. **Licences:** per-stem Particle rules from promote; narrow the legacy
   `vfx/particle/quark/**` rule to what remains; drop records of deleted files
   (promote reports third-party records removed, such as `art-particles.json`
   entries for quark copies); keep curated textures the built-in list needs.
6. Run `uv run pytest -q tests/test_included_content_integrity.py
   tests/test_included_content_catalog.py tests/test_starter_content_closure.py
   scripts/public-release/test_prepare_source.py`, then the full checks.

Completion: G3 approved and written; no removed item, bundled duplicate,
stale test or record remains (a repository search for each removed stem and
for `twemoji` finds only history in `docs/plans/`).

#### P6 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

### P7 — Documentation and acceptance. #445

1. Docs: `docs/frontend/runtime/avatar-particle-vfx.md` (Included library,
   the debug shortcut), `scene-vfx.md` (Included presets, the sticker set,
   emoji handling), `avatar-animation.md` and Reaction docs that list effects,
   `local-content-runtime.md`, the redistribution and attribution docs, and
   the effect skills' examples that named removed content.
2. Full checks (Validation) and the full `pnpm e2e:test` on a purged built
   stack.
3. Chat check on the task stack: one Reaction per family at intensities 2 and
   3, with screenshots for the PR.

#### P7 record

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

`sdlc-reviewer` reviews the combined scope against R9–R14 and the spec's
acceptance criteria, reusing still-valid phase evidence, with one full review
and at most two repair rounds. Agent readiness does not replace the gates or
merge approval.

## Validation and acceptance

| Spec criterion | Evidence | Phase |
| --- | --- | --- |
| R9, R10 | Briefs for every listed effect; G2 approval of each on both Avatars; clean `effects check` | P1–P3 |
| R11 | Creator offers the sticker set and no Twemoji; emoji-item tests (creator, chat, Save, scan, import); repository search for Twemoji | P4, P6 |
| R12 | Ladder table in this plan; G4 approval; every emotion has an intensity-3 background | P5 |
| R13, R14 | G3 list; promote run; repository search for removed stems; Included-content, catalog and starter closure tests | P6 |
| Performance | `effects:bench --reaction` on the heaviest intensity-3 Reactions within 4 ms | P5 |
| Checks | Full local suites and full `pnpm e2e:test` | P7 |

Before the PR, run from the repository root `uv run pytest -q`, `make check`,
`uv run ruff check`; from `src/frontend` `pnpm check`, `pnpm web:lint`, `pnpm
prettier:check`, `pnpm desktop:check`, `pnpm web:test`, `pnpm build` and
`pnpm openapi-ts` freshness; and the full `pnpm e2e:test` on a purged built
stack (a stack reused across Included-content changes keeps stale Animas and
package stages). The hosted validation workflow is disabled today; if it
stays so, the PR states that no hosted checks ran.

## Idempotence and recovery

- **Drafts:** briefs, art and effect folders live in `.animama-drafts/` and
  the task stack's Local content; export approved Local items to a package
  before the worktree or stack is cleaned up.
- **Promotion:** `--dry-run` first; writes are reviewable Git changes on the
  task branch and are reverted with Git.
- **Removal order:** Reactions are replaced in the same promote run as the
  deletes, so starter closure never sees a missing effect.
- **Local content of users:** a Local Action naming a deleted Included effect
  keeps playing without it and asks for repair (Plan 1); a Local Scene with
  an emoji item behaves as P4 defines.
- **Database:** no schema change is expected; if one is needed, update the ORM
  and `alembic/versions/0001_baseline.sql` directly.

## Outcomes & Retrospective

Not started.
