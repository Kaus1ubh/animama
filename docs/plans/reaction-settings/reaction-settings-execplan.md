# Optional reaction placement and consolidated settings

Source agreement: 2026-09-22 owner request; authoritative issue [#48](https://github.com/raymond-van/animama/issues/48).
Authorized scope: complete the single implementation phase below on the existing
`chore/creator-polish` branch and PR #47. Starting revision: `1cfb738`.

## Purpose and context

Reaction assets should not need an emotion/intensity suggestion to be saved.
Their equipped Anima loadout slot owns dispatch; the asset's placement hint is
only a suggestion. The current backend requires it even for unassigned assets.
The Reaction editor should place expressions and the optional suggestion in its
timeline settings panel, using the existing settings style, without an inspector.
Gesture inspection and required equipped reaction slots remain unchanged.

Relevant boundaries are the backend content document registry, serialization,
catalog/runtime preview contracts, and frontend action document/loading/save and
timeline settings. No database migration or chat inference change is intended.

## Progress

- [x] Phase 1: optional contract, consolidated editor, checks and review.

## Surprises & Discoveries

- Saved placement is overridden by the equipped slot at runtime, so the save
  constraint is not a requirement for dispatch.

## Decision Log

- 2026-09-22, owner: make backend placement optional; remove the Reaction
  inspector and move expressions plus emotion suggestion into clip settings.
- 2026-09-22, implementation: omission means no suggestion. Supplied incomplete
  or invalid suggestions remain errors; old valid hints retain their meaning.

## Phase 1: Save unassigned reactions and consolidate settings

Issue: #48. Reuse the task worktree and development stack; do not reset data.

1. Add failing backend tests for hint-free documents, serialization/preview and
   equipped-slot override; preserve invalid-hint rejection and existing hints.
2. Make the backend contract optional across its consumers. Update useful
   backend guidance. Regenerate API clients offline if response schemas change.
3. Make frontend new/save/load/recovery flows preserve an absent suggestion.
   Move Reaction expressions and suggestion controls into timeline settings;
   remove Reaction inspector surfaces on desktop/mobile. Reuse existing rows.
4. Run focused backend/frontend regressions, type/lint/read-only formatting and
   import-boundary checks. Exercise real local save/reload and settings at
   desktop and narrow widths; keep provider/native testing out of this scope.
5. Independently review the combined change once, with at most two targeted
   repair rounds. Commit, update PR #47 and record actual hosted check status.

Completion requires acceptance in #48, applicable checks and no supported review
blockers. User approval is required only for the exact-candidate merge.

### Code Review #1 Findings

Independent combined review identified one required compatibility repair: VRMA
reactions have no timeline, so removing their inspector also removed suggestion
editing. It also identified a misleading Mild label for unassigned loadout choices.

### Code Review #1 Revisions

Shared suggestion rows now appear in VRMA reaction settings as well as the clip
settings panel. Unassigned choices omit the fabricated intensity label. Targeted
review passed both fixes with no further actionable findings. One repair round
used. Final typechecking also identified an incomplete test fixture, repaired
before delivery.

## Final integration review

Combined review and targeted follow-up passed. Earlier pose-authoring and icon
evidence remains applicable. Equipped loadout validation still requires a valid
emotion/intensity cell; the content hint is independent of that runtime choice.

## Validation and acceptance

- Backend: focused `pytest` over `test_content_type_handlers.py`,
  `test_local_content_scan.py`, `test_anima_loadouts.py`,
  `test_content_save_service.py`, and `test_typed_content_apis.py`: 35 passed
  across focused runs. Docker-backed tests required sandbox escalation and then
  passed. Ruff check/format passed on changed Python; import-boundary check
  reported zero forbidden edges.
- Frontend: `pnpm test:source src/ui/action-editor src/ui/reaction-editor
  src/query/mutations/useActionEditorActions.test.ts`: 87 tests passed.
  Repair tests for ReactionTimelineSettings and ReactionLoadoutGrid: 5 passed.
  Source typecheck, full web lint and changed handwritten-file formatting were
  checked; final fixture correction is included in the final typecheck.
- API exported offline with `animama.server.export_openapi`, then generated
  using `ANIMAMA_LOCAL_OPENAPI_PATH` and `pnpm exec openapi-ts -f
  openapi-ts.config.ts` in the task container. `pnpm packages:build` passed.
  Generated files retain generator formatting and were not hand-edited.
- Browser on the task development stack: authored and saved a reaction without
  a suggestion, reloaded it, added Joy, saved, cleared to None, saved and reloaded
  again. None persisted with intensity disabled. Desktop and 390 x 844 settings
  show plain expression/suggestion rows; mobile tabs contain no inspector.
- Hosted check status is recorded in PR #47 after push. No native, provider,
  audio, production-build or release acceptance is claimed.

## Idempotence and recovery

Keep existing hinted documents compatible. Never rewrite Included content or
other tasks' Local files. Test with a newly authored task fixture. Regeneration
is repeatable from backend source; do not hand-edit generated clients. If the
implementation is reverted after hint-free content is created, preserve those
files and restore valid hints before using an older validator.

## Outcomes & Retrospective

Implemented in the phase commit containing this plan, on
`chore/creator-polish` in task worktree `5ed3/animama`. Development stack:
http://animama-creator-polish-5ed3.localhost:8360. The backend, generated response
contract, frontend save/load and settings now preserve an absent suggestion.
PR #47 carries delivery evidence and remains subject to owner-approved merge.
