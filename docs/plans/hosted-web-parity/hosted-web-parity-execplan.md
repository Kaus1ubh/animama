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

- [x] 2026-10-06 [A1 / #273](https://github.com/raymond-van/animama/issues/273): engineering/source gate PASS; canonical metadata, SDK freshness and independent targeted review pass. Owning repair2/2 supplies runtime-contracts0.3.1. Clean220c6581 passes the unchanged declaration/installed-consumer guard and rollback; A6 refreshes the new R7 source artifact and actual CI. Original C1 handoff remains valid.
- [x] 2026-10-05 [A2 / #274](https://github.com/raymond-van/animama/issues/274): corrected portable preference merger committed at `6a150fd45d5e215e7f134010b53b9c62e4316ede`; targeted independent review #3 and clean installed-wheel gate pass. Repair rounds used: 2 of 2. Neutral services are ready for isolated consumer C2 repair and A4.
- [x] 2026-10-08 [A3 / #275](https://github.com/raymond-van/animama/issues/275): engineering handoff complete at public `df0faae1` / immutable manifest `4ee249ed`; final consumer common journey passes all24 checks, including same-browser owner change and desktop/narrow Usage dismissal. Owning repair3/3 and its earlier failed evidence remain. CI is owner-waived, not passed; A7 addresses the separately requested review packet, and final live acceptance remains C7.
- [x] 2026-10-06 [A4 / #276](https://github.com/raymond-van/animama/issues/276): original phase review passed0/2; A6 returned model-role/Library-upload defects. Targeted independent analysis/checks #2 resolve both after owning A4 repair1/2. Corrected immutable binding remains A6; physical/heard voice and hosted/provider/device acceptance remain C5/C7 gates.
- [x] 2026-10-06 [A5 / #277](https://github.com/raymond-van/animama/issues/277): engineering/artifact gate PASS after independent final analysis/checks. Clean A `8b09e7ff` and reviewed main-integrated B `e4e0661b` pass independent producer/installed-and-emitted consumer, same-source A production observations and genuine A/B/open-tab/rollback/clip gates. Repair rounds remain 1 of 2; measurement and inherited descriptive-field limits are recorded below. C6/A6 are ready; main adoption, provider/device/deployment and exact-candidate owner merge remain separate.
- [x] 2026-10-08 [A6 / #278](https://github.com/raymond-van/animama/issues/278): engineering/artifact handoff complete at public `df0faae1` / manifest `4ee249ed`. Approved repair6/6, independent all79/79 browser checks, producer/compatibility/all eight installed-emitted consumers and genuine retained-C rollback pass. Consumer C6 final common24/admin8/lifecycle8 and independent evidence applicability pass. Native CI run37563677832 executed zero steps and remains explicitly owner-waived; no CI success, owner merge, main adoption, real-provider/device or deployment acceptance is claimed.

- [ ] 2026-10-08 [A7 / #333](https://github.com/raymond-van/animama/issues/333): shared recovery, deadlines, resource lifetimes and actual Electron/Compose checks pass. Independent source review/check findings are resolved, repairs2/2; clean successor/consumer/rollback and Cloud handoff remain pending. A1–A6 history and CI waiver remain intact.

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
[PR #284](https://github.com/raymond-van/animama/pull/284) carries the implementation; current completion and remaining gates are recorded above. Do not change the primary checkout or another
agent's deployment worktree.

| Order | Work and handoff                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | [A1 / #273](https://github.com/raymond-van/animama/issues/273) → hosted consumer foundation C1; reconcile its public-safe contract/ownership/cost needs before A2/A3.                                                                  |
| 2     | [A2 / #274](https://github.com/raymond-van/animama/issues/274) and [A3 / #275](https://github.com/raymond-van/animama/issues/275) may proceed in parallel.                                                                             |
| 3     | [A4 / #276](https://github.com/raymond-van/animama/issues/276) → [A5 / #277](https://github.com/raymond-van/animama/issues/277) alongside consumer C2 → (C3, C4) → C5. Hosted service work uses isolated candidate artifacts after A2. |
| 4     | Common-app consumer cutover C6 alongside [A6 / #278](https://github.com/raymond-van/animama/issues/278); public readiness remains independent of a future main pin.                                                                    |
| 5     | [A7 / #333](https://github.com/raymond-van/animama/issues/333) and consumer C6H address the requested review packet. Independent fixes may proceed together; Cloud successor acceptance follows A7's verified immutable artifact. |
| 6     | Exact-candidate approved Animama merge → validated main package set → authorized promotion/readback → unchanged C7 actual hosted acceptance. |

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
HTTP types. ADR 0015 records the approved full-app reuse and catalog-role choice.

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

Final integration CI later exposes A6-R3 in A1's SDK regeneration: four default
HTTP422 descriptions vary with the Python standard library. The actual payload
schemas and runtime client behavior are identical. Owning A1 repair1/2 resolves
the return after explicit route metadata, normal offline regeneration and targeted
independent review #2. The complete schema and17 generated files are byte-identical
under frozen Python3.12.13 and3.14.4. A6's final targeted review #3 records the same
source gate below; artifact and actual CI acceptance remain separate.
This does not reopen A2 or reset any completed phase budget.

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

#### A6 integration return — Usage dismissal (A6-R5)

Fresh normal-browser evidence against immutable C
`c10218aeca1c4c68b37028bd0e5f56372fdfe98a` exposes a required shell regression.
After Usage and limits closes through Escape or its real Close button, the body
retains `pointer-events:none`; there are no dialogs and one menu, and an ordinary
sidebar/profile click times out after30 seconds. No forced click, style mutation
or security relaxation produced this result. The selected C
`SidebarUserMenu.tsx` is byte-identical to the current reviewed source. Its new
Usage item opens the dialog without the existing App Settings item's explicit
menu-close handling.

A6-R5 is accepted against the usable account/usage affordance in A3. The prepared
proposal follows that existing handling, with actual-browser dismissal and next-
interaction regression coverage at desktop and narrow sizes. It has not been
applied or tested. Owning A3 remains1/2; the proposed second owning repair is held
because final integration A6 has exhausted2/2. An expanded one-round owner
exception now covers A6-R4/R5/R6 (complete proposal in A6 below). Existing session/cache evidence stays
valid; no default review budget is reset.

### Phase 4: Verify every retained workflow and browser resource lifetime (A4)

Scope: R1–R10 and R12; depends on A2 and A3. Issue: [A4 / #276](https://github.com/raymond-van/animama/issues/276).
Implementation entered on2026-10-05 from clean task commit
`e8ef7768d2edcfc7cef58c508bf3fb66ba0d2302`; A2 corrected installed-wheel and
A3 independent review gates are satisfied. Independent review passed with no required findings or repairs. Phase commit: `8b91bbf3faf45eec85e6cdd7964fdc423e48c0a0`.
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

#### A6 final integration return — A4 repair 1 of 2

A6-R1/R2 are accepted defects in retained model-role settings and excluded
Library Chat Uploads. The original A4 review passed at `8b91bbf3` with 0 of 2
repairs; actual emitted B screen observations now establish the missing coverage.
Count this owning-phase correction as repair1/2 while preserving that initial
review history and all other phase budgets. A6 owns the single targeted integration
recheck; completion of this correction remains pending.

### Phase 5: Produce and validate the immutable hosted application (A5)

Scope: R4, R8, R11–R12; depends on A3 and A4. Issue: [A5 / #277](https://github.com/raymond-van/animama/issues/277);
entered from verified clean task HEAD `8b91bbf3faf45eec85e6cdd7964fdc423e48c0a0`. A4 analysis/checks pass with0of2 repairs used. Root owns the plan/tracker/commits; the A5 author owns the public producer, verifier, asset build and isolated consumer. Clean exact-source producer/consumer remains an explicit completion gate.
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

A5 source review checkpoint, 2026-10-05 23:13 UTC: authoring is paused at
`8b91bbf3faf45eec85e6cdd7964fdc423e48c0a0` plus51 intended source paths.
The coordinator verified the complete tracked/untracked boundary, all raw file
hashes, unchanged dependency/contracts/package declarations and no staged paths.
Source aggregate `eec144c0617f83d2e5dc7cfa40e8f8e76191a4548af4ed00af2cd01b55fb2313`
uses SHA-256 of sorted path, space, raw file SHA-256 and newline. The author's
separate canonical JSON-map aggregate is `ab6ddb09da4a692046abb475ea56ea9d77478578b4b8081e9c1de997266f18d3`.
The single comprehensive initial independent analysis and checks are complete:
source review **BLOCKED** on the two required findings below. All51 source and
seven sealed hashes match before/after both reviewers. At initial review,
repair rounds used:0of2; combined repair1of2 now proceeds.

- A5-R1 (P1): Python consumes raw PAX/GNU extension metadata before yielding a
  regular tar member, bypassing the verifier's expanded-byte/header limits. The
  independent valid-app proof and coordinator reproduction accept an8,173-byte
  gzip with1,520,000 PAX bytes despite a65,536-byte aggregate ceiling. This is a
  demonstrated bound omission, not a measured production memory-exhaustion event.
  Required repair bounds transport/header size and count before parsing, retains
  legitimate producer path extensions, and adds hostile-header regressions.
- A5-CHECK1 (P2): two new long lines in configured source JavaScript fail the
  required formatter. The initial38-file author selection omitted `.js`.
  `PCMPlayerWorklet.js` and `PocketTTSCore.js` are included by the normal source
  glob and were formatter-clean at HEAD. Format them and refresh the scoped
  check; the raw public workers' formatting is advisory under their separate
  configured scope, without requiring an unrelated vendor rewrite.

Fresh independent checks pass10 existing archive cases, two HTTP cases,
24 clip/resource cases, Ruff/format for nine Python paths, repository dependency
boundary,21 exact baseline assets/280,549,335 bytes and complete51-file
whitespace/source verification. Existing source-bound141/19/13/6, type/lint and
both builds are reused. The old desktop69 receipt reconstructed a Node command
for a Vitest log; it is not accepted as exact execution evidence. The author
retained that error and replaced the claim with an actual fresh exact-source
`pnpm exec vitest run tests/runtime-packaging.test.mjs --reporter=dot` run:
69 pass, zero skipped, all51 hashes stable.

Author evidence includes141 affected frontend tests, type/lint checks, both web
builds, archive/HTTP/boundary tests and read-only formatting checks. A real emitted
creator journey first reproduced dropped clip metadata; the narrow compatibility
bridge retains it for normal and effect-only clips through import, edit, save,
export and reopen. Reopen exports match and test-owned clips are removed on
cleanup. The pre-sync app preserves newer layer-mute metadata as opaque data;
it does not execute newer procedural-layer behavior. Fixture setup failures are
retained separately from the product regression and passing run.

These are source/labelled dirty-rehearsal results. A reviewed provisional source
commit can enable the exact clean producer, but does not complete A5. Clean
producer/isolated installed and emitted consumers, same-source production-local
measurement comparison, and two meaningful clean app revisions with saved-clip,
old-tab, upgrade and rollback behavior remain required. A worker-comment variant
or a version bump cannot replace that semantic compatibility gate. Physical
microphone/heard-output and real provider/device/hosted acceptance remain C7.

#### Code Review #1 Revisions

Accepted A5-R1 and A5-CHECK1. One combined repair round1of2 is authorized:
add the hostile archive regression before the early bound, format the two
configured source files and refresh affected evidence. Preserve initial source
and failed receipts; freeze the delta for targeted independent review2. The
formatter advice for raw workers is optional and must not expand into unrelated
vendor changes. No source checkpoint commit or A5 completion occurs before the
accepted fixes pass. Clean artifact, production comparison and meaningful
cross-revision browser gates still follow the reviewed provisional commit.

#### Code Review #2 Findings

A5 source review checkpoint, 2026-10-05 23:38 UTC: targeted independent
analysis and checks **PASS** after combined repair 1 of 2. The complete 51-path
source aggregate is `931b396f9420792e787c19cec1077ef60f8bd389112ab3a7885cace38f2ccf0f`
using the same sorted path/space/raw-hash/newline recipe. Five paths changed;
the other 46 and all seven sealed dependency/contracts/package inputs remain
unchanged before and after both reviews. No new required finding remains.

A5-R1 is resolved by flat 512-byte tar header framing. The verifier bounds
expanded transport and raw header count before consuming extension bodies;
it accepts only one canonical bounded producer long-path record followed by
its matching regular file. The original complete-app hostile archive rejects
before payload intake. Fresh independent analysis passes six focused cases;
fresh checks pass all 23 package/archive cases, repaired Python lint/format,
the contract and both source JavaScript formatter checks, selected ESLint and
complete tracked/untracked whitespace verification. A5-CHECK1 is resolved;
raw worker formatting remains advisory. Source-bound unaffected evidence is
reused rather than described as a fresh execution.

The author also reverified the existing 169,600,835-byte dirty rehearsal
archive with the repaired parser: all 311 static files, including 310 long
paths, and its separate seed still verify. This read-only parser compatibility
check preserves both source and archive hashes; it is not a clean build or
whole-phase acceptance.

#### Code Review #2 Revisions

Accepted both targeted PASS verdicts. Repair rounds used: **1 of 2**; one
remains for this scope. Commit the reviewed source and living record as a
provisional checkpoint so the exact clean producer can run. A5 stays unchecked.
Build the first clean set, perform isolated installed/emitted consumer and
same-source local production measurements, then integrate the reviewed Gesture
changes from main for a second meaningful clean set. Verify saved normal and
effect-only clips, old-tab resources, upgrade and rollback across that pair.
Preserve the explicit older app's opaque layer-mute playback limitation and
all separate physical/provider/hosted/publication gates.

#### Clean artifact A and second-source integration

The reviewed provisional source commit is `8b09e7ff939201e0f48c6c2db8b886f72a0186c0`,
tree `9d09c947a9bce79a1caef0176dc67571f4d2e331`. Its clean format2 set has
manifest SHA `522285ff243d1b4d7cb01c105731ec3a070ecf53bf54888d65377729ae1c6d79`.
The 169,601,194-byte application archive hashes to
`4a1de89b0294c8064c528ceabf84075099a96d0722688ea2673721237e2bb486`;
the actually installed backend wheel hashes to
`89d02d3a3e7ea5f4b4b14589da85bd52343426444200392a7efffcb4f1a43ce5`.
Independent checks verify all 3,378 tracked inputs, 179 hydrated LFS objects,
seven payloads, 311 static files, the closed Included seed and installed wheel
RECORD. All 504 implementation payloads equal the corrected A2 wheel. The
copied format1 baseline comparison passes; it is not an app rollback point.

A separate exact-A browser run passes retained deep links, real VRM loading,
Pocket worker/model initialization, nonzero PCM through the real audio worklet,
normal/effect-only clip reopen/export and owner cleanup. The canonical validator's
controlled comment-variant run remains explicitly separate from the genuine
clean-revision compatibility gate. No source modules, installation bootstrap,
paid-provider calls or external requests are used by the emitted consumer.

The task-owned production stack at `http://localhost:8360` captures the same
held clean source with all 482 served files recorded. Cold shell/first avatar/
voice-ready observations are 785/1,341/3,125 ms for exact hosted A and
929/1,561/3,216 ms locally. The comparison preserves cold/warm raw observations,
CDP heap checkpoints, sampled summed browser RSS and cleanup evidence. Local
Library population, different synthetic replies and cleanup actions, Docker
Node22/Python3.12.15 versus producer Node24/Python3.12.13, and headless SwiftShader
limit performance conclusions. Declared body bytes, page encoded traffic and
gzip inventories remain distinct. This is measured comparison evidence, not a
production capacity or physical fidelity claim. Literal initial resources are
1,295,417 gzip bytes; all 215 addressed core JS/CSS files are 2,269,412 gzip bytes.

Failed measurement-driver attempts remain recorded. Final attempt3 saves
recovery state before mutation, deletes its exact Anima/chat with GET404 and
restores preferences and selected Anima to that recorded baseline; the catalog
is unchanged. Earlier attempt2 omitted a durable original selected-Anima value.
Its recovery removes only ledger-owned records and conditionally clears their
dangling selection; exact restoration of the pre-A5 task-stack selection is
unproven. No unrelated valid selection or record was changed during recovery.

Main `b9a1e588ac820e0b50e1622c914668a69650275a` supplies a meaningful second
source: actual runtime layer-mute semantics and Gesture authoring. The three
predicted conflicts use complete reviewed main implementations. Preserve the
injected client/session cache keys, combine the failed-hydration guard and retain
hosted build mode. The 59-path merge boundary and seven sealed inputs are stable.
Affected checks pass 153 Vitest tests, frontend/desktop typing, one disposable
PostgreSQL save/export regression, the two-Avatar Chromium render, 45 scoped
frontend formatter paths, 38 lint paths, Python lint/format and whitespace.
Initial package-build race, protected-cache invocation and overbroad formatting
checks remain in history; corrected checks require no source repair. Independent
integration analysis and checks pass; the reviewed clean merge checkpoint enables
B production. The final artifact decision below resolves those remaining gates;
repair rounds remain **1 of 2**.

#### Final clean artifact gate — 2026-10-06

Independent final artifact analysis and checks **PASS** for clean B
`e4e0661b1b54a8acad85088831b97f9fc8a0041e`, tree
`7a4fc6ea442980cbebbda90b92bb89c83a9a10f3`. All 3,418 tracked source hashes,
179 hydrated LFS inputs, seven sealed inputs and 166 evidence bindings are
verified. The final author packet SHA is
`1f849d7857cce8530ad0e024b7f78de0c01ac3adc0eab9b9f7a46a5d9adc4483`;
independent analysis/check receipts are
`548fe06a616a38dcbf92c0129c2dfca59ae429f23d0132ac82424f36296544f2` and
`7440c7059ee5a91c5e515f947150b71896b78f12a1ff0460b361e7191510ab83`.
No new required finding or source repair remains; budget stays **1 of 2 used**.

B's format2 manifest is
`7fd7a8d6a2515999b9d40bbef5acbb52c7d4ab211a2c44d9b3c5ef6324c19aa0`;
its 169,604,612-byte whole-app archive hashes to
`774ec4fc06daf45aa385a1288c07e979710c080735c9cda614fd5dcf6581901d`,
and its freshly installed backend0.3 wheel to
`7459e8df37ea6d3878cbf984750c67fa155d6d7dd35e8041b9a75440e0e3c4da`.
All 504 implementation payloads match A. The exact isolated consumer passes
contract, content, owner isolation and closed Included seed checks: 362 Included
files, 162 entries and two starters. Both app selections have 311 static files
and 692 closed total files. Four optional model manifests retain their raw hash
identity; weights remain separately selected resources.

The actual clean A → B → rollback A run has
`exact_clean_upgrade_rollback=true`. An already-open A page loads its real late
inference worker after selection changes; fresh B loads B's resources and emits
nonzero PCM through the actual worklet; rollback uses A's entry/chunks. Both
owner cleanup paths terminate workers and close audio. Browser errors and
external/provider requests are empty. Six normal/effect-only creator flows keep
the same two saved item IDs through these selections, then delete only their
owned fixtures and sign out with zero remaining owned clips.

A targeted supplement retains 30 synthetic uploaded/exported bodies, including
16 successful exports. All six upload/export/reopen sequences and dependencies
are equal, with only deliberately authored IDs/names changing across selections.
The seven known layer mutes and opaque generator/future metadata survive; old A
preserves newer mute data without executing B's newer procedural behavior.
Four full-project export/reopen differences are solely `aiDescription`: authored
AI selection text reloads as the ordinary description. The same typed projection
and Action fields exist in the pre-task self-hosted source. This inherited
local/hosted limitation does not indicate clip/mute/opaque-data loss; full project
byte identity, intended normalization and arbitrary future mute execution are
not claimed. The first supplemental observer failure is preserved; its corrected
owner-scoped persisted-item GET capture and exact cleanup pass.

The exact-A same-source production comparison above is reused; B did not repeat
that local benchmark. B's literal initial/core JS/CSS gzip inventory is
1,296,020/2,270,386 bytes, distinct from baseline models and browser transfer
counters. Preserve the toolchain/population/headless and original selected-Anima
restoration limits above. Physical microphone/heard audio, actual Cloud/provider/
device/native/deployment and publication/promotion acceptance remain separate.

Root adjudication: **A5 complete within its public engineering/artifact scope**.
Release the held source and advance the agreed parallel C6/A6 work. This neither
changes the normal Cloud pin nor grants owner merge or main-artifact adoption.

### Phase 6: Complete public acceptance and hand off for hosted adoption (A6)

Scope: all requirements within Animama ownership; depends on A1–A5.
Issue: [A6 / #278](https://github.com/raymond-van/animama/issues/278); entered 2026-10-06 from `dea867414410d0932004ba474f1a1ee6fcd07a63`, with unchanged reviewed B feature code and all A1–A5 gates passed. Final checked/reviewed source and phase commit remain pending. Review the complete source/action coverage map and
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

Author checks complete on the unchanged reviewed B feature source. Full backend `make check-test`: 3,160 passed, 10 skipped; Ruff and 714-file format check pass. Public frontend API/type/lint, full web source/browser tests, package checks/tests, local/hosted builds and e2e typing pass. Repository-boundary 13 tests, package-set/archive 23 tests and static import closure (297 reachable, 230 shared, zero forbidden edges) pass.

The first full web attempt failed on sandbox loopback `EPERM`; the permitted full rerun passes with identical source. Full desktop tests had 467 passed, 14 skipped and one unchanged guard-handshake deadline failure; its actual 62-case targeted suite then passed 59 with 3 skips without code or timeout edits. The initial failure and unproven scheduling cause remain recorded. Physical/native acceptance is separate.

Eight scoped guidance/coverage files are frozen; 35 local links/anchors and formatting pass. A5's inherited descriptive-field and original-selected-Anima restoration limitations remain explicit. Author receipt `5cb5dc77ddad6cee24584efc2e9e27e69e5aeb243163807f416a6ae7186b872a` binds local checks, failures, recovery and accepted A5 evidence. Independent final integration review has not run; budget remains 0 of 2. A clean final-source artifact refresh and explicit test-only consumer binding still precede final CI, while ordinary main adoption follows owner merge and its own gates.

#### Code Review #1 Findings

Independent final integration analysis and checks are **BLOCKED** on two
required public UI findings. All 3,418 frozen source paths and exact A6/A5 evidence
bindings match. Existing command evidence remains valid, including the explicit
full-desktop failure and unchanged passing targeted recheck; no additional check
finding was found. Analysis receipt SHA
`3270fdb673e112c4624d535454996700ad0e382ffcaf64b832aa69a8c59113dc`;
checks receipt SHA
`e5c5bdfa56eafb5d64046ef425f6765ae1e73556b0e00330f4dd7b732fd65448`.

- **A6-R1 / required:** `ApplicationSettingsModal` hides all default model-role
  rows using provider administration (`model_configuration`) even when hosted
  `model_role_selection` is true. The actual emitted B modal shows no Models
  section or four retained role controls. Expose the existing catalog/role choices
  and search entries without granting provider/key/search-service administration.
- **A6-R2 / required:** `LibraryPage` unconditionally mounts Chat Uploads via tab
  or direct/legacy search navigation. The actual emitted B screen requests
  `GET /v1/files` and offers Upload despite `chat_file_uploads=false`. Guard before
  dependent queries mount, explain direct-route unavailability and retain local
  uploads and hosted creator/sharing workflows.

The same emitted-app proof reproduces both counterexamples, with zero external
calls or live-data writes. Receipt SHA
`7a46d10d007d0a9644770f8dfc9b3aad47e14344dca9ae05599860ff941309cf`.
Earlier wrapper fixtures do not establish these actual screen boundaries.
Repair rounds used at initial review: 0 of 2; no reviewer implemented a finding.

#### Code Review #1 Revisions

Both findings are accepted as A4-owned retained-workflow defects. Release the
initial public source hold and perform one coordinated repair round, counted as
A6 repair 1 of 2 and A4 owning-phase repair 1 of 2. A5 stays 1 of 2; A2/A3 and
all completed Cloud review counts remain unchanged. This final integration review
does not restart their comprehensive audits. Changes are limited to the two
capability consumers, meaningful actual-screen regressions and affected coverage.

RED proof is the actual accepted B observation. GREEN must show hosted model-role
choices/save/reload with provider administration excluded, and absent Chat Uploads
navigation/queries with explained direct/legacy access, local retention and
capability transitions. Refresh affected frontend checks and clean emitted-artifact
binding. Initial command failures and B artifact proof remain historical evidence;
B is not relabelled a corrected candidate. Targeted independent analysis/checks #2
will recheck accepted findings and caused regressions. Required fixes/artifact
refresh are pending; C6's final replacement journey uses the corrected artifact.

#### Code Review #2 Findings — targeted repair source

Independent analysis and checks PASS the repaired source; A6-R1/R2 are resolved
with no new required repair regression. All3,421 frozen paths, the exact nine-path
delta and eight-path author aggregate match. Author receipt SHA
`163eef9fac2b2d531f70881a8b78a5be136cba78e4f6cb80c93cc472d1048743`.
Analysis JSON SHA
`2bb57ada2139d783051767677ec77c2a499037758fd413e931c658ca6959d22d`;
checks JSON SHA
`4d6402b3b2951a86d93c49be6803c5b7e79c4b473724041471c5387fb8c6045e`.
The checks reviewer independently ran73 focused unit cases and four actual
AppProviders/AppRouter/Settings/Library Chromium cases, then inspected five
own desktop/narrow screenshots. Source/evidence holds pass before and after.
No broad review, source write or budget reset occurred.

R1 now derives model-role selection independently of provider/search service
administration. All four roles save, reload and remain searchable; admin controls
stay omitted. R2 guards before the upload child/query mounts, hides its tab and
explains direct/legacy access with a return action. False/missing/transition
permissions fail closed; local uploads and Library Import/Export remain usable.
Genuine RED is separated from intermediate fixture/locator corrections in the
bound author evidence.

#### Code Review #2 Revisions — source release and artifact refresh

Accept the resolved dispositions. A4 and A6 remain repair1/2 used, one remaining;
A5 stays1/2 and every other phase budget is preserved. Root adjudication SHA
`715f47e758845c8b8534457c4032edcd72f979eac32d7d29f387e68ad563947d`
releases the public source hold for scoped verified commits and a new clean
whole-app producer. Retain original B evidence as historical proof; do not label
it the corrected app. Clean corrected producer, emitted-screen/isolated consumer,
Cloud replacement and actual exact-candidate CI bindings are subsequent gates.
Full A6 remains incomplete and no main adoption/owner merge/promotion/deployment
is authorized by this source review. Unchanged broad backend/frontend/package
checks remain reused; rerun only affected or unresolved evidence.

#### Corrected clean artifact gate — 2026-10-06

Owning repair `2217e76d4ebcb975f8107e922cd1092176765621` and final reviewed
guidance `c10218aeca1c4c68b37028bd0e5f56372fdfe98a` produce clean C, tree
`5c0a64bf61358d867f337f2b42c324fa76fffed6`. Producer and independent installed
consumers PASS with no source checkout available. Manifest
`25bc4ce3a46b49714b3bff036a3974611dd7bbad74ee9054c33565fb7def41a9`
binds application archive
`ecb5b82509af1b7e8e6c501582a1001bd060c6d9744aa4b25664a6e729480640`
and compatible backend0.3. The whole-app browser also proves genuine B→C→B
upgrade/rollback; older A/B and same-source production measurements remain
valid with their recorded population, fidelity and restoration limits.

The existing targeted review #2 continues on actual immutable C screens. Its
independent receipt SHA
`618d07a138775baaafd12603748794bca730dee25123c586487b797492100e28`
binds43 files, all nine closed-set inputs and3,421 clean source paths. Four
model roles select/search/save/reload with administration omitted at1440×900
and390×844. Direct and legacy excluded Library routes explain unavailability,
retain Import/Export and issue zero file queries. All714 fetched static bodies
match119 declared manifest files; page/observer/external errors are zero.
Sign-out and context/browser/two-server cleanup pass, with no durable content,
files, chats, stages or operations created. Root inspected fresh desktop model
and narrow Library screenshots. The first observer's unrequested exact-four-write
assumption failed on five valid preference writes; preserve that failed attempt.
Only the temporary observer changed, with all required assertions retained.

Root adjudication SHA
`c9fec98327bd9caec5a81dcf9d495a685f60d8b4fdbd5b355a424c84ff1f82ee`
verifies all bound files/current source and releases the hold for the evidence
commit and public PR. **Public source/artifact integration gate PASS**; A4/A6
remain1/2 used and A5 remains1/2. No broad re-audit or repair-budget reset.
Cloud's explicit test-only authority consumes this C without changing the
ordinary pin. Actual exact-candidate public CI and PR handoff remain pending;
real private replacement/hosted acceptance remains Cloud-owned. Public readiness
does not depend on a future ordinary Cloud main pin. Exact owner merge,
compatible validated-main adoption/promotion, paid providers, physical capture/
heard audio, native acceptance and deployment are not authorized or claimed.

#### CI return — A6-R3, final repair 2 of 2

Full [Validation run37401998099](https://github.com/raymond-van/animama/actions/runs/37401998099)
on PR #284 fails the SDK freshness guard; later required tests/builds are skipped.
Read-only diagnosis reproduces the same failure at clean task `d9b21ab4` under
frozen Python3.12.13, while the unchanged3.14.4 environment passes17 files.
The complete OpenAPI and canonical generated diffs contain exactly four HTTP422
descriptions/comments: stdlib `Unprocessable Entity` versus `Unprocessable Content`.
There is no payload/path/schema difference. Shared response metadata in
`anima_creation.py` omitted the description, and A1 regeneration `9ed028cf`
introduced the collateral3.14 wording. Diagnosis receipt SHA
`2ba12073a8c91a98809692d100310352a13dc8ec0fde2478d9347cdd8163b073`.

**A6-R3 is accepted and required.** Correct the explicit canonical422 description
at its source, regenerate through the existing offline tool and prove all four
real routes plus complete identical schema/17-file output under both interpreters.
Preserve the byte freshness guard, locks, CI policy and failed run. Count this as
owning A1 repair1/2 and final A6 repair2/2; A4/A5 remain1/2, A3 remains1/2 and
A2 remains2/2. The final targeted independent review #3 checks only this finding
and caused regressions, without another broad audit. Final immutable source/wheel
bindings and affected consumer inventory must refresh before acceptance. Prior
corrected C is an engineering baseline; no final CI or merge gate passes yet.

#### Code Review #3 Findings — targeted SDK source correction

Independent analysis and checks **PASS** the three-path correction at aggregate
`581c9e7ef6f9e21da865a2a2a4c55b030fa20d2aac24d427c284ec3da37cb22a`.
Analysis receipt SHA
`4da004ec760e9519d924eee272943e5448faf6135f604220723fa3787acb0dc0`;
checks receipt SHA
`f8211c3bdd20dae563272a47c036af047b904dd31e77faaf142270d5b829d162`.
Neither reviewer authored the public correction. Both verified three source and
seven unchanged generator/exporter/workflow/lock hashes before/after;51 author
evidence/log bindings match. Fresh real exports pass6 cases under each interpreter
with0 skips, plus scoped Ruff/read-only format/mypy/whitespace. Complete raw OpenAPI
and all17 generated files are byte-identical across3.12.13/3.14.4 and checked-in
output. The same seven response codes/models and four real paths/handlers remain;
the generated delta contains only four comments. No new required finding.

#### Code Review #3 Revisions — source release

Accept A6-R3 as resolved. Owning A1 remains repair1/2 and final A6 remains2/2;
all other budgets are unchanged. Release the source hold for the scoped verified
commit and clean immutable producer/installed-consumer refresh. Reuse unchanged
R1/R2 browser and broad-suite evidence with its original limits. This is a source
gate, not a CI waiver, completed final artifact binding or merge approval. The
original failed CI remains failed; final actual required CI must still pass.

#### Code Review #3 artifact continuation — A6-R4

The reviewed correction is committed clean at
`698beecab4225d6be4d2f08d8adcbcd0afafdbaf`, tree
`6ac8247bdba1122c4ba75779d05fac8e2c408df9`. Its pinned clean producer passes
at manifest `05305c19e66a5b01de9d1403603a77e371c4a4fba0643868377f0b4b22adc6e6`;
producer receipt SHA
`1691485b5d4ef6f52ddcdfb1683c0a6143a516f16a664843a04386ce35e86e5a`.
The fresh installed consumer then fails the unchanged compatibility guard:
`Changed declarations require package version bump: @animama/runtime-contracts`.
The four corrected generated comments change packaged declarations while version
remains0.3.0. Generic package/browser checks passed before this guard; the actual
whole-app C→D→C upgrade/rollback did not execute and cannot be claimed. Failed
consumer receipt SHA
`fa23bcc5994edbf585aa39b86fabfff3127906c059fdec39a37ea672546ddae8`.

**A6-R4 is accepted and required.** The concrete proposal changes only
`src/frontend/packages/runtime-contracts/package.json` version0.3.0→0.3.1, followed
by affected generated packaging metadata/checks, targeted independent review and
clean producer/consumer/actual CI. Do not weaken declaration comparison or edit
generated artifacts by hand. A6's repair2/2 limit is exhausted; the skill requires
an explicit owner exception before this additional repair. That exception has
been requested, not assumed. Counts remain A1 1/2, A6 2/2 and all others unchanged.
New source publication, final artifact/candidate replacement and dependent
acceptance are held. Independent Cloud fixture work may continue against verified
C; C is not relabeled the SDK-corrected final candidate.

#### Code Review #3 browser continuation — A6-R5 and expanded proposal

Actual normal-browser integration against verified C independently reproduces
Usage dismissal blocking subsequent ordinary sidebar clicks through both Escape
and the Close button. Bound failing receipt SHA
`4df4443e829b5726e818b2416d81d39b375bca7c4e44622b1f8fd3d95118cb8a`.
The affected transition is in `web/src/ui/sidebar/SidebarUserMenu.tsx`; the Usage
action omits the established explicit dropdown-close handling used by App Settings.
This action was introduced by A3, and is unchanged between selected C and
metadata-corrected local `698beeca`.

**A6-R5 is accepted and required.** The expanded concrete proposal combines the
runtime-contracts0.3.1 bump with this focused Usage transition correction and
behavior coverage. Proposal patch SHA
`c0b67609ee81ad84ad744d7963aa741a408d2b29f0db6c5d0d70003bcdab0017`;
unapplied proposal receipt SHA
`7f586b9ca2a7ccf6775a9d43ee42670d3ec76dd37e28c557ac2c72c7d58f763f`.
It supersedes the earlier version-only approval request. No proposed source has
been applied or tested. A6 remains2/2 and A3 remains1/2; one additional targeted
A6 repair round requires the pending explicit owner exception, retaining counts.
Subsequent independent recheck, clean app producer/installed consumer/rollback,
full browser acceptance and actual required CI remain gates. Unaffected consumer
checks may continue; the blocked replacement journey cannot authorize duplicate
product retirement or a final artifact replacement.

#### Code Review #3 browser continuation — A6-R6 and complete proposal

**A6-R6 is accepted and required.** Actual immutable C saves the chosen chat model
through preferences PATCH200 and two GET200 readbacks. On reload, settings GETs
return429. Automatic speech initialization then sends a speech-only whole
preferences replacement; PATCH200 and subsequent GET200 confirm the saved chat
model is erased. Sanitized chronology SHA
`8097459ae565e897812ef7eab974aea410e718c45a71b04e3fec44e251f0d703`, proof
receipt SHA `761b025628393f30b638240a68a8a361499368666aa5c37613b62ae4bc0bc114`.
Root verifies its four evidence hashes and exact C/current698/snapshot equality
for SettingsProvider, the modal and the update hook. The rendered-preferences
merger is inherited except for A3's owner/cache key; its demonstrated integration
impact still violates durable settings acceptance. No private merge semantics,
admission or rate-limit change is proposed.

The complete unapplied proposal adds reuse of the existing fresh-read
`useMergeUserPreferences` helper in SettingsProvider to the R4 version bump and R5
Usage transition repair. Patch SHA
`87ec96bef80c2a8933053bb32c2fcb0bd63d4cb0d26867e5a1d5fa658121ef78`, proposal
receipt SHA `39cf72c0ec62539bdebf10ee5a1bb2f0799c2cf8129541d124fe74aaf7fa833e`.
Dry-run application checks the three current source preimages; no proposed source
is applied or tested. Required coverage includes delayed/failed reads, no PATCH
when the fresh read fails, successful retry preserving unrelated preferences,
session replacement, actual model save/reload/reopen, and both Usage dismissal
paths at desktop and narrow sizes. Independent recheck, a clean producer/installed
consumer, genuine upgrade/rollback and actual required CI stay explicit gates.

This complete three-finding request supersedes the earlier one- and two-finding
requests. **Approval remains pending.** A6 stays2/2, owning A1/A3 stay1/2; the
proposed bounded exception allows A6 round3/3 and owning A1/A3 round2/2 without
resetting counts. Until then, dependent repairs, final artifact replacement, push
and consumer retirement remain held. Raw partial-browser failures are retained;
the driver lacked a separately captured pre-run hash and later corrected its own
intentional source404 probe observation. Partial chat/history, recovery, Memory
Manager and owner/session observations are not full replacement acceptance.

Subsequent unaffected consumer admin and lifecycle journeys each pass8 checks,
including actual quota UI recovery, plan/data preservation and coordinated deletion
of the synthetic target. The sealed consumer partial packet SHA
`4d027b6e81faee7ee581e9fcc274c41f95f52a257d9c64163f24ab8d3e2884d1` has pre-run
bindings for those journeys; root verifies its source/evidence hashes. Full shared
app acceptance still fails R5/R6, final artifact consumer still fails R4, and no
public repair, source push, retirement or review-budget exception is inferred.

#### Code Review #4 Revisions — authorized additional repair round

On 2026-10-06 the owner authorized the complete R4/R5/R6 blocker repair and
continuation in the agreed interleaved phase order. This supersedes the pending
exception above. Resume verification confirms public HEAD
`698beecab4225d6be4d2f08d8adcbcd0afafdbaf` and the existing task branch/worktree;
the retained plan is the only public dirty path at entry. Consumer C6 source is
retained in its separate task worktree. No checkout, dependency or service reset
is needed for workspace preparation.

The additional A6 repair round is **3 of 3**, with owning A1 and A3 repairs each
**2 of 2**; earlier counts and failed evidence are preserved. Its boundary is the
runtime-contracts patch version, Usage menu/dialog transition, and the shared
preferences merger with focused delayed/error/retry/session regressions. Author
checks, independent targeted analysis/checks, a clean producer and installed/emitted
consumer with real upgrade/rollback, and fresh required CI precede completion.
Consumer UI retirement follows the corrected app's actual replacement journey.
Exact-candidate owner merge, validated main adoption/promotion, and C7's separate
provider/device/deployment gates remain unchanged.

#### Code Review #4 Findings — targeted R4/R5/R6 source recheck

Independent analysis and checks both return **SOURCE_RELEASE_PASS** for the nine
frozen contract/package/frontend/fixture paths. Root verifies their hashes and
the exact diff. The source aggregate is
`d4899323fe3787db33e0f5cd88eb700df5c48a18d1515e4ecb98bb0f40ac8a66`;
the mutable delivery record is excluded. Analysis receipt SHA
`511e6309ab0b35cff4cbf87658f9e637b655230bfc8db9e6735f353326e9d2d1`
and checks receipt SHA
`5c87343df54e7e60c18e8ae785afd2558c733ea05826cb7875a71b0b146e7483`
bind this scope and the retained author evidence.

- R4: runtime-contracts0.3.1 and its contract documentation agree. The declaration
  compatibility guard is unchanged; only a real new package consumer can pass it.
- R5: Usage uses the existing controlled dropdown-to-dialog transition. All four
  desktop/narrow Escape/Close regressions pass independent replay. The author
  affected suite passes13 cases. Ordinary link clicking is proven; the minimal
  fixture does not establish a fully rendered destination Library inventory.
- R6: SettingsProvider reuses the existing fresh-read preferences merger and
  exposes its pending state. Failed/missing/stale reads, retries, unknown and
  false-valued fields, and same-/cross-owner stale responses are covered through
  the actual provider/hooks and whole-object HTTP replacement. Independent
  replay passes8 tests without skips; the full affected suite passes24. This
  does not add compare-and-swap between simultaneous settings writers.

Root accepts these dispositions with no remaining required source finding in
this repair boundary. A6 remains3/3 and owning A1/A3 each2/2. Source release
permits the clean commit and artifact pipeline; it does not complete the actual
declaration guard, emitted consumer, Cloud acceptance, CI or owner gates.

Fresh local checks pass: offline SDK freshness17 files, web/desktop/package/e2e
types, package tests, web lint, full web Vitest383 files/2,603 tests plus71 browser
tests with zero skips, desktop468 passed/14 platform-dependent skipped, and both
local and hosted source builds. The earlier desktop deadline failure is retained;
its full rerun passes without code or timeout edits. Existing unchanged backend,
boundary and package-policy results are reused from the earlier final integration
record. No fresh backend run or physical/native acceptance is claimed. Static
receipt SHA `5d0c7507d63a27655b1c3c94492ddead769d56097945f570ea9449cfaacf97b8`
and full-test/build receipt SHA
`f38a83266bb4b7aa6c76545d8892658d46fdc8f16425207726c0ae5c986d8b51`
bind the matching frozen source.

#### Code Review #5 Findings — actual mobile Library navigation

**A6-R7 is required.** The actual hosted Library at mobile width has no accessible
external drawer opener. Its plain header omits the shared Header; the existing
opener is inside the closed hidden/inert drawer. Usage or App Settings closes the
drawer, preventing later navigation. The earlier empty-roster dismissal fixture
proved pointer release but did not exercise reopening from actual Library.
A focused actual-browser probe confirms this stable screen defect with normal
body/html pointer events. Its earlier failure stage does not reproduce or explain
the timing of the original complete run. That run passed18 checks, including
private voice reload, cross-owner private content isolation and desktop Usage,
then failed in mobile navigation; final account-switch/logout/CSP checks remain
unperformed. Raw partial results are not overall acceptance.

#### Code Review #5 Revisions — approved repair4of4

On2026-10-06 the owner approved the prepared A6-R7 repair and continuation in the
agreed interleaved order. Resume verification retains clean public220c6581 and
the existing task worktrees/branches. All unused task containers were removed
with volumes, images and unrelated stacks preserved. No task runtime is needed
for these source fixtures. This additional bound is A6 **4of4** and owning A3
**3of3**; A1/A2 remain2of2, A4/A5 remain1of2. No earlier count, failure or gate
is reset, and no broad audit or further automatic repair is authorized.

The change boundary is LibraryPage.tsx and retained-screens.browser.test.mjs,
plus this living record. The header adds a mobile-only existing Button/Menu
using AppShell.openSidebar. Four actual Library/router/shell cases require
ordinary navigation after hosted Usage or local App Settings Escape/Close.
The first case fails against unchanged product source waiting for Open sidebar;
that is the meaningful behavior red. Product repair makes the local cases pass.
The initial hosted cases expose a incomplete quota response in the screen
fixture: it returns only turns. The test supplies chats, storage_bytes and
resets_at through that existing HTTP boundary in the same test file, then passes. Public
formatter checks also correct two new wrapped assertions; the prior outside
format-only result did not establish formatting under the real file configuration.
The final four cases pass with zero skips and no forced click, style reset,
reload workaround, extra timeout or quota change. Web type checks and lint pass.
The affected full real-router screen suite passes8 cases with zero skips, including
all four new navigation regressions, and both1440/390 screenshots are inspected.
Desktop keeps its existing header; narrow Library visibly supplies the opener.
Bounded independent analysis/checks are next.

R4/R5/R6 source results and clean220 immutable evidence remain valid within their
scope. Actual native CI attempts1/2 remain failed; focused emulated Linux entry
passes are diagnostic, not CI acceptance or proof of the distinct clip stall.
After targeted source review, commit the approved repair, regenerate a clean
immutable set, validate genuine retained-C upgrade/open-tab/rollback and obtain
fresh exact-source ci:full. The hosted consumer reruns the full corrected app on
a fresh cohort under the unchanged three-root/$0.15 ceiling. Full common PASS
still gates duplicate UI retirement. C6 formal initial review remains0of2; clean
releases, final-source account/common/admin/lifecycle, validated public main,
owner merge, promotion/readback and provider/device/deployment gates remain.

#### Code Review #5 source release — R7 resolved

Independent targeted analysis and checks both return **SOURCE_RELEASE_PASS** for
the three-path R7 delta, aggregate `d611e6a2ed7cf38038e17e3e2be0de547619cdc5459b10f80d188212feb3f99e`.
Analysis receipt SHA `63ff0eece8c3877c8760aa0b35e82adc1b934d90272fe7608301d3e2a7ac4913`; checks receipt SHA
`7a1f52632894f79b98b279a693fe580fc0d65e7a14f865885a68361093eabb59`. Root verifies their bound evidence and matching
source hashes. No required regression finding remains. The independent replay
passes all four actual local/hosted Library Escape/Close cases with zero skips,
using ordinary pointer actions and unchanged deadlines. The affected full suite
passes8 cases; web type/lint/format and local production build pass. No physical
speech or actual provider result is inferred from source fixtures.

The quota evidence wording is corrected: the existing fixture returned200 with
turns only; the new cases supply the complete chats/storage/reset contract in
the approved test file. This is a fixture prerequisite, not a product defect or
another repair. Earlier fixture failures, formatter warnings and reviewer setup
errors remain recorded and are excluded from passing claims. All nine R4/R5/R6
source hashes remain unchanged; their historical checks keep their original scope.

Accept A6-R7 as resolved in source. A6 remains4of4 and owning A3 remains3of3;
all other counts/gates are retained. This permits the scoped verified commit and
clean producer/installed-and-emitted consumer/retained-C upgrade/open-tab/rollback.
The new exact-source native ci:full and actual hosted full replacement remain
required. C6 duplicate UI retirement is still held on common PASS. Initial C6
review0of2, clean private releases/final-source acceptance and C7/owner/main/
provider/device/deployment gates remain separate. This delivery record addendum
changes no reviewed product or test byte and does not embed its own future commit.

#### Code Review #5 artifact and upstream-main continuation

The approved three-path repair is committed at
`f646cedd7aff7f57f8338540255cf0a9fea7e557`. Its clean package set, manifest SHA
`9d483f0dce7eafacea811c665921c6d99356b0ceb164a41efa8ad222b3066bb2`,
passes producer, unchanged declaration guard, installed/emitted consumer and
genuine retained-C upgrade/open-tab/rollback. Producer uses Python3.12.13;
the outer orchestration/consumer uses Python3.14.4, Node24.15.0 and pnpm10.33.0.
No dirty-build exception, source import or generated metadata edit is used.

Public main then advanced to `9abfc771f25ade6562617c999464d109d42c0e57`.
Its net four-path delta is the already merged desktop lip-sync packaging fix:
an explicit phonemizer resource audit, the dynamic English-language hidden
import, its documentation and focused tests. Conflict-free task integration
retains every R7 product/test byte. Independent bounded analysis finds no
required integration defect; the shared import closure remains297 reachable,
230 shared and zero forbidden. Cloud excludes the changed native audit module;
HTTP contracts, product admission, shared UI and dependency locks are unchanged.

The first targeted packaging check passes16 and fails1 because this development
environment lacks declared server-extra gruut packages. Direct import establishes
the missing dependency, rather than Python incompatibility or a source defect.
Restore the normal supported development extras with `uv sync --frozen`;
locked gruut2.4.0, gruut-ipa0.13.0 and gruut-lang-en2.0.1 then import and all17
packaging tests pass. Configured Python Ruff/format, import closure and whitespace
pass. The original16/1 result and inapplicable forced PyInstaller-spec checks are
retained; the latter match unchanged baseline diagnostics. No source repair or
review-budget reset follows from environment preparation.

This continuation permits the reviewed merge checkpoint and fresh clean
current-tree producer/guard/installed-and-emitted consumer/retained-C validation.
The f646 artifact remains historical engineering evidence; the new exact source
and manifest are derived from that committed checkpoint and bound in the delivery
record. Full native ci:full and the complete fresh hosted common-app journey
remain required. A6 stays4of4, A3 stays3of3 and every other count is unchanged.
The full common PASS still gates duplicate UI retirement; C6 initial review0of2,
clean private releases/final-source acceptance and C7/main/owner/provider/device/
deployment gates remain separate.

#### Validation blockers after source release — 2026-10-06

The exact clean main-integrated source is5d95dc17, tree844f287e. Its format2
manifest09f268da and producer, unchanged comparison, all eight installed/emitted
consumer checks and genuine retained-C upgrade/open-tab/rollback pass. These
receipts belong to that committed source; this record update is not a new build.

Actual native ci:full run37536127901 attempt1 fails. Its tested mergef182c110
has the same tree844f287e as5d95. Complete offline backend, preceding checks and
2,603 Vitest cases pass. Browser results are73/75, zero skips. Hosted settings
persistence and actual hosted Library Escape fail in initial page.goto load waits
at the unchanged10,000ms deadline, before behavior assertions. The other three
new Library dismissal cases pass. Document response, DOMContentLoaded/load and
request milestones were not captured, so no optimizer, renderer, resource or
product cause is established. Later desktop tests, production build, browser
smoke, immutable producer/consumer and baseline comparison are skipped in this
run. Earlier220 failures remain separate, including the emitted clip stall.

The one fresh complete hosted fixture7 run stops after six checks at the first
Settings capability response.json with Chromium Network.getResponseBody / No data
found. Identity18+, admission/bootstrap/Library, deep-link/reload, manual memory
and attachment exclusion pass. Temporary memory is deleted; A/B paid roots and
durable pending counts are zero. Matched response status/body and completion were
not captured before the error; its historical cause is unproved. Isolated real
Chromium mechanism tests support a held request-association correction and retain
hard failure for broken new responses. They do not establish hosted acceptance.

All source/custody/failure evidence is sealed. The latest13 task containers and
three owned networks are removed, preserving all baseline196 volumes,270 images,
29 unrelated containers and records/cohorts/liability. No reset or reconciliation
is performed. Full common PASS still gates duplicate UI retirement. C6 initial
review remains unstarted0/2; final-source releases/browser acceptance, actual CI
and C7/main/owner/provider/device/deployment remain required. The owner then
approves one additional bounded A6 validation repair round5/5. Owning A3 stays
3/3 and all other counts are unchanged. This authorizes test-only diagnostics,
evidence-supported fixture repair and a fresh complete pre-retirement journey
under the original three-root/$0.15 ceiling. No deadline/assertion waiver,
automatic full retry or prior-cohort reset follows.

#### Code Review #6 Findings — targeted validation diagnostics

The owner approved one additional bounded A6 validation repair5/5 on2026-10-06.
Owning A3 remains3/3, A1/A2 each2/2 and A4/A5 each1/2; C6 formal initial review
remains unstarted0/2. This targeted round retains earlier failures and resolved
product findings. Actual native run37536127901 remains failed and its initial
load cause unconfirmed. Fixture7 FAIL6 remains a distinct unconfirmed body-read
failure, with zero paid roots and sealed cleanup/custody.

Independent analysis reports no actionable findings in the frozen five-path
public change. Four test-script paths add passive initial-entry diagnostics and
owned-context failure cleanup; the fifth is this living record. The unchanged
10s load and15s workflow readiness conditions, Library heading readiness,
subsequent visits and product assertions remain. Diagnostics retain the native
Error and bounded relative paths/status/timing without bodies, headers, cookies
or query values. Real loopback hanging/delayed resources still fail at10s, and
normal/network-failure cases verify listener cleanup and context isolation.

Configured syntax, Prettier and ESLint pass. One source-unchanged local run is
retained as sleep-contaminated:10/12 pass with two click/scroll stability timeouts;
a900s host-sleep interval is confirmed by the power log. It is not acceptance or
proof of the historical native CI cause. After the owner confirms the host is
awake, all8 retained-screen cases and the focused hosted settings persistence
case pass, zero skips. No deadline, source or assertion change follows that run.
Independent exact-source checks: all13 browser cases pass, zero skips; syntax/format/lint and diff checks pass. Analysis receipt
SHA 8e0e6896c138f761b0cfe8a1d72ecf8f08a270eb39c7d5d757a3a099c88fae90; checks receipt SHA ad680ff198eee6a22e7f986ec8c5e6a2270ba245ca2c92e5381b55752a9c465c.

#### Code Review #6 Revisions — source release for approved round5/5

Accept the scoped analysis and checks. No further source repair is requested by
this recheck. The clean commit, fresh producer/unchanged comparison/all eight
installed-emitted consumer/genuine retained-C upgrade/open-tab/rollback and actual
native ci:full remain the next gates. Local diagnostics are not a latency fix or
CI acceptance. All earlier failed runs and artifact evidence retain their exact
source scope.

The separate Cloud observer correction associates capability responses with
requests begun after observation, captures the body immediately and preserves
hard failure for genuinely broken new responses. Six extracted-loopback controls
support that mechanism; they do not prove fixture7's cause or hosted acceptance.
A fresh complete common journey remains subject to reviewed artifact/readiness,
three inclusive roots/$0.05 each/$0.15 total, ambiguity counted, with no automatic
full retry or prior-cohort reset. Full common PASS still gates duplicate UI
retirement. C6 formal review, clean releases, final-source browser acceptance,
validated public main, owner merge, promotion/readback and provider/device/live
deployment gates remain separate. A6 is not marked complete by this source release.

#### Native diagnostics and serial browser scheduling — approved round5/5

Clean de6108c2, tree a4eae4a2, passes the fresh producer, unchanged comparison
and all eight installed/emitted consumer checks, including genuine retained-C
upgrade/open-tab/rollback. Actual native ci:full37550197183 attempt1 still fails:
3,165 backend tests pass with10 skipped, and2,603 Vitest cases pass; browser results are77/79, zero
skips. Both initial-entry failures retain document200, completed HTML and main
frame commit, but no DOMContentLoaded/load within the unchanged10s deadline.
Library retains42 pending module requests. Settings evidence is truncated, so
its64 completed retained requests do not establish that all requests finished.
The four real loopback diagnostic controls pass. Later required CI gates are
skipped; local artifact receipts do not establish their archive bytes were tested
by CI. Earlier failed evidence remains retained.

Independent diagnosis supports explicit serial browser-file scheduling as the
smallest fixture repair candidate. The existing command starts eight expensive
Vite/Chromium test files with Node's hardware-dependent default concurrency.
The command now sets --test-concurrency=1; process isolation, all79 cases,
original10s navigation and15s hosted readiness deadlines, assertions and passive
diagnostics remain unchanged. The exact optimizer/CPU/renderer cause is unproved;
no Vite warmup, retry, readiness relaxation or product change is added.

Before applying that one-line change, an author cold-cache experiment at clean
de6108c2 passes all79 cases, zero skips, in142.95s. Both task-only optimizer
caches are preserved outside the checkout before the run. Utility-scoped idle
sleep prevention ends with the test process and changes no persistent power
setting. Receipt SHA abc28d39d9359cf16c1cff6c998e6be1d8087416e98ccc9b73f7c8dc3c7f53b2;
independent diagnosis SHA93e6a79b53f4eef4365eb65a2b8ce1a2c3c5b94785a250aadb3d13e3588c9120.
This local result is not native CI acceptance. Targeted independent recheck,
fresh clean immutable artifacts and actual native ci:full remain required before
Cloud metadata refresh, candidate capture or the single full common journey.
This continuation remains within approved A6 repair5/5; A3 stays3/3 and all
other counts and C6/C7 gates above remain unchanged.

#### Targeted serial recheck blocker — approved round5/5 exhausted

Independent frozen-source analysis reports no actionable findings in the
two-path scheduling/record change. Its cold serial replay fails78/79, zero
skipped/cancelled, in133.59s. Both prior native entry failures, all four real
loopback controls and all eight retained-screen cases pass. The different failure
is the cross-window held-install test at
scripts/model-download-coordination.browser.test.mjs:363: after Cancel, source
shows not_installed but retries still contains the cloning encoder ID. Static
checks pass and source remains unchanged. Failed receipt SHA
4ed506ad61d24d0bb0ab81bda5603018d03b37595f5b7a9eeb3dab0631a92aff;
source-analysis SHA74f0e73cda3d53a46be61d30966767b1cad7ceb7e452189943436dcc075c574f.
The author79/79 result is retained separately, not substituted for this failure.

Source inspection supports a fixture race: cancellation broadcasts the existing
attempt before DELETE; a sibling can read the removed manager state before the
cancelling window consumes its response and publishes the cleared marker. The
failed log does not prove that exact interleaving or rule out a persistent product
defect. The prepared test-only proposal first observes downloading in both
windows with the original concurrent2,500ms deadlines, then observes
not_installed and empty retry markers in both under the unchanged concurrent
default deadline. Both final assertions remain. No product code, fixed sleep,
retry, skip or deadline relaxation is proposed. Patch SHA
3ff6dbccc79a50148e0276e1491461ae5718b823b981fceb96c21de65cabcd0e;
syntax/format are checked outside the checkout, but runtime validation and source
application are unperformed.

Approved A6 repair5/5 has reached its failed targeted recheck. Further source
repair and dependent commit/artifact/native CI/Cloud work require an explicit
owner extension under the bounded review policy. No automatic retry or budget
reset follows. The serial command and this failure record remain uncommitted;
last clean source/artifact is de6108c2/c43f205b. Cloud source, ordinary pins,
accounts and preserved resources remain unchanged and no fixture8 is launched.

#### Code Review #7 Findings — cancellation completion readiness

A6-CANCEL-SETTLEMENT-1: the independent78/79 replay above fails the existing
cross-window cancellation assertion. Independent source diagnosis supports a gap
between manager-state visibility and retry-marker reconciliation; the exact failed
runtime interleaving is unmeasured. The proposed stronger readiness still fails
if marker reconciliation is persistently broken. Diagnosis SHA
672c7544ba7ca191adb24ecf012aae7bbeccd16c28ce0ce595a3e2ae24a95277.

#### Code Review #7 Revisions — approved repair6/6

On2026-10-06 the owner approves one additional bounded A6 repair6/6 for the
prepared test-only settlement fix, affected checks, independent recheck, fresh
clean artifact and actual native CI, then continuation in the agreed Cloud order
only when those gates pass. Accept A6-CANCEL-SETTLEMENT-1 and apply exactly the
prepared patch3ff6dbcc. Both windows must first report downloading within the
unchanged concurrent2,500ms waits, preventing an initial idle snapshot from
satisfying cancellation readiness. Both then report not_installed and empty
retry markers within the unchanged concurrent default deadline. Original final
assertions and all79 cases remain. Product code is unchanged; no fixed sleep,
retry, skip, relaxed navigation/readiness or quota change is introduced.

The meaningful RED is the retained independent78/79 result. The applied test
SHA33ced1667d9eb6e66bef81be4d28f93da745695190f3ea80c756fa73b20816e0
matches the prepared proposal. Author checks and targeted independent analysis/
checks are next; no runtime pass is claimed yet. Earlier source, CI, Cloud
failures and receipts remain retained. A6 is6/6 active; A3 stays3/3, A1/A2 each
2/2, A4/A5 each1/2 and C6 formal initial review remains unstarted0/2. The
extension supplies no merge, publication, ordinary pin adoption, promotion,
provider/device or live deployment acceptance.

Targeted independent source analysis finds no actionable issues. Author affected
browser checks pass5/5, zero skips; configured formatting, lint, syntax and
whitespace pass. An initial sandbox loopback EPERM prevented server startup;
that environment failure is retained and is not the meaningful RED or runtime
acceptance. Same-source execution with loopback access passes. Independent cold
all-eight-file replay passes79/79, zero skipped/cancelled, in144.83s. Only the
three named affected fixture optimizer caches are preserved outside and recreated
empty; this is not a global cold-cache claim. Source hashes/modes and all three
backup inventories match before/after. The cancellation case and both original
entry failures pass. Source-analysis SHA
d8d86c7e89ccb53ee0039ebbe7567ad3e3e9f279997736d0bb4f6430e92e6c0e;
independent-checks SHA30556bcaa7f393b27a550e7b3544b1fc02ffe0a6090efdca30b170170a09217d.
Accept the targeted source/check result for the corrected fixture. Fresh clean
producer/comparison/all eight installed-emitted consumer/genuine-C rollback and
actual native ci:full remain required. No passing native CI, Cloud replacement,
retirement or phase completion is inferred from this local source release.

### Phase 7: Harden shared recovery and runtime lifetimes (A7)

This public work package and consumer C6H form the human-requested phase after the common-application C6 cutover and before C7. Enter only after C6's existing gates actually complete. Reuse this plan's branch/PR; record the new child under #272 and exact starting/reviewed/committed source. Preserve A1–A6 identifiers, review histories, A6 approved 6/6, A3 3/3 and the six hosted exceptions. The consumer phase introduces no public dependency on private code or operational files.

1. Reproduce transient events/context failures and reload during an ambiguous creator save. Preserve same-owner drafts while authority is uncertain, suspend writes requiring admission, and reconnect within existing bounds. Retire private work only for authoritative revoke/sign-out/owner/session replacement. Define the smallest noncredential recovery namespace/lifetime needed to reconcile the original operation ID after reload, isolate tabs and purge all relevant hosted recovery on session end. Never persist authentication secrets or treat recovery identity as authorization.
2. Add model/speech slow-consumer RED cases where the consumer awaits between deltas. Bound provider pulls by one absolute deadline without cancelling unrelated consumer work; preserve structured timeout, cancellation, close and exactly-once outcomes.
3. Test repeated audio/microphone completion/manual-stop/track-ended cycles and late acquisition after scope retirement. Completed registrations return to baseline; live resources still terminate on revoke. Reproduce Electron/Compose PiP/quick-chat before a focused native-route repair, preserving hosted native exclusion and renderer-bridge checks.
4. Resolve the runtime/loadout catalog boundary with minimal owner-bound injection or a precise tested contract clarification. Dispose advisory capability/route/consumer-fake/diagnostic observations through demonstrated behavior; avoid blanket cache rewrites or unrestricted producer-derived admission.

Acceptance: transient event/context faults retain the exact draft and recover without stale writes; same-owner reload reconciles the same operation rather than resubmitting it; authoritative revoke/sign-out/replacement blocks access and removes hosted recovery. Slow-consumer tests leave no cancellation debt and finish/close exactly once. Resource registrations return to baseline over repeated cycles, with active-resource cleanup intact. Any native/catalog change has focused local, owner/Included/foreign-mutation coverage. Record all 16 advisory dispositions through the coordinated handoff without redoing addressed C6 repairs.

Use the existing hosted-composition/runtime-controller/resource/recovery browser and unit fixtures, test_model_call_boundary.py and test_bounded_speech.py. Run affected static/unit/build checks, desktop-first then narrow browser checks, generated-client freshness only if the HTTP contract changes, and independent installed/emitted consumer checks. Produce one clean immutable successor after the fixes, proving reproducibility, genuine retained-generation upgrade/old-tab/rollback and no private build inputs.

Review this new scope once comprehensively with at most two targeted repair rounds; inherited findings keep their original counters/extensions. CI waiver is not CI success. Completion hands reviewed public source/artifacts to C6H independently of a future main pin. Exact-candidate owner merge, validated main adoption, promotion and actual provider/device/deployment acceptance remain separate gates.

Progress: implementation authorized and entered on 2026-10-08; issue https://github.com/raymond-van/animama/issues/333; starting runtime source `df0faae10578072241d15d956b88cf9f8fb23897`, documentation checkpoint `0d57b606aa7035d33cc8df2d325e30f06d68fab9`. Exact incoming main `5f93876ca5f04f5483e164d1252b4cd5dcb70fcc` is integrated locally without replacing the task checkout or authored changes. Preserve main's track-based clips/Included Gestures and creator states; common-web ADR is renumbered0015 to preserve main0014.

#### Code Review #1 Findings — A7

Independent analysis and checks bind all3,419 source paths, including untracked files and literal contributor-link target, to the initial freeze. Required findings: AN1 repeated uncertain event notifications abort a healthy slow admission read and bypass its backoff; AN2 an unknown/missing initial context purges persisted ambiguous-operation recovery before authoritative denial; CHECK1 incomplete test provider protocols/optional tasks and CHECK2 incoming-main validator index types produce14 mypy errors; CHECK3 three common-web ADR display references retain the old number. No optional redesign is assigned. Initial repair count0/2; this review does not reopen A1–A6.

#### Code Review #1 Revisions — A7 repair1/2

Accept all five findings. Repeated uncertainty immediately suspends dispatch but coalesces behind the current admission read or backoff; definitive revoke/sign-out still preempts. Clear the completed pending read in `finally`. Unknown/missing and setup/repair context states retain reload recovery while withholding admission; only recognized account/session denials purge it. Seven integrated fake-timer/storage regressions fail before repair, then pass; seven recognized-denial controls remain positive. Existing reload-original-operation and browser authority controls are retained.

Complete provider test protocols through the existing fake, narrow current tasks explicitly, and preserve exact validated beat IDs with type-only casts. Correct ADR0015 labels. Focused author result:50 runtime/admission cases,48 affected Python cases, Ruff/format and mypy717 source files pass. Initial integrated baseline already passed3,232 backend tests (10 baseline skips),3,038 frontend tests,85 browser cases, SDK freshness, local/hosted builds, package/desktop and E2E static checks. Affected final checks and independent targeted review#2 remain pending; repairs used1/2.

The genuine retained C producer repeat matches original manifest `25bc4ce3a46b49714b3bff036a3974611dd7bbad74ee9054c33565fb7def41a9` and every payload. Current successor production/repeat, all eight installed/emitted consumers, genuine upgrade/open-tab/rollback, actual Electron/Compose and Cloud successor acceptance remain pending. No A7 completion, CI pass, main adoption or release authority is inferred.

#### Code Review #2 Findings — A7

Targeted independent analysis resolves AN1/AN2 without induced findings; receipt SHA9ab119f03aaac58d10dd4374dcddfd88d2e1eddf78c470456e88d65b79353fab. Independent checks resolve CHECK1/2/3 and pass refreshed type/lint,3,052 source tests across404 files,85 browser cases, local build and hosted build, zero skips. One remaining required finding CHECK4 is a one-line Prettier correction in the new denial-control table. Preserve the original formatting failure and preceding wrong-workspace tool error. No broad review is restarted.

#### Code Review #2 Revisions — A7 repair2/2

Accept CHECK4 and apply only the declared one-line formatting correction. Independent final format/source readback reconstructs the original frozen file by reversing exactly that correction, verifies the other3,418 paths/modes unchanged, and passes configured Prettier and staged/unstaged whitespace checks; receipt SHA5b8f2c30aa64a3239656151f7468db265fd4f74e0c66d09a391debcf8e6c93a0. Reuse unchanged passing expensive checks. Repairs used2/2; no additional automatic review repair is authorized. Artifact/runtime gates remain open, including the already identified emitted-consumer compatibility observation.

Actual Electron39/Compose acceptance passes against the current source: the real API reports `self_hosted_web` with `native_features=false`, yet PiP and Quick Chat load their exact native child routes, render their canvas/close control and input, and have visible native windows with opacity1. Actual preload roles, sandbox, context isolation, web security and disabled Node integration are verified. Both windows close through their real bridges. This uses a fresh desktop profile and isolated task stack with private PostgreSQL, no provider requests. Earlier temporary runner failures used a wrong capabilities URL and an unsupported Electron diagnostic property; preserve them as runner failures, not product regressions. This is actual current-source GREEN, with focused unit RED already retained; no actual historical Electron RED is claimed at this checkpoint.

Source-check findings are resolved. The clean-source checkpoint remains an in-progress phase commit: deterministic successor/repeat, all eight installed/emitted consumers, genuine retained-generation upgrade/open-tab/rollback and independent Cloud acceptance still precede A7 completion. Ordinary main adoption, actual CI and release approvals retain their separate gates.

#### Artifact acceptance checkpoint — A7 compatibility decision pending

Reviewed source is committed at11c18a896aac4737db4c81dcde6fab83dedca043. Two actual clean producer builds agree byte-for-byte on manifest202a6653ee3c701585fc2d4b57159de552a8cebd3891a1833e699fa7772dee28 and all nine payloads. Independent repeat log SHAdcd8c4bdfa852a75acc885200b9f4d1cac9b20ca8425eb35f2c397821b3fc844. The initial repeat attempt was blocked by sandbox cache access before building; a fresh output with required cache access passes. Reproducibility alone is not consumer acceptance.

The first installed/emitted consumer fails its1.0-only clip assertion: incoming main ADR0014 requires every new save/export to use2.0. Preserve failure log SHA50567d30e50867d4699bb2bc5fc89d2c6b25358c454e88d5b02d095f81f6aae3. A separate temporary diagnostic changes only version-specific fixture expectations, leaving the two immutable apps unchanged. Actual normal and effect-only clips survive genuine C creation, A7 opening/conversion, saving and reload with metadata and dependency pins intact. Selecting genuine C again cannot reopen/export the persisted2.0 clip; preserve diagnostic log SHA5d3cac9212c20852f285d50415d8c6655a37fbb836566a6e54e366d085188b15 and all four successful precursor receipts. This is a real format boundary declared by ADR0014, not a timeout or an otherwise-passing fixture repair. No all-eight-consumer or edited-data rollback PASS is claimed.

The concrete proposed amendment preserves main2.0 behavior, genuine C forward/old-tab/unchanged1.0 rollback evidence and the actual incompatible edge, then requires genuine independently produced/reviewed2.0-capable generations for edited-data rollback before release. C would be excluded from approved post2.0 activation/rollback recipes; current Cloud selection does not automatically infer tenant clip compatibility. A7 has exhausted2/2; one additional narrowly bounded compatibility repair3/3 and the amendment are pending owner decision. Existing gates and counters remain unchanged until that decision.

Actual historical native reproduction is now available: the separately built unmodified genuine C shows “Unavailable here” in both real Electron PiP/Quick Chat windows, with correct preload roles and real self-hosted capabilities. This is explicitly retrospective baseline RED, alongside the current-source actual GREEN above. The old native stack is stopped through exact ownership checks with volumes/images/evidence retained. Current native teardown refused before mutation because the guard treated a distinct similarly prefixed project as owned; C6H owns the focused exact-namespace correction. No unrelated resources were stopped.

C6H's final bounded repair2/2 corrects that exact-namespace guard and passes independent analysis plus31 independently rerun affected cases, retaining all44 foreign-resource mismatch controls. Actual current native teardown then passes with zero owned containers; log SHA0b7f9d1107c8f2ee39258dadd6703470974b9b051a4a0cddb2946266939e4d48. The completed Cloud author database is also stopped through its checked-in guarded wrapper. Task data/images/evidence and unrelated stacks remain. Both repositories have verified source checkpoints; A7's unchanged artifact gate and its explicitly proposed extension are still pending owner decision. Parent/child trackers record the blocker and next phase order.

## Final integration review

A6's review closes integration of A1–A6; do not reopen those reviews. A7 has the new scope's separately bounded review above, reusing valid inherited evidence.
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

A1–A5 and C1–C5 engineering gates have passed, including clean package production,
installed/emitted consumers and genuine upgrade/rollback. Final integration and
the actual Cloud common-app journey exposed seven public findings. R1–R3 passed
their targeted review; the owner-authorized extra repair resolves R4–R6 in source
after independent analysis/checks and matching full frontend validation. Clean220
producer/installed-consumer/rollback passes; actual native CI attempts1/2 fail.
The actual hosted journey confirms mobile Library finding R7. Its approved A6
repair4of4/owning A3 3of3 passes four author browser regressions and independent
targeted analysis/checks. Cleanf646 successor validation passes; bounded incoming
main integration passes analysis and17 packaging tests after declared environment
preparation. Clean5d95 producer/guard/all eight installed-emitted consumer and
genuine retained-C rollback checks pass. Actual native CI then fails two initial
load waits before behavior assertions; hosted fixture7 stops at the first Settings
body read after six checks and zero paid roots. Causes remain unconfirmed and the
owner approves one additional bounded A6 validation repair round5/5; all other
counts remain. Full hosted
replacement, passing actual CI and owner/main/provider/device/deployment gates
precede overall parity acceptance. Existing failures, resource limits and phase repair counts remain
recorded above. The agreed interleaved order remains authoritative.

Revision note, 2026-10-05: initial plan separates reusable public implementation
from hosted operations and prevents a circular public-merge/consumer-pin gate.

Revision note, 2026-10-05: recorded the approved cross-repository order, native
phase assignments and ongoing parent-progress updates during workspace setup.
No implementation phase or deployment gate was advanced.
