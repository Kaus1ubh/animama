# 0010: Shared voice model objects and optional downloads

- Status: accepted; items 2, 8 (Parakeet clause), 3 (built self-host) and 9
  (setup draft, GPU visibility) superseded by [0012](0012-backend-parakeet-model-assets.md)
- Recorded: 2026-09-28
- Amended: 2026-10-20, Michael is a core voice for the Andrew starter ([issue #618](https://github.com/raymond-van/animama/issues/618));
  2026-11-04, downloads end (below)
- Retrospective: no
- Original decision date: 2026-09-28
- Decision basis: owner decisions and implementation authorization in [issue #188](https://github.com/raymond-van/animama/issues/188), synchronized 2026-09-28

## Context

Before this decision, desktop delivered the two Parakeet model sets as compressed
feature pack archives in each app release directory. Built self-host already downloaded
the optional WebGPU encoder as a raw object from `downloads.animama.ai/models/`,
while base Parakeet setup acquired its pinned upstream files. The same model
bytes consequently had different distribution paths, and desktop releases
duplicated unchanged model archives.

The tracked model manifests already describe exact file names, sizes, SHA-256
digests and provenance, including README and attribution notices. The model
publisher already stages and scans these inventories, creates immutable objects
and verifies their public bytes. We can share those objects without combining
desktop pack activation, operator setup and backend in-app asset lifecycles.

This replaces the archive-per-app-release behavior for Parakeet model packs
documented in the runtime staging and release guides. There is no earlier ADR
dedicated to that behavior to supersede. Code and non-model content packs retain
their archive transport.

## Decision

1. Publish raw model files and required notices at
   `https://downloads.animama.ai/models/<model-id>/<file-sha256>/<file-name>`.
   Each changed file gets its own new key; a notice edit must not require
   republishing unchanged weights. Do not introduce compressed object variants.
2. Keep a feature pack as desktop's reviewed installation and activation unit.
   The app-embedded catalog pins a complete inventory, pack version, compatible
   app versions, dependencies and license references. For `parakeet-stt` and
   `parakeet-stt-webgpu`, files carry model-object references instead of one
   archive reference. Required notices are installed and verified with the
   weights. Installed apps do not discover new model versions from a mutable
   online catalog.
3. Make ordinary self-host/development base Parakeet acquisition use the same
   pinned objects. Preserve explicit acquisition, exact verification, offline
   import and path resolution, locking, complete-set promotion and existing
   serving paths. Keep upstream provenance for explicit producer acquisition
   before an object's first publication, including reviewed build/test inputs;
   ordinary consumer acquisition has no silent upstream fallback.
4. Use the tracked model manifests as the source of file identity. Derive or
   mechanically check each consumer's projection against them. Do not create
   backend in-app asset entries merely to make operator-acquired models eligible
   for publication, or require a common runtime downloader across Python and
   Electron.
5. Allow an authorized app release workflow to publish missing model objects
   through the existing model publisher. Stage and scan exact inputs, create
   missing objects only, and anonymously verify both new and existing objects
   before exposing the app release. A matching object is never uploaded again;
   a mismatch fails without overwrite. Local build and check commands do not
   publish. Release authorization may cover the model objects in the reviewed
   candidate; a separate earlier model release is unnecessary.
6. Make a direct development cutover. No legacy model-pack schema reader,
   installed-pack migration or old-preview acceptance is required. Preserve
   archive handling and signed-code verification for `document-processing`, and
   archive handling for non-model `expanded-included-content`. This decision
   does not authorize deleting existing remote objects.
7. Bundle the Pocket generation models with only the core voice states (Eve and
   Azelma at the decision; Michael joined them for the Andrew starter on
   2026-10-19).
   Retain the complete catalog and recommendation metadata; all other voices
   download individually from pinned model objects through the existing backend
   optional-asset service. Recommendation is discovery metadata, not permission
   to download or select a voice.
8. Deliver the unchanged Mimi cloning encoder as a separate optional asset.
   Ordinary generation and warmup do not fetch it. Explicit cloning offers its
   download and continues only after verified installation. Reuse the backend
   asset lifecycle for voices and Mimi, and Electron's pack lifecycle for
   Parakeet; consistent remote objects do not require a universal installer.
9. Offer direct optional Parakeet and cloning Download actions during desktop
   setup and in the respective Voice settings. Keep additional preset downloads
   in the compact Anima voice picker, without a separate setup/settings browser.
   App Settings has a Voice Clone section after Text-to-Speech, reusing the
   Anima cloning form. GPU controls in Settings follow the selected Parakeet
   WebGPU provider; setup may offer the optional GPU download directly. Setup can finish without optional downloads;
   installing a component does not select a provider or equip a voice. Preserve
   nonsecret setup drafts across credential/pack transitions, protect unsaved
   credentials and derive progress/recovery from the owning manager. Keep GPU
   download separate and device/base-model gated. Preserve merged #195's Loadout,
   named-clone and Anima-creation workflows while integrating optional encoding.

## Alternatives and consequences

- Keeping per-release archives saves transfer bytes through compression but
  repeats distribution and publishing work. Raw objects are the accepted
  tradeoff; the candidate's exact download and peak-space estimates must be
  recalculated rather than retaining archive-based numbers.
- Storing separately compressed objects would require another transport hash,
  decompression and expanded-size accounting. That complexity is excluded.
- Shipping notices only in the app would separate them from acquired model
  inventories. Published and installed notices remain subject to exact inventory
  checks and source/licensing review.
- Requiring publication before starting every app release would unnecessarily
  split one release operation. A release may publish missing models, but must
  fail before exposing app artifacts if model verification fails.
- A single remote store does not imply a shared writable local directory.
  Desktop retains app-owned packs and activation leases; self-host setup retains
  its verified model cache; backend optional assets retain their data-root store.
- Reducing bundled voices and separating Mimi removes 127,914,958 raw bytes at
  the inspected manifests. This is an inventory baseline, not a packaged size
  or memory claim. Offline fresh installations retain both starter voices;
  optional voice selection and cloning require verified acquisition first.
- Backend optional downloads restart after interruption, while desktop pack
  transfers support byte-range resume. Setup and settings must expose accurate
  recovery across pack-triggered backend/renderer restarts. One closing cloning
  view detaches its waiter without cancelling another caller's installation.
- Unpublished models need explicit producer acquisition from pinned provenance.
  The implementation must avoid a circular dependency in which publication
  first tries to download its own missing objects.
- Model publication is immutable. A partial release can leave valid unreferenced
  objects; retry verifies and reuses them. Corrections use new hash paths.

## Amendment (2026-11-04): downloads end

Animama's prebuilt distribution ends before 2027-01-01 (owner decision D5 of the
[open-source readiness plan](../plans/open-source-readiness/open-source-readiness-execplan.md);
[issue #837](https://github.com/raymond-van/animama/issues/837), refined by
[#859](https://github.com/raymond-van/animama/issues/859)). The local
composition keeps downloading until the final release, which turns downloads
off (`MODEL_DOWNLOADS_OFFERED` in `src/backend/animama/server/model_assets.py`):
installing an asset that is not installed is then refused with
`model_downloads_ended`, while assets installed earlier keep working and can be
removed. The objects on `downloads.animama.ai` stay published only for a short
transition after the final desktop release. The catalog and downloader are
unchanged.

## Evidence

- [Issue #188](https://github.com/raymond-van/animama/issues/188): authoritative
  requirements and the five owner decisions.
- [Execution plan](../plans/shared-model-store/shared-model-store-execplan.md):
  implementation, local verification and remaining native/publication acceptance gates.
- [Base manifest](../../models/parakeet-tdt-0.6b-v2/manifest.json) and
  [WebGPU manifest](../../models/parakeet-tdt-0.6b-v2-webgpu/manifest.json): pinned
  payload and notice inventories.
- [Model publisher](../../src/frontend/desktop/scripts/runtime/model-publication.mjs):
  object naming, exact staging, scan, create-only upload and public
  verification.
- [Acquisition command](../../scripts/models/parakeet.py): existing operator
  cache, offline and complete-set verification contracts.
- [Runtime staging](../frontend/desktop/runtime-staging.md) and
  [release reference](../frontend/desktop/releases.md): current model and archive
  transport, operator procedures and release review controls.
