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
