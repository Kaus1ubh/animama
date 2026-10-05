# Build one web application for self-hosted and hosted use

This is a living ExecPlan governed by [PLANS.md](../../../PLANS.md) and
[SDLC.md](../../../SDLC.md). Maintain Progress, Surprises & Discoveries,
Decision Log and Outcomes & Retrospective during execution.

Source agreement: [issue #272](https://github.com/raymond-van/animama/issues/272),
the [current spec snapshot](hosted-web-parity-spec.md) read back at
`2026-10-05T16:26:16Z`, and the owner's 2026-10-05 approval of option 3,
the coordinated execution order and workspace setup. The initial spec snapshot
is retained at `fab1acc9f01dde2cb1aa567df521ff6b4eb66335`; the reviewed initial
plan is `6ddf2f2a20f2cad07d376dd4294fce2e0234ae1c`.

Authorization: **A1–A6 implementation authorized on 2026-10-05**, coordinated
with the hosted consumer plan in the agreed order. Workspace setup was verified
at `339878dd81bea806359e4375732070e7745ec03d`; the assigned worktree and branch
are clean and reused. Use one branch and PR for this plan. Merge, paid-call,
artifact-promotion and deployment authority remain separate.
#272 remains the product scope authority and combined progress record.
Cloud owns a separate implementation plan and assignments. Public work must
remain understandable and executable without access to that private plan.

## Purpose and context

Build an explicit hosted entrypoint from the existing React/Vite application,
sharing its product router, screens, settings, creators and browser runtime with
self-hosted web. Deliver a verified immutable static application alongside the
shared backend packages. A hosted consumer supplies authentication, tenancy,
storage, providers, quotas and operations through documented interfaces.

The completed product outcome retains every existing end-user web workflow
except Anima creation, chat attachments, document ingestion/OCR, provider
credential/connection administration, local filesystem administration and
Electron features. Missing hosted support is implementation work, not another
exception. Voice, avatars, effects, memory, Library, creators and content sharing
remain in scope. This plan's phases are engineering checkpoints toward that
whole outcome, not separately accepted reduced hosted products.

Animama owns shared browser source, reusable services, contracts and artifact
production. It does not own hosted sessions, database migrations, object stores,
billing policy or deployment. Keep the existing libraries and dependency
direction; do not extract the entire application into another npm package,
copy product routes or introduce a general plugin/capability framework.

### Starting source and environment

Reuse the assigned `animama` task worktree on `feat/hosted-web-parity`, starting
from spec commit `fab1acc9f01dde2cb1aa567df521ff6b4eb66335`; its inspected
implementation baseline is `f90c080fc343a159cb9d7f9059a35127f871c021`.
Before implementation, verify Git root, branch, HEAD, dirty state and current
base. Preserve later task work. Setup has started no stack. Record any later
stack name, URL and source in the phase evidence; use the existing named-stack
workflow and do not reuse an unrelated installation's data.

Read the root and scoped agent guides, `docs/backend/README.md`,
`docs/frontend/README.md`, `GLOSSARY.md` and the relevant ADRs before editing.
Hydrate needed LFS files before treating missing avatar/model bytes as regressions.
Use frozen dependency installation and the repository's existing tool versions.

### Source map and parity coverage

Paths below are repository-relative. Route files are under
`src/frontend/web/src/routes/`; UI paths are under
`src/frontend/web/src/`. The table maps the inspected source, not an invented
future route tree. A1 must enumerate individual actions beneath these groups,
including dialogs and menu actions, and attach API and test coverage to them.

| Surface and source                                                                                                                             | Retained actions and implementation assignment                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__root.tsx`, `_app.tsx`, `_app/index.tsx`, `app/router.tsx`, `ui/sidebar/`                                                                    | Shared shell, sidebar, preview dock, deep links, reload, keyboard and responsive navigation. A3 replaces installation-specific gates through composition adapters. Empty hosted rosters remain useful.                                                                                                                                                                                                                                                   |
| `_app/$animaId.tsx`, `_app/$animaId/index.tsx`, `_app/$animaId/c/$chatId.tsx`, `ui/main/chat/`                                                 | Chat/history/search, rename/delete, stop/retry, Markdown, layouts and model selection. A3 preserves the mounted companion across chat changes; A4 verifies all actions against shared contracts.                                                                                                                                                                                                                                                         |
| `_app/animas.tsx`, `_app/animas/index.tsx`, `_app/animas/$animaId.tsx`, `_app/animas/$animaId/identity.tsx`, `ui/animas/`                      | Existing-Anima identity, relationship memory, settings, portrait/background framing, appearance, avatar/voice and loadouts. Retain existing management actions; do not invent a deletion UI.                                                                                                                                                                                                                                                             |
| `_app/create.tsx`, `_app/animas.new.tsx`                                                                                                       | Retain the Create hub and content creators; block Anima creation and direct creation navigation with a concise reason. Account bootstrap belongs to the consumer, not this route.                                                                                                                                                                                                                                                                        |
| `_app/library.tsx`, `ui/library/`, `ui/content-preview/`, `ui/content-health/`                                                                 | Existing tabs, search/filter, thumbnails, validation, preview, customize/edit/delete, selection and recovery. Omit host directory scan/path administration only.                                                                                                                                                                                                                                                                                         |
| `_app/poses.$poseId.edit.tsx`, Gesture/Reaction/Idle Style `.new` and `.edit` routes                                                           | Retain Pose/Pose Clip and timeline/content workflows, Save, Save & Equip, draft/conflict recovery and format import/export. Pose Clip is not new Anima equipment.                                                                                                                                                                                                                                                                                        |
| Avatar/Particle/Scene Effect `.new`, `.edit` and existing index routes; Sound Effect routes                                                    | Retain each existing creator and its asset/audio controls. Verify creator, Library and live-Anima playback separately. Do not restore a standalone music Library feature.                                                                                                                                                                                                                                                                                |
| `lib/content-sharing/`, `query/hooks/useLibrarySharingFlow.ts`                                                                                 | Content-package inspection/review/commit/export and supported creator formats; Anima export remains. Reject Anima-package import before installing any contents.                                                                                                                                                                                                                                                                                         |
| `_app/memories.tsx`, `ui/memory/`, memory queries/mutations                                                                                    | Account-shared user memories, episodes, virtual files/folders, history/conflicts, Anima memories and user-started Memory Manager/Reflection. Logical memory paths are retained, host paths are not exposed.                                                                                                                                                                                                                                              |
| `ui/sidebar/ApplicationSettingsModal.tsx`                                                                                                      | General, Appearance, Memory & Emotion, Safety, applicable Data reset, Advanced and About remain. Models retains model/role choices but omits connection/key/search-provider administration. Voice retains microphone, engine/voice choices, readiness, download and clone workflows. API Keys is omitted. Shortcuts retain browser actions and omit native actions. About omits native updates/host logs while retaining applicable product information. |
| `ui/app/AnimaRouteProviders.tsx`, `ui/main/MainShell.tsx`, `lib/avatar/`, `lib/runtime-content/`                                               | Runtime snapshots/leases, expressions, gestures, reactions, idle, camera, lip-sync, effects/background/audio and revision/remount behavior. A2 supplies neutral service interfaces; A4 handles browser delivery and lifetime.                                                                                                                                                                                                                            |
| `lib/speech/`, `workers/`, `hooks/use-tts-playback.ts`, `ui/animas/VoiceCloneLibrary.tsx`, `ui/settings/VoiceDownloads.tsx`                    | Dictation, Voice Mode, microphone selection/test/sensitivity, STT/TTS, clone/voice catalog, playback/stop/mute and locale/readiness/fallback. Browser model downloads are retained; server-wide model installation is excluded.                                                                                                                                                                                                                          |
| `setup.tsx`, `desktop/pip/$animaId.tsx`, `desktop/quick-chat/$animaId.tsx`, `a.tsx`, `a/$.tsx`, `safety.tsx`, `_app/avatar-portrait-debug.tsx` | Local setup/native windows remain local composition utilities. Preserve current legacy navigation and safety behavior where applicable. Classify the portrait diagnostic by its actual entry points in A1; ordinary portrait editing stays included. Browser fullscreen/PiP remain available by browser support.                                                                                                                                         |
| New thin hosted composition/account integration                                                                                                | Sign-in/out, eligibility/readiness, restriction/outage, account access and usage/limits in the common shell. Document HTTP contracts; no identity implementation or provider credentials enter the bundle.                                                                                                                                                                                                                                               |

The backend reference is `src/backend/animama/app/{contracts,ports,services}`,
`app/chat`, `app/model_clients` and supported `adapters`. Existing local route
behavior under `server/routers` identifies observable contracts but is not a
hosted import surface. `app/contracts/runtime_capabilities.py` is richer than the
current `{chat: boolean}` browser product capability type; extend the existing
contract instead of maintaining a second truth.

## Progress

- [x] 2026-10-05 [A1 / #273](https://github.com/raymond-van/animama/issues/273): agent-verified contracts/complete action map; required checks and independent review #1 passed, repairs 0 of 2. Phase commit recorded below; the consumer requirements gate C1 has passed.
- [x] 2026-10-05 [A2 / #274](https://github.com/raymond-van/animama/issues/274): corrected portable preference merger committed at `6a150fd45d5e215e7f134010b53b9c62e4316ede`; targeted independent review #3 and clean installed-wheel gate pass. Repair rounds used: 2 of 2. Neutral services are ready for isolated consumer C2 repair and A4.
- [x] 2026-10-05 [A3 / #275](https://github.com/raymond-van/animama/issues/275): committed at `e8ef7768d2edcfc7cef58c508bf3fb66ba0d2302`; targeted independent review #2 passes after repair 1 of 2 for chat cache partitioning and durable recovery cleanup.
- [x] 2026-10-05 [A4 / #276](https://github.com/raymond-van/animama/issues/276): public retained-workflow and resource-lifetime engineering passes independent analysis/checks #1, repairs 0 of 2. Physical capture/heard output and actual hosted/provider/device acceptance remain explicit C5/C7 gates; this is not a declaration of delivered voice parity.
- [ ] 2026-10-05 [A5 / #277](https://github.com/raymond-van/animama/issues/277): planned; depends on A4 and its prerequisites.
- [ ] 2026-10-05 [A6 / #278](https://github.com/raymond-van/animama/issues/278): planned; depends on A5/all public gates; coordinate with C6 without requiring a future main pin.

## Surprises & Discoveries

At the inspected source, sharing the router alone is insufficient: startup
directly depends on local readiness, the API client is configured through a
module-level default, and settings hide model-role selection under provider
administration. These are composition seams to fix without duplicating screens.

Shared content code still assumes local files. `ContentStore` exposes scanning,
`Path` and mutation journals; `ContentSaveService._preflight` rescans and locks
the Local source; `ContentPackageService` receives filesystem staging roots.
Passing object-store keys as local paths would not establish a reusable boundary.

The package-set producer currently emits a wheel, three npm tarballs and two
schemas. Its verifier requires that exact inventory and rejects extra payloads.
The hosted static application needs an explicitly versioned manifest extension.
Existing accountless browser tests cannot establish hosted account isolation.

## Decision Log

2026-10-05, owner: selected option 3 and whole-app near parity with the six
exceptions. Reuse the existing web source and explicit entrypoints; stop treating
the former hosted text-only implementation as the target feature scope.

2026-10-05, planning decision: keep one plan/branch/PR per implementation
repository. A2 and A3 can proceed independently after A1 and the C1 requirements
handoff; resource packaging
spikes can begin after A1, but A5 cannot pass with an incomplete app. Sequence
does not change the accepted product outcome.

2026-10-05, planning decision: premerge integration uses independently installed
immutable candidate artifacts. Public source readiness does not require a hosted
main pin that cannot exist before public merge. Overall #272 acceptance still
requires actual hosted integration, owned by the consumer's plan.

2026-10-05, owner: agreed the coordinated sequence recorded below and requested
workspace/phase-issue setup before beginning implementation. Native issue
dependencies preserve C1 before A2/A3; phase status and parent progress are updated
at each handoff.

## Workspace setup and coordinated order

Setup completed on 2026-10-05 against public base
`f90c080fc343a159cb9d7f9059a35127f871c021` and initial task HEAD
`6ddf2f2a20f2cad07d376dd4294fce2e0234ae1c`. Reuse the assigned Animama
worktree and `feat/hosted-web-parity`; its absolute path is supplied by the task
handoff, not stored in public records. Both reviewed spec/plan commits are pushed.
No dependency installation or stack startup was needed for tracker preparation.
No implementation PR exists yet. Do not change the primary checkout or another
agent's deployment worktree.

| Order | Work and handoff                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | [A1 / #273](https://github.com/raymond-van/animama/issues/273) → hosted consumer foundation C1; reconcile its public-safe contract/ownership/cost needs before A2/A3.                                                                  |
| 2     | [A2 / #274](https://github.com/raymond-van/animama/issues/274) and [A3 / #275](https://github.com/raymond-van/animama/issues/275) may proceed in parallel.                                                                             |
| 3     | [A4 / #276](https://github.com/raymond-van/animama/issues/276) → [A5 / #277](https://github.com/raymond-van/animama/issues/277) alongside consumer C2 → (C3, C4) → C5. Hosted service work uses isolated candidate artifacts after A2. |
| 4     | Common-app consumer cutover C6 alongside [A6 / #278](https://github.com/raymond-van/animama/issues/278); public readiness remains independent of a future main pin.                                                                    |
| 5     | Exact-candidate approved Animama merge → validated main package set → authorized promotion/readback → C7 actual hosted acceptance.                                                                                                     |

The native phase relationships and public-safe combined progress table are in
[#272](https://github.com/raymond-van/animama/issues/272). C phases have private implementation assignments;
no private source or operational detail is required to understand public work.
At phase entry, completion or a readiness-changing blocker, update the child,
this plan and #272 together with exact source/artifact, checks, review outcome,
remaining gates and next ready phase. An unchecked phase means its gate has not
passed. Do not close #272 at the public merge alone.

Implementation will use the checks and explicit gates in each phase below.
A1 is committed at `9ed028cfffd298707fade2636dd742d4454b36d5`; the C1
consumer requirements review passed after one bounded repair round. A2/A3 are
committed and independently reviewed, including the consumer-discovered A2
preference correction. A4 and isolated consumer C2 repair are in progress. All
provider/device, whole-app artifact and release gates remain separate.

Setup validation: all phase issue bodies, native parent memberships and dependency
edges were read back from GitHub, including C1 before A2/A3. The published scope,
requirements and acceptance criteria are unchanged. Documentation link, privacy
and whitespace checks passed; no product tests were run for this setup-only change.

## Interfaces and Dependencies

On resumption, re-read #272 and reconcile later reviewed changes to this snapshot.
Reuse the existing phase issues and task branch; do not duplicate this setup.
A phase issue records its starting HEAD,
requirements, files, dependency status and acceptance. Commit each verified phase
with the repository's `<type>(<scope>)[p#]: <summary>` convention. Do not close
#272 merely because the public PR merges.

The common handoff consists of runtime-owner/readiness and account-action HTTP
contracts, operation capabilities, request/error/SSE schemas, content and memory
revision semantics, provider usage/cancellation ports, and a versioned static
artifact/resource manifest. A1 records concrete field and endpoint decisions in
their existing owning contract files and new contract documentation where needed.
Do not infer permission from a generated SDK method or a browser owner ID.

The consumer must supply account-owned implementations for settings, profiles,
Animas/loadouts, chat/history, memory/runs/approvals, catalog/bytes/drafts/jobs,
voice and bounded provider work. A public contract fixture may simulate those
services to verify this app independently. It is not evidence that hosted
tenancy, real providers or full parity have been delivered.

## Phased implementation

### Phase 1: Map all operations and define compatible contracts (A1)

Scope: R1–R6 and R8–R12. Issue: [A1 / #273](https://github.com/raymond-van/animama/issues/273); starting implementation
source: record actual HEAD at phase entry. Expand the source map into
`docs/plans/hosted-web-parity/hosted-web-parity-coverage.md` (new), with one row
per route/action/settings group, requirement, capability, API/service, owner,
test and evidence status. Include paste/drop/direct API equivalents of excluded
actions. Every retained operation must have an implementation assignment.

Inspect `RuntimeOwnerContext.tsx`, `app/providers/AppProviders.tsx`,
`lib/api/configureAnimaApiClient.ts`, `query/runtime-capabilities.ts`,
`packages/runtime-contracts/src/index.ts` and backend runtime capability schemas.
Define narrow injected composition interfaces for readiness, owner/session,
transport, capabilities and account actions. Keep the existing capability
mechanism; distinguish product operation permission, browser support and
temporary failure. Separate model/role choice from connection administration.

Document shared contract compatibility and authenticated byte/stream/resource
requirements. Design an additive versioned package-set format for the static
app, including a closed asset inventory, entry document, MIME types, workers,
WASM/model references, checksums, notices and supported backend contract bounds.
Decide which resources are shipped or separately admitted lazy downloads; do not
embed all development assets by default or remove retained engines silently.
Follow `contracts/versions.json` and `scripts/package-sets/README.md`: structural
OpenAPI/schema changes currently require a major contract bump, and changed
emitted TypeScript declarations require a package version bump.

Validation: from the root run `uv run pytest -q tests/test_runtime_capabilities.py
tests/test_shared_backend_boundary.py` after applicable contract changes; from
`src/frontend` regenerate with `pnpm openapi-ts`, then run
`pnpm openapi-ts:check`, `pnpm packages:check` and `pnpm packages:test`.
Review every source-map group against routes, sidebar menus and searchable
settings. Add fixture cases for all six exclusions and model-selection retention.
Expected result: no unassigned retained action and no competing capability schema.

Completion/progression: agent-verified contract checks and bounded review. Record
the consumer handoff and unresolved implementation details with their dependent
phase. New exclusions, altered memory meaning or changes to existing security
authority require a product decision before dependent work. No implementation
detail in this phase authorizes a hosted resource purchase or paid test.

Starting source: `339878dd81bea806359e4375732070e7745ec03d`. Implemented the
[coverage ledger](hosted-web-parity-coverage.md) and
[composition/resource contract](../../../contracts/hosted-web.md). The canonical
capability schema is version 2; offline `local-http` is 3.0.0. TypeScript contracts
and product UI are 0.3.0; the extracted chat capability is derived from generated
HTTP types. ADR 0014 records the approved full-app reuse and catalog-role choice.

TDD: seven Python capability cases failed for absent fields/schema, then passed;
the generated validator fixture failed on schema version 1, then passed on version 2. Documentation/type-only interface design uses schema, declaration, source-map
and link checks instead of invented runtime tests. A3 owns actual admission/UI
and lifetime implementation. No behavior in a subsequent phase is claimed done.

Local checks: capability/shared-boundary pytest **28 passed** (73 pre-existing
warnings); `pnpm openapi-ts` and `pnpm openapi-ts:check` passed (17 generated files);
`pnpm packages:build`, `pnpm packages:check`, `pnpm packages:test` passed (runtime
contracts 3 cases, inert Discover fixtures and 19 mounted chat lifecycle cases).
Selected Ruff format/lint passed; Python boundary found zero forbidden edges.
`pnpm web:check` passed. Independent analysis and check review #1 passed; no
implementation blocker and no repair round used.
No full backend regression, live provider, physical audio, deployed hosted/browser
parity or CI evidence exists for this phase. Implementation commit: `9ed028cfffd298707fade2636dd742d4454b36d5`; assignment [A1 / #273](https://github.com/raymond-van/animama/issues/273). Recovery: keep changes additive where possible;
revert the candidate contract and fixture changes together before adoption.

#### Code Review #1 Findings

Reviewed all intended staged/unstaged/untracked A1 paths against starting source
`339878dd81bea806359e4375732070e7745ec03d`. Independent analysis: `cloud_runtime`;
independent read-only checks: `animama_boundary`. No implementation findings.
Checks verified 38 route files/IDs, all searchable settings IDs, local links, JSON,
privacy, package/schema versions, selected formatting/whitespace and the current
passing test/SDK/type receipts. C-A1-01 advisory: stale Outcomes claimed work had
not started. Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

C-A1-01 accepted: corrected stale Outcomes when recording this review. This
bookkeeping correction changes no implementation boundary or test result. No
required fixes or deferred findings. Phase gate PASS; 2 repair rounds remain.
A1 handoff is the checked-in capability/fixture, coverage ledger and contract
design. Hosted requirements review C1 passed; A2/A3 are now in progress.

### Consumer requirements handoff for A2/A3

The consumer requirements/checks gate C1 passed on 2026-10-05 after one repair
round. The public implementation uses these interface requirements without
private source or checkout dependencies:

- H1: explicitly owner-bound catalog and verified-byte access, including identical
  locators under two owners; Included is read-only and Local is writable.
- H2: injected publication/transaction authority; atomic visibility, revision
  conflicts, immutable operation receipts, replay before staging lookup and
  cancellation/ambiguous-commit recovery. Local scan/locking/journaling stays local.
- H3: bounded opaque staging/import/export streams; traversal/hash/dependency/
  expansion validation and cleanup. Reject Anima-bearing imports before installing
  dependencies while retaining Anima export.
- H4: reuse neutral runtime/loadout/presentation services and persistence where
  sufficient; extract verified-byte/publication assumptions, preserve revisions,
  finite leases and Included references.
- H5: bounded model and nested tool/title/compaction/embedding/search/Memory
  Manager/Reflection dispatch with operation identity, preflight admission,
  cancellation and actual usage/outcome. Unknown usage is not zero or undispatched.
- H6: neutral chat success/safety/TTS orchestration with incognito, memory-disabled
  and suppressed-response semantics; one ordered completion after admitted work.
- H7: bounded STT/TTS, usage/uncertainty and cancellation; owner-scoped voice/sample/
  clone catalog interfaces as needed. Hosted paid speech uses a same-origin server
  proxy without unbounded browser provider tokens. Preserve browser model readiness,
  encoding/download continuation and retained engines.
- H8: reuse settings/profile/manual-memory services, logical owner/Anima paths,
  conflict/history/repair/reset semantics and canonical model/role authority.
- H9: composition-owned cookie/CSRF transport before React; A1 admission states and
  no local bootstrap calls in hosted. Fresh session keys for same-owner reauth,
  fenced late requests and private cache/draft/resource disposal on sign-out.

These requirements supply A2/A3 implementation inputs; they do not claim consumer
APIs, actual providers, physical audio or hosted deployment already work.

### Phase 2: Make retained backend behavior composition-independent (A2)

Scope: R3–R10 and R12; depends on A1 and the C1 requirements handoff.
Issue: [A2 / #274](https://github.com/raymond-van/animama/issues/274); starting source
`3006ca3f3c5c6b68c0287cec41dc635f8a94969e`; implementation commit pending. Supply reusable services and ports needed by the mapped hosted workflows,
without importing local installation or HTTP composition into shared code.

Refactor the actual blocking assumptions in `app/ports/content_store.py`,
`app/services/content_save_service.py`, `content_package_service.py`, package
staging/import/export services and runtime/catalog services. Separate local scan,
host-path locking and filesystem journaling from account-owned catalog mutation,
bounded temporary staging, verified-byte reads and idempotent transaction receipts.
Use existing ports where sufficient; add only the operations required by the
retained workflows. Preserve the local filesystem adapter's atomicity, recovery,
source provenance and Included/Local meaning. Hosted writable content is not a
license to redefine those source terms or expose server paths.

Check settings/profile, memory files/episodes/Reflection/Memory Manager,
Anima/loadout/presentation and chat title/compaction services for implicit owner,
global session or server-only dependencies. Extract only required neutral
schemas/orchestration; leave FastAPI admission and installation startup local.
Memory paths remain logical references with owner and Anima scope. Preserve
incognito, memory-disabled and suppressed-response behavior.

Extend existing `app/ports/voice.py`, model-client and memory-manager runtime
ports where needed to express actual usage, bounded requests, cancellation and
recoverable completion for hosted adapters. Keep provider credentials and quota
policy outside shared browser code. A server-proxied speech contract must not
require issuing an unbounded paid provider token to the browser.

Validation from root: run `uv run --no-sync python
scripts/repository-boundary/check-python-imports.py` and focused tests:
`uv run pytest -q tests/test_shared_backend_boundary.py
tests/test_content_save_service.py tests/test_typed_content_save_replay.py
tests/test_content_package_import_atomic.py tests/test_content_package_import_anima.py
tests/test_memory_files_api.py tests/test_memory_manager_reflection.py
tests/test_anima_runtime_delivery.py tests/test_anima_voice_catalog_api.py`.
Add independent non-filesystem fake-port consumer cases for transaction replay,
conflicts, account IDs, resource release and staging cleanup. Run `make check-test`
for the resulting shared runtime/persistence change. Regenerate clients only
through the owning OpenAPI workflow when schemas change.

Completion/progression: local behavior remains covered and a packaged consumer
can instantiate the retained services without importing `animama.local`,
`animama.server`, local migrations or private code. A2 supplies the backend
artifact handoff for parallel hosted service implementation. Recovery: retain
old adapter behavior until replacement parity passes; no development data reset
is implied. Local schema changes, if needed, follow the baseline-only rule.

#### Code Review #1 Findings

Independent analysis (`a2_review_analysis`) found one required defect; independent
checks (`cloud_runtime`, limited to content/contracts it did not author) found two
integration check failures. Initial review is **blocked**. Reviewed frozen A2
working tree at `9fd8d10e05dc41a12152a14fcec97e289393b949` against `3006ca3`;
88-file source digest `b1cc50ac51eb396d4548f164bc3ce320d827dc6757f1142e3491b05b6c11f088`,
plus the artifact checker/README integration. Repair rounds used: 0 of 2.

- A2-R1 (P2): fresh review, cached review and commit reject Anima-bearing packages
  without reclaiming temporary stage bytes/reservations. Two denied packages can
  exhaust the stage allowance and block a permitted content import. R3/H3 require
  cleanup before any installation, while preserving committed receipt replay and
  genuinely unresolved publication recovery.
- A2-CHECK1: A3's explicit hosted adapter trips the broad accountless source guard
  on its comment and OAuth `authorization_url` field. The A3 owner reconciled the
  specific wire-field spelling while retaining same-origin/no-credential checks;
  all eight affected tests passed. This is an A3 integration change, not a new
  local authentication path.
- A2-CHECK2: the retention fixture's unconstrained `Mock` invents an owner ID and
  fails the new store/catalog owner match before testing reference retention.
  The fixture must explicitly describe an unbound local store; production owner
  checks must remain intact.

Reviewed existing evidence: 331 runtime tests, 133 content regressions, 71 final
focused content and 77 local compatibility regressions, six neutral boundary
checks, exact equality of 188 wire-schema snapshots, current generated SDK and
zero forbidden shared imports. Ruff/format and full mypy passed (713 files).
The source-bound full regression run finished: 3,147 passed, 10 skipped,
and the two reported integration/fixture failures above. The frozen source stayed
unchanged throughout the run; affected checks after their correction replace
those failures without repeating unchanged passing suites.

A separately installed development wheel passed all three consumers (real chat,
168 neutral schemas and memory-backed content with the canonical inspector), plus
new runtime import checks, under Python 3.12.13 with frozen declared dependencies.
Independent checks verified the wheel origin is external site-packages with no
editable source redirect and reran the consumers. Wheel SHA-256:
`98978991c52f8232d84675bfc454e299d59485948aeb75ac457a6116760ddb5a`.
This is A2 development-snapshot evidence; A5 still requires clean exact-commit
artifacts. No paid provider, actual hosted parity or promotion is established.

#### Code Review #1 Revisions

A2-R1 and A2-CHECK2 were accepted after source/spec verification. Repair round
1 of 2 reclaims stages through their lease after the inspector closes on definitive
policy denial. It preserves genuine pending publication and receipt-first replay;
the local mock explicitly binds `owner_id=None`. Five behavioral stage-retention
failures preceded the repair. The repaired focused suite passed 46 tests; other
package/publication/mutation regressions passed 310 tests. Full mypy passed its
713-file scope. Ruff/format, boundary audit and standalone source consumer pass.

A new isolated consumer requirement exposed one unused avatar-table LEFT JOIN in
shared chat search. The selected fields already come from Anima; no avatar value
is used. A real PostgreSQL three-family fixture failed on the absent avatar table,
then passed after removing that join, together with six existing search cases.
It verifies two-owner visibility, internal-message exclusion, structured text,
Anima portrait, prefix matching and pagination. Selected Ruff/format/mypy pass.
This narrow consumer repair is part of targeted review #2, without restarting
review or its persistent repair budget.

A2-CHECK1 is resolved by A3's specific hosted wire-field guard exception, with
all eight guards passing. The combined repaired boundary is frozen at
`9fd8d10e05dc41a12152a14fcec97e289393b949`: 93-file digest
`fbb57ec6ce330816f9e97ce54441f8fdbe90f09bbdd7248f3aa05c47d76c92ed`.
Targeted independent analysis and checks review #2 **PASS**; no required finding
or repair regression remains. The subsequent clean exact-commit candidate wheel
gate passed independently, completing A2 and enabling consumer C2 entry.

#### Code Review #2 Findings

Targeted analysis (`a2_review_analysis`) and independent content/contract checks
(`cloud_runtime`) pass at the frozen 93-file digest above. A2-R1 and A2-CHECK2
are resolved, A3's A2-CHECK1 integration check passes, and the narrow search
consumer repair passes. Reviewers verified source hashes and retained prior phase
evidence; no broad review restart or additional repair is claimed. Repair rounds
used: 1 of 2; one remains.

#### Code Review #2 Revisions

No further corrections required. Final root Ruff and formatting pass for all 714
backend/test files; full mypy passes 714 files. Fresh root accountless checks pass
eight tests. Reuse the source-bound full-suite result with affected post-repair
checks: 46 import/materializer, 310 other content/publication/recovery and seven
search tests pass. The repair commands were reported by their author after
execution, bound to its unchanged freeze manifest; they are not presented as
independently rerun or live-provider evidence.

Implementation commit `c4cd0ef621b5e10a10cf9a29bf806db8f149cd86` supplies clean
immutable inputs (tree `364d87e409994a9ba555bef06e17e8d5092928e1`). The backend
wheel is `animama_backend-0.3.0-py3-none-any.whl`, SHA-256
`af776bf060ab9bff9a78320649bc5c8b5cecffa75faf2159074fe47fb3b9ccc6`.
The clean receipt covers 528 build inputs with digest
`4cb1b72301bc90ac87a6a667b30ec9ea0a58ca117dd8627c7bcf9ba122f0a57f`.
Independent artifact checks verify the committed fixture bytes, installed wheel
bytes and origin, no editable/source redirects, and no LFS pointers in the wheel.
From an isolated Python 3.12.13 consumer, `python -I backend_consumer.py
--forbid-source <clean-source>`, `python -I contracts_consumer.py` and
`python -I content_consumer.py` all pass: two owners, two chat turns, six events,
four persisted messages, 168 neutral schemas and real owner-isolated content
save/export/import/replay/conflict/rollback/cancellation/cleanup; zero local imports.
A2 phase gate **PASS**. Consumer C2 begins using this explicit artifact-only
candidate; normal production pin and main-promotion policy remain unchanged.
This backend handoff does not satisfy A5's complete static-app/resource gate or
provider, physical device, whole-app and deployment acceptance.

#### Consumer-discovered A2-R2 and repair round 2

C2 initial independent analysis reproduced a saved memory-update default being
ignored when chat dispatch overrides are absent. The consumer passed only
request flags; the canonical request → Anima → owner merger still lived beneath
`server/chat_options.py`, so the installed neutral surface did not supply it.
Root verified the producer policy and accepted A2-R2: move that existing pure
policy into `app.chat.options`, retaining the local resolver and compatibility
reexport. C2 must load owned settings in its existing tenant session and consume
this helper, preserving explicit false, absent flags, memory-influence-implies-
no-updates, emotion and request-only incognito semantics. No duplicated Cloud
policy or local-server import is permitted.

This is repair round **2 of 2**, based on new consumer evidence after the original
A2 pass. Targeted independent checks and analysis review #3 PASS for the four-path
correction; no full review restart or
previous finding is reopened. The four-path correction is frozen at `b8ff551e`,
source digest `94974e550cc68aed4eea1710c42179400df4fd0602469b93efb67777c3ffcb80`.
The new neutral import fails before correction; afterward10 inheritance checks
and194 existing settings/direct-turn/local-SSE tests pass. Scoped Ruff/format
and the repository's configured mypy714 pass; shared import closure remains
297 reachable/230 shared/zero forbidden. The first affected test attempt had
43 Docker sandbox fixture errors alongside151 passes; the permitted disposable
PostgreSQL rerun passes all194. An initial packaging-inclusive mypy command was
outside the configured gate; the correct repository command passes. Neither
invalid attempt is represented as a product pass.

#### Code Review #3 Findings

Targeted independent checks (`animama_boundary`) and analysis (`cloud_runtime`)
**PASS** for the four-path digest above. Checks rerun10 inheritance tests and the
neutral import checker; analysis verifies AST-equivalent extraction and a fresh
neutral import without local/server modules. Source hashes match before/after.
No new required finding or repair regression remains.
The earlier A2-R1 and fixture findings retain their passed dispositions. The
replacement clean exact-commit installed-wheel gate follows reviewed code;
C2/A4 dependencies must retain this new correction gate. Repair budget used:
2 of 2; no further automatic repair round remains for this review scope.

#### Code Review #3 Revisions

A2-R2 accepted and implemented by moving the existing policy; local composition
resolves the same settings as before and reexports the identical shared function.
Public HTTP schemas and SDK are unchanged. The correction is committed at
`6a150fd45d5e215e7f134010b53b9c62e4316ede`. A separate clean checkout produced
backend0.3 wheel SHA256
`ec97678057c52b5421adc6b9d6db3076d93b702d91919407f11fb62978f7f7cb`,
with528 source inputs at digest
`cf8c629f4185f670f8789baf2c65c14a055854856f573cc80f41ed880fa1deb2`.
Fresh isolated Python3.12 installed consumers pass backend, content lifecycle and
14 neutral DTO modules/168 schemas, plus public-only dependency checks. Independent
artifact review passes clean commit/tree/input provenance, wheel RECORD and all504
installed payload files, fixture provenance, isolation and seven fresh preference
scenario groups. No public editable or sibling source path is used. This completes
the replacement A2 artifact gate; normal production pin, A5 complete static app
and provider/promotion/deployment gates remain unchanged.

### Phase 3: Compose one router and application shell (A3)

Scope: R1–R6 and R12; depends on A1 and C1's requirements handoff, then may
run alongside A2. Issue: [A3 / #275](https://github.com/raymond-van/animama/issues/275); starting source
`3006ca3f3c5c6b68c0287cec41dc635f8a94969e`; implementation commit pending. Add `src/frontend/web/src/main.hosted.tsx` as a thin new entrypoint beside
`main.local.tsx`. Share `AppProviders`, the product router/screens and styles.
Explicit build inputs select adapters; do not add `VITE_*` local/hosted product flags.

Inject transport and runtime startup into the existing owner/provider structure.
Remove local readiness/bootstrap imports from shared router guards and implicit
module-global client configuration where it would leak across compositions.
Keep local CSRF/installation admission and hosted session/CSRF handling in their
own adapters. The browser never selects authoritative account identity.

Retain local setup and Electron utility entrypoints in their existing composition.
Host a useful signed-out, eligibility, restriction, outage and empty-roster state
without entering installation setup. Add account and usage affordances through
the common shell. Use consistent disabled-action reasons and direct-route
unavailable states; omit only irrelevant native/server administration controls.

Define owner/session transitions that abort requests, dispose playback/runtime
resources, clear private query/store state and namespace browser persistence.
Inventory private data outside query caches, including drafts, object URLs,
workers and module stores. Account settings stay account-owned; physical device
preferences retain browser-local semantics. Ordinary sign-out preserves server data.

Validation from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`, `pnpm desktop:check`. Add composition/route tests and a new hosted
fixture build command, `pnpm web:build:hosted`, as an explicit script rather than
claiming the current `pnpm build` already covers hosted. Exercise deep links,
reload/back, excluded direct routes, owner A → sign-out → owner B, expired
sessions and empty rosters. Assert zero local installation calls in hosted.

Completion/progression: both entrypoints use the same product definitions and
pass bounded review. Fixture screens do not establish missing API functionality;
track that coverage in A4 and the hosted handoff. Recovery: keep the current local
entrypoint working throughout; retire temporary composition scaffolding before A6.

#### Code Review #1 Findings

Initial review is **blocked** at HEAD
`b8ff551e61831d0f20e9414ccbf7bc4c0da57d37` plus 222 frozen
tracked/untracked/deleted paths; aggregate SHA-256
`0c85fcbfea49b50997361dd6849eb5d0d3785cbf78d74ba5a61d4f301ecf49c0`.
Independent checks (`cloud_runtime`) **PASS**. Independent analysis
(`a3_review_analysis`) verified the same hashes and identified two required fixes:

- A3-R1 (P1): `packages/product-ui/src/chat/useProductChatSession.ts` still
  derives its cache key from the actual owner ID. Readers now use the separate
  session key. Stream completion writes messages into the wrong partition, then
  clears its local/stream state; the completed turn disappears until another
  history fetch. Title/emotion/memory/runtime invalidations miss too. Preserve
  actual owner identity while using one session partition for all private caches.
- A3-R2 (P2): `web/src/app/runtime/private-session-state.ts` clears localStorage
  recovery only. The Particle, Avatar Effect and Scene Effect stores use
  IndexedDB. A disposable Chromium reproduction using actual recovery modules
  and the common controller leaves all three former-session records after
  awaited sign-out, including readable private image bytes. Purge the ended
  hosted session and fence pending writes without clearing local recovery,
  unrelated namespaces, device preferences or public model caches.

The full source-bound baseline passed `pnpm check`, `pnpm web:lint`,
`pnpm build`, `pnpm web:build:hosted`, `pnpm desktop:check` and
`pnpm web:test`: 371 files / 2,494 unit tests plus 34 browser fixtures, no skips.
Only the hosted adapter and its unit test changed afterward for immediate
cross-window logout; check/lint/hosted build/eight repository guards/22 affected
unit/five hosted browser/format/whitespace checks were refreshed. Independent
checks verified receipt reuse and all source hashes, then reran the 22 affected
unit tests successfully. Hosted `index.html` and ten referenced resources exist.
Browser evidence uses loopback Vite/headless Chromium at desktop and narrow
sizes with intercepted HTTP and simulated microphones. This does not establish
actual Cloud, provider, physical audio/VRM fidelity or native acceptance.
Repair rounds used at initial review: 0 of 2.

#### Code Review #1 Revisions

A3-R1 and A3-R2 are **accepted** after root verified the cache readers/writer
and the persisted-recovery implementation/reproduction against R5 and A3.
Combined repair round1of2 is implemented and targeted review#2 PASS.
Distinct-owner/session stream completion and invalidation regressions reproduce
and fix the cache partition. Real IndexedDB tests reproduce retained private
bytes, then verify all three stores, pending/queued writes, delayed failures and
fallback fencing. Local and unrelated namespaces remain intact. Awaited cleanup
also required fencing an older admission result so it cannot replace a newer ready
scope; its red/green regression passes. No further A3 correction is required.
No additional product exception or paid/provider/device claim is introduced.

#### Code Review #2 Findings

Independent targeted analysis (`animama_boundary`) and checks (`cloud_runtime`)
**PASS** for232 paths, aggregate
`fcc229131bae48418e27ee8dbd4486a76ce9600fdc195a10172f4b0abe2606bc`.
The19-path repair delta resolves A3-R1 and A3-R2 with no required regression.
Both reviewers verified all hashes before/after; root's new A2 backend correction
and plan edits are outside this boundary. The original analysis agent could not
resume under the thread limit; its accepted finding IDs and persistent budget
were handed to an independent replacement, without another broad audit.
Independent checks reran three real Chromium regressions: mounted distinct-session
chat completion and two durable recovery/race scenarios; all pass with no skips.
Repair rounds used:1of2; one remains.

#### Code Review #2 Revisions

No further changes required. Fresh source-stable check (web/desktop TypeScript),
lint, package checks,24 package tests, local and hosted builds,13 files/71 affected
unit tests, all36 browser fixtures, eight repository guards, formatting/docs-link/
whitespace checks pass. All188 SDK calls have explicit admitted clients. Hosted
index and ten entry resources exist. Unchanged full2494-unit/34-browser baseline
is reused; it is not reported as rerun after the repair. Browser fixtures use
loopback Vite/headless Chromium with intercepted HTTP and simulated microphones;
real Cloud, provider, physical audio/avatar fidelity and native acceptance remain
separate. The232 reviewed code paths are committed at
`e8ef7768d2edcfc7cef58c508bf3fb66ba0d2302`, together with the phase record.
The corrected A2 clean installed-wheel gate also passes; A4 advances from this
verified commit without changing the six exclusions.

### Phase 4: Verify every retained workflow and browser resource lifetime (A4)

Scope: R1–R10 and R12; depends on A2 and A3. Issue: [A4 / #276](https://github.com/raymond-van/animama/issues/276).
Implementation entered on2026-10-05 from clean task commit
`e8ef7768d2edcfc7cef58c508bf3fb66ba0d2302`; A2 corrected installed-wheel and
A3 independent review gates are satisfied. Independent review now passes; the phase commit is recorded at A5 entry.
Apply the common contracts to the existing screens rather than recreating them.
Finish any composition assumptions discovered by the coverage map: settings/model
roles, chat/history/tools/safety, existing Anima editing, memory/Reflection,
Library and all creators, sharing, voice catalogs/cloning and loadouts.

In `lib/runtime-content/{VerifiedByteLoader,RuntimeMountPreparer,
RuntimeJsonBundleLoader,PreviewByteSession}.ts`, avatar and speech runtimes,
verify authenticated same-origin bytes, snapshot leases, expected hashes,
revision conflicts, cleanup and optional-asset fault isolation. Preserve
companion mounting across chat changes and intentional revision remounts after
equip. Export excludes private chat/relationship history. Interrupted commits
resolve their operation receipt before retry; cancelling a request is not rollback.

In `lib/speech/`, workers, TTS hooks and voice settings, support the agreed
browser and server-proxied engines without leaking provider credentials. Keep
model/voice selection distinct from server model administration. Exercise
permission refusal, locale/readiness, mic device/sensitivity, interruption,
quota/error fallback and teardown. Runtime model/worker versions must match.

Validation from `src/frontend`: `pnpm web:test`, `pnpm check`, `pnpm web:lint`,
`pnpm verify:tts-assets`, `pnpm e2e:list`, `pnpm e2e:check`. Extend meaningful
behavior helpers from `accountless-content-sharing`, `accountless-imported-playback`,
`playback-library`, `playback-anima-loadout` and creator journeys. Add a hosted
session fixture; do not use installation bootstrap for hosted tests. Run selected
journeys through `pnpm e2e:test` using the runner's documented selection and
mutation controls, recording exact commands and source. Browser evidence must
cover save/reload, preview/equip, import/export, conflict/retry and two-owner cleanup.

Completion/progression: every public UI action has working contract behavior
and independent fixture coverage, including all six explained exclusions.
Visually inspect creator, Library and live playback; record actual local audio
and microphone evidence separately from fake/automated runs. Hosted real-provider,
device-matrix and tenancy acceptance remain required consumer evidence, not a
claim made from fixtures. If physical audio evidence cannot be obtained, keep
that acceptance item pending without declaring voice parity.

Recovery: do not delete unsaved drafts on quota or provider failure. Dispose only
the abandoned owner/runtime resources; preserve completed operations and allow
safe receipt-based recovery after legitimate reentry.

#### Code Review #1 Findings

PASS. Independent analysis and independent checks each verify the same27 frozen
source paths before/after, aggregate
`c41d61840e52c8b9a60fbd2e10c10a13ce8388433b7bf62638a5943cb73cffa5`.
No required findings. Repair rounds used: 0 of 2. Root's package metadata extension
is included: product-ui0.5.0 carries additive server-speech descriptor/session
bindings; runtime-contracts0.3.0 and local-http3.0.0 remain unchanged.

#### Code Review #1 Revisions

No source repair required. One evidence correction is recorded: author tooling
ran Node24.15.0; the temporary receipt's Node22 label was inaccurate. Independent
checks bind the actual environment and source, verify all15 author log hashes,
and independently repeat16 Chromium HTTP cases,25 package tests, three package
declaration checks, the copied emitted0.5 consumer,27-path format and whitespace.

Author checks from `src/frontend` pass: `pnpm check`, `pnpm web:lint`,
`pnpm web:test` (2514 unit tests and50 browser fixtures), `pnpm packages:check`,
`pnpm packages:test`, `pnpm build`, `pnpm web:build:hosted`,
`pnpm desktop:check`, `pnpm verify:tts-assets` (21 files/280549335 bytes),
`pnpm e2e:list`, `pnpm e2e:check` and `pnpm openapi-ts:check` (17 current files).
The final affected16-case `node --test web/scripts/hosted-workflows.browser.test.mjs`
supersedes the12 HTTP cases in the broad browser baseline; the other38 browser
cases retain unchanged source evidence. The repository-root guard pair
`tests/test_accountless_repository_boundaries.py` and
`tests/test_shared_backend_boundary.py` passes13 tests.

Meaningful red/green fixes cover dropped tokenless server-TTS descriptors,
late PiP completion after route teardown, authoritative sharing receipt recovery
after a lost reply, empty Save responses, hosted Library host-scan controls,
body-bearing204 response reconstruction, and text fallback closing the real audio
context. The final browser fixture exercises the checked-in worklet and a real
same-origin cookie/Origin WebSocket, permission denial, lifetime teardown,
settings/profile inheritance, creators/loadouts, sharing and excluded imports.

Selected mutation-authorized Chromium journeys on the task-owned local stack
`http://localhost:8360` pass5 tests for Stop/subsequent durable reply, content
export/import/fresh entry, Scene import/save/playback and loadout viewport. An
additional3 selected visual journeys pass. All four exact operation cleanup
ledgers report zero remaining work. Actual creator/Library/live companion and
narrow sharing screenshots were inspected independently. Chat uses the task-only
deterministic provider; Chromium audio/worklet tests do not establish heard output
or physical microphone fidelity. Large-resource closure/cost/rollback is A5 work;
real Cloud/provider/quota/device behavior remains C5–C7 acceptance.

### Phase 5: Produce and validate the immutable hosted application (A5)

Scope: R4, R8, R11–R12; depends on A3 and A4. Issue: [A5 / #277](https://github.com/raymond-van/animama/issues/277);
implementation source/commit pending.
Implement the A1 artifact format in `scripts/package-sets/build.py`,
`package_set.py`, their tests, `src/frontend` build scripts and
`scripts/repository-boundary/check-packed-artifacts.py`. Include its independent
consumer fixtures in `.github/workflows/validate-public.yml`. Keep old supported
format verification explicit; do not silently accept additional unverified files.

Build from a clean exact tracked source snapshot, with no Cloud checkout,
credentials or user state. The manifest binds the app and compatible backend
contracts, entry and lazy resources, notices and all supplied bytes/references.
Document required MIME, CSP, worker/media/WASM and range behavior for an ordinary
HTTP consumer. Public approved immutable resources and account-private bytes
have separate delivery/cache contracts. No generic arbitrary-directory serving
or service-worker private-data cache is introduced.

Load large avatar and speech resources on demand. Measure first-load shell,
first avatar, first voice, peak memory and cleanup against the same local
baseline. Record actual sizes; old text-only consumer measurements cannot pass
this build. Asset redistribution/hosting/export permissions must cover the exact
included set. Resolve or replace pending assets without dropping retained features.

Validation from root, using new paths outside the checkout:

    uv run --no-sync python -m unittest discover -s scripts/package-sets -p 'test_*.py'
    uv run --no-sync python -m unittest discover -s scripts/repository-boundary -p 'test_*.py'
    uv run --no-sync python scripts/check-repository-dependencies.py
    uv run --no-sync python scripts/package-sets/build.py build --source <animama-checkout> --commit <full-candidate-commit> --output <new-package-set-directory>
    uv run --no-sync python scripts/package-sets/build.py validate <new-package-set-directory> --work-dir <new-independent-consumer-directory>
    uv run --no-sync python scripts/package-sets/build.py compare <reviewed-baseline-set> <new-package-set-directory>

From `src/frontend`, run `pnpm build` and the new `pnpm web:build:hosted`.
The isolated consumer must open deep links and lazy workers/audio/avatars with
the source checkout unavailable, and reject missing/modified assets, traversal,
unsupported formats and incompatible backend bounds. Exercise supported upgrade
and rollback with retained assets and an old open tab. Version bumps alone are
not semantic compatibility evidence.

Completion/progression: clean artifact, manifest-bound validation receipt and
independent browser evidence pass review. A development dirty snapshot is useful
only for labelled rehearsal and cannot replace this gate. Recovery: retain the
previous compatible set and its resource inventory; do not overwrite immutable
names or remove assets still required by the supported rollback/open-tab window.

#### Code Review #1 Findings

Not run. Include package inventory, provenance, resource policy and independent build.
Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

None. Record dispositions and exact manifest-bound validation results.

### Phase 6: Complete public acceptance and hand off for hosted adoption (A6)

Scope: all requirements within Animama ownership; depends on A1–A5.
Issue: [A6 / #278](https://github.com/raymond-van/animama/issues/278); implementation source/commit pending. Review the complete source/action coverage map and
remove duplicate hosted screen implementations or temporary flags introduced
during development. Update useful current guidance and boundary ADRs for the
static app artifact, composition interfaces and neutral services. Preserve
local/native behavior and the separate source/native release gates.

Run the required final public checks listed below against the exact candidate.
Compare desktop-sized and narrower local/hosted-fixture journeys, including
visual/audio evidence and failure recovery. Record public readiness separately
from real hosted parity. An independently runnable public CI remains sufficient
for public source review; it must not require the private consumer checkout.

Provide the consumer the clean candidate set, manifest digest, schema versions,
resource policy, operation coverage and still-required integration scenarios.
It can rehearse that artifact before merge using an explicit test-only path.
Consumer incompatibilities return as public contract defects when applicable,
not private implementation imports. After exact-candidate owner merge approval,
select a newly validated `main` package set for ordinary consumer adoption.
Development follows the newest validated `main` through explicit compatible
repins; there is no floating checkout or automatic permission to publish.

Completion/progression: all public checks and bounded integration review pass;
create/update this plan's PR when implementation is authorized. Record remaining
hosted acceptance as a dependency of #272, not as public test results. Owner
approval is required for the exact merge candidate. Artifact promotion,
production launch and signed native release retain their separate authority.

Recovery: if final integration exposes a public defect, repair its owning phase
and rerun affected checks while retaining review counts. Do not force a consumer
lock or weaken compatibility to conceal an incomplete contract.

#### Code Review #1 Findings

Not run. Reuse phase evidence and inspect combined public acceptance.
Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

None. Record dispositions, fixes and remaining external acceptance dependencies.

## Final integration review

Use A6's review as the final integration review, not a second unrestricted pass.
Each scope receives one comprehensive independent review and at most two repair
rounds. Record later findings/revisions with matching numbers; rechecks target
accepted fixes and their regressions. Supported blockers remaining at the limit
stop dependent work. Advisory preferences do not block completion. Record exact
reviewed source, check results and remaining gates in the PR.

## Validation and acceptance

Final public verification from repository root is `uv run ruff check`,
`make check-test`, the dependency/import boundary commands, package-set tests,
and clean producer/isolated-consumer/compatibility validation from A5. From
`src/frontend`, run `pnpm openapi-ts:check`, `pnpm check`, `pnpm web:lint`,
`pnpm web:test`, `pnpm packages:check`, `pnpm packages:test`, `pnpm build`,
the new `pnpm web:build:hosted`, `pnpm desktop:test` and `pnpm e2e:check`.
Run affected browser journeys; add checks only for changed or unresolved behavior.
Record actual hosted `Validation` scope separately from local checks.

Acceptance evidence must identify source and artifact, route/action coverage,
both browser layouts, settings and memory persistence, creator/import recovery,
avatar/effect playback surfaces, heard speech/microphone tests and owner cleanup.
The hosted consumer additionally owes real API/provider behavior, two-account
HTTP and database-role isolation, private cache/byte/job/export tests, bounded
cost/storage/lifecycle behavior and compatible release/rollback evidence. Those
are necessary for the overall #272 parity claim, even though public CI uses
independent fixtures. Missing backend features, fake-only chat or absent default
assets must remain visibly unfinished.

## Idempotence and recovery

Keep local and hosted composition changes reversible through their entrypoints
while development proceeds. Preserve local data; do not purge a stack to simplify
testing. Content save/import/export uses stable operation IDs, request digests,
revision preconditions and recoverable receipts. Temporary staging is bounded
and cleaned after denial/cancellation according to the authoritative operation
outcome. Account switching clears private browser resources without implying
rollback of already admitted server work.

Artifact retries use fresh output directories and clean commits. Never hand-edit
generated SDKs, package integrity or validation receipts. Regenerate outputs
from reviewed source. Roll back only to a compatible complete artifact set;
the hosted consumer separately owns schema/data recovery and deletion fencing.

## Artifacts and Notes

Planning evidence, 2026-10-05: inspected the spec source, shared/local boundaries,
route/settings inventory, content ports and package-set producer/consumer rules.
No implementation, browser tests, paid calls or deployment was performed while
authoring this plan. The coverage file and hosted build script above are planned
new artifacts, not existing passing checks.

An independent authoring review on 2026-10-05 found no blocking findings against
the spec, phase dependencies, source paths, commands or public/private boundary.
This read-only planning review does not consume an implementation review round
or constitute runtime acceptance.

Authoring checks passed for phase/review records, living sections, local Markdown
links, whitespace and absence of private paths in this public plan. Product
tests were not run for this documentation-only change.

Record per-phase issue, starting/reviewed/committed source, exact commands/results,
public-safe browser evidence and limitations here or in the phase. Do not place
private checkout paths, account data, credentials or raw transcripts in this
public plan. Detailed resource/contract decisions belong with their owning
contracts; the coverage map tracks acceptance rather than duplicating the spec.

## Outcomes & Retrospective

A1 contracts and the complete action/settings/route map are agent-verified.
Full coordinated implementation is authorized. The C1 tenancy/cost/resource
requirements gate passed; A2 content/provider services and its clean artifact
handoff passed, including the independently reviewed portable preference repair
and replacement clean artifact. A3 browser composition is reviewed and committed.
A4 verification and consumer C2 repair proceed against those exact artifacts.
No consumer product UI cutover, hosted deployment
or actual parity acceptance has occurred. Product scope is resolved. Remaining
engineering determinations are the concrete compatible artifact schema and
resource inventory, individual service seams and measured resource budgets;
A1/A5 and the consumer's policy work resolve these before dependent acceptance.
Any conflict with existing approved provider/spend/asset policy needs an explicit
decision, not an undocumented feature exclusion.

Revision note, 2026-10-05: initial plan separates reusable public implementation
from hosted operations and prevents a circular public-merge/consumer-pin gate.

Revision note, 2026-10-05: recorded the approved cross-repository order, native
phase assignments and ongoing parent-progress updates during workspace setup.
No implementation phase or deployment gate was advanced.
