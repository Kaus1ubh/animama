# Twenty-two additions to the companion content library

Source agreement: the owner approved the forty-item proposal on 2026-10-13 and requested skill-led batch authoring, four concurrent authors, and live previews before Included promotion.
Spec authority: [#523](https://github.com/raymond-van/animama/issues/523), read back at `2026-10-14T01:22:12Z`. P1 issue: [#524](https://github.com/raymond-van/animama/issues/524). P2: [#544](https://github.com/raymond-van/animama/issues/544). P3: [#545](https://github.com/raymond-van/animama/issues/545).
Authorized scope: save and verify the 22 retained drafts through their creators, promote the exact verified Local items to Included, and open a PR for review. The owner authorized this scope on 2026-10-14 after three review rounds. Sixteen drafts are removed and the two uncreated Gestures are deferred. Reviewed content remains silent. The owner approved the exact licence/source-review entries presented for these 22 items on 2026-10-14, and subsequently approved shipping all 22 in desktop core while keeping starter loadouts unchanged. During PR review the owner also directed shipping the 23 existing expanded Included items in desktop core so it matches self-host. Do not merge or release.

## Purpose and context

Add four Gestures, fourteen Avatar Effects, one Scene Effect and three Particle Effects after owner review reduced the original forty-item proposal. The set expands everyday physical behavior, quiet conversational comedy, concentration, recovery, cold and musical/whimsical motion. Existing hearts, sparkles, greetings and broad emotion reactions remain available for reuse. Creator verification also requires a narrow runtime correction: a cold Gesture load must play its authored duration instead of expiring at the planner's two-second fallback.

Starting source: `4ea605436631b1c9c4166585153387a68d9241a1`. Branch: `feat/companion-content-40`, in the task's assigned worktree. Before promotion the branch advanced to `19919ded805fecec0ed257d26157728b809aa04a` to use the merged creator CLI fix from #528. The baseline source catalog had 107 Gestures, 75 Avatar Effects, 26 Scenes and 16 Particle Effects. This promotion raises those totals to 111, 89, 27 and 19; desktop core selection is a separate packaging decision. The optional Mixamo pack retains its 35 additional clips.

## Approved items

| ID | Name | Performance or visual brief |
| --- | --- | --- |
| G2 | Noted | Mimes writing a short note on the open palm, looks up and nods. Use for acknowledging and remembering a request or detail. |
| G4 | Tut-Tut Finger Wag | Wags a raised index finger with an exaggerated disapproving face, then softens into a playful smile. Use for teasing correction or mild admonishment. |
| G5 | Double Take | Glances aside, turns back in surprise and leans closer with open hands. Use for disbelief, an unexpected reveal or a comic second look. |
| G9 | Ready Lets Do This | Clenches and clasps each fist in turn, rolls the shoulders, then raises the fists with an enthusiastic smile. Use for motivation, agreement to a challenge or getting ready to act. |
| A1 | Awkward Ellipsis | Three dots appear one by one in a small manga speech balloon beside the head, then hold for an awkward pause, a deadpan response or a joke that did not land. |
| A5 | Ticking Fuse | A short cream fuse burns down above the head to a final orange sputter, for patience running out or comic irritation. |
| A6 | Suspicious Side-Eye | Half-lidded ivory eyes look sideways together for skepticism or suspicion. |
| A7 | Blank Dot Eyes | Tiny dark dot eyes hold a blank, awkward pause. |
| A9 | Burning Resolve Eyes | Upright flames kindle over the eyes as golden tongues rise through steady orange roots for fiery resolve. |
| A10 | Money Eyes | Rich emerald dollar eyes spring into place for a bargain, greed or imagined riches. |
| A11 | Knockout X Eyes | Tapered ink X eyes spring into a dazed tilted settle for comic defeat and overload. |
| A12 | Calculating Glasses | Opaque manga spectacles catch a moving reflection, for a calculating plan or knowing observation. |
| A13 | Broken Heart | A coral heart on the chest splits, recoils and droops for heartbreak or comic disappointment. |
| A14 | Mended Heart | A split coral heart joins beneath an ivory bandage and beats gently for comfort and recovery. |
| A16 | Gray Silhouette | A neutral gray silhouette fades over the Avatar for stunned or deflated reactions, keeping the original contours and faint facial detail. |
| A17 | Twitching Cat Ears | Refined silver nekomimi ears twitch left and right, then relax into a bashful pose. |
| A18 | Little Devil Horns | Two short crimson horns spring up for an impish idea or playful mischief. |
| A19 | Tiny Victory Crown | A small gold crown drops crookedly, wobbles and settles after a little victory. |
| S4 | Awkward Silence | An empty warm-grey pause with a large tumbleweed rolling along the lower edge and thin wind curls drifting past. |
| P2 | Snow Crystal Flurry | Faceted ice-white snow crystals descend at varied depths, turning gently as their cyan facets catch small glints. |
| P3 | Musical Cascade | Glossy raspberry and aqua musical notes rise beside the shoulders in two loose arcs, followed by a few pearl glints. |
| P5 | Butterfly Flutter | Four luminous butterflies flutter upward in two staggered pairs. |

The owner removed sixteen drafts during review. Worlds Tiniest Violin and Sneeze and Recover were not authored and are outside this delivery.

## Progress

- [x] Inspected clean assigned checkout and created task branch at verified source.
- [x] Restored tracked LFS inputs from the existing cache; installed frozen frontend dependencies offline.
- [x] P1: Author and present the 22 retained drafts under the owner-reduced scope; archive 16 rejected drafts and defer 2 uncreated Gestures.
- [x] Owner live review, feedback and acceptance of the 22 retained items.
- [x] P2: Save all 22 through creators, read back/reopen and compare with the reviewed sources; validate saved items on both Avatars.
- [x] P2: Verify transient coordinated creator playback and cleanup with saved Avatar/Scene/Particle dependencies.
- [x] P2: Complete the four Gestures' test-Anima chat-path check for timing, expressions and restoration after repairing cold-load timing; source tests cover mute behavior, without a quantitative browser mute measurement.
- [x] Owner approval to promote the 22 retained silent items and open a PR without merge.
- [x] Exact licence/source-review wording approval required by the promotion skill.
- [x] P3: Promote the exact saved 22 items and apply the approved licence records.
- [x] P3: Include all 22 in desktop core without changing starter loadouts; actual native stage and byte verification pass.
- [x] P3: Finish catalogue integration and all required local checks; prepare the single PR handoff.
- [x] Final independent receipt closure passes, including actual native staging.
- [x] PR publication: #557 opened without merge. Merge remains owner-gated.
- [x] Owner-requested scope addition: ship the 23 remaining expanded Included items in desktop core so it matches self-host.

## Decision Log

- 2026-10-13, owner: all forty concepts approved for authoring; live review precedes promotion.
- 2026-10-13, agent: this session supports three concurrent subagents plus the lead. Four authoring lanes will be used, one item per lane at a time; no nested authoring agents. The execution limit was disclosed to the owner.
- Drafts are silent. Sound choices remain a separately reviewable part of Included promotion. No default loadout or live Anima is changed.
- 2026-10-13, owner preview feedback: three concurrent subagents are acceptable; Awkward Ellipsis is good, all other presented items are bad. Ellipsis is retained as creatively accepted; G1, S1 and P1 require rework. New-item authoring stopped while the first-batch direction is corrected. S2 and an initial G2 draft already existed when feedback arrived and remain unapproved. This feedback is not Included-promotion approval.
- A standalone particle-checker initialization defect was discovered: the creator's validation calls `getI18n().getFixedT` without web bootstrap in the CLI. The checker now initializes the existing web i18n provider before particle readiness validation. Existing regression command `node --test --test-name-pattern='effects check reviews Particle and Scene Effect folders' scripts/effect-check.browser.test.mjs` passed (1 test, 93s), and the normal P1 check now passes. No app runtime behavior changed.
- After reviewing the rejected sheets, the authors identified a shrug-like G1 arm silhouette, repetitive wave-like S1 scenery and rigid wing-like P1 sprites. A focused second pass is underway on those three only, preserving old versions; further new-item authoring waits for the corrected direction. Optional detailed owner feedback is pending.
- The existing skills supply implementation choices. Gestures use anatomical clip-v2 tracks, planted feet and solved contacts where needed. Scenes use flat motifs with face clearance. Particles use layered glossy art at the Heart Burst quality reference. Avatar artwork names the intended anime gag. No additional creative interview is required for the accepted briefs.

- 2026-10-14: Revisions of G1, A2, S1, S2 and P1 passed their checks and are awaiting a second owner review. A3, A4 and P2 are also checked. Accepted Ellipsis remains unchanged. Nine fixed source snapshots are prepared in `.animama-drafts/owner-review/`; authoring continues separately so unfinished changes do not interrupt owner review. G2, S3 and P3 are underway in the three subagent lanes. No Save or promotion.

- 2026-10-14, owner second review: 27 preview notes request 14 removals and 13 revisions. The removal requests reduce the intended set from 40 to 26 (24 existing retained drafts plus two not yet authored Gestures). Three subagents revise the retained gestures, particle/scene effects and Avatar art; the lead revises heart placement and replaces Stone-Faced Crack with the explicitly selected pale manga silhouette. Removed items and their notes are archived outside the active preview folders. Revisions remain drafts for owner re-review; no Save or Included promotion is authorized by these notes.

- 2026-10-14, second-review handoff: all 27 notes addressed (13 revised drafts, 14 archived removals). The active preview contains 24 items: 4 Gestures, 16 Avatar Effects, 1 Scene Effect and 3 Particle Effects. All 13 revisions pass the appropriate checks on both Included Avatars; three revised Gestures have zero motion findings at 60 Hz. Sampled renders inspected. Butterfly pollen translucency is intentional. Preview effect window is 14 seconds to cover the extended snowfall and tumbleweed. Owner re-review, Save and Included approval remain pending; the two uncreated Gestures are still outstanding.
- 2026-10-14, owner third review: seven new notes request removal of Experiment Soot and Promise Knot, upright evolving flame cels, butterflies without yellow dots, a neutral gray silhouette, and shorter heart previews. The two removals reduce the remaining set to 24 planned items (22 existing drafts plus two uncreated Gestures). Removed drafts and note history are archived. The global `--duration 14` preview override caused the uniform 14.5-second timelines; restarting without it restores four-second Avatar Effect preview cycles and each finite Particle/Scene playback length with a half-second empty replay gap. No runtime or asset duration change is needed for the hearts.
- 2026-10-14, third-review handoff: all seven notes resolved: three content revisions checked and rendered on both Included Avatars with no warnings, two heart preview-duration corrections, and two archived removals. Active set: 4 Gestures, 14 Avatar Effects, 1 Scene and 3 Particle Effects. Browser verified four-second hearts and natural finite effect cycles; independent audit confirmed removal archives and duration behavior. Updated flames, butterflies and Gray Silhouette remain drafts awaiting owner re-review. No Save, equip or Included promotion.

- 2026-10-14, owner promotion authorization: save and verify the 22 retained items through their creators, then promote and open a PR; do not merge. P2/P3 issues #544/#545 track delivery. A separate named production app serves the task source at `http://localhost:8460`. The effect promotion tool assumes owner-authored art; this batch requires narrow agent-authored provenance records instead of inheriting that attestation.

- Creator verification found the same missing translation initialization in `effects save` that the checker had exposed. The CLI web-module loader now initializes web i18n before creator document defaults/validation. The failed run wrote no items; the retry continues through the creators. Existing stack Save regression and bounded tooling review cover this fix.

- All 22 items were saved through the creators and reopened successfully on the isolated app. The four saved Gestures pass validation and motion checks on both Avatars at 60 Hz with zero findings; canonical source comparison preserves their motion, expressions, contacts and timing. All eighteen saved effects pass on both Included Avatars with zero warnings or failures. All 23 PNGs remain byte-identical and all three Particle manifests remain JSON-identical after Save. Creator normalization only adds defaults or removes redundant defaults; the creator-compatible name is `Ready Lets Do This`.
- The local translation patches were superseded by the already-merged #528 implementation. Frozen frontend/Python dependencies and workspace package builds were refreshed after advancing the task baseline; the source catalog and content runtime were unchanged by that advance. Promotion dry-run exposed a separate stale Particle inventory assumption: the CLI required a catch-all rule although the current inventory uses explicit per-effect rules. A narrow compatibility fix and regression check are being prepared.
- The Particle catch-all is now an optional insertion anchor. Each promoted Particle still receives a narrow folder rule, and exact copied-art terms retain precedence. The regression reproduced the original refusal and the related suite passes 43 tests; formatting and independent review pass. Both actual promotion dry runs pass without writing content (52 new content files, two shared licence files).
- Transient creator integration passes on Annie: imported Noted with exact saved pins for Suspicious Side-Eye, Awkward Silence and Butterfly Flutter, observed all three effect lanes active during advancing playback and varying happy/relaxed expressions, then empty effect lanes and zero expressions at 5.05 seconds with no diagnostics. The temporary project was discarded. This establishes creator dependency playback and cleanup, not chat planner arbitration. The debug-only chat check uses the isolated task stack with deterministic model clients.
- Exact licence records and promotion file lists were presented to the owner. On 2026-10-14 the owner replied “Approve these exact records” to the proposal (SHA-256 `3c67e805204e9d9f939b6946ec19ebc8525757f6686d2fb4db120f5a9a9b0e5d`), covering 22 narrow inventory rules and 66 file records. Content-folder rules use `LicenseRef-Animama-agent-authored` and `redistribution_review: pending`; source records retain `prepared-not-release-approved`, and derived thumbnails retain Avatar attribution. This is promotion-record approval, not merge or release approval.
- The chat-path review found a first-use runtime defect: uncached Gesture clips without a metadata duration expire at the planner's two-second fallback. Noted, Tut-Tut Finger Wag and Ready Lets Do This were truncated on their first triggers; the recorded Double Take run was a repeat and played its full 4.8 seconds. All saved clip durations are correct. Fix the async playback lifetime and run-ownership handling, cover cold/delayed/cancelled loads, then repeat the four checks from fresh runtime mounts. Warming the cache is not acceptance.

- The cold-load repair keeps Gesture requests pending until actual playback, derives their horizon from the delivered clip and applies the configured playback speed to the same clock. Ownership/cancellation and existing fades remain intact. Focused tests pass 72/72, adjacent tests pass 110/110, and independent source review found no actionable issue. Four fresh-page first triggers now play their natural 4.8, 5.05, 6.25 and 4.1-second timelines; sampled completion/idle is observed at 5.029, 5.271, 6.278 and 4.092 seconds respectively, with empty queues and the baseline delight expression restored. This is non-TTS planner evidence on Annie; both-Avatar authored-motion checks remain separate.
- The approved 18 effects and four Gestures were promoted successfully from their saved Local sources. Fourteen templates/thumbnails are integrated, and the tool's generic owner-authorship defaults have been replaced with the exact approved records. Existing records remain unchanged.

- Packaging audit found that the existing starter/recommended closure classified all 22 additions (52 content files) as expanded inputs. The expanded pack is deferred, so those items would not appear in the packaged desktop core. The owner explicitly approved including all 22 in desktop core while keeping starter loadouts unchanged. Explicit Library roots now use the existing closure and distribution checks, retaining the separate equipped starter selection and deferred pack policy. The before/after comparison confirms exactly 22 entries/52 files move into core; the final native stage independently verifies those entries and physical bytes.

- 2026-10-14, owner during PR review: desktop and self-host should ship the same Included content. Self-host bind-mounts every Included item, while desktop left 23 existing items in the deferred expanded pack: Streamer Idle and its 12 Gestures, eight Avatar Effects and two focus Scene Effects (43 files, about 1.2 MB). The owner directed adding them to desktop core in this PR. They join `CORE_LIBRARY_ROOTS` through the same admission and distribution gates, starter loadouts and receipts stay unchanged, and the closure test now fails if any valid tracked item is left in the expanded set. Their existing licence records are unchanged and remain `redistribution_review: pending`.
- Scope-addition evidence: the focused content/backend quartet passes 55 tests and ruff passes. Content staging resolves 349 core entries (755 files), zero expanded and zero excluded; both starter receipts are byte-identical to the previous inventory. macOS arm64 runtime stage and independent audit pass (build ID `f18eb60735362245d8df7d83560b2eaddbc32d2f34c9390a58f5c3d2f99d6cef`, core inventory ID `0aaf990588fc64edcf3ea775845eae605b4d066e872e44b610e41474707a7f38`, core download 391,482,519 of 786,432,000 bytes); `runtime-packaging` and `pack-size-report` pass 74 tests. Targeted independent review found no blocking issue; its recommended doc, plan and promotion-reference corrections are applied. The build and inventory IDs under Final local acceptance describe the earlier 22-item candidate.

## Phased implementation

### P1: Checked drafts and live review

Use `animama-animation`, `animama-avatar-vfx`, `animama-scene-vfx`, `animama-particle-vfx` and `animama-effect-assets`. Artwork uses the built-in image generator; simple geometric symbols may use native vector authoring under the asset skill's exception. Final images remain in draft effect folders, with prompts, briefs and working sources in their work folders. Gestures live as `.animama-drafts/<stem>.clip.json`; effects as `.animama-drafts/effects/<stem>/`. Do not write Included content.

First batch is G1, A1, S1 and P1, establishing the four treatments. Continue the remaining accepted items in groups of four as authors become available. Each author owns only their item, writes a brief, runs structural/art/motion checks and inspects renders on both Included Avatars. Fix every FAIL and explain accepted WARNs. Use body and hand close-ups for gestures, chat-shaped Scene sheets, and lifecycle sampling for transient effects. Heavy browser rendering is bounded to avoid resource starvation.

The lead checks consistency and opens a shared live preview with Review/Compare pickers. Keep the preview alive for owner review; record notes and resolve them only after revising. Additional authoring can proceed while reviewed batches await feedback; dependent Save/promotion must await their approvals. Maintain an ignored item ledger with source paths, check outputs, render paths, review state and owner decisions. Phase completion requires forty reviewable items, or an explicit owner scope change.

#### Code Review #1 Findings

The bounded P1/P2 identity and Save audit found no discrepancies across the 22 retained items, 48 frozen source files, Save/promotion identities and current Local hashes. The independent CLI review found no actionable code issue; its source matches the 43-test receipt. Creator integration was pending at review time and is now separately evidenced. The chat gate was pending at this initial review and was subsequently completed after the runtime repair below; P3 checks are tracked separately. Creative owner acceptance, automated checks and independent source review are separate evidence.

#### Code Review #1 Revisions

The source/Save audit requested no code revision. Its subsequent chat-path evidence review identified the first-use duration defect above; the focused runtime repair and four cold-load UI rechecks are now complete. P3 acceptance is tracked separately; the source/Save audit alone does not establish final integration acceptance.

### P2: Save approved items through creators

Use one serial `animation:save` or `effects save` run at a time on a verified application stack. Reopen and compare the saved definition, manifest, image bytes, Selector ID and beats as the appropriate skill requires. Saved Local content becomes the source for later revision and promotion. Do not Save and Equip. Check proposed combinations and relevant existing Gestures; check actual chat when timing, mutes or expressions require it. Record any unperformed audio/native checks.

### P3: Included integration after explicit approval

Present the exact reviewed Local item list, promotion dry run, licence/provenance entries and sound selections. Promote effects before Gestures that depend on them. Update templates/thumbnails, catalogs, counts and source-review records deliberately. Add the approved 22 desktop core Library roots independently of starter loadouts, preserving dependency and distribution validation. Run the skill's applicable Included-content/backend tests, frontend checks/lint/tests/build, runtime stage/audit for Gesture promotion, and the required full content browser journey on a disposable built stack. Perform bounded independent phase/final review before pushing and opening a PR. No automatic merge or release.

#### Final integration review

The independent promotion/core review found no actionable code or provenance issue. All 22 promoted sources retain the saved motion and effect data, all 23 PNGs and three particle manifests match, the 66 approved file records and 22 rules match exactly, and existing licence records remain unchanged. Fourteen thumbnails were inspected and the original 107 motion baselines remain unchanged. The desktop comparison changes exactly 22 entries/52 files from expanded to core; complete starter receipts, exclusions and content bytes are unchanged. The required content/backend quartet passes 55 tests. The reviewer previously authored some drafts and the runtime repair, so this establishes independent promotion/packaging review; separate owner creative acceptance and another reviewer's runtime-code review cover those boundaries. The cold-load correction used the first repair round. Final browser and native evidence follows below; the native output correction uses the second and final repair round.

#### Code Review #3 Findings and revisions

The required native audit found a pre-existing packaging defect: Vite copied tracked public compatibility assets even with the compatibility plugin disabled for `embedded-desktop`. The existing desktop output filter now removes exactly the five directories already forbidden by the unchanged independent audit. Two regressions failed before the fix and pass afterward, including preservation of sibling files and symlink targets. All 71 packaging tests, desktop type checks and changed-file formatting pass. Targeted independent review found no actionable issue in this repair. Two repair rounds are used; none remain. Ordinary web builds and source assets are unchanged.

#### Final local acceptance

- Frontend checks, lint and formatting pass. The bounded full unit run passes 523 files and 4,734 tests, with one skip. An owner pause interrupted its serial browser stage; all 114 browser fixtures pass when that stage is resumed, and the frontend build passes. An earlier `LocaleSync` assertion failure did not recur; its cause is unestablished and its log is retained.
- Full production browser run `run-1014160111` passes 37 cases, fails one cleanup GET with `socket hang up`, and skips its two serial siblings. The creator assertions had passed; teardown recovered and removed the fixture. The unchanged complete generated-Gesture file passes all four cases including setup in `run-1014164743`. Together these runs provide passing evidence for every one of the 40 selected cases, with no unresolved owned content or imports. Both complete-Anima package journeys pass. The first failure is retained rather than relabelled as a passing full run.
- macOS arm64 runtime stage and independent audit pass. The first stage attempt encountered an incomplete shared Python cache; a task-specific cache resolved dependency setup. The subsequent alias-audit failure led to the reviewed output-filter correction above. All failure evidence is retained.
- The final build ID is `b47017c1efcf9a662cbf6d9eb146ee4e42392a2d8594decb92ad1bc5330277a0`; core inventory ID is `f3c7508d47a0d0f9a3f3b299ff3dbc053ecb92f67ec5def4ac6a9b44861a7ff3`. The physical check hashes all 714 core files and confirms the 22 approved entries/52 files (3,116,607 bytes), unchanged source bytes, complete starter receipts and full-stage exclusions. The audit reports zero missing/unexpected files, zero Avatar content diagnostics and successful native database backup/restore.
- The unchanged hosted-composition fixture can log a caught malformed Avatar-page error, and hiding starters sends unsupported `origin=owned` to the Avatar endpoint. These baseline limitations are separate from the passing default production Library journeys. Full backend tests, provider/TTS selection, installed native audio fidelity, signed-package acceptance and release/publication are not established. Hosted CI is reported in the PR separately.

## Validation and acceptance

Authoring checks establish format, anatomy, budget, attachment and visibility. Renders establish sampled appearance; live owner review establishes timing and creative acceptance. Creator save/reopen establishes persistence; Action/chat playback establishes integration. Report these separately. Source and asset inspection do not establish new playback acceptance.

## Idempotence and recovery

Keep drafts, original generated sources and review sidecars until the owner-approved Local items are verified. Reuse this branch/worktree and each item's existing draft. Retry failed saves only after inspecting partial results. Never remove another task's services, copy its Local content, reset databases or purge the main stack. Preserve review artifacts if the turn stops; leave the preview running while review is pending.

## Outcomes & Retrospective

Implementation and local acceptance are complete for the 22 reviewed items. Creator persistence, natural first-use Gesture timing, catalogue integration and actual desktop core packaging are verified. Final independent receipt closure passes. PR #557 is open; the 23 previously expanded Included items were added to desktop core during its review. Hosted CI is disabled and has not run. No merge or release approval has been given.
