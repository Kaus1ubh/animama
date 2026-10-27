# Avatar Effects and Reactions on common third-party VRM layouts

Status: Agreed
Snapshot of https://github.com/raymond-van/animama/issues/760 (published 2026-10-27T22:33:52Z,
captured 2026-10-27T22:40:07Z after the owner's agreement); the issue is
authoritative.
Owner decision: The owner asked for this issue and its ExecPlan on 2026-10-27,
after reviewing the survey below, as its own PR after PR #744, and on the same
day accepted the proposed answers to Q1–Q3 and the plan.

## Problem and intended users

Issue #691 (PRs #740 and #744) made Animama's runtime read face parts, moods,
hands and materials from model data rather than VRoid names. A survey on
2026-10-27 tested how far that generalizes. It rendered the same 16 Included
Avatar Effects, 6 Reactions and 9 Gesture renders on nine third-party VRMs and
checked every frame by eye. The VRMs came from the sources users most often
bring:

| Avatar | Source and layout |
| --- | --- |
| Alicia Solid | UniVRM VRM 0; separate face and eye meshes |
| RadDollV3 | BOOTH VRChat Avatar, the author's VRM 0; separate face, hair and accessory meshes |
| ふぁふぁ (own VRM and our conversion) | BOOTH VRChat Avatar; eyes inside the face primitive; MMD morphs |
| HAOLAN (our conversion) | BOOTH VRChat Avatar; blink only as left and right shapes |
| Maromage | BOOTH VRChat Avatar, VRM 0; eyes inside the face primitive; MMD names stored per primitive |
| Olivia, Polybot (100Avatars, CC0) | One mesh, one material for the whole body; painted face |
| Carol North (Xmas Chibis, CC0) | One mesh; painted eyes; chibi proportions |

Results on PR #744's revision `9a97029a` (effects correct of 16, Reactions
correct of 6; Gestures played on every Avatar):

| Avatar | Effects | Reactions | What goes wrong |
| --- | --- | --- | --- |
| Included Avatars, converted test Avatar, Alicia Solid | 16 | 6 | Nothing |
| RadDollV3 | 6 | 2 | Eye, blush, tear, under-eye and kiss art reports success but draws nothing; the w mouth lands on the cheek |
| Maromage | 3 | 0 | No eye found; MMD names unreadable; the joy sparkle is hidden in the head |
| ふぁふぁ (both) | 2 | 1 | No eye found; petrified cracks show without their crack lines |
| HAOLAN | 1 | 1 | No face found because there is no `blink` preset; no idle blink |
| Olivia | 1 | 0 | No face found in a whole-body mesh; the joy sparkle is hidden |
| Carol North | 0 | 0 | No eye found; the whole body is taken as the face, so Red Face tints her clothes; head art lands on her cheek |
| Polybot | 0 | 0 | No face found; head art lands on the robot's face |

The review renders reported most of the RadDollV3, Carol North and Polybot
failures as passes: they fail only when an effect is skipped or warns, not when
it draws nothing or lands in the wrong place. Their face camera also misses the
face on chibi and robot proportions.

Users who upload VRChat conversions, BOOTH models and low-poly Avatars benefit.
Their Avatar should wear the same effects and Reactions as an Included Avatar,
and when a part truly cannot be found, Diagnostics should say so instead of an
effect silently drawing nothing.

## Goals, scope and non-goals

In scope, by requirement:

- **R1 Face signals beyond VRM presets.** Face skin and eyes are found when
  blinking comes only from left and right blink shapes, ARKit `eyeBlink*`,
  MMD まばたき or VRChat `vrc.blink_*`, and the mouth only from VRChat
  `vrc.v_*`, MMD あいうえお or ARKit shapes.
- **R2 Eyes without separate eye geometry.** Eyes inside the face primitive,
  and eyes painted on the skin, get eye positions and regions from the blink
  area, eye bones or look-at data, so eye effects, blush and under-eye anchors,
  and forehead and hover placements work.
- **R3 Face inside a whole-body mesh.** When one primitive holds the whole body,
  the face is the head region of that primitive. Face effects stay on that
  region and never tint the body or clothes.
- **R4 Painted art that shows.** Art an effect paints on the face lands where
  the face texture is visible. When an applied effect would draw nothing or
  land outside the face, Diagnostics warns instead of reporting success.
- **R5 Blink and lip-sync fallbacks.** Idle blinking, Gesture blinks and
  lip-sync work on Avatars without VRM `blink` or viseme presets, using the
  same signals as R1. Empty VRM 0 preset clips count as missing.
- **R6 Per-primitive shape names.** Shape names a file stores per primitive
  rather than per mesh are read, so MMD and ARKit content can use them.
- **R7 Size-aware placement.** Head art, Reaction sparkles, eye overlays,
  hand-to-face contacts and Particle Effects follow the Avatar's measured head,
  eye and body size, so big-headed and chibi Avatars keep art beside the head
  and hands on the face. The chat's Portrait and close camera presets frame the
  face from the measured head; today they use fixed offsets from the head bone
  and show the chin or chest of chibi and robot Avatars.
- **R8 Rig and material fallbacks.** Contacts fall back from missing optional
  bones (`upperChest` to `chest`, distal to intermediate finger bones), and
  Diagnostics lists missing optional bones. Plain glTF materials with metallic
  set do not render dark, and silhouette effects respect lilToon cutout.
- **R9 Review renders that catch wrong art.** `effects:render` fails when an
  applied effect changes no visible pixels in its target region, or changes
  pixels mostly outside it. Its face view, the chat's Portrait preset, follows
  R7's framing.

Non-goals:

- New Avatar Effects, Reactions or Gestures, or retuning existing content.
- The VRoid iris layout default and the VRoid-only enhanced look (decided in
  #691).
- A manual editor for marking face or eye regions (see Q1).
- Non-humanoid rigs and Avatars without a VRM humanoid.
- Animama Cloud changes, beyond noting any repin the change needs.

## Required behavior

- An Avatar whose face, eyes or mouth are found through any R1–R3 signal shows
  them in Diagnostics as found, with the signal that found them.
- Every Included Avatar Effect and Reaction on an Avatar either draws correctly
  or is skipped with a Diagnostics warning that names the missing part. None
  reports success while drawing nothing or landing off the face.
- Face effects on a whole-body mesh draw only on the head region; body effects
  are unchanged.
- An Avatar that blinks only through left and right shapes, ARKit, MMD or
  VRChat shapes blinks idly and in Gestures; one whose visemes exist only as
  VRChat, MMD or ARKit shapes moves its mouth while speaking.
- Head art and Reaction sparkles stay outside the head silhouette on chibi,
  big-headed and hooded Avatars, at a size proportional to the head.
- Detection runs once at load; nothing in this work adds per-frame cost for an
  Avatar that needs no fallback.

## Constraints

- **Included Avatars unchanged:** the same detected parts, landmark and anchor
  snapshots, and 0 differing pixels in review renders of the affected effects,
  Reactions and Gestures, unless the owner accepts a specific change.
- **Licences:** tests use synthetic fixtures or Included Avatars with synthetic
  additions. No third-party Avatar files, renders or shape data enter the
  repository, issues or PRs; evidence from third-party Avatars is counts and
  pass/fail only. Owner review uses private renders.
- **Load time:** detection stays within a few milliseconds per primitive;
  Included Avatar load time does not regress measurably.
- **Localization:** new Diagnostics text comes from the catalogs in every
  supported locale.
- **Persistence:** no new persisted settings are expected. If one becomes
  necessary, it follows the content kind registry and the compatibility rules
  #691 used.

## Acceptance criteria

- [ ] Synthetic-fixture tests cover each layout: blink only as left and right
  shapes, ARKit-only, MMD-only and VRChat-only signals; eyes inside the face
  primitive; painted eyes with eye bones; a single whole-body primitive;
  per-primitive shape names; big-head proportions; missing optional bones.
- [ ] Included Avatars: detected parts and anchors unchanged, and review renders
  of the 16 survey effects, 6 Reactions and 9 Gesture renders at 0 differing
  pixels against `main`.
- [ ] `effects:render` fails on a synthetic case that applies but draws nothing,
  and on one that draws outside the face; the chat's Portrait preset (and so
  the review face view) frames a big-headed synthetic Avatar's face.
- [ ] Survey re-run on the owner's private set, checked frame by frame, with
  counts in the PR: every effect and Reaction on every survey Avatar draws
  correctly or is skipped with a named Diagnostics warning; none reports
  success wrongly. Targets: Alicia Solid and the converted test Avatar stay at
  16/16 and 6/6; RadDollV3, ふぁふぁ (both), Maromage and HAOLAN reach 16/16 and
  6/6; Olivia, Polybot and Carol North keep every face effect on the head.
- [ ] Owner check in the app: an Avatar without a `blink` preset (HAOLAN) blinks
  idly and moves its mouth while speaking; owner review of the private survey
  sheets.
- [ ] Diagnostics strings in every supported locale; `pnpm i18n:check` passes.

## Open questions and decisions

- **Q1 Manual face marking.** Should users be able to mark the face or eyes by
  hand when detection fails? Decided 2026-10-27 (owner): no; Diagnostics
  explains the failure, and a manual editor is a separate request.
- **Q2 CC0 fixtures.** Olivia, Polybot and Carol North are CC0. Should a small
  CC0 Avatar enter the repository as a test fixture? Decided 2026-10-27
  (owner): no; synthetic fixtures stay the rule, and CC0 Avatars stay in the
  private survey.
- **Q3 Material and rig fixes (R8).** Decided 2026-10-27 (owner): include them
  as the last phase, deferrable to their own issue if the earlier phases run
  long.

## Spec

This issue.

## ExecPlan

`docs/plans/arbitrary-vrm-effects/arbitrary-vrm-effects-execplan.md` on branch
`feat/arbitrary-vrm-effects`, linked at its reviewed revision once pushed.

## Delivery links

Follows #691 (PRs #740, #744). One PR, after owner review of this spec and its
plan.
