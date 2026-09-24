# Local content and complete Anima sharing

Status: Approved 2026-09-24 for full implementation; Phases 1–5 complete, Phase 6 next.

Source agreement: [local-content-sharing-spec.md](local-content-sharing-spec.md),
requirements R1–R9 and its acceptance table, following the owner's 2026-09-23
instruction to turn that specification into an ExecPlan and explicitly use the UI
mockups. The spec remains the requirements authority; this plan owns execution.

Authorized scope: all phases 1–6, approved by the owner on 2026-09-24.
The implementation instruction includes issues, tests, reviews, phase commits
and PR handoff. Exact-candidate merge and release/publication remain separate.
Authoritative specification: [issue #81](https://github.com/raymond-van/animama/issues/81),
read back at `2026-09-24T13:47:40Z`.

Workspace: reuse the assigned `0c75/animama` worktree and existing
`feat/local-content-sharing` branch. Planning baseline:
`98220eae162651207960ffa9657aa54581a80265`. At authoring, only this scope's planning
directory was untracked; no application code had changed. No stack was started.
Use one branch and PR for this plan. Original planning artifacts were committed
as `9a3971dcc87bbe3bbc0a1e70cdb1d238936865a8`; the approved follow-up added
the fourth unchanged Anima-export mockup. Application implementation starts from that
planning baseline; setup authorization is committed as `e6be498`. Workspace setup verified the primary checkout remains on
`main`; existing unrelated worktrees and services were preserved.

Phase issues: [P1 / #82](https://github.com/raymond-van/animama/issues/82), [P2 / #83](https://github.com/raymond-van/animama/issues/83), [P3 / #84](https://github.com/raymond-van/animama/issues/84), [P4 / #85](https://github.com/raymond-van/animama/issues/85), [P5 / #86](https://github.com/raymond-van/animama/issues/86), [P6 / #87](https://github.com/raymond-van/animama/issues/87).

Environment: task-local locked Python 3.12.13 and pnpm installations; Docker
is available for disposable test containers. Task stack `animama-local-sharing-0c75`
serves this worktree in development mode at
`http://animama-local-sharing-0c75.localhost:8460`; only Vite is published on
loopback, with PostgreSQL and FastAPI private. No optional profiles are enabled.
Its generated record is `.animama-stack.env`; task-only Local/private data is
beneath `.animama-stacks/animama-local-sharing-0c75/`. Model paths passed offline
verification before startup. Preserve this stack and the unrelated hand-authoring
stack during subsequent work.

## Purpose and context

Make Library's Import / Export flow exchange one content item, multiple items or
one complete fresh Anima through a local `.animama` file. Dependencies and the
appropriate Appearance images travel automatically. Imports create independent,
editable Local copies and never transfer private conversation history or provider
configuration. No Discover, hosted publishing, distribution service, new catalog
Voice integration or editable Blueprint type belongs in this work.

The prerequisite content changes are part of the same outcome: Idle Styles own
Gesture pools, Music/BGM is retired, and standalone catalog Pose Clips become
Action-owned animation content where referenced. Preserve existing Local data,
Included immutability, TTS, Sound Effects, static Poses and Creator JSON workflows.

Read [PLANS.md](../../../PLANS.md), [SDLC.md](../../../SDLC.md), the scoped agent
guides and [ADR 0004](../../adr/0004-filesystem-content-and-recoverable-mutations.md)
before implementation. Do not use the historical Discover proposal as a contract.
Planning and implementation require no Cloud checkout or private source.

### Source orientation

Paths below are relative to the repository root. `B` means
`src/backend/animama`; `W` means `src/frontend/web/src`.

| Boundary | Starting points and relevant behavior |
| --- | --- |
| Typed documents and admission | `B/domain/content_documents.py`, `B/app/services/content_kind_registry.py`, `B/adapters/content_store/filesystem_store.py`: versioned documents, kind rules, registered files and reference rewriting. |
| Local publication and recovery | `B/app/services/local_content_mutations.py`, `B/adapters/repositories/sqlalchemy/content_catalog_repo.py`, `B/server/content_startup.py`: source lock, file journals, SQL receipt and startup reconciliation. |
| Package service and HTTP | `B/app/services/content_package_service.py`, `B/server/routers/content.py`, `B/server/schemas/content.py`: current `/2` single-root export and immediate import; no review/commit product flow. |
| Anima definition and creation | `B/app/services/anima_aggregate_materializer.py`, `anima_creation_service.py`, `anima_loadout_service.py` in the same service directory; `B/domain/anima_creation.py` and the SQLAlchemy aggregate unit of work. |
| Appearance associations | `B/server/routers/avatar.py`, `B/app/services/content_save_service.py`: an Avatar portrait is a separate Appearance association, not a normal Avatar dependency edge. |
| Idle runtime | `W/lib/runtime-content/AnimaRuntimeCatalog.ts`, `runtimeSnapshotAdapter.ts`, `W/lib/avatar/planner/AvatarPlanner.ts`, `W/lib/avatar/Avatar.ts`, `W/lib/avatar/poses/PoseController.ts`. |
| Library and editing | `W/ui/library/LibraryPage.tsx`, `LibraryContentInventory.tsx`, `W/lib/content/libraryContentInventory.ts`, `W/ui/creator/IdleStyleEditorPage.tsx`, `W/ui/animas/IdleStyleLoadoutSection.tsx`. |
| Sound ownership | `W/lib/sound/SoundController.ts`, `W/ui/sound/SoundProvider.tsx`, `W/ui/main/canvas/AvatarCanvasActor.tsx`: preserve TTS/SFX while removing BGM and exposing occurrence-owned cancellation. |

## Progress

- [x] 2026-09-23: inspect spec, repository contracts and relevant implementation;
  preserve the three original mockups beside the plan.
- [x] 2026-09-23: draft implementation phases, technical choices and evidence gates.
- [x] 2026-09-24: full implementation authorized; owning spec and six linked phase
  issues published/read back, supplied worktree verified, locked dependencies installed.
- [x] Phase 1: Gesture-based Idle Styles and preservation of existing idle behavior.
- [x] Phase 2: retire Music/BGM and standalone Pose Clip availability safely.
- [x] Phase 3: portable multi-root and full-Anima export with exact review snapshots.
- [x] Phase 4: staged, reviewed import and one recoverable installation operation.
- [x] Phase 5: Library frontend using the supplied UI mockups.
- [ ] Phase 6: combined acceptance, current documentation and final review.

## Surprises & Discoveries

- Existing import reuses matching non-root dependencies before applying its
  `keep_both` policy. Independent imported copies require changing that path;
  selecting the existing policy alone does not satisfy R4.
- `LocalContentMutations` already shields owned work from request cancellation
  and uses the committed SQL receipt as completion authority. Reuse it; do not
  create an independent installation transaction manager.
- The package ceiling is 4 GiB, but local HTTP admission limits each request to
  128 MiB and its body read to 120 seconds. Large imports need bounded parts;
  increasing the global admission limit is outside this plan.
- Current import retains one spooled handle per member. Individually bounded
  reads are insufficient for a large multi-item archive; bound aggregate memory
  and open handles as well as bytes on disk.
- Idle currently selects finite VRMA lanes. The clip Gesture planner applies a
  two-second minimum while its executor does not pass the same speed into clip
  playback. Idle needs consistent finite motion/event timing, not a direct reuse
  of those mismatched calculations. The old Style crossfade field is disconnected
  from the snapshot adapter; do not claim to preserve a working Style control.
- SoundController can stop an individual SFX ID, but the provider/actor event
  path does not retain that ownership. Include accompanying effect sounds when
  wiring cancellation, not just direct SFX events.
- Removing retired enum values immediately would break stored catalog rows and
  historical receipt decoding. No old package support is required, but readable
  local data and durable operation outcomes remain required.
- Playwright uses an explicit journey allowlist. A new test file does not run
  until it is selected in `src/frontend/playwright.config.ts`.

## Decision Log

| Date / actor | Decision and reason |
| --- | --- |
| 2026-09-23 / owner | Local files, whole-package import, automatic non-parenthesized collision suffixes, independent dependencies and the fresh-Anima privacy boundary; details remain in the spec/discovery record. |
| 2026-09-23 / owner | Use the saved mockups when implementing frontend components. Their confirmed behavioral corrections take precedence over illustrative copy. |
| 2026-09-23 / planning | Implement Idle Styles before removing legacy clip readers. This preserves an executable conversion path rather than deleting a format while it still has consumers. |
| 2026-09-23 / planning | Write `animama-content-package/3`, with content roots or one portable Anima definition. Keep ZIP and existing typed validators; no `/2` compatibility requirement. |
| 2026-09-23 / planning | Prepare an immutable export archive before review; download exactly that archive. Stage imports privately, then commit the reviewed plan through the existing mutation authority. |
| 2026-09-23 / planning | Use bounded sequential upload parts under the existing local HTTP boundary and private filesystem review records; no hosted service, general upload framework or new SQL staging table. |
| 2026-09-23 / planning | Default suffix spelling is `-2`, `-3`, etc. Add Idle Styles as an existing-content category in Library/export. These make the spec's reviewable defaults concrete. |

Technical choices may be revised with source evidence while preserving the spec.
Record changes here. A different privacy boundary, overwrite behavior, content
model or destructive data policy requires an owner decision before dependent work.

## Implementation contracts

### Canonical Idle Style and finite playback

Give the new Idle Style document its own versioned shape: a Default list of
Gesture dependency references and an emotion/intensity map. Omitted cell means
inherit Default; explicit `none` means No idle; `pool` contains a nonempty unique
list of Gesture references. Default may be empty. Use the tracked emotion set
and levels 1–3; validate kinds, closure and playback eligibility on Save/import.
No per-cell speed, looping, timing or per-Anima pool override is introduced.

Use exact Gesture revisions to derive normalized playback facts consumed by
validation, previews, planner and executor. Share fixture cases across backend
validation and frontend interpretation rather than inventing parallel rules:

| Implementation | Finite eligibility and playback |
| --- | --- |
| VRMA `once` | One positive-duration cycle. |
| VRMA `pingpong` | Positive authored repetition count; preserve the existing absent-count default of two traversals. |
| VRMA `repeat` | Explicit positive finite repetition count. Unbounded repeat is ineligible. |
| Non-looping `animaPoseClip` | One positive finite timeline, with no phase/state/run lifetime override. |
| Looping `animaPoseClip` | Explicit positive finite Gesture `loop_count`, with no phase/state/run lifetime override; execute exactly those cycles. |

The finite horizon is timeline duration multiplied by traversals/cycles, divided
by positive authored speed. Reject invalid/unknown bounds rather than substituting
a duration. Advance the actual pose/event clock at that speed. A prepared idle
occurrence starts its clock when playback can start; pending bytes must not eat
its timeline. Deliver intended boundary events once, including time zero and
finite repetitions, without entering an extra loop at completion.

Keep the normal 180-second quiet interval, existing priority/reset behavior and
procedural rest. Select uniformly from the resolved cell and avoid the preceding
Gesture identity when alternatives exist. An emotion change affects the next
selection. A completed/interrupted occurrence is never resumed. An occurrence
owns its motion, expressions, effect handles and direct/accompanying SFX IDs;
invalidate its asynchronous callbacks and stop only its owned resources on
completion, interruption or unmount. Do not stop unrelated TTS/SFX.

### Local transition, without a reset

Implement one narrowly scoped transition service over existing catalog/store and
aggregate ports. Run recovery first, then detect legacy documents/rows, plan
conversion and publish under the existing source transaction fence before the
new runtime consumes affected bindings. Reuse it for startup and explicit rescans;
do not hide a one-time conversion only in an editor.

Identify each conversion by algorithm version, source identity/revision and
affected binding revisions. Preserve original files and the relevant prior
binding facts in private, non-scanned recovery storage before changing them.
Completed mutation journals are normally cleaned up, so they alone cannot be the
retained originals. Record old-to-new identities and the result in a durable
receipt. A second run must preserve later edits and create no additional copies.

Convert Local definitions in place where identity can be retained. If an old
Included source needs generated content or different bindings, create a Local
converted copy and remap its affected consumers in the same operation; never
write into an immutable mount. Update maintained shipped definitions at their
authoritative source and regenerate shared catalog resources. Unconvertible
items retain originals and safe diagnostics; do not mark their conversion
complete or silently substitute another animation. Unrelated valid content may
remain usable unless an unresolved recovery journal requires the existing
readiness fence.

Keep retired kind decoding internal for existing rows/receipts while removing
those kinds from supported authoring, selection, packaging and runtime APIs.
Do not tighten database constraints so existing values become unreadable. Prefer
the existing JSON/receipt storage for transitions. If a schema change proves
necessary, follow the baseline-only development policy; no new Alembic revision
or reset is authorized, and dependent execution must first resolve how the
existing-data requirement remains satisfied.

### Portable package and reviewed snapshot

Use one strict `/3` manifest, retaining the existing member hashes, typed file
roles and per-entry attribution/license fields. A `content` package has a
nonempty ordered `root_entry_ids` set. An `anima` package has one allowlisted
definition whose equipment references package entry IDs. The definition is
transport metadata, never an editable catalog Anima/Blueprint entry.

Build closure from saved, revision-fenced content and Anima authority, including
effective starters and explicit exclusions. Every declared entry must be reachable
from selected roots, definition equipment or the explicit image associations;
reject missing, extra or cyclic members. Deduplicate each source entry within
the package. A selected root also required by another root counts as selected
once. Do not reuse a best-effort mounted runtime projection for export.

Add explicit Avatar-to-default-portrait associations to the portable projection;
do not change internal Appearance ownership to make them ordinary model files.
Anima profile/background selections and framing refer independently to Appearance
entries. Rewrite associations through the import mapping into receiver-local
IDs/logical keys; preserve an image used in both roles without duplicate bytes.
Missing selected images block review; genuinely absent optional portraits do not.

The Anima definition allowlists name, reviewed identity text, Avatar, complete
Reaction cell matrix, Gesture selections and supported binding configuration,
Idle Style/absence, and Appearance selections/framing. Freeze effective selections
as explicit equipment and exclusions so receiver defaults cannot add content.
Extend internal resolved creation inputs to carry binding configuration; do not
serialize public creation commands containing local IDs or arbitrary settings.
Replace the current arbitrary override dictionaries at this portable boundary
with bounded, per-implementation supported fields. Characterize the existing
`duration_seconds`, `loop_type`, `loop_count`, `time_scale`, `weight`, `blend_mode`,
`base_pose` and `emotion_weights` consumers and carry only applicable validated
values; reject unknown keys and runtime-generated reference maps. Apply the
receiving definition limits (currently at most 40 name code points and 32 KiB
identity, possibly configured smaller) and the whole-Anima runtime budget.
Only recipient defaults supply model/voice/runtime settings. Source ownership,
history, chats, memory relationships, attachments and credentials have no fields
in the portable definition.

For app-provided effect/animation primitives, record a checked capability/version
requirement in the manifest, or serialize already supported portable data.
Derive requirements from actual definitions, including `animaPose/1.0`,
`animaPoseClip/1.0`, `animama/avatar-effect/1` and `animama/scene-effect/1`, and
validate supported primitive variants against a closed backend registry with
shared renderer fixtures. A generic effect-definition object or runtime snapshot
`catalog_version` is not a portable compatibility guarantee.
Reject unavailable capabilities before installation; never load executable code
or fetch external resources from a package. Preserve supported license metadata
without presenting it as a rights determination.

Prepare and hash a complete cached export before returning its review. Read exact
source revisions, verify bytes and recheck definition/association fences during
preparation. A change during capture requires fresh review. Changes afterward do
not replace the already reviewed cache. Stream that cache on Download; expiration
requires preparation/review again, never silent regeneration.

### Import review and operation lifecycle

Keep a small typed package-review service behind generated same-origin API calls.
Proposed route shape under `/v1/content`:

| Operation | Contract |
| --- | --- |
| `POST /package-exports:summary` | Resolve selected roots/Anima, dependencies, validation problems and estimated size without creating an archive. Used by the selection sidebar. |
| `POST /package-exports` | Prepare selected content or one Anima from expected revisions; return review ID/digest, exact contents, size and expiry. |
| `GET /package-exports/{id}/file` | Stream the already reviewed archive with a safe Content-Disposition filename, length/hash and no-store response. |
| `POST /package-imports` | Allocate a private stage for one named file, expected byte count and operation identity. Return an opaque server-generated ID and part size. |
| `PUT /package-imports/{id}/parts/{index}` | Sequential bounded parts; acknowledge offset/hash. An identical retry is safe; changed or out-of-order input conflicts. |
| `POST /package-imports/{id}/review` | Seal the complete archive, validate it, compute receiver-local identities/names and return the whole-package review plus its digest. |
| `POST /package-imports/{id}/commit` | Commit that digest and operation identity. No replacement policy or subset selection. |
| `GET /package-imports/{id}` | Read the current stage, next upload offset or reviewed plan so an interrupted acknowledgement can be resolved. |
| `GET /package-operations/{operation_id}` | Resolve active/recovery-needed/completed outcome from owner-scoped stage/lock/journal/receipt facts. A completed receipt wins even after staging expires. |
| `DELETE /package-imports/{id}` / `DELETE /package-exports/{id}` | Release an inactive review/cache. Refuse to present an active or unknown commit as cancelled. |

Use existing imports/exports staging roots, random server-generated paths and
atomic fsynced metadata. Store owner, byte progress, archive hash, immutable
review digest, destination facts, operation identity and expiry. Coordinate
stage writes and cleanup with a per-stage OS advisory lock that releases on
process death. The source fence is held for installation, not while a person
reads the modal. All routes require ordinary installation admission/ownership;
a stage ID or digest is not an authorization token.

Start with 8 MiB sequential parts, bounded below the unchanged 128 MiB request
ceiling. Persist each acknowledged part/offset so interruption cannot turn a
partial write into accepted bytes. The browser reads `File.slice` parts and
retries only the same part/operation; it never buffers a whole multi-GiB file.
Recompute the complete server-side archive hash before review and commit. Bound
pending import/export stages to two per owner and 8 GiB of total archive bytes;
reserve declared import bytes and export estimates before writing, then enforce
actual bytes. Allow at most one expanded validation tree per stage, bounded by
the 4 GiB expanded limit, and release redundant partial/assembled copies as soon
as verified replacement is durable. Expire inactive stages after 30 minutes,
refreshed by successful upload parts or explicit review renewal. Reject extra
admission without evicting another active review; report insufficient disk space
before work when detectable. Sweep expired unlocked stages on startup and staging
requests. Expiry never deletes active work, recovery journals/originals or durable
receipts. These are implementation defaults, independently testable with smaller
fixture limits.

The canonical reviewed plan fixes fresh logical identities, destinations,
collision suffixes and any Anima name. Avoid existing Local and Included name/key
ambiguities; allocate within length/path constraints and within the whole package.
Preserve Gesture semantic selectors independently of display/file-name suffixes.
Reserve no catalog items during review. Commit rescans/rechecks destinations and
receiving creation prerequisites under the fence. Drift requires a new reviewed
plan/operation; it does not silently pick another suffix. Every dependency is
newly installed for this import, shared only among members of this import.

Perform file publication, catalog reconciliation/owner assignment, fresh Anima
materialization when requested, and the final receipt inside one
`LocalContentMutations.run` action with one shared SQL session. Use the
noncommitting aggregate materializer/unit of work, not `create()` followed by
another commit. The receipt stores a versioned result snapshot with installed
IDs and optional Anima ID. Compute the canonical review digest from the sealed
archive SHA plus the complete destination, Anima and association plan. At commit,
recompute and compare the staged archive SHA to the sealed value; never update
the reviewed value to accept changed bytes. Derive the mutation request digest
from the submitted immutable review digest and operation/schema discriminator,
so receipt lookup needs no staged bytes. Replay checks that digest before expiry
or destination validation, returning original success even if the result was
later edited or deleted. Different input under that identity conflicts.

After a lost response, retain only the non-sensitive operation/review identifiers
needed to query status; do not persist identity text or the whole package in
browser storage. An active lock with no receipt means pending, not failure. After
restart, resolve journals under the source fence before allowing a retry or new
installation. Runtime preparation/navigation happens after successful commit;
failure there retries preparation for the installed Anima, never installation.

### Resource and archive limits

Preserve the existing ceilings and define their counting consistently in writer,
reader and tests: at most 2,048 payload files plus `package.json`, at most 4 MiB
manifest bytes, at most 4 GiB compressed archive bytes and 4 GiB total expanded
bytes including the manifest, and at most 200:1 expansion per member. Strict `/3`
packages contain declared regular files only; directory, symlink, duplicate,
encrypted, traversing and undeclared members are rejected. Per-kind file/entry,
JSON-depth and runtime validation limits still apply.

Verify members sequentially into private staging rather than retaining all
spooled members. Bound package payload buffers to 16 MiB total and simultaneously
open package payload handles to 16, then reopen only the member being published.
Account for separately bounded manifest/parser allocations as well. Count actual
streamed bytes as well as advertised ZIP metadata; fail before partial admission
on truncation, wrong size/hash, disk
exhaustion or limit breach. Use reduced-limit boundary tests plus a real
multi-part file larger than 128 MiB; multi-GiB RAM allocation is not a test strategy.

## Phased implementation

Each phase record below must acquire an issue URL, starting SHA, resulting commit,
exact commands/results and limitations during execution. A later phase starts
from the recorded predecessor result, not an assumed moving `main`. Phase commits
use the repository form, for example `feat(content)[p3]: export portable packages`.

For every phase and final integration scope, perform one full independent review
and at most two repair rounds. Record numbered Findings/Revisions with stable
finding IDs, evidence, disposition, changes and affected rechecks. Append #2/#3
only as needed; retain counts across resumption. Supported blockers remaining at
the limit stop dependent progression. No new human approval is required between
authorized phases once their specified gates pass.

### Phase 1: Gesture-based Idle Styles preserve authored behavior

Requirements: R6–R7, the Idle conversion portion of R9. Dependencies: accepted
implementation range and workspace setup. Legacy clip readers remain available.

1. Add canonical Style parsing, serialization, dependency rules and finite
   Gesture eligibility. Update loadout/runtime DTOs and generated SDK together.
   Keep idle dependency implementations separate from `runtime.gestures`, which
   the chat boundary uses to enumerate AI-callable equipment.
2. Extend the runtime motion catalog, planner and both players using the finite
   contract above. Add occurrence ownership through PoseController, effect
   dispatch, SoundProvider and AvatarCanvasActor. Fence both sides of asynchronous
   loads; do not use global sound cancellation for an idle occurrence.
3. Replace Style VRMA uploading/pool overrides with selecting existing Gestures.
   Show Default, intensity cells, inherit and No idle with useful eligibility
   reasons. Make the loadout section choose/preview/edit/duplicate a Style or none.
   Reuse normal Local Save and Included customization behavior.
4. Convert old Style-owned VRMA lanes into Action-owned Gesture files, preserving
   authored playback. Reuse a referenced Gesture only when its playback matches;
   otherwise create a preserving Local Gesture variant rather than modifying a
   shared original. Translate old emotion-only pools to all three cells; preserve
   old empty-pool fallback as inheritance, not the newly distinct No idle state.
5. Materialize each distinct effective per-Anima override as a separate Style
   before clearing that binding's override. Preserve explicit no-Style state,
   attribution, binding revisions and recovery originals. Old standalone clip
   references may be read for conversion but are not part of the new Style API;
   produce Action-owned Gesture content and leave remaining Action consumers for
   Phase 2. Never equip conversion-created Gestures for AI invocation.

Validation: add conversion/finite fixtures and tests for all cell states,
deterministic ties, duplicate pool membership, single/multiple-candidate repeats,
speed, finite loops, event boundaries, delayed loading and interruption/unmount.
Observe both actual implementations and unrelated audio continuity. Starting
backend batch from repository root:

```bash
uv run pytest -q tests/test_content_type_handlers.py tests/test_anima_idle_style_loadout.py tests/test_anima_runtime_closure.py tests/test_content_mutation_workflows.py
```

From `src/frontend`, after `pnpm packages:build`:

```bash
pnpm --filter animama-web exec vitest run tests/avatar/AvatarPlannerMotion.test.ts tests/avatar/AvatarPlanner.test.ts src/lib/runtime-content/idleStyleProjection.test.ts src/lib/content/idleStyleDocument.test.ts src/lib/loadout/idleStylePresentation.test.ts
pnpm --filter animama-web exec vitest run src/lib/avatar/poses/PoseController.playbackObservation.test.ts src/lib/avatar/AvatarClipAudio.test.ts src/lib/sound/SoundController.test.ts
```

Add exact commands for new behavior tests to this record when named. Completion:
new Style Save/Preview/Equip and both finite players work; fixture conversion
survives restart/rerun without changing private data or AI equipment. Capture a
rendered real-avatar playback observation for both implementations; record native
audio acceptance separately in Phase 6. No live provider calls are needed.
Recovery: failed conversion rolls back cooperating files/bindings, retains
originals and reports the affected source; ambiguous manual edits remain fenced.

Issue: [#82](https://github.com/raymond-van/animama/issues/82). Starting SHA:
`e6be498a596aad1e9e9824527593ad6c10f20d3a`. Verified phase commit:
`8e2a68ef5fa4751f52103139492212386ece6bec`.

Implementation evidence:

- Conversion observed red (schema stayed v1), then green; startup override fixture
  observed red (binding override remained), then green after startup/rescan wiring.
  `uv run --no-sync pytest -q tests/test_content_idle_transition.py`: 10 passed.
  Recovery/destination batch: 12 passed, including rollback after a real SQL
  binding write and fresh-service retry. Destination guard reproduced an overwrite
  before the fix; its focused test now passes.
- Adjacent backend batch: 142 passed. Focused runtime batch: 204 tests across 25
  files passed. Editor/preview batch: 31 passed after a real-clock clip completion
  regression. Mixamo acquisition: 7 passed. These batches overlap; counts are
  not a unique-test total.
- SDK regenerated offline; `pnpm packages:build`, `pnpm build`,
  `pnpm desktop:check`, `pnpm web:lint`, `pnpm packages:check`, typed-content audit
  and Python import-boundary check passed. Full mypy: 521 source files passed
  after test-only annotations. Formatting/lint initially found one newly expanded
  import; independent targeted recheck passed after repair. Changed repair paths
  will be checked again before the phase commit.
- Rendered at 1440 × 1000 on the isolated task stack: actual starter Avatar
  performs the six-second VRMA head turn and returns to Ready; clip head motion,
  expression, eye and particle events render and clean up at completion. A stuck
  Playing label was reproduced and fixed with the Avatar's actual completion
  callback, then browser status was observed Ready. Setting Joy intensity 3 to
  No idle and saving showed “Idle Style saved”; reload retained it. Equipping
  that Style through the reviewed Loadout change displayed the saved cell states,
  while both fixture Gestures still showed Equip in AI equipment. Fixtures are
  original task-only content; no provider call or arbitrary community-motion fidelity claim.
- Native audio acceptance and the real 180-second quiet journey remain Phase 6
  gates. No hosted CI or native release validation is claimed.

Source finding: the old Style `cross_fade_seconds` was projected but never
consumed by the planner. Preserve the existing VRMA/clip fades; do not introduce
new Style fade behavior while converting authored duration, speed and loops.

#### Code Review #1 Findings

Initial independent review of all tracked/untracked Phase 1 changes against
`e6be498`, partitioned into backend and frontend analysis plus read-only checks.
Both analysis partitions and delegated checks are complete. Required findings:

- **P1-B1:** admitted locator references such as `gestures/breathe` disappear
  from mounted pools because projection resolves logical keys/suffixes again.
  Compiler admits one root with finite facts but projection returns an empty pool.
- **P1-B2:** finite admission accepts clip structure rejected by the actual
  player, including a keyframe beyond the explicit duration. Eligibility/Save
  must not promise playback for those bytes.
- **P1-F1:** editor pool-member previews bypass finite idle facts, so clip loops,
  speed and VRMA repetition settings diverge from actual idle playback.
- **P1-F2:** clip idles require literal `idle`, while existing VRMA scheduling
  retains idle behavior during `user_typing`; clips fail to start or interrupt.
- **P1-F3:** the preview event bridge drops occurrence cancellation, allowing
  pending or active preview audio to outlive completion.

#### Code Review #1 Revisions

All five findings accepted after source inspection and reviewer reproductions.
Repair round 1 is in progress: resolve admitted dependency identities, validate
playable clip structure against shared fixtures, supply exact candidate-preview
facts, unify typing scheduling and propagate owned preview audio cancellation.
P1-B1's locator regression was observed red, then green; its adjacent runtime/API
batch passed 10 tests. End-boundary dispatch followed by immediate owned-resource
cleanup is consistent with the completion contract; effects do not extend idle. One additional repair round
will remain after targeted Review #2; do not restart comprehensive review.
Check finding C1 (test import lint/format) is resolved; full mypy now passes.

#### Code Review #2 Findings

Targeted independent recheck after the first repairs:

- Backend P1-B1/P1-B2 pass; exact dependency identities and parser-aligned clip
  admission resolve the reproductions without a demonstrated repair regression.
- Frontend P1-F2/P1-F3 pass; typing uses the shared base-state predicate and
  preview cancellation now covers pending/active direct and accompanying audio.
- P1-F1 and related locator propagation pass frontend recheck. Candidate facts
  remain tied to the same exact preview; editor root/nested lookups use admitted
  IDs and preserve authored refs with the frozen draft baseline.
- **P1-B3 (required repair regression):** the new dependency DTO publishes raw
  stored target IDs even when only the root is caller-visible. The independent
  service/DTO reproduction exposed a hidden target UUID, without a byte-access
  bypass. Keep optional IDs null unless visible/admitted in the response.

Verification during repairs:

```bash
uv run --no-sync pytest -q --disable-warnings --tb=short
# 1833 passed, 14 failed, 7 skipped. All failures used legacy v1 Idle Style
# setup in two test fixtures, which no longer represents supported new authoring.
uv run --no-sync pytest -q tests/test_anima_materializer.py tests/test_anima_creation.py tests/test_content_watcher_admission.py --disable-warnings --tb=short
# After updating those fixtures: 78 passed, with original behavioral assertions retained.
uv run --no-sync pytest -q tests/test_content_mutation_workflows.py
# 17 passed: finite candidate preview facts and ordinary ineligible preview behavior.
pnpm --dir src/frontend --filter animama-web exec vitest run src/lib/content-preview/effects.soundOwnership.test.ts src/lib/content-preview/effects.test.ts src/lib/content-preview/playback.test.ts src/lib/avatar/poses/PoseController.playbackObservation.test.ts src/ui/create-anima/CreateAnimaPreviewSession.test.ts src/ui/content-preview/ContentPreviewSession.test.ts tests/avatar/AvatarPlannerMotion.test.ts
# 82 passed across 7 files; actual PoseController drives cancellation tests.
```

Shared exact-byte clip fixtures pass 53 backend and 53 actual frontend parser/
player tests. Backend mypy passes 522 files after the validator addition; runtime
locator regression batch passes 6 tests. Final schema regeneration/checks follow
once preview dependency identity propagation is stable.

#### Code Review #2 Revisions

P1-B3 accepted after confirming the serializer consumes persisted IDs without
caller visibility. The second and final repair round is in progress: carry only
visible/admitted dependency identities in typed responses, leaving raw receipt
projection independent of current source reads. No ownership redesign is needed.
Targeted Review #3 must pass; no repair rounds remain afterward. All frontend
findings are closed, with 279 files / 1692 tests passing in the final full suite.
An earlier concurrent package-build test run was discarded and rerun sequentially;
no failed result is represented as passing. Full backend rerun after fixture
correction: 1847 passed, 7 skipped. That broad run predates the narrow B3 repair;
its affected API/preview/receipt checks must be refreshed. `pnpm build`,
`pnpm check`, `pnpm web:lint` and `pnpm openapi-ts:check` pass on the final frontend
source. `make format-check lint mypy` passes (522 files); rerun affected backend
static checks after B3. The existing large-bundle build warning remains informational.

#### Code Review #3 Findings

Final targeted independent backend recheck passes. P1-B3 reproduction now returns
null for a hidden dependency, retains the correct visible locator target through
list/get/preview, and omits optional IDs during raw receipt parsing without any
current-byte query. P1-B1/B2 remain resolved; frontend Review #2 passed F1–F3 and
locator propagation. No remaining actionable findings; no repair rounds remain.

#### Code Review #3 Revisions

No further code changes requested. Final B3 evidence: 12 typed API/replay tests,
19 preview/batch/mutation tests and 8 final typed API assertions pass. Final
`make format-check lint mypy` passes all 522 files; typed-content and shared Python
import-boundary audits pass. The loadout UI was reloaded after visibility repair
and still resolves the equipped Style and all saved cell settings.

Phase 1 passes its checks, independent review and rendered VRMA/clip gates.
Native audio and the full quiet-period journey remain explicit Phase 6 gates.
No hosted CI, release or physical-audio acceptance is claimed by this phase.

### Phase 2: Retire unsupported content without losing Actions or audio files

Requirements: R8–R9. Dependency: Phase 1 canonical idle conversion and playback.

1. Characterize existing Music bindings/preferences, standalone clip files,
   Gesture/Reaction references and historical receipts using synthetic fixtures.
   Extend the transition service before removing supported handlers/routes.
2. Copy referenced standalone clip payloads into their owning Actions, promoting
   and rewriting effect/sound dependency aliases and file references. Multiple
   Actions may receive owned copies of one old clip. Preserve each Action's
   identity/configuration, exact event behavior and the untouched clip original.
3. Remove Music discovery/authoring, typed equipment operations, runtime
   projections, BGM controls/provider paths and preference use. Remove old active
   Music bindings through the preserving transition; keep original audio files
   and prior binding evidence. Do not relabel audio as SFX.
4. Exclude standalone Pose Clips/Music from supported scan admission, product
   schemas, editors, pickers and package kinds. Retain isolated legacy decoding
   and safe diagnostics for retired files/rows/receipts. Keep `animaPoseClip`
   parsers/player, Action files, static Poses and raw Creator JSON round trips.
   Regenerate SDK/router/catalog outputs using their existing generators.

Likely interfaces: typed registry/store, catalog row/receipt decoders, loadout
service/domain/schemas, runtime projection, Music editor/routes/loadout section,
sound preferences/provider/controller. Retain TTS and SFX paths in shared modules.

Validate Action effect/audio equivalence, shared old clips, unused retired files,
second conversion, restart after failure, retired result replay, and manual edits
after conversion. Convert existing Music-positive tests into removal/preservation
coverage rather than deleting the evidence. Starting root batch:

```bash
uv run pytest -q tests/test_anima_music_loadout.py tests/test_content_type_handlers.py tests/test_content_save_service.py tests/test_typed_content_save_replay.py tests/test_content_migration_recovery.py tests/test_pose_content.py
```

Run affected frontend sound/Creator/runtime tests; replace obsolete expectations
with assertions that BGM is absent while TTS/SFX and Creator clips remain usable.
Completion: no active retired-kind references remain in successfully converted
fixtures; invalid legacy input reports a problem without data loss or scan crashes.
Recovery follows the transition contract; no profile reset or source-file deletion.

Issue: [#83](https://github.com/raymond-van/animama/issues/83). Starting SHA:
`8e2a68ef5fa4751f52103139492212386ece6bec`.
Verified phase commit: `08e31f2bc57b19111caa8c1456f6ea322c910369`.

Implementation evidence (2026-09-24):

- The shared standalone clip fixture first retained its old `technical_source`
  reference (red), then became two owned Action sequences with the same Action
  IDs, selectors, placement and playback configuration. Originals stay in place
  and in private recovery storage. Alias collisions rewrite only owned event
  selectors. Interrupted publication rolls back; a fresh service completes once
  and subsequent runs preserve later edits. Unsafe support-setting conflicts
  preserve the source and show a repair diagnostic.
- Music retirement first left two bindings in place (red), then removed the set
  with one Anima/loadout revision update. Eight SQL/store tests cover missing
  tracks, untouched original audio, unrelated equipment/identity, exact source
  fences, rollback, committed-journal recovery and receipt-first replay.
  Combined Action/Idle/Music/startup preservation batch: 27 passed.
- Backend admission/replay batch: 118 passed; one malformed historical Clip test
  fixture was corrected, then all six Save replay tests passed. New operations
  reject retired kinds; hidden receipt-only Save routes and private creation
  request decoding preserve historical successful retries without restoring
  public typed availability. Existing storage enums/constraints remain readable.
- Frontend retirement tests observed five intended failures before correction.
  Legacy draft admission and Included owned-sequence reopening also went red to
  green. Relevant frontend batch: 82 files / 528 tests; affected rechecks: 77
  tests and seven sound tests (overlapping counts). SDK/router regenerated with
  their generators. SDK drift, package build/check, web type/lint, desktop type
  check and production web build passed; only existing large-chunk warnings.
- `make format-check lint mypy`: 527 source files passed. Typed-content audit
  and Python import boundary passed (zero forbidden edges, 213 reachable project
  modules / 157 shared modules). Independent full offline backend suite passed:
  1,873 passed, seven skipped, 415 warnings in 188.73 seconds.
- Rendered at 1440 × 1000 on the isolated task stack: Loadout contains Gestures,
  Reactions and Idle Style; App Settings contains master mute, TTS and SFX, with
  no BGM transport or volume. No audible/native acceptance is inferred from this.

#### Code Review #1 Findings

Initial independent review against `8e2a68e` includes tracked and untracked
Phase 2 changes. Independent frontend analysis passed with no actionable findings;
independent backend suite/audit/boundary checks passed. Backend analysis reported
four required findings; no further broad review is authorized for this phase.

- **P2-B1 (required):** the Action converter rejects every Included legacy Action
  solely because its source is immutable. The reviewer admitted a valid Included
  clip/Gesture closure, then observed no mutation and disappearance from typed
  Gesture availability. This violates the explicit Local-copy/consumer-remapping
  transition contract. Originals must remain immutable while converted Local
  Actions, affected Styles and consumed equipment are published atomically.
- **P2-B2 (required):** deleting the Music commit route makes a successful
  historical retry return 404 despite its intact receipt. Keep a private,
  receipt-only compatibility route; new Music equipment remains rejected.
- **P2-B3 (required):** alias rewriting assumes every legacy event is an object.
  A valid old catalog closure with a malformed event raises `AttributeError`
  and aborts rescan. Report the affected item safely and preserve originals.
- **P2-B4 (required):** adding an owned sequence while retaining an older unused
  file's `sequence` role creates two active candidates. The frontend can select
  the stale one. Preserve the old bytes with a non-active role.

#### Code Review #1 Revisions

All four findings accepted and reproduced. Repair #1:

- B1 copies Included Actions and affected Included Styles to Local, rewrites
  affected Local Style references in place, and remaps exact explicit/implicit
  consumers in one existing mutation/SQL commit. Per-source checkpoints share
  that commit so subsequent source additions cannot overwrite later Local edits.
  Original attribution, bytes and full prior binding facts are retained. Old
  immutable definitions whose closure still contains retired content are not
  selectable through typed APIs. Included conversion/rollback fixtures went red
  to green; grouped-consumer/Music/Idle batch: 31 passed.
- B2 restores only a hidden commit retry route with exact historical request
  normalization. Two HTTP reproductions went from 404 to passing; 11 admission/
  replay tests passed. New keys reject before revision/source checks, changed
  input conflicts, and no Music equipment is recreated. SDK drift check passed.
- B3/B4 reproduced uncaught event errors and two active sequences. Converted
  clips validate rewrite shapes, and old unused sequence files retain their
  bytes under `legacy_sequence`. Six Action tests passed. The shared failure
  diagnostic now describes legacy content/Actions instead of only Idle Styles.
- Affected backend batch: 50 passed. Full format/lint/mypy passed for 530 files;
  final Included-addition and consumer checks: 15 passed. Independent full backend
  suite after repair #1: 1,892 passed, seven skipped, 415 warnings in 223.20 seconds.

#### Code Review #2 Findings

Targeted independent recheck resolves B2–B4. B1's grouped initial conversion,
fences and rollback pass, but completed Action checkpoints skip discovery of
newly added or repaired Styles referencing the immutable original. Reproduction
returned zero mutations and left both valid Local and Included Styles hidden.

#### Code Review #2 Revisions

B1 follow-up accepted. Final repair round reuses completed Action/Style mappings
for newly discovered consumers, retaining edited Local copies and their revision
fences. Deleted copies stay deleted; affected consumers receive safe diagnostics.
No broad review was repeated. Two added scenarios and the full Included conversion
test file pass (four tests); scoped Ruff, formatting and mypy pass. The broad
1,892-test result predates this narrow repair; affected checks were refreshed.

#### Code Review #3 Findings

Final targeted independent review passes B1: new/repaired Local and Included
Styles reuse the edited checkpointed Action and become available. A deleted
copy is not recreated; affected Styles get missing-result diagnostics without
publication or checkpoint writes. Binding/restart regressions pass. B2–B4 remain
resolved and unchanged. No actionable findings and zero repair rounds remain.

#### Code Review #3 Revisions

No further code changes requested. Phase 2 passes its applicable checks and
independent reviews. TTS/SFX and Creator preservation use the unchanged frontend
review/check evidence above; physical audio/native acceptance remains Phase 6.

### Phase 3: Export portable content and complete Anima definitions

Requirements: R1–R3, export freshness from R5, package constraints. Dependencies:
Phases 1–2 supported content model; no Library sharing UI yet.

1. Refactor current package validation/planning away from file publication so
   inspection can validate without installing. Add strict `/3` content/Anima
   manifest DTOs and capability requirements. Remove `/2` assumptions from active
   writer/reader tests; retain historical operation decoding separately.
2. Generalize one-root closure to multiple explicit roots, full transitive
   dependencies and automatic image associations. Use complete saved Anima
   definition/loadout authority with source/revision fences, not degraded runtime
   output. Carry supported configuration and all empty cells explicitly.
3. Implement allowlisted portable Anima projection and the reverse resolved-input
   mapping. Extend internal Gesture/Reaction creation selections with supported
   configuration so materialization will not discard binding overrides.
4. Add a non-archiving dependency/count/estimated-size projection for selection.
   Only Review export prepares the exact verified archive and download cache;
   checkbox changes must not serialize whole archives. Implement bounded member
   validation and clear unsupported schema/capability errors without changing
   global HTTP admission. Run the same validator on produced exports so the
   application cannot generate an archive that its own importer rejects.

Likely interfaces: `ContentPackageService`, content/Anima definition DTOs,
`content_kind_registry` rewrites, Avatar portrait lookup, aggregate/loadout read
ports and internal resolved creation model. Keep public creator behavior covered
when extending those shared internal inputs.

Use fixture archives for one item, overlapping roots, both Gesture implementations,
Style pools, image role reuse, distinct profile/background, all Reaction cells,
empty Style and binding overrides. Put unique private-history, credential and
sender-owner markers in fixture storage and prove they are absent from exported
JSON/files; receiving owner assignment is tested in Phase 4. Assert source drift
either rejects capture or downloads the exact already reviewed snapshot.

```bash
uv run pytest -q tests/test_local_content_export_contract.py tests/test_local_content_import_contract.py tests/test_anima_presentations.py tests/test_anima_loadouts.py tests/test_anima_materializer.py
```

Completion: valid whole-package inspection has no durable content/Anima side
effects; malformed closure/images/capabilities fail before export/import success.
Record exact new fixture commands. Recovery: failed/cancelled preparation removes
only its owned temporary cache; later edits never alter an existing review.

Issue: [#84](https://github.com/raymond-van/animama/issues/84). Starting SHA:
`08e31f2bc57b19111caa8c1456f6ea322c910369`. Commit:
`05728e42167f0e0e4465262d276758ad0876e28a`.

Implemented and verified: strict `/3` archive inspection, saved-authority
Anima projection/configuration, closed playback capabilities and exact export
review are integrated. All 158 maintained Included descriptors/resources pass
the closed capability admission check. Selection-summary regression first
failed because the service had no summary/review API. The new writer uses stored
ZIP members so highly repetitive valid JSON/media cannot produce a package above
the reader's compression-ratio ceiling. Payloads still stream with bounded buffers.
Keep explicit null Anima cells/appearance choices when serializing the manifest.

The old immediate package API is cut over together with its callers in Phase 4,
as that phase explicitly requires; `/3` inspection/export review is implemented
as an independently checked service first. No legacy-package support is added.

Validation before review: the integrated package/export/PortableAnima batch passed
127 tests; subsequent archive-only additions passed 49 tests. The writer has
byte-level complete-Anima privacy checks, independent shared image roles, stale
source/portrait fences, overlapping-root deduplication and immutable-cache tests.
Observed behavior failures covered missing summary, bare-media identity metadata,
reference rewriting that altered matching names, invalid Action motion and finite
VRMA default-role detection. Scoped static/type/import-boundary checks passed.
The frozen full backend suite passed **2025 tests, 7 skipped** (416 warnings,
197.40 seconds; `/tmp/animama-p3-pytest.log`). Independent
`UV_NO_SYNC=1 UV_CACHE_DIR=/tmp/animama-p1-checks-uv-cache make audit-typed-content check`
passed formatting, Ruff and mypy over 544 Python files; import-boundary check
found zero forbidden edges. These results precede Review #1 repairs.
The frontend compatibility file has 8 passing tests in the independent rerun;
this observed result supersedes the earlier unverified 17-test count.

#### Code Review #1 Findings

Blocked against the complete tracked/untracked Phase 3 diff from `08e31f2`.
Independent full-inspector reproductions confirmed three required findings:

- **P3-B1:** ZIP64 records without classic EOCD sentinels bypassed the pre-parser
  central-directory allocation limit. A 198-byte directory passed a 1-byte cap.
- **P3-B2:** Action sound/effect event selectors could name missing dependencies;
  a sender-only Sound Effect reference with zero bundled dependencies passed.
- **P3-B3:** An inferred sequence role omitted from descriptor `files` bypassed
  clip/capability validation; a JSON object without the Clip schema passed.

No further blocker was found in saved-authority privacy, configuration mapping or
exact export rechecks. Phase 4 still owns endpoint cutover and staging.

#### Code Review #1 Revisions

All three findings accepted after verifying the reported code paths. Repair
round 1 aligns ZIP64 preflight with the actual ZIP parser and counts central
records before allocation; resolves Action events against exactly one dependency
of the correct kind; and passes actual registered roles to payload validation.
ZIP64 and inferred-role regressions each showed two failures before repair; event
closure regressions showed 20 failures, including full archive inspection.
All 158 maintained Included capability cases remain supported.

The repaired integrated batch passed **168 tests** (16 warnings, 9.98 seconds):
`UV_CACHE_DIR=/tmp/animama-p1-checks-uv-cache uv run --no-sync pytest -q tests/test_content_package_export_review.py tests/test_content_package_v3_archive.py tests/test_content_package_v3_contract.py tests/test_content_package_capabilities.py tests/test_content_package_event_dependencies.py tests/test_portable_anima.py --disable-warnings --tb=short`.
The full static refresh passed: typed-content audit, Ruff format/lint and mypy
over 545 files (`/tmp/animama-p3-repair-static.log`). The earlier complete
backend pass remains valid outside this repaired boundary.

During filename checking, an additional public-contract regression reproduced:
a valid Unicode/punctuation Anima name failed export because the download reused
Local filename constraints (one failing case). A bounded download filename now
preserves the complete definition name and removes unsafe filename characters;
all nine export tests pass. This narrow correction is included in Review #2.

#### Code Review #2 Findings

Blocked only on the remaining scope of **P3-B2**. Full-inspector reproductions
confirmed that an event requesting a background-layer Scene Effect could target
a bundled focus-line effect, which the runtime rejects. The new dependency check
also rejected a padded selector such as ` tone ` that the frontend trims.
P3-B1, P3-B3 and the filename correction passed targeted independent rechecks.

#### Code Review #2 Revisions

Both remaining B2 cases accepted. Final repair round 2 compares resolved Scene
Effect variants using the complete typed-document map and matches ECMAScript
selector trimming, including BOM, in validation and portable-reference rewriting.
Scene variant tokens themselves retain the renderer's strict untrimmed contract.
Thirteen additional behavior failures preceded this repair. Actual exports with
padded direct references and aliases now pass without altering Action names.
All 11 export tests and 56 archive/contract tests pass; affected static checks pass.
All 158 Included descriptors remain supported with their complete target graph.
No broad review is reopened.

#### Code Review #3 Findings

Passed final targeted independent recheck. Both Scene Effect variant mismatches
reject and clean their private tree; matching variants accept padded aliases and
direct references. Export normalizes only selectors and preserves names. B1/B3
and the filename correction remain resolved; no actionable repair regression.
The complete affected Phase 3 batch now passes **199 tests** (16 warnings,
16.40 seconds; `/tmp/animama-p3-repair2-tests.log`). The same six-file command
recorded above was used after both repairs. Full typed-content audit, Ruff
format/lint and mypy (545 files) pass (`/tmp/animama-p3-repair2-static.log`);
import-boundary validation again reports zero forbidden edges. This reuses the
initial full-suite result for unchanged behavior and the eight unchanged frontend
compatibility tests.

#### Code Review #3 Revisions

No further changes required. Review #3 passed with zero repair rounds remaining.
Phase 3 is complete; the initial full backend pass plus final affected/static
checks satisfy its gate. API staging and route cutover remain Phase 4 work.

### Phase 4: Review and install one complete recoverable operation

Requirements: R1, R3–R5, archive/admission constraints. Dependency: Phase 3 package
contracts and all prerequisite content transitions.

1. Add private stage records, part upload, inspection, cached download, discard
   and operation-status contracts above. Enforce the expiry/quota/buffer defaults
   with boundary tests. Handle duplicate part submission, lost acknowledgements,
   client cancellation, disk exhaustion and process restart without partial
   catalog admission or abandoned unlimited staging.
2. Build reviewed import plans with fresh content identities and `-2` suffixes.
   Remove matching-dependency reuse, including matches against Included content.
   Rewrite all typed references, image associations and Anima equipment through
   the same map. Shared dependencies within one import remain shared.
3. Commit through one existing mutation authority and shared SQL unit of work.
   Validate receiver creation prerequisites and preserve all configuration using
   the aggregate materializer. Create no chat and call no model/voice provider.
4. Add versioned receipt replay/status handling before requiring staged bytes.
   A retry after cache cleanup or later edit/delete returns the original result;
   it does not reinstall. Fence a lost response against repeated UI submissions.
   Resolve stage locks and recovery before classifying a no-receipt outcome.
5. Regenerate the SDK offline. Reconcile the old immediate package endpoints:
   remove or route them through the new validated service as appropriate to their
   current callers, without retaining an unchecked replacement or two-commit
   path. Update affected tests/callers together; no legacy-package adapter needed.

Use real transactional DB/store fixtures to inject failures after file promotion,
catalog reconciliation, owner assignment, Anima child creation and immediately
before/after the final SQL commit. Recreate service/database lifetimes and recover;
check no partial selectable content/Anima, exactly one successful result, preserved
manual edits and durable receipts. Include concurrent destination changes,
same-ID/different-input conflict and a deliberately new import producing new copies.

```bash
uv run pytest -q tests/test_local_content_import_contract.py tests/test_content_mutation_cancellation.py tests/test_content_mutation_receipt_race.py tests/test_content_mutation_startup.py tests/test_content_migration_recovery.py tests/test_anima_creation.py tests/test_anima_materializer.py tests/test_local_http_admission.py tests/test_local_http_transport.py
```

Add focused stage/API tests, including a real file above 128 MiB sent as parts,
per-kind/resource limits and hostile byte/metadata cases. From `src/frontend` run
`pnpm openapi-ts`, then build/check generated package consumers; no hand edits.
Completion: the API offers truthful review/commit/status/cancellation and one
coordinated outcome for content-only and Anima imports. A post-commit runtime
preparation failure can retry preparation without materializing again.

Issue: [#85](https://github.com/raymond-van/animama/issues/85). Starting SHA:
`05728e42167f0e0e4465262d276758ad0876e28a`. Commit: pending.

Implementation underway in three bounded areas: private filesystem stages/export
leases; reviewed import planning plus shared-session publication/materialization;
and HTTP/facade/caller cutover. Optional preallocated catalog identities let the
review fix Avatar portrait associations before one atomic admission, without
reserving selectable catalog items or adding a SQL staging table.

Pre-review evidence (implementation still in progress):

- Private staging/export slice: 32 focused tests passed, including the actual
  136 MiB HTTP upload in 17 sequential parts, quota/expiry/process-death locks,
  export download lifetime and Pose package copying. Only bounded part buffers
  were retained; the normal request-size limit was unchanged.
- Parent HTTP and mutation/admission batch: 88 passed (23 warnings). The reviewed
  HTTP round trip proves owner isolation, no admission during review, unchanged
  exact download SHA, automatic names, whole-package commit and receipt replay
  after stage cleanup and later item deletion. The existing 43 other adapted
  migration/retirement/Pose/workflow tests passed before the final HTTP response
  mapping fix. Final combined validation is recorded below when frozen.
- Offline SDK generation, public package build/check, web source type-check and
  backend format/Ruff/mypy (557 sources) passed. Boundary audit reports zero
  forbidden edges, 225 reachable project modules and 169 shared modules.
- New evidence during caller cutover found a static Pose export identity mismatch
  and missing portable license metadata on import; both are corrected. Journal
  rollback now removes only matching empty directories created by that operation,
  allowing an exact multi-entry retry while preserving preexisting/manual files.
- The active Pose browser helper is being moved off the removed immediate routes.
  Import receipts retain the original revision so exact test cleanup cannot adopt
  and delete a later manual edit. Receipt-backed operation journaling owns this
  caller update; Phase 5 still owns the new sharing UI and journey.

#### Code Review #1 Findings

Blocked on two required findings against the frozen Phase 4 working tree based
on `05728e4`. Independent backend analysis and separate caller/SDK analysis were
read-only. The caller review passed without findings; its reviewer independently
ran 25 utility tests, three Pose helper tests, E2E source type-check and scoped
format/diff checks. The final baseline full backend suite passed: **2,134 passed,
7 skipped, 416 warnings in 338.81 seconds**. Format/Ruff/mypy passed across 557
sources. SDK freshness (17 generated files), runtime-contract type-check,
package build/check/tests (17), web source type-check and desktop type-check passed.
These checks do not cover the newly reproduced crash windows below.

- **P4-B1 — Fresh publication has two crash gaps.** Stopping after `os.link`
  but before unlinking its private staging name leaves two links; the ordinary
  recovery fingerprint rejects that state even without a manual edit. Stopping
  after destination `mkdir` but before journaling its device/inode leaves an
  empty directory which rollback cannot prove it owns; it nevertheless deletes
  the journal, and the exact reviewed retry then conflicts. Both violate R5's
  restart recovery and exact retry requirement. Retain durable ownership proof
  before publication and test recreated journal/service lifetimes at both points,
  while preserving manual files and unowned hard links.
- **P4-B2 — The expansion ceiling becomes a minimum free-space requirement.**
  `StageLease.expansion` requires 4 GiB free for every archive. A valid 1,370-byte
  Sound package with 152 payload bytes fails with 64 MiB available although the
  ordinary reader accepts it. Preflight that archive's bounded expansion need;
  retain the 4 GiB ceiling and checks on actual extraction.

#### Code Review #1 Revisions

Both findings accepted after source verification. Repair round 1 is frozen:

- **P4-B1:** one exclusive-rename helper replaces the transient hard-link and raw
  destination-mkdir publication paths. Private staging identities are journaled
  before atomic publication. macOS uses `renamex_np(RENAME_EXCL)` and Linux uses
  `renameat2(RENAME_NOREPLACE)`; Windows delegates to its exclusive `os.rename`.
  Unsupported primitives/filesystems fail closed. Ordinary Save replacement and
  legacy journal decoding retain their contracts. Recovery also refuses a later
  same-byte file replacement when its inode is not the published one.
  Both original interruptions failed before the repair. Twelve new restart,
  manual-write and native exclusion cases plus existing store/import/Anima tests
  passed: **46 tests**. Actual macOS journal recovery was exercised; an isolated
  Linux container ran the exact helper extracted from current source and proved
  native file/directory exclusion and inode preservation. This is not full Linux
  journal or Windows execution evidence.
- **P4-B2:** stage expansion asks the same bounded archive reader for the specific
  expanded size, including manifest accounting, before checking available disk.
  Both real import/export reviews failed with 64 MiB free before the repair and
  pass afterward. The **89-test** stage/archive/contract/export batch also covers
  insufficient actual disk, the configured expanded ceiling and existing hostile
  archive limits. No public model or SDK changes were needed.

Scoped format/Ruff/mypy and diff checks passed for both repairs. Final full backend
regression: **2,149 passed, 7 skipped, 416 warnings in 236.98 seconds**. Final
format/Ruff/mypy passed across 558 sources; boundary checks report zero forbidden
edges, 225 reachable project modules and 169 shared modules. Unchanged SDK and
frontend caller evidence above remains valid; neither repair changed the API.

#### Code Review #2 Findings

Pass. Independent targeted recheck resolved P4-B1/P4-B2 without new findings.
Thirteen targeted tests, both original crash reproductions, the original low-disk
reproduction and diff checks passed. The reviewer confirmed restart recovery,
exclusive publication, manual replacement preservation and bounded disk admission.
Final full-suite/static evidence above completes the Phase 4 gate.

#### Code Review #2 Revisions

No further revisions required. One repair round remains unused. Phase 4 is ready
for `feat(content)[p4]: install reviewed packages with durable recovery`; record
the resulting SHA at Phase 5 startup. Browser/native acceptance remains separate.

### Phase 5: Implement the Library frontend from the UI mockups

Requirements: R1–R5 and the spec's UI references/accessibility constraints.
Dependencies: stable generated Phase 4 contracts; supported Phase 1–2 content.

**Open all four saved mockups before implementing the frontend components and
use them throughout visual review.** Match their modal structure, information
hierarchy, spacing and selection/review flow using current app components/tokens.
Do not treat these as optional inspiration or redesign the surrounding Library.

| Required mockup | Components and behavior to implement against it |
| --- | --- |
| [01 — Import / Export entry](reference-01-import-export-entry.png) | `LibraryPage.tsx` header button and a focused `LibrarySharingDialog.tsx` with two entry cards, one-file drop/picker and export navigation. |
| [02 — Import review](reference-02-review-import.png) | `ContentImportReview.tsx`: package header, selected roots or Anima, required-item disclosure, resolved names and final whole-package action. Replace the illustrative dropdown/parentheses with automatic suffix review. |
| [03 — Export selection](reference-03-export-selection.png) | `ContentExportSelection.tsx` and Anima selection: Content/Anima tabs, searchable typed rows, persistent multi-selection and package summary before review. |
| [04 — Anima export](reference-04-anima-export.png) | Anima selector, identity review, included-content summary, privacy notice and filename/size/export footer. Omit Music; Edit export copy is illustrative and does not expand the agreed scope. |

Component names are proposed seams, not a required abstraction hierarchy. Reuse
Dialog, Button, query hooks and existing catalog presentation. Do not route these
files through Chat Uploads/Uppy or introduce a second private attachment system.

1. Add Idle Styles to Library inventory/search/filter/presentation and the export
   picker. Store selections by catalog identity across pagination/filter changes.
   Keep Appearance dependency-only; exclude Music, standalone Clips, Voice and
   Chat Uploads. Fetch package counts/required items from the backend selection
   summary operation; cancel or ignore stale responses when selection changes.
   Prepare the immutable archive only when the user chooses Review export.
2. Build content and complete-Anima selection/review. Provide full scrollable
   identity text, equipment/configuration, dependencies and local-storage copy.
   Show the automatic collision names and block invalid final actions. Explain
   that content-only installation adds Library items for later equipping.
3. Implement part progress, validation, stale-review refresh, cached export save,
   precommit discard, pending/unknown commit recovery and success navigation.
   Download through the admitted same-origin browser download path with safe
   Content-Disposition; do not fetch the entire archive into a Blob/ArrayBuffer.
   Keep active response/cache lifetime protected from cleanup. Use truthful
   Download started feedback unless the platform confirms completion; verify
   Electron save/cancel/error behavior without adding broad filesystem IPC.
   Disable repeated submissions. Closing a pending commit preserves its operation
   recovery path; it must not announce cancellation or silently create a new copy.
4. Complete the Anima review shown in mockup 04 and add unillustrated states: full
   configuration/dependency review; export save;
   empty/no selection; invalid/missing dependency; oversized/unsupported file;
   suffix/length errors; expired review; upload failure/retry; long package/identity;
   installed Anima needing runtime preparation; and completion for each package kind.

Validate focused selection/state-machine/component tests plus an active
`accountless-content-sharing.spec.ts` journey in Playwright's allowlist. Use the
named disposable fixture and consent described by
[browser journeys](../../frontend/testing/browser-journeys.md). From `src/frontend`:

```bash
pnpm e2e:list -- --project chromium --grep "local content sharing"
pnpm e2e:test -- --project chromium --grep "local content sharing"
```

Confirm the first command actually lists the new journey. Compare screenshots to
all four mockups at a desktop viewport first (for example 1440×900), then a
narrow viewport (for example 390×844). Verify bounded scrolling, readable long
names/identity, reachable final actions, tab/checkbox labels, visible focus,
Escape/back behavior and focus return. Exercise both Vite development and built
FastAPI serving at the same-origin boundary. Record reviewed screenshots as
public-safe evidence references and summarize differences; don't force-add raw
traces or private evidence directories.

Completion: both full user journeys work with the agreed mockup structure,
truthful counts/copy and keyboard support. Native picker/download/playback
acceptance remains explicit in Phase 6; DOM tests alone cannot close it.
Recovery: refresh resolves the existing import operation; cancelling an inactive
stage discards only owned temporary data and keeps prior Library selection/content.

Issue: [#86](https://github.com/raymond-van/animama/issues/86). Starting SHA:
`0d29a3348f3b3c738bd65cba974a7c162d4838aa` (verified Phase 4 commit).
Boundary: Library inventory and mockup-based sharing dialogs, generated API flow,
bounded upload/recovery, direct download, focused tests and active browser journey.
All four mockups were opened before implementation. Parent owns flow/recovery and
UI integration evidence; delegated UI work owns controlled presentation and Idle
Style inventory integration. No backend schema changes are planned.
Verified phase changes ready to commit; record the resulting SHA at Phase 6 startup.

- The controlled UI now mounts from Library and includes Idle Styles in inventory,
  filters, preview and export selection. Typed family endpoints supply complete
  sharing inventories without using the older Avatar cursor adapter.
- Import state tests observed three behavioral failures before implementation;
  all twelve current session/storage tests pass. They cover bounded sequential
  slices, re-verification of acknowledged parts, lost review/commit replies,
  repeated commit suppression, unavailable storage, corrupt recovery, another
  window's operation and format/size rejection. Only nonsensitive identifiers
  and the commit-uncertainty flag persist; files/reviews/identity remain in memory.
- Initial UI tests observed missing inventory/sharing/tab associations before
  implementation. The delegated focused suite passed 61 tests; root flow lint,
  type-check and package build passed before subsequent visual refinements.
- Development browser inspection verified Gesture summary/preparation and full
  Anima identity/equipment reads. It found sidebar overlap and entry-card layout
  differences; the UI now uses the existing sidebar-aware dialog, original
  icon/header arrangement and a fixed header with bounded body/sticky footer.
  Responsive/focus/import evidence is still pending; these observations do not
  constitute completed visual acceptance.
- The container's isolated package outputs initially lacked the new SDK methods.
  Its pinned pnpm build passed after explicitly supplying its corepack PATH.
  The task stack was restarted with deterministic model clients for the
  authorized active browser journey. No other stack or user data was reset.

- `pnpm check`, `pnpm web:lint`, `pnpm build` and `pnpm packages:test` passed
  (19 package tests; Chromium fixtures required sandbox escalation). The full web
  suite passed 1,712 tests and hit 17 listener-permission failures in three files;
  rerunning those three files with loopback permission passed all 36 tests.
  Later affected UI tests passed 63 cases. The task-owned frontend formatter
  check passed 37 files. Aggregate formatter checks report 12 files byte-unchanged
  from the original task baseline (10 web, two desktop); those unrelated files
  remain untouched and the aggregate check is not represented as passing.
- A browser-injected lost-response path exposed an absent SDK `Response`
  dereference. Two regression cases failed before the transport wrapper was
  corrected; all 15 transport/session/storage cases now pass, as do affected lint
  and actual web app TypeScript checks. The recovery operation remains intact.
- The same worktree now also has a separate built stack,
  `animama-local-sharing-built-0c75`, at
  `http://animama-local-sharing-built-0c75.localhost:8520`, recorded in
  `.animama-stacks/local-sharing-built.env`. FastAPI alone publishes loopback port 8520;
  PostgreSQL is private, no Node web service or optional profile is enabled,
  and deterministic model clients were verified. Its production build includes
  the transport repair. Preserve both task records and data roots.
- Desktop and settled narrow Anima selection were visually checked against
  mockup 04: identity and included counts split into columns on desktop and stack
  on narrow screens; identity scrolls and the final action remains visible.
  The first active journey attempts exposed test-only branch-name, selector,
  same-origin fault-injection and response-timeout assumptions. Their failed
  evidence and exact operation ledgers are retained; successful complete journeys
  and reviewed screenshot references remain pending.

#### Code Review #1 Findings

Independent Review #1 is blocked by four required findings over the frozen Phase
5 working tree based on `0d29a334`. The checks reviewer independently reviewed
root flow and E2E ownership (excluding its own UI authorship); the second reviewer
covered the complete Phase 5 boundary and all four mockups. Browser gates remain
pending. Canonical IDs below consolidate the checks review's FLOW1/FLOW2 aliases.

- **P5-B1 (FLOW2):** acknowledging a completed import cleared recovery IDs without
  discarding its server stage. Downloaded export caches likewise occupied the
  shared two-stage quota until expiry. Confirmed absence during export cleanup
  also trapped Back/Close on a stale review. Active response leases must survive
  cleanup; durable receipts remain completion authority.
- **P5-B2 (FLOW1):** destination/prerequisite-stale imports restored their obsolete
  immutable review as actionable. Refresh called the same endpoint and could not
  renew a failed stage; the same digest could be submitted again.
- **P5-B3:** Anima export showed kind totals and directly equipped names but no
  inspectable names for transitive dependencies in selection or final review.
- **P5-B4:** exact deletion of imported Particle Effects removed catalog rows/files
  but left empty nested texture directories. These remained occupied destinations
  for fresh-path admission. The browser ownership ledger retained the failure.

#### Code Review #1 Revisions

All four findings are verified and accepted. Repair round 1:

- B1: completed imports discard their exact terminal stage before forgetting the
  recovery pointer; unknown cleanup failures retain the result/pointer, while
  confirmed absence is idempotent success. Export cleanup similarly tolerates
  absence. HTTP download finalization marks the cache reclaimable while holding
  its lease; another allocation reclaims inactive finished attempts only under
  quota pressure. Retry bytes remain available beforehand, and active responses
  and never-downloaded reviews remain protected. No browser save completion is
  inferred. Stage tests observed two failures before the fix; HTTP tests cover
  retries and subsequent normal allocations.
- B2: a failed stage retains a blocking fresh-review message. Explicit refresh
  resolves/discards the old operation and re-uploads the retained File under a
  fresh operation for review; after reload it asks for the file again. It never
  auto-commits or replaces an uncertain/completed operation. Four session cases
  failed before repair; all 13 session tests now pass, including terminal cleanup.
- B3: both Anima export screens reuse the complete required-items disclosure,
  including indirect effects, sounds and portrait names. Two missing-name cases
  failed before repair; 15 focused rendering tests now pass, including preserved
  single disclosure on import and the existing identity/configuration layout.
- B4: deletion prunes only empty nested ancestors of verified registered file
  paths, deepest first. Five cases failed before repair; 47 affected filesystem
  tests pass, including unknown file/directory/symlink preservation and restart
  rollback restoration. The six earlier fixture residues were independently
  verified as receipt-owned empty directories, removed with bottom-up `rmdir`,
  and checked by the existing exact-run cleanup. All 141 owned identities from
  that failed run are deleted; its denied precommit operation remains an honest
  failed-run record with no installed result or owned residue.
- E2E helpers now observe real dialog Close between operations and no longer
  delete normal downloaded caches themselves. An explicit test-owned missing
  cache checks Back/selection recovery. Capture waits for dialog bounds inside
  the viewport, records focus/final actions, and disables screenshot animations.

Final repair checks: 70 focused frontend tests, 56 affected package backend tests,
47 filesystem tests, backend format/lint/mypy over 558 sources, actual web app
TypeScript and generated SDK freshness (17 files) passed. Both task stacks were
refreshed with the same repaired source and deterministic model clients.

#### Code Review #2 Findings

Targeted independent review passed B1–B4 and their introduced regressions. The
primary reviewer independently ran 26 frontend and nine backend tests and
reproduced missing-cache Back/Close recovery while confirming that active-stage
and transport errors retain the review. The checks reviewer independently ran
five session reproductions, including protected active/unknown outcomes, and
passed FLOW1/FLOW2; it excluded its own B3 UI authorship.

No additional required findings. Source repairs pass. Independent visual review
also passed all eight final development screenshots, including header/Close
visibility, bounded scrolling and final actions. The
[retained comparisons](p5-library-visual-evidence.md) cover all four mockups at
1440×900 and 390×844. Browser completion below remains a separate gate.

#### Code Review #2 Revisions

No product revisions required. One repair round remains. Development run
`run-0924142007` passed all three tests: setup, complete content sharing and
complete Anima sharing. This covers single/multiple export, automatic suffixes,
lost completed response/reload recovery, missing-cache Back, opening the new
Anima after reload, all 138 copied file manifests and exact cleanup. The ledger
has no unresolved content/import operations and Local snapshots are unchanged.

Built run `run-0924142854` passed the complete Anima journey and exact cleanup.
Its content test deliberately reloaded too early after clicking View in Library,
aborting the actual stage acknowledgment DELETE. The retained completed recovery
correctly reappeared. The normal persistence check now waits for that real DELETE
and the closed dialog before reloading; deliberate lost-commit recovery remains
unchanged. Affected content reruns passed: development `run-0924143303` (two tests,
1.1 minutes) and built `run-0924143458` (two tests, 36.8 seconds). The failed mixed
run is retained and is not relabeled a pass. Unchanged Anima evidence from both
modes remains valid. Every final ledger reports zero remaining work; respectively
144, five, 140 and five owned identities were deleted across the four runs.
Root also checked representative production desktop and narrow screenshots.

Final `UV_NO_SYNC=1 UV_CACHE_DIR=/tmp/animama-p1-checks-uv-cache make check-test`
passed typed-content audit, format/lint/mypy over 558 sources and 2,158 tests
(seven skipped). The Python import-boundary check reported zero forbidden edges.
`pnpm e2e:check`, `pnpm web:lint`, `pnpm openapi-ts:check` (17 files current) and
`git diff --check` passed. These checks use
the repaired source; no provider or native acceptance is inferred.

### Phase 6: Prove combined sharing, preservation and desktop behavior

Requirements: every spec acceptance row. Dependency: Phases 1–5 evidence and
bounded reviews passed. This phase closes cross-boundary gaps, not a fresh search
for unrelated cleanup or a repetition of unchanged passing tests.

1. Transfer original fixtures between two independent installation owners/Local
   roots: one Gesture, overlapping selected roots, an Idle Style, an Avatar with
   portrait and a complete Anima with distinct images/empty cells/overrides.
   Edit one imported dependency and prove earlier content/Animas remain unchanged.
2. Run the transition and import restart scenarios against disposable existing-
   data fixtures as well as fresh baseline databases. Include old completed
   receipts and unrelated identity/history sentinels. Inspect exported contents
   for private data and verify no provider request during install.
3. Record actual VRM/VRMA/clip/SFX/VFX behavior. Observe one normal 180-second idle
   interval in real time; use deterministic clocks for the remaining matrix.
   Verify audible interruption, finite repetitions, effect cleanup and unrelated
   TTS/SFX continuity. Retain separate real browser and macOS Electron evidence.
4. Exercise file choose/drop, save and import result recovery in Electron using
   an isolated test profile/runtime and admitted local origin. Record whether
   this is an external-stack development shell or packaged embedded runtime.
   Neither substitutes for the other; if the required native environment or
   playable assets are unavailable, leave that acceptance pending and report it.
   No signed release, paid provider run or publication is needed here.
5. Update useful current guidance: glossary Pose Clip/Idle Style definitions,
   typed content/package docs, Library, loadouts/creation, idle/audio runtime,
   browser journeys and local-storage recovery. Remove obsolete BGM/override
   promises rather than append delivery history. Keep details in their owning
   docs; an ADR is needed only if implementation changes an established boundary.
6. Complete the validation ledger and final integration review below, then
   deliver the authorized work through the usual single-PR workflow. Separate
   actual hosted `Validation` from local checks and pending manual acceptance.

Completion: all required evidence is recorded or an explicit owner waiver is
identified; do not label unavailable browser/native evidence as passed. Exact-
candidate merge and any publication remain separate owner gates.

Issue: [#87](https://github.com/raymond-van/animama/issues/87). Starting SHA: record predecessor commit when phase starts.
Commit / evidence: pending.

#### Code Review #1 Findings

Not run. Review cross-installation acceptance and preservation evidence.

#### Code Review #1 Revisions

Not run. Two repair rounds remain.

## Validation and acceptance

Use behavior-first tests for consequential changes, with failing-before evidence
where applicable. The phase batches are starting points; add tests for new
contracts and record actual commands, exact source, result and environment.
Source inspection and this plan are not passing runtime evidence.

| Evidence | Required boundary | Current result |
| --- | --- | --- |
| Planning | Spec/plan/mockup links, source paths, whitespace and consistency | 2026-09-23: 17 local links, all listed existing test/source paths, six phases, three PNGs and Markdown whitespace checked; independent planning findings addressed. No code tests run. |
| Phase 1 | Cell resolution, finite clocks/events, both players, isolated AI equipment, old idle conversion | Passed and committed `8e2a68e`; full local backend/frontend checks and rendered gates recorded above. |
| Phase 2 | Retired data/receipts, preserved Actions/audio/TTS/Creator JSON, repeatable transition | Passed and committed `08e31f2`; full local backend and targeted repair/static/rendered evidence above. Review #3 passed. |
| Phase 3 | Multi-root/Anima projection, private-data absence, images, exact export bytes | Passed; initial full backend 2025 passed/7 skipped, final affected batch 199 passed, static and Review #3 passed. |
| Phase 4 | Whole-package review, multipart limits, independent copies, single outcome under failure/retry/restart | Passed; final full backend 2149 passed/7 skipped, static 558 sources, caller/SDK checks and independent Review #2 passed. |
| Phase 5 | Four mockup comparisons, complete content/Anima flows, keyboard and narrow layouts, both serving modes | Passed targeted Review #2, eight visual comparisons and both complete journeys in both serving modes; exact cleanup and final backend checks pass. |
| Phase 6 | Independent installations, retained existing data, real audio/avatar and explicit native evidence | Not run. |
| Hosted CI / release | Actual candidate `Validation` scope; separate release/publication approval | Not requested or run. |

Before pushing the implementation candidate, run applicable offline checks from
the repository root:

```bash
make check-test
uv run --no-sync python scripts/repository-boundary/check-python-imports.py
git diff --check
```

From `src/frontend`:

```bash
pnpm openapi-ts:check
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
pnpm prettier:check
pnpm packages:test
pnpm e2e:check
```

Build package artifacts before package fixtures. Add `pnpm desktop:test` when
desktop bridge/download code is changed; `pnpm check` already includes desktop
type checking. Run shared-catalog generation/checks when authoritative catalog
inputs change. Record prerequisite/environment failures without presenting them
as product results. Do not invoke live-provider tests, packaged release tools,
global resets or cleanup of another task's resources to finish this plan.

## Idempotence and recovery

- Before actual conversion, verify coordinated database/Local/private-data
  backup and restore on disposable fixtures using the documented storage
  contract. Preserve private recovery originals outside scanned/exported roots.
- A conversion replay uses its original receipt/mapping; it does not overwrite
  a later edited Style/Action or duplicate generated Gestures. Changed legacy
  inputs require a newly validated conversion, not reuse of an old digest.
- Import staging contains no selectable Library items. Cleanup uses stage
  ownership, expiry and locks, never filename guesses. Active/ambiguous commits
  retain journals and originals until the receipt authority resolves them.
- A committed receipt means content and optional Anima belong to one completed
  outcome. Repeated requests return its snapshot; deleted results stay deleted.
  No receipt plus an unresolved active journal requires recovery, not another
  independent import. Preserve conflicting manual edits and report safe reasons.
- If a deployed conversion must be undone, restoring old code alone is not a
  data rollback. Restore cooperating authorities from the verified pre-transition
  backup, or implement a reviewed reverse conversion that checks later edits.
  Never reset a user's library or discard evidence as a recovery shortcut.

## Final integration review

Review the combined diff against the starting baseline and every spec acceptance
row. Reuse still-valid phase results and test failures fixed at their exact
revision; rerun affected checks when subsequent changes invalidate them. Check
that old data compatibility has not accidentally become old-package support or
retained product Music/standalone Clip behavior. Review all four mockups against
the implemented screens and explicitly inspect full configuration, error and
completion states they omit.

### Code Review #1 Findings

Not run. Record final source/base, requirement mapping, independent reviewers,
checks, evidence and stable findings. Local/browser/native/hosted results stay
separate. No review count is consumed by authoring this document.

### Code Review #1 Revisions

Not run. Two repair rounds remain. Record each verified disposition, correction,
affected recheck and remaining blocker; append numbered repair records as needed.

## Outcomes & Retrospective

2026-09-23: proposed six-phase plan produced from the specification and current
source. It explicitly connects all three saved UI mockups to frontend work and
acceptance. No product behavior, installation data, stack, issue, commit or PR
changed during planning.

The initial independent planning consistency pass identified export-summary
cost, renderer download buffering, sealed digest/replay, upload resumption and
capability-validation gaps. These were addressed in the implementation contracts
and affected phases. This planning review is not implementation code review or
runtime acceptance and consumes no phase code-review round.

Remaining gates are implementation authorization, each phase's checks/review,
rendered and native acceptance, final integration review and exact-candidate merge
approval. There is no unresolved product interview question. Exact helper/DTO
names and supported-field/capability enumeration are bounded implementation work
before dependent APIs ship, not reasons to reopen agreed sharing behavior.

2026-09-23 follow-up: committed the original planning artifacts as `9a3971d`,
then added the fourth unchanged mockup for Anima export and linked it from the
spec and Phase 5. The outdated Music row and illustrative identity-edit control
do not supersede the agreed requirements.

2026-09-24 setup: owner approved the whole plan. Published the spec as #81 and
linked phases #82–#87 with native parent/dependency relationships. Preserved the
fourth mockup and prior planning commit. No runtime data was inspected or changed.
