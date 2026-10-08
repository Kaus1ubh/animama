# Author the Avatar Effect library and its skills (Plan 2, content)

Source agreement: [#298](https://github.com/raymond-van/animama/issues/298)
(snapshot: [avatar-effects-v2-spec.md](avatar-effects-v2-spec.md)), requirements
R12–R16. The owner accepted the spec on 2026-10-06 and on 2026-10-07 asked that
the Avatar Effect skill follow the `animama-animation` pipeline with a gated
Promote to Included step like #310's. On 2026-10-08 the owner approved Plan 1's
merge (PR #328, merge commit `fd1980fe`) and asked to proceed with Plan 2.
Authorized scope: planning. Implementation starts when the owner authorizes the
phase range; G1–G4 below apply regardless.
Starting revision: `fd1980fe` (`origin/main` after #328).
Branch: `feat/avatar-effects-content`, in the existing task worktree
`avatar-effects-v2`. One branch and one PR for this plan.
Issues: parent #298 (stays open until this plan merges); phase issues are
created at preparation. Related: #297 (Particle and Scene templates, reuses
R12), #310 (Gesture promotion, merged), #282 and #291 (merged; their Reactions
are the ones R15 edits).

## Purpose and context

Plan 1 delivered the platform: the `/2` definition, five attachments, face
parts, event fades, the Effects picker, the reworked Avatar Effect creator and
the review tools. Plan 2 uses it to make content:

- **R12:** an effect-asset skill and scripts that turn an art brief into clean,
  budgeted PNGs (single images and flipbook grids), with provenance.
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
| Gesture pipeline to mirror | `.claude/skills/animama-animation/SKILL.md` (steps 0–9) with `references/` (`interview.md`, `checks-and-review.md`, `batch.md`, `promote.md`, …). `.agents/skills/` holds an identical copy of every `animama-*` skill; both must change together. Commands: `pnpm -s animation validate|check|resolve|promote`, `animation:preview`, `animation:render`, `animation:save`. |
| Avatar Effect skill today | `.claude/skills/animama-avatar-vfx/` (`SKILL.md`, `references/what.md`, `references/how.md`): an operating manual for the creator, not a generation pipeline. `SKILL.md` :52–60 ("Planned rework") already outlines R12–R13. The owner's global `~/.codex/skills/animama-avatar-vfx` is an older v1 copy outside this repository and out of scope. |
| Image generation | The owner's global `image-gen` skill (`gen.sh`) runs `codex exec` with the owner's ChatGPT login and copies the result to a chosen path. 30–90 s per image. Optional tool only. |
| Image tooling | `sharp` 0.34.5 is a devDependency (`src/frontend/package.json` :81), used by `src/frontend/scripts/generate-particle-vfx-assets.mjs`. Pillow is a backend dependency; `app/services/content_image.py` :290–310 has an alpha-histogram check. |
| Image limits | Frontend `src/lib/avatar/vfx/effect-image-limits.ts`: 16 MiB per image, 4096 px side, 4096² pixels, 64 KiB definition. Backend `app/contracts/avatar_effect.py` :31–38, :250–271: flipbook grid ≤ 16×16, ≤ 256 frames, fps ≤ 60, keyframes ≤ 64. Existing art is 256²–1024², 3.6–130 KB. |
| Review tools | `scripts/effect-render.mjs` (`effects:render <source…>|--all-included --out`, `--times`, `--views front,three-quarter,face`, `--with-clip`, `--together`, `--diff a b`, `--thumbnail`; exits 1 on a controller warning). `effect-thumbnails.mjs` (`effects:thumbnails [id…]` → `src/assets/effect-templates/<id>.webp`). `effect-bench.mjs`. `animation-preview.mjs` (headed; effect source folders and Library Reactions; notes in `<stem>.review.json`). |
| Effect source folder | `<stem>/` with `<stem>.json` (`content_type: "avatar_effect"`, `/2` definition) and its images; resolved by `effect-render-sources.mjs` :197–300. This is the R13 draft unit. Drafts live under the ignored `.animama-drafts/`. |
| Saving | `scripts/animation-save.mjs` drives the Gesture creator headlessly (import a project file, save, read the Library item back). Nothing equivalent exists for effects; the Avatar Effect creator has Import (`ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`). |
| Promotion | `scripts/animation-promote.mjs` (+ `.test.mjs`) is Gesture-only: it writes `gestures/<slug>/<slug>.json` and `.meta.json`, inserts an inventory rule before `gestures/**/*.json`, adds `licenses/source-review.json` records and supports `--dry-run`. Effects need binary copies, `/2` validation and a rule before `vfx/avatar/**/*`; Reactions need a `reactions/<id>` replace mode. |
| Included effects | 16 under `vfx/avatar/<stem>/<stem>.json` (`/2` definitions, IDs `builtin:avatar-effect:<stem>`): `angry`, `emote`, `eye` (Eye =), `eye_0`, `eye_confused_swirl`, `eye_o`, `eye_vv`, `eye_vv_pair`, `mouth_hover_w`, `mouth_w`, `star`, `star3`, `texture_black_1` (Gloom face), `texture_sick_1`–`3`. All are picker templates (`src/lib/effects/effectTemplates.ts` :97–114). |
| Included Reactions | 72 under `reactions/<emotion>-<1..3>/`, all `animaPoseClip/1.0`, expression-only, lifetime `whileInteractionPhase: talking`. An effect is an `avatar_vfx` event whose `effectId` is an alias declared in the meta's dependencies (`builtin:avatar-effect:<stem>`). 19 emotions use an effect today; caring, desire, embarrassment, gratitude and love do not; no `-1` variant does. |
| Reaction 2.0 gap | The Reaction creator saves `animaPoseClip/2.0` (`src/ui/action-editor/actionPersistence.ts` ~:156). The bundled Included catalog parses Reactions with the 1.0-only `parseAnimaPoseClip` (`src/lib/avatar/poses/catalog.ts` :47–55, :233–290) and skips other files, although Gestures already use an either-schema parser (:223). A promoted 2.0 Reaction would vanish. |
| Licences | `licenses/inventory.json`: first-match rules; `vfx/avatar/**/*` is owner-authored. Generated-art precedent: `vfx/scene/**/svg-*.svg`, "Animama project owner using an AI image generator", `LicenseRef-Animama-owner-ai-generated`. Promoted Gestures use `LicenseRef-Animama-agent-authored`. `licenses/source-review.json` needs a record per tracked file (`scripts/public-release/test_prepare_source.py`). Template thumbnails also need records and the desktop notice entry `effect-template-thumbnails` (`src/frontend/desktop/runtime/license-sources.json` :119). |
| Tests pinning content | `tests/test_included_content_integrity.py`, `tests/test_included_content_catalog.py` (:172, every effect VALID with an image), `tests/test_starter_content_closure.py` (starter loadout pins all 72 Reactions), `src/lib/avatar/poses/catalog.content.test.ts` :169–170 (counts), `tests/avatar/reactionClips.test.ts` (:520 alias resolution; the hard-coded particle mapping :37–66), `src/lib/avatar/vfx/definition.test.ts`, `src/lib/effects/effectTemplates.test.ts` (one thumbnail per template). |

## Progress

- [ ] Preparation: phase issues, dependencies, task stack.
- [ ] P1 — Effect-asset scripts and skill (R12).
- [ ] P2 — Authoring pipeline tools: check, save, promote (R13, R16 tooling).
- [ ] P3 — Avatar Effect skill rewrite and fresh-agent dry run (R13). Gate G1 needed only before P4.
- [ ] P4 — Effect batch A: upgrades and kept effects (R14). Gate G2.
- [ ] P5 — Effect batch B: new face effects (R14). Gate G2.
- [ ] P6 — Effect batch C: flipbooks, body, sticker and silhouette effects (R14). Gate G2.
- [ ] P7 — Reaction wiring (R15). Gate G3.
- [ ] P8 — Promotion, documentation and acceptance (R16). Gate G4.

## Surprises & Discoveries

- 2026-10-08 (planning): Included Reactions are all `animaPoseClip/1.0`, and the
  bundled catalog skips non-1.0 Reaction files, while the creator always saves
  2.0. R15's "use the clip format current when Plan 2 runs" therefore needs the
  Included Reaction loader to accept 2.0 before any promoted Reaction lands
  (P7).
- 2026-10-08 (planning): `animation promote` is Gesture-only; effect and
  Reaction promotion is new work (P2, P7).

## Decision Log

- 2026-10-08, owner: proceed with Plan 2 after merging #328.
- 2026-10-08, agent proposal (planning), within the spec:
  - Reactions edited for R15 are saved by the Reaction creator as 2.0 and
    promoted as 2.0. P7 first extends the Included Reaction loader to accept
    2.0 (reusing the Gesture either-schema parser) and checks that a 2.0 save
    of an unchanged Reaction renders the same as its 1.0 source.
  - Eye VV Pair stays an Included item, so Local content that depends on it
    keeps working, but it leaves the templates and every Included Action. Eye
    VV takes its place ("merges into").
  - New effects become picker templates only if the owner asks at G4; upgraded
    templates get fresh thumbnails.
  - Generated art uses a per-effect inventory rule with the owner-ai-generated
    licence and provenance naming the tool (Codex `image_gen` via the
    `image-gen` skill), the issue and the approval date. Definitions written by
    the agent use the agent-authored wording, like promoted Gestures. The owner
    sees the exact wording before promotion (G4).
  - Drafts, briefs and review notes stay under the ignored `.animama-drafts/`;
    the committed record of each brief is a short entry in this plan.

## Gates

| Gate | When | Who | Effect |
| --- | --- | --- | --- |
| G1 | Before P4 | Owner trims and edits the R14 table (spec "Open: final effect list") | Fixes the effect list and batch contents; P1–P3 do not wait for it |
| G2 | End of P4, P5 and P6 | Owner reviews each batch's briefs and the effects in the headed preview on both Included Avatars | Approved effects proceed; others are revised (up to two revision rounds per effect, then dropped or deferred by the owner) |
| G3 | End of P7 | Owner reviews the Reaction mapping and the wired Reactions in the headed preview | Approved Reactions proceed to promotion |
| G4 | P8, before any write to `content/included/` | Owner approves each promoted item and the exact licence wording, on this PR | The only point where an agent writes Included content |

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
ready-to-use effect image or flipbook, with provenance, by one command.

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
   - `provenance <png…> --tool <name> --by <who> [--prompt-file <f>]`: write or
     update `provenance.json` beside the images (file, sha256, tool, generated
     by, date, prompt reference). Promotion (P2) reads it.
2. Node tests (`scripts/effect-assets.test.mjs`, added to `test:source`) with
   synthetic PNGs: alpha absent, checkerboard, near-opaque fix, trim, resize to
   budget, flipbook grid and limit refusal, provenance round-trip.
3. Skill `.claude/skills/animama-effect-assets/` (and the `.agents/skills/`
   copy): brief → prompt template for effect art (flat anime emphasis style,
   transparent background, single subject, no text unless the brief asks) →
   `gen.sh` → `effects:assets check/fix/flipbook` → `provenance`. It states the
   default budgets (eye/emote art 512², face surface 1024², flipbook frames
   256², ≤ 256 KiB per file unless the brief justifies more) and that it serves
   #297 for particle textures, sprite sheets and scene tiles.

Checks: `pnpm -s test:source`, `pnpm check`, `pnpm web:lint`, prettier.
Provider check: one real generated image passes `check` after `fix`
(recorded with its alpha statistics; the image is not committed).

Done when the commands and tests pass and the skill reads end to end.

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
     `/2`; insert a per-effect inventory rule before `vfx/avatar/**/*` using
     `provenance.json`; add source-review records for every file;
   - `kind: "reaction"`, `mode: "replace"`, target `reactions/<emotion>-<n>`:
     write the Local Reaction's clip and meta (dependencies included), keeping
     the Included ID, role, placement hint and lifetime; refuse humanoid tracks
     and unresolved effect aliases;
   - `--dry-run` prints every file, rule and record it would write.
4. Tests: `scripts/effects.test.mjs` (check outcomes on fixture folders,
   including a missing face part and invisible art), save item parsing, promote
   dry-run and write into a temporary content root for both kinds, and the
   unchanged Gesture promote tests.
5. Browser test for `effects:save` against the task stack, like
   `animation-save`'s.

Checks: `test:source`, focused vitest, `pnpm check`, `web:lint`, `pnpm build`;
`effects:save` of a fixture effect to the task stack and reopen in the creator.

### P3 — Avatar Effect skill rewrite and fresh-agent dry run (R13)

Outcome: a fresh agent can produce one new effect from a brief to Local content
by following the skills alone.

Steps:

1. Rewrite `.claude/skills/animama-avatar-vfx/SKILL.md` (and the `.agents`
   copy) as the pipeline, keeping `what.md`/`how.md` as references:
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
      approval of each item and its licence wording, on a task branch with a
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
item reopened); skill files identical in `.claude/skills` and `.agents/skills`
(`diff -rq`). This completes the R12–R13 acceptance item.

### P4–P6 — Effect batches (R14). Gate G1 before P4; G2 at the end of each.

Batch contents follow the owner's final list from G1. The proposed split, by
risk and shared technique:

- **P4, batch A — upgrades and kept effects:** Eye =, Eye 0, Eye Confused
  Swirl, Eye O, Mouth w, Star3 (confirmed upgrades); review-only passes for
  Anger mark, Exclamation, Eye VV, Mouth Hover w, Star eyes, Gloom face, Sick
  faces 1–3. Upgrades keep their stems and content IDs.
- **P5, batch B — new face effects:** Blush, Sweat drop, Gloom lines, Heart
  eyes, Sparkle eyes, Streaming tears.
- **P6, batch C — motion and new attachments:** Steam puffs, Respect shine
  (flipbooks), Heart throb (body), Comic "DOKI DOKI", Idea light bulb, Music
  notes (stickers), Despair shade (silhouette).

For each effect: brief → assets → source folder → `effects check` → renders →
`effects:save` to the task stack. Record each brief as one row in this plan
(name, stem, beat, attachment, intensities, motion and duration, budget, files
and sizes). At batch end, the owner reviews briefs and effects together in
`animation:preview` on both Avatars (G2), alongside each effect's render sheet.
Revise from review notes; at most two revision rounds per effect.

Per batch checks: `effects check` on every folder; `effects:render` sheets with
no controller warnings; `effects:bench` once in P6 with the heaviest new
combination (budget 2 ms added, quiet machine); `definition.test.ts` still
passes with Local fixtures.

Done when every effect in the batch is approved, revised and re-approved, or
dropped by the owner.

### P7 — Reaction wiring (R15). Gate G3.

1. Extend the Included Reaction loader (`src/lib/avatar/poses/catalog.ts`) to
   accept 2.0 Reactions with the either-schema parser, keeping the
   expression-only and lifetime rules. Tests: a 2.0 Reaction fixture loads; a
   creator re-save of an unchanged 1.0 Reaction renders the same
   (`animation:render` diff) before any wiring change.
2. Mapping: one table, emotion × intensity → effect (or none), derived from the
   effect briefs, with a one-line beat for each assignment. Every emotion gets
   at least one variant; caring, desire, embarrassment, gratitude and love gain
   their first; an effect is added only where it lands a clear beat. Mouth w
   and Mouth Hover w leave `amusement-2`/`-3`. `shy-finger-poke` switches from
   `eye_vv_pair` to `eye_vv` (Gesture, same timing).
3. Apply each change in the Reaction (or Gesture) creator as Local content,
   checking timing against the expression in the headed preview; save without
   equipping.
4. Update the tests that pin the mapping (`reactionClips.test.ts` alias
   resolution; a test that no Included Action references `mouth_w` or
   `mouth_hover_w`).

G3: the owner reviews the mapping table and plays the wired Reactions in
`animation:preview` on both Avatars.

### P8 — Promotion, documentation and acceptance (R16). Gate G4.

1. Present the promotion list (effects and Reactions, add or replace) and the
   exact inventory and source-review wording; wait for the owner's approval on
   this PR (G4).
2. `pnpm -s effects promote <items.json> --dry-run`, then without it. Regenerate
   thumbnails for upgraded templates (`effects:thumbnails <id…>`); remove
   `eye_vv_pair` from the templates; add new templates only if the owner asked.
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
