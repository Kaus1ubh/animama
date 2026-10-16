# Owner content-tuning page for Gesture sounds and effects and the Reaction ladder

Source agreement: parent issue
[#590](https://github.com/raymond-van/animama/issues/590) (R0–R7, owner
decisions 1–5 of 2026-10-16). The issue is the spec; this plan does not restate
it as a competing contract.
Authorized scope: the whole plan, Phases 1–4 (owner, 2026-10-16).
Branch: `feat/content-tuning-page`, in its own worktree, created at `fce7e92f`
(`origin/main`, 2026-10-16). One PR for the whole plan.

## Purpose and context

After this plan:

- An Included Gesture or Reaction can play a licensed WOW Sound comedy sound
  through a standalone `sfx` clip event. Where the `wow-comedy-sfx` pack isn't
  mounted (self-host, public source, desktop builds without the input), the
  item stays valid and offered in chat, and plays without that sound, as an
  effect's optional sound already does.
- `pnpm -s content:tune` (from `src/frontend/web`) opens a local, owner-only
  page. It lists every Included Gesture and every Reaction in a ladder grid
  (emotion × intensity). The owner can:
  - audition any sound in the vendor catalog;
  - add, remove, replace and retime effect and sound events;
  - set Reaction peak expression values;
  - adjust an Avatar Effect's per-use placement;
  - preview the result on Annie, with sound;
  - save straight into `content/included/`.
- Sounds picked from outside the shipped pack are reported as pending pack
  additions for the owner's separate publish step.

### Current state (inspected at `fce7e92f`)

**Clip sound events already exist.**
- `kind: "sfx"` events carry a `cueId` naming a `sound_effect` dependency
  alias and an optional `volume`. See `AnimaPoseClipSFXEvent` in
  `src/frontend/web/src/lib/avatar/poses/animaPoseClip/clipVocabulary.ts`,
  backend validation in `src/backend/animama/app/services/idle_clip_validation.py`
  and the dependency mapping in `content_package_capabilities.py`.
- The Action creator adds them from uploaded sounds.
- No Included Gesture or Reaction uses one. Included items get pack sounds
  only through an Avatar Effect's `soundAlias`.

**A pack-sound `sfx` edge on a Gesture is not graceful today.**
- *Backend:* `_OPTIONAL_SOUND_OWNERS` in
  `src/backend/animama/app/services/content_kind_registry.py` allows
  `optional: true` only on Avatar and Scene Effect sound edges. A Gesture's edge
  must therefore be required. Without the pack it stays unresolved, and catalog
  reconciliation marks the Gesture INVALID
  (`adapters/repositories/sqlalchemy/content_catalog_repo.py`).
- *Chat:* `RuntimeContentClosureCompiler`
  (`app/services/runtime_content_closure.py`) skips the invalid root, so the
  chat model is never offered the Gesture. Nothing crashes.
- *Browser:* if an unresolved `cueId` reached it,
  `AnimaRuntimeCatalog.normalizeLoadedClip`
  (`src/frontend/web/src/lib/runtime-content/AnimaRuntimeCatalog.ts`) would
  report `missing_event_reference` and drop the whole clip. Its
  removed-reference filter covers only the effect event kinds. A failed sound
  fetch, by contrast, is already logged and skipped
  (`AnimaRuntimeMediaCatalog.resolveAudio`, `SoundController`).
- *Export:* `content_package_export.py` strips optional non-portable sounds.
  `_clip_event_dependencies` would then reject a leftover `sfx` event that
  names the stripped alias.

**Effect sounds degrade cleanly, but the same approach can't be reused for clips.**
- `resolve_optional_dependencies` drops the optional edge and the
  descriptor's `soundAlias` at scan time.
- A clip's bytes are hash-verified, so the scan can't rewrite its events.
- The alias must instead be recorded as a runtime missing reference
  (`typed_runtime_projection.py` builds `missing_references` from the owner's
  missing dependencies and remaining edges) and skipped in the browser.

**Tools to build on.**
- `pnpm -s animation:preview` (`src/frontend/web/scripts/animation-preview.mjs`)
  is the headed precedent. It is a Vite server on loopback with a
  `/__preview/*` API plugin (state, select, SSE events, media, notes),
  trusted-origin CSRF checks, file watchers and an opened browser.
- The review stage (`scripts/effect-render/stage.ts`, `session.ts`) plays a
  clip with its effects on an Included Avatar. `EffectSession`'s `onSound` only
  reports `{cueId, volume, time}`.
- `scripts/animation-reel.mjs` already resolves `sfx` events and pack sound
  files (`<key>.meta.json` sidecars) and mixes them with ffmpeg.
- `scripts/effect-render-sources.mjs` provides `scanLibrary`,
  `resolveClipSource` and `resolveDependencies`.

**Writers of Included content.**
- `scripts/animation-promote.mjs` (Gestures) and `scripts/effect-promote.mjs`
  (effects; Gesture and Reaction replace) keep content IDs and `version`.
  Starter pools pin `version: 1`.
- They validate and compact clips, check dependencies with
  `scripts/included-dependencies.mjs` and format with prettier.
- `includedActionDependencies` requires every ref to be an Included
  `content_id`. Pack sounds aren't, so it refuses `sfx` events today.
- `effect-promote.mjs` already checks effect sound keys against
  `src/backend/animama/resources/wow-comedy-sfx-manifest.json`.

**Gesture bytes are baselined.** Changing any Included Gesture clip fails
`src/frontend/web/src/lib/avatar/motion-authoring/includedClipBaseline.test.ts`
until the slug is listed in `REBASELINED` and the baseline is rewritten with
`UPDATE_CLIP_BASELINE=1`.

**Reactions.**
- Reactions live in `content/included/reactions/<emotion>-<1..4>[-b]/`. The
  meta's `placement_hint` gives `{emotion, intensity}`.
- Each clip has one `peak` beat, `expressions` such as
  `{"happy":[{"v":0.75,"beat":"peak"}]}`, and effect events.
- The 24 emotions come from `src/backend/animama/domain/emotions.py`, mirrored
  in `src/frontend/packages/product-ui/src/lib/emotion.ts`.
- Starter pools are in `src/backend/animama/resources/starter-loadout.v1.json`.

**Placement controls.**
- `PoseCreatorAvatarEffectUseSection` and `useAvatarEffectUse`
  (`src/frontend/web/src/ui/pose-creator/PoseCreatorAvatarEffectUse.tsx`)
  render the Action creator's per-use controls through `AttachmentFields` and
  `AvatarEffectInspector`, which take props and a dispatch.
- The section needs a runtime snapshot (`avatarEffectUseSource` in
  `avatarEffectUse.ts`), the undo-grouping store and the `pose`/`effects` i18n
  namespaces.
- The full `EventInspector` is tied to the creator's store and preview
  provider, so the page reuses the section, not the inspector.

**Checks.**
- `pnpm -s effects check` covers effect sources only.
- `pnpm -s animation validate|check <clip>` checks clip schema and motion.
- `tests/test_included_content_integrity.py` enforces:
  - every emotion has a Reaction with an Avatar Effect;
  - audible effect events in a Reaction are at least 0.3 s apart;
  - one sound per Reaction start;
  - starter idles have no `sfx` events.
- `tests/test_included_content_catalog.py` requires every
  `builtin:sound-effect:` edge to resolve to a shipped sound or the pack
  manifest.

### Boundaries

- Licensed audio never enters Git, Docker contexts or public artifacts. The
  page reads the pack from `build-inputs/wow-comedy-sfx/` (or `--sounds`). It
  reads the vendor catalog from a directory the owner passes with `--catalog`
  or `ANIMAMA_WOW_SOUND_CATALOG`. It never copies audio into tracked paths.
  Tracked docs and tests name no machine paths.
- The page is a development script. It is not part of the web app bundle,
  Electron, hosted or self-host builds. It binds to 127.0.0.1 and applies
  `animation:preview`'s trusted-origin and CSRF checks to every write.
- Local content rules are unchanged (ADR 0022 decision 3). Licensed sounds stay
  out of the Library, the creators and exports.
- Publishing a new pack version stays a separate owner-confirmed step:
  manifest, `scan --git`, `verify`, `publish --confirm`. See
  `docs/backend/operations/comedy-sound-pack.md`.

## Progress

- [x] Phase 1: optional pack sounds for Included Gesture and Reaction `sfx` events. Done (2026-10-16): checks pass, Code Review #2 passed after one repair round. Hearing the sound in chat with the pack mounted is part of the owner's final check.
- [ ] Phase 2: read-only tuning page with catalog audition and preview. Not started.
- [ ] Phase 3: editing and saving events and Reaction expressions. Not started.
- [ ] Phase 4: per-use placement, docs and acceptance. Not started.
- [ ] Final integration review. Not started.
- [ ] Owner gates: live audio check of the page; pack publish for any new sounds. Not started.

## Surprises & Discoveries

- 2026-10-16 (agent): clips already support `sfx` events and the Action
  creator authors them. #590 was corrected from "add a new event kind" to
  "let Included items use pack sounds through `sfx` safely".
- 2026-10-16 (agent): a required pack-sound edge makes a Gesture INVALID and
  invisible to chat where the pack is absent. In the browser, an unresolved
  `sfx` cueId drops the whole clip. Phase 1 exists for this.
- 2026-10-16 (agent): the reel already mixes `sfx` event sounds
  (`animation-reel.mjs`), so R7 needs only pack-sound resolution for clip
  edges, not new mixing.

## Decision Log

- 2026-10-16, owner (#590): use the existing `sfx` event with optional pack
  edges; list the full vendor catalog; serve a local script page; write
  Included files directly; embed the Action creator's per-use controls for
  placement.
- 2026-10-16, owner (plan review): extend ADR 0022 by amendment rather than a
  new ADR, because the mechanism is the same (scan-time optional edges) and
  only the owner kinds widen.
- 2026-10-16, owner (plan review): this PR ships the mechanism and the page.
  Content edits the owner makes with the page ship in later PRs, so each can
  carry its own pack version and the full browser journeys that starter-pool
  Reaction changes need.
- 2026-10-16, owner (plan review): name the command `pnpm -s content:tune`,
  served from `src/frontend/web/scripts/content-tune.mjs` and
  `scripts/content-tune/`.
- 2026-10-16, owner: authorized Phases 1–4.

## Phased implementation

Phase issues (sub-issues of #590, each blocked by the previous):
[#592](https://github.com/raymond-van/animama/issues/592) (Phase 1),
[#593](https://github.com/raymond-van/animama/issues/593) (Phase 2),
[#594](https://github.com/raymond-van/animama/issues/594) (Phase 3) and
[#595](https://github.com/raymond-van/animama/issues/595) (Phase 4).
Workspace: this plan's worktree on `feat/content-tuning-page`; backend
environment from `uv sync --python 3.12.13`; frontend dependencies installed
and workspace packages built. No task stack runs yet. Phase commits use
`<type>(<scope>)[p#]: <summary>`, for example
`feat(content)[p1]: let Included actions play optional pack sounds`.

### Phase 1: Optional pack sounds for Included Gesture and Reaction `sfx` events

Requirements: R0, and the R7 sound resolution. Starting source: `fce7e92f`.
Working directories: repo root (backend) and `src/frontend` (web).

Intended changes:

1. **Registry.** In `content_kind_registry.py`, allow `optional: true` on
   `sound_effect` edges whose owner is a Gesture or Reaction. Keep the target
   restricted to `SOUND_EFFECT`. Local content still may not declare optional
   edges; catalog reconciliation already enforces this and needs a test.
2. **Scan.** When `resolve_optional_dependencies` drops an unavailable optional
   edge from a Gesture or Reaction, record each dropped `alias → ref` in the
   effective metadata. `typed_runtime_projection.py` then reports it in the
   item's `runtime_missing_references`. The revision marker continues to record
   the omission.
3. **Web runtime.** In `AnimaRuntimeCatalog.normalizeLoadedClip`, extend the
   removed-reference filter to `sfx` events by `cueId`. A clip whose sound was
   dropped then loads and plays its motion, expressions and effects silently.
   It does not report `missing_event_reference`. The skip is silent, as an
   effect's dropped sound is (Code Review #1, F4).
4. **Export.** Make package export of a built-in Gesture or Reaction drop `sfx`
   events whose optional non-portable sound it strips, and report them in the
   export review with the existing effect-sound wording. Export of built-in
   Actions remains allowed or refused exactly as it is today otherwise.
5. **Authoring scripts.**
   - `scripts/included-dependencies.mjs` (`includedActionDependencies`) and the
     promote scripts accept a `builtin:sound-effect:<key>` edge only when it is
     optional and `<key>` is in the pack manifest or flagged as a pending pack
     addition (Phase 3).
   - Edges are written with `optional: true`.
   - `effect-render-sources.mjs` and the reel resolve clip `sfx` edges to pack
     sound files.
6. **Integrity.**
   - `tests/test_included_content_catalog.py`: accept optional pack edges from
     Actions.
   - `tests/test_included_content_integrity.py`:
     - require every Action pack-sound edge to be optional;
     - count `sfx` events in the one-sound-per-Reaction-start and 0.3 s
       spacing rules;
     - keep starter idles free of `sfx` events.
   - `tests/test_optional_sound_dependencies.py`: replace the "Gesture optional
     edge is refused" assertion with Gesture and Reaction acceptance plus
     refusal for other owner kinds and Local content.
   - The pack-membership rule ("only sounds built-in content uses ship") counts
     Action edges.
7. **Docs.**
   - Amend ADR 0022 (decisions 1 and 2) to name Gestures and Reactions as
     owners of optional pack sounds through `sfx` events.
   - Update `docs/backend/operations/comedy-sound-pack.md` ("How effects use
     the sounds", "Adding or changing a sound") and the clip-event section of
     `docs/frontend/runtime/avatar-animation.md`.

Tests (write first, per behavior):
- *Backend scan:* an Included Gesture fixture with an optional pack-sound
  `sfx` edge is VALID and offered in the runtime closure with the pack, and
  without it. Without the pack, its projection lists the alias as a missing
  reference.
- *Web:* an `AnimaRuntimeCatalog` test loads that clip with the alias removed;
  the clip is returned, the `sfx` event is skipped, and the other events
  remain.
- *Export:* the export test drops the event and reports it.
- *Script:* the promote/dependency script unit test accepts an optional
  manifest key and refuses a required one or an unknown key.

Checks:

```bash
uv run pytest -q tests/test_optional_sound_dependencies.py tests/test_included_content_integrity.py tests/test_included_content_catalog.py
uv run pytest -q
uv run ruff check
make format-check
```

```bash
cd src/frontend && pnpm check && pnpm web:lint && pnpm web:test
cd src/frontend/web && pnpm test:source:unit
```

Manual evidence. Local content can't carry licensed sounds, so the check uses
an Included Gesture on a task stack, which has no pack by default:

1. Temporarily give one Included Gesture an optional pack-sound `sfx` event in
   the worktree only (reverted before commit).
2. `./reset.sh --name tune --base-port <B>`.
3. Confirm the Gesture is offered and plays silently in chat.
4. Mount the pack with the documented Compose override (comedy-sound-pack.md,
   "Reviewing the pack on a task stack") and confirm the sound plays.

Audio audibility is an owner check (the hidden browser pane plays no audio).
Agents verify the loaded clip and runtime diagnostics instead.

Recovery: the changes are additive to the optional-edge path. Reverting the
phase restores today's refusal. No database migration (`0001_baseline.sql`
unchanged).

Completion: the tests above pass, the review below has no open blocking
findings, and the manual evidence is recorded with stack URL and source.

Results (2026-10-16, working tree on `a7c090b2`):

- Implemented as planned. The scan records dropped edges as
  `provenance.optional_omitted` (alias → ref) for Gestures and Reactions only.
  Strict document parsing rejects unknown metadata fields, so provenance is
  the scan-derived place for them. `missing_references` merges them in.
- The Action creator also needed a change. Customizing a built-in Action now
  leaves licensed and omitted `sfx` events behind, matching ADR 0022's
  "copying a built-in effect leaves its sound behind". `removedActionEffects`
  no longer lists sounds as removed effects to repair.
- Checks:
  - `uv run ruff check` and `make format-check`: pass.
  - `uv run pytest -q -x -p no:randomly`: 4702 passed, 29 skipped.
  - `pnpm check` and `pnpm web:lint`: pass.
  - `pnpm web:test`: 533 files, 5225 tests pass. A first run failed 7 files
    because a failed `pnpm check` had left `@animama/runtime-contracts` half
    built; the rerun after the rebuild passed.
  - `pnpm test:source:unit`: pass.
- Stack evidence on `animama-tune` (`http://animama-tune.localhost:8800`, no
  pack mounted):
  - Arms Crossed was temporarily given an optional `bubble_pop_01` `sfx`
    event (reverted afterwards).
  - After `POST /v1/content:rescan`, all 557 Included items stayed valid.
    `GET /v1/animas/{id}/runtime` still offered Arms Crossed among 99
    Gestures, with `missing_references: {"pop": "builtin:sound-effect:bubble_pop_01"}`.
  - In chat, the live `AnimaRuntimeCatalog` loaded the edited clip
    (sha256 matched the file) with the `sfx` event skipped and no
    diagnostics.
- With the pack: `pnpm -s animation:reel` of the same Gesture with
  `--sounds <pack>` mixed one sound (peak −1.3 dB).
- Limitation: the with-pack check used the reel, not a stack with the pack
  mounted through a Compose override. The catalog's with-pack path is covered
  by `test_an_included_gesture_plays_without_its_absent_optional_sound`.
  Whether the sound is audible in chat is an owner check.


#### Code Review #1 Findings

An independent reviewer (read-only) reviewed the Phase 1 working tree on
`a7c090b2`, with a full initial review. Its checks:
- the four affected backend test files: 42 passed;
- the two changed Vitest files: 42 tests passed;
- the script tests: 47 passed;
- ruff: pass;
- `pnpm -s prettier:check`: failed on one Phase 1 file.

It verified:
- pack mount and unmount transitions;
- that `optional_omitted` stays out of exports;
- export with and without the pack;
- the customized copy;
- that Local non-portable refusal is unchanged.

Blocking:
- **P1-R1-F1:** `scripts/included-dependencies.mjs` failed Prettier.
- **P1-R1-F2:** no test covered a Local Gesture or Reaction declaring an
  optional edge. The parser now accepts one, so the reconcile guard is the
  only barrier.

Non-blocking:
- **P1-R1-F3:** a descriptor's own `provenance` could supply
  `optional_omitted`. That would add fake missing references and strip its
  own `sfx` events on export.
- **P1-R1-F4:** dropped `sfx` events are skipped without the diagnostic the
  plan described.
- **P1-R1-F5:** plan items changed in delivery:
  - `effect-render-sources.mjs` is untouched; the reel already resolves `sfx`
    edges.
  - `test_included_content_catalog.py` is unchanged.
  - Promote makes a required pack edge optional instead of refusing it.
  - A promote replace keeps existing edges, which the docs overstated.
- **P1-R1-F6:** a loose pack copy under `content/included` would make promote
  write a required edge.
- **P1-R1-F7:** three comments still described missing references and
  optional edges as effect-only.
- **P1-R1-F8:** `docs/frontend/runtime/sound.md` was not updated, and the
  ADR's "likewise" implied a note on copy.

#### Code Review #1 Revisions

- **F1, accepted:** fixed. Prettier passes on every changed Phase 1 script
  and source file.
- **F2, accepted:** added
  `test_a_local_gesture_cannot_declare_an_optional_sound`.
- **F3, accepted:** moved `OPTIONAL_OMITTED_KEY` to
  `domain/content_catalog.py`. `effective_provenance` now drops a
  descriptor's value, as it does for `distribution`. Test:
  `test_only_the_scanner_records_omitted_optional_edges`.
- **F4, accepted as a recorded decision:** a build without the pack is
  expected, so the skip stays silent, as an effect's dropped `soundAlias` is.
  The Phase 1 evidence used the live catalog's loaded clip and diagnostics
  instead.
- **F5, accepted:**
  - Recorded in Results.
  - Writing pack edges as optional, rather than refusing required ones, is
    deliberate: authors never choose optionality.
  - `comedy-sound-pack.md` now says a replace keeps existing edges, and the
    integrity test catches a required one.
- **F6, accepted:** `packSounds` is checked before `includedTypes`. Test:
  "keeps a pack sound optional when a loose copy is Included too".
- **F7, accepted:** comments updated in `contracts/runtime_content.py`,
  `content_kind_registry.py` and `content_catalog_repo.py`.
- **F8, accepted:** updated `sound.md`, and the ADR now says customizing
  drops the events without a note.

Rechecks:
- the five affected backend test files: 53 passed;
- the script tests: 48 passed;
- ruff check and format: pass;
- Prettier on the changed Phase 1 scripts and sources: pass.

Docs are not Prettier-formatted at baseline, so no doc formatting gate
applies. Repair budget: one round used, one left.

#### Code Review #2 Findings

This was a targeted recheck by the same independent reviewer, for repair
round 1. It verified F1–F3 and F5–F8 as fixed, and F4 as recorded. The fixes
introduced no regressions: no import cycle from the domain constant, and the
pack mount and export paths are unchanged. No new findings. Result: **pass**.

Its checks:
- five backend test files: 53 passed;
- `ruff check` and `make format-check`: pass;
- Prettier on the changed scripts: pass;
- script tests: 48 passed.

### Phase 2: Read-only tuning page with catalog audition and preview

Requirements: R1, R2, R3, and the read side of R4. Depends on Phase 1 for
pack-sound resolution in clips. Working directory: `src/frontend/web`.

Intended changes:

1. **Server.** Add `scripts/content-tune.mjs` (`pnpm -s content:tune`),
   modelled on `animation-preview.mjs`:
   - a Vite server on 127.0.0.1 with an API plugin under `/__tune/*`;
   - trusted-origin and CSRF checks on non-GET routes;
   - opens the browser.

   Options: `--avatar annie|caitlyn` (default annie), `--sounds <dir>`
   (repeatable; default `build-inputs/wow-comedy-sfx`), and `--catalog <dir>`
   or `ANIMAMA_WOW_SOUND_CATALOG`.

   Without a catalog, the page lists only pack sounds and says how to pass
   one. Without the pack, it plays nothing and says so. Neither is fatal.
2. **Catalog read model.**
   - Use `scanLibrary`/`resolveClipSource`/`resolveDependencies` for every
     Included Gesture and Reaction: its events (effects and `sfx`) and, for
     Reactions, `placement_hint` and `expressions`.
   - Read the full effect library (Avatar, Particle, Scene) for pickers.
   - *Sound catalog:* walk the vendor directory (subfolders are categories) and
     derive keys from vendor file names (`AC_Funny_Sweat_02.ogg` →
     `funny_sweat_02`), as the pack does.
   - Mark keys present in `wow-comedy-sfx-manifest.json` as shipped.
   - Serve audio bytes by key through `/__tune/sound/<key>`. Key-to-path
     resolution stays server-side; reject any key outside the catalog.
3. **Page** (`scripts/content-tune/`). Use React with the app's theme and
   shared components where they fit; no new visual language.
   - *Gesture list:* searchable. Each row shows effects, sounds and timing.
   - *Reaction ladder:* a grid of 24 emotions × 4 intensities with the `-b`
     second Reaction. Each cell shows peak expression values, effect chips by
     kind and sound. Cells that break the documented ladder (expression; +
     Avatar Effects; + Particle; + Scene) are flagged, for information only.
   - *Sound picker:* grouped by vendor category, with a play/stop control on
     every entry, a "shipped" badge and keyboard navigation.
   - *Preview:* an `EffectSession` stage, as the review stage uses it, on the
     chosen Avatar. Its `onSound` callback plays the resolved audio through the
     page's `AudioContext`, so the clip is heard in sync. Play, stop and replay
     controls.
4. Wire `package.json` and add `scripts/content-tune.test.mjs`. Add a
   Playwright browser smoke test (`content-tune.browser.test.mjs`) modelled on
   `animation-preview.browser.test.mjs`. It uses a fixture sound root with
   generated tones, never licensed audio.

Checks:

```bash
cd src/frontend/web && pnpm test:source:unit
cd src/frontend/web && node --test scripts/content-tune.browser.test.mjs
cd src/frontend && pnpm check && pnpm web:lint
```

Manual evidence:
- Desktop viewport first: open `pnpm -s content:tune --catalog <dir>`, list
  counts (152 Gestures, 168 Reactions at `fce7e92f` plus later content), and
  audition several catalog sounds.
- Preview one Gesture and one Reaction on Annie.
- Audibility is an owner check.

Completion: the read model's counts match `content/included`, previews play
with sound dispatch logged, tests pass, and the review is complete.

Results and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 3: Editing and saving events and Reaction expressions

Requirements: R4, R5 (add, remove, replace, retime), R6, plus pack-addition
reporting. Depends on Phase 2.

Intended changes:

1. **Editing.** Edits apply to an in-memory draft per item with undo, and the
   preview reflects the draft:
   - add, remove and replace effect events (Avatar, Particle, Scene; pickers
     from the effect library) and `sfx` events (catalog picker);
   - edit event time, duration (effects) and volume (sounds);
   - on Reactions, edit peak values for existing expressions and add or remove
     expressions from the clip vocabulary's expression set.
2. **Saving** (`POST /__tune/save`):
   - Validate and compact the clip with the existing clip validation, and
     rebuild meta dependencies from the events: add edges for new aliases and
     drop edges no event uses. Pack sounds are written as optional
     `builtin:sound-effect:<key>` edges.
   - Keep `content_id`, `version`, the clip `id`, `role`, `playback` and
     `loop`.
   - Format with prettier and write `content/included/{gestures,reactions}/<stem>/`.
   - For Gestures, record the slug for re-baselining; after saving, the page
     prints the
     `UPDATE_CLIP_BASELINE=1` command, or runs it when `--rebaseline` is
     passed.
   - Reuse the promote scripts' writer and validation functions (extract
     shared helpers where needed) rather than duplicating them.
   - Before writing, run the integrity rules that can be checked offline in
     JS: the one-sound-per-Reaction-start rule, 0.3 s audible spacing, and
     starter idles without `sfx`. Refuse with a clear message on violation.
   - Refuse a save when the file changed on disk since it was loaded. The file
     watcher refreshes the page instead.
3. **Pending pack additions.**
   - Keys used in saved content but missing from the pack manifest are listed
     in the page and printed by `pnpm -s content:tune --pending`, with their
     vendor source file names.
   - Staging them into `build-inputs/` and publishing remain the documented
     owner steps. Until they're done, `tests/test_included_content_catalog.py`
     fails by design, which keeps such content from merging unpublished.
4. Tests:
   - unit tests for draft-to-files (dependency rebuild, optional pack edges,
     preserved identity fields, conflict refusal, integrity refusals);
   - a browser smoke test that edits a fixture copy of the Included tree
     (`--content-root <tmp>`) and asserts the written files.

Checks: as Phase 2, plus the backend integrity tests against the
manual-evidence edits below, before they are reverted:

```bash
uv run pytest -q tests/test_included_content_integrity.py tests/test_included_content_catalog.py
```

Manual evidence:
1. In the worktree, change one Gesture's sound, one Gesture's effect (replace)
   and one Reaction's peak expression and effects with the page.
2. Inspect `git diff`, then run the backend integrity tests and
   `pnpm -s animation:reel` on those items.
3. Revert the content edits before committing the phase (see the Decision
   Log: content edits ship separately).

Completion: saved files round-trip (reload shows the saved draft), checks pass,
and the review is complete.

Results and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

### Phase 4: Per-use placement, docs and acceptance

Requirements: the placement part of R5, R7, and the documentation. Depends on
Phase 3.

Intended changes:

1. **Placement.** Embed `PoseCreatorAvatarEffectUseSection` for a selected
   Avatar Effect event. Supply:
   - a local adapter: a runtime snapshot whose `avatar_vfx` entries carry
     their `definition`, fed to `avatarEffectUseSource`;
   - a minimal preview-context provider;
   - the undo-grouping store;
   - the `pose` and `effects` i18n namespaces.

   Overrides save into the event's `override`, as the Action creator writes
   them (ADR 0025).

   If the barrel imports pull in router or React Query code, import the
   section's modules directly or split the barrel. Do not stub the app
   router.
2. **Docs.**
   - Add a short "Tuning Included content" section to
     `docs/frontend/runtime/avatar-animation.md`: the command, options,
     catalog and pack inputs, what saving writes, re-baselining, pending pack
     additions and the follow-on checks (reel, integrity tests, browser
     journeys for starter-pool Reactions).
   - Link it from `docs/frontend/runtime/avatar-vfx.md` where the reel is
     described.
3. Tests: a unit test for the adapter (an override written by the section
   round-trips into the saved clip).

Checks: full frontend and backend suites as listed under Validation.

Owner gates:
- The owner runs the page with the vendor catalog and the pack. They confirm
  audition, preview audio, editing, placement and save on desktop, then a
  narrower window.
- Any content edits follow the separate content PR path.

Results and commits: _pending_.

#### Code Review #1 Findings

_Pending._

#### Code Review #1 Revisions

_Pending._

## Final integration review

The final review covers R0–R7 across all phases:
- the graceful no-pack path end to end;
- that no licensed audio or private path is tracked
  (`pnpm desktop:private-pack --pack wow-comedy-sfx scan --git`);
- that the page is absent from `pnpm build` output and desktop staging;
- the docs.

It reuses still-valid phase evidence. Results: _pending_.

## Validation and acceptance

Acceptance is #590's checklist. Commands for the candidate:

```bash
uv run pytest -q
uv run ruff check
make format-check
```

```bash
cd src/frontend && pnpm check && pnpm web:lint && pnpm web:test && pnpm build && pnpm desktop:check
cd src/frontend/web && pnpm test:source:unit
cd src/frontend && pnpm desktop:private-pack --pack wow-comedy-sfx scan --git
```

The PR changes no Included content, so the full `pnpm e2e:test` is not
required for it. `pnpm e2e:test:fast` is not needed either, because the
product UI is unchanged; record the Phase 1 chat check instead. Content PRs
made with the page need the full journeys when they touch starter-pool
Reactions or loadouts.

Outstanding manual checks: the owner's live audio check (Phase 4) and the
Phase 1 stack check with and without the pack.

## Idempotence and recovery

- `content:tune` writes only `content/included/{gestures,reactions}` (or
  `--content-root`), and only on explicit save. `git restore` undoes any save.
- A save refuses when the file changed on disk, so concurrent edits (another
  editor, a promote script) are not overwritten.
- Phase 1 needs no data migration. Existing stacks rescan Included content on
  reset. A stack that scanned before the change picks up the new effective
  metadata on its next Included scan.
- Task stacks started for evidence are named (`--name tune`) and torn down
  after the phase's last use.

## Outcomes & Retrospective

_Pending._
