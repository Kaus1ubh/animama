# Repository cleanup baseline and usage analysis

Current handoff (2026-09-08): the user confirmed Phase 0 complete and explicitly
requested split Phase 1. Earlier pending-gate statements below are historical
AI handoffs. This confirmation does not claim that recorded unrun audio/native
checks passed; their separate product/release acceptance remains as documented.
The split ownership inventory consumes these retained/deferred decisions and
records its own exact source snapshot.

Phase 0.1 measurement completed on 2026-09-07 against commit
`7da4c7be70b1877d718f47704d36f604e58bb331` and the recorded working tree.
Steps 0.2 usage analysis, 0.3 reviewed removals and 0.4 approved retirements are
recorded below. Step 0.4 was committed at the user's request as `bf72160a`.
Step 0.5 final measurements and regression evidence are recorded at the end of
this report. The opening tables remain the original pre-removal baseline.
The overall Phase 0 user verification gate remains pending.

The headline baseline is **263,851 authored code lines** and **74,990 test/fixture
code lines**. All **2,895 tracked files** are accounted for: 2,172 received scc
text metrics and 723 received byte-only accounting. There are no unaccounted
missing files, unhydrated LFS pointers, or scanner omissions in the final run.
The baseline includes the then-tracked 20 files under ignored `cloud/`.

## Measurement scope

The 0.1 inventory excludes untracked files, including the newly introduced
measurement tools/report, and untracked ignored installations, caches, generated
build output, `.ua/`, and local runtime data. No tracked input hit the explicit
directory exclusion rules. Of the 2,895 tracked files, 723 were excluded from
line counting but retained in file/byte totals: 717 runtime assets/catalog
files, five vendored WASM binaries, and `src/frontend/pnpm-lock.yaml`.
The 20 tracked `cloud/` files were included despite ignore rules. Generated
client/router code, vendored JavaScript, tests, and docs/config were measured
separately, not omitted. The authored-code headline also excludes comments and
blank lines, whose counts remain available in the measurement records.

scc **4.0.0** is pinned in `scripts/repository-cleanup/measurement-rules.json`.
The official Darwin arm64 archive checksum was verified before execution. The
wrapper preserves its exact implementation, rules, binary hash, source hashes,
index, working-tree patches, invocation details, raw output and aggregates in
private evidence. See `scripts/repository-cleanup/README.md` for reproduction.

The canonical measurement label is `before-v2`; `repeatability-v2` produced
identical per-file hashes, counts and summaries. Earlier probes were retained:
explicit mappings fixed four root metadata omissions, and mapping PyInstaller
`.spec` files to Python correctly separated nine comment lines from code.
The rules were finalized before any removal. Future comparisons must use those
same rules or explicitly establish a replacement baseline.

The initial working tree already had `.gitignore` and this split ExecPlan
modified. Those bytes are represented in the measurement; original patches
were also captured before this step. New untracked measurement tooling and this
report are excluded from the tracked LOC inventory. Later documentation updates
and committing the new tooling will produce explainable inventory deltas.
The canonical record is a snapshot, not a claim that all current files equal HEAD.

## Category totals

| Category | Files | Physical lines | scc code lines | File bytes |
| --- | ---: | ---: | ---: | ---: |
| Authored source and tooling | 1,255 | 294,203 | 263,851 | 9,649,834 |
| Tests and fixtures | 382 | 83,046 | 74,990 | 2,847,274 |
| Generated code | 18 | 26,561 | 16,352 | 654,086 |
| Vendored material | 21 | 4,986 | 4,690 | 86,301,547 |
| Documentation and configuration | 502 | 165,575 | 143,046 | 9,874,569 |
| Runtime assets and catalog data | 717 | 0 | 0 | 1,334,879,969 |

Asset zeroes mean LOC is intentionally not measured. Vendored totals include
five binary files; their bytes are counted but they contribute no code lines.
Documentation/configuration includes one byte-only `pnpm-lock.yaml`, excluded
from LOC by scc's pinned built-in rule. Docs/config text metrics must not be
added to the authored-code headline. File bytes describe materialized inputs,
not Git history size. Measurement categories do not establish asset ownership
or redistribution permission.

## Authored code by subsystem

These rows are disjoint. Backend subsystem details and every parent-directory
rollup are available in the private `summary.json`; parent and child directory
rollups must not be added together.

| Directory/subsystem | Files | Physical lines | Code lines |
| --- | ---: | ---: | ---: |
| `(root)` | 3 | 733 | 630 |
| `alembic` | 14 | 2,953 | 2,143 |
| `cloud` | 9 | 848 | 686 |
| `db` | 3 | 269 | 251 |
| `scripts` | 13 | 2,508 | 2,058 |
| `src/backend/animama/adapters` | 74 | 15,208 | 13,014 |
| `src/backend/animama/app` | 110 | 28,045 | 23,842 |
| `src/backend/animama` | 4 | 675 | 471 |
| `src/backend/animama/domain` | 36 | 3,954 | 2,866 |
| `src/backend/animama/orm` | 30 | 2,463 | 1,954 |
| `src/backend/animama/prompts` | 7 | 1,232 | 771 |
| `src/backend/animama/resources` | 1 | 1 | 0 |
| `src/backend/animama/runtime` | 5 | 556 | 446 |
| `src/backend/animama/sdk` | 2 | 41 | 28 |
| `src/backend/animama/server` | 79 | 15,937 | 13,125 |
| `src/backend/animama/tools` | 1 | 1 | 0 |
| `src/backend/animama/utils` | 4 | 328 | 193 |
| `src/backend/animama/workers` | 3 | 482 | 391 |
| `src/backend/packaging` | 11 | 605 | 495 |
| `src/frontend/desktop` | 85 | 14,132 | 13,255 |
| `src/frontend/scripts` | 11 | 4,626 | 4,330 |
| `src/frontend/server` | 24 | 2,511 | 2,299 |
| `src/frontend/shared` | 1 | 109 | 108 |
| `src/frontend/web` | 725 | 195,986 | 180,495 |

## Authored code by language

| Language | Files | Code lines |
| --- | ---: | ---: |
| C | 1 | 36 |
| C++ Header | 1 | 19 |
| CSS | 2 | 313 |
| Dockerfile | 1 | 30 |
| HTML | 1 | 12 |
| JavaScript | 63 | 11,236 |
| Makefile | 1 | 39 |
| Python | 395 | 60,800 |
| SQL | 4 | 1,234 |
| Shell | 8 | 1,228 |
| TypeScript | 775 | 188,607 |
| TypeScript Typings | 3 | 297 |

## Validation baseline

| Check | Result |
| --- | --- |
| Backend Ruff 0.9.2 | Passed with no findings. |
| Backend pytest 8.4.2 / Python 3.13.13 | 768 passed, 1 skipped, 1 failed, 394 setup errors. |
| Frontend `pnpm check` and `pnpm web:lint` | Passed. |
| Web tests | 1,074 passed across 207 files. |
| Gateway tests | 44 passed across 6 files. |
| Desktop tests | 169 passed across 9 files. |
| Frontend `pnpm build` | Passed; warning for chunks exceeding 500 kB. |
| `bash -n reset.sh` and `docker compose config --quiet` | Passed. |
| Measurement integration tests | 4 passed using the pinned binary. |
| Measurement-tool Ruff check | Passed. |

The independent backend assertion failure is
`tests/test_emotions.py::test_normalize_avatar_vfx_ids_dedupes_and_enforces_region_rules`:
accepted IDs omit the expected `angry` and `emote_!` entries. This was recorded,
not repaired. All 394 setup errors arise from the unavailable configured
Docker/OrbStack socket; a read-only probe outside the sandbox confirmed the
service was unavailable. These tests are **unverified**, not product regressions
or passes. They need a fresh run once Docker is available before relying on a
fully green backend baseline for later removals.

Initial frontend test attempts could not bind loopback ports in the sandbox.
Permitted retries passed all 1,287 frontend/gateway/desktop tests. Both attempts
are retained in private logs. Backend uv commands could not access the existing
cache, so the installed `.venv` tools ran directly without dependency changes.
Other recorded versions: Node 24.15.0, pnpm 10.33.0, TypeScript 6.0.3 and uv
0.11.28. Detailed commands, durations, statuses and errors remain in the private
validation records.

No live-provider tests, local stack resets, native installer staging, signed
release checks, physical audio/browser journeys, or `make check-test` were run.
Application/runtime source did not change. Phase 0.1 records these limits;
affected verification must be selected again when actual removals begin.

## Handoff

Review this baseline and the known backend failure/environment gap before using
it for cleanup comparisons. Step 0.2 usage analysis and candidate triage are recorded below.
The line counts themselves do not imply deadness or any removal decision. Phase 0 remains in progress and its final user verification gate
has not been reached.


## Step 0.2: Usage analysis and candidate triage

Completed on 2026-09-07 under the user's separate instruction. Added exact
Knip **6.34.0** and Vulture **2.16** development pins, workspace entrypoint
configuration, and a reproducible Python scan helper with a narrow whitelist.
No application source, runtime behavior, dependencies used by the application,
or assets were removed. Existing locked package versions and frontend
importer/snapshot resolutions were preserved.

### Coverage and scanner results

| Analysis | Inputs | Result |
| --- | --- | --- |
| Knip | 1,123 configured project files: root tooling 45, web 961, gateway 24, desktop 93 | 969 findings; no unresolved-import findings. |
| Vulture | 515 tracked Python/.spec files, including 12 Cloud and 13 Alembic inputs | 676 raw findings; 669 after seven verified callback suppressions. No syntax/read errors or changed inputs. |
| Dynamic-use audit | 33 consumer groups and 39 package-script file roots | Source evidence for framework registration, build/process hooks, IPC, native modules, migrations, assets and optional features. |

Knip findings comprise 38 unused-file, 422 export, 503 type, three development
dependency, two unlisted-dependency and one binary finding. These are analyzer
categories, not confirmed unused product features. Seventeen explicit checks
confirm meaningful configured roots. Four initial unused-file flags were
corrected by identifying real consumers: native PostgreSQL build launcher and
implementation, the documented public-assets verifier, and the signing hook.

Generated client/router and precisely identified vendored files have selected
report exemptions; their dependency relationships remain analyzed. Native code,
Python, shell and binary/catalog payloads are outside Knip's JS/TS liveness
proof. Its debug output also retains unresolved computed directory/asset-path
coverage gaps even though the unresolved-import issue count is zero. The
Playwright configuration is analyzed through explicit static roots with its
execution-requiring plugin disabled; browser journeys were not executed.

Python scope includes tracked tests, scripts, packaging and migrations even
when ignore rules match. The seven custom whitelist entries are runtime-context
HTTP callbacks and Pydantic chat validators with source-verified consumers.
Both passes also use Vulture's built-in library whitelists. Vulture matches
names globally rather than constructing a complete scoped call graph; no name
collisions were found for these seven suppressions. Other framework model
fields, callbacks and fixtures remain visible for later review. An apparently
unreachable `yield` in a test fake was explicitly retained because it establishes
an async-generator contract.

### Reviewed decisions and remaining work

The private ledger contains **1,659 records**: 676 raw Python findings, 969 final
Knip findings, four corrected historical Knip false positives, and ten dynamic
review items. Records are findings/discussion items, not unique files or lines
available for deletion.

**47 records were source-reviewed: eight candidates, 26 keep decisions and 13
explicit deferrals.** Another **1,612 raw findings remain unreviewed and explicitly
deferred**. All raw reports and reviewed evidence, including source locations,
consumer caveats and required checks, are retained. This completes tool setup
and bounded initial triage, not exhaustive manual adjudication of every finding.
Step 0.3 must recheck candidates against current source and review further raw
findings before treating them as removal work.

| Candidate | Location | Evidence and remaining caution |
| --- | --- | --- |
| `PY-5974279d70` | `src/backend/animama/adapters/motion_stream.py` — `stream_blendshapes` | Method has only its definition in tracked exact-word search; the containing legacy motion client has only its definition and __all__ export. Candidate for later removal review; export alone hid the class from Vulture. |
| `PY-182a14742e` | `src/backend/animama/adapters/openai_agents/runner.py` — `resume_serialized` | Convenience method has no tracked caller; active memory manager invokes load_state and resume_state separately. The surrounding runner is live and must be retained. |
| `PY-3e91e3f322` | `src/backend/animama/server/deps.py` — `require_anima` | Legacy helper has only its tracked definition; current principal/session dependencies use other functions. No ownership or route changes are approved in this phase. |
| `PY-46a3dc6948` | `src/backend/animama/server/routers/anima.py` — `_validate_active_model_provider_row` | Private validation helper has only its definition in tracked search. Materializer has separate active model validation, which must be retained. |
| `FE-001` | `src/frontend/web/src/hooks/use-textarea-resize.tsx` — `useTextareaResize` | Only the definition appears in repository source search; chat composer has its own measured scrollHeight/height implementation. No deletion performed. |
| `FE-003` | `src/frontend/web/src/query/mutations/useUpdateChat.ts` — `useUpdateChat` | Generic chat-patch hook has no current consumer in exact symbol search; it remains linked to a valid generated API and may be useful in future rename/edit work. |
| `FE-002` | `src/frontend/web/src/ui/animas/AnimaChipGroup.tsx` — `AnimaChipGroup` | Isolated generic chip component; exact symbol search finds definition only and no route consumer. |
| `DYN-001` | `src/backend/animama/server/app.py` — `load_anima_config startup callback` | Startup imports missing animama.configs.loader, constructs old singular anima/configs path, and falls back to writing anima_cfg=None. Targeted source search found only these state writes; candidate still requires checking extension consumers. |

These eight entries are reviewed leads, not approved removal patches. Examples
of required follow-up are ownership/Anima tests for `require_anima`, model
validation tests for the private route helper, memory pause/resume tests for
the unused runner convenience method, and browser composer/layout checks for
frontend components. Preserve surrounding active services and APIs. Backend
removal verification must account for the existing assertion failure and Docker
setup gap from 0.1; an unrun test cannot establish preserved behavior.

The explicitly deferred discussion set includes legacy server voice and its
optional Compose service, old SST/AWS operational commands, archive API/data
and its sample population tool, optional document/content packs, platform
packaging targets, a one-time content normalization utility, and several UI
or tooling cases with unresolved product intent. Some are directly registered
or invoked today. Their removal would be a scope decision, not a consequence
of a scanner flag. Asset catalogs and persisted references need their own
consumer/provenance check before any byte deletion.

### Verification and handoff

Knip completed with exit 1 for findings. Python input validation passed and
Vulture returned exit 3 for findings. Frozen offline pnpm installation,
`pnpm check`, Python lock consistency, Ruff, formatting and diff checks passed.
Four disposable Python-helper checks covered ordinary findings, scope inclusion,
output privacy/overwrite protection, and syntax-error reporting. Ledger IDs,
referenced paths and reviewed evidence line bounds were validated during
consolidation. Existing package versions/resolutions were independently checked.

Application tests, builds, browser/native journeys and Docker startup were not
repeated for analysis-only tooling. The 0.1 baseline limitations remain. See
`scripts/repository-cleanup/README.md` for exact scan commands and interpretation.
The private records contain the full candidate ledger, scans, entrypoint maps,
suppression effects, dependency-lock audit and command evidence. At the 0.2 handoff, usage analysis was ready for review and removal work was
pending. No source removals or repository split had yet been performed. The
subsequent 0.3 work is recorded below.

## Step 0.3: Reviewed removals

Completed implementation on 2026-09-07 from clean commit
`3132ae298efe8e2abf8d85c3d969cfcf14fd0e2b` (`initial cleanup audit`). The user's
“phase 3” request refers to cleanup step 0.3, not the repository-export Phase 3.
No repository split, cloud command, remote change or publication was performed.

### Decisions and review coverage

All **1,612 previously unreviewed findings** now have source-backed decisions.
Across the original **1,659 records**, **177 were resolved by removal or export
cleanup**, **1,470 were kept**, and **12 received specific compatibility
deferrals**. Nine newly exposed scanner findings were also reviewed and kept,
bringing the current ledger to **1,668 records with zero unreviewed findings**.
Every finding in the final scans maps to a reviewed keep or defer decision.

These are finding counts, not unique files or deleted implementations. The 177
resolved records include **37 export modifiers** removed from otherwise live
internal helpers and **three type/re-export aliases** removed without removing
their underlying implementations. Repeated fields in one deleted class or
module can account for multiple resolved records.

The user approved removal of the unused `CloudStack` template and the root
SST/AWS operational tooling: six package commands, the SST dependency, the
remote database-bootstrap script and the Lambda/CloudFront permission-repair
script. The root package's private/license metadata remains. The separate
Persona CDK application and live environment handling were outside those named
retirements and remain unchanged. No deployed resources were administered.

The other **11 original explicit deferrals are now user-directed keep decisions**:
`useUpdateAnima`, the Pocket catalog builder, `BackgroundResizeModal`, root `tsc`
ownership, backend voice initialization, the optional Compose voice profile,
archive sample population, archive API/persistence, deferred feature packs,
Windows/Linux packaging groundwork, and the Included Action normalization tool.
Their source paths were verified unchanged against the starting commit. Keeping
them preserves their existing support/repair limitations; it does not establish
that currently unavailable features work.

### What changed

- Removed all eight initial candidates, after checking callers, framework and
  extension registrations, and their active replacements.
- Removed **27 unreferenced web files**, including the superseded PoseCreator
  workspace, unrouted Anima list page, unused preview/component wrappers and
  the original three frontend candidates. Shared pose primitives still support
  the typed Action editor. Removed **49 unused web declarations** and two
  re-export aliases. Web source changed by a net **6,991 physical lines removed**.
- Removed **32 backend/test code units**, including orphan type/shape helpers,
  preview wrappers, abstract mixins, fake-model/test helpers and unused
  constructor wiring, alongside the initial backend candidates. Backend/test
  source changed by a net **724 physical lines removed**.
- Removed the obsolete fixed principal-provider class and unused desktop timeout
  constant, and made 37 private tooling helpers/constants module-local.
  Corrected Knip coverage to include gateway tests under `server/tests`.
- Removed the newly orphaned `react-day-picker` dependency and its Vite prebundle
  entry, plus four now-unused transitive date packages. Remaining package versions
  and peer resolutions are unchanged. The package manager's unrelated optional
  peer changes were reconciled against the original lock and the frozen install
  passed.

The whole change deletes **32 tracked files**. Physical diff lines above include
comments/blank lines and are not the scc authored-code metric; the identical-rule
Phase 0.5 measurement is still required. No runtime asset payloads, generated
SDK/router code, or vendored speech internals were pruned. The deleted prompt-box
module did contain style-injection code; import/glob review established that its
module was unreachable, rather than assuming it was free of side effects.

### Remaining compatibility deferrals

The 12 new deferrals belong to three related decisions for step 0.4:

| Area | Findings | Remaining question |
| --- | ---: | --- |
| Browser telemetry | 8 | Four disconnected OTLP initialization modules and four legacy WebSocket metric functions need one coherent telemetry support/collector decision. Current metric/proxy behavior remains. |
| Backend event contracts | 3 | `AvatarBlendshapeSegmentPayload`, `DropPayload`, and `TELEMETRY_EVENT_TYPES` require cross-language event/subscription compatibility review. Removing the old motion transport does not itself retire its wire contract. |
| Structured-output model metadata | 1 | `_anima_helper_metadata` has no tracked reader, but dynamic Pydantic model introspection must be checked before dropping the attached metadata. |

Retained findings include framework callbacks, Pydantic/ORM fields, enum values,
pytest fixtures, protocol implementations, intentional component primitives and
coherent avatar/content module interfaces. A retained barrel export is an
intentional interface decision, not a claim that its particular export spelling
has a current importer. The ledger distinguishes these reasons.

### Validation and handoff

The final Knip scan reports **860 findings**; the final Vulture scan reports
**617 raw / 610 filtered findings**, with no syntax/read/stability errors.
Python scanned 515 inputs: three newly tracked cleanup scripts offset the three
removed Python files relative to 0.2. Seven callback exceptions remain unchanged.
A private copy of the Git index excluded exactly the 32 intentional deletions
for the Python scan; the actual Git index was verified unchanged. Two old Python
warnings disappeared while their code remained: one is now referenced by tracked
cleanup tooling, and the other's disappearance is unexplained. Neither was
counted as a removal.

Validation passed:

- Web, server, desktop and E2E TypeScript checks; web lint and changed frontend
  formatting; final diff check.
- **1,073 web tests**, **44 gateway tests**, **169 desktop tests**, **14 E2E helper
  tests**, and **31 E2E script tests**. Initial loopback-related sandbox failures
  passed on permitted reruns. The deleted page's source-layout test case was
  removed; the surviving page's assertions remain.
- Web/server production build, with the existing large-chunk advisory.
- **171 focused backend tests** and **three package traversal/revision tests**;
  both real content-package construction sites; byte-identical OpenAPI and ORM
  metadata before/after; Ruff. Twenty-three modified Python files passed format
  checks; two retain format failures independently confirmed at the starting
  commit (`content_package_service.py` and `content_package_helpers.py`).
- Frozen frontend dependency installation and preservation of remaining locked
  dependency versions/resolutions.

Broader backend selections passed 219 tests with 34 Docker setup errors (an
earlier selection passed 192 with 63 such errors). These selections overlap;
they are not added to the focused-test count. Docker's socket and the existing
Hono origin were unavailable. Live browser, gateway smoke, database-backed
journeys, native package acceptance and the full `make check-test` gate remain
unverified. The original 0.1 backend assertion failure was outside the focused
reruns and has not been claimed fixed.

Step 0.3 is ready for user review. Step 0.4 has the original user decisions above
and the 12 newly identified compatibility findings to resolve. Step 0.5 final
measurement, regression verification and the overall Phase 0 gate remain pending.
Detailed ledgers, source evidence, diagnostics and validation logs are retained
in private cleanup records outside the checkout.

### Follow-up: reported missing bone gizmo

On 2026-09-07 the user reported missing rotation rings in the Gesture editor's
Pose tab. The earlier automated validation did not include this visual journey.
The gizmo, avatar actor, active Action editor composition and visibility helper
are unchanged from the cleanup starting commit; remaining Three/Drei dependency
versions are also unchanged. This does not establish the cause of the report.

Once `http://localhost:3000` was reachable, a fresh desktop browser session showed
the rings after selecting Upper Chest. They also remained visible after Clip →
Pose, renaming the pose, and New Pose followed by bone selection. The running
application served compiled assets. The user's exact failure has not been
reproduced or fixed, and drag behavior was not verified. A focused rerun passed
36 tests across pose authoring, the pose store and timeline synchronization;
these tests do not establish visual correctness. Temporary diagnostic code was
removed without changing the gizmo. Keep the reported issue open for its exact
trigger and session state before claiming the Phase 0 visual regression gate.

Subsequent browser reproduction on 2026-09-07 confirmed missing rings on first
entering Pose, with Upper Chest selected and Apply to Clip disabled. Switching
Clip → Pose and selecting Upper Chest restored the rings. The user also reproduced
the failure after stashing cleanup changes and resetting the app. This supports
classifying it as a pre-existing issue; the precise root cause and a fix were
not established by this investigation.

## Step 0.4: Approved retirements

Reviewed on 2026-09-08 against `b51572a0`; the checkout advanced to `a450daf4`
during review with only planning-document changes. The user approved all five
R04 groups and amended R04-5 to delete the legacy Cloud source without a separate
archive. Runtime implementation and verification are recorded below. Existing
approved keeps remain in force. No AWS resources were changed.

### R04-1 — Remove disconnected browser exporter setup (four findings)

Approved scope: `src/frontend/web/src/lib/telemetry/client.ts`, `logs.ts`,
`trace.ts`, and `web-vitals.ts`. These modules have no active initialization path
from the current browser composition. Their package names in Vite's deduplication
configuration are not execution entrypoints. Remove direct dependencies and Vite
deduplication entries only when their final consumer disappears; use the owning
frontend package manager and preserve other locked versions.

The 13 direct web dependency candidates are `@opentelemetry/api-logs`,
`@opentelemetry/context-zone`, `@opentelemetry/exporter-logs-otlp-http`,
`@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation`,
`@opentelemetry/instrumentation-fetch`, `@opentelemetry/resources`,
`@opentelemetry/sdk-logs`, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/sdk-trace-web`, `@opentelemetry/semantic-conventions`,
`web-vitals`, and `zone.js`. Also remove stale Vite deduplication strings for
`@opentelemetry/exporter-metrics-otlp-http` and `@opentelemetry/sdk-metrics`,
which are not current direct dependencies. Keep `@opentelemetry/api`. Do not
assume every transitive dependency becomes orphaned.

Consequence: retire dormant browser log/trace/Web Vitals exporter setup, rather
than imply that those exports currently work. Keep the live instrumentation in
`metrics.ts`, enablement checks in `enabled.ts`, OpenTelemetry API trace context,
Hono's same-origin telemetry proxy, backend telemetry, and the optional Compose
collector. Instrumentation calls alone do not prove a configured browser exporter
is sending data. The Cloud plans still require privacy-safe observability; future
Cloud initialization should satisfy those requirements explicitly. Removing these
files does not cancel that product requirement. Git history provides recovery;
no duplicate archive implementation is recommended.

Verification after approval: recheck browser entrypoints and remaining package
imports, run Knip, frozen installation, `pnpm check`, `pnpm web:lint`,
`pnpm web:test`, `pnpm server:test`, and `pnpm build` from `src/frontend`.
Exercise a streamed chat and inspect browser/network errors; test that retained
gateway telemetry policies behave identically. Do not claim working browser
OTLP export from this cleanup's tests.

### R04-2 — Remove legacy WebSocket metric helpers (four findings)

Remove `recordWsConnect`, `recordWsDisconnect`, `recordWsReconnect`, and
`recordWsMessage` from `src/frontend/web/src/lib/telemetry/metrics.ts`, together
with their private `ensureWsMetrics`, counters and `UpDownCounter` type import.
There are no callers for this metric family. Preserve UI/SSE counters and their
current call sites. No WebSocket transport, voice feature, or avatar playback is
being retired by this decision, and no runtime assets are affected. Git history
is sufficient for recovery. Future Cloud transport metrics need their own live
instrumentation rather than these unused wrappers.

Verification: source-consumer search, Knip, frontend types/lint/tests/build above,
and the focused chat SSE tests. Instrumentation still used by UI/SSE must remain.

### R04-3 — Remove unused Python event declarations (three findings)

Remove only `AvatarBlendshapeSegmentPayload`, `DropPayload`, and
`TELEMETRY_EVENT_TYPES` from `src/backend/animama/domain/events.py`. Searches found
no producers, constructors, subscription registries, cross-language consumers,
or persistence mappings for these declarations. The current chat SSE dispatcher
handles supported response/emotion/gesture/error events, and the owner stream is
heartbeat-only; neither uses the tuple or proposed payload classes.

Keep `EventType` and all wire spellings, `AvatarBlendshapeFramePayload`, live
event classes, and `PyAnimaEventPublishRequest`. The latter still refers to
`EventType` despite having no registered route identified in this review. This
scope removes unused Python helpers without declaring their event identifiers
retired. An unknown external Python importer of these names would break; no such
consumer or named Cloud requirement was identified in repository evidence.
No package, data migration or asset deletion follows from this recommendation.
Git history provides recovery.

Verification: compare deterministic OpenAPI before/after and run
`uv run pytest -q tests/test_anima_sse_events.py tests/test_anima_chat_sse.py
tests/test_owner_events_sse.py tests/test_direct_chat_turn_executor.py` from the
root, plus the frontend `useChatSse.test.ts` suite. Expect identical event frames,
schema and persistence behavior. Broader runtime checks follow the 0.5 matrix;
unavailable database fixtures must be reported as gaps, not passes.

### R04-4 — Remove unused model class metadata (one finding)

Remove only the five-line `_anima_helper_metadata` assignment in
`src/backend/animama/app/main_structured_response.py`. This is the current target,
not `prompts/structured_output.py`. It attaches a normal Python class attribute
after Pydantic model creation. The sole executable occurrence is the writer; it
is absent from model fields, private-attribute registration, serialization and
JSON Schema. The model client receives a generated schema dictionary rather
than this class attribute. No separate Cloud role was identified.

Keep the adjacent `_anima_runtime_gesture_ids`: it has a live dynamic reader.
Keep actual schema metadata, constants, helper interfaces, model builders and
provider request behavior. Consequence: only custom Python introspection of
this unused attribute disappears; schema/response behavior should remain equal.
Git history provides recovery; no archive, migration or generated SDK edit is
needed if the schemas remain identical.

Evidence gathered during review: with installed Pydantic 2.12.5, removing the
attribute in memory and forcing model rebuild preserved schemas, TypeAdapter
schema, strict provider schema, prompt text, model inventories, validation,
serialization and extra-field rejection. An in-memory factory wrapper removing
the attribute for each new model passed 146 tests across
`tests/test_main_structured_response.py`,
`tests/test_direct_chat_turn_executor.py`, and `tests/test_model_client_registry.py`.
No tracked source was modified for this probe. After an approved actual edit,
rerun those tests and schema comparisons against that edit. Live providers,
external/private importers, frozen packages and browser behavior were not tested
by the offline probe.

### R04-5 — Remove the remaining legacy cloud application without archive

The user approved deletion of all 19 tracked files remaining under `cloud/`,
explicitly replacing the proposed private archive with complete active-tree
removal. Those files have been removed. No separate archive was created;
private Git revision `a450daf4` preserves historical source provenance. The
removal record contains paths and checksums, not a copy of the deleted source.
Ignored local files, credentials, environments and CDK outputs were not included
in this tracked-source removal.

The removed application built the absent `src/webui` path and launched old
`persona.server` modules. Its README described obsolete Next.js SSR, identity,
database and deployment assumptions. The hosted plan now records retirement
as settled and points historical review to private Git history. Future Cloud,
identity, Discover and portable-contract plans remain active.

Consequence: obsolete CDK commands cease to be an active tracked deployment
option. No deployed service, data, secret or AWS resource was changed. No
`cdk deploy`, `cdk destroy`, synthesis or history rewrite was performed.
Verification accounts for the 19 paths, checks build/CI/package references and
reruns cleanup inventory checks. A separate archive/restoration gate no longer
applies because the user explicitly chose deletion without an archive.

### Kept and deferred scope

Keep the 11 original user-directed keep groups, live telemetry and
wire compatibility surfaces above, and all active Cloud/identity/Discover plans.
Defer browser observability reimplementation, wire identifier/API
retirement, infrastructure administration and general architecture refactoring
to their owning plans. These are boundaries of this cleanup, not another batch
of unreviewed scanner findings. R04-1 through R04-4 cover all 12 pending scanner
records; R04-5 is the separate directory disposition required by the ExecPlan.

The user approved R04-1 through R04-5, with R04-5 amended as above, then
requested the 0.4 commit and execution of 0.5. Final evidence follows below;
the Phase 0 user verification gate remains pending.

### Actual implementation and verification

Implemented all approved groups on 2026-09-08: 23 tracked files deleted (four
browser exporter modules and 19 legacy Cloud files), the four WS helper exports
and their private counters removed, three Python event declarations removed,
and the five-line metadata assignment removed. The backend edit deletes only
42 lines across two files. A newly orphaned `isWebUiTelemetryDisabled` export
was made private; its implementation still serves the retained tracing flag.

Removed 13 direct web dependencies and 15 Vite deduplication entries. The lock
diff contains 356 deletions only: 28 package records and 28 snapshots removed;
all 1,203 retained package records, 1,204 retained snapshots and remaining
importer entries are identical. Initial offline resolution lacked cached
registry metadata; bounded pruning of the existing graph, owning-pnpm lockfile
validation and frozen offline installation established the final consistent
removal-only graph. No unrelated version or peer-resolution updates remain.

Validation passed against the actual edits:

- 232 distinct selected backend tests, including event/chat/owner SSE and model
  schema/executor/registry coverage. The initial run passed 199 and encountered
  33 Docker fixture permission errors. The authorized chat-file retry passed
  all 81 tests, resolving those 33 errors; overlapping tests are counted once.
- Byte-identical OpenAPI (258,620 bytes) and model/event contract snapshots
  (11,094 bytes), including strict schema, validation/serialization, prompts,
  retained enum values and payload field definitions. No client regeneration.
- 1,073 web tests across 207 files and 44 gateway tests across six files.
  Initial localhost-bind restrictions were resolved by authorized reruns.
- Web/server/desktop TypeScript checks, web lint, web/server production build,
  scoped Ruff, changed frontend formatting and diff whitespace checks. The
  final export-only cleanup also passed the web type check. Production build
  retains the large-chunk advisory.
- Owning-pnpm lock validation and final frozen offline dependency installation.
- Four cleanup inventory helper tests, with pinned scc and no skips.

Refreshed the main checkout's existing `animama` Compose project by restarting
only `web` and `animama-server`. The production web build completed. The browser
opened the configured Anima at `http://localhost:3000`, submitted a short cleanup
verification greeting, displayed Hello!, and retained both messages and the chat
title after reload. No browser console errors were captured; the VRM look-at
proxy auto-creation warning remained. The test chat is named Cleanup Verification
Greeting Request. FastAPI, Vite and PostgreSQL remain private; no optional profiles
were enabled or deployed resources administered.

This is not native desktop, audio-listening, collector delivery or full backend
acceptance. Browser OTLP export remains deliberately unclaimed, and the prior
gizmo defect was not re-investigated or fixed. Final same-rule LOC measurement,
broader supported-journey verification and the full Phase 0 gate belong to 0.5.

Fresh scans report 851 Knip findings (down from 860) and 621 raw / 614 filtered
Vulture findings over 518 Python inputs. Knip has no unresolved imports or
remaining telemetry candidates. Vulture reports no input or stability errors;
the disposable analysis index excluded exactly the 23 approved missing files,
and the actual Git index was unchanged. Compared with the prior scan, 14
already-committed Python inputs were added and 11 Cloud Python files removed.
The changed totals therefore include intervening work, not just these retirements.

The 13 newly exposed Python records were reviewed: eight retained event/frame
contract records remain explicit keeps, three Alembic revision metadata fields
are framework keeps, and two `finalize_package_install` method declarations
(content-store port and filesystem adapter) are deferred to their owning Local
content mutation refactor. No callers were found for those two methods, but
retiring that recently changed recovery contract is outside the approved R04
scope. The original 12 compatibility deferrals are resolved by the approved
removals. The two new, specifically owned deferrals remain visible for 0.5 and
their owning Local content mutation work; they are not blanket unreviewed
scanner output. Broad pre-split refactoring is a user-deferred optional backlog.

The reconciled ledger contains 1,681 records: 1,484 keep, 195 removed and two
specific deferrals. The original 12 approved targets, five fields nested in the
removed payloads, and one previously retained export modifier account for 18
additional resolved records since 0.3. Eleven of the 13 new Python records are
keeps and two are the deferrals above. Every current raw finding maps to a
reviewed disposition. Private test logs, snapshots, scans and ledger evidence
were retained outside the checkout with 69 verified file hashes; no Cloud
source archive was created.

## Step 0.5 — Final measurement and verification (2026-09-08)

The user-requested 0.4 commit is `bf72160a8014e9749ad576ace0d38cd6496c354b`
(`refactor(repo): retire approved phase 0.4 legacy code`). Final size measurement
used that clean snapshot and the original `before-v2` baseline at `7da4c7be`.
The scc 4.0.0 binary, wrapper and classification/ignore rules have exactly the
same hashes. Both inventories are complete and stable. The after snapshot
accounts for 2,873 tracked files: 2,150 measured text files and 723 byte-only
files, with no missing inputs or LFS pointer errors.

| Category | Before code lines | After code lines | Change |
| --- | ---: | ---: | ---: |
| Authored source and tooling | 263,851 | 256,895 | -6,956 (-2.64%) |
| Tests and fixtures | 74,990 | 76,794 | +1,804 |
| Generated code | 16,352 | 16,352 | 0 |
| Vendored code | 4,690 | 4,690 | 0 |
| Documentation/configuration text | 143,046 | 145,643 | +2,597 |

Runtime assets remain 717 files and 1,334,879,969 bytes. Generated and vendored
file counts and bytes also remain identical. The inventory has 55 deleted and
33 added paths, a net reduction of 22 files. This includes intervening work;
it is not a claim that cleanup itself added all 33 paths.

Per-commit counting with the same rules reconciles the authored delta exactly:
0.3 removed 7,158 lines and 0.4 removed 1,114, for **8,272 removed authored
lines**. Cleanup analysis tooling added 427; the separately committed Local
content mutation refactor added 889. Thus -8,272 + 427 + 889 = -6,956. The
increase in tests includes the mutation refactor's coverage. Counting comments,
blank lines or Git diff deletions would produce different numbers.

The largest authored directory reductions are frontend web (-6,942) and legacy
cloud (-686); backend domain/server/prompts reduce by 189/71/24 respectively.
Mutation work increases backend adapters/app by 550/185. Full per-file,
directory, language and commit attribution is in the private measurement
records; overlapping ancestor directory rollups must not be summed.

Another task committed `1393ff52` after the measurement stability window. Its
only change is the architecture-review skill document; it does not change any
authored/runtime/test input. The size snapshot explicitly excludes that later
document edit and this final report's own text. All 518 Python scanner input
hashes were rechecked after that commit and remained identical.

### Final findings and bounded follow-through

Fresh Knip 6.34.0 reports 851 findings and no unresolved imports. Fresh Vulture
2.16 reports 621 raw / 614 filtered findings over 518 stable Python inputs with
no input errors. Both finding sets are identical to the final 0.4 sets: no new
or disappeared records. The seven narrow Python callback exceptions remain
unchanged. Every current raw record maps to the reviewed ledger: **1,681 total,
1,484 keep, 195 removed, two defer**. The 1,612 findings initially left for
review in 0.2 were reviewed in 0.3; none remain in an unreviewed bucket.

The two remaining deferrals are `finalize_package_install` in the ContentStore
port and filesystem adapter. No caller was found, but they belong to the
separate Local content mutation recovery work. Its owner should reconcile or
retire that contract within that work's verification, with the explicit
annotation carried into Phase 1's inventory if still outstanding. General
module refactoring remains optional and deferred by the user, not a condition
for starting the split. Live telemetry, wire compatibility, the 11 original
user-directed keep groups and active future Cloud plans remain kept.

A bounded reference sweep found no live references to the approved removed
symbols/dependencies outside historical cleanup/plan records. The 0.4 lockfile
already removed the newly orphaned packages without changing retained versions.
No further runtime edits, upgrades, generated-client edits or asset deletions
were justified in 0.5. Current prose was reconciled with the user's broad
refactoring deferral.

### Final automated matrix

| Check | Result and boundary |
| --- | --- |
| Full backend `make -k check-test` | Typed-content audit and Ruff lint pass; aggregate remains non-green for the inherited failures below. |
| Full backend pytest | 1,216 passed, two failed, one live-provider test skipped; Docker fixtures available; 165.69 seconds. |
| Backend formatting | 34 files would reformat: 33 original baseline offenders and one changed by intervening `b51572a0`; no cleanup additions. |
| Mypy 1.18.2 | 11 errors in six files, identical original/pre-0.4/current output; checking stops early, so full type coverage is not established. |
| Web tests and lint | 1,073 tests / 207 files pass; lint passes. |
| Desktop tests and build | 169 tests / nine files and desktop build pass. |
| E2E tooling | TypeScript check, 14 helper tests and 32 script tests pass; this is tooling coverage, not browser E2E acceptance. |
| Web production build | Passes, including final web type check; existing large-chunk advisory remains. |
| Gateway, combined types and frozen install | Reused successful 0.4 evidence for identical inputs: 44 gateway tests, gateway build, web/server/desktop types, final frozen offline install. |
| Root stack syntax/configuration | `bash -n reset.sh` and `docker compose config --quiet` pass. |
| OpenAPI/model contracts and inventory helper | Byte-identical 0.4 snapshots and four passed inventory tests reused; relevant inputs unchanged. |

Both backend pytest failures reproduce on the original pre-cleanup `7da4c7be`:

- `tests/test_emotions.py::test_normalize_avatar_vfx_ids_dedupes_and_enforces_region_rules`
  omits `angry` and `emote_!` from accepted IDs. The original isolated test with
  its exact original catalog reproduces the assertion already reported in 0.1.
- `tests/test_anima_starters.py::test_real_shipped_included_content_can_materialize_both_starters`
  raises `runtime admitted item IDs must be catalog UUIDs`. It is order-dependent:
  an isolated replay passes, but an exported original ordered Anima prefix
  reproduces the same failure after 213 passes. Earlier unavailable Docker
  fixtures obscured this original baseline failure.

The 34 formatting offenders are byte-identical to pre-0.4; original `7da4c7be`
had 37 offenders, and `b51572a0` fixed four and introduced one. Mypy reports
optional dependency/stub problems, retired `domain.agent` imports and duplicate
test support modules. Its output matches the original snapshot byte-for-byte.
The environment lacked a mypy executable, so the exact locked cached version
ran through the existing project interpreter with a private temporary cache;
no package/environment or source changes were made. These inherited failures
are not passes and were not repaired as unrelated cleanup. No cleanup-induced
backend regression was found in this matrix.

### Browser observations and remaining acceptance

The main local app remains at `http://localhost:3000` in Compose project
`animama`, with FastAPI, Vite and PostgreSQL private. No additional restart or
profile change was needed in 0.5. A fresh browser session reached the ready
installation without an account login, opened the existing memory file explorer
and rendered `profile.md`, selected Caitlyn and rendered her avatar, and opened
a healthy library reporting 355 content items ready. In the library, the saved
`cheering` gesture preview reached Ready; Replay with Loop visibly animated
Caitlyn with raised arms and the Playing state. Stop returned the preview to
Ready. The existing Cleanup Verification Greeting Request chat still displayed
the original prompt and Hello! after navigation. The 0.4 fresh streamed response
and reload-persistence evidence is reused for unchanged chat inputs. No browser
console errors were captured. No existing user content was edited or deleted.

These checks do not establish microphone capture, audible TTS quality, native
window/installer behavior, collector export delivery or Local content mutation
crash recovery. Runtime speech assets and native implementation were not changed
by the approved 0.4 removals; desktop tests/build and unchanged asset inventory
provide bounded evidence, not listening or native acceptance. The previously
confirmed Pose gizmo initialization bug remains an explicit baseline defect;
no fix or passing fresh-Pose visual acceptance is claimed.

Phase 0 remains pending user verification. Review the counts and decisions,
confirm the affected everyday local journeys, and either verify or explicitly
waive the remaining human audio/native checks before Phase 1. The separate
Local content mutation work retains its own Save/edit/reload, Delete and Import
verification gate. No repository split, remote creation, push, deployment,
history rewrite or publication occurred. The requested 0.4 commit is complete;
0.5 report changes were initially left uncommitted for review. The subsequent
approved documentation retirement below includes these verification records in
the user-requested documentation commit.

### Knowledge graph and private evidence

The Understand Anything graph was refreshed through its full pipeline and
published at 2026-09-08 16:02Z: 2,608 covered files, 9,532 nodes, 22,114 edges,
10 layers and 15 guided-tour steps. All 2,543 detected internal imports are
represented. Full schema, coverage, assembly, architecture/tour and fingerprint
checks pass, with no dangling edges, duplicate IDs, extra file paths or file
nodes for the approved deletions. There are 482 isolated-node warnings; inventory
assets and documentation can legitimately have no edges. A supplemental strict
incremental checker did not pass automatically: 14 retired symbols were marked
unknown. Each was independently corroborated against current source and deletion
diffs; the full graph review records that manual resolution separately.

The old baseline exceeded the incremental tool's structural-change threshold.
The full run freshly scanned structure/imports and analyzed changed files;
2,469 unchanged-file descriptions were reused only with identical content hashes.
Explicitly excluding binary `**/*.onnx` avoids an attempted UTF-8 read of a
multi-gigabyte model. This graph-specific exclusion does not affect the scc
tracked-file and byte accounting above. The graph remains ignored under `.ua/`.

Graph metadata records `1393ff52` plus the exact dirty report/ExecPlan hashes
captured during analysis. The final count/evidence paragraphs added after
publication are disclosed documentation drift; no application source changed,
and fingerprints are not falsely advanced to claim those final prose edits
were analyzed. The previous graph stayed intact until the new graph validated.

Private 0.5 evidence is retained in the maintainer-held cleanup audit archive
(`2026-09-08-phase-0-5`), with a SHA-256 manifest covering measurement, reconciled ledger, backend baseline reproductions,
frontend checks, browser observations and the published graph. Temporary source
exports, caches and old graph backups are excluded. The original before-v2
baseline remains in the sibling 2026-09-07-phase-0-1 evidence directory. No
deleted Cloud source archive was created. Phase 0.5 is ready for user review;
the Phase 0 acceptance gate above remains open.

## Approved documentation retirement — D1–D4 (2026-09-08)

After reviewing the legacy documentation audit, the user approved all four
groups and the accompanying guide/link corrections, and requested a commit.
The reviewed allowlist contains 46 Markdown files and 26,757 physical Markdown
lines. Every file's SHA-256 matched its reviewed version before deletion.

| Group | Removed files | Removed Markdown lines | Disposition |
| --- | ---: | ---: | --- |
| D1 | 30 | 17,228 | ExecPlans with last substantive activity before 2026-07-08. |
| D2 | 8 | 5,944 | Superseded account, R2/Asset, Cloud split, playback and browser-seed plans. |
| D3 | 4 | 3,338 | Obsolete frontend migration, context-provider, desktop and STT implementation narratives. |
| D4 | 4 | 247 | Parallel legacy database/migration guides and retired Avatar-release API documentation. |

The age policy uses substantive Git history and document decisions, not file
modification times or the newest date mentioned in an example. Three D1 plans
had only route-name replacements after the cutoff. D1 also includes the three
unstarted usage-energy, pose-fit and IK proposals identified to the user before
approval. Their removal retires those plan documents; there is no implied
implementation, new backlog entry or claim that their features shipped.

Meaningful recent amendments preserve the memory-hardening, memory-filesystem,
animation-packs and procedural-animation plans. Recently active work, the
current split/accountless/desktop/identity/Discover plans, Local content mutation
verification, third-party attribution and the user's bug/journey backlog remain.
The typed VFX dependent-update proposal remains deferred for an explicit decision
about its product intent and current editable-catalog design.

Retained guides now point to current catalog Save, registered-byte delivery,
direct chat, planner/executor, frozen migration and accountless operator
contracts. Database seed guidance is preserved in the backend development guide.
Navigation and references to deleted documents are removed or retargeted with
their surrounding claims corrected. Current feature and operational guides
remain authoritative; historical records remain recoverable from Git without
creating a separate source archive.

This batch changes documentation only. The authored-code measurement above
remains the explicit bf72160a snapshot; these Markdown removals must not be
added to its code reduction. The published knowledge graph predates this
documentation retirement and does not represent the final documentation
inventory; its source-analysis snapshot and validation remain historical
evidence, not a claim of post-retirement graph freshness.

Documentation-generator checks passed before and after editing (12 tests).
The final link/reference scan covers 237 retained tracked Markdown files,
including agent-skill documentation outside the original product-doc inventory:
no new broken local links, dangling deleted-document references or tracked
source/config dependencies on the removed files. Five pre-existing missing
mockup-image links remain. The frontend Avatar guide is retained and must not
be confused with the deleted backend page sharing its basename. The diff
contains exactly the 46 approved deletions and Markdown-only guide/report edits;
`git diff --check` passes. No runtime tests, app restart or source changes were
needed for this batch.

The audit, allowlist with pre-deletion hashes, final checks and commit receipt
are retained in the maintainer-held cleanup audit archive
(`2026-09-08-doc-retirement`).
Phase 0's user-verification gate remains open; approval to commit this
documentation batch does not start Phase 1 or waive audio/native acceptance.
