# Anima profile modal redesign

Source agreement: approved implementation plan, 2026-09-21. Owning issue:
[#34](https://github.com/raymond-van/animama/issues/34). Authorized scope: full
frontend implementation and PR update; merge remains separately approved.
Issue authority captured at its 2026-09-21T16:01:31Z update.

## Purpose and context

Replace the chat header's sectioned Anima dialog with the approved continuous
profile: banner, overlapping portrait, ranked emotion summary and rendered identity.
Keep the centered profile stationary while a measured 360px emotion detail panel
opens 16px to its right when room permits; otherwise expand inline above Identity.
Reuse Radix's focus boundary, Motion, Recharts, existing queries and appearance editor.
No backend, schema, dependency or scoring changes.

## Progress

- [x] Phase 1: implement and validate profile, shared emotion presentation and identity.
- [x] Final integration review.
- [x] Existing PR #35 updated; implementation commit `15622b9` pushed. Hosted
  checks were not reported at readback; owner acceptance and merge remain pending.

## Surprises & Discoveries

- Existing emotion domain helpers already normalize the 24 values, calculate group
  averages and break ties in canonical order. Presentation must reuse those results.
- The existing shared sectioned-modal frame is used elsewhere and remains untouched.

## Decision Log

- 2026-09-21, owner: approve B profile layout, dedicated group colors and all 24
  headline/emoji mappings; no scores in summary, raw values in expanded details.
- Keep `docs/frontend/architecture/overview.md` and
  `docs/frontend/features/anima-management.md` identical to main as requested.
- Retain management identity defaults; plain rendering only applies to this profile.

## Phased implementation

### Phase 1: continuous profile and responsive emotion disclosure

Issue #34; branch `fix/anima-modal-presentation`; starting revision `04c7406`.
Reuse the assigned worktree and running `animama-d777` development stack, port 8200.

1. Extract shared presentation values and test group ranking/averages/ties,
   all headlines, neutral/malformed inputs and formatting. Keep normalization and
   live-runtime versus persisted precedence unchanged.
2. Customize the existing Recharts radar: circular subtle rings, fixed 0–30 axis,
   dominant polygon and individual colored points, accessible all-group legend.
3. Add plain identity rendering and presentation-only leading matching H1 removal.
4. Refactor `AnimaInfoModal` to Profile/Settings and remove caller section state.
   Preserve appearance controls, focus return, Details navigation and profile scroll.
   Use measured space for side/inline disclosure, one focus boundary/backdrop,
   directional chevrons, Escape collapse-first and reduced-motion-aware transitions.
5. Run tests, TypeScript, lint, formatting and browser checks. Independently review
   the frozen combined change, resolve supported findings, then commit the phase.

Completion requires the approved behaviors, passing affected checks and bounded
independent review. Browser acceptance remains the owner's; no real emotion data
or paid chat requests are needed. Record all actual results below.

#### Code Review #1 Findings

Independent analysis reviewed the complete working diff and new helpers/tests
against `04c7406`: no actionable findings. Confirmed domain preservation, single
Radix boundary, sanitized heading suppression, existing appearance queries and
unchanged protected docs/shared frame. Reviewer could not fetch the issue due to
network restrictions and used this plan plus supplied accepted requirements.
Independent checks passed all 63 selected tests, scoped lint/format and diff checks.

#### Code Review #1 Revisions

No review repairs required; zero of two repair rounds consumed. Browser verification
also covered focused side-panel resizing: disclosure stays open, focus remains
recoverable within the dialog, and Escape collapse/close returns to the header.

## Final integration review

Passed using the combined independent review and fresh checks. No code blockers.
Owner browser acceptance and exact-candidate merge approval remain outstanding.

## Validation and acceptance

Targeted tests plus `pnpm exec tsc -b`, scoped ESLint and Prettier from
`src/frontend/web`. Browser checks cover desktop side placement, constrained
desktop/mobile inline layout, resize while open, long identity scrolling,
keyboard disclosure and Escape, reduced motion, Settings/Back, Details and both
appearance controls. Active-state checks used temporary synthetic render inputs only, then removed
before validation and review. No persisted data was changed and no paid chat ran.

Executed from `src/frontend/web`:

- `pnpm exec tsc -b`: passed.
- `pnpm exec eslint` and `pnpm exec prettier --check` on all 12 changed/new
  TypeScript files: passed.
- `pnpm exec vitest run src/lib/emotion/presentation.test.ts src/ui/components/emotional-state.test.tsx src/ui/animas/AnimaIdentitySection.test.tsx src/ui/memory/MemoryMarkdownPreview.test.tsx src/ui/main/header/animaModalPresentation.test.ts src/lib/animas/anima-management-presentation.test.ts src/query/mutations/useAppearanceContentActions.test.ts src/lib/anima/animaPresentationImage.test.ts src/query/animaLoadoutInvalidation.test.ts`:
  9 files, 63 tests passed.
- Root `git diff --check`: passed. Both protected docs equal `origin/main`.

Meaningful red/green tests covered heading suppression and emotion presentation;
unchanged source precedence uses regression tests. Geometry boundary tests and
browser interaction checks cover layout; no artificial failing test was claimed
for that integration work.

Browser evidence (development/HMR): measured 1440px viewport profile bounds
400–1040px and side panel 1056–1416px (stationary profile, 16px gap, 24px edge).
1280px uses inline disclosure; 390px stacks portrait/name/summary with contained
scroll. Resizing open preserves disclosure. A synthetic active state rendered
Delight/Affection/Drive bars and the colored radar. Synthetic long identity reached
the final section through the profile's sole scroll container; the stored document
was untouched and all test text was removed. Keyboard focus on Affection followed
by Tab exposes Esteem's constituents. Escape collapses first, then closes and returns
focus to the header. Both camera controls open their matching appearance sections;
nested Escape preserves profile/emotion state and returns focus to the invoking
camera. Settings/Back restored a measured 78.5px profile scroll offset. Details
navigated to management, where the original H1 remained visible.

Reduced motion is implemented and code-reviewed via `useReducedMotion` (zero
duration and no horizontal travel); the OS preference was not toggled in browser.
No production build, full suite, native acceptance or appearance save/upload was
performed. Existing appearance invalidation regression tests passed.

## Idempotence and recovery

All edits are frontend presentation changes; no data migration or reset. Keep the
task's running stack and existing data for acceptance. Revert only task-owned
changes if needed; do not alter shared services or the two protected docs.

## Outcomes & Retrospective

The approved profile and responsive emotion disclosure are implemented. The
assigned development stack remains running at port 8200 for owner acceptance.
A Radix portal timing issue found during browser testing was fixed by measuring
once the profile element mounts. Hosted CI and owner merge approval remain separate.
The phase commit is the implementation commit containing this completed record.


## Accepted follow-up: simplified emotion exploration (2026-09-21)

The owner requested removing diagnostic source/scale labels and repeated legend
and detail cards. Radar spokes now plot each group's maximum normalized constituent
value; summary ranking and bars retain domain averages. Eight fixed spokes and
three visible rings remain. Hovering the plot or focusing/tapping an axis label
shows a compact reserved caption below the plot, never a floating overlay.
The owner selected three headline levels: slightly (1–15), plain (16–25), very
(26–30), with neutral at zero. The strongest emotion inside the dominant average
group continues to drive the headline; backend/domain scoring is unchanged.

Independent follow-up review #1 against `84440b6` found no actionable findings;
zero repair rounds consumed. Browser inspection caught Recharts remounting focused
axis nodes when caption state changed; keeping the plot memoized with stable
presentation data preserves keyboard focus. Browser recheck confirmed Delight →
Tab → Drive retains focus and updates constituents. Pointer selection inside the
plot selected Esteem without an overlay. A separate disposable synthetic preview
confirmed all eight axes, maxima (Delight 28 while its average is lower), three
nonzero grid circles, mobile 390px containment and label selection, and neutral
without a plot. The caption starts below the chart bounds; no floating tooltip
exists. Synthetic files were removed; the real profile was never overridden.

Follow-up verification: the same nine-file targeted Vitest command above passed
73 tests. TypeScript, scoped ESLint/Prettier and diff checks passed; protected docs
remain identical to main. Independent review and rendered recheck passed. The live
profile showed “Feeling slightly joyful” with a peak of 3 (previous average 1),
with no diagnostic labels or repeated panels. Existing PR #35 carries this follow-up;
merge remains separately approved.


## Accepted follow-up: compact hover exploration and in-place identity editing

The desktop summary now opens its compact emotion panel on hover or focus when
side space permits. A 180ms exit delay bridges the gap; pointer presence and
keyboard focus retain it. Forward Tab enters the chart directly. Explicit toggle
remains for inline/touch use. The larger radar emphasizes labels and points in
individual group colors, clears pointer selection outside the plot, and omits
label background fills. An inset Emotions heading uses existing chart whitespace;
there is no close icon or helper prompt. Neutral content reserves heading space.
Toolbar icons have tooltips, and the redundant visible Identity heading is removed.

Chat Edit identity now opens the existing scoped memory editor without navigation.
Closing restores its trigger focus and leaves the profile mounted. Management's
route editor remains unchanged. Its header emotion tag now uses the shared emoji,
color and full-feeling tooltip while retaining its Emotions-tab action.

Validation: nine targeted files passed 73 tests before the final identity change;
five identity rendering tests then passed including the button override, and three
focused emotion/draft/cache files passed 15 tests. TypeScript, scoped ESLint,
formatting and whitespace checks passed. Independent hover review identified a
keyboard path issue, resolved and rechecked in one repair round. Subsequent
identity and emoji scopes had no actionable findings. Browser checks confirmed
keyboard entry into chart axes, transparent Esteem highlight with teal text,
Escape collapse, Details tooltip, in-place IDENTITY.md opening/closing with route
and trigger focus preserved, and emoji navigation into the Emotions tab. No real
identity/emotion data was modified. Full build/native and an editor save round trip
were not repeated. The two protected documentation files still match main.

Concurrent settings commits on this same task branch were preserved. The local
HMR stack remains running for owner acceptance; merge is separately approved.


## Accepted follow-up: approved intensity emoji mapping

Applied the owner's complete 24-emotion × three-intensity mapping without changing
labels, groups, score bands, ranking or normalization. Neutral remains 😐. The
shared presentation selects both wording and emoji from the same intensity band,
so summaries and the management header remain consistent. Exact owner choices,
including repeated symbols and newer Unicode characters, are preserved.

Targeted presentation/render tests pass (72 tests), including every approved emoji
at both boundaries of each score band. TypeScript, scoped lint and formatting
checks passed. Independent mapping/boundary review found no actionable findings.
A read-only browser check confirmed the management header now renders 🙂 for
“Feeling slightly joyful”. No real emotion data or backend scoring changes.


## Accepted follow-up: plain name trigger with hover gradient

Removed the separate header emotion-status button and its popover. The name alone
opens the profile, retaining live emotion inputs for that modal. Two decorative
Motion layers provide a subtle animated gradient border/glow on hover or focus;
idle layers are hidden, and reduced motion uses a static gradient.

TypeScript, scoped ESLint/Prettier and whitespace checks passed. Independent review
found no actionable bugs; its idle-surface and narrow-width observations were
addressed with a transparent resting surface and max-width bound. Browser checks
confirmed the old control is absent, name opens the profile, close restores focus,
and the gradient renders around the focused name. No full build/native test run.
