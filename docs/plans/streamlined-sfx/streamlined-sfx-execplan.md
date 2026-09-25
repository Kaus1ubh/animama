# Streamlined SFX upload, management and event playback

Source agreement: 2026-09-23 task instruction and [spec](streamlined-sfx-spec.md).
Authoritative parent: [#69](https://github.com/raymond-van/animama/issues/69).
Authorized outcome: R1–R6, all phases. Owner approved implementation on 2026-09-23
by invoking implement after the plan handoff.
Starting revision and recorded origin/main: `a5a7ba05fc8b72f7821b8afb707df3a8852a8b6b`.
Branch: `feat/streamline-sfx`, in a dedicated task worktree.
Implementation phase commits: `df51ecf` (upload), `91c40e0` (events/playback),
`99d6382` (Library/routes), `bbf206a` (final repair). Delivery and hosted
CI status are recorded on the owning issue and PR.

## Progress

- [x] Inspect source/guidance; reuse the assigned worktree at its verified revision.
- [x] Create task branch, hydrate assets and start isolated stack `animama-sfx-e9cf`.
- [x] Owner authorizes plan; publish/read back parent and phase issues #69–#72.
- [x] Implement phases 1–3 and complete bounded independent code reviews.
- [x] Run full frontend checks, relevant backend tests and final integration review.
- [x] Complete the browser checks recorded below at desktop and narrow sizes.
- [x] Record browser acceptance and explicitly separate remaining environment limits.
- [x] Commit reviewed scope and prepare the ordinary PR handoff.
- [ ] Record hosted CI result on the PR after publication.
- [ ] Obtain separate exact-candidate owner approval before merge.

## Decisions and discoveries

- Sound Effects retain typed catalog identity, revisions and validated WAV/MP3/OGG
  audio. Uploads belong to the Library independently of creator draft lifetime.
- Upload transport has no byte-progress callback; per-file queued/uploading/saved/error
  stages report real progress. Retries retain the same receipt and payload.
- The current neutral catalog endpoint returns the complete visible catalog without
  pagination. Filename allocation checks it and names reserved within the batch,
  using the existing case-insensitive suffix convention.
- Display names may contain Unicode and punctuation. Upload/update route tokens
  remain portable; they do not define display names or replace existing identity.
- `playAccompanyingSound?: boolean` belongs only to Avatar/Scene FX events. Missing
  means enabled; false suppresses that event's audio, preserving visuals and closure.
- Library rename/replacement reads original metadata at the pinned revision because
  typed list rows omit some sidecar fields. Existing same-format replacement and
  dependent-content deletion safeguards remain enforced; the dialog states the
  replacement format constraint. Included sounds are read-only.
- No database migration or public generated API change was needed. Old sound URLs
  redirect to the Sounds Library; the unused standalone editor was removed.

## Phase 1: Persistent upload and explicit selection

Requirements R1–R3; [#70](https://github.com/raymond-van/animama/issues/70).
Starting source: the recorded baseline; phase commit `df51ecf`.

Delivered reusable `SoundUploadQueue`/`SoundUploadButton` in both action creators
and both visual-effect sound pickers. Each file saves independently, retains its
operation ID for uncertain retries, and separates successful persistence from
catalog refresh failure. Upload never inserts an event. SFX rows expose separate
Play/Stop and Add controls; insertion keeps existing exact dependency references.
`SoundPickerPreview` cancels pending requests and releases audio/URLs on replacement,
stop, tab/route exit and timeline start.

### Code Review #1 Findings

Independent review found no actionable code issues. Read-only checks passed:
3 focused suites / 14 tests and scoped ESLint. Review checked partial failures,
receipt identity, refresh recovery, complete name allocation, explicit insertion,
preview ownership and both visual-effect integrations.

### Code Review #1 Revisions

None required. Two repair rounds remain. Integrated browser evidence and remaining
acceptance are recorded below rather than inferred from unit tests.

## Phase 2: Event-scoped accompanying sound

Requirements R4–R5; [#71](https://github.com/raymond-van/animama/issues/71).
Starting source: phase 1 implementation; phase commit `91c40e0`.

Delivered optional default-on suppression in canonical Avatar/Scene event schemas,
authoring clones and saved action documents. The existing event panel shows the
associated sound name/toggle, and timeline events show a speaker marker only when
sound exists. No new inspector was introduced.

Creator preview, content preview, Avatar clip playback and Scene playback sinks
honor the event flag without dropping visuals, independent SFX or transitive sound
dependencies. Automated schema/authoring/backend round-trip and actual playback-sink
tests cover compatibility, suppression and independent sound continuity.

### Code Review #1 Findings

Independent phase review found no actionable blockers.

### Code Review #1 Revisions

None required; two repair rounds remain. Actual sink tests establish dispatch
behavior, not audible or packaged desktop acceptance.

## Phase 3: Library management and route retirement

Requirement R6; [#72](https://github.com/raymond-van/animama/issues/72).
Starting source: phases 1–2 implementation; phase commit `99d6382`.

Delivered Library Play/Stop, rename, audio replacement and revision-guarded delete
with confirmation. Uncertain save retries retain their receipt; successful writes
are not replayed because refresh failed. Metadata, default volume and identity are
preserved. Included content stays read-only. Create hub/sidebar links were updated,
and both old Sound new/edit routes redirect to the Library. Existing Particle
creator routes and Sound Effect content types remain intact.

### Code Review #1 Findings

P3-1: deriving update `entryName` from a Unicode/punctuated display name could reject
an otherwise valid rename before the server resolved its stable catalog identity.

### Code Review #1 Revisions

Accepted and fixed: updates use portable `entryName: "sound"` while preserving the
requested display name in metadata and the original catalog ID/revision. Targeted
repair round 1 passed, including the regression test. One repair round remains.
Initial Library/navigation checks passed 5 suites / 31 tests and scoped ESLint;
the subsequent Unicode fix passed 5 targeted helper/dialog tests and scoped ESLint.

## Final integration review

Independent cross-phase analysis found no remaining actionable blockers. Final
check review identified formatting in `content-preview/effects.test.ts`; the
coordinator corrected it. Applicable local checks below passed. Browser coverage
remains separate from audible and packaged acceptance. Final repair round 2 fixed
an observed existing Avatar FX hydration mismatch: blank optional descriptions
now use the name only as strict parser input, retaining the authored blank field.
Two red regression cases became green; 22 document/runtime catalog tests and
scoped ESLint passed. Targeted independent repair-round-2 review passed with no findings. Browser
reopen then loaded the saved name, image and associated sound correctly. A follow-up type
check also corrected the Unicode regression test's optional metadata access.

Commit verified phases with `feat(sfx)[p#]: ...`; keep one branch/PR. Publish after
local checks, record actual hosted Validation scope, and do not claim an owner-reviewed
local receipt. No merge without separate approval of the exact candidate.

## Validation and acceptance

Local evidence:

- Frontend full web suite: 267 test files, 1,531 tests passed.
- From `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test` and
  `pnpm build` passed. Check/build reran after final repairs; affected tests, lint
  and read-only Prettier checks also passed. The build reports existing large chunks.
- Python 3.12 with task `PYTHONPATH=src/backend`: `pytest -q
tests/test_content_audio.py tests/test_typed_content_save_replay.py
tests/test_typed_content_apis.py tests/test_content_type_handlers.py` passed 61 tests.
- `pytest -q tests/test_content_save_service.py tests/test_local_content_catalog.py`:
  12 catalog revision, dependency and delete tests passed using isolated
  PostgreSQL test containers. Initial sandbox Docker access failure was resolved
  by running with approved Docker access.
- Focused automated coverage includes partial upload failure/retry, collisions,
  refresh failure, preview cancellation, explicit insertion, schema compatibility,
  event suppression, save/reopen and actual runtime audio-dispatch sinks.

Browser evidence, using the authorized private sample audio in task-local content:

- Desktop Reaction: two valid files plus one invalid file; per-file errors, retry
  without successful-item duplication, filename suffixes and catalog refresh.
  Upload did not insert events; explicit insertion and preview cleanup worked.
- Gesture SFX upload produced `AC_NG_01 1`, refreshed the catalog and left its
  existing SFX timeline marker count unchanged. Selecting the silent Comic Pop
  effect showed no speaker marker and no accompanying-sound name/toggle in the
  existing Event inspector.
- Both Scene and Avatar accompanying-sound pickers uploaded sounds; Avatar also
  selected an existing sound. A saved event-only Reaction retained Avatar suppression false after reload,
  while its Scene event retained default-on sound behavior.
- Library Unicode rename and same-format Ogg replacement succeeded. Both legacy new/edit
  URLs redirected to Sounds Library.
- At 390×844, creator and Library management layouts were visually checked after
  desktop checks.

Saved Gesture and Reaction Library previews both reached Playing with the real
avatar and visual effects rendered. The Gesture retained a suppressed Scene event
alongside independent SFX; the Reaction retained a suppressed Avatar event and
default-on Scene event. Automated sink tests establish individual audio dispatch;
browser observation does not establish human audible acceptance. Native packaged
playback, production-mode browser checks, signing/release and paid model calls were
not performed. Delete safeguards were reviewed and automated rather than executing
permanent deletion through the browser. Hosted CI is pending publication.

## Current-main integration

After opening PR #74, main advanced to `b7a4046` through the VFX creator work.
Merged that source into this task branch. Preserve its shared timeline controls
and event-only no-pose-sampling contract, adding only the accompanying-sound
indicator and flag behavior. Main independently contained the same blank-description
hydration fix. Four conflicts were resolved without reverting either feature.
Targeted overlap review against the new baseline found no issues; 64 affected tests
passed. Merged `pnpm check`, `pnpm web:lint` and `pnpm build` passed. Full web
run passed 1,590 tests and exposed one stale incoming source-text assertion about
transport labels. Updated that assertion to the shared transport boundary; its
suite plus shared-control render tests passed all 9 tests, with scoped lint/format
passing. Targeted integration repair review passed. Browser reopened the saved
Reaction with speaker indicators and the persisted disabled toggle on the shared
timeline. PR #74 retains exact candidate and actual hosted status.

## Retained environment and recovery

Application: `http://animama-sfx-e9cf.localhost:8280`; Compose project
`animama-sfx-e9cf`, started with `./reset.sh --name sfx-e9cf --base-port 8280`.
Pinned assets were verified and runtime bootstrap was ready. Only Vite publishes
`127.0.0.1:8280`; FastAPI/Postgres remain private and optional profiles are disabled.

Retain the task stack/data for review. Upload successes remain saved if another
file fails or a draft closes. Replay unchanged uncertain operations using their
original receipt; do not delete preexisting content to recover tests. Keep sample
audio untracked. Preserve other worktrees/stacks and do not purge their resources.
