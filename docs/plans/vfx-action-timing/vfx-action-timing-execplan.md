# VFX Action timing

## Scope and authority

Implement the accepted 2026-09-24 task: remove avatar creator lifetime controls,
remove unused standalone avatar VFX lifecycles, and expose selected Reaction events
and keyframes above Expressions with shared Gesture/Reaction Start and End controls.
Starting revision: c91069d on feat/vfx-creator-polish. This is local side-conversation
work: no delegation or changes to other checkouts; remote publication was withheld
during implementation. The owner authorized branch publication and a PR on
2026-09-24. The self-review and remaining validation limits below are unchanged.

## Approach

One phase: remove the unpopulated runtimeVfx store and its renderer, debug, chat,
and PiP plumbing; preserve Action planner/event cleanup and scene/particle lifecycles.
Keep legacy serialized avatar lifetime fields readable for existing content, but stop
new authoring and previews from depending on them. Replace the avatar creator's
lifetime timeline with playback transport. Move Reaction selection inspection out
of Timeline settings, add + Expression beside the timeline playback controls, and expose event Start plus End with Action/after duration.
Keyframes retain their point-in-time semantics and existing interpolation controls.

## Verification and recovery

Run focused authoring, Reaction/player, runtime and shared UI tests; frontend type,
lint and formatting checks; build the changed product-ui package before browser
verification. Check Reaction/Gesture selection, finite duration and until-Action
editing, creator transport and responsive layout in the existing development stack.
Do not claim hosted CI, packaged desktop or full native PiP acceptance. Revert only
this task's commit if recovery is needed; preserve catalog/draft data.

## Discoveries

The standalone runtimeVfx list has expiry/clear consumers but no producer. PiP
copies the same empty state; it is not persisted effect content. Reaction event
Duration already exists inside Timeline settings. Duration omission already means
clip-owned cleanup in ReactionClipPlayer. Legacy effect metadata can remain readable.

## Progress

- Implementation complete: avatar playback transport, unused standalone lifecycle
  removal, selected Reaction inspector above Expressions, and + Expression beside
  timeline playback controls. Gesture and Reaction VFX share Start/End settings.
- Focused Vitest checks: 129 tests passed across editor/document, Reaction playback,
  runtime store, pose authoring/playback/store, Action workspace/timeline/history/
  persistence and creator primitives (13 test files).
- Product UI build passed. Scoped ESLint and formatting passed. Web check:source
  passed after lifecycle and layout changes; the final rerun was blocked solely by
  concurrent placement-guides.test.ts type errors outside this change.
- Manual checks on the existing animama-vfx-e1d7 development stack at
  http://animama-vfx-e1d7.localhost:8200 verified selected Reaction inspectors above
  Expressions, + Expression adding and selecting a keyframe, narrow timeline
  availability, Gesture and Reaction End choices, and avatar animation controls
  without lifetime fields. Temporary viewport overrides and test edits were reset.
- Shared product-ui browser tests could not launch Chromium: the container lacks
  libnspr4.so. This is an environment limitation, not a passing chat test result.
- Concurrent placement-guide source and documentation changes are excluded from
  this commit, including separate hunks in the shared avatar creator and guide.

## Review and outcome

Self-review only: side-conversation rules prohibit subagents. Independent review,
hosted CI and native PiP validation remain unperformed. Record final local evidence
above. No remote publication was performed.

## Follow-up: named effect tracks

The accepted timeline design gives each referenced effect its own named track in
Gesture and Reaction creators. VFX events render spans from Start to their finite
end or the Action boundary; Action-owned ends have a dashed edge and arrow.
Repeated references share a track, with overlapping intervals stacked into rows.
Independent copied dependencies keep separate identities and names. Sound cues
remain point events because they have no authored duration. Track labels expose
full names on hover. The timeline scrolls vertically with a sticky time ruler;
catalog drop hit testing is limited to the visible timeline viewport.

Validation: 28 focused tests passed on the host (effect-track layout, timeline
editor, catalog drag/drop, and shared timeline). TypeScript and scoped ESLint
passed. Browser checks covered multiple named particle tracks, event selection,
Start/duration changes, Action-owned ends, vertical scrolling and narrow layout.
The container test runner lacked its native Rolldown binding; host tests supplied
the local automated evidence. No hosted CI or native desktop checks were run.

## Follow-up: selectable timeline list

The Effects / Poses & Effects header now has an enabled-by-default timeline toggle,
styled like the Pose bone-helper toggle. A separate chronological list appears to
its right when enabled and nonempty; narrow layouts place it below the catalog.
Each keyframe and event is independently selectable using the existing timeline
selection actions, which seek the playhead and expose the matching inspector.
The former dependency-level Added to timeline section is removed. The Lucide
Timeline icon is backported from the official SVG with its license notice because
the installed icon package predates it.

Browser checks covered default/empty state, toggle visibility, event and expression
selection in Reactions, pose selection in Gestures, and narrow-layout selection.
