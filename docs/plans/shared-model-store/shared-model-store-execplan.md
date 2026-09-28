# Shared voice model objects and optional downloads

Source agreement: [issue #188](https://github.com/raymond-van/animama/issues/188),
updated **2026-09-28T18:11:45Z**. The issue includes R1–R12 and A1–A11 and
is the single authoritative spec. Owner authorization on 2026-09-28 covers all
six implementation phases. [ADR 0010](../../adr/0010-shared-model-object-distribution.md)
records the shared distribution and optional-asset direction.

Status: **Implementation authorized, Phases 1–6**, by the owner on 2026-09-28.
The revised voice-download plan is accepted. Model/app publication and exact-
candidate merge remain separate existing gates. Workspace setup fast-forwarded
this branch to merged PR #195, `f89d3ed33012a19d7647ebe34dc6a5094104de06`.
Its final version adds reusable named clones and Anima-creation voice selection;
preserve those behaviors. The owner confirmed preserving saved-clone/source-sample behavior; only pending
encoder-download samples remain in memory. No product questions remain.

## Purpose and context

The two desktop Parakeet packs and self-host base acquisition will consume raw,
pinned objects under `downloads.animama.ai/models/`. Desktop retains its pack
lifecycle and signed-app catalog; self-host retains explicit setup and its
offline verified cache. Required notices travel with each model inventory.
An app release may publish missing objects, and unchanged models are not
uploaded again for a later app version.

Pocket generation remains bundled with **Eve and Azelma only**. Every other
catalog voice is an individual optional download, including recommended voices.
The Mimi voice-cloning encoder is a separate optional download, offered when
cloning is first requested and available in setup/settings. Desktop setup offers
simple Download buttons with sizes and progress; skipping them still completes
setup. The same installed state and actions remain reachable in the respective
voice settings. Downloading a component does not select a provider or enable a
feature.

Use the assigned task worktree on `build/shared-model-store`, starting from
`623b4d38442ccb7ef644432ce84797d3beb9e452` (also the inspected local
`origin/main`). It was clean and detached before creating this branch. Keep
one branch and PR for this plan. No stack was started for planning. Commands
below run from the repository root unless a working directory is specified.

Code packs, non-model content packs, other model families, changing speech
engines/provider defaults, and legacy preview compatibility remain outside scope.
The changed Pocket bundling policy is explicitly in scope. No Cloud repository
changes or new backend base-Parakeet download UI/API are needed. Shared Pocket
asset delivery also works on self-host, but its onboarding and explicit base
Parakeet acquisition stay as they are; hosted Cloud delivery remains separate.

### Agreed voice scope and proposed UI contract

The following IDs extend #188 when its spec is synchronized; they record the
owner's decisions plus the observable implementation contract proposed here.

- **R9 — Two bundled voices.** Ship only `eve` and `azelma` voice states with
  the Pocket generation models. Retain every other catalog voice and its
  recommendation metadata, but deliver each separately through `/v1/model-assets`
  from its pinned R2 object. A recommendation affects discovery, not bundling or
  automatic download. At the inspected revision this is 2 bundled and 36
  downloadable voices, moving 13 formerly bundled states.
- **R10 — Optional cloning.** Remove `mimi_encoder.onnx` from required browser
  and desktop assets. Offer its catalog-sized download before the first cloning
  operation; encode only after verified installation. Normal speech generation,
  starter voice playback, settings entry and Pocket warmup work without it and
  never request it. The input sample stays local; retain it in memory while the
  initiating view remains alive, or ask for reselection after reload. Preserve #195’s saved named clones and local source-sample previews; pending
  encoder downloads add no new sample persistence.
- **R11 — Optional desktop setup.** Replace the install-on-Continue speech
  checkbox with direct, optional Download actions for CPU recognition, the
  compatible GPU enhancement, individual additional voices and cloning. No
  optional model is requested merely by opening setup. Continue never requires
  a model download to start or finish. Preserve required display name, adult
  confirmation and credential save/discard rules across installation reloads.
- **R12 — Settings and recovery.** The same downloads are available later in
  their voice settings, with authoritative installed/progress/error state,
  cancel/retry and safe removal. Downloading alone never changes an Anima's
  voice, selected provider or GPU preference. Opening/filtering a voice list
  does not fetch its model states; explicit voice selection retains the current
  single-voice install/fallback semantics. No bulk recommended-voice download.

Proposed compact setup presentation (use actual catalog sizes, not these labels
as hardcoded byte counts):

| Choice                   | Setup action                                                                                   | Later entry point                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Eve and Azelma           | Shown as included; no download button                                                          | Voice picker; retain each starter's explicit assignment           |
| Speech recognition (CPU) | Download speech recognition                                                                    | App Settings → Voice → Speech-to-Text                             |
| GPU speech enhancement   | Separate Download GPU encoder, only for supported devices/catalogs; requires installed base    | Same Speech-to-Text section                                       |
| Additional Pocket voices | Compact picker/list with a Download action per voice; recommended filter is optional discovery | App Settings → Voice → Text-to-Speech and the Anima voice picker  |
| Voice cloning            | Download voice cloning                                                                         | App Settings → Voice → Text-to-Speech and the cloning entry point |

Do not turn setup into a 36-item mandatory checklist or a generic pack catalog.
Share the existing voice picker when available; install-only actions do not equip
voices. Show GPU prerequisites beside the disabled action and link to the CPU
control on the same surface. Do not silently fetch CPU when GPU is clicked.
Previously installed GPU files remain removable if capability later disappears.
Keep general pack recovery for retained/excluded packs, but make the Voice
settings sufficient for normal speech installation without visiting General.

All new buttons show readable download size, progress and retry/cancel states.
Reserve detailed disk/compatibility errors for when actionable. Distinguish
network completion from verified availability. Continuing setup must preserve
ongoing work and expose its state in Settings, with no forced provider switch.

The [voice Loadout change, PR #195](https://github.com/raymond-van/animama/pull/195)
overlaps `voices.py`, the generated catalog, voice pickers and starter defaults.
It merged as `f89d3ed33012a19d7647ebe34dc6a5094104de06` and is now integrated
on this branch. Reconcile the new named-clone and creation entry points in Phases 4–5. Preserve preview
URLs, recommendation/gender discovery, explicit Eve/Azelma starter assignments
and per-Anima provider semantics. Target the resulting **Loadout → Voices**
surface; do not restore the old Anima Settings layout or change the other branch.

### Added acceptance

- [ ] **A8 (R9):** Exact built browser and desktop inventories contain generation
      models plus only Eve/Azelma voice states. The other 36 voices each resolve a
      pinned downloadable asset; recommended voices are covered. Starter speech
      works offline from a fresh installation. No new voice states are encoded or
      existing states rehashed just to change delivery policy.
- [ ] **A9 (R10):** Mimi is absent from the default build. Ordinary TTS makes no
      encoder request. Explicit cloning from each entry point offers/downloads the
      verified encoder, then succeeds without an app restart. Cancel, offline,
      missing object and corrupt download do not break ordinary TTS. Concurrent
      callers share installation without one view cancelling another's work.
- [ ] **A10 (R11):** Fresh desktop setup can skip every optional download and
      complete normally. Each Download action exposes real progress; nonsecret setup
      input survives credential save/removal/retry and CPU/GPU activation/rollback
      without falsely completing onboarding. Pending credential edits are neither
      lost nor browser-persisted.
      Continue during a download reaches chat; Settings restores current status.
- [ ] **A11 (R12):** Skipped CPU/GPU, voices and cloning are downloadable in the
      respective Voice settings. GPU offering/dependency/fallback rules hold; download
      alone changes no provider/voice setting. Selection keeps the saved voice and
      existing per-run fallback behavior through failure. Cross-manager restart,
      cancellation/removal, reopening and device-support changes recover accurately.

At the inspected manifests, removing 13 voices plus Mimi removes **127,914,958
raw bytes**, reducing the browser runtime inventory from 35 files / 408,464,293
bytes to 21 files / **280,549,335 bytes**, before new metadata. These are planning
baselines, not release download sizes or RAM claims; regenerate and measure the
actual candidate, including separately bundled ORT variants.

### Source orientation

Paths are repository-relative; inspect their current contents on resumption.

- **Canonical inventories:** `models/parakeet-tdt-0.6b-v2/manifest.json` and
  `models/parakeet-tdt-0.6b-v2-webgpu/manifest.json`. The seven-file base set and
  three-file WebGPU set include `ATTRIBUTION.md` and `README.md`.
- **Acquisition:** `scripts/models/parakeet.py`, `parakeet_webgpu.py`,
  `browser_speech.py` and `pocket_voices.py`. The latter scripts share store
  helpers, so a global default change can unintentionally affect other models.
  `reset.sh` resolves verified paths offline; Compose/Vite consume those paths.
- **Desktop contracts:** `src/frontend/desktop/runtime/feature-pack.schema.json`,
  `feature-pack-releases.json` and
  `src/frontend/desktop/src/main-process/feature-packs/{catalog,download,files,manager}.ts`.
  Archive extraction and worker signatures remain in `extract.ts` and
  `signature.ts`.
- **Producer:** `src/frontend/desktop/scripts/runtime/feature-pack-build.ts`,
  `optional-inputs.mjs`, `model-publication.mjs` and `publish-models-r2.mjs`.
  Existing model staging is offline and includes a published `manifest.json`
  in addition to the model inventory.
- **Release:** the same script directory's `measure.mjs`,
  `release-artifacts.mjs`, `release-macos.mjs`, `publish-macos.mjs`,
  `publish-r2.mjs`, `r2-objects.mjs`, and
  `.github/workflows/release-desktop-macos.yml`. Build/test input acquisition
  also runs in `.github/workflows/validate-public.yml`.
- **Backend optional assets:**
  `src/backend/animama/resources/model-assets.v1.json` already pins the raw
  WebGPU encoder. Its downloader has a separate storage/lifecycle contract;
  do not replace it with the desktop pack manager.
- **Pocket projections:** `scripts/voices/{selection.json,voices.py}` generates
  the core voice manifest, published voice set, backend asset catalog, frontend
  voice catalog and notices, including `models/browser-runtime/manifest.json` and the packaged backend
  `pocket-voice-selection.json` added by #195.
  Update that generator's complete projections rather than manually pruning one
  output. Preserve pinned generation/VAD/Smart Turn/ORT inputs.
- **Pocket runtime:** `web/public/tts/workers/inference-worker.js` already loads
  Mimi lazily, but from a bundled URL. `web/src/hooks/use-pocket-tts-runtime.ts`,
  `web/src/lib/speech/pocket/core/PocketTTSCore.js` and the independent
  `web/src/lib/speech/pocket/catalog-builder.ts` are encoding entry points.
  Paths in this bullet are under `src/frontend`. The voice-authoring tool also
  opens Mimi from `browser_store()` today; it needs a separate explicit input.
- **UX/lifecycle:** `src/frontend/web/src/routes/setup.tsx`,
  `ui/sidebar/ApplicationSettingsModal.tsx`, `ui/settings/ExperimentalSettings.tsx`,
  `ui/settings/DesktopFeaturePacksPanel.tsx`, `hooks/useDesktopFeaturePacks.ts`,
  `hooks/use-pocket-voice-downloads.ts`, `query/hooks/useModelAssets.ts` and
  `query/mutations/useModelAssetActions.ts` under the same web source root.
  Desktop activation replaces renderers and
  restarts FastAPI; backend optional-asset downloads do not inherit Electron's
  resumable transfer semantics.

## Progress

- [x] Read the issue, current contracts and owner decisions; update and read
      back #188; prepare the task branch.
- [x] Draft ADR 0010 and this plan. Document checks and independent plan review
      are recorded under Planning validation below.
- [x] Phase 1: shared model references and transport contracts.
- [ ] Phase 2: verified per-file desktop installation.
- [x] Phase 3: self-host acquisition from shared objects.
- [x] Synchronize #188 with the accepted voice scope; integrate merged #195.
- [x] Owner confirmed preserving #195 saved clones and source samples; pending
  download input stays in memory.
- [ ] Phase 4: two bundled Pocket voices and optional cloning encoder.
- [ ] Phase 5: optional desktop setup and contextual settings downloads.
- [ ] Phase 6: release integration and current documentation (formerly Phase 4).
- [ ] Final integration review and local acceptance.
- [ ] Signed-native, real publication and speech checks recorded separately.

## Surprises & Discoveries

- Self-host base setup is `parakeet.py acquire`, not `/v1/model-assets`. The
  smallest change is its network source; moving base models into the backend
  downloader would add an unrequested runtime workflow.
- `model-publication.mjs` currently requires at least one backend catalog entry
  for every published set. Base Parakeet has none. Check actual consumers
  rather than manufacturing API catalog entries to satisfy that coupling.
- The desktop downloader already implements strong-ETag/range resume, bounded
  identity transfers and final SHA-256 checks. Generalize this transfer code
  rather than introducing a second downloader.
- Archive hashes currently determine installed-directory identity, active-pack
  equality, reported download size and disk budget. Replacing only the fetch
  step would leave these contracts incorrect.
- `expanded-included-content` is data-only but is not model data. Its deferred
  archive transport remains alongside the signed document-worker archive path.
- Current candidate builds deliberately do not contact the distribution, and
  publication is separate. Integrate model upload/verification at publication
  before exposing preview artifacts or promoting stable; keep build/stage
  commands offline with respect to distribution. Signing/notarization retains
  its existing external requirements.
- Full/cold-cache Validation CI also acquires base Parakeet. It needs the
  explicit upstream producer mode for reviewed build/test inputs; otherwise a
  new model cannot pass pre-release checks until it has already been published.
- Pocket already lazy-loads Mimi for cloning, but all builds still carry its
  39,768,446 bytes. Changing only UI or worker loading would not shrink the app.
- Setup currently starts its optional install only after saving onboarding.
  Direct download buttons expose the activation reload to unfinished form state.
  Preserve only nonsecret setup drafts, and keep existing unsaved-key guards.
- FastAPI shutdown cancels its optional downloads and discards staging. A pack
  activation during a voice/encoder download must be coordinated or recover as
  an explicit retry, never report a partial file as installed.
- The integrated #195 build hook reads `scripts/voices/selection.json`, but the
  Docker source stage omitted that input. Adding its explicit COPY repaired the
  observed editable-package build failure. The rebuilt backend and normal Compose
  readiness check pass (prerequisite commit `80eec359`). The first web dependency installation exceeded reset's
  readiness timeout; it completed without another source change.

## Decision Log

- **2026-09-28, owner, integration clarification:** preserve #195 saved named
  clones and installation-local source-sample previews. The new download wait
  keeps its pending sample in memory and introduces no extra persistence.

- **2026-09-28, owner, #188:** accept raw transfers and their larger size;
  publish notices and verify them in pack inventories; include self-host base
  acquisition; allow releases to publish missing objects; omit backward
  compatibility because no users depend on preview installs.
- **2026-09-28, planning choice:** retain the tracked model manifests as the
  identity source. Derive URLs in the existing producer and acquisition code,
  and check backend projections against the same files. A new catalog service,
  generic registry or cross-language download framework is unnecessary.
- **2026-09-28, planning choice:** add an explicit producer acquisition option
  to the base CLI, proposed as `acquire --source upstream`; ordinary base
  acquisition defaults to the Animama store. Preserve existing upstream/local
  provenance and use the same verified local cache for both modes. A missing
  object is an actionable consumer failure, not an automatic upstream fallback.
- **2026-09-28, planning choice:** give model transport a distinct strict schema
  variant and deterministic inventory identity; retain the archive variant for
  excluded packs. No old model-pack reader or migration branch is planned.
- **2026-09-28, planning choice:** a release publication invocation may cover
  its reviewed model sets and application artifacts together. Existing scan,
  source/licensing, native acceptance and exact-candidate publication controls
  remain; do not add a redundant per-model approval once that scope is approved.

- **2026-09-28, owner, voice scope extension:** bundle Eve/Azelma only; download
  every other Pocket voice individually; make cloning encoder optional on first
  use; keep CPU recognition optional and GPU separate/device-gated. Offer simple
  optional desktop setup buttons and later controls in respective settings.
- **2026-09-28, planning choice:** reuse the backend optional-asset manager for
  voices/Mimi and Electron's model-pack lifecycle for Parakeet. Share UI status
  presentation where useful, without inventing a universal installer. Keep
  Pocket generation bundled and all current speech engines/weights unchanged.
- **2026-09-28, planning choice:** add Pocket delivery and UX phases before the
  existing release phase. The original Phase 4 becomes Phase 6; all original
  acceptance gates remain.

## Phased implementation

Before dependent implementation, synchronize #188 and ADR 0010 as described
above and refresh the voice Loadout integration source. These are record updates,
not a new product decision or permission to execute releases.
Create linked phase issues only when implementation is authorized. Each starts
from the preceding integrated phase commit unless its dependency says otherwise;
record the exact SHA at execution. Phase issues cite #188 without redefining it.
After the smallest meaningful checks pass, conduct one full independent initial
review and at most two repair rounds per phase. Rechecks cover accepted fixes
and resulting regressions. Stop automatic progression if supported blockers
remain at that limit. Phase commits use `build(models)[pN]: ...` or another
repository type/scope that accurately describes the final change.

### Phase 1: Shared references, catalog variants and producer inputs

**Requirements:** R1, R2, R6, R7. **Acceptance:** A1, A6.
**Dependency:** plan accepted and implementation authorized.
**Issue:** [#197](https://github.com/raymond-van/animama/issues/197).
**Starting source/commit:** `a994400f`, the synchronized plan over integrated
base `f89d3ed3`.

1. Derive object keys from model ID, each file's SHA-256 and its validated file
   name. Preserve pinned provenance; avoid changing manifest bytes merely to
   duplicate derivable URLs, which would invalidate otherwise reusable local
   cache directories. If notice text changes, update its manifest/licensing
   records deliberately and record the resulting inventory review requirement.
2. Extend the strict pack schema/parser with an explicit model-files transport
   variant for the two Parakeet IDs. Keep common identity, app compatibility,
   dependency, inventory and license fields. Retain archive fields only on the
   archive variant. Reject unsupported IDs, mixed variants, unexpected fields,
   unsafe paths, duplicate destinations and invalid sizes/digests.
3. Seal the approved model origin and exact `models/<id>/<hash>/<name>` path
   rules in trusted catalog validation. Do not derive them from a renderer
   value or accept arbitrary hosts because app archives support another
   distribution. Keep archive URL policy separate, including GitHub-distributed
   app candidates whose models still live on `downloads.animama.ai`.
4. Replace archive-based identity for model installs with a deterministic
   digest of their complete ordered inventory, including notices and relevant
   metadata. Define it once for producer and consumer. Pack version and app
   compatibility stay explicit; partial work must not be reused for a different
   inventory. Keep existing archive identity for archive packs.
5. Update `feature-pack-build.ts` and `optional-inputs.mjs` to emit model-file
   descriptors and reviewed inventories without a Parakeet `tar.zst`. Preserve
   exact-input approval checks and null/pending approval behavior. Keep the
   published model `manifest.json` as publication metadata; it is not silently
   added to the exact seven-/three-file installed inventories.
6. Generalize `planModelPublication` to validate references from each real
   consumer: desktop catalog, base acquisition projection and existing backend
   assets. Require every reference to match a staged pinned object. Preserve
   validation of any backend references present without demanding an artificial
   base entry. Keep Pocket publication working.

**Checks (from `src/frontend`):**

```sh
pnpm desktop:test -- runtime-packaging.test.mjs feature-packs.test.ts publish-models-r2.test.mjs
pnpm desktop:check
```

Add contract cases for shared base URLs, notices, per-file key/size/hash drift,
mixed transport rejection, fixed origin/path restrictions, stable inventory
identity, missing backend base entries, and unchanged archive/code validation.
Assert no model archive is produced and catalog generation remains offline.

**Completion/recovery:** producer and parser agree, intended consumer references
are checked, and excluded packs retain their contract. Do not distribute an
intermediate candidate before Phase 2 supports installation. Regenerate ignored
stage outputs after any schema/inventory change; never edit signed catalogs or
invent approval hashes to make the producer pass.

**Evidence and remaining gates:** 155 tests passed across runtime packaging,
feature packs, model-pack contracts, optional inputs and model publication.
Desktop typecheck/build, bundled-import audit, targeted formatting, JSON Schema
fixtures and `git diff --check` passed. New contract tests failed before the
implementation and passed afterward; the publisher slice had seven red cases
then 22/22 passing cases. No model bytes or approval hashes changed. Actual
inventory review remains required when a produced inventory changes. Model
installation deliberately reports unsupported until Phase 2; no intermediate
candidate may be distributed.

#### Code Review #1 Findings

Independent analysis reviewed the frozen working-tree boundary over `a994400f`;
a separate check runner passed the desktop build and diff checks, reusing valid
focused test evidence. **P1-PUB-1:** the retained compressed base download ceiling
of 524,288,000 bytes rejects its unchanged 661,332,409-byte raw inventory. No
other concrete blocking findings, including the Docker build prerequisite.

#### Code Review #1 Revisions

**Accepted P1-PUB-1.** The raw download ceiling now equals the existing installed
ceiling (681,574,400 bytes). A contract test sums both canonical model inventories
against the real release budgets: it failed on the old base ceiling and passes
after the fix (4/4 focused contract tests). Independent targeted review #2 passed:
canonical totals fit both ceilings and no direct regression was found. One repair
round used; one remains. No model or approval identity changed. Phase 1 passed;
commit `5fd8554b` completes its implementation boundary.

### Phase 2: Verified desktop model-file installation

**Requirements:** R2, R3, R7. **Acceptance:** A2, A6.
**Dependency:** Phase 1 contracts. **Issue:** [#198](https://github.com/raymond-van/animama/issues/198).
**Starting source/commit:** pending execution; integrated base `f89d3ed3`.

1. Extract the existing archive transfer's URL/size/hash handling into an
   object transfer used by both transport variants. Preserve exact range and
   strong-ETag resume, byte bounds, identity encoding, trusted redirect policy,
   cancellation, no-follow writes and final hash verification. Do not weaken
   archive extraction or document-worker OS signature checks.
2. Download model files sequentially into pack-owned staging. Reverify completed
   files when retrying and retain valid partial-file metadata across network
   interruption and process restart. A mismatched range/ETag restarts that file
   safely. Remove corrupt partial bytes; never activate a partial inventory.
   Keep explicit cancellation semantics consistent with the current manager,
   without making cancellation remove an already active verified pack.
3. Assemble only the declared files with normalized modes, then run the full
   inventory verifier before atomic promotion and again at existing startup/
   activation checkpoints. Preserve dependency checks, transition barriers,
   service switch/rollback and removal leases. Do not add legacy migration.
4. Update manager equality, retained-install lookups and version-directory use
   to the new inventory identity. Update aggregate progress, download size and
   space requirements for raw staging and any actual copies; count retained
   partials consistently and avoid unsafe underestimates. Keep IPC limited to
   fixed pack IDs and existing actions.

**Checks (from `src/frontend`):**

```sh
pnpm desktop:test -- feature-packs.test.ts runtime-packaging.test.mjs
pnpm desktop:check
pnpm desktop:build
```

Exercise interruption within a file, process-restart resume, reuse of verified
completed files, range/ETag mismatch, wrong hash/size, extra/link/path entries,
insufficient disk, cancellation, dependency refusal, active-use removal leases
and rollback after a failed service transition. Tests must show that a prior
verified active pack remains usable after a failed replacement. Archive worker
signature and strict extraction fixtures must still pass.

**Completion/recovery:** the model path installs only a complete verified set
and preserves lifecycle behavior. Keep old active bytes until the normal atomic
transition commits; clear only task/pack-owned invalid staging. Signed-native
speech and lifecycle acceptance remains a separate end-to-end gate below.

**Evidence and remaining gates:** not run; source tests are not signed-app proof.

#### Code Review #1 Findings

Not started; record source, checks and stable findings.

#### Code Review #1 Revisions

Not started; two repair rounds available.

### Phase 3: Self-host base acquisition from the shared store

**Requirements:** R1, R2, R4, R6. **Acceptance:** A1, A5.
**Dependency:** Phase 1 reference contract; independent of Phase 2 runtime work.
**Issue:** [#199](https://github.com/raymond-van/animama/issues/199).
**Starting source/commit:** `5fd8554b`; runs independently of Phase 2 and 4.

1. Change ordinary `parakeet.py acquire` to derive the shared object URLs for
   all seven pinned files, including notices. Keep `verify`, `path`,
   `--offline`, `--import-from`, per-manifest locking and complete-set atomic
   promotion. Reuse unchanged verified caches without network access.
2. Add the explicit producer source option described in the Decision Log. It
   uses pinned upstream files and checked-in notices, with the same final
   verification and storage, and is never selected silently after a failed
   Animama request. Existing offline/import precedence remains explicit.
   Use that explicit mode for `.github/workflows/validate-public.yml`'s
   reviewed build/test inputs too, without publication credentials or uploads.
   Its cold-cache path must work before the base objects are published. Keep
   separate tests for normal shared-origin consumer acquisition.
3. Scope source selection to base acquisition. Preserve generic helper callers
   in `browser_speech.py`, `pocket_voices.py` and `parakeet_webgpu.py`; do not
   globally reinterpret their mixed upstream/release inputs. Reject an
   unexpected model origin, credential-bearing URL or unapproved redirect.
4. Keep reset, builds and serving offline with respect to model acquisition.
   Preserve `ANIMAMA_MODEL_ROOT`, resolved immutable directories and browser
   serving URLs. Adjust integration code only where needed by the source change.

**Checks (repository root):**

```sh
uv run pytest -q tests/test_model_store.py tests/test_webgpu_model_store.py tests/test_browser_model_store.py tests/test_model_assets.py tests/test_compose_network_boundaries.py
uv run ruff check scripts/models tests/test_model_store.py tests/test_webgpu_model_store.py tests/test_browser_model_store.py tests/test_model_assets.py tests/test_compose_network_boundaries.py
bash -n reset.sh
```

Use bounded fixture responses to prove all default requests target the shared
objects, missing objects do not fall back upstream, bootstrap avoids the
publication cycle, corrupted bytes cannot promote, and interrupted acquisition
retries safely. Preserve current self-host retry semantics; desktop byte-range
resume is not a new requirement for the setup CLI. Cover offline/cache/import,
locking, path safety and existing browser/Pocket/WebGPU transport behavior;
Phase 4 deliberately changes which Pocket files belong in the core inventory.
Also check the full/cold-cache workflow's command selection and an empty-cache
producer fixture with no published model objects, so CI cannot accidentally
depend on a prior model release.

**Completion/recovery:** setup uses the agreed objects and keeps existing local
contracts. Do not silently delete corrupt caches or another task's model root.
Use a fresh task-owned temporary root for network acceptance; retain any older
verified cache while consumers still use it. If notice changes alter the manifest
digest, verified offline import can reuse unchanged weights into the new set.

**Evidence and remaining gates:** the default acquisition test failed on the old
Hugging Face route, then passed after the shared-object projection. Explicit
producer/bootstrap and workflow tests failed before the source option/CI change
and passed afterward. The combined model store, WebGPU, browser store, backend
asset and Compose boundary suite passed 258 tests, with six native Windows-only
tests skipped on macOS. Ruff, scoped format checks, `bash -n reset.sh` and patch
whitespace checks passed. Existing generic helper callers retain their manifest
sources. Real public-object acquisition and browser speech checks remain pending
publication of the final inputs. No model objects were published.

#### Code Review #1 Findings

Independent analysis of the four Phase 3 source/test/workflow/document files
over `5fd8554b` found no concrete blocking issues. A separate check runner
confirmed the CLI source help, existing immutable base `path`/`verify` offline,
and the plan-scoped Ruff checks; existing 258-test evidence was reused.

#### Code Review #1 Revisions

No revisions required. Phase 3 review passed with both repair rounds unused.
The commit carrying this record completes the phase implementation; real
public-object acquisition remains an explicitly unperformed publication gate.

### Phase 4: Pocket core split and first-use cloning acquisition

**Requirements:** R5, R6, R9, R10, R12. **Acceptance:** A8, A9, A11.
**Dependencies:** Phase 1 references; reconcile PR #195 before editing shared
voice generation/runtime code. **Issue:** [#200](https://github.com/raymond-van/animama/issues/200).
**Starting source/commit:** pending execution; integrated base `f89d3ed3`.

1. Change `scripts/voices/selection.json` so only Eve/Azelma are core. Retain
   all voice identities, bytes, recommendation metadata and any reviewed preview
   URLs. Regenerate catalog/manifests/notices through `voices.py release`; do not
   hand-edit generated outputs. Update its browser-runtime projection and tests.
   Expect 36 optional voices, including the 13 moved states. Preserve the two
   starter assignments from the integrated Loadout work. Fix generator assumptions
   that recommendations imply core delivery or that inventories have 15/24/35
   members. Repeated generation from the same explicit inputs must be identical.
2. Remove Mimi from the required browser-speech/browser-runtime inventories.
   Give the unchanged pinned encoder its own model-set manifest/acquisition path,
   proposed as `models/pocket-tts-voice-cloning/`, and a fixed backend asset ID,
   proposed as `pocket-tts-voice-cloning-encoder`. Include reviewed attribution
   and notices, verify them in staging/publication, and expose their bundled text
   with the download control. Generate or mechanically check the catalog entry
   against that manifest. Keep the four generation models and support files core.
3. Extend the existing optional-input staging/publisher for the cloning set and
   expanded voice set; no new publishing framework or new Pocket feature pack.
   Preserve provenance and existing voice bytes. Maintainer `voices.py encode`
   and `screen` must resolve an explicitly acquired verified encoder separately
   from `browser_store()`. Neither normal builds nor voice catalog generation
   may silently acquire it. Use explicit upstream producer acquisition for the
   encoder and pinned/imported voice producer inputs before first publication;
   test cold-cache build/CI without any optional objects already public. Remove
   the generator's dependency on a fully populated previous-manifest store.
   Its current nonvoice `others` copy must not reintroduce Mimi, and its rewrite
   of `browser-pocket.external_files` must retain the optional encoder's source/
   licensing coverage under the new set. Existing 23 voice asset IDs/URLs stay
   stable; changed delivery alone never requires re-encoding or new hashes.
4. Add a focused install-before-encode helper over the existing backend asset
   service. Both ordinary custom-voice encoding and `catalog-builder.ts` must
   use it. Offer a Download action with size when the encoder is missing; after
   successful verification continue the requested operation if its caller and
   sample still exist. Otherwise show ready and allow a new sample selection.
   Pass the fixed same-origin `/v1/model-assets/<id>/content` URL to every Pocket
   worker; no upstream URL, arbitrary renderer URL or old bundled-path fallback.
5. Preserve lazy `mimiEncoderLoadPromise` initialization. Warmup, previews using
   installed voices, ordinary TTS and opening settings do not request the encoder.
   Model installation is shared/idempotent across views; closing/cancelling an
   encoding view detaches its waiter without removing another caller's download.
   Explicit global download cancellation remains available. Preserve usable
   already-loaded sessions or dispose safely on removal; the next new encoding
   request must recheck availability and offer reinstall, not use stale state.
6. Keep existing selected-voice persistence, fallback while missing/downloading,
   and per-run voice freeze. Download-only buttons install without changing saved
   voice/provider; intentional voice selection may retain existing install-on-pick
   semantics. Browsing, preview audio and recommendation filters cannot fetch
   voice-state models. Continue normal speech if an optional download fails.

**Checks (repository root):**

```sh
uv run pytest -q tests/test_voice_tools.py tests/test_pocket_voice_set.py tests/test_pocket_voice_catalog.py tests/test_browser_model_store.py tests/test_model_assets.py
uv run ruff check scripts/models scripts/voices tests/test_voice_tools.py tests/test_pocket_voice_set.py tests/test_pocket_voice_catalog.py tests/test_browser_model_store.py tests/test_model_assets.py
```

**Checks (from `src/frontend`):**

```sh
pnpm --filter animama-web test:source tests/browserRuntimeAssets.test.ts tests/speech/pocketRuntime.test.ts tests/speech/pocketVoiceDownloads.test.ts tests/speech/pocketVoiceFallback.test.ts tests/speech/pocketVoiceCatalog.test.ts
pnpm desktop:test -- optional-inputs.test.mjs publish-models-r2.test.mjs runtime-packaging.test.mjs
pnpm check
pnpm build
```

Add focused cases for the two-core/36-download policy, no optional bytes in build
outputs, unchanged voice hashes, new catalog/manifest binding, unpublished-object
producer bootstrap, separate maintainer encoder input, no eager downloads, every
encoding entry point, shared-waiter cancellation and remove/reinstall. Inspect
actual build inventories, not only metadata. Build checks need only verified core
inputs; focused encoding tests use bounded fixtures. Regenerate the SDK offline
and check it only if API shapes actually change.

**Completion/recovery:** generation and starter voices work without any optional
files, optional voices/encoder can install through the existing verified service,
and authoring/CI can obtain explicit inputs before publication. Keep old stores
and saved voice selections intact. Runtime first-use and actual sample/listening
checks remain separate from mock success. Nothing is published in this phase.

**Evidence and remaining gates:** not run; generated sizes and input approvals
must be recorded for the final candidate.

#### Code Review #1 Findings

Not started; record source, checks and stable findings.

#### Code Review #1 Revisions

Not started; two repair rounds available.

### Phase 5: Direct optional downloads in desktop setup and Voice settings

**Requirements:** R3, R9–R12. **Acceptance:** A2, A8–A11.
**Dependencies:** Phases 2 and 4; integrated/reconciled PR #195 UI contract.
**Issue:** [#201](https://github.com/raymond-van/animama/issues/201).
**Starting source/commit:** pending execution; integrated base `f89d3ed3`.

1. Prepare a desktop-width visual mockup for the compact setup section and
   respective Voice settings before substantial UI edits; use the established
   app styling. Follow the agreed table above. CPU/GPU are separate controls;
   individual voices use the resulting picker, and cloning has its own action.
   Download labels describe user capabilities rather than transport or pack IDs.
2. Reuse the existing desktop pack and backend-asset hooks with shared small
   controls where useful. Derive size, installed/progress/error and busy state
   from their owning managers after every mount/reload; component-local pending
   flags cannot stand in for global state. No bulk downloads or new generic
   pack marketplace. Preserve recovery/removal for retained/excluded packs.
3. Replace setup's checkbox with immediate actions. Preserve the unfinished
   nonsecret setup draft (display name and explicit adult-confirmation choice)
   as the fields change in a small, installation-scoped draft store. Credential
   save/removal/retry can replace renderers before a Parakeet install even starts;
   cover every setup-triggered renderer transition, not only pack activation.
   Clear the draft on successful setup. Restoring it never grants readiness;
   `completeOnboarding` runs only through valid Continue. Preserve owner identity
   and the `/setup` route after activation, rollback and retry while onboarding
   remains unfinished.
4. Preserve credential safety: do not persist unsaved API keys in browser state.
   Require existing save/discard handling before a transition-capable install,
   and prevent new unsaved credential edits during that install. Continuing
   setup stays independent of model completion and retains in-flight work;
   action state remains visible in Voice settings after navigation.
5. Coordinate pack transitions with backend asset work. Prefer a small shared
   busy/transition rule that serializes model actions offered by setup/settings;
   do not build a new generic job framework. A cross-window/racing restart must
   still reconcile backend cancelled/not-installed state and offer Retry. Never
   claim retained partial resume for backend downloads, delete installed assets
   on view unmount, or let a completed pack hide an interrupted voice download.
6. Reuse the WebGPU adapter/runtime-capability probe and approved catalog check.
   Offer GPU download only on supported devices, enable it only after base
   readiness, and preserve CPU fallback if GPU initialization fails. Do not chain
   CPU→GPU actions in a renderer callback destroyed by CPU activation. Keep
   installed GPU removal/recovery reachable after capability disappears.
7. Put CPU/GPU controls in App Settings → Voice → Speech-to-Text; voices and
   cloning in Text-to-Speech plus the resulting Loadout → Voices/clone entry
   points. The same installed assets serve all surfaces. Check keyboard use,
   readable progress/errors and narrow layouts after desktop-size validation.

**Checks (from `src/frontend`):**

```sh
pnpm web:test
pnpm check
pnpm web:lint
pnpm desktop:test -- feature-packs.test.ts
pnpm desktop:check
```

During iteration run focused setup/voice-picker/settings tests before the full
web suite. Cover skip-all, download-only versus select, Continue while busy,
form restoration across reload/rollback, name/age → key entry → key save → model
download without draft loss, unsaved credential guards, shared state
across setup/settings, cross-manager interruption, no-adapter/unapproved GPU,
base prerequisites, GPU runtime fallback and installed-but-unsupported removal.
Then perform browser checks on an isolated desktop-sized stack and the signed
fresh-profile acceptance below. A mocked browser desktop bridge proves UI only;
it cannot establish real renderer destruction or native installation.

**Completion/recovery:** setup is optional and direct; skipped features remain
accessible later without changing selected voices/providers. Existing drafts,
credentials and active verified models survive tested failures. Record the
mockup/browser evidence and every unperformed native or hardware check.

**Evidence and remaining gates:** not run; no implementation commit.

#### Code Review #1 Findings

Not started; record source, checks and stable findings.

#### Code Review #1 Revisions

Not started; two repair rounds available.

### Phase 6: Release publication, reports and current guidance

**Requirements:** R5, R6, R8; integration of R1–R12. **Acceptance:** A3, A4, A7–A11.
**Dependencies:** Phases 1–5. **Issue:** [#202](https://github.com/raymond-van/animama/issues/202).
**Starting source/commit:** pending execution; integrated base `f89d3ed3`.

1. Update release input acquisition, including the checked-in macOS workflow,
   so an unpublished base model can be acquired through the explicit producer
   mode. Staging/building stays separate from publication; no build script
   needs object-storage credentials or automatically uploads files.
2. Bind the release's required model-object list to its exact embedded catalog
   and packaged backend asset catalog, covering both Parakeet sets, all 36
   downloadable Pocket voices and the optional Mimi encoder with their notices.
   Stage each referenced set with `stageModelCandidate`. Retain staged
   candidates and their scan receipts through any build-to-publication artifact
   handoff. A notice, catalog, object list or payload change invalidates the
   corresponding evidence. Validate against the signed candidate's references,
   not merely whatever manifests happen to be in the current checkout.
3. At authorized preview/stable publication, validate application and model
   candidate evidence before reading credentials or writing objects. Call the
   existing model publication functions to upload missing objects and verify
   all references anonymously before uploading public app artifacts or making
   the release discoverable. Stable feed promotion remains last. Apply this
   dependency whether the app artifacts use R2 or the supported GitHub path;
   the model origin remains fixed.
4. Preserve scan gates, immutable/create-only writes, bucket existence checks
   and anonymous size/hash verification. Fail closed on absent/stale scans,
   unavailable or differing objects and a changed signed reference list. A
   partial failure may leave valid immutable models; retries reuse them.
5. Remove Parakeet archive collection from release artifacts and update
   `measure.mjs`, size reports and disk budgeting. Keep small catalog/notices/
   evidence outputs as appropriate, but no second raw or archived weight copy
   under `desktop/v<version>/`. Optional model objects stay outside per-version
   release directories; the approved core Pocket generation models and two voices
   remain legitimately inside the app. Verify the 13 moved voice states and Mimi
   are absent from core/starter closure/build outputs, not merely unreachable in
   the UI. Preserve excluded archive packs and existing publication gates.
6. Update useful current guidance in `docs/frontend/desktop/releases.md`,
   `release-process.md`, `runtime-staging.md`, `feature-packs.md`,
   `docs/backend/operations/model-assets.md` and `scripts/models/README.md`.
   Update relevant model notices only if they otherwise describe the wrong
   distribution. Include voice setup, per-voice download, first-use cloning,
   backend retry-versus-desktop-resume and maintainer encoder acquisition guidance
   in `docs/frontend/runtime/voice.md` and the model setup guide. Correct the old
   15-core-voice and total-size descriptions. Scope `src/frontend/AGENTS.md`'s archive-only instruction to
   archive packs and explain model inventory verification. Review source/license
   records when notice or inventory bytes change. Mark ADR 0010 accepted with
   the actual decision basis once its drafted record is agreed; implementation
   completion must remain a separate claim.

**Checks (from `src/frontend`):**

```sh
pnpm desktop:test -- publish-models-r2.test.mjs publish-r2.test.mjs release-scan.test.mjs runtime-packaging.test.mjs
pnpm desktop:test
pnpm desktop:check
pnpm desktop:build
```

With isolated fixture stores and mocked object APIs, prove: missing objects
upload once; a second app version with identical inventories causes zero model
PUT bytes; changed notices upload only changed objects/metadata; bucket presence
plus a stale public 404 never triggers a duplicate PUT; mismatches stop without
overwrite; model publication or verification failure prevents app-object uploads;
stable promotion occurs only after all required public bytes verify. A later app
upload failure may leave valid public app objects for a resumable retry while
the stable feed remains unchanged. Include stale-scan, altered-catalog,
preview, stable and alternate app-distribution coverage where applicable.

**Completion/recovery:** release orchestration and reports match the new
transport, local checks pass and current docs are accurate. No automatic CI
publication or new credentials are enabled by this task. If publication fails,
retain immutable model objects and the old feed; repair inputs or serving and
rerun the reviewed operation. Never overwrite a conflicting object or bypass a
scan to complete a release.

**Evidence and remaining gates:** not run. Publishing a real release and claiming
native acceptance still require the concrete candidate/evidence described below.

#### Code Review #1 Findings

Not started; record source, checks and stable findings.

#### Code Review #1 Revisions

Not started; two repair rounds available.

## Final integration review

Review the combined diff against the recorded baseline and #188, using still-valid
phase evidence. Recheck generated catalog identities, self-host URLs, exact
signed-candidate publication references, no duplicate weights in app-release
outputs, preserved archive paths and documentation. Use one independent initial
integration review and at most two repair rounds; do not reset review counts
when resuming this plan. Include the full voice scope: core inventories,
producer bootstrap, both cloning entry points, setup/reload recovery, settings
placement after PR #195 and unchanged provider/fallback semantics. Do not treat
Parakeet-only A1–A7 evidence as completion of A8–A11.

### Code Review #1 Findings

Not started. Record reviewer, exact source, checks and stable findings.

### Code Review #1 Revisions

Not started. Two repair rounds available; record fixes and reused evidence.

## Validation and acceptance

No implementation validation has been performed during planning. Run applicable
checks locally before pushing; hosted `Validation` and its actual scope remain
separate evidence. Do not use a reduced owner-reviewed receipt to substitute for
the native or publication gates of this release/security-sensitive change.

**Automated integration:** run the phase commands, then from the repository root
`uv run pytest -q`, `uv run ruff check`, and `make check-test` as applicable to
changed shared store/backend contracts. From `src/frontend`, run `pnpm check`,
`pnpm web:lint`, `pnpm web:test`, `pnpm build`, `pnpm desktop:check`,
`pnpm desktop:build`, `pnpm desktop:test` and `pnpm prettier:check` for the final
candidate. Reuse a passing result for unchanged source; do not repeat expensive
checks without a change or unresolved concern.

**Runtime production:** on the supported Apple Silicon host, from
`src/frontend` run:

```sh
pnpm desktop:runtime:stage -- --platform darwin --arch arm64
pnpm desktop:runtime:audit -- --platform darwin --arch arm64
```

These need verified inputs and applicable inventory approvals. Record produced
catalog identity, object list, model download sizes, peak space and the absence
of Parakeet archives. Staging/audit is not signing or installed-app acceptance.

**Model-publication acceptance (A1, A3, A4):** once a concrete release/model set is
approved for publication, use the existing model stage/scan/publish path through
the new release integration. The current standalone commands below are useful
for diagnosis; they do not by themselves prove release orchestration:

```sh
# From src/frontend; repeat for every referenced Parakeet/Pocket optional set.
pnpm --filter animama-desktop models:stage --model parakeet-tdt-0.6b-v2
ANIMAMA_GITLEAKS=<verified-gitleaks> pnpm --filter animama-desktop release:scan --candidate release/models/parakeet-tdt-0.6b-v2
pnpm --filter animama-desktop models:publish --model parakeet-tdt-0.6b-v2 --dry-run
```

Record exact staged bytes, scan receipt, existing/new keys, anonymous size/hash
results, and zero model uploads on reuse by a second app-version candidate.
Mocked second-version coverage is local evidence; a real second-version
publication remains separately recorded and must not be manufactured merely to
mark a checkbox complete. Publication controls and immutable `models/` policy
apply. Do not publish or edit approval receipts as part of this planning task.

**Self-host acceptance (A5):** use a fresh task-owned `ANIMAMA_MODEL_ROOT` to run
`python3 scripts/models/parakeet.py acquire`, then `verify`, `path` and offline
reuse with network disabled. Inspect that initial requests use the exact public
objects. Exercise offline import and a corrupt/interrupted fixture separately.
Acquire the reduced browser-speech core inputs required by the stack as documented;
optional Pocket voices/Mimi must not become startup/build prerequisites.
Read the local-stacks skill and reuse a suitable stack, or choose an unused name
and base port before startup. Validate both development and built self-host with
their recorded Compose graphs and these offline configuration checks:

```sh
export ANIMAMA_PARAKEET_MODEL_DIR="$(python3 scripts/models/parakeet.py path)"
export ANIMAMA_BROWSER_MODEL_DIR="$(python3 scripts/models/browser_speech.py path)"
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.development.yml config --quiet
```

Record checkout revision, named stack, URL and actual browser. At desktop
viewport, verify base speech recognition works with acquired files, cached
restart remains offline, and the existing WebGPU/Pocket asset flows remain
available. Exercise first-use voice and Mimi downloads against the same backend
asset routes, including offline failure and retry without changing saved choices.
Record microphone and WebGPU hardware checks as pending when the
browser cannot perform them; source assertions are not speech-fidelity evidence.

**Signed desktop acceptance (A2, A6):** use the release guide's exact signed
candidate procedure and an isolated fresh test profile/account. Install both
Parakeet packs from their public model objects, interrupt/restart and resume a
download, and verify a controlled corrupt-file fixture is rejected. Exercise
activation, deactivation, restart/offline use, base/GPU dependency behavior and
safe removal under active use. Check live CPU/WASM speech and WebGPU speech on
supported hardware. Preserve required-name smoke, signing/notarization and
existing release gates; do not test against an existing user profile. Record
the candidate hash, environment and unperformed checks. Fixture corruption
must never mutate shared immutable production objects.

**Voice UX and packaged acceptance (A8–A11):** record a fresh-profile desktop
run with optional model network access blocked: both starter voices speak, setup
can finish and neither extra voices nor Mimi are fetched. Then verify setup and
later Settings download actions, skip/Continue during transfer, setup draft and
credential guards through credential save/removal/retry and pack reload/rollback
(including name/age → enter key → save key → model download), GPU prerequisites/no-adapter
behavior, and cancellation/failure/retry. Reopen/remount every surface and compare
with installer status. Test a voice/Mimi download overlapping a Parakeet change:
coordination or recovery must be accurate and documented. Keep desktop viewport
screenshots, then check a narrow layout and keyboard access.

Start a real packaged-app file-cloning check with the encoder absent; download
it and verify that the original pending sample encodes once without reselection
while the view remains alive. Also clone through the catalog-building path using
the installed encoder; ordinary generation still succeeds when it is absent or
removed. Verify the sample stays local and one closing cloning view does not
cancel another caller's shared installation. Exercise selected missing voices,
recommended voices, preservation of per-Anima provider/voice preferences and
existing per-run fallback. Source/component tests and screenshots do not replace
listening, microphone or signed-native evidence; mark unavailable gates pending.

**Reporting:** keep automated, stack/browser, signed-native, actual publication
and hosted-CI results separate. Exact-candidate merge and app release approval
remain their existing lifecycle steps. Update #188 acceptance only with the
evidence actually obtained.

## Idempotence and recovery

- Downloads and producer acquisition use staging and complete inventory checks;
  failures never promote partial sets. Retried desktop transfers reverify both
  retained complete files and resumed bytes before activation.
- Keep the last verified active desktop pack through failed download/transition.
  Removal still observes dependency and active-use leases.
- Producer bootstrap uses the same verified local model store; no second cache
  or silent upstream fallback is introduced. Preserve existing model directories
  while any stack/process still consumes them.
- Published objects are create-only. Existing keys are never replaced or
  re-uploaded; failures after partial publication leave reusable objects. Changed
  payloads/notices use new hashes. Do not delete locked objects or preview
  releases as cleanup for this task.
- A notice/catalog/source change requires refreshed stage, scan and any affected
  inventory/native evidence. Never hand-edit a signed candidate or approval
  receipt. Retain the old stable feed until the complete new release verifies.
- Backend optional assets retain their atomic, restart-on-retry downloader;
  do not advertise desktop byte-range resume for Pocket downloads. Shared
  installation outlives one view; closing it detaches its waiter rather than
  globally cancelling a model another caller needs.
- Do not delete existing verified browser stores after reducing their manifest.
  Use a fresh reduced store or offline import, retain old stores while consumers
  use them, and remove optional weights only from newly assembled distributions.
- No compatibility migration is required, but task testing still preserves
  unrelated local data, Compose volumes and other worktrees.

## Planning validation

The original planning pass edited and read back the issue at the captured revision. Desktop contract,
self-host acquisition and publisher research used the starting source above.
No app services, model downloads, implementation tests or publication commands
were run. Local Markdown link targets, code fences, trailing whitespace and
`git diff --check` passed. The new files are not ignored. A Prettier executable
is not installed in this worktree or the primary checkout; no dependencies were
installed for this documentation-only task.

### Plan Review #1 Findings

Two independent read-only reviews checked the drafts against desktop contracts
and self-host/publication code at the recorded starting revision.

- **PLAN-S1:** include full/cold-cache Validation CI in explicit upstream
  bootstrap, so pre-release checks do not require prior object publication.
- **PC-1:** narrow the failure guarantee to model publication/verification.
  Sequential public app uploads are resumable, not an atomic visibility
  transaction; only stable feed promotion is withheld after an app failure.

### Plan Review #1 Revisions

Both findings accepted. Phase 3 now updates and checks Validation CI bootstrap.
The original Phase 4 (now Phase 6) permits resumable partial app uploads after successful model
verification while preserving the stable feed. Both reviewers' targeted rechecks
passed with no remaining material findings. This planning review does not consume
the implementation review rounds above.

### Voice-scope revision validation (2026-09-28)

The source issue was read at `2026-09-28T15:59:00Z`; it has not been edited by this
revision. The attached draft matched the existing plan before revision. The
original worktree/branch and ADR drafts are retained; no duplicate implementation
branch or plan location is introduced. The dated owner extension is recorded
above for issue/ADR synchronization before execution.

Current manifests were summed without acquiring payloads. Read-only source
checks covered setup activation, backend shutdown, voice generation, both cloning
paths and the overlapping Loadout work. The original Plan Review #1 and its
resolved findings remain intact. The following review covers only this extension
and its effects on the retained plan; implementation review budgets remain unused.

#### Plan Review #2 Findings

Two independent read-only checks reviewed the extension against the original
plan and current setup, Pocket and publication code.

- **PR2-S1:** setup draft preservation must precede credential save/removal/retry
  as well as pack activation, because credential actions also replace renderers.
- The Pocket/producer review found no additional material blockers after the
  generator ownership/traps were clarified. It recommended making the real
  cold-encoder cloning journey explicit in packaged acceptance.

#### Plan Review #2 Revisions

PR2-S1 accepted: Phase 5 now persists only nonsecret name/age drafts as fields
change and tests the name/age → key save → download journey across every setup
transition. A10 and packaged acceptance include credential transitions. The
cold-encoder packaged check now explicitly resumes the original sample after
verified installation. Targeted recheck passed: PR2-S1 resolved with no material direct regressions.
One repair round was used for Plan Review #2; implementation review rounds remain
unused.

Revision checks: local Markdown link targets resolve, code fences are balanced,
phase headings are sequential 1–6, and no tabs/trailing whitespace or
`git diff --no-index --check` errors were found. No dependencies were installed
and no implementation/native/model-download tests were run.

## Outcomes & Retrospective

Implementation setup completed on 2026-09-28; all six phases are authorized.
The issue and ADR include the agreed Pocket scope, and merged #195 is integrated.
Implementation and bounded phase review are in progress. Native hardware,
exact-input licensing review and actual publication evidence remain separate
execution requirements, not completed results.

## Implementation workspace handoff

- Checkout: assigned `2ca1/animama` worktree; branch `build/shared-model-store`.
- Integrated base: `f89d3ed33012a19d7647ebe34dc6a5094104de06` (merged #195).
- Phase issues: #197, #198, #199, #200, #201, #202.
- Locked pnpm/uv dependencies installed; tracked LFS inputs hydrated.
- Existing base, WebGPU and browser model caches verified offline.
- Task-owned development stack: `animama-model-objects-2ca1`,
  `http://animama-model-objects-2ca1.localhost:8600`. The normal
  `check-compose-ready.mjs` probe passed after first dependency installation.
- No model or app objects published.
