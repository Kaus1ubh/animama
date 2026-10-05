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

| Surface and source | Retained actions and implementation assignment |
| --- | --- |
| `__root.tsx`, `_app.tsx`, `_app/index.tsx`, `app/router.tsx`, `ui/sidebar/` | Shared shell, sidebar, preview dock, deep links, reload, keyboard and responsive navigation. A3 replaces installation-specific gates through composition adapters. Empty hosted rosters remain useful. |
| `_app/$animaId.tsx`, `_app/$animaId/index.tsx`, `_app/$animaId/c/$chatId.tsx`, `ui/main/chat/` | Chat/history/search, rename/delete, stop/retry, Markdown, layouts and model selection. A3 preserves the mounted companion across chat changes; A4 verifies all actions against shared contracts. |
| `_app/animas.tsx`, `_app/animas/index.tsx`, `_app/animas/$animaId.tsx`, `_app/animas/$animaId/identity.tsx`, `ui/animas/` | Existing-Anima identity, relationship memory, settings, portrait/background framing, appearance, avatar/voice and loadouts. Retain existing management actions; do not invent a deletion UI. |
| `_app/create.tsx`, `_app/animas.new.tsx` | Retain the Create hub and content creators; block Anima creation and direct creation navigation with a concise reason. Account bootstrap belongs to the consumer, not this route. |
| `_app/library.tsx`, `ui/library/`, `ui/content-preview/`, `ui/content-health/` | Existing tabs, search/filter, thumbnails, validation, preview, customize/edit/delete, selection and recovery. Omit host directory scan/path administration only. |
| `_app/poses.$poseId.edit.tsx`, Gesture/Reaction/Idle Style `.new` and `.edit` routes | Retain Pose/Pose Clip and timeline/content workflows, Save, Save & Equip, draft/conflict recovery and format import/export. Pose Clip is not new Anima equipment. |
| Avatar/Particle/Scene Effect `.new`, `.edit` and existing index routes; Sound Effect routes | Retain each existing creator and its asset/audio controls. Verify creator, Library and live-Anima playback separately. Do not restore a standalone music Library feature. |
| `lib/content-sharing/`, `query/hooks/useLibrarySharingFlow.ts` | Content-package inspection/review/commit/export and supported creator formats; Anima export remains. Reject Anima-package import before installing any contents. |
| `_app/memories.tsx`, `ui/memory/`, memory queries/mutations | Account-shared user memories, episodes, virtual files/folders, history/conflicts, Anima memories and user-started Memory Manager/Reflection. Logical memory paths are retained, host paths are not exposed. |
| `ui/sidebar/ApplicationSettingsModal.tsx` | General, Appearance, Memory & Emotion, Safety, applicable Data reset, Advanced and About remain. Models retains model/role choices but omits connection/key/search-provider administration. Voice retains microphone, engine/voice choices, readiness, download and clone workflows. API Keys is omitted. Shortcuts retain browser actions and omit native actions. About omits native updates/host logs while retaining applicable product information. |
| `ui/app/AnimaRouteProviders.tsx`, `ui/main/MainShell.tsx`, `lib/avatar/`, `lib/runtime-content/` | Runtime snapshots/leases, expressions, gestures, reactions, idle, camera, lip-sync, effects/background/audio and revision/remount behavior. A2 supplies neutral service interfaces; A4 handles browser delivery and lifetime. |
| `lib/speech/`, `workers/`, `hooks/use-tts-playback.ts`, `ui/animas/VoiceCloneLibrary.tsx`, `ui/settings/VoiceDownloads.tsx` | Dictation, Voice Mode, microphone selection/test/sensitivity, STT/TTS, clone/voice catalog, playback/stop/mute and locale/readiness/fallback. Browser model downloads are retained; server-wide model installation is excluded. |
| `setup.tsx`, `desktop/pip/$animaId.tsx`, `desktop/quick-chat/$animaId.tsx`, `a.tsx`, `a/$.tsx`, `safety.tsx`, `_app/avatar-portrait-debug.tsx` | Local setup/native windows remain local composition utilities. Preserve current legacy navigation and safety behavior where applicable. Classify the portrait diagnostic by its actual entry points in A1; ordinary portrait editing stays included. Browser fullscreen/PiP remain available by browser support. |
| New thin hosted composition/account integration | Sign-in/out, eligibility/readiness, restriction/outage, account access and usage/limits in the common shell. Document HTTP contracts; no identity implementation or provider credentials enter the bundle. |

The backend reference is `src/backend/animama/app/{contracts,ports,services}`,
`app/chat`, `app/model_clients` and supported `adapters`. Existing local route
behavior under `server/routers` identifies observable contracts but is not a
hosted import surface. `app/contracts/runtime_capabilities.py` is richer than the
current `{chat: boolean}` browser product capability type; extend the existing
contract instead of maintaining a second truth.

## Progress

- [x] 2026-10-05 [A1 / #273](https://github.com/raymond-van/animama/issues/273): agent-verified contracts/complete action map; required checks and independent review #1 passed, repairs 0 of 2. Phase commit recorded below; the consumer requirements gate C1 has passed.
- [ ] 2026-10-05 [A2 / #274](https://github.com/raymond-van/animama/issues/274): in progress from `3006ca3f3c5c6b68c0287cec41dc635f8a94969e`; A1 and consumer requirements review C1 passed. Content ports and bounded provider/orchestration work run independently.
- [ ] 2026-10-05 [A3 / #275](https://github.com/raymond-van/animama/issues/275): in progress from `3006ca3f3c5c6b68c0287cec41dc635f8a94969e`; shared admission/transport/session composition runs alongside A2 after the passing C1 handoff.
- [ ] 2026-10-05 [A4 / #276](https://github.com/raymond-van/animama/issues/276): planned; depends on A2 and A3.
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

| Order | Work and handoff |
| --- | --- |
| 1 | [A1 / #273](https://github.com/raymond-van/animama/issues/273) → hosted consumer foundation C1; reconcile its public-safe contract/ownership/cost needs before A2/A3. |
| 2 | [A2 / #274](https://github.com/raymond-van/animama/issues/274) and [A3 / #275](https://github.com/raymond-van/animama/issues/275) may proceed in parallel. |
| 3 | [A4 / #276](https://github.com/raymond-van/animama/issues/276) → [A5 / #277](https://github.com/raymond-van/animama/issues/277) alongside consumer C2 → (C3, C4) → C5. Hosted service work uses isolated candidate artifacts after A2. |
| 4 | Common-app consumer cutover C6 alongside [A6 / #278](https://github.com/raymond-van/animama/issues/278); public readiness remains independent of a future main pin. |
| 5 | Exact-candidate approved Animama merge → validated main package set → authorized promotion/readback → C7 actual hosted acceptance. |

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
in progress from `3006ca3f3c5c6b68c0287cec41dc635f8a94969e`. All provider/device, artifact and release gates remain separate.

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
the generated validator fixture failed on schema version 1, then passed on version
2. Documentation/type-only interface design uses schema, declaration, source-map
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

Not run. Include dependency-boundary and transaction/recovery analysis.
Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

None. Record dispositions, fixes and affected local/shared checks.

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

Not run. Include route sharing, transport lifetime and private browser-state review.
Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

None. Record dispositions and affected composition/local regression checks.

### Phase 4: Verify every retained workflow and browser resource lifetime (A4)

Scope: R1–R10 and R12; depends on A2 and A3. Issue: [A4 / #276](https://github.com/raymond-van/animama/issues/276);
implementation source/commit pending.
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

Not run. Cover the complete action map, resource cleanup and excluded alternatives.
Repair rounds used: 0 of 2.

#### Code Review #1 Revisions

None. Record dispositions, visual/audio limits and affected checks.

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
requirements gate passed; A2 content/provider services and A3 browser composition
are in progress in parallel. No product UI cutover, hosted deployment
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
