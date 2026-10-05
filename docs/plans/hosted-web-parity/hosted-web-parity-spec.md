# Hosted web app parity

Status: Specification and ExecPlan baseline adopted for workspace setup on 2026-10-05.
The owner approved the coordinated implementation order and creation of the phase
assignments. Setup is prepared; implementation has not started and begins on the
next implementation instruction.
Authority: [issue #272](https://github.com/raymond-van/animama/issues/272).
Issue snapshot: published and read back at `2026-10-05T16:26:16Z`.
Source baseline: Animama `f90c080fc343a159cb9d7f9059a35127f871c021`.

## Problem and intended users

Self-hosted web users have the complete Animama browser application. Hosted users
currently receive a separate, smaller chat application, without much of the
navigation, companion runtime, settings, memory management and content workflows.
Copying or selectively recreating those screens creates continuing divergence.

The outcome is near parity in existing user-facing screens and functionality,
using one product source. Hosted adds signed-in accounts, tenant isolation and
quotas; self-hosted retains its installation-owner and administration behavior.
Existing hosted implementation gaps are work to deliver, not product exclusions.

## Goals, scope and non-goals

Retain existing self-hosted web workflows by default, including real chat,
avatars, voice, effects, memory, Library, creators, supported content sharing,
settings and browser interactions. Use the self-hosted UI as the visual and
interaction baseline. This is not a redesign, a new application framework or
an expansion into features the self-hosted product does not currently offer.

The six approved hosted exceptions are:

| Exception | Boundary |
| --- | --- |
| Anima creation | Disable creating an Anima, including Anima-package import and any creation-equivalent operation. Keep editing existing Animas, their loadouts, content creation and Anima export. Initial server-owned account bootstrap remains available. |
| Chat attachments | Do not attach uploaded files to a chat turn. Apply the restriction to every upload, paste, drop and submission path. |
| Document uploads/OCR | Do not ingest documents for processing, OCR or chat retrieval. This does not exclude images, VRMs, sounds, voice samples or typed content packages used by existing product workflows. |
| Provider keys | Hosted users do not supply provider credentials or administer connections/endpoints. Cloud supplies its operator-owned catalog and credentials; users retain supported model, role and voice choices from that catalog. |
| Local filesystem administration | Do not expose server paths, directory selection/scanning, filesystem repair, host logs or server-global model installation/removal. Retain account-owned content and the memory editor's virtual files/folders. |
| Electron features | Do not invoke native bridges, credential vaults, native windows, global shortcuts, installers or desktop updates. Retain ordinary browser fullscreen and browser picture-in-picture where supported. |

These exceptions apply to operations, not entire screens. In particular, Anima
creation being disabled must not remove Avatar/appearance editing or content
creators. Document ingestion being disabled must not remove voice cloning or
creator asset uploads. Provider administration being absent must not hide every
model or voice selection control.

The outcome includes missing hosted APIs, persistence, runtime delivery and
provider integration required by retained workflows. Implementation belongs in
its owning repository, with linked Cloud assignments. This explicitly replaces
#272's former exclusion of backend work beyond the existing hosted allowlist.

Marketing pages, documentation sites, billing, Discover, new central-account
export/deletion workflows and desktop distribution are outside this outcome.
Existing hosted account lifecycle behavior is preserved. Repository visibility,
artifact publication, paid service activation and production deployment retain
their separate authorization and release checks.

## Approved architecture: option 3

Animama builds a hosted browser entrypoint alongside the local entrypoint from
the same product routes, screens, styles, settings and browser runtime. The
hosted build is an immutable static application artifact that Cloud installs
and serves. Cloud no longer maintains a parallel implementation of the product UI.

Entrypoints supply narrow composition adapters for startup/readiness, owner,
authenticated API transport, capability data and account/usage actions. The
browser-side hosted adapter consumes documented HTTP contracts; it contains no
private server implementation, credentials or dependency on the Cloud checkout.
Hosted account and quota presentation can share the product UI without moving
identity, admission, metering or operator authority into frontend code.

The shared router must not require local installation bootstrap or redirect
hosted users into local setup. Local/native utility routes remain composition
specific. One shared product route definition and screen implementation is the
target; two copied route trees or separate hosted versions of each screen are
not acceptable.

Explicit build entrypoints select composition wiring. They do not introduce
`VITE_*` local/hosted switches for product behavior or make the frontend an
authorization boundary. Features use runtime capabilities and browser support.
Existing portable packages remain usable; extracting the whole application
into a new npm package is not a prerequisite.

## Screen and feature inventory

Every row is part of the parity outcome unless a listed operation falls within
the six exceptions. Missing hosted support is a delivery dependency. Operator
catalogs, quota exhaustion and browser/device support may affect availability,
but must not be used to declare an undelivered feature complete.

| Area | Required retained behavior | Hosted dependency or difference |
| --- | --- | --- |
| Shell and navigation | Sidebar, menus, route/deep-link behavior, keyboard access, responsive layout, dialogs and preview dock | Account/readiness gate replaces installation startup; hosted account/usage actions fit the same shell. |
| Chat and history | Existing history, search, rename/delete, streaming, stop/retry, Markdown, layouts and model controls | Real operator-provided models, tenant-owned history, quota admission and matching stream/error contracts. |
| Companion behavior | Emotion updates, memory influence/updates, tools, web search, titles, compaction and companion safety behavior | Each supported paid operation is metered; operator catalog and safety authority remain server-owned. |
| Existing Anima management | Identity/profile and relationship-memory editing/repair, settings, appearance, portrait and background framing | Account-scoped mutations; no user-created Animas. Preserve actual existing actions without inventing a new management UI. |
| Loadouts | Avatar/voice choices, Gestures, Reactions, Idle Styles, previews, review/commit, stale-revision recovery | Hosted content ownership, runtime revisions and durable account-owned selections. |
| Avatar and playback | Starter avatar/portrait, expressions, gestures, reactions, idle, lip-sync, camera and canvas controls | Reviewed assets, issued runtime snapshots, authenticated bytes and the same playback lifecycle. |
| Effects and audio | Avatar/Particle/Scene effects, backgrounds and sound/audio used by existing content | Hosted catalog/assets and live playback; earlier text-only scope does not exclude these. No new standalone music Library feature is introduced. |
| Library | Existing tabs, search/filter, thumbnails, validation state, previews, customize/edit/delete and content selection | Account-owned writable catalog plus approved read-only supplied content. Host scan/path controls stay excluded. |
| Creators | Existing Avatar/content editing, Pose/Clip, Gesture, Reaction, Idle Style, Avatar/Particle/Scene Effect and Sound workflows; Save and Save & Equip | Tenant-safe drafts, assets, jobs, recovery and save/commit contracts. The Create hub remains useful with Anima creation disabled. |
| Content sharing | Content-package and creator-format import/export; existing Anima export | Bounded private upload/download and dependency-complete review/commit. Reject Anima-package import atomically because it creates an Anima. |
| Memory | Shared user memory, episodic context, Anima memories, virtual files/folders, editing/preview, conflicts/history and existing user-started Memory Manager/Reflection | Account-owned storage; Anima relationship memory remains Anima-scoped. Host filesystem access is unnecessary. No new autonomous processing is introduced. |
| Voice | Dictation, Voice Mode, microphone selection/test/sensitivity, STT/TTS choices, playback/stop/mute, voice catalogs and existing voice cloning | Browser readiness, appropriate runtime assets and bounded operator-provided services; unsupported devices retain text. |
| Settings and personalization | Existing appearance, behavior, chat, voice, safety, language/time-zone, model-role preferences, reset and applicable About information | Account preferences stay private; device/microphone choices retain browser-local semantics. Exclude server administration controls only. |
| Hosted account and usage | Sign-in/out, account access, usage/limits, eligibility, restriction and outage states | Cloud remains authoritative; ordinary Cloud sign-out preserves saved data and follows its existing session semantics. |
| Browser utilities | Existing browser fullscreen, picture-in-picture and shortcuts where supported | Browser feature detection; never require Electron or imply unsupported native behavior. |

The ExecPlan must map concrete routes, settings sections and actions to this
inventory at its selected source revision. It may refine implementation steps,
but cannot shrink a row to UI-only delivery or add exclusions without a new
scope decision.

## Required behavior

**R1 — One application experience.** Both builds use the same retained product
screens and interactions. Deep links, reload and back/forward navigation work.
Chat changes preserve the mounted companion runtime. New shared features expose
their dependencies explicitly so the applications do not drift silently.

**R2 — Availability with explanations.** Backend-owned capabilities describe
actual permitted operations. Preserve familiar entry points for intentionally
disabled product actions where an explanation is useful; show a brief reason
without starting the action. Omit irrelevant native/server administration
controls. Direct navigation to an excluded route gives a useful unavailable
state and a return path, never a blank page, local setup redirect or request loop.
Temporary outages and browser limitations have retry/fallback behavior distinct
from policy restrictions. Do not expose implementation diagnostics as product copy.

**R3 — Narrow exceptions.** Enforce each exception on direct API calls as well
as in the UI. Denied feature execution starts no dependent product data queries,
processing or paid work. Authentication, capability checks and bounded import
inspection/temporary staging may run to determine admission. Reject an Anima
package before installing any of its contents and clean its temporary staging;
content-only packages remain valid. An empty hosted Anima roster shows a useful
empty/unavailable state instead of redirecting to creation. Readiness repair and
repeated bootstrap preserve existing customization and intentional deletion.

**R4 — Correct product contracts.** Hosted routes implement the shared
request/response/error, stream, content and runtime-revision contracts needed
by retained screens, using shared services where appropriate. Mounting local
installation routes is not an implementation shortcut. Refresh generated clients
from their owning contract; do not infer endpoint admission from SDK presence.

**R5 — Account ownership and lifecycle.** Every newly admitted row, file, job,
draft, runtime lease, cache and export is owned or explicitly shared. One account
cannot address, modify, preview, download, search or receive another's data.
Sign-out, account changes and revocation cancel browser requests/playback, dispose
private resources and clear private browser state. Server operations already
durably admitted retain an idempotent, recoverable outcome under their cancellation
and authority rules; closing the browser or signing out does not imply rollback.
Revocation and deletion still fence server work under the hosted lifecycle policy.
Persisted chats, content, settings and memory survive normal sign-out. Ordinary content deletion and
account lifecycle deletion cover the new data, jobs, bytes and recovery copies.
Restrictions remain non-destructive.

**R6 — Preferences and memory semantics.** Hosted App Settings belong to the
account; per-Anima overrides retain their existing inheritance. Keep device
preferences browser-local and private state account-scoped, including storage
used outside the query cache. Memory's logical paths never authorize arbitrary
host paths. Shared user memories are shared only among that account's Animas;
relationship memories and Reflection remain scoped to their selected Anima.

**R7 — Functional companion runtime.** Deliver real chat together with retained
memory/tool, title, compaction, emotion and safety behavior. Avatars, expressions,
gestures, effects and sound work in the relevant creator, Library and live-Anima
surfaces. An optional asset failure may degrade only its dependent playback and
provide recovery; it must not unnecessarily disable unrelated playback or text.
Saving or equipping content preserves the current revision/remount semantics.

**R8 — Functional voice.** Preserve the existing voice workflows with available
browser or operator-provided engines, microphone permission/error handling,
locale/voice readiness, interruption and route/account teardown. Preserve supported
voice selection and cloning without exposing provider credentials. Browser
execution-asset downloads are separate from excluded server model administration.
Describe local versus externally processed speech accurately. Missing resources
or exhausted voice quota leave text usable with a clear explanation. Tests using
silent/fake adapters do not complete this requirement.

**R9 — Bounded hosted work.** Cloud enforces account/global quotas and storage,
concurrency and spend limits for every retained costly path, including tools,
titles, compaction, Reflection, embeddings/search, speech and content processing
where applicable. Reserve before dispatch and reconcile actual or uncertain
outcomes. Users see relevant usage, stable denials and retry/reset guidance.
Quota exhaustion does not erase saved data or discard an editable draft. Catalog
selection remains available separately from excluded credential/connection setup.
Existing approved ceilings remain the starting policy; a required policy change
must be explicit rather than implemented as unmetered work or a silent exclusion.

**R10 — Recoverable content workflows.** Creator and import uploads remain
bounded and validated, with private quarantine/processing where needed. Preserve
preview, draft recovery, optimistic revision conflicts and idempotent commit
behavior. After an interrupted Save/import, resolve its status before repeating
it; cancellation alone does not prove rollback. Persist only permitted content,
and preserve existing export rules that exclude private chat/relationship history.

**R11 — Reproducible artifact consumption.** Animama produces the hosted build
without Cloud source or credentials. Its manifest binds the source commit,
contract compatibility, entry assets, workers, engine resources, content references,
checksums and notices. Cloud installs verified immutable output and compatible
backend artifacts; it neither imports a sibling checkout nor rebuilds a copied
product app. Development tracks the newest validated main artifacts by explicit
repins with consumer checks; launch selects a reviewed release. Refuse unsupported
frontend/backend combinations and retain a compatible rollback point.

**R12 — Local behavior and honest completion.** Self-hosted and Electron retain
their existing capabilities and independence. The final parity claim covers all
retained inventory rows and the six explained exceptions. An unimplemented API,
fake-only model, missing asset or unavailable default configuration is outstanding
work, even if the screen renders. Document any new exception for owner decision
instead of reporting completion with unnamed follow-ups.

## Constraints

- Keep React/Vite/TanStack and the established owner, transport and capability
  mechanisms. Avoid a general plugin framework or a new capability system in
  parallel with the existing contract.
- Hosted identity, secrets, tenant persistence/migrations, storage, metering and
  deployment remain Cloud-owned. Animama owns product source and public contracts.
  Authentication and authorization are enforced server-side; no browser owner
  claim or build selection creates authority.
- Public specs, artifacts and builds contain no private implementation, operational
  secrets, account data or required private-plan links.
- Retain recorded asset permission evidence and notices. Hosting and exporting
  content are distinct distribution uses; verify the exact shipped/available set.
  Pending assets must be resolved or replaced with an approved equivalent, not
  silently used or treated as grounds to remove an entire retained feature.
- Load large avatar/speech resources on demand. Measure startup, transfer, memory,
  cancellation and cleanup against the selected local baseline and hosted budgets;
  the previous text-only build's measurements are not full-app acceptance.
- Coordinate the integrated release with separate deployment-hardening work.
  Preparing this spec does not alter its active candidate or establish production
  deployment, recovery or native-release acceptance.

## Acceptance criteria

- [ ] **Scope (R1–R3, R12):** every current user-facing route, settings section and
  action maps to a retained inventory row or one of the six exceptions. The map
  distinguishes environment constraints from unfinished work, with no additional
  exclusions hidden behind capability flags.
- [ ] **Artifact and independence (R4, R11):** build both web targets from Animama;
  install the hosted artifact into an isolated consumer without its source checkout.
  Verify manifest/assets/contracts, reject incompatible or modified artifacts, and
  exercise compatible upgrade/rollback. Cloud uses no parallel product UI.
- [ ] **Browser parity (R1, R6, R12):** compare the same retained journeys in
  self-hosted and hosted web at desktop viewport sizes, then narrower layouts.
  Exercise navigation/reload, keyboard access, settings persistence and account
  switching; verify local and Electron regressions separately.
- [ ] **Companion and voice (R7–R9):** exercise real chat, history/search/actions,
  memory updates/Reflection, tools and safety behavior; visually verify avatar,
  loadout and effects in creator, Library and live playback. Hear real speech and
  test microphone input, interruption, permission refusal and unavailable/exhausted
  engine fallback on the supported browser matrix. Record paid tests only when
  authorized; fake fixtures remain useful but are not this acceptance evidence.
- [ ] **Content and memory (R6, R10):** edit/save/reload supported creator content,
  voice samples, appearance and memory; preview/equip; import/export content;
  recover interrupted/conflicting operations. Exports omit prohibited private
  history. Host path administration remains inaccessible.
- [ ] **Isolation and exclusions (R3–R5):** use at least two accounts to challenge
  cross-account IDs, searches, caches, bytes, jobs, drafts and exports. Exercise
  direct APIs and database-role isolation, including cross-owner joins and parent
  references. Verify private responses/bytes cannot enter shared/CDN caches. Call denied
  routes directly. Verify creation-equivalent imports and attachments fail without
  partial side effects, while permitted creator/content uploads still work.
- [ ] **Limits and lifecycle (R5, R9):** quota refusal preserves data/drafts;
  provider and storage failures recover clearly. Sign-out/revocation during chat,
  voice, preview and jobs stops unauthorized access and browser playback, with
  durable operation status recoverable after legitimate reentry. Restriction
  retains data; deletion and recovery cover every newly admitted data family.
- [ ] **Delivery record (R11–R12):** identify exact artifacts/source, both
  repositories' checks, actual browser/audio evidence and remaining release gates.
  Do not substitute unit tests, build success or deployment success for parity.

## Open questions and decisions

- **Approved 2026-10-05:** option 3, whole-app near parity and the six hosted
  exceptions. Voice, avatars, effects, Library, creators and other retained
  workflows are included by default. No general intent-discovery interview is needed.
- **Replaced:** the earlier option 2 draft, the individual-screen extraction
  direction in #235's Hosted UI reuse notes, and #272's backend-allowlist limit.
  #235 continues to own source-release readiness; this issue owns parity.
- **Recorded implementation behavior:** R2 keeps meaningful disabled product entry points
  explanatory while hiding irrelevant server/native administration. R3 specifies a
  useful empty roster without introducing a new deletion control or automatically
  restoring intentionally deleted Animas.
- **Planning work, not open product scope:** enumerate exact route/contract gaps,
  compatible artifact format, operator catalog/engine choices, asset permissions,
  quota coverage and browser/performance acceptance budgets. Surface any genuine
  conflict with the approved outcome instead of inventing an exclusion.

## Spec

This issue is the published specification authority. The repository file is a
dated snapshot after publication. The specification and repository-scoped plans
are the agreed workspace-setup baseline as of 2026-10-05. This update creates the
assignments and records their order; implementation has not started.

## ExecPlan

[Reviewed Animama ExecPlan](https://github.com/raymond-van/animama/blob/6ddf2f2a20f2cad07d376dd4294fce2e0234ae1c/docs/plans/hosted-web-parity/hosted-web-parity-execplan.md) · [Current plan and execution evidence](https://github.com/raymond-van/animama/blob/feat/hosted-web-parity/docs/plans/hosted-web-parity/hosted-web-parity-execplan.md).

One branch/PR per plan in each repository. Animama owns shared browser source,
contracts, reusable services and artifact production. Cloud owns hosted APIs,
tenancy, provider custody, storage/jobs, quotas and artifact adoption. **Private
plan retained by maintainers.** The public scope and dependencies below remain
understandable without access to private implementation or plans.

## Implementation order and live progress

**Next phase: A1. All implementation phases are planned; none have started.**
`A` denotes Animama work; `C` denotes the hosted consumer's Cloud work.
These are engineering milestones toward complete near parity, not separate
reduced-product releases.

| Order | Implementation sequence | Completion / handoff |
| --- | --- | --- |
| 1 | A1 → C1 | Define the shared action/contracts map, then validate hosted ownership, storage, operation and quota requirements before dependent shared implementation. |
| 2 | A2 and A3, in parallel where useful | Deliver neutral shared services and the common app composition. C1 supplies a public-safe requirements handoff, never private source. |
| 3 | A4 → A5 alongside C2 → (C3 and C4) → C5 | Finish retained browser behavior/artifacts while hosted services use isolated installed candidate artifacts. C3 and C4 can run in parallel after C2. |
| 4 | C6 and A6 | Connect the complete common app and finish independent public regression/integration review. A6 does not wait for a future Cloud main pin. |
| 5 | Approved Animama merge → validated main artifacts → authorized promotion/readback → C7 | Explicitly adopt the compatible main package set and prove actual hosted parity. Merge, paid tests, artifact promotion and deployment retain their existing gates. |

| Animama phase | Assignment | Status / prerequisites |
| --- | --- | --- |
| A1 — Contracts and complete action map | [#273](https://github.com/raymond-van/animama/issues/273) | Ready for the next implementation instruction; no work begun. |
| A2 — Neutral shared backend services | [#274](https://github.com/raymond-van/animama/issues/274) | Planned; A1 and C1 requirements handoff. |
| A3 — One router and application composition | [#275](https://github.com/raymond-van/animama/issues/275) | Planned; A1 and C1 requirements handoff; can run with A2. |
| A4 — Retained workflows and resource lifetime | [#276](https://github.com/raymond-van/animama/issues/276) | Planned; A2 and A3. |
| A5 — Immutable whole-app artifact | [#277](https://github.com/raymond-van/animama/issues/277) | Planned; A4 and its dependencies. |
| A6 — Public acceptance and adoption handoff | [#278](https://github.com/raymond-van/animama/issues/278) | Planned; A5 and preceding public gates; coordinate with C6. |

| Hosted consumer phase | Status / public-facing dependency |
| --- | --- |
| C1 — Contract, tenant, operation and policy foundation | Planned; A1 input. |
| C2 — Settings, existing Animas, history and manual memory | Planned; C1 and A2 interfaces. |
| C3 — Bounded companion, tools, Memory Manager and Reflection | Planned; C2, A2 and C1 policy. |
| C4 — Content, creators, runtime and sharing services | Planned; C2 and A2 content interfaces. |
| C5 — Voice and cloning services | Planned; C3 metering, C4 content and shared voice interfaces. |
| C6 — Whole-app consumption and UI cutover | Planned; C2–C5 and A5. |
| C7 — Actual hosted parity and validated-main adoption | Planned; C6/A6, approved merge/main artifact handoff and existing live acceptance gates. |

Cloud owns its phase assignments and private execution evidence. This table tracks
only their public-safe readiness and acceptance summary. C2–C5 service fixtures
do not prove final hosted parity; C7 requires actual providers, microphone/audio,
avatar/effect playback, two-account isolation, quota/lifecycle and applicable
staging/recovery evidence. The separate deployment Phase 7 retains its own gates.

### Progress update rule

At every phase start, completion, or blocker that changes readiness, update the
owning child issue, the repository ExecPlan and this parent in the same handoff.
Record status, exact source/artifact revision, passed/failed/unperformed checks,
review result and remaining gates, plus the next ready phase. Keep private
operational details in the Cloud records and reflect only their public-safe
outcome here. A phase is complete only when its stated gate passes; a merged
public PR does not close this parent before full hosted acceptance.

Setup evidence: six native Animama sub-issues created with dependency links;
Cloud assignments are tracked in their owning repository. Existing task branches
and worktrees are reused. No services, migrations or product code were changed.
No PR is opened yet; the implementation handoff will create/update the plan's PR.

## Delivery links

- Parent release-readiness issue: [#235](https://github.com/raymond-van/animama/issues/235).
- Boundary: [ADR 0001](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/adr/0001-independent-local-product-and-packaged-sharing.md)
  and [ADR 0005](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/adr/0005-client-rendered-ui-and-local-native-composition.md).
  Implementation must update their current boundary descriptions for the new
  static artifact without weakening independent builds.
- Existing contracts: [runtime capabilities](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/src/backend/animama/app/contracts/runtime_capabilities.py)
  and [content/runtime delivery](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/architecture/local-content-runtime.md).
- Product references: [Anima management](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/features/anima-management.md),
  [Library](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/features/library.md), [memory](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/features/anima-memory.md),
  [voice](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/runtime/voice.md) and [models](https://github.com/raymond-van/animama/blob/f90c080fc343a159cb9d7f9059a35127f871c021/docs/frontend/features/model-settings.md).
