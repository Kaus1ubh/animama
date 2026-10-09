# Deliver better hands, solved hand contacts and revised Included Gestures

Source agreement: [spec](hand-animation-gestures-spec.md) for issue #314, agreed by
the owner on 2026-10-09 with decisions D0–D6 (D3 changed: re-animate the legacy
clips now).
Authorized scope: Phases 1–4 and Phase 5 up to gate G3 (2026-10-09). G1 is
satisfied. G2 (preview approval) and G3 (licence wording and promotion list)
remain owner gates.
Branch: `feat/hand-animation-gestures` in its existing worktree; never pushed.
Starting HEAD: merge commit `c52edb8a` (parents: prototype `430a089b`, `main` at
`bfc0de4f`). Baseline for unchanged behavior: `bfc0de4f`.
Delivery: #314 holds the published spec (2026-10-09T17:55:48Z); phase sub-issues
#380–#384 with blocked-by links; the PR lists `Closes #314` and one `Closes #N`
line per phase issue.

## Purpose and context

Make Gesture hands expressive and editable, make declared hand contacts land on
every Avatar, catch the reviewed faults in checks, and revise, add, rename and
remove the Included Gestures in the spec, with one owner review in
`animation:preview` before promotion.

Paths are relative to `src/frontend/web/src/` unless they start with `src/`,
`content/`, `licenses/`, `tests/`, `docs/`, `.agents/` or `scripts/` (meaning
`src/frontend/web/scripts/`). Skill references (`hands-and-face.md`,
`clip-format.md`, `checks-and-review.md`, `human-movement.md`, `promote.md`) are
under `.agents/skills/animama-animation/references/`.

| Area | Entry points |
| --- | --- |
| Hand presets and fitting | `lib/avatar/poses/anatomy/handPresets.ts`, `handPresetIds.ts` |
| Clip schema, sampler, vocabulary | `lib/avatar/poses/animaPoseClip/schemaV2.ts`, `prepareV2.ts`, `program.ts`, `clipVocabulary.ts`, `fixtures/v2-vocabulary.json` |
| Joint model, legs | `lib/avatar/poses/anatomy/anatomy.ts`, `anatomy/legs.ts` |
| Creator edits | `lib/avatar/poses/animaPoseClip/beatEditing.ts` (`setBeatPose`, `BeatPose`, `flattenHandToFingerTracks`, `moveBeat`, `fitContactsToClip`), `stores/pose-creator-store.ts` (`commitClipInlinePoseEdit`), `ui/pose-creator/poseCreatorHandInteraction.ts`, `usePoseCreatorHands.ts`, `PoseCreatorHandPanel.tsx` |
| Checks and CLI | `lib/avatar/motion-authoring/checks.ts`, `cli.ts`, `includedGestures.test.ts` |
| Scripts | `src/frontend/web/scripts/animation-render*`, `animation-preview*`, `animation-promote.mjs`, `effect-promote.mjs`, `effect-render*.mjs` |
| Backend | `src/backend/animama/app/services/idle_clip_validation.py`, `content_package_capabilities.py`; `tests/test_pose_clip_v2.py` |
| Content and records | `content/included/gestures/<slug>/`, `content/included/vfx/avatar/`, `content/included/licenses/inventory.json`, `licenses/source-review.json`, `src/backend/animama/resources/starter-loadout.v1.json`, `assets/vrm/animations/manifest.json` (backend copy via `uv run --no-sync python src/backend/packaging/shared_catalogs.py --write`) |
| Docs and skill | `docs/frontend/runtime/avatar-animation.md`, `docs/adr/`, `.agents/skills/animama-animation/` |

## Progress

- [x] 2026-10-07 Prototype models A and B (Decision Log).
- [x] 2026-10-09 Merge `main` `bfc0de4f` (clean); map code, content and tooling;
      independent plan review (3 lenses, findings folded in).
- [x] 2026-10-09 Prototype-only tools (A converter, tip-gap probe) removed from the
      worktree; their results are summarized in the Decision Log and the Phase 1
      pinch test reproduces the fit evidence.
- [x] G1: owner agreed spec, plan and D0–D6 (2026-10-09).
- [x] Phase 1: hand model (R1–R3); review #3 passed 2026-10-09.
- [ ] Phase 2: contact solver, schema and checks (R4, R5, R6 retiming, R7, R8).
- [x] Owner decisions D1–D6 (2026-10-09; D3 re-animate now).
- [ ] Phase 3: drafts and owner preview review (R10, R11, R13; gate G2).
- [ ] Phase 4: creator write-back for solved arms and promotion tooling (R6 edits, R9).
- [ ] Phase 5: promotion, registries and final validation (R12, R13; gate G3).
- [ ] Final integration review; PR; owner merge approval.

## Surprises & Discoveries

- Included Avatars have near-identical finger rigs (pinch fitted on one leaves
  6–7 mm on both) but very different arms: upper arm +20 %, forearm +10 %, whole
  arm +6.2 cm, shoulder joints 4.8 cm closer on A_1 than Y_0.
- Several declared contacts encode the faulty pose and pass: wrist at the elbow
  with tolerance 0.10–0.12 m (Thinking Chin, Storytelling), wrist 18.8 cm beside
  the hips (Hands on Hips).
- `fist curl −25` makes a fingertip claw; the clap's palms face down.
- Laughs oscillate at 4.5–5.5 Hz, phase-locked; hearty and medium share every
  torso key; pulses are `dt` keys on one beat, so retiming beats cannot slow them.
- No clip keys finger `joints`; editing a finger flattens the hand; nothing writes
  `clip.hands` from the creator; `insertBeat` does not anchor hand keys.
- `schemaV2.ts` rebuilds each contact from a fixed field list, dropping unknown
  fields; the schema must land before contact fields are authored.
- The backend rejects new presets on package import/export and Idle Style
  eligibility but not on Local save; no backend test validates tracked Included
  clips.
- Legacy clips exceed joint limits (forearm deviation −70° to −138°, hand rotation
  −39°, head lateral flexion 23.7°), so they are re-posed, not transcribed.
- `animation promote` cannot rename, change loop kind or add dependencies;
  `effects promote` replaces a Gesture with dependencies but cannot add one.
- Starter Selector IDs come from the content-ID suffix.
- HEAD fails `v2Vocabulary.test.ts` (prototype has 12 presets, fixture 7).

## Decision Log

- 2026-10-07, agent finding (D0 proposal): model B hybrid. Method: the eight-preset
  gallery and two real Gestures (Thinking Chin Rest, Blow a Kiss) authored as hand
  keys (B) and expanded to per-beat finger joints by a prototype converter (A).
  B 8 keys/1 KB vs A 244 keys/12 KB; real Gestures 3–4 KB vs 12–13 KB. Tip gap of
  fitted pinch/OK 6–7 mm on both Avatars; unfitted hand-written thumb angles
  25–29 mm. Owner agreement pending (G1).
- 2026-10-09, owner: build the solver here if it helps; agent assessment: it does.
- 2026-10-09, owner: extend #314 to the Gesture list; review in `animation:preview`.
- Proposed, agent: solver v1 pin-mode only, authored wrist kept, one solved
  contact per side at a time, solved after legs; default blends 0.15 s; ramps of
  consecutive solved contacts on one side shorten to meet midway (claps 0.20 s
  apart chain without overlap); in clips with several contacts per moment only one
  per side is solved, the rest stay check-only; contact-window stretching on retime
  applies to solved contacts only (existing clips edit as before).
- Proposed, agent: bulb is a new body-attached Avatar Effect on `rightHand` reusing
  `idea_bulb.png`; `idea_bulb` stays for its three Reactions.
- Proposed, agent: `animation:save` is not used; drafts promote from files.
- 2026-10-09, agent (within approved outcome): the `thumbs-up` preset's fitted
  thumb exceeded the thumb joint's hard limit (−69° to −70° vs −60°) on both
  Included Avatars, so every clip using it failed `check`. The thumbs-up thumb is
  now held in the natural range with its tip bent back; other fitted thumbs are
  held within the hard limits, which changes only fits that were past them. No
  Included clip used `thumbs-up` (baseline unchanged). Reported to the owner.
- 2026-10-09, owner: approve spec, plan and D0–D6 with recommendations, except
  D3: re-animate the unlisted legacy clips in this issue. Each animation is drafted
  by its own sub-agent in parallel, from scratch with the `animama-animation`
  skill or as a revision of the current clip, at the author's discretion.

## Phased implementation

Every code phase: tests first where behavior is observable; phase checks; a
bounded independent review (`sdlc-reviewer`: one full review, at most two repair
rounds) recorded below; commit `<type>(<scope>)[p#]: <summary>`.

### Phase 1 — Hand model (R1–R3)

Issue: #380. Starting revision: `c52edb8a`. Gate: G1.

1. **Branch hygiene.** `git reset --soft bfc0de4f`, keep the plan files, and fold
   the prototype into the first `feat(animation)[p1]` commit (the `wip` commit and
   local merge disappear; the branch becomes `main` + phase commits).
2. **Baseline hashes.** A test helper samples every Included Gesture clip at fixed
   times on both Included Avatars (headless VRM) and hashes quantized canonical
   poses. Generate the fixture in a temporary detached worktree at `bfc0de4f`
   with the helper copied in (`git worktree add --detach <tmp> bfc0de4f`), then
   commit the fixture and helper here; remove the temporary worktree. Untouched
   clips must match after every phase; Phase 5 re-baselines only revised items.
3. **Presets and offsets.** Review and finish `handPresetIds.ts`/`handPresets.ts`
   (12 presets; `HAND_DIGITS`; offset limit; existing seven unchanged).
4. **Schema and vocabulary.** `schemaV2.ts` `fingers` validation with JSON paths;
   vocabulary fixture gains digits, offset fields and limit; `v2Vocabulary.test.ts`
   and `tests/test_pose_clip_v2.py` assert them; backend `V2_HAND_PRESETS` and
   `fingers` validation; shared valid/invalid fixtures used by both suites; a
   backend test validating every tracked Included Gesture clip; a package
   export→import round trip keeping `fingers`.
5. **Creator round trip.**
   - `BeatPose` gains `hands?: Partial<Record<Side, HandShape>>`. The Hands panel
     records preset, Curl and Spread intent on the clip inline edit;
     `commitClipInlinePoseEdit` passes it; `setBeatPose` writes or replaces the
     beat's hand key from it and excludes those fingers from decomposition. The
     live preview of Curl/Spread uses `handShapeRotations(key)` so preview and
     result match.
   - Finger-bone edits at a beat with a hand key (dt 0) become `fingers` offsets,
     decomposed against preset + Curl + Spread as fitted on the editing Avatar.
     A beat without a key gets one from the sampled nearest key's preset. Edits
     offsets cannot express (finger twist, non-proximal splay, thumb-distal
     abduction or twist, beyond ±90°) become joint tracks for those bones; a
     thumb-metacarpal edit becomes a rotation track. Either track is keyed at
     every hand key with the currently sampled values, so other beats keep their
     shape (sampler overrides hand shapes with finger tracks; a metacarpal track
     changes thumb fitting at every key).
   - Replace `beatEditing.test.ts` "turns a preset hand into finger keys before
     editing a finger"; add tests on both Avatars.
6. **Docs.** `hands-and-face.md` (presets, offsets, when finger `joints` are still
   right, contact shapes); new ADR (next number) superseding ADR 0014 point 4 for
   hands, cross-linked from 0014.

Checks: `pnpm exec vitest run src/lib/avatar/poses src/ui/pose-creator src/stores
src/lib/avatar/motion-authoring` (from `src/frontend/web`); `uv sync --python
3.12.13` then `uv run pytest -q tests/test_pose_clip_v2.py
tests/test_content_package_capabilities.py`; baseline hashes match.
Completion: R1–R3 tests pass; pinch/OK tip gap < 1 cm on both Avatars; review
passed.

#### Code Review #1 Findings

Reviewed 2026-10-09: uncommitted working tree on `ba23f02d` (baseline `bfc0de4f`),
excluding `anatomy/arms.ts`/`arms.test.ts` (Phase 2) and `.animama-drafts/`.
Independent `sdlc-reviewer` analysis with scratch probes; lead finding P1-R1-11
from draft `check` evidence.

- **P1-R1-01 (required):** `poseCreatorHandInteraction.ts:122-123` with
  `setBoneDraft` (`pose-creator-store.ts:2325`): a shape recorded for the inline
  edit is reused unchanged after a later Bones/gizmo finger edit, so the next
  Curl/Spread silently discards that edit (probe: preset fist → index distal +40°
  → Curl +5 ends 35° from the bend). Violates R3.
- **P1-R1-02 (required):** `poseCreatorHandInteraction.ts:297-371`,
  `beatEditing.ts:1121-1140`: Curl/Spread on a keyed hand places every finger of
  the side at the shape, including bones with their own tracks, bones offsets
  cannot express (twist) and unselected bones; probes lose a tracked twist and a
  gizmo twist. Violates R3 ("affected bones only"); regression from `bfc0de4f`.
- **P1-R1-03 (required):** `scripts/animation-render/render.ts:179` fails
  `pnpm -s prettier:check`.
- **P1-R1-04 (optional):** a beat without its own key gets offsets fitted only for
  edited bones; untouched fingers shift up to 3.9° at mid-key beats; docs say
  "offsets for the whole hand as shown".
- **P1-R1-05 (optional):** `scripts/animation-render.mjs:114-116` usage text lists
  side close-ups; actual views are front, ¾, below and palm.
- **P1-R1-06 (optional):** `handPresets.ts:353-368` runs `fitPinch` four times
  per side; ADR 0019 says once per hand key.
- **P1-R1-07 (optional):** ADR 0019:75-77 claims offsets give the same rotation on
  every Avatar; false for the fitted pinch/ok index.
- **P1-R1-08 (optional):** `HandDigitOffset` duplicates
  `AnimaPoseClipHandDigitOffset`.
- **P1-R1-09 (optional, Phase 4):** `SKILL.md:102-103` still says finger joints
  only for shapes presets cannot make.
- **P1-R1-10 (optional):** no tests for the `--view hands` render path or nearest
  key across a loop seam; baseline failures report hashes only.
- **P1-R1-11 (required, lead):** the existing `thumbs-up` preset fits
  `ThumbProximal.curl` to −68.9° (right) / −70.1° (left) on Y_0, beyond the −60°
  hard limit, so any clip using it FAILs `check` (reproduced with a bare key by
  three draft authors).

#### Code Review #1 Revisions

2026-10-09, repair round #1 (one of two allowed):

- **P1-R1-01 accepted, fixed:** a recorded shape is refit to the shown fingers
  before each Curl/Spread (`beatHandShape` takes the recorded shape and returns
  `{shape, unshaped}`). Probe now ends 5.00° from the bend. Test "keeps a bone edit
  through a later Curl".
- **P1-R1-02 accepted, fixed:** Curl/Spread moves only selected bones; the shape
  drives a selected bone only when it reproduces it within 0.5° and it has no own
  track; others turn per bone as in Pose editing (shared `fitShownHand`). Tests
  cover tracked bones, gizmo twist (fallback track keyed at every hand key) and
  partial selection.
- **P1-R1-03 accepted, fixed:** `render.ts` formatted; `pnpm -s prettier:check` clean.
- **P1-R1-04 accepted as documentation:** the nearest-fit approximation for
  untouched fingers at a keyless mid-key beat is documented in `setBeatHand` and
  `avatar-animation.md` (holding them would add tracks for unedited fingers).
- **P1-R1-05 accepted, fixed:** usage text lists front, ¾, below and palm.
- **P1-R1-06 accepted, fixed:** pinch is fitted once per hand shape
  (`HandShapeFits`); ADR wording now accurate.
- **P1-R1-07 accepted, fixed:** ADR 0019 says offsets add the same component
  change to each Avatar's fitted preset.
- **P1-R1-08 accepted, fixed:** `HandDigitOffset` defined once in `handPresetIds.ts`.
- **P1-R1-09 deferred to Phase 4** (skill `SKILL.md` decision rules), as planned.
- **P1-R1-10 partly accepted:** loop-seam nearest-key test added; the `--view
  hands` path is exercised by the checks run (render of `wave-hello`), a browser
  test is not added; baseline hash failures stay hash-only (the clip and Avatar
  are named, which suffices to reproduce).
- **P1-R1-11 accepted, fixed:** fitted thumbs are kept inside the thumb's natural
  range (`withinNaturalRange`); the thumbs-up thumb tip bends back 25°. Thumbs-up
  ThumbProximal.curl is now −50.0° on both Avatars and sides; renders still read
  upright. Only the three thumbs-up digests changed (deliberate, commented); a new
  test keeps every joint of all 12 presets within hard limits on both Avatars.
  This deviates from R1's "existing seven keep their exact shapes" for
  `thumbs-up` only, because its old fit violated joint limits (Decision Log).

Evidence after repairs: `tsc -b` clean; full web vitest 418 files / 3298 passed;
`pnpm -s prettier:check` clean; `pnpm web:lint` clean; included-clip baseline
unchanged. Earlier checks run (before repairs): `pnpm check`, `make check-test`
(3413 passed), script and browser tests, both render paths.



#### Code Review #2 Findings

Targeted recheck 2026-10-09 (`sdlc-reviewer`, probes in the session scratchpad).
Resolved: P1-R1-01, 03, 05, 06, 07, 08, 10; P1-R1-04 documentation accurate;
P1-R1-02 resolved for the reported cases; P1-R1-11 resolved for `thumbs-up`.

- **P1-R2-01 (required):** `withinNaturalRange` clamps every fitted thumb, so
  `fist`, `point`, `peace` and `open-together` change (1.5–9.3°) whenever the thumb
  metacarpal differs from Relaxed Rest's; 46 of 126 changed thumbs were within hard
  limits before. Records claimed only `thumbs-up` changes. Included content is
  unaffected (baseline passes).
- **P1-R2-02 (required):** at a beat without its own hand key the blend error
  alone exceeds the 0.5° rule, so whole-hand Curl/Spread, partial Curl and plain
  Bones curls create fallback finger tracks with zero offsets (key and tracks
  disagree); a regression from the P1-R1-02 fix.
- Optional: `avatar-animation.md` cites "up to about 4° in tests" without a test.

#### Code Review #2 Revisions

Repair round #2 (last allowed), 2026-10-09:

- **P1-R2-01 accepted, fixed:** fitted thumbs are held within the thumb joint's
  hard limits (`withinJointRange(…, "hard")`), so a fit inside them is bit-for-bit
  unchanged; only `thumbs-up` uses the natural range (curl −50°, tip −25°). Probe
  over 7 presets × 27 metacarpal sets × both Avatars, sides and Curl variants:
  differences are only `thumbs-up` and 80 fits whose `bfc0de4f` value was past
  the hard limit; all 12 presets stay within hard limits for every set. New tests
  pin a within-limit fit to its `bfc0de4f` quaternion and clamp an unreachable
  one; ADR 0019 decision 2 and consequences updated.
- **P1-R2-02 accepted, fixed:** a bone falls back only when the edit itself is
  not expressible (`isOffsetExpressible` on the change, or offsets past ±90°),
  not because of the blend approximation; missed bones still get their closest
  offsets so the key and track agree. Probes: whole-hand Curl/Spread, partial
  Curl and Bones curl at a keyless beat create 0 tracks; a twist creates only its
  own fallback track; earlier probes unchanged. Tests on both Avatars and through
  the real Hands tool on A_1.
- Optional nit fixed: `avatar-animation.md` now says "a few degrees"; the code
  comment cites the asserted 4.5° bound.

Evidence: `tsc -b` clean; vitest poses/pose-creator/stores/action-editor/
motion-authoring 74 files, 919 passed; anatomy/animaPoseClip/motion-authoring
394 passed; included-clip baseline unchanged; prettier and eslint clean.

#### Code Review #3 Findings

Final targeted recheck 2026-10-09: **pass.** P1-R2-01 resolved (31,752 bones
compared with `bfc0de4f`: only `thumbs-up` and fits past the hard limit differ;
all 12 presets within hard limits for every metacarpal set). P1-R2-02 resolved
(keyless whole/partial Curl, Spread and Bones curls create 0 tracks; twists only
their own track). No regressions. Non-blocking: one long ADR line (wrapped);
the P1-R1-11 revision entry is superseded by Revision #2.

### Phase 2 — Contact solver, schema and checks (R4, R5, R6 retiming, R7, R8)

Issue: #381. Starting revision: Phase 1 commit. Gate: G1.

1. **Schema** (frontend, backend, shared vocabulary and fixtures): contact `point`
   and `targetPoint` (`joint|palm|tip`; `palm` on hands, `tip` on fingers),
   `facing` (palm toward target; check-only), `solve: { blendIn?, blendOut? }`
   (0–2 s, default 0.15); solved effector is a hand or finger bone; target not on
   the same arm; solved windows on one side must not overlap (ramps shorten to
   meet midway, loop-wrapped); time fields at time precision. Package
   export→import round trip keeps `point`, `targetPoint`, `facing` and `solve`.
2. **Solver** `lib/avatar/poses/anatomy/arms.ts`: `CanonicalSkeleton` (parent map,
   VRM 0 `(-x,y,-z)`), contact-point helpers shared with checks, Avatar `scale`
   (reference height 1.25 m), `contactSolveWeight` (smootherstep, loop wrap),
   `ArmReachSolver` (elbow change as a pre-multiplied rotation about the forearm
   flexion axis, smallest change; minimal upper-arm swing; authored swivel kept;
   reach and flexion clamped).
3. **Preparation:** solvers built when `vrm` is set and the clip has solved
   contacts; solve after legs from the final pose; dependent sides ordered, one
   extra pass for mutual contacts; `solveContacts` option (default true).
4. **Retiming:** `moveBeat` maps solved contact windows piecewise through old and
   new beat times, then `fitContactsToClip`; unsolved contacts move as today.
5. **Checks:** contacts at `point` with scale; solved tolerance 1.5 cm
   ("unreachable on this Avatar"); parity on unsolved preparation; per-Avatar
   range/smoothness on solved arm joints; WARN reach correction > 8 cm; WARN
   `facing` > 45°; finger collisions (finger capsules against other fingers, palm,
   other hand, outside declared contacts); oscillation WARN as defined in R8,
   tested so a 3 Hz bounce and Wave Hello pass and the current laughs warn; WARN
   solved head contact with unmuted head/torso layers.
6. **Docs:** `avatar-animation.md` contacts, `clip-format.md`,
   `checks-and-review.md`, `human-movement.md` (laugh rhythm), the ADR.

Checks: new `arms.test.ts` on both Avatars (palm, tip and joint onto head, hips
and the other forearm; authored target returns the authored pose; swivel kept;
unreachable clamps; mutual contacts within 1 cm); `prepareV2`, `schemaV2`,
`beatEditing` (incl. pins at `beatEditing.test.ts:356-421`), store, `legs.test.ts`,
`checks.test.ts`, `includedGestures.test.ts` (WARNs allowed, no new FAIL);
backend tests; baseline hashes match.
Completion: tests pass, review passed.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 3 — Drafts and owner preview review (R10, R11, R13; gate G2)

Issue: #382. Starting revision: Phase 1 commit (drafts without
contacts) or Phase 2 commit (drafts with contacts). Gate: D1–D6 answered.
Completion: G2 approval of every Gesture and the effect by name.

Drafts live in `.animama-drafts/hand-animation-gestures/` (ignored). One sub-agent
per animation, run in parallel, follows the `animama-animation` skill and either
authors from scratch or revises the current clip (copied from
`library:included/<slug>`), depending on the size of the change; a consistency
pass across all drafts follows.
Per item: `pnpm -s animation validate`, `check` (no FAIL; WARNs explained),
`animation:render` body and `--view hands` sheets on both Avatars (`--side left`
where relevant).

- Solved contacts with `palm`/`tip` points: Arms Crossed and Pout Huff (palms on
  forearms), Hands on Hips (`facing` toward the hips), Thinking Chin and Have an Idea (fist→chin; right elbow
  into the upturned left palm via left supination, `facing` up), Right Face Palm,
  Blow a Kiss and Blow a Kiss 2, Salute, Excited Triple Clap (palm→palm, ramps
  ≤ 0.12 s).
- Orientation: Face Palm, Kiss (`facing`); Small Wave palm toward the viewer
  (checked in renders) with the wrist about shoulder width out.
- Laughs: rewrite pulse keys (3–4 per burst, 2.5–3.3 Hz, decay, stagger; remove
  Medium's forearm flap); keep the structures pinned by `beatEditing.test.ts`,
  `pose-creator-store.v2.test.ts` and the generated-gesture e2e, or update those
  tests deliberately in Phase 5.
- Pins to preserve: Arms Crossed stays a loop with beat `end` and a whole-clip
  first contact owned at 0; Thinking Chin keeps `basePose`; Right Face Palm has no
  pops (`checks.test.ts:371-379`).
- Re-animations (Finger Heart Pose per D5, Right Finger Point and Salute per D4,
  and the D3 legacy clips: thumbs up/down, double thumbs, Left OK and Peace Sign,
  Double Peace Pop, Thinking Hand on Chin): re-posed within joint limits, fades,
  mutes and `plantFeet`, loop kinds kept. Thinking Hand on Chin is pinned by
  `checks.test.ts:233-245` (face intersection without a contact); keep that test's
  intent with a fixture copy of the current clip or update it in Phase 5.
- Cat Monster Rawr and Cheeky Finger Guns per the spec.
- New: Blow a Kiss 2; Have an Idea with `idea_bulb_fingertip` (effect drafted with
  the `animama-avatar-vfx` skill, `pnpm -s effects check`, placement via
  `effects:render <effect folder> --with-clip <clip> --times …`). For preview, the
  draft effect sits in a scratch Local root
  `<root>/vfx/avatar/idea_bulb_fingertip/` with a `content_id`, and Have an Idea is
  previewed as a project file with a `ref` dependency and `--local-content <root>`
  (the scratch descriptor needs `content_id` and `content_type: "avatar_effect"`).

Gate G2: `pnpm -s animation:preview <first draft>`; the owner switches items and
Compare (`library:included/<slug>`) in the pickers; notes are applied and closed
with `pnpm -s animation resolve`; repeat until the owner approves each Gesture and
the effect by name. Commits in this phase: plan evidence only
(`docs(animation)[p3]`).

### Phase 4 — Creator write-back for solved arms and promotion tooling (R6 edits, R9)

Issue: #383. Starting revision: Phase 2 commit (may run in parallel
with Phase 3). Gate: G1. Completion: tests pass; review passed.

1. `setBeatPose`: `sampleAt` uses unsolved samples; inline commits convert edits
   at solved beats into local changes on the authored arm
   (`authored · before⁻¹ · next`); by-value inputs unchanged. Tests with a VRM
   context on both Avatars.
2. `animation promote`: `add` writes given `dependencies`; `name` and `loop`
   changes only with an explicit `rename`/`loopChange` field; tests in
   `scripts/animation-promote.test.mjs`. Rename-only legacy items are edited by
   hand (meta and clip `name`) so their owner-authored licence rule stays.
3. Skill: `promote.md`, `SKILL.md` decision rules; document `--view hands`.

Checks: store, `beatEditing`, `node --test scripts/*.test.mjs`. Review as above.

#### Code Review #1 Findings

#### Code Review #1 Revisions

### Phase 5 — Promotion, registries and final validation (R12, R13; gate G3)

Issue: #384. Starting revision: Phases 3 and 4 complete. Completion:
all acceptance criteria in the spec met except merge approval.

Gate G3: the owner approves the licence and source-review wording and the promote
`--dry-run` file list (mode and identity per item) before any write to
`content/included`.

1. Order: `effects promote` add `idea_bulb_fingertip`; `animation promote` add
   Have an Idea (with `ref: builtin:avatar-effect:idea_bulb_fingertip`) and Blow a
   Kiss 2; `animation promote` replace for each revised item (with rename/loop
   fields where listed); hand edits of display names for rename-only items.
2. Remove the `shy-finger-poke` and `storytelling` folders, storytelling's own
   licence rule (`inventory.json`; `shy-finger-poke` falls under the generic
   `gestures/**` rule, which stays) and both items' source-review records; starter policy v1, `EXPECTED_STARTER_GESTURE_IDS` and
   both starter-count pins (`tests/test_anima_starters.py:450,476`) per D2, in one
   commit with the content.
3. Registries: manifest names, durations and loop kinds (+ backend copy sync);
   `MOTION_CHECK_EXEMPT` for re-animated items; count pins
   (`includedGestures.test.ts`, `catalog.content.test.ts`); effect picker template
   and thumbnail `assets/effect-templates/idea_bulb_fingertip.webp`
   (`pnpm -s effects:thumbnails`) with its source-review record (D6).
4. Tests and journeys: retarget `accountless-library.spec.ts` and
   `playback-library.spec.ts` (Have an Idea for Gesture `avatar_vfx`; a Reaction
   such as `curiosity-3` for scene effects; drop the stale `sfx-cute-slide`
   assertion), the discard specs, `tests/test_included_content_catalog.py`,
   `tests/test_starter_content_closure.py`, `tests/test_non_portable_packages.py`
   if affected; re-baseline hashes for revised items.
5. Docs: `content/included/README.md:53`, `docs/frontend/testing/browser-journeys.md:158`,
   `clip-format.md` examples.
6. `git add`/`git rm` before backend tests and desktop staging (they read tracked
   files only).

#### Code Review #1 Findings

#### Code Review #1 Revisions

## Final integration review

One full `sdlc-reviewer` pass over the PR against the spec, at most two repair
rounds; then the owner's merge approval of the exact revision.

## Validation and acceptance

From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
`pnpm desktop:runtime:stage`, `pnpm desktop:runtime:audit`. From the repo root:
`uv run pytest -q`, `make check-test`, `uv run ruff check`, `make format-check`.
E2E and a chat check on a task stack (`./reset.sh --name hands --base-port <p>`),
URL recorded: `accountless-creator-generated-gesture` and the retargeted journeys.
This change class needs full hosted Validation, which is disabled; the PR records
`Validated revision: … · baseline: bfc0de4f`, local evidence, hosted Validation
not run, and asks the owner to accept local evidence explicitly.

## Idempotence and recovery

- Phases 1, 2 and 4 change code only; reverting a phase commit restores the prior
  behavior. They change how existing clips are edited in the creator (hand keys,
  solved-contact windows) but not how they play (baseline hashes).
- Drafts live in `.animama-drafts/`; promotion is the only write to
  `content/included`, once per item after G3, after a `--dry-run`.
- Removals break explicit equips of the removed items (Loadout warning, export
  blocked) and invalidate in-progress Anima creation drafts; recover by removing
  the binding or resetting a development database at the owner's discretion.

## Outcomes & Retrospective

Not started.
