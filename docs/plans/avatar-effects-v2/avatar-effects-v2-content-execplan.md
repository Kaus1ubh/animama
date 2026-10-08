# Author the Avatar Effect library and its skills (Plan 2, content)

Source agreement: [#298](https://github.com/raymond-van/animama/issues/298)
(snapshot: [avatar-effects-v2-spec.md](avatar-effects-v2-spec.md)), requirements
R12–R16. The owner accepted the spec on 2026-10-06 and on 2026-10-07 asked that
the Avatar Effect skill follow the `animama-animation` pipeline with a gated
Promote to Included step like #310's. On 2026-10-08 the owner approved Plan 1's
merge (PR #328, merge commit `fd1980fe`) and asked to proceed with Plan 2.
Authorized scope: P1–P3 (owner, 2026-10-08). P4–P8 need a later request;
G1–G4 below apply regardless.
Starting revision: `fd1980fe` (`origin/main` after #328).
Branch: `feat/avatar-effects-content`, in the existing task worktree
`avatar-effects-v2`. One branch and one PR for this plan.
Issues: parent #298 (stays open until this plan merges); phases P1 #348,
P2 #349, P3 #350, P4 #351, P5 #352, P6 #353, P7 #354 (also blocked by #337),
P8 #355, linked as sub-issues with blocked-by dependencies. Related: #297 (Particle and Scene templates, reuses
R12), #310 (Gesture promotion, merged), #282 and #291 (merged; their Reactions
are the ones R15 edits), #337 (migrates every 1.0 clip, Reactions included, to
`animaPoseClip/2.0`; merges before this plan completes).

## Purpose and context

Plan 1 delivered the platform: the `/2` definition, five attachments, face
parts, event fades, the Effects picker, the reworked Avatar Effect creator and
the review tools. Plan 2 uses it to make content:

- **R12:** an effect-asset skill and scripts that turn an art brief into clean,
  budgeted PNGs (single images and flipbook grids).
- **R13:** the `animama-avatar-vfx` skill becomes a generation pipeline shaped
  like `animama-animation`: brief → assets → `/2` definition → checks →
  headless renders → owner review in the headed preview → save as Local content
  → reopen → gated Promote to Included.
- **R14:** about 25 Avatar Effects with written briefs, upgraded or new art.
- **R15:** every one of the 24 Reaction emotions has at least one Reaction
  variant using a fitting effect; mouth effects leave `amusement-2`/`-3`;
  `shy-finger-poke` switches to Eye VV.
- **R16:** owner-approved promotion of each effect and Reaction change to
  `content/included/`, with licence and source-review records.

The spec owns behavior and acceptance; this plan owns delivery. The build, tests
and app must not depend on Codex, `image-gen` or any skill (spec constraint):
generated PNGs are committed content, and the scripts work on any PNG.

Commands run from the repository root unless stated. Frontend scripts run from
`src/frontend/web`. No Cloud checkout is needed.

### Implementation orientation

Paths: frontend relative to `src/frontend/web/`, backend to
`src/backend/animama/`, content to `content/included/`. Line numbers are from
`fd1980fe`.

| Area | Current state and significance |
| --- | --- |
| Gesture pipeline to mirror | `.claude/skills/animama-animation/SKILL.md` (steps 0–9) with `references/` (`interview.md`, `checks-and-review.md`, `batch.md`, `promote.md`, …). `.claude/skills` is a symlink to `.agents/skills`, so each skill has one tracked copy. Commands: `pnpm -s animation validate|check|resolve|promote`, `animation:preview`, `animation:render`, `animation:save`. |
| Avatar Effect skill today | `.claude/skills/animama-avatar-vfx/` (`SKILL.md`, `references/what.md`, `references/how.md`): an operating manual for the creator, not a generation pipeline. `SKILL.md` :52–60 ("Planned rework") already outlines R12–R13. The owner's global `~/.codex/skills/animama-avatar-vfx` is an older v1 copy outside this repository and out of scope. |
| Image generation | The owner's global `image-gen` skill (`gen.sh`) runs `codex exec` with the owner's ChatGPT login and copies the result to a chosen path. 30–90 s per image. Optional tool only. |
| Image tooling | `sharp` 0.34.5 is a devDependency (`src/frontend/package.json` :81), used by `src/frontend/scripts/generate-particle-vfx-assets.mjs`. Pillow is a backend dependency; `app/services/content_image.py` :290–310 has an alpha-histogram check. |
| Image limits | Frontend `src/lib/avatar/vfx/effect-image-limits.ts`: 16 MiB per image, 4096 px side, 4096² pixels, 64 KiB definition. Backend `app/contracts/avatar_effect.py` :31–38, :250–271: flipbook grid ≤ 16×16, ≤ 256 frames, fps ≤ 60, keyframes ≤ 64. Existing art is 256²–1024², 3.6–130 KB. |
| Review tools | `scripts/effect-render.mjs` (`effects:render <source…>|--all-included --out`, `--times`, `--views front,three-quarter,face`, `--with-clip`, `--together`, `--diff a b`, `--thumbnail`; exits 1 on a controller warning). `effect-thumbnails.mjs` (`effects:thumbnails [id…]` → `src/assets/effect-templates/<id>.webp`). `effect-bench.mjs`. `animation-preview.mjs` (headed; effect source folders and Library Reactions; notes in `<stem>.review.json`). |
| Effect source folder | `<stem>/` with `<stem>.json` (`content_type: "avatar_effect"`, `/2` definition) and its images; resolved by `effect-render-sources.mjs` :197–300. This is the R13 draft unit. Drafts live under the ignored `.animama-drafts/`. |
| Saving | `scripts/animation-save.mjs` drives the Gesture creator headlessly (import a project file, save, read the Library item back). Nothing equivalent exists for effects; the Avatar Effect creator has Import (`ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`). |
| Promotion | `scripts/animation-promote.mjs` (+ `.test.mjs`) is Gesture-only: it writes `gestures/<slug>/<slug>.json` and `.meta.json`, inserts an inventory rule before `gestures/**/*.json`, adds `licenses/source-review.json` records and supports `--dry-run`. Effects need binary copies and `/2` validation (the existing `vfx/avatar/**/*` rule covers their files); Reactions need a `reactions/<id>` replace mode. |
| Included effects | 16 under `vfx/avatar/<stem>/<stem>.json` (`/2` definitions, IDs `builtin:avatar-effect:<stem>`): `angry`, `emote`, `eye` (Eye =), `eye_0`, `eye_confused_swirl`, `eye_o`, `eye_vv`, `eye_vv_pair`, `mouth_hover_w`, `mouth_w`, `star`, `star3`, `texture_black_1` (Gloom face), `texture_sick_1`–`3`. All are picker templates (`src/lib/effects/effectTemplates.ts` :97–114). |
| Included Reactions | 72 under `reactions/<emotion>-<1..3>/`, all `animaPoseClip/1.0`, expression-only, lifetime `whileInteractionPhase: talking`. An effect is an `avatar_vfx` event whose `effectId` is an alias declared in the meta's dependencies (`builtin:avatar-effect:<stem>`). 19 emotions use an effect today; caring, desire, embarrassment, gratitude and love do not; no `-1` variant does. |
| Reaction 2.0 gap | The Reaction creator saves `animaPoseClip/2.0` (`src/ui/action-editor/actionPersistence.ts` ~:156). The bundled Included catalog parses Reactions with the 1.0-only `parseAnimaPoseClip` (`src/lib/avatar/poses/catalog.ts` :47–55, :233–290) and skips other files, although Gestures already use an either-schema parser (:223). A promoted 2.0 Reaction would vanish. |
| Licences | `licenses/inventory.json`: first-match rules; `vfx/avatar/**/*` is owner-authored. Generated-art precedent: `vfx/scene/**/svg-*.svg`, "Animama project owner using an AI image generator", `LicenseRef-Animama-owner-ai-generated`. Promoted Gestures use `LicenseRef-Animama-agent-authored`. `licenses/source-review.json` needs a record per tracked file (`scripts/public-release/test_prepare_source.py`). Template thumbnails also need records and the desktop notice entry `effect-template-thumbnails` (`src/frontend/desktop/runtime/license-sources.json` :119). |
| Tests pinning content | `tests/test_included_content_integrity.py`, `tests/test_included_content_catalog.py` (:172, every effect VALID with an image), `tests/test_starter_content_closure.py` (starter loadout pins all 72 Reactions), `src/lib/avatar/poses/catalog.content.test.ts` :169–170 (counts), `tests/avatar/reactionClips.test.ts` (:520 alias resolution; the hard-coded particle mapping :37–66), `src/lib/avatar/vfx/definition.test.ts`, `src/lib/effects/effectTemplates.test.ts` (one thumbnail per template). |

## Progress

- [x] Preparation (2026-10-08): phase issues #348–#355; worktree `avatar-effects-v2` on `feat/avatar-effects-content` from `fd1980fe`; task stack `animama-avatar-fx` at http://animama-avatar-fx.localhost:8600.
- [x] P1 — Effect-asset scripts and skill (R12). Done 2026-10-08; review passed at round 3.
- [x] P2 — Authoring pipeline tools: check, save, promote (R13, R16 tooling). Done 2026-10-08; review rounds used (last fix verified by tests, rechecked at final integration).
- [x] P3 — Avatar Effect skill rewrite and fresh-agent dry run (R13). Done 2026-10-08: two dry runs, review passed at round 2. Next: gate G1 (owner's effect list) and the floating-offset runtime fix before P4.
- [ ] P4 — Effect batch A: upgrades and kept effects (R14). Produced 2026-10-08; awaiting G2.
- [ ] P5 — Effect batch B: new face effects (R14). Produced 2026-10-08; awaiting G2.
- [ ] P6 — Effect batch C: flipbooks, body, sticker and silhouette effects (R14). Produced 2026-10-08; awaiting G2.
- [ ] P7 — Reaction wiring (R15). Gate G3.
- [ ] P8 — Promotion, documentation and acceptance (R16). Gate G4.

## Surprises & Discoveries

- 2026-10-08 (planning): Included Reactions are all `animaPoseClip/1.0`, and the
  bundled catalog skips non-1.0 Reaction files, while the creator always saves
  2.0. The owner pointed to #337, which moves every clip to 2.0 and merges
  before this plan completes, so P7 builds on it instead of changing the loader.
- 2026-10-08 (planning): `animation promote` is Gesture-only; effect and
  Reaction promotion is new work (P2, P7).

## Decision Log

- 2026-10-08, owner: proceed with Plan 2 after merging #328.
- 2026-10-08, owner, on review of this plan (amends R12, R15 and R16 as noted):
  - #337 migrates all clips, Reactions included, to 2.0 before this plan
    completes. P7 depends on it and does not change the Reaction loader.
  - Eye VV Pair is removed entirely: `shy-finger-poke` uses Eye VV, and the
    `eye_vv_pair` item and template are deleted (P7, P8).
  - No statement that art was generated and no per-effect licence wording. New
    files fall under the existing inventory rules (`vfx/avatar/**/*`,
    `reactions/**/*`); R12's provenance recording and R16's provenance wording
    are dropped. The source-review record per tracked file that the release
    check requires is written mechanically in the same form as the existing
    effect files.
  - P1–P3 authorized; report the list needed for G1 afterwards.
- 2026-10-08, owner, G1: the agent's recommended list (24 effects): keep the
  spec's table minus Star eyes, Sick face 3, Sparkle eyes and Respect shine
  (Star eyes and Sick face 3 are removed from Included content in P8, after
  P7 re-points their Reactions). Every upgraded effect is fully redrawn in one
  library style. "DOKI DOKI!" is written in English letters. Assets and
  effects are produced in parallel batches, not one by one; P4–P8 proceed
  under the plan's gates.
- 2026-10-08, agent (planning), within the spec:
  - New effects become picker templates only if the owner asks at G4; upgraded
    templates get fresh thumbnails.
  - Drafts, briefs and review notes stay under the ignored `.animama-drafts/`;
    the committed record of each brief is a short entry in this plan.

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G1 | Before P4 | Owner trims and edits the R14 table (spec "Open: final effect list") | Fixes the effect list and batch contents; P1–P3 do not wait for it |
| G2 | End of P4, P5 and P6 | Owner reviews each batch's briefs and the effects in the headed preview on both Included Avatars | Approved effects proceed; others are revised (up to two revision rounds per effect, then dropped or deferred by the owner) |
| G3 | End of P7 | Owner reviews the Reaction mapping and the wired Reactions in the headed preview | Approved Reactions proceed to promotion |
| G4 | P8, before any write to `content/included/` | Owner approves each promoted, replaced or deleted item, on this PR | The only point where an agent writes Included content |

Image generation needs the owner's Codex login; a failed or quota-limited
generation pauses the affected effects, not the plan. Merge approval stays
separate from all gates.

## Preparation (workspace setup)

1. Recheck the root and scoped `AGENTS.md`, branch, HEAD and dirty state.
2. `workspace-setup`: create phase issues P1–P8 as sub-issues of #298 with
   dependencies; record them here. Do not create gate-only issues.
3. Dependencies: from `src/frontend`, `pnpm install --frozen-lockfile`,
   `pnpm packages:build`, `pnpm e2e:install`; backend `uv sync --python 3.12.13`.
4. Task stack `animama-avatar-fx` (http://animama-avatar-fx.localhost:8600) is
   reused: `./reset.sh --name avatar-fx --base-port 8600`, then
   `source .animama-stack.env`. Local test content only; the main stack on
   :3000 is not changed.
5. Confirm `~/.claude/skills/image-gen/scripts/gen.sh` runs with one throwaway
   image into the scratchpad (P1 needs it for the provider check only).
6. Wrap delegated test runs in `timeout`; work test-first for scripts.

## Phased implementation

Each phase starts after its predecessor's checks and bounded review pass (one
full `sdlc-reviewer` review, at most two repair rounds), except that P4–P6
depend on G1 and each batch's promotion waits for G4. Record per phase: issue,
starting SHA, commits (`<type>(<scope>)[p#]: …`, scopes such as `vfx`,
`skills`, `content`, `reactions`), commands and results, review records and
remaining gates.

### P1 — Effect-asset scripts and skill (R12)

Outcome: any PNG, generated or hand-made, can be checked and fixed into a
ready-to-use effect image or flipbook by one command.

Steps:

1. `scripts/effect-assets.mjs`, exposed as `pnpm -s effects:assets`, built on
   `sharp`, with subcommands:
   - `check <png…> [--budget <px>,<KiB>]`: real alpha present; no painted
     checkerboard (detect a two-tone periodic opaque background); share of
     near-opaque pixels; transparent padding; dimensions and bytes against the
     budget and the runtime limits. Exit 1 on failure; `--json` for agents.
   - `fix <in> --out <png> [--opaque-from 250] [--trim] [--pad <px>]
     [--max <px>] [--square]`: set alpha ≥ threshold to 255, trim transparent
     padding, pad back to a square if asked, resize to the budget, write an
     optimized RGBA PNG.
   - `flipbook <frame…> --out <png> [--columns N]`: assemble equal-size frames
     on a grid within the contract limits and print the `flipbook` definition
     fragment (`columns`, `rows`, `frames`).
2. Node tests (`scripts/effect-assets.test.mjs`, added to `test:source`) with
   synthetic PNGs: alpha absent, checkerboard, near-opaque fix, trim, resize to
   budget, flipbook grid and limit refusal.
3. Skill `.agents/skills/animama-effect-assets/` (reached through the
   `.claude/skills` symlink): brief → prompt template for effect art (flat anime emphasis style,
   transparent background, single subject, no text unless the brief asks) →
   `gen.sh` → `effects:assets check/fix/flipbook` It states the
   default budgets (eye/emote art 512², face surface 1024², flipbook frames
   256², ≤ 256 KiB per file unless the brief justifies more) and that it serves
   #297 for particle textures, sprite sheets and scene tiles.

Checks: `pnpm -s test:source`, `pnpm check`, `pnpm web:lint`, prettier.
Provider check: one real generated image passes `check` after `fix`
(recorded with its alpha statistics; the image is not committed).

Done when the commands and tests pass and the skill reads end to end.

#### P1 record

- Issue #348. Starting revision `dd58fadc`.
- Added `src/frontend/web/scripts/effect-assets.mjs` (`pnpm -s effects:assets`)
  with `check`, `fix`, `flipbook` and `preview`, its tests
  (`scripts/effect-assets.test.mjs`, in `test:source`), the
  `animama-effect-assets` skill and an "Effect art" section in
  `docs/frontend/runtime/avatar-vfx.md`.
- Beyond the planned steps, two checks came from the provider run below:
  `interior_translucency` (with `fix --solid-interior`) and `preview` (art on
  dark, light and checkered backdrops), because a generated image had a
  see-through centre that a single backdrop hid. Face-surface art keeps its
  layout: `--budget surface` skips the margin warning and refuses trimming.
- Checks: `node --test scripts/effect-assets.test.mjs` 20/20; `pnpm web:lint`
  pass; prettier on the changed scripts, `package.json` and the doc pass.
- Included art survey (`check` over all 16 effects' PNGs): no FAIL. `angry`
  (3%) and both Eye VV images (29%) carry near-opaque alpha; most floating art
  has wide margins (expected for the existing placement scales).
- Provider check (2026-10-08): one sweat drop generated through `image-gen`
  (45 s, 1254×1254, 608 KiB, real alpha). `check`: near-opaque 92%,
  see-through interior 6%, over the landmark budget. `fix --solid-interior
  --trim --pad 8 --square --budget landmark` → 512×512, 140 KiB, PASS.
  `preview` still showed a dark smudge painted into the colour, a regenerate
  case the skill now names. The image was not committed.

#### Code Review #1 Findings

`sdlc-reviewer`, initial review of the staged P1 changes on baseline
`dd58fadc`. Checks: the asset tests 20/20, prettier on the scripts and
`package.json`, `web:lint` pass; CLI probes on grey+alpha, palette, 16-bit,
JPEG, WebP, a 4096² image (fix in about 3.3 s), bad options and paths with
spaces. Blocking:

1. **P1-R1-01** — an unreadable file (not an image, a directory, over the
   pixel limit) threw an uncaught sharp error: a stack trace, exit 1 (the FAIL
   code), and the rest of a `check` batch skipped.
2. **P1-R1-02** — `check` counted faint alpha that `fix` clears, so noise held
   the bounds open (no `padding` warning) and read as see-through art; the
   skill picks `fix` options from `check`.
3. **P1-R1-03** — `flipbook --cell` resampled fixed frames and shipped
   near-opaque and faint alpha again.

Optional: P1-R1-04 overwrite guard bypassed by case-insensitive paths and
symlinks; P1-R1-05 `preview` without the pixel limit and flipbook frames
decoded all at once before the sheet-size check; P1-R1-06 the limits test
skipped `fps` and loop literals; P1-R1-07 plan text still described the
`--budget <px>,<KiB>` form and per-frame budget; P1-R1-08 `--opaque-from`
help range; P1-R1-09 `flipbook` accepted a non-PNG `--out`; P1-R1-10 painted
tints flagged as see-through; P1-R1-11 `--pad` applied before shrinking.

#### Code Review #1 Revisions

All accepted.

- **01:** decode errors become `EffectAssetError` naming the file; `check`
  reports `FAIL … [unreadable]` per file and continues; `fix`, `flipbook` and
  `preview` exit 2. Test: a batch with a text file and a good image.
- **02:** `measure` treats alpha below the clear threshold as transparent and
  reports `faint_alpha`. Test: a disc on an alpha-2 backdrop warns `padding`
  and `faint_alpha`, not `interior_translucency`.
- **03:** every flipbook frame has its alpha settled and edges bled after
  fitting. Test: three 300 px frames in 96 px cells leave no alpha 250–254.
- **04:** the guard compares device and inode of an existing `--out` with the
  inputs. Test: `--out` through a symlink to the input exits 2.
- **05:** `preview` opens with the pixel limit; `flipbook` reads headers,
  checks the sheet size, then decodes frames one at a time. The ×4 source
  limit is commented.
- **06:** the test also pins `MAX_FLIPBOOK_FPS` and the loop literals.
- **07:** recorded here: budgets are named (`landmark`, `surface`, `body`,
  `sticker`, `silhouette`, `flipbook` per sheet) rather than `<px>,<KiB>`;
  flipbook frames are fitted with `--cell`.
- **08, 09:** help text corrected; `flipbook --out` must be `.png`.
- **10:** `--budget surface` skips `interior_translucency`. Test added.
- **11:** `--pad` is applied after shrinking, in output pixels; a pad that
  leaves no room is refused. Test added.

Checks after revisions: `node --test scripts/effect-assets.test.mjs` 24/24.

#### Code Review #2 (repair round 1)

Findings: R1-02…11 confirmed fixed by probes; R1-01 fixed except `preview`.

1. **P1-R2-01** (blocking) — `preview` of an unreadable file still crashed
   with a stack trace and exit 1; errors from `fix`, `flipbook` and `preview`
   said "the image" because the CLI passed buffers, so a bad flipbook frame
   could not be identified.
2. **P1-R2-02** (optional, regression) — `fix --trim` measured with the
   default clear threshold, cropping faint alpha kept by `--clear-below`.

Revisions (both accepted): `preview` reads the header first through the
wrapped reader; the CLI passes file paths, so errors name the file; trim
measures with the caller's `clearBelow`. Tests: `preview` of a text file exits
2 naming it; a faint glow kept with `clearBelow: 1` survives the trim. Checks:
asset tests 25/25, `web:lint` and prettier pass.

#### Code Review #3 (repair round 2)

Pass. P1-R2-01 and P1-R2-02 confirmed fixed (file-named exit-2 errors for
not-an-image, missing, truncated and over-limit inputs; trim keeps a faint
glow with `clearBelow` 1 or 0). Optional P1-R3-01: `preview` still crashed on
a valid header with corrupt data. Accepted: its decode is wrapped like
`readRgba`'s; a truncated PNG now exits 2 with "cannot decode". Asset tests
25/25; prettier pass.

### P2 — Authoring pipeline tools: check, save, promote (R13, R16 tooling)

Outcome: an effect source folder can be checked, saved as Local content
through the creator and, after approval, promoted, using the same shape of
commands as Gestures.

Steps:

1. `pnpm -s effects check <folder…>` (in a new `scripts/effects.mjs`, sharing
   loaders with `effect-render-sources.mjs`):
   - definition validity against the generated `/2` zod schema, with JSON
     paths;
   - image budgets via `effects:assets check`;
   - the attachment resolves on both Included Avatars (face parts, bones,
     landmarks), using the render harness;
   - visible art: the effect render differs from a no-effect render inside the
     expected region (`--diff` pixel count above a floor) at the brief's times.
   PASS/WARN/FAIL lines like `animation check`; exit 1 on FAIL.
2. `pnpm -s effects:save <items.json>`, modelled on `animation-save.mjs`:
   each item (`folder`, `name`, `description?`) is imported into the Avatar
   Effect creator as a new Local effect or as a revision of the Local effect
   with that name, saved, reopened and read back from the Library. Never
   equips.
3. Generalize promotion into `pnpm -s effects promote <items.json> [--dry-run]`
   (shared core with `animation promote`, which keeps its behavior and tests):
   - `kind: "avatar_effect"`, from `library:local/<name>`: copy the definition
     and images to `vfx/avatar/<stem>/` (`add` for new stems, `replace` for
     upgrades, keeping the content ID `builtin:avatar-effect:<stem>`); validate
     `/2`; rely on the existing `vfx/avatar/**/*` inventory rule; add
     source-review records for every new file in the existing effect form;
   - `kind: "reaction"`, `mode: "replace"`, target `reactions/<emotion>-<n>`:
     write the Local Reaction's clip and meta (dependencies included), keeping
     the Included ID, role, placement hint and lifetime; refuse humanoid tracks
     and unresolved effect aliases;
   - `--dry-run` prints every file and record it would write.
4. Tests: `scripts/effects.test.mjs` (check outcomes on fixture folders,
   including a missing face part and invisible art), save item parsing, promote
   dry-run and write into a temporary content root for both kinds, and the
   unchanged Gesture promote tests.
5. Browser test for `effects:save` against the task stack, like
   `animation-save`'s.

Checks: `test:source`, focused vitest, `pnpm check`, `web:lint`, `pnpm build`;
`effects:save` of a fixture effect to the task stack and reopen in the creator.

#### P2 record

- Issue #349. Starting revision `043a8d27` (P1 commit).
- One CLI, `pnpm -s effects` (`scripts/effects.mjs`), with `check`, `save`
  and `promote`, instead of a separate `effects:save` script:
  - `check` (`effect-check.mjs`, plus `window.checkEffect` in
    `effect-render/render.ts`): art against the attachment's budget, the `/2`
    definition through the runtime parser (field named), the attachment on
    both Included Avatars (controller warnings fail) and visible art (each
    Avatar renders with and without the effect at each time and view; at least
    0.1% of a tile must change somewhere).
  - `save` (`effect-save.mjs`): builds the creator's editor document with the
    creator's own `createAvatarEffectDocumentFromDefinition` (loaded through
    Vite SSR), imports it in headless Chromium, chooses the images, saves,
    reads the item back and compares definitions after a round trip through
    the creator's document model (the API fills defaults the creator omits),
    then reopens the item. A Local effect with the same name is revised.
  - `promote` (`effect-promote.mjs`): `add`, `replace` and `delete` for
    Avatar Effects; validates definition and art; source-review records copy
    the existing effect records' fields; the inventory is unchanged (owner
    decision 2026-10-08). The Gesture `animation promote` is untouched.
- Deviation: Reaction promotion moves to P7. Included Reactions change format
  with #337, so writing them now would target a format about to be replaced.
- Checks: `node --test scripts/effects.test.mjs` 9/9;
  `node --test scripts/*.browser.test.mjs` 39/39 (includes the new
  `effect-check.browser.test.mjs`: a visible effect passes; art at alpha 5
  fails "no visible art"; opacity 3 fails at `appearance.opacity`);
  `pnpm check`, `pnpm web:lint`, prettier pass.
- Manual runs on the task stack (`animama-avatar-fx`):
  - `effects check library:included/eye_vv library:included/star
    library:included/texture_sick_3`: all pass (25 s), with the art warnings
    P1 recorded for Eye VV.
  - `effects save` of a copy of Eye VV: a new item ("P2 save new", with a
    changed offset and appearance, read back exactly) and a revision
    ("P2 save test").
  - `effects promote --dry-run`: an add from `library:local/P2 save new`, a
    replace of `eye_vv` and the source-review update listed; a delete of
    `eye_vv_pair` refused because `shy-finger-poke` depends on it. Nothing was
    written.

#### Code Review #1 Findings

`sdlc-reviewer`, initial review of the staged P2 changes on `043a8d27`.
Checks: `effects.test.mjs` 9/9, the check and render browser tests 3/3,
prettier and `web:lint` pass; probes with scratch effect folders and
promotion dry runs (nothing written). `effects save` was not run live: the
task stack had been stopped from outside the session. Blocking:

1. **P2-R1-01** — the visible-art baseline was the Avatar without the effect,
   so an eye effect's default face options (closed, cleaned eyes) counted as
   visible art: an eye effect at alpha 5 passed on both Avatars.
2. **P2-R1-02** — promotion took image names from the source unchecked:
   `sub/../x.png` wrote and then deleted the same file and left a mismatched
   source-review record; `sub/x.png` created nested files later replaces and
   deletes would miss; `image === otherEyeImage` duplicated a `files` entry.
3. **P2-R1-03** — a folder source with `soundAlias` and no dependency passed
   promotion, which the backend catalog would scan as invalid.

Optional: P2-R1-04 save crashed with a raw stack trace when the app was
unreachable, and a source error during save printed usage with exit 2;
P2-R1-05 repeated resolved names were not caught; P2-R1-06 the read-back
ignored whether an other-eye image survived; P2-R1-07 a late fade-in failed
without a hint, and `renderFrames` leaked a session if apply threw;
P2-R1-08 the docs said the tools need no stack and sourced the record after
using `library:local`; P2-R1-09 promote and the CLI re-implement helpers
from `animation-promote.mjs` and `animation.mjs` instead of the planned
shared core; P2-R1-10 the dry run did not list record changes.

#### Code Review #1 Revisions

- **01 accepted:** the baseline applies the same effect with fully
  transparent stand-in images of the same size, so face options and cleanup
  are in both renders and only the art differs. Test: an eye-landmark effect
  at alpha 5 fails "no visible art" on both Avatars. Included `eye_vv`,
  `eye`, `star3` and `texture_black_1` still pass.
- **02 accepted:** image names must be plain file names, distinct, and not
  the descriptor's name. Tests for `sub/x.png`, `sub/../x.png`, `..`,
  `<stem>.json` and a shared image.
- **03 accepted:** `soundAlias` is refused with dependencies. Test added.
- **04 accepted:** an unreachable app is reported as "could not reach the app
  at <origin>" (exit 1); source errors during save are save failures (exit 1).
- **05 accepted:** two items resolving to one name are refused before saving.
- **06 accepted in part:** the read-back compares whether an other-eye image
  is present; image bytes are not compared (the reviewer's round trip of all
  16 Included and 10 Local definitions was lossless).
- **07 accepted:** the message suggests `--times`; `renderFrames` closes its
  session when apply throws.
- **08 accepted:** docs corrected.
- **09 deferred, recorded:** the effect tools keep their own small helpers
  (repository reader, JSON writer, Vite SSR loader). Sharing them would mean
  restructuring the Gesture promotion and motion CLI that #310 just shipped;
  the duplication is about 60 lines and covered by each tool's tests.
- **10 accepted:** the dry run lists each source-review record added or
  dropped under the `licenses/source-review.json` line. Test added.

Checks after revisions: `effects.test.mjs` 9/9 (extended),
`effect-check.browser.test.mjs` 1/1 (with the eye case), prettier pass.

#### Code Review #2 (repair round 1)

Findings: R1-01…08 and R1-10 confirmed fixed by probes (faint eye effect
fails; Included eye effects pass; unsafe image names and sound refused;
unreachable app and repeated names reported; record notes listed; live save
and re-save of unchanged content on the task stack pass). R1-09 deferral
accepted.

1. **P2-R2-01** (blocking, regression from R1-01) — a silhouette
   `fill: "tint"` effect with white art failed "no visible art": the tint fill
   is opaque and a transparent stand-in's average colour falls back to white,
   so the baseline already matched white art.
2. Optional — the docs said `library:local/...` sources need a running stack;
   they need only the record sourced.

Revisions (both accepted): the transparent stand-in baseline applies only to
face attachments (face landmark and face surface), which carry face options;
body, sticker and silhouette effects compare against the bare Avatar. Test:
a white-art tinted silhouette passes. Docs reworded. Checks:
`effect-check.browser.test.mjs` 1/1 (now five cases), `effects.test.mjs` 9/9,
prettier pass.

#### Code Review #3 (repair round 2)

P2-R2-01 confirmed fixed with no regressions (tinted silhouettes with red or
white art pass; the faint eye effect still fails; Included `eye_vv`, a body
heart and a sticker pass; diagnostics come only from the applied session).

1. **P2-R3-01** (blocking, present since round 1, missed by reviews #1 and
   #2) — frames were read over a transparent canvas, where faint art beside
   the Avatar reads back at nearly full colour: a sticker at alpha 5 passed
   on both Avatars.

Revision (accepted): `checkEffect` reads each frame over the opaque tile
backdrop the contact sheets use. Test: a faint sticker beside the head now
fails "no visible art" on both Avatars. `effect-check.browser.test.mjs` and
`effect-render.browser.test.mjs` pass; Included `eye_vv`, `emote` and
`texture_sick_1` pass. The review budget is spent, so this last fix has test
evidence but no independent recheck; the final integration review covers it.

### P3 — Avatar Effect skill rewrite and fresh-agent dry run (R13)

Outcome: a fresh agent can produce one new effect from a brief to Local content
by following the skills alone.

Steps:

1. Rewrite `.agents/skills/animama-avatar-vfx/SKILL.md` as the pipeline, keeping `what.md`/`how.md` as references:
   0. interview, skipped when the brief settles it;
   1. brief (template in `references/brief.md`: what it expresses, the comedic
      or emotional beat, attachment and placement, suited Reaction intensities
      1–3, motion and duration, art description, budget);
   2. assets through `animama-effect-assets`;
   3. write the `/2` source folder;
   4. `effects check`;
   5. `effects:render` contact sheets (front, ¾, face; both Avatars; with a
      Reaction clip when the brief names one) and the headed
      `animation:preview` for the owner, resolving review notes;
   6. `effects:save`, then reopen in the creator;
   7. chat check on a test Anima when Reaction use matters;
   8. hand-off;
   9. Promote to Included, never by default: only with the owner's explicit
      approval of each item, on a task branch with a
      PR (`references/promote.md`).
   Add `references/batch.md` for briefs and assets in parallel with one review
   preview per batch.
2. Dry run: a fresh agent (no conversation context) follows the skills to make
   one simple new effect from a given brief (the plan proposes "Sweat drop",
   R14 #18, kept as a draft until G2 decides it) through `effects:save`.
   Record every point where it stalled, guessed or broke a rule, fix the skill
   or tools, and repeat once if fixes were material.
3. Update `docs/frontend/runtime/` effect authoring docs where the commands are
   described (R11's pages) so they name the new tools.

Checks: the dry-run record (commands, check output, render sheet, saved Local
item reopened). This completes the R12–R13 acceptance item.

#### P3 record

- Issue #350. Starting revision `77401852` (P2 commit).
- Rewrote `.agents/skills/animama-avatar-vfx/SKILL.md` as the pipeline
  (interview, brief, art, effect folder, check, renders and the owner's live
  preview, save, use, hand-off, gated promote) and added references
  `brief.md`, `effect-folder.md` (every `/2` field, rules and recipes),
  `batch.md` and `promote.md`; `how.md` and `what.md` stay as the creator
  manual and concepts.
- **Dry run 1** (fresh `general-purpose` agent, no conversation context; brief
  "Sweat Drop (dry run)", floating face art on the forehead): it generated the
  art through Codex (one `--edit` to remove a painted blotch), fixed it to
  512 px / 107 KiB, wrote the folder with pop-in and slide keyframes, passed
  `effects check` on both Avatars (5 of 6 frames; the miss is the pop-in
  frame), rendered and read sheets, and saved Local "Sweat Drop - dry run"
  through `effects save` (read back and reopened). The headed preview was
  left for the owner. Its log:
  - **Runtime bug (out of P3 scope):** a floating face effect's `offset.x`
    points opposite ways on the VRM 0 and VRM 1 Included Avatars. Cause:
    face-landmark offsets are applied in the normalized head bone's frame,
    which faces −Z on VRM 0; body attachments correct this with `frontYaw`
    (stickers sit in the camera plane), face landmarks do not. The creator's drag writes the same
    model-dependent offsets. Split out as a separate fix task (offered to
    the owner 2026-10-08); until it lands the skill tells authors to keep
    floating `offset.x`/`offset.z` at 0. It should land before P4.
  - Name rule undocumented: the app refused "Sweat Drop (dry run)" (409
    `invalid_entry_name`). Fixed: `effects save` checks names before saving
    (`localEntryName`, mirroring the backend's `readable_entry_name`) and
    prints each Local folder; the skill states the rule and that the Local
    folder comes from the name.
  - `padding` warned even after `--trim --pad 8 --square` on tall art. Fixed:
    the warning needs slack on both axes.
  - Repeated stems overwrote render sheets silently. Fixed: `effects:render`
    refuses two sources with one stem when writing to a directory.
  - `check` did not say which frames missed. Fixed: up to four missed frames
    are listed; the skill explains pop-in misses and `--times`.
  - Skill gaps fixed: where Included effects live and which fields a draft
    omits; keyframe semantics (units, uniform scale, held last frame);
    creator units (cm, %) versus stored units (metres, fractions);
    `--times` covering an effect's life; the ¾ view (corrected in review:
    it looks from the Avatar's right); when setup is needed; sources and previews in a `<stem>-work/`
    folder; `--budget` implies `--max`; a sweat-drop recipe.
- **Dry run 2** (fresh agent, after the fixes; brief "Idea Bulb dry run", a
  sticker beside the head): one Codex image, no rejects; 512 px / 131 KiB;
  `effects check` visible in 6 of 6 frames on both Avatars; saved Local
  "Idea Bulb dry run" (image digest matches the draft). No command failed
  and every step ran as documented on the first try; it read no source code.
  Its log had only documentation gaps, now fixed: the budget follows the
  attachment; the sticker offset frame (+x viewer's right, +y up) and prop
  size (0.1–0.15); face-view misses for stickers are expected; check's
  default views and times; keyframe `loop` restarts the whole timeline, so
  an ongoing beat is a `pulse` beside a one-off pop-in; where briefs, renders
  and fixed images go; render times that catch keyframe peaks; a prop
  recipe. A third run was not needed.
- Checks: `effects.test.mjs` 10/10, `effect-assets.test.mjs` 25/25; a
  repeated-stem render exits 2.

#### Code Review #1 Findings

`sdlc-reviewer`, initial review of the staged P3 changes on `77401852`.
Checks: unit tests 35/35, `web:lint` and prettier pass; all 12 recipes
validated against the backend model; five recipes passed `effects check`;
render probes of left and right forehead art; a preview's picker choices.
Verified: contract fields and face options, keyframe semantics, body and
sticker frames, the Local name rule, commands and flags, promote, the brief
template's R14 fields, and the workflow mirroring `animama-animation`.
Blocking:

1. **P3-R1-01** — the ¾-view statement was backwards: the view looks from the
   Avatar's right, so its left side turns away.
2. **P3-R1-02** — the skill said effects in one face region replace each
   other; `emote` and `full_face` stack (runtime, runtime doc, `what.md`).
3. **P3-R1-03** — batch review in one preview was unsupported: the picker
   listed only the effect sources named on the command line.

Optional: P3-R1-04 check message wording for late fade-ins; P3-R1-05 the
sweat-drop recipe's `scale` must be `{x, y}`; P3-R1-06 the `otherEyeImage`
rule; P3-R1-07 draft paths in commands run from `src/frontend/web`;
P3-R1-08 no regression tests for the padding rule and repeated stems;
P3-R1-09 save's duplicate guard compared raw names, not Local folders;
P3-R1-10 `library:local` needs only the record; P3-R1-11 the plan record
said stickers use `frontYaw`.

#### Code Review #1 Revisions

All accepted.

- **01, 02:** corrected in `SKILL.md`, `effect-folder.md` and this record.
- **03:** fixed in the tool: `animation:preview`'s picker lists every other
  effect folder beside a named one (`animation-preview-media.mjs`
  `choices`), so a batch kept side by side in `.animama-drafts/effects/` is
  reviewed in one preview; work folders without a descriptor are skipped.
  Test added; `batch.md` and the runtime doc describe it.
- **04–07, 10, 11:** wording, recipe and path fixes (draft paths are written
  `../../../.animama-drafts/...` in commands).
- **08:** tests: tall art squared to fit is not flagged for padding; render
  refuses two sources with one stem for directory output (exit 2).
- **09:** save refuses two items that map to one Local folder.

Checks after revisions: `effects.test.mjs` and `effect-assets.test.mjs`
37/37, `animation-preview-media.test.mjs` 8/8, prettier pass.

#### Code Review #2 (repair round 1)

Pass. All round-1 fixes confirmed (a preview probe listed and played a
sibling effect folder and skipped folders without an effect). Optional:

1. **P3-R2-01** — the sibling scan listed any folder with exactly one JSON
   file, such as a work folder holding `items.json`, which failed when picked.
   Accepted: a folder is listed only when its descriptor's `content_type` is
   `avatar_effect`; the test's work folder now holds a non-effect JSON.
2. **P3-R2-02** — save's duplicate guard does not cover a name that maps to
   an existing Local effect's folder under a different name, and the printed
   folder can differ for a revision (the backend keeps the existing folder).
   Deferred: low impact; the backend still refuses the clash with a clear
   409, and the skill tells authors to keep one name per effect.

Checks: preview, effects and asset tests 45/45 (8/8 preview media after the
P3-R2-01 change), `web:lint` and prettier pass.

### P4–P6 — Effect batches (R14). G1 passed 2026-10-08; G2 per batch.

The owner's list (G1) has 24 effects. P4, P5 and P6 are produced **in
parallel** (owner, 2026-10-08): six subagents follow the skill's batch mode,
each owning a group of related effects and generating its images
concurrently (at most two image jobs at a time each). All work from the same
style guide and style reference image, then one consistency pass across the
whole library precedes a single live preview in which the owner reviews all
three batches (G2, recorded per batch). Effects are saved as Local content
only after G2 approval.

**Library style:** flat cel shading, one clean dark outline (about 3–4% of
the art's height), two or three flat colours plus white highlights, no
gradients or texture grain, bold readable silhouettes; anime emphasis marks,
comedic rather than realistic. The fixed dry-run sweat drop is the style
reference (`--ref`), for line weight and shading only.

**Briefs** (expresses · beat · attachment · Reaction tiers · motion and
duration · art). "Replace" keeps the Included stem and content ID.

| # | Effect (stem) | Batch, mode | Expresses · beat | Attachment | Tiers | Motion · duration | Art |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Anger mark (`angry`) | A, replace | anger, annoyance · the classic popping vein | forehead, left | anger 2–3, annoyance 3 | pulse throb; held | red four-arm cross-popping vein mark |
| 2 | Exclamation (`emote`) | A, replace | surprise, alarm · "!" pops over the head | top_edge, right corner | curiosity 2–3, fear 3 | pop-in overshoot, small jolt; held | red "!" with three short motion ticks |
| 3 | Eye = (`eye`) | A, replace | flat unimpressed stare · deadpan | eyes, mirrored | disapproval 2, disgust 2 | still | thick horizontal "=" bars over each eye |
| 4 | Eye 0 (`eye_0`) | A, replace | blank shock, soul leaving · hollow eyes | eyes, mirrored | fear 2, grief 3 | slight tremble keyframes | empty white oval eyes with dark outline |
| 5 | Eye Confused Swirl (`eye_confused_swirl`) | A, replace | dizzy confusion · spiral eyes | eyes, mirrored | confusion 2–3 | spin | black spiral on white |
| 6 | Eye O (`eye_o`) | A, replace | startled · wide round eyes | eyes, mirrored | curiosity 2, fear 2, nervousness 3 | pop-in | large white circles, tiny dot pupils |
| 7 | Eye VV (`eye_vv`) | A, replace | giggly, bashful delight · happy squint | eyes, mirrored | amusement 1–3, embarrassment 2 | still | thick "^" / "v" happy-squint arcs |
| 8 | Mouth Hover w (`mouth_hover_w`) | A, replace | cat-mouth smugness · preview only | mouth landmark | preview only | still | "w" cat mouth line |
| 9 | Mouth w (`mouth_w`) | A, replace | cat-mouth smugness · preview only | painted, mouth decal | preview only | still | "w" cat mouth line |
| 10 | Star3 (`star3`) | A, replace | starry-eyed admiration · sparkling pupils | painted on irises (eyes, single) | admiration, excitement, joy, optimism, respect 2–3 | pulse | four-point yellow star with white glint |
| 11 | Gloom face (`texture_black_1`) | A, replace | gloom washing over · dark shade on the upper face | painted, face skin full | grief, remorse, sadness, disappointment 2–3 | still | dark indigo shade with vertical lines, UV-aligned (edit of the current texture) |
| 12 | Sick face 1 (`texture_sick_1`) | A, replace | queasy · green-tinged face | painted, face skin full | disgust 2 | drift | pale green wash, UV-aligned |
| 13 | Sick face 2 (`texture_sick_2`) | A, replace | about to be sick · strong green with lines | painted, face skin full | disgust 3 | still | stronger green, blue vertical lines under the eyes, UV-aligned |
| 14 | Blush (`blush`) | B, add | embarrassed or smitten · cheeks flush | painted, blush span | embarrassment 1–3, love 2 | fade-in via event | soft pink ovals with three diagonal hatch lines |
| 15 | Streaming tears (`streaming_tears`) | B, add | overwhelmed crying · comic tear streams | painted, undereye single mirrored, flipbook | sadness 3, grief 3, gratitude 3 | flipbook 6–8 frames at 10 fps, loop | light-blue stream with highlight |
| 16 | Sweat drop (`sweat_drop`) | B, add | caught out · big sweat drop | forehead, right | nervousness 2–3, embarrassment 3 | pop-in, slow slide down; held | light-blue drop, white highlight (dry-run art as a start) |
| 17 | Gloom lines (`gloom_lines`) | B, add | deflated · vertical shadow lines over the brow | forehead, middle | disappointment 2–3, remorse 2 | fade/slide in from above | dark blue-purple vertical lines |
| 18 | Heart eyes (`heart_eyes`) | B, add | smitten · hearts for eyes | eyes, mirrored | love 3, desire 2–3 | pulse | red hearts with white glint |
| 19 | Steam puffs (`steam_puffs`) | C, add | fuming · steam blasting off the head | top, left or right, flipbook | anger 3, annoyance 2 | flipbook puffs, loop | white puffs with grey outline |
| 20 | Heart throb (`heart_throb`) | C, add | warm caring · a beating heart on the chest | body, chest | caring 2–3, love 1, gratitude 2 | pulse about 1.5 Hz | red heart with outline and glint |
| 21 | DOKI DOKI (`doki_doki`) | C, add | heart racing · comic sound effect | sticker beside the head | love 2, nervousness 2 | pop-in, small shake | pink comic letters "DOKI DOKI!" |
| 22 | Idea bulb (`idea_bulb`) | C, add | sudden idea · bulb pops on | sticker beside the head | curiosity 3, confidence 2–3, optimism 2 | pop-in, gentle pulse | yellow bulb with rays (dry-run art as a start) |
| 23 | Music notes (`music_notes`) | C, add | carefree joy · notes bobbing up | sticker beside the head | joy 2, amusement 2 | keyframe bob or drift up, loop | two black eighth notes with colour accents |
| 24 | Despair shade (`despair_shade`) | C, add | crushing despair · the whole body darkens | silhouette, tint | grief 3, fear 3 | fade in via event | dark indigo tint art (average colour drives the fill) |

Reaction tiers are the brief's intent; P7 makes the final mapping.

For each effect: art → effect folder → `effects check` → renders, by the
subagents; then the consistency pass, the owner's preview (G2), revisions
(at most two rounds per effect) and one `effects save` run. Per batch
checks: `effects check` on every folder; render sheets with no controller
warnings; `effects:bench` once with the heaviest new combination (budget 2 ms
added, quiet machine). Done when every effect is approved, revised and
re-approved, or dropped by the owner.

#### P4–P6 record

- Issues #351–#353. Starting revision `be0fc0a1`.
- 2026-10-08: six parallel subagents produced all 24 effect folders in
  `.animama-drafts/effects/<stem>/` (briefs, sources and renders in
  `<stem>-work/`), each passing `effects check` on both Included Avatars.
  About 10–16 minutes per group; no image-generation rate limits; one Codex
  run returned no image and succeeded on retry.
- Notable choices (for G2): Eye VV redrawn as a "^ ^" happy squint (the old
  art was "> <"); Anger mark and Exclamation lose their spin wobble for a
  pop-in and throb or jolt; Steam puffs is a 4-frame flipbook; DOKI DOKI is
  stacked on two lines (a one-line version is kept); Despair shade uses the
  multiply blend at 0.8 so it darkens rather than tints; Mouth w and Mouth
  Hover w are 1.2× larger (at the old size they fail the visible-art floor,
  as the Included originals do); the three face textures are edits of the
  Included textures, placed with a calibration grid of the face layout.
- Consistency pass (agent): one overview of all 24 at 1 s, front and face
  views, on both Avatars. Eye 0 enlarged (scale 0.5 → 0.65) to match the
  other eye effects; Gloom lines lowered and shortened so they hang from the
  brow instead of above the head. Both re-checked.
- Tooling from the agents' reports: `effects:assets fix --canvas <px>
  --art-size <px>` (fixed framing for painted art), `flipbook --trim` (one
  shared crop) and `--cell <W>x<H>` (non-square frames), with tests; skill
  notes on concurrent generation (`&` + `wait`), `--ref` on edits, judging
  alpha with `preview`, placement sizes, decal aspect, and spin swing.
  Open tooling notes: generated face textures carry grain that pushes them
  over budget (an agent flattened it with a median filter and colour
  quantisation outside the repository tools); follow-up edits of translucent
  overlays tend to lose their transparency, so redraws start from the
  Included texture.
- Next: the owner's live review of all 24 (G2).

### P7 — Reaction wiring (R15). Gate G3.

1. Starts after #337 merges and this branch has merged `main`: Included
   Reactions are then 2.0 and load as such.
2. Mapping: one table, emotion × intensity → effect (or none), derived from the
   effect briefs, with a one-line beat for each assignment. Every emotion gets
   at least one variant; caring, desire, embarrassment, gratitude and love gain
   their first; an effect is added only where it lands a clear beat. Mouth w
   and Mouth Hover w leave `amusement-2`/`-3`. `shy-finger-poke` switches from
   `eye_vv_pair` to `eye_vv` (Gesture, same timing).
3. Apply each change in the Reaction (or Gesture) creator as Local content,
   checking timing against the expression in the headed preview; save without
   equipping.
4. Add Reaction support to `effects promote` (`replace` of
   `reactions/<emotion>-<n>` from the Local Reaction, keeping its ID, role,
   placement hint and lifetime; refusing humanoid tracks and unresolved effect
   aliases), in the format #337 settles; moved here from P2.
5. Update the tests that pin the mapping (`reactionClips.test.ts` alias
   resolution; a test that no Included Action references `mouth_w` or
   `mouth_hover_w`).

G3: the owner reviews the mapping table and plays the wired Reactions in
`animation:preview` on both Avatars.

### P8 — Promotion, documentation and acceptance (R16). Gate G4.

1. Present the promotion list (effects and Reactions, add, replace or
   delete); wait for the owner's approval on this PR (G4).
2. `pnpm -s effects promote <items.json> --dry-run`, then without it. Regenerate
   thumbnails for upgraded templates (`effects:thumbnails <id…>`); delete
   `vfx/avatar/eye_vv_pair/`, its template, thumbnail and source-review
   records (owner decision 2026-10-08); add new templates only if the owner
   asked.
3. Update pinned counts and tests; run the content checks below.
4. Docs: the R11 pages for the new commands and skill steps; the content
   inventory notes; `effect-templates/README.md` if templates change.
5. Chat checks on both Included Avatars through a few wired Reactions,
   including a silhouette and a sticker effect.
6. Final integration review, PR (template; `Closes #298` and the phase issues),
   owner merge approval of the exact candidate.

Checks: `uv run pytest -q tests/test_included_content_integrity.py
tests/test_included_content_catalog.py tests/test_starter_content_closure.py
scripts/public-release/test_prepare_source.py`, the full `uv run pytest -q`,
`make check`, from `src/frontend` `pnpm check`, `pnpm web:lint`,
`pnpm web:test`, `pnpm build`, `pnpm desktop:check`, the desktop stage audit
from `references/promote.md`, and the full `pnpm e2e:test` (content packages
change).

## Final integration review

Covers R12–R16 together against the final candidate, reusing still-valid phase
evidence: the dry run, every approved effect and Reaction present in Included
content with licence records, no Action using a mouth effect, Eye VV in
`shy-finger-poke`, all content tests passing.

## Validation and acceptance

From the spec:

- R12, R13: a fresh agent following the skills produces one new effect from a
  brief, passes the checks and renders, and saves it as Local content; the
  asset checks have tests (alpha, near-opaque fix, trim, size, frame grid).
- R14–R16: each listed effect, as finally agreed, is approved by the owner in
  the headed preview on both Avatars; every emotion has a Reaction variant
  using one; mouth effects are used by no Action; promoted content passes the
  integrity and starter closure tests with licence inventory records.

Outstanding manual checks: G2–G4 owner reviews; the performance re-run on a
quiet machine.

## Idempotence and recovery

- Asset scripts never overwrite inputs; `fix` writes to `--out`.
- `effects:save` creates a revision when the Local name exists; a failed run
  can be retried item by item.
- Promotion is `--dry-run` first and writes only under `content/included/`
  and the two licence files; `git restore` undoes an unapproved write.
- The 2.0 Reaction loader change is additive; 1.0 files keep loading.
- No database or schema changes are planned.

## Outcomes & Retrospective

Not started.
