# Make `animaPoseClip/2.0` the only clip format

Source agreement: issue #337 (authoritative scope, phases and acceptance) and
the owner's dated task instruction of 2026-10-08 (below).
Authorized scope: all phases (1–5), subject to the explicit gates G1–G3.
Starting revision: `fd1980fec7ae950ec84fcc9db21379bc0bc34f74` (`origin/main`).
Branch: the task worktree's generated branch was renamed to
`refactor/clip-format-v2-only` (an unused, empty `refactor/clip-format-2-only`
already existed in another worktree and was left alone). One branch and one PR
(`Closes #337`); phase commits use `refactor(<scope>)[p#]: …`. Phase
sub-issues of #337: #356 (P1), #357 (P2), #358 (P3), #359 (P4), #360 (P5). A
parallel session's earlier phase issues #339–#343 were closed as not planned.

## Purpose and context

Today 27 Included Gestures are `animaPoseClip/2.0`; 16 Gestures and all 72
Reactions are still `animaPoseClip/1.0`, and the frontend runtime, creators,
previews, backend validation and package import all carry a full 1.0 path. After
this plan:

- every Included Gesture and Reaction is stored as 2.0 and plays as before;
- the 1.0 schema, sampler, converter and runtime-only internal poses are gone;
- a 1.0 clip met anywhere (runtime catalog, creator open, import, Local scan,
  package import) is rejected with a clear message, never converted;
- docs, the `animama-animation` skill and an ADR describe 2.0 as the only format.

`animaPose/1.0` (standalone Poses) is a separate format and stays untouched.

Commands run from the repository root unless a working directory is stated. No
Cloud checkout is needed.

### Owner decisions (2026-10-08, task instruction)

- No 1.0 clip content exists outside development environments; 1.0 clips are
  rejected with a clear error, never converted.
- Keep the schema name `animaPoseClip/2.0`; the `animaPoseClip/1.0` string is how
  old files are identified and rejected.
- `animaPose/1.0` stays.
- Converted clips become beats with rotation tracks (not anatomical joint
  tracks); they play the same, and that trade-off is accepted.
- Journeys: `pnpm e2e:test:fast` during the work, full `pnpm e2e:test` before
  merge, on a disposable built stack.

### Implementation orientation

Paths under `src/frontend/web/src/` unless stated; line numbers are from the
starting revision.

| Area | Entry point and significance |
| --- | --- |
| Converter | `lib/avatar/poses/animaPoseClip/convertV2.ts` `convertAnimaPoseClipToV2(clip, resolvePose)`: one beat per keyframe, rotation/hips-position/expression tracks keyed at every beat, loop seam reproduced with a `hold` beat, unreplaced fields (role, playback, events, fades, mutes, unknown fields) kept. `convertV2.test.ts` proves every Included 1.0 clip converts within 0.01°, 0.1 mm and 0.001 weight by sampling 1.0 and prepared 2.0 at 120 Hz across one cycle (two for loops). |
| Shared vocabulary | `animaPoseClip/schema.ts` mixes 1.0-only code (`ANIMA_POSE_CLIP_SCHEMA`, `AnimaPoseClip`/`Pose`/`Keyframe`/`Ref`, `parseAnimaPoseClip`, `sanitizeAnimaPoseClip`, `isAnimaPoseClipRef`, `isAnimaPoseSnapshot`, `sanitizePoseSnapshot`, `KNOWN_CLIP_FIELDS`) with vocabulary 2.0 uses: bytes/decimals/rounding/`serializeAnimaPoseClipFile`, layer mutes, role and playback lifetime, easing/interpolation/transition/fade types and sanitizers, event types and sanitizers (:188–263, :640–1057), sample/resolver/diagnostic types, `DEFAULT_ANIMA_POSE_CLIP_TRANSITION`, `ANIMA_POSE_CLIP_EPSILON`, `QuaternionTuple`/`VectorTuple`. |
| 1.0-only modules | `sampling.ts` (whole file), `convertV2.ts`, `program.ts` `createV1Program`, `anyClip.ts` fall-through to the 1.0 parser (unknown schemas currently throw "Invalid animaPoseClip/1.0 payload"), `channels.ts` keyframe branch and `resolveClipPoseSnapshot`, `playback.ts` keyframe-extent and `defaultTransition` fallbacks. `events.ts` and `interpolation.ts` are shared. |
| Built-in catalog | `lib/avatar/poses/catalog.ts`: eager globs of `content/included/{gestures,reactions}/*/*.json`; Reactions are parsed **only** as 1.0 (`:233–307`), so they cannot be 2.0 until this changes. Internal poses `json/internal-poses/*.json` (21) merge with `pose_catalog.generated.json` (`relaxedRest` plus four Starter Poses, generated from `content/included/poses`) into `AVATAR_POSE_CATALOG`. `collectMissingClipPoseRefs` (:357). |
| Runtime and preview | `lib/runtime-content/AnimaRuntimeCatalog.ts` `fetchClip` (:1006, unknown schema recorded as `invalid_motion_manifest`, surfaced by `ChatInterface.tsx:594`); `PoseController.ts`, `ReactionClipPlayer.ts`, `AvatarPlanner.ts`, `reactionClips.ts` are schema-agnostic through `AnyAnimaPoseClip`. `lib/content-preview/posePreviewTarget.ts:36–47` builds a 1.0 held clip to preview a standalone Pose. `scripts/effect-render/render.ts:161` samples with the 1.0 sampler (crashes on 2.0). |
| Creator | `ui/pose-creator/poseCreatorClipAuthoring.ts` (draft keeps a 1.0 `poses`/`keyframes` view beside the always-present `motion`; 1.0 build, bake, convert-on-open and ref validation), `poseCreatorClipMotion.ts:374`, `stores/pose-creator-store.ts` (motion branch plus 1.0 else-branch in about eleven actions, 1.0 helpers :1040–1075, :1152, :1324, :1349), `ui/action-editor/{actionDocument,actionPersistence,actionProject,actionDocumentLoader}.ts`, `ActionTimelineEditor.tsx:46–68,205–239`, `ActionEditorWorkspace.tsx`. `actionDocument.ts:89–113` creates new documents with a 1.0 empty sequence. `actionDocumentLoader.ts` `ownedSequence` returns raw JSON without schema validation and `ActionTimelineEditor` swallows parse errors, so a 1.0 file opens silently empty. |
| Motion authoring | `lib/avatar/motion-authoring/preview/sources.ts` (accepts 1.0, `PLAYABLE_SCHEMAS`), `checks.ts:164,254`, `cli.ts:390`. |
| Fixtures | `lib/avatar/poses/fixtures/starter-clip-samples-before-reduction.json` (SHA-256 sample hashes of the 16 remaining 1.0 Gestures; consumed by `catalog.content.test.ts:184–212`, maintained by `web/scripts/animation-promote.mjs`). `animaPoseClip/fixtures/compatibility-valid.json` (1.0, also used by backend `tests/test_content_package_capabilities.py:262`). `starter-inventory-before-content.json` and `content-compatibility-valid.json` are Pose fixtures and stay. |
| Backend validation | `src/backend/animama/app/services/`: `idle_clip_validation.py` (1.0 validator `_pose` :93–125 and `validate_idle_clip_timeline` :231–278; the rest is shared with 2.0), `idle_playback.py:87–100`, `content_package_capabilities.py` (`BUILTIN_POSES` :53–58, `SUPPORTED_CAPABILITIES` :64–79 including `animaPoseClip/1.0` and `animama/builtin-pose/1/*`, `_clip` :500–561 with the 1.0 ref/basePose capability rule :555–561; 2.0 still needs `_builtin_pose` for `basePose`). |
| Retired `pose_clip` kind | Standalone `pose-clips/` items only ever accepted 1.0: `content_kind_registry.py:165–177,775,843–860` (`PoseClipDocumentV1`), `domain/content_documents.py:88–97`, `action_clip_transition.py` (copies a 1.0 pose clip's bytes verbatim into the owning Local Action), `included_action_transition.py:105`, `content_transition_service.py:331–336` (copies a pose-clip idle lane into an owned clip). `server/schemas/typed_content.py:176` and `server/routers/typed_content.py:385` replay retired receipts and routes. |
| Backend scan and import | Local scan (`adapters/content_store/filesystem_store.py` `scan` :575, `_descriptor_entry` :338) only checks that a clip companion is a JSON object: a 1.0 or garbage-schema Gesture/Reaction clip is admitted VALID today. Hook: `ContentTypeHandler.validate_companion_files` (`content_kind_registry.py:1177`), which runs per scanned descriptor, on Save and under `inspect_package_tree`. Package import: `ContentPackageArchive.inspect` → `validate_declared_capabilities` (precedent: avatar-effect/1 raises `CONVERSION_REQUIRED` with `PACKAGE_CONVERSION_HINT`, `content_package_capabilities.py:229`), router `server/routers/content_packages.py:85–103` returns a `message` only for that code. |
| Included rehash | Startup rescans hash every file (`filesystem_store.py` `_entry_revision`); rewritten Included clips get a new revision without version bumps. Transition receipts key on item revision, so changed Included items may re-run their transitions once. |
| Licence records | `content/included/licenses/inventory.json` (glob rules, no hashes; converted files stay under their existing rules) and `licenses/source-review.json` (per-path records: `path`, `candidate_license`, `basis`, `copyright`, `review`; validated by path set in `scripts/public-release/prepare_source.py`). In-place rewrites keep their path; deleted files must lose their record. |
| Other consumers | `lib/content/fixtures/package-capabilities.json` `builtinPoses` must equal `AVATAR_POSE_CATALOG` keys (`packageCapabilities.compatibility.test.ts`). `tests/fixtures/idle-playback-cases.json` (44 of 85 cases are 1.0) is shared with frontend `AnimationManager.test.ts` and `IdlePlaybackContract.test.ts`. e2e: `helpers/imported-playback.ts:160–185`, `journeys/accountless-numeric-input.spec.ts:43`, `journeys/accountless-creator-generated-gesture.spec.ts` (step "Open the 1.0 clip as beats"). |

No backend projection emits `runtime_catalog` sources or internal-pose ids
(`runtime_catalog` sources are rejected as non-portable), which answers the
issue's open question: only the Included 1.0 clips reference internal poses
(15 Gestures by `ref`, `double-thumbs-up/down` by `basePose`).
`src/backend/animama/resources/animation-manifest.json` names three internal
poses as `base_pose`, but nothing reads that field.

## Progress

- [x] Preparation: workspace verified, plan drafted (this file).
- [x] Phase 1: Included conversion (#356). G1 passed and reviews #1–#2 passed on 2026-10-08.
- [x] Phase 2: Local migration tool (#357). G2 done (all dry runs found 0); reviews #1–#2 passed.
- [x] Phase 3: Frontend 1.0 removal and rejection (#358). Reviews #1–#2 passed; fast journeys 36/36.
- [x] Phase 4: Backend 1.0 removal and rejection (#359). Reviews #1–#3 passed.
- [x] Phase 5: Docs, skill and ADR (#360). Reviews #1–#2 passed.
- [ ] Final integration review passed, full journeys 38/38, agent live checks done; G3 owner acceptance and merge approval pending.

## Surprises & Discoveries

- 2026-10-08: Local scans never validate a Gesture/Reaction clip's schema, so a
  1.0 (or garbage) clip is admitted VALID today. Phase 4 adds the first scan-time
  clip-format check.
- 2026-10-08: the retired `pose_clip` kind and its two transitions only handle
  1.0. Keeping them would publish 1.0 bytes into Actions that are then rejected.
- 2026-10-08: the internal poses are not only 1.0 ref targets (D2 promotes them). They are also
  `AVATAR_POSE_CATALOG` entries, so they appear as runtime pose states, in the
  debug modal's pose list, and as base/parent choices in the Pose creator
  (`AVATAR_POSE_IDS`). They are also package `builtinPoses` capabilities. No
  Included or 2.0 content references them.
- 2026-10-08: `scripts/effect-render/render.ts` samples with the 1.0 sampler,
  which crashes on 2.0 clips. It switches to `createAnimaPoseClipProgram`.
- 2026-10-08: `tests/fixtures/typed_content/golden-action-closure.v1.json` is a
  1.0 fixture that no test reads.
- 2026-10-08: no `animaPoseClip/1.0` file exists in any Local content root on the
  owner's development machine: the main checkout, six named-stack roots under
  `.animama-stacks/*/content/local`, and the desktop app's data directory and its
  four backups (`grep -rlE 'animaPoseClip/1\.0'` returned 0 for each). One of
  the stacks (`animama-flake336`) was removed by its own task before Phase 2, so
  the Phase 2 dry runs cover five stack roots.

## Decision Log

- 2026-10-08, owner (task instruction): the decisions listed under Owner decisions.
- 2026-10-08, owner (D1, accepted agent proposal): **delete the retired
  `pose_clip` transitions** (`action_clip_transition.py`, the
  `included_action_transition.py` POSE_CLIP path and the
  `content_transition_service.py` pose-clip lane branch). Keep the retired kind's
  recognition so a leftover `pose-clips/*.json` file is listed INVALID with the
  unsupported-format message rather than vanishing. Keep the receipt replay for
  retired Saves (`legacy_saved_content_response`), which has no schema dependency.
- 2026-10-08, owner (D2): **promote the 21 internal poses to Included Poses**
  (`content/included/poses/<id>/<id>.json`), deliberately reversing the
  2026-09-22 poses-as-content decision that kept them as hidden runtime
  dependencies outside the Library. They become visible Library and picker
  content under the existing owner-authored `poses/**/*.json` licence rule, with
  their ids and values unchanged (six get Library names, below). The Gesture creator's Poses tab picker
  gains a **"Show Included" checkbox, off by default**. Agent interpretation: it
  hides all Included Poses (the five Starter Poses as well) in that picker only;
  the Library is unaffected. `BUILTIN_POSES` / `builtinPoses` keep the same 26 ids,
  now all sourced from Included content.
- 2026-10-08, owner (D3, accepted): rejection wording, the same in frontend and
  backend: *"This clip uses the retired animaPoseClip/1.0 format, which is no longer
  supported. Only animaPoseClip/2.0 clips can be played, edited or imported."*
  Code `clip_format_unsupported`. Unknown schemas get the generic form naming the
  schema.
- 2026-10-08, owner (D4, accepted): update the `basis` of each rewritten Included
  clip's source-review record by appending *"; format-converted from
  animaPoseClip/1.0 to 2.0 without motion changes (#337)"*. Leave meta files and
  inventory rules unchanged. Remove the records of deleted tracked files, and add
  records for the 21 promoted Pose files (same basis as the existing Starter
  Poses).
- 2026-10-08, owner (G2 default accepted): dry-run the Local migration on every
  Local root found on the development machine and write only if a dry run finds
  1.0 files.
- 2026-10-08, agent (adopted from a parallel session's findings, relayed by the
  owner): after conversion, drop rotation and hips-position tracks that only hold
  the base pose's value, because 2.0 playback takes untracked bones from
  `basePose`. Motion is unchanged (verified), and Gestures shrink from 6.8–22.5 KB
  to 2.1–16.9 KB.
- 2026-10-08, agent: promoted Poses keep their ids and values. Six get Library
  names in the Starter style: `cat-monster-rawr` "Cat Monster Rawr 1" (both
  variants were named "Cat Monster Rawr"), `cat-monster-rawr-2` "… 2",
  `cheeky-finger-guns` "Cheeky Finger Guns 1", `soldier-salute` "Soldier Salute
  1", `right-face-palm` "Right Face Palm" and `thinking-hand-on-chin` "Thinking
  Hand On Chin". These renames are part of G1.
- 2026-10-08, owner (Phase 1 review F2): accept `finger-heart-pose` as
  converted. Its 2.0 blink track holds 0 for about 1 s (115 of 163 samples)
  where 1.0 left blink undriven, so auto-blink and emotion eye weights are
  suppressed there. 2.0 cannot express an undriven span. The alternative,
  dropping the track, would lose the 0.25 squint accent.
- 2026-10-08, agent: one conversion script with two modes (`--included`,
  `--local-root <dir>`) rather than two scripts. It reuses the converter through
  Vite SSR like `web/scripts/animation.mjs`, and is deleted with the converter in
  Phase 3.

## Preparation (workspace setup)

- Worktree `worktrees/animama/animaposeclip-2-refactor-69e911`, branch
  `refactor/clip-format-v2-only` at `fd1980fe`, clean.
- Run `git lfs pull` (avatar files) and `uv sync --python 3.12.13` if the venv is
  missing, then `pnpm install` in `src/frontend`.
- The journey stack is started only for journeys (Phase 3 onward):
  `ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name clipv2 --base-port 8600`.
  Stop it with project-scoped commands at the end. Other tasks' stacks
  (`animama-flake336`, `animama-hosted-*`) are not touched.

## Phased implementation

### Phase 1: Included conversion

Requirements: issue scope item 1, acceptance 1–2. Depends on: nothing.

Steps:

1. Add the temporary `src/frontend/web/scripts/clip-format-convert.mjs` (run as
   `pnpm -s animation convert-v1`, through `animation.mjs`'s Vite SSR loader) and
   `scripts/clip-format-convert/convert.ts`. The script resolves refs through
   `getResolvedAvatarPose`, converts with `convertAnimaPoseClipToV2`, prunes
   tracks that only hold the base pose's value, and saves through
   `compactClipFile`. It measures equivalence two-sided with
   `measureAnimaPoseClipConversion` (moved from `convertV2.test.ts` into
   `convertV2.ts`). Modes: `--included [--dry-run]`,
   `--local-root <dir> [--dry-run]` (Phase 2) and `--verify <rev>`.
   It refuses to write any clip whose error exceeds 0.01°, 0.1 mm or 0.001 weight,
   that drives a channel 1.0 left undriven (beyond one sample per cycle, or an
   owner-accepted exception), or whose id, name, loop flag, Reaction `role`,
   `playback`, `events` or `mutedProceduralLayers` change. It leaves
   `*.meta.json` untouched. Each run prints one line per clip (id, beats, bytes
   before and after, maximum errors, added channels); a dry run writes nothing.
2. Run `convertV2.test.ts` and `catalog.content.test.ts` (sample hashes) on the
   untouched tree, then the dry run, then the conversion.
3. `catalog.ts` parses Reactions with `parseAnyAnimaPoseClip`, and the Reaction
   humanoid filter reads 2.0 tracks, so 2.0 Reactions load. Types widen to
   `AnyAnimaPoseClip` where needed.
4. Run `--verify fd1980fe`: it reads each original with `git show`,
   samples it with the 1.0 sampler and samples the stored 2.0 file. The equivalence
   evidence is then pinned to the committed bytes. In `catalog.content.test.ts`,
   the sample-hash test is replaced by this recorded verification. The 1.0 sampler
   cannot hash-match 2.0 sampling, and the fixture is deleted in Phase 3.
   `convertV2.test.ts`'s Included cases become no-ops (no 1.0 Included clips
   remain); its synthetic cases stay until Phase 3.
5. **Promote the internal poses (D2).** For each
   `json/internal-poses/<id>.json`, write
   `content/included/poses/<id>/<id>.json` as a `content_type: "pose"` document
   in the Starter Pose layout (`content_id`/`name` from the pose), regenerate
   `pose_catalog.generated.json` (`pnpm poses:generate`), and delete
   `json/internal-poses/` and its glob in `catalog.ts`. The resolved values must be
   identical (the existing internal resolved-value parity test, re-pointed at the
   generated catalog). Update the five-Pose boundary pins:
   `catalog.content.test.ts` `RETAINED_INTERNAL_POSE_IDS`, the
   `starter-inventory-before-content.json` consumers, backend
   `tests/test_pose_content.py` and the staging inventory counts.
6. Update source-review `basis` per D4. Prepare the **content diff summary** for G1:
   counts, per-clip byte sizes, maximum errors, and confirmation that meta,
   inventory and the starter loadout are unchanged.

Checks: `pnpm -C src/frontend/web exec vitest run src/lib/avatar src/lib/runtime-content tests/avatar`,
backend `uv run pytest -q tests/test_included_content_catalog.py tests/test_idle_playback.py tests/test_content_package_capabilities.py`,
`pnpm -C src/frontend web:lint` on the touched files, and a visual check of a few
converted Gestures in the creator against `main` (`:3000`).

**Gate G1 (owner):** sign-off on the content diff summary and the source-review
updates before the converted content is committed.

Completion: 43 Gestures and 72 Reactions are 2.0, verified, and the 21 Poses are Included, with G1 signed off.
Commit `refactor(content)[p1]: convert Included clips to animaPoseClip/2.0`
(includes the Pose promotion and this plan).

#### Phase 1 record

Starting revision `fd1980fe`. Issue #356.

Two-sided verify after Review #1: 88 verified, 0 failed. `finger-heart-pose`
drives blink on 115 samples where 1.0 did not (owner-accepted, see the Decision
Log). `double-peace-pop`, `heart-hands-build`, `shy-finger-poke` and
`soldier-salute` drive expressions at the single t=0 sample only, where the
1.0 first keyframe omits them; the fade-in weight there is 0. 27 Reactions
with a 1.0 timeline duration of 0 now declare `duration: 1`. All 72 use
`whileInteractionPhase` lifetimes with one beat, so playback is unaffected;
only reported durations (`timelineDurationSec`, preview `durationSec`) change.

- Script: `pnpm -s animation convert-v1 --included [--dry-run]` and
  `--verify <rev>` (`src/frontend/web/scripts/clip-format-convert.mjs`,
  `scripts/clip-format-convert/convert.ts`). The equivalence sampler moved from
  `convertV2.test.ts` into `convertV2.ts` as `measureAnimaPoseClipConversion`, and
  a missing bone or expression now counts as an infinite error.
- Before conversion: `convertV2.test.ts` and `catalog.content.test.ts` (including
  the 16 pinned 1.0 sample hashes) passed on the untouched tree (103 tests).
- Conversion: 88 converted, 0 failed. A rerun dry run reports 0 to convert.
  `--verify fd1980fe`: 88 verified, 0 failed. Maximum errors over all clips:
  0.00087° rotation, 0 mm position, 0 expression weight.
- Sizes: 16 Gestures 31,475 → 111,899 bytes (2.1–16.9 KB each; beats as rotation
  tracks, per the accepted trade-off). 72 Reactions 64,225 → 56,445 bytes.
- No `*.meta.json`, `content/included/licenses/inventory.json` or loadout change
  (`git diff fd1980fe --stat -- '*.meta.json' content/included/licenses` is
  empty).
- Promoted Poses: 21 `content/included/poses/<id>/<id>.json` files.
  `pose_catalog.generated.json` was regenerated (`pnpm poses:check` passes) and
  `json/internal-poses/` was deleted. The resolved values of all 26 Poses match
  the `starter-inventory-before-content.json` hashes (`catalog.content.test.ts`).
- `catalog.ts` parses Reactions with either schema until Phase 3.
- Tests: `includedGestures.test.ts` validates and size-checks the 16 converted
  Gestures but exempts them from the authoring motion checks. 11 fail them
  (capsule intersections, joint ranges) because the hand-made poses touch the
  body on purpose; the motion is unchanged. `actionDocumentLoader.test.ts` now
  expects a 2.0 Starter Reaction. Backend Pose-boundary tests use a shared
  `INCLUDED_POSE_IDS`.
- Source review: the `basis` of the 88 rewritten files' records gains the D4
  suffix. `licenses/source-review.json` (reviewed 2026-09-15) had no records for
  any `content/included/poses/` file, including the five Starter Poses. On the
  owner's G1 decision, records were added for all 26 with the existing
  owner-attestation basis.
- **G1 passed (owner, 2026-10-08):** the converted content, the 21 promoted Poses
  with their six renames, and the source-review updates were approved for
  commit.
- Checks: vitest `src/lib/avatar src/ui/action-editor src/lib/runtime-content tests/avatar`
  passed 1203 tests. Backend `tests/test_included_content_catalog.py tests/test_starter_content_closure.py tests/test_pose_content.py tests/test_content_package_capabilities.py`
  passed 97. The full backend suite's only other failure,
  `test_desktop_runtime_packaging.py::test_runtime_resource_audit_has_schema_and_starter_resources`
  ("no lip-sync phonemes"), is a venv gap fixed on `main` by `e14f5d2c`; the test
  passes on `main` `1348dd4b`. Eslint, prettier and tsc are clean on the touched
  files.

#### Code Review #1 Findings

Reviewed source: Phase 1 working tree against `fd1980fe` (independent
`sdlc-reviewer`, initial round). Checks run: verify, dry run, a two-way scratch
equivalence script, `pnpm -s check:source` (failed, F1), prettier, eslint,
`poses:check`, targeted vitest (356 passed), ruff and targeted pytest
(97 passed).

- **P1-CR1-F1 (blocking):** `lib/avatar/reactionClips.ts` typed the Reaction
  selection's clip as 1.0 after `getAvatarReactionClip` widened, so
  `pnpm check` failed (TS2322).
- **P1-CR1-F2 (blocking):** the equivalence measure was one-sided. The 2.0
  `finger-heart-pose` drives `blink=0` where 1.0 left it undriven, suppressing
  auto-blink and emotion blink, so "0 weight" overstated the evidence.
- P1-CR1-F3: 27 Reactions get `duration: 1` from a 1.0 duration of 0; no
  lifetime effect.
- P1-CR1-F4: pruning is sound (base-pose sampling, resolvers, promoted pose
  values byte-identical).
- P1-CR1-F5: plan text describes `convertFiles.ts` / `clip-format convert`, and
  Phase 2 says to add `--local-root`, which already exists.
- P1-CR1-F6: Pose files had no source-review records.
- P1-CR1-F7: three orphaned comments.
- P1-CR1-F8: all 16 converted Gestures are exempt from motion checks, but only 11
  fail them.
- P1-CR1-F9: `--verify` with no value reads the index.
- P1-CR1-F10: interim docs, the `BUILTIN_POSES` comment and the picker are
  handled in later phases.

#### Code Review #1 Revisions

- F1 accepted: the selection type is now `AnyAnimaPoseClip`, and
  `pnpm -s check:source` exits 0.
- F2 accepted: `measureAnimaPoseClipConversion` also counts channels the 2.0
  clip adds, and the script fails on them beyond one sample per cycle. The rerun
  found only `finger-heart-pose` blink (115 samples), which the owner accepted
  as converted. It is listed in `ACCEPTED_ADDED_CHANNELS`, and the record above
  states the deviation.
- F3 accepted as a record note (above); no change.
- F4: no action.
- F5 accepted: plan step 1, Phase 2 and the validation table were corrected.
- F6: the owner chose at G1 to add records for all 26 Pose files.
- F7 accepted: the comments were moved.
- F8 accepted: only the 11 failing Gestures are exempt, and the other five pass
  the motion checks (44 tests).
- F9 accepted: `--verify` without a revision exits 2.
- F10: deferred to Phases 3–5 as planned.

Repair round 1 used.

#### Code Review #2 Findings

Targeted recheck of the round-1 fixes by the same independent reviewer. Result:
pass, no blocking findings. Its checks: verify (88/0),
`--verify` without a value (exit 2), `check:source`, prettier, eslint, vitest
(208 passed), a scratch two-sided `added` dump of all 88 clips matching the
record, and the source-review set against `git ls-files content/included/poses`.

- P1-CR2-F1 (optional): the `ADDED_SAMPLE_ALLOWANCE` comment said "one sample
  per cycle", but the allowance is a flat 2 per channel.

#### Code Review #2 Revisions

- P1-CR2-F1 accepted: the comment was reworded. No behaviour change.

Phase 1 complete: checks and review passed, G1 passed.

### Phase 2: Local migration tool

Requirements: issue scope item 2, acceptance 3. Depends on: Phase 1's script.

Steps: `convert-v1 --local-root <dir>` (added with the Phase 1 script) walks
every non-`.meta.json` JSON file under the root, converts each 1.0 clip in place
(same checks as Included), and writes a `<file>.v1.bak` beside each rewritten
file. `--dry-run` lists what it would
change. Unit-test it against a temporary root with one 1.0 Gesture, one 1.0
Reaction and one 2.0 Gesture.

**Gate G2 (owner):** choose the roots to run it on. Default proposal: a dry run
on every Local root found on the development machine (see Surprises), recording
the result (currently zero 1.0 files), with no write run unless a dry run finds
something. The owner may add the installed desktop app's root or others.

Completion: dry-run results recorded per root.
Commit `refactor(content)[p2]: add the one-off Local clip migration`.

#### Phase 2 record

Starting revision `a45ee6c6` (Phase 1 plus a merge of `origin/main` at
`1348dd4b`). Issue #357.

- `scripts/clip-format-convert.test.mjs`, run in `test:source` until Phase 3,
  covers four cases. A Local dry run lists the 1.0 clips and writes nothing. A
  run converts the 1.0 Gesture and Reaction in place, writes `.v1.bak` copies,
  leaves `.meta.json` and 2.0 files alone, and finds nothing on rerun. The real
  CLI converts an inline 1.0 Gesture, and a failed conversion writes nothing and
  exits 1. 4 passed.
- **G2 (owner default, 2026-10-08):** dry runs of
  `pnpm -s animation convert-v1 --local-root <root> --dry-run` on every Local
  root found on the development machine all reported
  `0 clip(s) to convert, 0 failed`, so no write run was needed:

  | Local root (placeholders for machine paths) | JSON files (`find`) | 1.0 clips |
  | --- | --- | --- |
  | Main checkout `content/local` | 0 | 0 |
  | Main checkout `.animama-stacks/animama-runtime-p3-built` | 0 | 0 |
  | Main checkout `.animama-stacks/animama-runtime-p3-dev` | 0 | 0 |
  | `animama-ui-skill` worktree stack `animama-ui-foundations` | 0 | 0 |
  | `avatar-effects-v2` worktree stack `animama-avatar-fx` | 14 | 0 |
  | `mixamo-built-in-motion` worktree stack `animama-mixamo` | 1 | 0 |
  | Desktop app data `<app-data>/Animama/content/local` | 0 | 0 |
  | Four desktop app data backups (2026-09-20, 09-25, 09-30, 10-06) | 0 | 0 |

  The main checkout's `content/local` was recreated outside this task at 13:37
  on 2026-10-08, between the planning scan and the dry run. The earlier scan
  also found no 1.0 files there.

#### Phase 2 Code Review #1 Findings

Independent `sdlc-reviewer`, initial round. Its checks: the new test (3 passed),
prettier, eslint, the CI checkout depth, and read-only `find`/`grep` over every
recorded root, whose counts matched the table.

- **P2-CR1-F1 (blocking):** the CLI test read its 1.0 input with
  `git show fd1980fe:…`, which a shallow CI checkout (`fetch-depth: 2`) cannot
  resolve.
- P2-CR1-F2: no test covered the failure path.
- P2-CR1-F3: an unreadable file stops the run; reruns are idempotent.
- P2-CR1-F4: symlinks and non-JSON files are skipped silently.
- P2-CR1-F5: argument edge cases in the one-off tool.
- P2-CR1-F6: the planning scan's "six" stack roots against five in the table,
  and the source of the JSON count.
- P2-CR1-F7: the plan file is not Prettier-formatted (pre-existing, outside the
  check scope).

#### Phase 2 Code Review #1 Revisions

- F1 accepted: the CLI test writes an inline 1.0 Gesture (inline pose,
  `relaxedRest` base) and needs no git history.
- F2 accepted: a failure-path test was added (4 passed).
- F3–F5 rejected for a one-off tool that is deleted in Phase 3. Its failures
  are loud and reruns are safe.
- F6 accepted: the Surprises entry notes the removed stack, and the table names
  `find` as the source of the count.
- F7: no action.
- Phase 3 deletes the test and its `test:source` entry together with the
  script.

Repair round 1 used.

#### Phase 2 Code Review #2

Targeted recheck: pass. F1, F2 and F6 are resolved (4 passed, prettier and
eslint clean). P2-CR2-F1 (optional) noted that the record said "three cases";
it now says four.

Phase 2 complete.

### Phase 3: Frontend 1.0 removal and rejection

Requirements: scope item 3, acceptance 4–5 (frontend). Depends on: Phases 1–2.

Order: rejection paths first, then deletions.

1. **Rejection.** `anyClip.ts` → a single `parseAnimaPoseClip` (2.0) that throws
   `UnsupportedAnimaPoseClipFormatError` (D3 message) for `animaPoseClip/1.0` and
   for any other schema. This flows to the runtime catalog diagnostic, the
   built-in catalog warning, the import dialog and the preview CLI.
   `actionDocumentLoader` validates owned and built-in sequences and throws, so
   `ActionEditorPage` shows its failure message instead of opening an empty
   timeline. Recovery drafts with a 1.0 sequence are discarded with that message.
   Tests are added first for each surface.
2. **Neutral modules.** Move the shared vocabulary from `schema.ts` into
   `clipVocabulary.ts` (constants, rounding/serialization, tuples, sample and
   resolver types, easing/transition/fade, role, playback, mutes) and
   `clipEvents.ts` (event types and sanitizers, moved as they are). Delete
   `schema.ts`. `schemaV2.ts` keeps its name; renaming it adds churn without
   reader value.
3. **Deletions.**
   - `sampling.ts`, `convertV2.ts` (+ tests), `scripts/clip-format-convert/` and
     `clip-format-convert.mjs`.
   - `createV1Program`, the 1.0 branches in `channels.ts` and `playback.ts`, and
     the 1.0 exports from `animaPoseClip/index.ts` and `lib/avatar/index.ts`.
   - `collectMissingClipPoseRefs`' ref path (the internal poses already moved
     to Included in Phase 1).
   - Creator: the 1.0 draft view (`poses`/`keyframes`/`defaultTransition`) and its
     build, bake, convert-on-open and ref-validation code, the 1.0 else-branches
     and helpers in `pose-creator-store.ts`, `poseCreatorClipMotion`'s fallback,
     and the `ActionEditorWorkspace` ref paths.
   - `actionDocument.ts`: the default sequence becomes a 2.0 empty clip, and the
     Reaction and humanoid checks read 2.0 tracks only.
   - `actionPersistence.ts`: saves `draft.motion` only.
   - `posePreviewTarget.ts`: builds a 2.0 held clip (two beats, rotation, hips
     and expression tracks; non-hips positions are dropped, as 2.0 cannot hold
     them).
   - `effect-render/render.ts`: uses `createAnimaPoseClipProgram`.
   - `motion-authoring/{checks,cli}.ts` and `preview/sources.ts` keep the 2.0
     branch only.
   - `AnimationDebugModal`: shows the 2.0 summary.
   - `animation-promote.mjs` and `promote.md`: the clip-samples maintenance goes.
   - Fixtures: `starter-clip-samples-before-reduction.json` and
     `animaPoseClip/fixtures/compatibility-valid.json` go. The backend test that
     read the latter moved to `compatibility-valid-v2.json` in Phase 4 (see the
     final record on intermediate commits).
4. **Picker filter (D2).** In the Gesture creator's Poses tab picker, add a
   "Show Included" checkbox (default off) that hides Included Poses, reusing the
   existing picker/filter components. Component test plus a journey assertion
   where one already covers the picker.
5. **Tests.** Delete the 1.0-specific cases (sampling, convert, the V1 program,
   1.0 parse compatibility, ref/inline/alias store cases, bake/convert authoring
   cases). Rewrite the cases that use a 1.0 clip as a vehicle (about 40 files) as
   2.0. Turn the e2e "Open the 1.0 clip as beats" step into an unsupported-format
   import check, and convert `imported-playback.ts` and
   `accountless-numeric-input.spec.ts` to 2.0.

Checks: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build` (from
`src/frontend`); `git grep -nE "animaPoseClip/1\.0|sampleAnimaPoseClip|convertAnimaPoseClipToV2|internal-poses" src/frontend`
lists only rejection code and its tests; `pnpm e2e:test:fast` on the disposable
built stack, comparing any failure with `main`.

Completion: commit `refactor(avatar)[p3]: remove animaPoseClip/1.0 from the frontend`.

#### Phase 3 record

Starting revision `9d32b5e4`. Issue #358. The creator and Action-editor removal
and the lib/avatar test migration were delegated to two subagents with
disjoint file ownership, then integrated and checked together.

- Modules: `schema.ts` became `clipVocabulary.ts`, holding the shared
  vocabulary with the 1.0 parts deleted. It is one module rather than the
  planned vocabulary/events split, which would only have added import churn.
  `anyClip.ts` became `parseClip.ts`, with a single 2.0 `parseAnimaPoseClip`
  plus `UnsupportedAnimaPoseClipFormatError` and
  `unsupportedAnimaPoseClipFormatMessage`. `AnyAnimaPoseClip` was renamed to
  `AnimaPoseClipV2` and `parseAnyAnimaPoseClip` to `parseAnimaPoseClip` across
  the codebase. `resolveAnimaPoseClipFadeTransition` now takes only the fade.
- Rejection with the D3 message happens on every surface:
  - runtime catalog (an `invalid_motion_manifest` diagnostic);
  - built-in catalog (a warning, then the item is skipped);
  - creator open (`actionDocumentLoader` throws, and the page shows its failure
    message);
  - import (`actionProject`);
  - recovery drafts (the stored recovery is deleted and a toast is shown);
  - `preview/sources.ts`;
  - package errors (`clip_format_unsupported` in
    `lib/content-sharing/errors.ts`, the same text as the backend's fixed hint).
- Creator:
  - `draft.motion` is required. The 1.0 draft fields (`poses`,
    `defaultTransition`, keyframe `transition`), the build, bake and convert
    paths, the ref validation codes and the 1.0 store branches were removed.
  - Ten keyframe-view store actions with no callers were removed, after the
    reviewer confirmed there are no callers or shortcuts.
  - Export modes are gone, because 2.0 has nothing to bake.
  - A new document defaults to a well-formed empty 2.0 sequence, which
    `isEmptyActionTimeline` treats as blank. Save still requires a playable
    clip, as before.
- Pose preview builds a looping one-beat 2.0 held clip. Non-hips bone positions
  are not previewed.
- `effect-render` now plays a 2.0 program.
- `animation-promote` no longer maintains clip samples.
- The temporary convert script, its test and the 1.0 fixtures were deleted.
- D2 picker: a "Show Included" checkbox (off by default) on the Gesture
  creator's Poses tab. The empty states point to it. It is covered by a
  happy-dom component test and an assertion in the pose-content journey.
- e2e:
  - the imported-playback helper and the numeric-input journey use 2.0;
  - `creator-1-0-{gesture,reaction}-import-is-rejected` replaces the "1.0 opens
    as beats" journey.
- Checks (`src/frontend`):
  - `pnpm check` 0, `pnpm web:lint` 0, `pnpm prettier:check` clean,
    `pnpm build` 0;
  - `pnpm web:test`: 413 vitest files and 3096 tests passed, plus the node and
    browser script tests (38 passed);
  - `pnpm e2e:check:source` 0.
- Journeys: `pnpm e2e:test:fast` on the disposable built stack
  `animama-clipv2` (`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production`,
  base port 8700) passed 36/36 in 5.2 min (run-1008143617). After the F4
  journey edit, `pose content Local save edit reopen…` passed again
  (run-1008144231).

#### Phase 3 Code Review #1 Findings

Independent `sdlc-reviewer`, initial round, on the `src/frontend/**` working
tree against `9d32b5e4`.

- **P3-CR1-F1 (blocking):** Prettier failed in three edited files
  (`beatEditing.ts`, `playback.ts`, `ReactionClipPlayer.ts`).
- **P3-CR1-F2 (blocking):** the `animation:preview` usage text still listed
  1.0 sources.
- **P3-CR1-F3 (blocking):** a 2.0 events validation message pointed to "the 1.0
  event rules". Related comments in `schemaV2.ts` and `curves.ts` also
  mentioned 1.0.
- **P3-CR1-F4 (blocking):** the planned journey assertion for "Show Included"
  was missing. `pnpm build` and the fast journeys had not been recorded yet.
- Optional findings:
  - `selectedPoseAlias` and keyframe `pose` are leftovers of the alias model;
  - capture samples the whole draft to check refs;
  - no tests cover the built-in catalog warning or the recovery toast;
  - the module-split deviation was not recorded, and the vocabulary header had
    change narration;
  - Pose preview uses one beat, not two, and a completely empty Pose no longer
    previews;
  - a search that matches only hidden Included Poses gives no hint.

#### Phase 3 Code Review #1 Revisions

- F1 accepted: the files were formatted, and `pnpm prettier:check` is clean.
- F2 accepted: the usage text says 2.0 only.
- F3 accepted: the message now reads "Invalid events: check each event's kind,
  time and fields." The 1.0 comments were reworded.
- F4 accepted:
  - `accountless-pose-content` now asserts that Relaxed Rest is hidden, then
    shown after checking the box and hidden again after unchecking it. It
    passed on the stack.
  - `pnpm build` and the fast-journey results are recorded above.
- Optional findings accepted:
  - the hint for a search that matches only hidden Included Poses;
  - the vocabulary header narration was removed, and the module-split
    deviation is recorded above.
- Optional findings not taken:
  - the alias-state cleanup (behaviour-neutral churn in undo snapshots);
  - the capture sampling simplification;
  - tests for the warning and toast paths (the shared parser that drives them
    is covered);
  - previewing an empty Pose (it has nothing to show).

Repair round 1 used.

#### Phase 3 Code Review #2

Targeted recheck: pass. F1–F4 and the accepted optional items were verified
with prettier, eslint, vitest (261 tests) and `e2e:check:source`. The
optional P3-CR2-F1 noted that the search hint appeared even when no hidden
Included Pose matched the search. It now appears only when one does.

Phase 3 complete.

### Phase 4: Backend 1.0 removal and rejection

Requirements: scope item 4, acceptance 4–5 (backend). Depends on: Phase 1
(Included content must be 2.0 before scans reject 1.0).

1. **Scan rejection (tests first).** `validate_companion_files` for
   `anima_clip` Gestures and Reactions reads the `sequence` file and returns
   `ContentDiagnostic("clip_format_unsupported", <D3 message>, path)` for 1.0 or
   any non-2.0 schema. The item is listed INVALID in Content Health. This also
   covers Save and `inspect_package_tree`.
2. **Package import.** Remove `animaPoseClip/1.0` from
   `SUPPORTED_CAPABILITIES` (the `animama/builtin-pose/1/*` ids stay, D2). A manifest
   declaring `animaPoseClip/1.0` raises
   `ContentDocumentError("clip_format_unsupported", …)`, following the
   avatar-effect/1 precedent. The router returns its `message` as it does for
   `CONVERSION_REQUIRED`. `_clip` accepts only 2.0, and an undeclared 1.0 file
   gets the same code. Frontend import surfaces show the message (check
   `ContentPackageImport` error mapping).
3. **Deletions.**
   - `idle_clip_validation.py` 1.0 validator (shared helpers stay) and the
     `idle_playback.py` 1.0 branch.
   - `_clip`'s 1.0 ref rule. `BUILTIN_POSES` keeps its 26 ids (D2).
   - Retired `pose_clip` transitions per D1, with their tests. The retired
     handler's parse returns the `clip_format_unsupported` diagnostic.
   - `golden-action-closure.v1.json` (and its source-review record).
   - The 1.0 cases in `idle-playback-cases.json` (the frontend contract tests
     follow).
4. **Tests.** Convert the vehicle tests listed in the backend survey
   (`test_anima_runtime_closure`, `test_content_mutation_workflows`,
   `test_content_package_{cross_installation,event_dependencies,export_review,import_anima,v3_archive}`,
   `test_local_content_{import_contract,scan}`, `test_idle_playback`) to 2.0. Add
   rejection tests for scan, Save, package import (declared and undeclared) and
   the retired `pose-clips/` file.

Checks: `uv run pytest -q`, `uv run ruff check`, `make check-test`, frontend
`pnpm web:test` (shared idle fixture). If the API schema changed, regenerate the
SDK offline with `pnpm openapi-ts`.

Completion: commit `refactor(content)[p4]: reject animaPoseClip/1.0 in the backend`.

#### Phase 4 record

Starting revision `9d32b5e4`. Issue #359. The backend test migration was
delegated to a subagent that owned `tests/` only.

- New module `app/services/clip_format.py` provides the schema constants,
  `CLIP_FORMAT_UNSUPPORTED`, `unsupported_clip_format_message`, a fixed
  `PACKAGE_CLIP_FORMAT_HINT` (the HTTP boundary never echoes submitted data)
  and `validate_action_clip_files`.
- Rejection happens on these paths, all tested first:
  - Local scan, Save and `inspect_package_tree`, through
    `ContentTypeHandler.validate_companion_files`;
  - package capabilities: declaring `animaPoseClip/1.0` raises
    `clip_format_unsupported`, and `_clip` accepts only 2.0, whose requirements
    are `animaPoseClip/2.0` plus the base pose;
  - the package router returns the hint as `message`;
  - idle playback reports `idle_motion_invalid` with the unsupported-format
    message.
- Deletions: the 1.0 validator (`_pose`, `validate_idle_clip_timeline`), the
  1.0 branches in `idle_playback.py` and `_clip`, and the `animaPoseClip/1.0`
  capability.
- `BUILTIN_POSES` keeps 26 ids (D2), and its comment was updated.
- D1:
  - `action_clip_transition.py`, `included_action_transition.py` and their
    tests were deleted. Both transitions only ever converted retired pose-clip
    Actions.
  - The retired `pose_clip` kind now parses only an identity record
    (`PoseClipDocumentV1` without poses or keyframes), so Save receipts still
    replay.
  - A legacy idle lane on a pose clip fails with `clip_format_unsupported`.
  - Discovery: retired kinds are filtered out of every visible listing, so D1's
    "listed INVALID" part has no visible surface.
- `tests/fixtures/idle-playback-cases.json` (shared with the frontend): 27
  generic cases were converted to 2.0, 17 1.0-only cases were dropped, and
  `clip-retired-format` was added. `zero-timeline` now expects
  `idle_motion_invalid`, because 2.0 rejects a zero duration structurally.
- `golden-action-closure.v1.json` (an orphan) was deleted. Source-review
  records of deleted tracked files were removed (4).
- Tests:
  - new rejection tests in `test_local_content_scan.py` (3 cases) and
    `test_content_package_capabilities.py` (4);
  - vehicle tests were converted to 2.0 through a shared
    `anima_clip(...)` helper in `tests/content_package_helpers.py`;
  - the direct pose-clip idle transition test now asserts the
    `clip_format_unsupported` diagnostic;
  - the retired pose-clip per-event-audio round trip was deleted.
- Checks: full `uv run pytest -q -p no:cacheprovider`: 3239 passed, 10 skipped,
  0 failed before review; 3248 passed, 10 skipped, 0 failed after the repairs. `uv run ruff check` and `ruff format --check` are clean. No API
  schema changed, so the SDK was not regenerated.

#### Phase 4 Code Review #1 Findings

Independent `sdlc-reviewer`, initial round. Its checks: ruff, the 13 changed
backend test files (380 passed), the frontend errors test, and read-only probe
scripts that confirmed F1–F3.

- **P4-CR1-F1 (blocking):** a package with an undeclared 1.0 clip in the normal
  layout was refused with the generic `package_entry_invalid`, because the
  scan diagnostic made the entry invalid before `_clip` ran.
- **P4-CR1-F2 (blocking):** Actions without `file_role`, a supported implicit
  `sequence` layout, skipped the format check, so scan and Save admitted a 1.0
  clip.
- **P4-CR1-F3 (blocking):** a legacy Action whose motion is a retired pose clip
  stayed VALID with no diagnostic after the transitions were deleted.
- **P4-CR1-F4 (blocking):** the Phase 3 commit contained the Phase 4 backend
  deletions, which `git rm` had staged, and could not import.
- **P4-CR1-F5 (blocking):** the planned Save, router, end-to-end undeclared
  import, legacy pose-clip and no-`file_role` rejection tests were missing.
- **P4-CR1-F6 (blocking):** a source-review record of a deleted test file
  remained.
- Optional findings:
  - a duplicate 2.0 schema constant;
  - a stale "as for 1.0" docstring;
  - a dead `_KIND_FIELDS[POSE_CLIP]` list;
  - an unreachable `"pose_clip"` file role in the idle transition;
  - an unbounded schema echo in diagnostics;
  - hint wording that covered import only.
- Confirmed by the reviewer: the shared idle-fixture conversion kept each
  case's intent. The deleted transition services did nothing for shipped
  content: there are no Included pose clips or content-dependency Actions.

#### Phase 4 Code Review #1 Revisions

- F1 accepted: `ContentPackageArchive` raises `clip_format_unsupported` when
  the inspected entry carries that diagnostic.
- F2 accepted: `validate_action_clip_files` uses `file_role or "sequence"` and
  reads any declared clip file.
- F3 accepted: an `anima_clip` Action whose `content_dependency_ref` names a
  `pose_clip` dependency gets the retired-format diagnostic.
- F4 accepted: the Phase 3 commit was rebuilt locally (it had not been pushed)
  with only `src/frontend` and the plan. It is now `29e9bf62`. The shared idle
  fixture lands with Phase 4, so frontend `IdlePlaybackContract` passes from the
  Phase 4 commit on.
- F5 accepted. New tests:
  - `tests/test_clip_format_rejection.py`: scan with an implied role, a legacy
    pose-clip Action, Save for both layouts, and a `PackageRoute` returning the
    fixed hint without echoing data;
  - `test_undeclared_retired_clip_is_refused_with_its_reason` in the v3
    archive tests, for both layouts.
  - The v3 package builder is shared by the inferred-role tests.
- F6 accepted: the record was removed.
- Optional findings accepted:
  - one schema constant (`clip_format.ANIMA_POSE_CLIP_SCHEMA`);
  - the docstring fix;
  - an empty `_KIND_FIELDS[POSE_CLIP]` with a comment;
  - a schema is named in messages only when it is short and printable;
  - the hint says "imported or exported", in both the backend and the
    frontend map.
- Optional finding not taken: the `"pose_clip"` role in the idle transition
  stays. Older owned clip files may still carry that role, and removing it
  gains nothing.

Repair round 1 used.

#### Phase 4 Code Review #2 Findings

Targeted recheck. F1, F3, F4, F6 and the optional items were verified (293
tests passed, ruff clean).

- **P4-CR2-F1 (blocking):** the rest of CR1-F2. An Action whose descriptor
  lists no `files` (the scanner infers the `sequence` role) still passed scan
  and Save with a 1.0 clip.
- Optional: the frontend message named any schema, while the backend bounds it.

#### Phase 4 Code Review #2 Revisions

- P4-CR2-F1 accepted: when a descriptor lists no files, every companion is a
  candidate clip. New tests cover scan and Save for that layout. 303 tests
  passed across the affected backend files.
- Optional accepted: `unsupportedAnimaPoseClipFormatMessage` names only a short
  (64 characters or fewer), printable schema, matching the backend. 370
  frontend tests passed.

Repair round 2 used (the budget limit).

#### Phase 4 Code Review #3

Final targeted recheck: pass. P4-CR2-F1 is closed, and no Included Action uses
a descriptor without files. Two optional findings were not taken:

- P4-CR3-F1: in a no-files Action, an extra non-clip JSON companion is reported
  as an unsupported clip. The scanner already gives such companions the
  `sequence` role, so the entry was ambiguous before and was rejected by idle
  playback and packaging. Only the wording differs.
- P4-CR3-F2: the frontend and backend schema-name bounds differ for rare
  Unicode format characters and for UTF-16 against code-point length. The 1.0
  wording and ordinary schemas match.

Phase 4 complete.

### Phase 5: Docs, skill and ADR

Requirements: scope item 5, acceptance 6.

- Remove 1.0 from `docs/frontend/runtime/avatar-animation.md`,
  `avatar-emotion.md`, `avatar-vfx.md`, `avatar-particle-vfx.md`, the routing and
  format docs, `docs/backend/features/{custom-animas-and-content,typed-content-and-marketplace}.md`,
  `docs/backend/architecture/local-content-storage.md`, the `animama-animation`
  skill (including `references/promote.md`) and
  `.agents/skills/animama-vrm/references/spec-and-versions.md`.
- Add ADR 0016 "animaPoseClip/2.0 is the only clip format" (superseding the
  coexistence consequence of ADR 0014) and update `docs/adr/README.md`.
- Update `GLOSSARY.md` if its clip entry mentions 1.0.
- Historical plans and specs stay as written.

Checks: `make format-check` (or the docs formatter), link check of the changed
docs, and `git grep "animaPoseClip/1.0"` limited to rejection code, tests, ADRs
and historical plans.

Completion: commit `docs(avatar)[p5]: describe animaPoseClip/2.0 as the only clip format`.

#### Phase 5 record

Starting revision `ccf46664`. Issue #360.

- Docs updated: the runtime animation, VFX, particle and emotion docs, content
  previews, routing, Library, the backend content docs, `content/included/README.md`,
  the `animama-animation`, `animama-vrm` and `animama-particle-vfx` skill
  references, and `GLOSSARY.md` (Pose Clip).
- New ADR 0016 "animaPoseClip/2.0 is the only clip format". It supersedes ADR
  0014's coexistence consequence, and ADR 0014's status and the index say so.
- Checks: Prettier on the changed Markdown is clean, and relative links resolve
  (reviewer's link check). Historical plans are unchanged.

#### Phase 5 Code Review #1 Findings

Independent `sdlc-reviewer`, initial round.

- **P5-CR1-F1 (blocking):** three docs still described Startup and Rescan
  converting Pose Clip references into Action-owned files.
- **P5-CR1-F2 (blocking):** `loadAndPlayClip` still said "(either schema)".
- **P5-CR1-F3 (blocking):** the particle-VFX skill pointed to the renamed
  `schema.ts`.
- **P5-CR1-F4 (blocking):** three rejection statements were inaccurate:
  - idle playback uses `idle_motion_invalid`;
  - package import uses a fixed package message;
  - Save refuses rather than lists invalid.
- **P5-CR1-F5 (blocking):** ADR 0016 did not state its supersession of ADR
  0014.
- Optional findings:
  - the emotion doc said "inline expression keyframes";
  - Library implied only five Included Poses;
  - a repeated sentence and vague wording in `avatar-animation.md`;
  - the glossary placement;
  - ADR evidence sources and "was run" wording (they were dry runs);
  - the Pose preview's dropped bone positions were undocumented;
  - seven added lines were not wrapped;
  - `content/included/README.md` still described reusable `pose-clips/`.

#### Phase 5 Code Review #1 Revisions

- F1–F5 accepted and fixed as described.
- All optional findings accepted: the emotion wording, Library, the
  `avatar-animation.md` cleanup, the glossary move to Pose Clip, the ADR
  evidence files and dry-run wording, the content-previews note, line wrapping
  and the Included README line were fixed.

Repair round 1 used.

#### Phase 5 Code Review #2

Targeted recheck: pass. F1–F5 and the optional items were verified, with the
link check and Prettier clean. P5-CR2-F1 (optional, not taken): a few
paragraphs are still wrapped unevenly. This is cosmetic, and Prettier
preserves prose wrapping.

Phase 5 complete.

## Final integration review

Independent review of combined acceptance on the final candidate, reusing phase
evidence that is still valid.

**Gate G3 (owner):** live checks of chat playback of the converted Gestures
(starter loadout), Reaction playback, Library previews, and the Gesture and
Reaction creators. The agent performs these on its stack and records them; the
owner accepts them.

### Final Integration Review #1 Findings

Independent `sdlc-reviewer` on candidate `066a0f6c` against `fd1980fe`. Its
checks found no code defects:

- 115/115 Included clips are 2.0.
- The 26-id pose sets match across the backend, the frontend fixture, the
  generated catalog and `content/included/poses`.
- No 1.0 identifiers remain outside rejection code, tests, ADRs and history.
- Commit scopes are coherent.
- No Cloud, generated-client or Alembic changes.
- The plan is public-safe.

Findings:

- **FIR1-F1 (required):** the final evidence and outcomes were missing from
  this plan.
- **FIR1-F2 (required):** the intermediate-commit note was incomplete.
  `tests/test_content_package_capabilities.py` also fails at the Phase 3
  commit, because it read the deleted 1.0 fixture until Phase 4.
- FIR1-F3 (optional): `origin/main` had moved 8 commits, including #322's UI
  theme work in files this branch changes.
- FIR1-F4 (optional): no test pins backend/frontend message parity.

### Final Integration Review #1 Revisions

- FIR1-F1 accepted: the final record, the validation table and the outcomes
  are below.
- FIR1-F2 accepted. Two intermediate commits fail tests, and both are fixed
  from the Phase 4 commit `ccf46664` on:
  - `29e9bf62` (Phase 3) fails frontend `IdlePlaybackContract` (the shared idle
    fixture lands in Phase 4) and backend `test_content_package_capabilities`
    (it reads a fixture deleted in Phase 3).
- FIR1-F3 accepted: `origin/main` was merged (`9a995ced`) and the checks below
  were rerun on that candidate.
- FIR1-F4 not taken. The two messages point to each other in their docstrings.
  A cross-language parity test would need a shared fixture for two strings.

### Final record

Validated revision: `9a995ced` (the branch with `origin/main` merged) ·
baseline: `fd1980fe`. Hosted CI is disabled, so all evidence is local
(macOS, Apple silicon).

- Backend:
  - `uv run pytest -q -p no:cacheprovider`: 3248 passed, 10 skipped, 0 failed.
    `make check-test` reported the same totals on `066a0f6c`.
  - `uv run ruff check` clean, and `make format-check` clean.
- Frontend (`src/frontend`):
  - `pnpm check` 0, `pnpm web:lint` 0, `pnpm prettier:check` 0, `pnpm build` 0.
  - `pnpm web:test`: 3095 of 3099 vitest tests passed. The 4 failures were
    `tests/local-api-proxy.test.ts` "Port 5173 is already in use", because
    another session's effect-render run held the port. Rerun once the port was
    free: 8/8 passed, and the browser script tests then passed 38/38.
- Journeys, on the disposable built stack `animama-clipv2` at base port 8700
  (`ANIMAMA_LLM_SKIP=1 ANIMAMA_WEB_BUILD_MODE=production`):
  - full `pnpm e2e:test`: 38 passed in 10.8 min (run-1008150737), on the
    `ccf46664` source;
  - `pnpm e2e:test:fast` after the main merge: 36 passed in 6.7 min
    (run-1008153116).
  - No failures, so no comparison with `main` was needed.
- Desktop: `pnpm desktop:runtime:stage` and `pnpm desktop:runtime:audit` for
  darwin arm64 both reported "runtime audit: OK". The release licence gate
  remains closed, as before (743 pending records); that gate is separate.
- Agent live checks on the stack (built browser):
  - the Library preview of converted `meme-dab` holds the dab, and `Anger
    Reaction 3` plays with its scene effect, with no console errors;
  - the Reaction creator opens `anger-3` as beats (Peak, Angry);
  - the Gesture creator opens converted `soldier-salute` as five labelled beats;
  - the Poses tab hides Included Poses until "Show Included" is checked, then
    lists the promoted Poses;
  - the promoted Soldier Salute Poses appear in the Library.
  - Not checked: chat playback, because the stack skips the LLM. This is part
    of G3.

## Validation and acceptance

| Acceptance (issue #337) | Evidence |
| --- | --- |
| All 115 Included clips 2.0, equivalent within tolerance | Phase 1 `convert-v1 --verify fd1980fe` output; `catalog.content.test.ts` counts |
| IDs, Selector IDs, names, loop kind, Reaction fields, starter loadout unchanged | Script invariants; `git diff --stat` shows no `*.meta.json` or loadout changes |
| Local migration with dry run, run and recorded, then removed | Phase 2 record; Phase 3 deletion |
| No 1.0 clip code; `animaPose/1.0` untouched | `git grep` in Phases 3–5 |
| Clear rejection on import and scan | Phase 3/4 rejection tests |
| Docs, skill, ADR | Phase 5 |
| Local checks | Final record, exact commands and results |
| Full journeys vs `main` | Final record |
| Live checks | G3 record |

Hosted CI is disabled (2026-10-07); local evidence only.

## Idempotence and recovery

- The conversion only rewrites files whose schema is `animaPoseClip/1.0`.
  Rerunning it is a no-op, and `git checkout fd1980fe -- content/included`
  restores the originals.
- The Local migration keeps a `.v1.bak` beside each rewritten file, and dry runs
  write nothing.
- Installed apps rehash changed Included items at startup, and item ids are
  kept, so loadouts and chats continue to reference the same items.
- Development databases whose Local content holds 1.0 clips see those items
  INVALID with the D3 message after Phase 4. Run the Phase 2 tool from a
  pre-Phase-3 revision to recover them.

## Outcomes & Retrospective

Delivered:

- All 43 Included Gestures and 72 Reactions are `animaPoseClip/2.0`. They are
  verified equivalent to their 1.0 originals, with one owner-accepted blink
  deviation.
- The 21 Gesture poses are now Included Poses, behind a "Show Included" picker
  filter.
- No 1.0 clip code remains in the frontend or backend. Every surface rejects a
  1.0 clip with one clear message.
- The docs, skills and ADR 0016 describe 2.0 as the only format.

Remaining:

- G3: owner acceptance of the live checks, including chat playback.
- Owner merge approval of the exact candidate.

Lessons:

- The equivalence check had to be two-sided. Measuring only the 1.0 sample's
  channels hid a 2.0 track that drives blink where 1.0 left it alone.
- `git rm` stages deletions, so a later path-limited `git add` still commits
  them. Check `git diff --cached` before each phase commit.
